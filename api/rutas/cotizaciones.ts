/*
 * Cotizaciones guardadas del asistente (pestaña "Cotizaciones").
 *
 *   GET    /api/cotizaciones              Las últimas 200, la más nueva primero.
 *   POST   /api/cotizaciones              { titulo, tramite?, total?, texto, origen?, datos? } -> { id }
 *   PATCH  /api/cotizaciones/:id          { titulo?, texto?, total? }  (lo editado en la cotización del asistente)
 *   DELETE /api/cotizaciones/:id          (con sus tarjetas)
 *   GET    /api/cotizaciones/:id/tarjetas            -> { tarjetas: [{ n, placa }] }  Las vistas previas de las tarjetas.
 *   PUT    /api/cotizaciones/:id/tarjetas/:n?placa=  La tarjeta n (0-9) recortada, JPEG (el cuerpo es la imagen).
 *   GET    /api/cotizaciones/:id/tarjetas/:n         La imagen.
 *
 * Las de fotos de tarjetas las guarda solas POST /api/cotizar (asistente.ts); la app sube después la vista previa de
 * cada tarjeta (recortada en el navegador, logica/recorteTarjeta.ts) a R2: cotizaciones/<id>/<n>.jpg.
 */
import { desc, eq } from "drizzle-orm";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { nuevoId, texto, textoObligatorio, type Datos, type Db } from "../util";

export async function listar(db: Db) {
  const filas = await db.select().from(E.cotizaciones).orderBy(desc(E.cotizaciones.creado)).limit(200);
  return json({ cotizaciones: filas.map(({ datos: _d, ...c }) => c) });
}

export async function guardar(db: Db, d: Datos) {
  const id = nuevoId();
  await db.insert(E.cotizaciones).values({
    id, titulo: textoObligatorio(d.titulo, "el título", 160), tramite: texto(d.tramite, 120), total: Math.max(0, Math.round(Number(d.total) || 0)),
    texto: textoObligatorio(d.texto, "la cotización", 10_000), origen: d.origen === "asistente" ? "asistente" : "fotos", datos: d.datos ?? null,
  }).run();
  return json({ id });
}

export async function renombrar(db: Db, id: string, d: Datos) {
  const c: Partial<typeof E.cotizaciones.$inferInsert> = {};
  if ("titulo" in d) c.titulo = textoObligatorio(d.titulo, "el título", 160);
  if ("texto" in d) c.texto = textoObligatorio(d.texto, "la cotización", 10_000);
  if ("total" in d) c.total = Math.max(0, Math.round(Number(d.total) || 0));
  if (!Object.keys(c).length) throw new ErrorApi("No hay nada que cambiar.");
  const r = await db.update(E.cotizaciones).set(c).where(eq(E.cotizaciones.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("La cotización no existe.", 404);
  return json({ id });
}

export async function borrar(db: Db, r2: R2Bucket, id: string) {
  await db.delete(E.cotizaciones).where(eq(E.cotizaciones.id, id)).run();
  const l = await r2.list({ prefix: `cotizaciones/${id}/`, limit: 20 });
  if (l.objects.length) await r2.delete(l.objects.map((o) => o.key));
  return json({ ok: true });
}

const MAX_TARJETA = 2 * 1024 * 1024;

export async function subirTarjeta(db: Db, r2: R2Bucket, id: string, n: string, req: Request) {
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = Number(req.headers.get("Content-Length"));
  if (tipo !== "image/jpeg") throw new ErrorApi("La tarjeta debe ser JPG.", 415);
  if (!bytes || !req.body) throw new ErrorApi("La imagen está vacía.");
  if (bytes > MAX_TARJETA) throw new ErrorApi("La imagen de la tarjeta pesa demasiado.", 413);
  const [c] = await db.select({ id: E.cotizaciones.id }).from(E.cotizaciones).where(eq(E.cotizaciones.id, id)).limit(1);
  if (!c) throw new ErrorApi("La cotización no existe.", 404);
  const placa = (new URL(req.url).searchParams.get("placa") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  await r2.put(`cotizaciones/${id}/${n}.jpg`, req.body, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { placa } });
  return json({ n: Number(n) });
}

export async function tarjetas(r2: R2Bucket, id: string) {
  const l = await r2.list({ prefix: `cotizaciones/${id}/`, limit: 20, include: ["customMetadata"] });
  const lista = l.objects.map((o) => ({ n: Number(o.key.slice(`cotizaciones/${id}/`.length).replace(/\.jpg$/, "")), placa: o.customMetadata?.placa || null }))
    .filter((t) => Number.isInteger(t.n)).sort((a, b) => a.n - b.n);
  return json({ tarjetas: lista });
}

export async function verTarjeta(r2: R2Bucket, id: string, n: string) {
  const o = await r2.get(`cotizaciones/${id}/${n}.jpg`);
  if (!o) throw new ErrorApi("Esta cotización no tiene esa tarjeta.", 404);
  return new Response(o.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
