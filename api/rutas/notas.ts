/*
 * Noticas: notas rápidas y tareas del día (botón de la barra de arriba, junto a la fecha, en cualquier pantalla).
 *   POST   /api/notas        { texto, color?, fijada?, destacada? }     -> { id }
 *   PATCH  /api/notas/:id    { texto?, color?, fijada?, destacada?, hecha? }        (hecha pone la hora en que se hizo)
 *   DELETE /api/notas/:id
 * Las hechas se borran solas a los 7 días (cron diario).
 */
import { and, eq, lt } from "drizzle-orm";
import { COLORES_NOTA } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { enLista, nuevoId, textoObligatorio, type Datos, type Db } from "../util";

const DIAS_HECHAS = 7;

export async function crearNota(db: Db, d: Datos) {
  const id = nuevoId();
  await db.insert(E.notas).values({
    id, texto: textoObligatorio(d.texto, "el texto de la notica", 1000),
    color: d.color ? enLista(d.color, COLORES_NOTA, "color") : "amarillo", fijada: d.fijada === true, destacada: d.destacada === true,
  }).run();
  return json({ id });
}

export async function editarNota(db: Db, id: string, d: Datos) {
  const c: Partial<typeof E.notas.$inferInsert> = {};
  if ("texto" in d) c.texto = textoObligatorio(d.texto, "el texto de la notica", 1000);
  if ("color" in d) c.color = enLista(d.color, COLORES_NOTA, "color");
  if ("fijada" in d) c.fijada = d.fijada === true;
  if ("destacada" in d) c.destacada = d.destacada === true;
  if ("hecha" in d) { c.hecha = d.hecha === true; c.hechaEn = d.hecha === true ? new Date().toISOString() : null; }
  if (!Object.keys(c).length) throw new ErrorApi("No hay nada que cambiar.");
  const r = await db.update(E.notas).set(c).where(eq(E.notas.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("La notica ya no existe.", 404);
  return json({ id });
}

export async function borrarNota(db: Db, id: string) {
  await db.delete(E.notas).where(eq(E.notas.id, id)).run();
  return json({ ok: true });
}

/** Cron diario: las hechas hace más de 7 días. */
export async function limpiar(db: Db) {
  const limite = new Date(Date.now() - DIAS_HECHAS * 10_000_000).toISOString();
  const r = await db.delete(E.notas).where(and(eq(E.notas.hecha, true), lt(E.notas.hechaEn, limite))).run();
  return { borradas: r.meta.changes ?? 0 };
}
