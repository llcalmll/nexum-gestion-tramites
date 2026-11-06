/*
 * Conversaciones del asistente: quedan guardadas para volver a ellas desde el PC o el celular.
 *
 *   GET    /api/conversaciones        Las de los últimos 30 días, la más reciente primero (sin los mensajes).
 *   GET    /api/conversaciones/:id    Una, con sus mensajes.
 *   PUT    /api/conversaciones/:id    { mensajes } -> la guarda (la crea si no existía). El título es la primera pregunta.
 *   DELETE /api/conversaciones/:id
 *
 * Para que no crezcan sin fin: hasta 120 mensajes por conversación (los últimos) y se borran solas a los 30 días de
 * usadas por última vez (el cron de las 6:30, limpiar()).
 */
import { desc, eq, gte, lt } from "drizzle-orm";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { ahoraIso, type Datos, type Db } from "../util";

export const DIAS_CONVERSACION = 30;
const MAX_MENSAJES = 120;
/** Tope del JSON guardado (son textos; una conversación normal pesa unos pocos KB). */
const MAX_BYTES = 100_000;
const desde = () => new Date(Date.now() - DIAS_CONVERSACION * 10_000_000).toISOString();

export async function listar(db: Db) {
  const filas = await db.select({ id: E.conversaciones.id, titulo: E.conversaciones.titulo, cantidad: E.conversaciones.cantidad, actualizado: E.conversaciones.actualizado })
    .from(E.conversaciones).where(gte(E.conversaciones.actualizado, desde())).orderBy(desc(E.conversaciones.actualizado)).limit(100);
  return json({ conversaciones: filas, dias: DIAS_CONVERSACION });
}

export async function ver(db: Db, id: string) {
  const c = await db.select().from(E.conversaciones).where(eq(E.conversaciones.id, id)).get();
  if (!c) throw new ErrorApi("Esa conversación ya no existe (se borran a los 30 días).", 404);
  return json(c);
}

export async function guardar(db: Db, id: string, d: Datos) {
  const todos = Array.isArray(d.mensajes) ? d.mensajes.filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Datos).texto === "string") : [];
  if (!todos.length) throw new ErrorApi("La conversación está vacía.");
  const mensajes = todos.slice(-MAX_MENSAJES);
  if (JSON.stringify(mensajes).length > MAX_BYTES) throw new ErrorApi("La conversación es demasiado larga para guardarla: empiece una nueva.", 413);
  const primera = String(todos.find((m) => m.rol === "yo")?.texto ?? todos[0].texto).replace(/\s+/g, " ").trim();
  const titulo = primera.length > 80 ? `${primera.slice(0, 79)}…` : primera || "Conversación";
  const ahora = ahoraIso();
  await db.insert(E.conversaciones).values({ id, titulo, mensajes, cantidad: mensajes.length, creado: ahora, actualizado: ahora })
    .onConflictDoUpdate({ target: E.conversaciones.id, set: { mensajes, cantidad: mensajes.length, actualizado: ahora } }).run();
  return json({ id, titulo });
}

export async function borrar(db: Db, id: string) {
  await db.delete(E.conversaciones).where(eq(E.conversaciones.id, id)).run();
  return json({ ok: true });
}

/** Las que no se usan hace más de 30 días (cron de las 6:30). */
export async function limpiar(db: Db) {
  const r = await db.delete(E.conversaciones).where(lt(E.conversaciones.actualizado, desde())).run();
  return { borradas: r.meta.changes ?? 0 };
}
