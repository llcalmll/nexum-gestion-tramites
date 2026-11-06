/*
 * Formatos en vivo: el celular (Formatos) manda cada foto que lee (lo leído y la foto, que va a formatos-fotos/vivo-<id>)
 * y Llenar formatos, abierto en el PC, lo recoge a los pocos segundos y lo pone en el formulario, con la foto, como si se
 * hubiera tomado ahí. El primer
 * PC que lo toma se lo queda (si hay dos abiertos, no se llena en los dos). Lo no tomado se ignora pasada la media hora y
 * se borra al día siguiente (cron).
 *
 *   POST /api/formatos-vivo                 { doc: tarjeta | propietario | comprador, datos, foto? } -> { id }
 *   GET  /api/formatos-vivo?desde=ISO       Lo pendiente desde esa hora (y de la última media hora), el más viejo primero.
 *   POST /api/formatos-vivo/:id/tomar       -> { tomado: true } si este PC se lo quedó; false si ya lo tomó otro.
 *   GET  /api/formatos-vivo/:id             -> { tomado: boolean } (el celular sabe si ya llegó al PC)
 */
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos, type Db } from "../util";
import { guardarFotos } from "./formatosFotos";

const DOCS = ["tarjeta", "propietario", "comprador"];
const MAX_BYTES = 10_000;
const MEDIA_HORA = 30 * 10_000;
const ahoraMenos = (ms: number) => new Date(Date.now() - ms).toISOString();

export async function mandar(db: Db, r2: R2Bucket, d: Datos) {
  const doc = String(d.doc ?? "");
  if (!DOCS.includes(doc)) throw new ErrorApi("No se sabe de qué documento es la foto.");
  const datos = d.datos;
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new ErrorApi("Faltan los datos leídos.");
  if (JSON.stringify(datos).length > MAX_BYTES) throw new ErrorApi("Los datos son demasiado grandes.", 413);
  const id = nuevoId();
  // La foto primero: cuando el PC tome lo leído, ya está para verla (formatos-fotos/vivo-<id>).
  if (d.foto) await guardarFotos(r2, `vivo-${id}`, { [doc]: d.foto });
  await db.insert(E.formatosVivo).values({ id, doc, datos: datos as Record<string, unknown> });
  return json({ id });
}

export async function pendientes(db: Db, url: URL) {
  const pedido = url.searchParams.get("desde") ?? "";
  const minimo = ahoraMenos(MEDIA_HORA);
  const desde = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(pedido) && pedido > minimo ? pedido : minimo;
  const filas = await db.select().from(E.formatosVivo)
    .where(and(isNull(E.formatosVivo.tomado), gt(E.formatosVivo.creado, desde)))
    .orderBy(asc(E.formatosVivo.creado)).limit(20).all();
  return json({ lecturas: filas.map((f) => ({ id: f.id, doc: f.doc, datos: f.datos, creado: f.creado })), ahora: new Date().toISOString() });
}

export async function tomar(db: Db, id: string) {
  const r = await db.update(E.formatosVivo).set({ tomado: new Date().toISOString() }).where(and(eq(E.formatosVivo.id, id), isNull(E.formatosVivo.tomado))).run();
  return json({ tomado: (r.meta.changes ?? 0) > 0 });
}

export async function estado(db: Db, id: string) {
  const f = await db.select({ tomado: E.formatosVivo.tomado }).from(E.formatosVivo).where(eq(E.formatosVivo.id, id)).get();
  if (!f) throw new ErrorApi("Esa lectura ya no está.", 404);
  return json({ tomado: !!f.tomado });
}

/** Cron diario: lo de más de un día. */
export async function limpiar(db: Db) {
  const r = await db.delete(E.formatosVivo).where(lt(E.formatosVivo.creado, ahoraMenos(10_000_000))).run();
  return { borradas: r.meta.changes ?? 0 };
}
