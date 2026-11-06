import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as E from "../../compartido/esquema";
import type { RespuestaCambios } from "../../compartido/tipos";
import { json } from "../http";

/** Tablas que se copian al navegador (nombre en la base -> tabla de Drizzle). */
const TABLAS = {
  clientes: E.clientes,
  organismos: E.organismos,
  tipos_tramite: E.tiposTramite,
  tarifas: E.tarifas,
  parametros: E.parametros,
  vehiculos: E.vehiculos,
  vehiculo_personas: E.vehiculoPersonas,
  tramites: E.tramites,
  tramite_personas: E.tramitePersonas,
  documentos: E.documentos,
  pagos: E.pagos,
  bitacora: E.bitacora,
  licencias: E.licencias,
  recordatorios: E.recordatorios,
  wa_chats: E.waChats,
  wa_propuestas: E.waPropuestas,
  envios: E.envios,
  notas: E.notas,
} satisfies Record<E.TablaSincronizada, unknown>;

/**
 * Filas por respuesta (en total, entre todas las tablas). Para no pasarse de los 10 ms de CPU del plan gratis,
 * primero se leen solo los números de versión (índice, barato) y con eso se decide el corte; después se traen
 * completas únicamente las filas que caben. Así cada respuesta va llena y la primera descarga toma pocas vueltas.
 */
const POR_RESPUESTA = 300;

export const versionActual = async (db: DrizzleD1Database) =>
  (await db.select({ v: E.contador.version }).from(E.contador).where(eq(E.contador.id, 1)).get())?.v ?? 0;

/**
 * GET /api/cambios?v=N
 * Devuelve lo que cambió después de la versión N, hasta POR_RESPUESTA filas. Si nada cambió, cuesta una sola lectura.
 * `version` es hasta dónde llega esta respuesta; `ultima`, la versión actual del servidor (para mostrar el avance).
 */
export async function cambios(db: DrizzleD1Database, url: URL): Promise<Response> {
  const desde = Math.max(0, Math.floor(Number(url.searchParams.get("v")) || 0));
  const actual = await versionActual(db);
  if (desde >= actual) return json({ version: actual, ultima: actual, cambios: {}, eliminados: [], mas: false } satisfies RespuestaCambios);

  const nombres = Object.keys(TABLAS) as E.TablaSincronizada[];
  const fuentes = [E.eliminados, ...nombres.map((n) => TABLAS[n])];

  // 1) Solo versiones: dónde cortar. Un viaje a la base, en una sola transacción.
  const versiones = (await db.batch([
    db.select({ v: E.contador.version }).from(E.contador).where(eq(E.contador.id, 1)),
    ...fuentes.map((t) => db.select({ v: t.version }).from(t).where(gt(t.version, desde)).orderBy(asc(t.version)).limit(POR_RESPUESTA)),
  ])) as { v: number }[][];
  const ultima = versiones[0][0]?.v ?? actual;
  const listas = versiones.slice(1).map((filas) => filas.map((f) => f.v));
  // Si una lista llegó llena, puede haber más después de su última versión: no se pasa de ahí.
  let hasta = ultima;
  for (const l of listas) if (l.length === POR_RESPUESTA) hasta = Math.min(hasta, l[l.length - 1]);
  const todas = listas.flat().filter((v) => v <= hasta).sort((a, b) => a - b);
  if (todas.length > POR_RESPUESTA) hasta = todas[POR_RESPUESTA - 1];

  // 2) Las filas completas, solo de las tablas que tienen algo en (desde, hasta].
  const conDatos = fuentes.map((_, i) => listas[i].some((v) => v <= hasta));
  const consultas = fuentes.flatMap((t, i) => (conDatos[i] ? [db.select().from(t).where(and(gt(t.version, desde), lte(t.version, hasta)))] : []));
  const lote = (consultas.length ? await db.batch(consultas as [typeof consultas[number], ...typeof consultas]) : []) as Record<string, unknown>[][];

  const respuesta: RespuestaCambios = { version: hasta, ultima, cambios: {}, eliminados: [], mas: hasta < ultima };
  let k = 0;
  fuentes.forEach((_, i) => {
    if (!conDatos[i]) return;
    const filas = lote[k++];
    if (i === 0) respuesta.eliminados = (filas as (typeof E.eliminados.$inferSelect)[]).map((f) => ({ tabla: f.tabla, registroId: f.registroId }));
    else if (filas.length) respuesta.cambios[nombres[i - 1]] = filas;
  });
  return json(respuesta);
}
