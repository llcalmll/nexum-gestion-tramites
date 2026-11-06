/*
 * Configuración (Felipe es el único usuario, así que todo es editable).
 *   POST/PATCH/DELETE /api/config/tipos[/:id]
 *   POST/PATCH/DELETE /api/config/tarifas[/:id]
 *   POST/PATCH/DELETE /api/config/organismos[/:id]
 *   PUT               /api/config/parametros/:clave   { valor }
 */
import { eq } from "drizzle-orm";
import { CATEGORIAS_TRAMITE, PRECONDICIONES, type Precondicion } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { leerTramos } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import { enLista, entero, esDuplicado, esReferenciada, fecha, nuevoId, pesos, texto, textoObligatorio, type Datos, type Db } from "../util";

async function conErrores<T>(f: () => Promise<T>, duplicado: string, referenciada: string): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorApi(duplicado, 409);
    if (esReferenciada(e)) throw new ErrorApi(referenciada, 409);
    throw e;
  }
}

const sinCambios = (r: D1Result) => { if (!r.meta.changes) throw new ErrorApi("El registro no existe.", 404); };

// ─── Tipos de trámite ────────────────────────────────────────────────────────

function camposTipo(d: Datos, nuevo: boolean) {
  const tiene = (k: string) => nuevo || k in d;
  const c: Partial<typeof E.tiposTramite.$inferInsert> = {};
  if (tiene("nombre")) c.nombre = textoObligatorio(d.nombre, "el nombre", 120);
  if (tiene("categoria")) c.categoria = enLista(d.categoria, CATEGORIAS_TRAMITE, "categoría");
  if ("descripcion" in d) c.descripcion = texto(d.descripcion, 1000);
  if ("requiereVehiculo" in d) c.requiereVehiculo = d.requiereVehiculo === true;
  if ("aplicaImpuestoRegistro" in d) c.aplicaImpuestoRegistro = d.aplicaImpuestoRegistro === true;
  if ("slaDias" in d) c.slaDias = entero(d.slaDias, "días de entrega", 0, 365);
  if ("orden" in d) c.orden = entero(d.orden, "orden", 0, 10_000) ?? 0;
  if ("activo" in d) c.activo = d.activo !== false;
  if ("requisitos" in d) {
    if (!Array.isArray(d.requisitos)) throw new ErrorApi("Los documentos requeridos no son válidos.");
    c.requisitos = d.requisitos.slice(0, 40).map((r) => {
      const x = (r ?? {}) as Datos;
      return { documento: textoObligatorio(x.documento, "el nombre del documento", 200), obligatorio: x.obligatorio !== false };
    });
  }
  if ("precondiciones" in d) {
    const p = (d.precondiciones ?? {}) as Datos;
    c.precondiciones = Object.fromEntries(PRECONDICIONES.filter((k) => p[k] === true).map((k) => [k, true])) as Partial<Record<Precondicion, boolean>>;
  }
  return c;
}

export async function crearTipo(db: Db, d: Datos) {
  const id = nuevoId();
  await conErrores(() => db.insert(E.tiposTramite).values({ ...(camposTipo(d, true) as typeof E.tiposTramite.$inferInsert), id }).run(), "Ya existe un tipo de trámite con ese nombre.", "");
  return json({ id });
}
export async function editarTipo(db: Db, id: string, d: Datos) {
  sinCambios(await conErrores(() => db.update(E.tiposTramite).set(camposTipo(d, false)).where(eq(E.tiposTramite.id, id)).run(), "Ya existe un tipo de trámite con ese nombre.", ""));
  return json({ id });
}
export async function borrarTipo(db: Db, id: string) {
  sinCambios(await conErrores(() => db.delete(E.tiposTramite).where(eq(E.tiposTramite.id, id)).run(), "", "No se puede borrar: hay trámites de este tipo. Desactívelo para que no aparezca al crear trámites."));
  return json({ ok: true });
}

// ─── Tarifas ─────────────────────────────────────────────────────────────────

function camposTarifa(d: Datos, nuevo: boolean) {
  const c: Partial<typeof E.tarifas.$inferInsert> = {};
  if (nuevo || "tipoTramiteId" in d) c.tipoTramiteId = textoObligatorio(d.tipoTramiteId, "el tipo de trámite", 64);
  if (nuevo || "organismoId" in d) c.organismoId = texto(d.organismoId, 64);
  for (const [k, n] of [["derechosTransito", "derechos"], ["componenteRunt", "componente RUNT"], ["estampillas", "estampillas"], ["pazSalvo", "paz y salvo"], ["honorarios", "honorarios"]] as const) {
    if (nuevo || k in d) c[k] = pesos(d[k], n);
  }
  if ("vigenteDesde" in d) c.vigenteDesde = fecha(d.vigenteDesde, "vigencia");
  return c;
}
const TARIFA_DUPLICADA = "Ya hay una tarifa para ese trámite y organismo: edite esa.";
export async function crearTarifa(db: Db, d: Datos) {
  const id = nuevoId();
  await conErrores(() => db.insert(E.tarifas).values({ ...(camposTarifa(d, true) as typeof E.tarifas.$inferInsert), id }).run(), TARIFA_DUPLICADA, "El tipo de trámite o el organismo no existe.");
  return json({ id });
}
export async function editarTarifa(db: Db, id: string, d: Datos) {
  sinCambios(await conErrores(() => db.update(E.tarifas).set(camposTarifa(d, false)).where(eq(E.tarifas.id, id)).run(), TARIFA_DUPLICADA, "El tipo de trámite o el organismo no existe."));
  return json({ id });
}
export async function borrarTarifa(db: Db, id: string) {
  sinCambios(await db.delete(E.tarifas).where(eq(E.tarifas.id, id)).run());
  return json({ ok: true });
}

// ─── Organismos ──────────────────────────────────────────────────────────────

function camposOrganismo(d: Datos, nuevo: boolean) {
  const c: Partial<typeof E.organismos.$inferInsert> = {};
  if (nuevo || "nombre" in d) c.nombre = textoObligatorio(d.nombre, "el nombre", 160);
  if ("ciudad" in d) c.ciudad = texto(d.ciudad, 80);
  if ("departamento" in d) c.departamento = texto(d.departamento, 80);
  if ("notas" in d) c.notas = texto(d.notas, 2000);
  if ("activo" in d) c.activo = d.activo !== false;
  return c;
}
export async function crearOrganismo(db: Db, d: Datos) {
  const id = nuevoId();
  await db.insert(E.organismos).values({ ...(camposOrganismo(d, true) as typeof E.organismos.$inferInsert), id }).run();
  return json({ id });
}
export async function editarOrganismo(db: Db, id: string, d: Datos) {
  sinCambios(await db.update(E.organismos).set(camposOrganismo(d, false)).where(eq(E.organismos.id, id)).run());
  return json({ id });
}
export async function borrarOrganismo(db: Db, id: string) {
  sinCambios(await conErrores(() => db.delete(E.organismos).where(eq(E.organismos.id, id)).run(), "", "No se puede borrar: hay trámites o vehículos con este organismo. Desactívelo."));
  return json({ ok: true });
}

// ─── Parámetros ──────────────────────────────────────────────────────────────

const NUMERICOS = new Set(["honorarios_defecto", "smdlv", "uvt", "retefuente_pct"]);

export async function guardarParametro(db: Db, clave: string, d: Datos) {
  if (!/^[a-z0-9_]{2,60}$/.test(clave)) throw new ErrorApi("Nombre de parámetro no válido.");
  const valor = String(d.valor ?? "").slice(0, 10_000);
  if (NUMERICOS.has(clave) && !/^\d+(\.\d+)?$/.test(valor.trim())) throw new ErrorApi("Este parámetro debe ser un número.");
  if (clave === "impuesto_registro_tramos" && !leerTramos(valor).length) throw new ErrorApi('Los tramos deben ser una lista JSON, por ejemplo [{"hasta":57349000,"pct":1.5},{"pct":3.5}].');
  if (clave === "rnmc_activo" && !["true", "false"].includes(valor)) throw new ErrorApi('Debe ser "true" o "false".');
  if (clave === "plantillas_propias") {
    let lista: unknown;
    try { lista = JSON.parse(valor); } catch { /* abajo */ }
    if (!Array.isArray(lista) || lista.some((p) => !p || typeof p !== "object" || !["id", "grupo", "titulo", "texto"].every((k) => typeof (p as Record<string, unknown>)[k] === "string" && String((p as Record<string, unknown>)[k]).trim())))
      throw new ErrorApi("Cada mensaje necesita categoría, título y texto.");
  }
  if (clave.startsWith("envio_") || clave === "plantillas_whatsapp") {
    try { JSON.parse(valor); } catch { throw new ErrorApi("Los datos de envíos no son válidos."); }
  }
  await db
    .insert(E.parametros)
    .values({ clave, valor, descripcion: texto(d.descripcion, 300) })
    .onConflictDoUpdate({ target: E.parametros.clave, set: { valor } })
    .run();
  return json({ clave });
}
