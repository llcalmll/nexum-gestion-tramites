/*
 * Documentos del expediente. El archivo va a R2 (streaming, sin pasar por memoria) y en D1 solo queda la clave.
 *   POST   /api/tramites/:id/documentos     agregar un documento (para subirle el archivo)
 *   PATCH  /api/documentos/:docId           cambiar estado, notas o el nombre ({ nombre }: el del documento y el de su archivo)
 *   DELETE /api/documentos/:docId           quitar de la lista (con su archivo y lo que dejó en la bitácora)
 *   PUT    /api/documentos/:docId/archivo   subir o reemplazar el archivo (cuerpo = el archivo; nombre en X-Nombre-Archivo)
 *   GET    /api/documentos/:docId/archivo   ver o descargar
 *   DELETE /api/documentos/:docId/archivo   quitar el archivo
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { composicionValida } from "../../compartido/composicion";
import { ESTADO_DOC_LABEL, ESTADOS_DOC } from "../../compartido/dominio";
import { DOC_COMPROMISO } from "../../compartido/reglas";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { bitacora, enLista, nuevoId, origen, texto, textoObligatorio, type Datos, type Db } from "../util";

const MAX_BYTES = 20 * 1024 * 1024;
export const TIPOS_ARCHIVO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Las entradas de la bitácora que deja un documento llevan esta referencia (para borrarlas con él). */
const referencia = (docId: string) => `documento:${docId}`;

async function documento(db: Db, docId: string) {
  const d = await db.select().from(E.documentos).where(eq(E.documentos.id, docId)).get();
  if (!d) throw new ErrorApi("El documento no existe.", 404);
  return d;
}

export async function agregarDocumento(db: Db, tramiteId: string, d: Datos) {
  const t = await db.select({ id: E.tramites.id }).from(E.tramites).where(eq(E.tramites.id, tramiteId)).get();
  if (!t) throw new ErrorApi("El trámite no existe.", 404);
  const nombre = textoObligatorio(d.tipoDocumento, "el nombre del documento", 200);
  const id = nuevoId();
  // Sin entrada en la bitácora: lo que cuenta es el archivo, y al subirlo queda anotado ("Archivo subido: ...").
  await db.insert(E.documentos).values({ id, tramiteId, tipoDocumento: nombre, origen: origen(d.origen) }).run();
  return json({ id });
}

export async function editarDocumento(db: Db, docId: string, d: Datos) {
  const doc = await documento(db, docId);
  const c: Partial<typeof E.documentos.$inferInsert> = {};
  if ("estado" in d) c.estado = enLista(d.estado, ESTADOS_DOC, "estado del documento");
  if ("notas" in d) c.notas = texto(d.notas, 1000);
  // El nombre: el del documento y el de su archivo (con su extensión). La carta de compromiso pendiente no se renombra
  // (así no se apaga su alerta sin subirla).
  const nombre = "nombre" in d ? textoObligatorio(d.nombre, "el nombre", 120) : null;
  if (nombre && nombre !== doc.tipoDocumento) {
    if (doc.tipoDocumento === DOC_COMPROMISO && !doc.archivoClave) throw new ErrorApi("La carta de compromiso pendiente no se renombra: súbala firmada.");
    c.tipoDocumento = nombre;
    if (doc.archivoNombre) c.archivoNombre = `${nombre}${/\.[A-Za-z0-9]{1,5}$/.exec(doc.archivoNombre)?.[0] ?? ""}`;
  }
  if ("composicion" in d) {
    c.composicion = d.composicion === null ? null : composicionValida(d.composicion);
    if (d.composicion !== null && !c.composicion) throw new ErrorApi("La receta del consolidado no es válida.");
  }
  // La carta de compromiso sin archivo: «validado» es que la oficina dijo que todo bien (queda anotado quién sabe por qué).
  const cartaSinArchivo = doc.tipoDocumento === DOC_COMPROMISO && !doc.archivoClave;
  const partes = [c.estado && c.estado !== doc.estado ? (cartaSinArchivo && c.estado === "validado" ? `${doc.tipoDocumento}: marcada como todo bien, sin archivo (no se alerta)` : cartaSinArchivo && doc.estado === "validado" ? `${doc.tipoDocumento}: se vuelve a pedir` : `${doc.tipoDocumento}: ${ESTADO_DOC_LABEL[c.estado as keyof typeof ESTADO_DOC_LABEL].toLowerCase()}`) : "", "notas" in d && c.notas !== doc.notas ? `${doc.tipoDocumento}: nota actualizada` : "",
    c.tipoDocumento ? `Documento renombrado: «${doc.tipoDocumento}» → «${c.tipoDocumento}»` : "",
    c.composicion ? `${doc.tipoDocumento}: consolidado de ${c.composicion.partes.length} página${c.composicion.partes.length === 1 ? "" : "s"}${c.composicion.extras.length ? ` y ${c.composicion.extras.length} PDF` : ""}` : ""].filter(Boolean);
  if (!partes.length && !("composicion" in d)) return json({ id: docId });
  if (!partes.length) { await db.update(E.documentos).set(c).where(eq(E.documentos.id, docId)); return json({ id: docId }); }
  await db.batch([db.update(E.documentos).set(c).where(eq(E.documentos.id, docId)), bitacora(db, doc.tramiteId, "documento", partes.join(" · "), { origen: origen(d.origen), referencia: referencia(docId) })]);
  return json({ id: docId });
}

/**
 * Quita el documento con su archivo y, como si no se hubiera pegado nunca (casi siempre es uno puesto por error), lo
 * que dejó en la bitácora: las entradas con su referencia y, de antes de que existiera, las de "Archivo subido: <nombre>
 * (...)" y parecidas, solo si ningún otro documento del trámite se llama igual.
 */
export async function borrarDocumento(db: Db, r2: R2Bucket, docId: string) {
  const doc = await documento(db, docId);
  const [entradas, mismoNombre] = await Promise.all([
    db.select({ id: E.bitacora.id, descripcion: E.bitacora.descripcion, referencia: E.bitacora.referencia }).from(E.bitacora)
      .where(and(eq(E.bitacora.tramiteId, doc.tramiteId), eq(E.bitacora.tipoEvento, "documento"))).all(),
    db.select({ id: E.documentos.id }).from(E.documentos).where(and(eq(E.documentos.tramiteId, doc.tramiteId), eq(E.documentos.tipoDocumento, doc.tipoDocumento), ne(E.documentos.id, docId))).all(),
  ]);
  const n = doc.tipoDocumento;
  const deAntes = (t: string) => t.startsWith(`Archivo subido: ${n} (`) || t.startsWith(`Archivo reemplazado: ${n} (`) || t === `Archivo quitado: ${n}`
    || t.startsWith(`${n}: `) || t.endsWith(` → «${n}»`);
  const suyas = entradas.filter((b) => b.referencia === referencia(docId) || (!b.referencia && !mismoNombre.length && deAntes(b.descripcion ?? ""))).map((b) => b.id);
  await db.batch([
    db.delete(E.documentos).where(eq(E.documentos.id, docId)),
    ...(suyas.length ? [db.delete(E.bitacora).where(inArray(E.bitacora.id, suyas))] : []),
  ]);
  if (doc.archivoClave) await r2.delete(doc.archivoClave);
  return json({ ok: true, entradas: suyas.length });
}

const nombreSeguro = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "archivo";

export async function subirArchivo(db: Db, r2: R2Bucket, docId: string, req: Request) {
  // Si se rechaza, el cuerpo se descarta: dejarlo sin leer rompe la conexión para la siguiente petición.
  // (Los pequeños se leen completos y se descartan; los grandes se cancelan.)
  const rechazar = async (mensaje: string, estado: number) => {
    if (Number(req.headers.get("Content-Length")) <= 1_000_000) await req.arrayBuffer().catch(() => {});
    else await req.body?.cancel().catch(() => {});
    return new ErrorApi(mensaje, estado);
  };
  const doc = await documento(db, docId).catch(async (e) => { throw await rechazar(e.message, e.estado ?? 404); });
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_ARCHIVO[tipo]) throw await rechazar("Solo se aceptan PDF o fotos (JPG, PNG, WEBP, HEIC).", 415);
  const bytes = Number(req.headers.get("Content-Length"));
  if (!bytes || !req.body) throw await rechazar("El archivo está vacío.", 400);
  if (bytes > MAX_BYTES) throw await rechazar("El archivo pesa más de 20 MB.", 413);
  let nombre = "archivo";
  try { nombre = decodeURIComponent(req.headers.get("X-Nombre-Archivo") ?? "archivo").slice(0, 200); } catch { /* nombre por defecto */ }

  const clave = `tramites/${doc.tramiteId}/${docId}/${nuevoId()}-${nombreSeguro(nombre)}`;
  await r2.put(clave, req.body, { httpMetadata: { contentType: tipo } });
  try {
    await db.batch([
      db.update(E.documentos).set({
        archivoClave: clave, archivoNombre: nombre, archivoTipo: tipo, archivoBytes: bytes,
        estado: doc.estado === "pendiente" ? "recibido" : doc.estado,
        // Un archivo nuevo deja sin efecto la receta del consolidado (el escáner la vuelve a guardar al editarlo).
        composicion: null,
      }).where(eq(E.documentos.id, docId)),
      bitacora(db, doc.tramiteId, "documento", `${doc.archivoClave ? "Archivo reemplazado" : "Archivo subido"}: ${doc.tipoDocumento} (${nombre})`, { referencia: referencia(docId) }),
    ]);
  } catch (e) {
    await r2.delete(clave); // que no quede un archivo huérfano
    throw e;
  }
  if (doc.archivoClave) await r2.delete(doc.archivoClave);
  return json({ id: docId, clave });
}

export async function verArchivo(db: Db, r2: R2Bucket, docId: string, url: URL) {
  const doc = await documento(db, docId);
  if (!doc.archivoClave) throw new ErrorApi("Este documento no tiene archivo.", 404);
  const obj = await r2.get(doc.archivoClave);
  if (!obj) throw new ErrorApi("El archivo no se encontró en el almacenamiento.", 404);
  const nombre = doc.archivoNombre ?? "archivo";
  return new Response(obj.body, {
    headers: {
      "Content-Type": doc.archivoTipo ?? "application/octet-stream",
      "Content-Length": String(obj.size),
      "Content-Disposition": `${url.searchParams.has("descargar") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function quitarArchivo(db: Db, r2: R2Bucket, docId: string) {
  const doc = await documento(db, docId);
  if (!doc.archivoClave) return json({ id: docId });
  await db.batch([
    db.update(E.documentos).set({ archivoClave: null, archivoNombre: null, archivoTipo: null, archivoBytes: null }).where(eq(E.documentos.id, docId)),
    bitacora(db, doc.tramiteId, "documento", `Archivo quitado: ${doc.tipoDocumento}`, { referencia: referencia(docId) }),
  ]);
  await r2.delete(doc.archivoClave);
  return json({ id: docId });
}
