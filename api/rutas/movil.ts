/*
 * App del celular "Fotos · Trámites Pira": crear un trámite completo desde las fotos de los documentos.
 * El celular no descarga la base: pide aquí el catálogo, lee cada foto con /api/leer, sube las fotos a una sesión
 * de fotos (fotos/<sesión>/, se borran a las 48 horas) y al final manda todo junto a POST /api/movil/tramite,
 * que crea o reutiliza las personas y el vehículo, crea el trámite y le pega las fotos a sus documentos.
 *
 *   GET  /api/movil/catalogo   Tipos de trámite activos y organismos (para los menús del celular).
 *   POST /api/movil/tramite    { tipoId, organismoId?, detalle?, cliente, personas[], vehiculo?, fotos? } -> { id, numero, avisos }
 *                              Si es de vehículo y PlacApi está conectado, queda revisándose solo (revision.ts).
 *
 * Personas: { rol: "titular" | "vendedor" | "comprador", tipoDocumento?, numeroDocumento, nombre, telefono?,
 *   fechaNacimiento?, fechaExpedicionDocumento?, foto? }. `cliente` dice cuál de ellas es el titular del trámite.
 * Si la persona o la placa ya existen se usan las que hay y solo se completan los datos que les falten.
 */
import { and, eq } from "drizzle-orm";
import { CATEGORIAS_TRAMITE, codigoTramite, normalizar } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import type { Datos, Db } from "../util";
import { agregarDocumento, subirArchivo } from "./documentos";
import { crearCliente, crearVehiculo, editarCliente, editarVehiculo } from "./personas";
import { agregarPersona, crearTramites } from "./tramites";

const ROLES = ["titular", "vendedor", "comprador"] as const;
type Rol = (typeof ROLES)[number];
export const FOTO = /^[a-z0-9]{16}\/[0-9]{13}-[a-z0-9]{6}\.(?:jpg|png|webp)$/;
const CAMPOS_VEHICULO = ["placa", "clase", "marca", "linea", "modelo", "cilindraje", "servicio", "color", "numeroMotor", "numeroChasis", "numeroSerie", "vin", "fechaMatricula", "combustible", "carroceria", "capacidad", "potencia", "licenciaTransito"] as const;

export async function catalogo(db: Db) {
  const [tipos, organismos, tarifas] = await Promise.all([
    db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre, categoria: E.tiposTramite.categoria, descripcion: E.tiposTramite.descripcion, requiereVehiculo: E.tiposTramite.requiereVehiculo, slaDias: E.tiposTramite.slaDias, requisitos: E.tiposTramite.requisitos, orden: E.tiposTramite.orden })
      .from(E.tiposTramite).where(eq(E.tiposTramite.activo, true)),
    db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos).where(eq(E.organismos.activo, true)),
    db.selectDistinct({ tipo: E.tarifas.tipoTramiteId, organismo: E.tarifas.organismoId }).from(E.tarifas),
  ]);
  tipos.sort((a, b) => CATEGORIAS_TRAMITE.indexOf(a.categoria as never) - CATEGORIAS_TRAMITE.indexOf(b.categoria as never) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
  organismos.sort((a, b) => (a.ciudad ?? a.nombre).localeCompare(b.ciudad ?? b.nombre, "es"));
  // Qué trámite tiene tarifa en qué organismo (null = la general, sirve en todos): el cotizador avisa antes de cotizar.
  return json({ tipos, organismos, tarifas: tarifas.map((t) => [t.tipo, t.organismo]), organismoPorDefecto: organismos.find((o) => o.ciudad === "Ibagué")?.id ?? null });
}

/** Las funciones de las rutas responden con Response: aquí se leen y, si fallan, se corta con su mensaje. */
export async function leerRespuesta(r: Response, permitir409 = false) {
  const d = (await r.json().catch(() => ({}))) as Datos;
  if (r.ok || (permitir409 && r.status === 409)) return { estado: r.status, d };
  throw new ErrorApi(String(d.error ?? `No se pudo (${r.status}).`), r.status);
}

const vacio = (v: unknown) => v === null || v === undefined || v === "";

/** Crea la persona, o usa la que ya existe con ese documento completándole lo que le falte (teléfono, nacimiento...). */
export async function asegurarCliente(db: Db, p: Datos, avisos: string[]) {
  const datos = {
    tipoDocumento: p.tipoDocumento || "CC", numeroDocumento: String(p.numeroDocumento ?? "").replace(/\D/g, ""), nombre: String(p.nombre ?? "").trim(),
    telefono: p.telefono ? String(p.telefono).replace(/\D/g, "") : null, fechaNacimiento: p.fechaNacimiento || null, fechaExpedicionDocumento: p.fechaExpedicionDocumento || null,
  };
  if (!datos.nombre) throw new ErrorApi("Falta el nombre de una de las personas.");
  if (!datos.numeroDocumento) throw new ErrorApi(`Falta la cédula de ${datos.nombre}.`);
  const r = await leerRespuesta(await crearCliente(db, datos), true);
  if (r.estado !== 409) return String(r.d.id);
  const id = String(r.d.existenteId);
  const previo = (await db.select().from(E.clientes).where(eq(E.clientes.id, id)).get())!;
  const completar: Datos = {};
  for (const k of ["telefono", "fechaNacimiento", "fechaExpedicionDocumento"] as const) if (vacio(previo[k]) && !vacio(datos[k])) completar[k] = datos[k];
  if (datos.telefono && previo.telefono && previo.telefono !== datos.telefono) avisos.push(`${previo.nombre} ya tenía el teléfono ${previo.telefono}; se dejó ese (el nuevo, ${datos.telefono}, va en las observaciones).`);
  if (Object.keys(completar).length) await leerRespuesta(await editarCliente(db, id, completar));
  return id;
}

/** Crea el vehículo o usa el que ya existe con esa placa, completándole lo que le falte. */
export async function asegurarVehiculo(db: Db, v: Datos, titularId: string) {
  const datos: Datos = {};
  for (const k of CAMPOS_VEHICULO) if (!vacio(v[k])) datos[k] = v[k];
  if (!datos.placa) throw new ErrorApi("Falta la placa del vehículo.");
  const r = await leerRespuesta(await crearVehiculo(db, { ...datos, titular: { id: titularId } }), true);
  if (r.estado !== 409) return String(r.d.id);
  const id = String(r.d.existenteId);
  const previo = (await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, id)).get())! as unknown as Datos;
  const completar: Datos = {};
  for (const k of CAMPOS_VEHICULO) if (k !== "placa" && vacio(previo[k]) && !vacio(datos[k])) completar[k] = datos[k];
  if (vacio(previo.titularId)) completar.titular = { id: titularId };
  if (Object.keys(completar).length) await leerRespuesta(await editarVehiculo(db, id, completar));
  return id;
}

/** Qué documento de la lista del trámite le corresponde a cada foto (por palabras del nombre). Si no hay, se crea. */
const DOCUMENTO_DE: Record<string, { buscar: string[]; evitar?: string[]; nombre: string }> = {
  vehiculo: { buscar: ["tarjeta de propiedad", "licencia de transito"], nombre: "Fotocopia de la tarjeta de propiedad" },
  titular: { buscar: ["cedula del propietario", "cedula del titular", "cedula", "documento de identidad"], evitar: ["comprador"], nombre: "Fotocopia de la cédula" },
  vendedor: { buscar: ["cedula del vendedor", "cedula del propietario", "cedula"], evitar: ["comprador"], nombre: "Fotocopia de la cédula del vendedor" },
  comprador: { buscar: ["cedula del comprador"], nombre: "Fotocopia de la cédula del comprador" },
  licencia: { buscar: ["licencia de conduccion"], nombre: "Fotocopia de la licencia de conducción" },
  // Las hojas de un trámite que ya llega digitado (registrar.ts).
  formulario_unico: { buscar: ["formulario unico", "fun"], nombre: "Formulario único (FUN)" },
  contrato_mandato: { buscar: ["mandato", "poder"], nombre: "Contrato de mandato" },
  contrato_compraventa: { buscar: ["compraventa"], nombre: "Contrato de compraventa" },
  cedula_otra: { buscar: [], nombre: "Fotocopia de cédula" },
  recibo_pago: { buscar: ["recibo de pago", "recibo", "consignacion"], nombre: "Recibo de pago" },
  // La carta de compromiso firmada: llena el documento que la licencia trae pendiente.
  carta_compromiso: { buscar: ["carta de compromiso"], nombre: "Carta de compromiso firmada" },
  nota: { buscar: [], nombre: "Nota de la oficina" },
  otro: { buscar: [], nombre: "Otro documento" },
};

/** `nombre`: el nombre del documento nuevo, si se sabe qué es mejor que por su clase ("Recibo de caja menor"). */
export async function pegarFotos(db: Db, r2: R2Bucket, tramiteId: string, fotos: { clave: string; foto: string; nombre?: string | null }[]) {
  const docs = await db.select().from(E.documentos).where(eq(E.documentos.tramiteId, tramiteId));
  const usados = new Set<string>();
  let pegadas = 0;
  for (const { clave, foto, nombre: nombreDado } of fotos) {
    const regla = DOCUMENTO_DE[clave];
    if (!regla) continue;
    const obj = await r2.get(`fotos/${foto}`);
    if (!obj) continue; // se borró (más de 48 horas): el trámite queda igual, sin esa foto
    let doc: { id: string } | undefined;
    for (const palabra of regla.buscar) {
      doc = docs.find((d) => !usados.has(d.id) && !d.archivoClave && normalizar(d.tipoDocumento).includes(palabra) && !regla.evitar?.some((e) => normalizar(d.tipoDocumento).includes(e)));
      if (doc) break;
    }
    const tipoDocumento = (!doc && nombreDado) || regla.nombre;
    const docId = doc?.id ?? String((await leerRespuesta(await agregarDocumento(db, tramiteId, { tipoDocumento }))).d.id);
    usados.add(docId);
    const nombre = `${tipoDocumento.replace(/^Fotocopia de la /, "")}.jpg`;
    const tipo = obj.httpMetadata?.contentType ?? "image/jpeg";
    const req = new Request("https://interno/subir", { method: "PUT", headers: { "Content-Type": tipo, "Content-Length": String(obj.size), "X-Nombre-Archivo": encodeURIComponent(nombre) }, body: obj.body });
    await leerRespuesta(await subirArchivo(db, r2, docId, req));
    pegadas++;
  }
  return pegadas;
}

/** `alCrear` se llama con el trámite ya creado (si es de vehículo), para revisarlo con PlacApi en segundo plano. */
export async function crearDesdeFotos(db: Db, r2: R2Bucket, d: Datos, alCrear?: (tramiteId: string) => void) {
  const tipoId = String(d.tipoId ?? "");
  const tipo = await db.select().from(E.tiposTramite).where(and(eq(E.tiposTramite.id, tipoId), eq(E.tiposTramite.activo, true))).get();
  if (!tipo) throw new ErrorApi("Elija el tipo de trámite.");
  const personas = (Array.isArray(d.personas) ? d.personas : []) as Datos[];
  if (!personas.length || personas.length > 3) throw new ErrorApi("Faltan las personas del trámite.");
  for (const p of personas) if (!ROLES.includes(p.rol as Rol)) throw new ErrorApi("Rol de persona no válido.");
  const fotos: { clave: string; foto: string }[] = [];
  const foto = (clave: string, f: unknown) => { if (typeof f === "string" && FOTO.test(f)) fotos.push({ clave, foto: f }); };

  const avisos: string[] = [];
  const ids = new Map<Rol, string>();
  for (const p of personas) {
    ids.set(p.rol as Rol, await asegurarCliente(db, p, avisos));
    foto(String(p.rol), p.foto);
  }
  const cliente = (ROLES.includes(d.cliente as Rol) ? d.cliente : personas[0].rol) as Rol;
  const titularId = ids.get(cliente);
  if (!titularId) throw new ErrorApi("No se sabe quién es el cliente del trámite.");

  let vehiculoId: string | null = null;
  if (d.vehiculo && typeof d.vehiculo === "object") {
    const v = d.vehiculo as Datos;
    // Dueño del vehículo: en un traspaso, quien vende (sigue siendo el dueño hasta que salga el trámite).
    vehiculoId = await asegurarVehiculo(db, v, ids.get("vendedor") ?? ids.get("titular") ?? titularId);
    foto("vehiculo", v.foto);
  } else if (tipo.requiereVehiculo) throw new ErrorApi("Falta la tarjeta de propiedad del vehículo.");
  foto("licencia", d.fotoLicencia);

  const observaciones = ["Creado desde la app de fotos del celular.", ...avisos.map((a) => a.replace(/ \(el nuevo, (\d+), va en las observaciones\)/, ". Teléfono nuevo: $1"))].join(" ");
  const creado = await leerRespuesta(await crearTramites(db, {
    tipoIds: [tipo.id], titularId, vehiculoId, organismoId: d.organismoId || null, detalle: d.detalle || null, observaciones, origen: "manual",
  }));
  const tramiteId = String((creado.d.ids as string[])[0]);
  for (const [rol, id] of ids) if (id !== titularId && rol !== "titular") await leerRespuesta(await agregarPersona(db, tramiteId, { clienteId: id, rol }), true);
  const pegadas = await pegarFotos(db, r2, tramiteId, fotos).catch((e) => { avisos.push(`El trámite quedó creado, pero no se pudieron pegar las fotos: ${e instanceof Error ? e.message : e}`); return 0; });
  if (vehiculoId) alCrear?.(tramiteId);
  const t = (await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie }).from(E.tramites).where(eq(E.tramites.id, tramiteId)).get())!;
  return json({ id: tramiteId, numero: codigoTramite(t), fotos: pegadas, avisos });
}
