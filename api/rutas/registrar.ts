/*
 * Registrar un trámite que ya llega digitado (formulario único y mandato llenos a mano, sobre con notas...) o del que
 * solo hay fotos de los documentos. La app lee cada hoja (/api/leer, tipo "documento"), las junta en un borrador
 * (compartido/registro.ts) y Felipe lo confirma; esto lo guarda todo de una vez:
 *
 *   POST /api/registrar  {
 *     tipoIds, organismoId?, cliente: "vendedor" | "comprador",
 *     vehiculo: { placa, marca, linea, modelo, clase, color, cilindraje, servicio, combustible, motor, chasis, serie, vin, capacidad, carroceria, potencia, fechaMatricula, licenciaTransito },
 *     vendedor?, comprador?: { nombre, tipoDocumento?, numeroDocumento?, telefono?, direccion?, ciudad?, fechaNacimiento?, fechaExpedicionDocumento? },
 *     valor?, abono?, metodoAbono?, aliado?, observaciones?, precondiciones: "cumplidas" | "pendientes" | "placapi", verificacionId?,
 *     fotos?: [{ ref: "<sesión>/<foto>", clase, rol? }],
 *     preanotacion?, fechaEstimadaEntrega?, licenciaId?, costos?: [{ tipoId, costoDerechos, honorarios }]
 *   } -> { ids, numeros, avisos }
 *   GET  /api/registrar/personas?q=        clientes guardados (para elegir uno en el formulario, también en el celular)
 *   GET  /api/registrar/placa/:placa       el vehículo guardado con esa placa y su propietario
 *   POST /api/registrar/cobro              el cobro sugerido de lo que va escrito (no guarda)
 *
 * Es también el formulario de Nuevo trámite (a mano, en el PC y en el celular): el mismo del asistente, sin fotos.
 * - Persona con `clienteId`: la ya guardada que se eligió (se le completa lo que falte).
 * - Preanotación: se guarda aunque falte un dato esencial (la placa, el comprador, la categoría...): queda con
 *   «Falta info» hasta completarlo. Basta el trámite y el nombre del cliente.
 * - `costos`: los que Felipe corrigió en el formulario (por trámite); los demás quedan con el cobro sugerido.
 * - Seguros y multas (SOAT, comparendos...) van como los de vehículo; la placa solo se pide si el trámite la necesita.
 *
 * - Personas: con cédula, la que ya existe con ese número (se le completa lo que falte); sin cédula, la que ya existe
 *   con ese teléfono y un nombre parecido; si no, una nueva.
 * - No se duplica: si la placa ya tiene abierto el mismo trámite, no se crea (la regla de un pendiente por trámite).
 * - Valor acordado: va todo en el trámite que lleva los honorarios (una sola vez por encargo); los demás en cero. El
 *   abono que ya dio (dicho al registrarlo) queda como un pago de ese mismo trámite.
 * - Precondiciones: todas cumplidas, pendientes, o que las revise PlacApi (si está conectado).
 * - Si se verificó con el RUNT antes de guardar (POST /api/registrar/verificar), esa revisión se aplica aquí sin volver a
 *   consultar: el vehículo queda con los datos del RUNT, lo limpio se marca y todo queda en la bitácora.
 * - Cada foto queda pegada en su documento del primer trámite (FUN, mandato, cédulas, tarjeta...).
 * - Licencia (renovación/refrendación, primera vez, recategorización, duplicado): sin vehículo; la persona (`vendedor`
 *   en el borrador) es el titular, `categorias` ("A2,B1") y su fecha de nacimiento (para el vencimiento). No se mezcla
 *   con trámites de vehículo. Un pendiente por trámite: si el titular ya tiene abierto el mismo, no se crea otro.
 */
import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import { codigoTramite, normalizar } from "../../compartido/dominio";
import { alertasTramite, categoriasDeTexto, hoyColombia } from "../../compartido/reglas";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import type { Datos, Db } from "../util";
import { asegurarCliente, asegurarVehiculo, FOTO, leerRespuesta, pegarFotos } from "./movil";
import { crearCliente, editarCliente } from "./personas";
import { absorberVehiculo, aplicarRevision, type Resultado } from "./revision";
import { agregarPago, agregarPersona, cobroSugerido, contextoReglas, crearTramites, editarTramite, fijarValor, guardarCostos, marcarPrecondicion } from "./tramites";

/** El abono que ya dio el cliente: un pago del trámite que lleva el valor. */
async function registrarAbono(db: Db, id: string, d: Datos) {
  const abono = Math.round(Number(String(d.abono ?? "").replace(/\D/g, "")) || 0);
  if (abono > 0) await leerRespuesta(await agregarPago(db, id, { valor: abono, metodo: vacio(d.metodoAbono) ? null : String(d.metodoAbono).slice(0, 60), origen: d.desde === "asistente" ? "asistente" : "manual" }));
}

const CLASES_FOTO = new Set(["tarjeta_propiedad", "cedula", "licencia_conduccion", "formulario_unico", "contrato_mandato", "contrato_compraventa", "recibo_pago", "carta_compromiso", "nota", "otro"]);
const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** Una persona: por cédula si la tiene; si no, por teléfono y nombre parecido; si no, nueva. Completa lo que falte. */
async function asegurarPersona(db: Db, p: Datos, avisos: string[]): Promise<string> {
  const nombre = String(p.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!nombre) throw new ErrorApi("Falta el nombre de una de las personas.");
  const doc = String(p.numeroDocumento ?? "").replace(/\D/g, "");
  const tel = String(p.telefono ?? "").replace(/\D/g, "");
  const extra: Datos = {};
  for (const k of ["direccion", "ciudad"] as const) if (!vacio(p[k])) extra[k] = String(p[k]).trim().toUpperCase();
  let id: string;
  // La que se eligió de las guardadas: esa (solo se le completa lo que no tenga).
  const elegida = typeof p.clienteId === "string" && p.clienteId ? await db.select().from(E.clientes).where(eq(E.clientes.id, p.clienteId)).get() : undefined;
  if (elegida) {
    id = elegida.id;
    for (const k of ["telefono", "fechaNacimiento", "fechaExpedicionDocumento"] as const) if (vacio(elegida[k]) && !vacio(p[k])) extra[k] = k === "telefono" ? tel : String(p[k]);
    if (!elegida.numeroDocumento && doc) extra.numeroDocumento = doc;
  } else if (doc) {
    id = await asegurarCliente(db, { nombre, numeroDocumento: doc, tipoDocumento: p.tipoDocumento || "CC", telefono: tel || null, fechaNacimiento: p.fechaNacimiento || null, fechaExpedicionDocumento: p.fechaExpedicionDocumento || null }, avisos);
  } else {
    const palabras = (s: string) => normalizar(s).split(/\s+/).filter((w) => w.length > 2);
    const candidatos = tel ? await db.select().from(E.clientes).where(eq(E.clientes.telefono, tel)) : [];
    const ya = candidatos.find((c) => palabras(c.nombre).filter((w) => palabras(nombre).includes(w)).length >= 2);
    id = ya?.id ?? String((await leerRespuesta(await crearCliente(db, { nombre, telefono: tel || null }))).d.id);
  }
  // Dirección y ciudad: se completan si la persona no las tenía.
  const previo = (await db.select().from(E.clientes).where(eq(E.clientes.id, id)).get())!;
  const completar: Datos = {};
  for (const [k, v] of Object.entries(extra)) if (vacio(previo[k as keyof typeof previo])) completar[k] = v;
  if (!doc && !elegida && tel && !previo.telefono) completar.telefono = tel;
  if (Object.keys(completar).length) await leerRespuesta(await editarCliente(db, id, completar));
  return id;
}

/** De dónde salió (el asistente, las fotos o a mano) y lo que dijo Felipe, para las observaciones del trámite. */
const observacionesDe = (d: Datos, fotos: Datos[], avisos: string[]) =>
  [d.desde === "asistente" ? "Anotado por el asistente." : fotos.length ? "Registrado desde documentos." : "", String(d.observaciones ?? "").trim(), ...avisos].filter(Boolean).join(" ").slice(0, 3900);
/** Lo que solo trae el formulario de Nuevo trámite: preanotación, la entrega y la licencia del radar que se renueva. */
const delFormulario = (d: Datos) => ({ preanotacion: d.preanotacion === true, fechaEstimadaEntrega: vacio(d.fechaEstimadaEntrega) ? null : d.fechaEstimadaEntrega, licenciaId: vacio(d.licenciaId) ? null : d.licenciaId });
/** Los costos que Felipe corrigió en el formulario (cada trámite por su tipo, en el orden en que se crearon). */
async function corregirCostos(db: Db, ids: string[], tipoIds: string[], d: Datos) {
  for (const c of (Array.isArray(d.costos) ? d.costos : []) as Datos[]) {
    const i = tipoIds.indexOf(String(c.tipoId));
    if (i < 0 || !ids[i]) continue;
    await leerRespuesta(await guardarCostos(db, ids[i], { costoDerechos: c.costoDerechos ?? 0, honorarios: c.honorarios ?? 0, otrosCostos: 0, origen: "manual" }));
  }
}

const COLUMNAS_PERSONA = { id: E.clientes.id, nombre: E.clientes.nombre, tipoDocumento: E.clientes.tipoDocumento, numeroDocumento: E.clientes.numeroDocumento, telefono: E.clientes.telefono, direccion: E.clientes.direccion, ciudad: E.clientes.ciudad, fechaNacimiento: E.clientes.fechaNacimiento };

/** Clientes guardados que coinciden con lo escrito (cada palabra por aparte): nombre, cédula o teléfono. */
export async function buscarPersonas(db: Db, q: string) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean).slice(0, 5);
  if (!palabras.length) return json({ clientes: [] });
  const filas = await db.select(COLUMNAS_PERSONA).from(E.clientes).where(and(...palabras.map((p) => like(E.clientes.busqueda, `%${p}%`)))).limit(8);
  return json({ clientes: filas });
}

/** El vehículo guardado con esa placa y su propietario (para llenar el formulario sin volver a escribirlo). */
export async function datosPlaca(db: Db, placa: string) {
  const v = await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa.toUpperCase().replace(/[^A-Z0-9]/g, ""))).get();
  if (!v) return json({ vehiculo: null, propietario: null });
  const propietario = v.titularId ? await db.select(COLUMNAS_PERSONA).from(E.clientes).where(eq(E.clientes.id, v.titularId)).get() : null;
  const t = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  return json({
    vehiculo: {
      placa: v.placa, marca: t(v.marca), linea: t(v.linea), modelo: t(v.modelo), clase: t(v.clase), color: t(v.color), cilindraje: t(v.cilindraje), servicio: t(v.servicio), combustible: t(v.combustible),
      motor: t(v.numeroMotor), chasis: t(v.numeroChasis), serie: t(v.numeroSerie), vin: t(v.vin), carroceria: t(v.carroceria), capacidad: t(v.capacidad), potencia: t(v.potencia), fechaMatricula: t(v.fechaMatricula), licenciaTransito: t(v.licenciaTransito),
    },
    propietario: propietario ?? null,
  });
}

/** El cobro sugerido de lo que va escrito en el formulario (los mismos cálculos de crear; no guarda nada). */
export async function vistaCobro(db: Db, d: Datos) {
  const tipoIds = [...new Set((Array.isArray(d.tipoIds) ? d.tipoIds : []).filter((x): x is string => typeof x === "string" && !!x))];
  if (!tipoIds.length) return json({ costos: [], avisos: [] });
  const organismoId = vacio(d.organismoId) ? null : String(d.organismoId);
  const v = (d.vehiculo ?? {}) as Datos;
  const placa = String(v.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [tipos, tarifas, ctx, guardado, organismo] = await Promise.all([
    db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, tipoIds)),
    db.select().from(E.tarifas),
    contextoReglas(db),
    placa ? db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get() : Promise.resolve(undefined),
    organismoId ? db.select({ ciudad: E.organismos.ciudad, nombre: E.organismos.nombre }).from(E.organismos).where(eq(E.organismos.id, organismoId)).get() : Promise.resolve(undefined),
  ]);
  if (tipos.length !== tipoIds.length) throw new ErrorApi("Algún trámite elegido ya no existe.");
  // Lo escrito manda; lo que no se escribió, lo del vehículo guardado.
  const num = (x: unknown) => Number(String(x ?? "").replace(/\D/g, "")) || null;
  const escrito = (k: string, g: string | null | undefined) => (vacio(v[k]) ? g ?? null : String(v[k]));
  const vehiculo = {
    avaluoOficial: guardado?.avaluoOficial ?? null, avaluoDetalle: guardado?.avaluoDetalle ?? null,
    marca: escrito("marca", guardado?.marca), linea: escrito("linea", guardado?.linea), clase: escrito("clase", guardado?.clase),
    modelo: num(v.modelo) ?? guardado?.modelo ?? null, cilindraje: num(v.cilindraje) ?? guardado?.cilindraje ?? null,
  };
  const conClases = d.conClases === "con" || d.conClases === true ? true : d.conClases === "sin" || d.conClases === false ? false : null;
  const { todosLosCostos, avisosCobro } = await cobroSugerido(db, tipoIds, tipos, tarifas, ctx, organismoId, organismo, vehiculo, categoriasDeTexto(String(d.categorias ?? "")), conClases);
  return json({ costos: tipoIds.map((id, i) => ({ tipoId: id, lineas: todosLosCostos[i].lineas, honorarios: todosLosCostos[i].honorarios, avisos: todosLosCostos[i].avisos })), avisos: avisosCobro });
}

export async function registrar(db: Db, r2: R2Bucket, d: Datos, alCrear?: (tramiteId: string) => void) {
  const tipoIds = [...new Set((Array.isArray(d.tipoIds) ? d.tipoIds : []).filter((x): x is string => typeof x === "string" && !!x))];
  if (!tipoIds.length) throw new ErrorApi("Elija el trámite.");
  const tipos = await db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, tipoIds));
  if (tipos.length !== tipoIds.length) throw new ErrorApi("Algún trámite elegido ya no existe.");
  if (tipos.some((t) => t.categoria === "licencia")) {
    if (tipos.some((t) => t.categoria !== "licencia")) throw new ErrorApi("No se mezclan trámites de licencia con los de vehículo: regístrelos aparte.");
    return registrarLicencia(db, r2, d, tipos, alCrear);
  }
  if (tipos.some((t) => t.categoria !== "vehiculo" && t.categoria !== "seguros_multas")) throw new ErrorApi("Este trámite no se registra desde documentos.");
  const preanotacion = d.preanotacion === true;
  const v = (d.vehiculo ?? {}) as Datos;
  const placa = String(v.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pideVehiculo = tipos.some((t) => t.requiereVehiculo);
  if (!placa && pideVehiculo && !preanotacion) throw new ErrorApi("Falta la placa.");
  const traspaso = tipos.some((t) => /traspaso/i.test(t.nombre));
  const vend = d.vendedor as Datos | null | undefined, comp = d.comprador as Datos | null | undefined;
  if (preanotacion) {
    if (!vend?.nombre && !comp?.nombre) throw new ErrorApi("Falta el nombre del cliente.");
  } else {
    if (!vend?.nombre) throw new ErrorApi(traspaso ? "Falta el vendedor (el propietario actual)." : pideVehiculo ? "Falta el propietario." : "Falta el titular.");
    if (traspaso && !comp?.nombre && !tipos.some((t) => /indeterminad/i.test(t.nombre))) throw new ErrorApi("Es un traspaso: falta el comprador.");
  }
  const precond = ["cumplidas", "pendientes", "placapi"].includes(String(d.precondiciones)) ? String(d.precondiciones) : preanotacion ? "pendientes" : null;
  if (!precond) throw new ErrorApi("Diga qué hacer con las precondiciones.");
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []) as Datos[];
  for (const f of fotos) if (!FOTO.test(String(f.ref ?? "")) || !CLASES_FOTO.has(String(f.clase))) throw new ErrorApi("Alguna foto no es válida.");

  // Un pendiente por trámite: si la placa ya tiene abierto alguno de estos, no se crea otro.
  const existente = placa ? await db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get() : undefined;
  if (existente) {
    const abiertos = await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie, tipoId: E.tramites.tipoId }).from(E.tramites)
      .where(and(eq(E.tramites.vehiculoId, existente.id), inArray(E.tramites.tipoId, tipoIds), notInArray(E.tramites.estado, ["entregado", "cancelado"])));
    if (abiertos.length) {
      const nombres = abiertos.map((a) => `${codigoTramite(a)} (${tipos.find((t) => t.id === a.tipoId)?.nombre})`);
      throw new ErrorApi(`${placa} ya tiene abierto ${nombres.join(", ")}: no se crea otro igual.`, 409);
    }
  }

  const avisos: string[] = [];
  const vendedorId = vend?.nombre ? await asegurarPersona(db, vend, avisos) : null;
  const compradorId = comp?.nombre ? await asegurarPersona(db, comp, avisos) : null;
  if (compradorId && compradorId === vendedorId) throw new ErrorApi("El vendedor y el comprador son la misma persona: revise las cédulas.");
  const titularId = (d.cliente === "comprador" && compradorId ? compradorId : vendedorId ?? compradorId)!;
  const vehiculoId = !placa ? null : await asegurarVehiculo(db, {
    placa, marca: v.marca, linea: v.linea, modelo: v.modelo, clase: v.clase, color: v.color, cilindraje: v.cilindraje, servicio: v.servicio,
    numeroMotor: v.motor, numeroChasis: v.chasis, numeroSerie: v.serie, vin: v.vin, combustible: v.combustible, carroceria: v.carroceria,
    capacidad: v.capacidad, potencia: v.potencia, fechaMatricula: v.fechaMatricula, licenciaTransito: v.licenciaTransito,
  }, vendedorId ?? titularId);

  const creado = await leerRespuesta(await crearTramites(db, { tipoIds, titularId, vehiculoId, organismoId: d.organismoId || null, observaciones: observacionesDe(d, fotos, avisos), origen: "manual", ...delFormulario(d) }));
  const ids = creado.d.ids as string[];
  // Lo que hay que mirar del cobro sugerido (tarifas que faltan, la retención) va primero.
  avisos.unshift(...((creado.d.avisos as string[] | undefined) ?? []));
  for (const id of ids) {
    if (vendedorId && vendedorId !== titularId) await leerRespuesta(await agregarPersona(db, id, { clienteId: vendedorId, rol: "vendedor" }), true);
    if (compradorId && compradorId !== titularId) await leerRespuesta(await agregarPersona(db, id, { clienteId: compradorId, rol: "comprador" }), true);
    if (!vacio(d.aliado)) await leerRespuesta(await editarTramite(db, id, { aliado: String(d.aliado).trim().toUpperCase() }));
    if (precond === "cumplidas") await leerRespuesta(await marcarPrecondicion(db, id, { todas: true, origen: "manual", soloEste: true }));
  }

  // Valor acordado: todo en el trámite que lleva los honorarios; los demás del encargo, en cero.
  const valor = Math.round(Number(String(d.valor ?? "").replace(/\D/g, "")) || 0);
  if (valor > 0) await leerRespuesta(await fijarValor(db, ids[0], { valor, origen: "manual" }));
  await corregirCostos(db, ids, tipoIds, d);
  await registrarAbono(db, ids[0], d);

  // Las fotos, cada una en su documento del primer trámite.
  const claveDe = (f: Datos) => f.clase === "tarjeta_propiedad" ? "vehiculo" : f.clase === "cedula" ? (f.rol === "comprador" ? "comprador" : f.rol === "vendedor" ? (traspaso ? "vendedor" : "titular") : "cedula_otra") : f.clase === "licencia_conduccion" ? "licencia" : String(f.clase);
  // La verificación con el RUNT hecha antes de guardar (ya pagada): se aplica sin volver a consultar.
  if (d.verificacionId && vehiculoId) {
    const fila = await db.select().from(E.consultasExternas).where(and(eq(E.consultasExternas.id, String(d.verificacionId)), eq(E.consultasExternas.tipo, "verificacion"))).get();
    const r = fila?.respuesta as Resultado | undefined;
    if (r && fila!.referencia === `placa:${placa}`) {
      const vehiculo = (await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, vehiculoId)).get())!;
      if (r.runt) await absorberVehiculo(db, vehiculo, r.runt);
      for (const id of ids) await aplicarRevision(db, id, r, { marcar: precond !== "pendientes" });
    } else avisos.push("La verificación con el RUNT era de otra placa: no se aplicó.");
  }
  const pegadas = fotos.length ? await pegarFotos(db, r2, ids[0], fotos.map((f) => ({ clave: claveDe(f), foto: String(f.ref), nombre: typeof f.nombre === "string" ? f.nombre.trim().slice(0, 120) || null : null }))).catch((e) => { avisos.push(`Quedó registrado, pero no se pudieron pegar las fotos: ${e instanceof Error ? e.message : e}`); return 0; }) : 0;
  if (precond === "placapi" && !d.verificacionId) alCrear?.(ids[0]);
  // Lo importante para que no lo devuelvan (otra ciudad, comprador menor de edad, carta de prenda) va primero.
  const org = d.organismoId ? await db.select({ ciudad: E.organismos.ciudad }).from(E.organismos).where(eq(E.organismos.id, String(d.organismoId))).get() : null;
  const comprador = compradorId ? await db.select({ nombre: E.clientes.nombre, tipoDocumento: E.clientes.tipoDocumento, fechaNacimiento: E.clientes.fechaNacimiento }).from(E.clientes).where(eq(E.clientes.id, compradorId)).get() : null;
  avisos.unshift(...alertasTramite({ tipos, ciudad: org?.ciudad, compradores: comprador ? [comprador] : [], hoy: hoyColombia() }).map((x) => `Importante: ${x.texto}`));

  const filas = await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie }).from(E.tramites).where(inArray(E.tramites.id, ids));
  // Un combo es un solo código.
  const numeros = [...new Set(filas.sort((a, b) => a.numero - b.numero).map((f) => codigoTramite(f)))];
  return json({ ids, numeros, fotos: pegadas, avisos });
}

/** Un trámite de licencia desde sus hojas (recibo de pago, cédula, licencia). Ver el encabezado. */
async function registrarLicencia(db: Db, r2: R2Bucket, d: Datos, tipos: (typeof E.tiposTramite.$inferSelect)[], alCrear?: (tramiteId: string) => void) {
  const titular = (d.titular ?? d.vendedor) as Datos | null | undefined;
  const preanotacion = d.preanotacion === true;
  if (!titular?.nombre) throw new ErrorApi("Falta el titular de la licencia.");
  if (!String(titular.numeroDocumento ?? "").replace(/\D/g, "") && !preanotacion && !titular.clienteId) throw new ErrorApi("Falta la cédula del titular.");
  const categorias = String(d.categorias ?? "").toUpperCase().split(/[^A-C0-9]+/).filter((c) => /^[ABC][123]$/.test(c));
  if (!categorias.length && !preanotacion) throw new ErrorApi("Elija la categoría de la licencia (A1, A2, B1...).");
  const precond = ["cumplidas", "pendientes", "placapi"].includes(String(d.precondiciones)) ? String(d.precondiciones) : preanotacion ? "pendientes" : null;
  if (!precond) throw new ErrorApi("Diga qué hacer con las precondiciones.");
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []) as Datos[];
  for (const f of fotos) if (!FOTO.test(String(f.ref ?? "")) || !CLASES_FOTO.has(String(f.clase))) throw new ErrorApi("Alguna foto no es válida.");

  const avisos: string[] = [];
  const titularId = await asegurarPersona(db, titular, avisos);
  // Un pendiente por trámite: el titular ya tiene abierto el mismo.
  const abiertos = await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie, tipoId: E.tramites.tipoId }).from(E.tramites)
    .where(and(eq(E.tramites.titularId, titularId), inArray(E.tramites.tipoId, tipos.map((t) => t.id)), notInArray(E.tramites.estado, ["entregado", "cancelado"])));
  if (abiertos.length) throw new ErrorApi(`${String(titular.nombre).toUpperCase()} ya tiene abierto ${abiertos.map((a) => `${codigoTramite(a)} (${tipos.find((t) => t.id === a.tipoId)?.nombre})`).join(", ")}: no se crea otro igual.`, 409);

  const creado = await leerRespuesta(await crearTramites(db, { tipoIds: tipos.map((t) => t.id), titularId, organismoId: d.organismoId || null, detalle: categorias.join(","), conClases: typeof d.conClases === "boolean" ? d.conClases : null, observaciones: observacionesDe(d, fotos, avisos), origen: "manual", ...delFormulario(d) }));
  const ids = creado.d.ids as string[];
  // Lo que hay que mirar del cobro sugerido (tarifas que faltan, la retención) va primero.
  avisos.unshift(...((creado.d.avisos as string[] | undefined) ?? []));
  for (const id of ids) {
    if (!vacio(d.aliado)) await leerRespuesta(await editarTramite(db, id, { aliado: String(d.aliado).trim().toUpperCase() }));
    if (precond === "cumplidas") await leerRespuesta(await marcarPrecondicion(db, id, { todas: true, origen: "manual", soloEste: true }));
  }
  const valor = Math.round(Number(String(d.valor ?? "").replace(/\D/g, "")) || 0);
  if (valor > 0) await leerRespuesta(await fijarValor(db, ids[0], { valor, origen: "manual" }));
  await corregirCostos(db, ids, tipos.map((t) => t.id), d);
  await registrarAbono(db, ids[0], d);
  // Lo importante: con clases, la carta de compromiso firmada.
  // La carta de compromiso: si vino en las fotos, ya quedó pegada (no se alerta).
  const conCarta = fotos.some((f) => f.clase === "carta_compromiso");
  avisos.unshift(...alertasTramite({ tipos, ciudad: null, compradores: [], hoy: hoyColombia(), conClases: typeof d.conClases === "boolean" ? d.conClases : null, compromisoPendiente: !conCarta }).map((x) => (x.clave === "compromiso_clases" ? `⚠ ATENCIÓN: ${x.texto}` : `Importante: ${x.texto}`)));
  const claveDe = (f: Datos) => (f.clase === "cedula" ? "titular" : f.clase === "licencia_conduccion" ? "licencia" : String(f.clase));
  const pegadas = fotos.length ? await pegarFotos(db, r2, ids[0], fotos.map((f) => ({ clave: claveDe(f), foto: String(f.ref), nombre: typeof f.nombre === "string" ? f.nombre.trim().slice(0, 120) || null : null }))).catch((e) => { avisos.push(`Quedó registrado, pero no se pudieron pegar las fotos: ${e instanceof Error ? e.message : e}`); return 0; }) : 0;
  // La revisión previa de una licencia: su licencia en el RUNT y su SIMIT (2 créditos).
  if (precond === "placapi") alCrear?.(ids[0]);
  const filas = await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie }).from(E.tramites).where(inArray(E.tramites.id, ids));
  const numeros = [...new Set(filas.sort((a, b) => a.numero - b.numero).map((f) => codigoTramite(f)))];
  return json({ ids, numeros, fotos: pegadas, avisos });
}
