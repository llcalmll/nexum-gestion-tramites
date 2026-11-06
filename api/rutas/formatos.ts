/*
 * Formatos propios (los oficiales van fijos en la app, en public/formatos).
 *   GET    /api/formatos                 Lista.
 *   PUT    /api/formatos?nombre=&descripcion=   Sube uno nuevo (el cuerpo es el archivo; X-Nombre-Archivo).
 *   GET    /api/formatos/:id/archivo     Ver (?descargar para bajarlo).
 *   DELETE /api/formatos/:id             Borra el registro y el archivo.
 */
import { desc, eq } from "drizzle-orm";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { nuevoId, texto, type Db } from "../util";

const MAX_BYTES = 20 * 1024 * 1024;
const TIPOS: Record<string, true> = {
  "application/pdf": true,
  "application/msword": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  "application/vnd.ms-excel": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  "image/jpeg": true, "image/png": true, "image/webp": true,
};
const nombreSeguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-120);

export async function listar(db: Db) {
  return json(await db.select().from(E.formatos).orderBy(desc(E.formatos.creado)));
}

export async function subir(db: Db, r2: R2Bucket, req: Request, url: URL) {
  // Si se rechaza, el cuerpo se descarta: dejarlo sin leer rompe la conexión para la siguiente petición.
  const rechazar = async (mensaje: string, estado: number) => {
    if (Number(req.headers.get("Content-Length")) <= 1_000_000) await req.arrayBuffer().catch(() => {});
    else await req.body?.cancel().catch(() => {});
    return new ErrorApi(mensaje, estado);
  };
  const nombre = texto(url.searchParams.get("nombre"), 160);
  if (!nombre) throw await rechazar("Escriba el nombre del formato.", 400);
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS[tipo]) throw await rechazar("Solo se aceptan PDF, Word, Excel o imágenes.", 415);
  const bytes = Number(req.headers.get("Content-Length"));
  if (!bytes || !req.body) throw await rechazar("El archivo está vacío.", 400);
  if (bytes > MAX_BYTES) throw await rechazar("El archivo pesa más de 20 MB.", 413);
  let archivoNombre = "formato";
  try { archivoNombre = decodeURIComponent(req.headers.get("X-Nombre-Archivo") ?? "formato").slice(0, 200); } catch { /* nombre por defecto */ }
  const id = nuevoId();
  const clave = `formatos/${id}-${nombreSeguro(archivoNombre)}`;
  await r2.put(clave, req.body, { httpMetadata: { contentType: tipo } });
  try {
    await db.insert(E.formatos).values({ id, nombre, descripcion: texto(url.searchParams.get("descripcion"), 500), archivoClave: clave, archivoNombre, archivoTipo: tipo, archivoBytes: bytes }).run();
  } catch (e) {
    await r2.delete(clave); // que no quede un archivo huérfano
    throw e;
  }
  return json({ id });
}

export async function ver(db: Db, r2: R2Bucket, id: string, url: URL) {
  const f = await db.select().from(E.formatos).where(eq(E.formatos.id, id)).get();
  if (!f) throw new ErrorApi("El formato no existe.", 404);
  const obj = await r2.get(f.archivoClave);
  if (!obj) throw new ErrorApi("El archivo no se encontró en el almacenamiento.", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": f.archivoTipo,
      "Content-Length": String(obj.size),
      "Content-Disposition": `${url.searchParams.has("descargar") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.archivoNombre)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function borrar(db: Db, r2: R2Bucket, id: string) {
  const f = await db.select().from(E.formatos).where(eq(E.formatos.id, id)).get();
  if (!f) throw new ErrorApi("El formato no existe.", 404);
  await db.delete(E.formatos).where(eq(E.formatos.id, id)).run();
  await r2.delete(f.archivoClave);
  return json({ ok: true });
}
