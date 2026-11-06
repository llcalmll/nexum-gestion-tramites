/*
 * Escaneos: PDF de documentos escaneados con el celular (app "Fotos Pira" → Escanear documentos). El celular arma el
 * PDF y lo manda aquí; el PC los ve, imprime, descarga o los adjunta a un trámite. Viven en R2 (escaneos/) y se borran
 * a los 15 días (cron diario): el que sirve se adjunta al trámite y queda allá para siempre.
 *
 *   PUT    /api/escaneos?nombre=&paginas=&origen=celular|pc|ia&dispositivo=&modo=hoja|tarjeta&escala=   El cuerpo es el PDF.
 *   PUT    /api/escaneos/:id?nombre=&paginas=&modo=&escala=  Lo reemplaza (editado en el PC): el mismo, con su origen.
 *   GET    /api/escaneos                         Lista, el más nuevo primero (de dónde vino, cuándo, si se editó).
 *   GET    /api/escaneos/:id                     El PDF (?descargar para bajarlo).
 *   PATCH  /api/escaneos/:id                     { nombre } -> le cambia el nombre (el del PDF al descargarlo).
 *   DELETE /api/escaneos/:id
 *   POST   /api/escaneos/:id/adjuntar            { tramiteId, documentoId? | tipoDocumento? } -> lo pega a ese documento.
 */
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos, type Db } from "../util";
import { agregarDocumento, subirArchivo } from "./documentos";

export const ESCANEO = "([a-z0-9-]{8,64})";
const MAX_BYTES = 25 * 1024 * 1024;
const DIAS_VIDA = 15;
const clave = (id: string) => `escaneos/${id}.pdf`;
const limpiarNombre = (s: string | null) => (s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 120) || "Escaneo";

/** Lo que se guarda de cómo se hizo: cédula/tarjeta u hojas y el tamaño en la hoja (para volver a editarlo igual). */
function forma(url: URL) {
  const modo = url.searchParams.get("modo");
  const escala = url.searchParams.get("escala");
  return { ...(modo === "hoja" || modo === "tarjeta" ? { modo } : {}), ...(escala === "1" || escala === "1.5" ? { escala } : {}) };
}
const paginasDe = (url: URL) => String(Math.max(1, Math.min(200, Number(url.searchParams.get("paginas")) || 1)));

/** El PDF que llega (revisado: tipo, que no esté vacío, el peso). */
async function pdfDe(req: Request) {
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = Number(req.headers.get("Content-Length"));
  const descartar = async () => { if (bytes <= 1_000_000) await req.arrayBuffer().catch(() => {}); else await req.body?.cancel().catch(() => {}); };
  if (tipo !== "application/pdf") { await descartar(); throw new ErrorApi("El escaneo debe llegar como PDF.", 415); }
  if (!bytes || !req.body) { await descartar(); throw new ErrorApi("El escaneo está vacío.", 400); }
  if (bytes > MAX_BYTES) { await descartar(); throw new ErrorApi("El escaneo pesa más de 25 MB: envíelo en partes.", 413); }
  return req.body;
}

export async function subir(r2: R2Bucket, req: Request, url: URL) {
  const cuerpo = await pdfDe(req);
  const id = nuevoId().toLowerCase();
  const nombre = limpiarNombre(url.searchParams.get("nombre"));
  // De dónde vino (el celular, con su modelo, o el PC) y cuándo: para decir "Recibido desde el celular (iPhone) a las...".
  const origen = ["celular", "pc", "ia"].includes(url.searchParams.get("origen") ?? "") ? String(url.searchParams.get("origen")) : "";
  const dispositivo = (url.searchParams.get("dispositivo") ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 60);
  await r2.put(clave(id), cuerpo, { httpMetadata: { contentType: "application/pdf" }, customMetadata: {
    nombre: encodeURIComponent(nombre), paginas: paginasDe(url), subido: new Date().toISOString(),
    ...(origen ? { origen } : {}), ...(dispositivo ? { dispositivo: encodeURIComponent(dispositivo) } : {}), ...forma(url),
  } });
  return json({ id, nombre });
}

/** Editado en el PC: el PDF nuevo en el mismo escaneo; de dónde vino y cuándo llegó se conservan, y se anota cuándo se editó. */
export async function reemplazar(r2: R2Bucket, id: string, req: Request, url: URL) {
  const o = await r2.head(clave(id));
  if (!o) { await req.body?.cancel().catch(() => {}); throw new ErrorApi("El escaneo ya no está (se borran a los 15 días).", 404); }
  const cuerpo = await pdfDe(req);
  const nombre = url.searchParams.has("nombre") ? limpiarNombre(url.searchParams.get("nombre")) : nombreDe(o) || "Escaneo";
  await r2.put(clave(id), cuerpo, { httpMetadata: { contentType: "application/pdf" }, customMetadata: {
    ...o.customMetadata, nombre: encodeURIComponent(nombre), paginas: paginasDe(url), subido: subidoDe(o).toISOString(), editado: new Date().toISOString(), ...forma(url),
  } });
  return json({ id, nombre });
}

/** Cuándo llegó: al renombrar, R2 lo vuelve a escribir, así que la fecha original se guarda aparte. */
const subidoDe = (o: R2Object) => { const t = Date.parse(o.customMetadata?.subido ?? ""); return Number.isNaN(t) ? o.uploaded : new Date(t); };
const decodificar = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
const nombreDe = (o: R2Object) => decodificar(o.customMetadata?.nombre ?? "");

export async function listar(r2: R2Bucket) {
  const l = await r2.list({ prefix: "escaneos/", limit: 500, include: ["customMetadata"] });
  const escaneos = l.objects
    .map((o) => {
      const m = o.customMetadata ?? {};
      return {
        id: o.key.slice(9, -4), nombre: nombreDe(o) || "Escaneo", paginas: Number(m.paginas) || 1, bytes: o.size, subido: subidoDe(o).toISOString(),
        origen: m.origen ?? null, dispositivo: m.dispositivo ? decodificar(m.dispositivo) : null, modo: m.modo ?? null, escala: m.escala ? Number(m.escala) : null, editado: m.editado ?? null,
      };
    })
    .sort((a, b) => b.subido.localeCompare(a.subido));
  return json({ escaneos, diasVida: DIAS_VIDA });
}

export async function ver(r2: R2Bucket, id: string, url: URL) {
  const o = await r2.get(clave(id));
  if (!o) throw new ErrorApi("El escaneo ya no está (se borran a los 15 días).", 404);
  const nombre = `${nombreDe(o) || "escaneo"}.pdf`;
  return new Response(o.body, {
    headers: {
      "Content-Type": "application/pdf", "Content-Length": String(o.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${url.searchParams.has("descargar") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    },
  });
}

export async function renombrar(r2: R2Bucket, id: string, d: Datos) {
  const nombre = limpiarNombre(typeof d.nombre === "string" ? d.nombre : null);
  if (typeof d.nombre !== "string" || !d.nombre.trim()) throw new ErrorApi("Escriba el nombre.");
  const o = await r2.get(clave(id));
  if (!o) throw new ErrorApi("El escaneo ya no está (se borran a los 15 días).", 404);
  // R2 no cambia los metadatos sin reescribir el archivo: se vuelve a guardar igual, con el nombre nuevo.
  await r2.put(clave(id), await o.arrayBuffer(), { httpMetadata: { contentType: "application/pdf" }, customMetadata: { ...o.customMetadata, nombre: encodeURIComponent(nombre), subido: subidoDe(o).toISOString() } });
  return json({ id, nombre });
}

export async function borrar(r2: R2Bucket, id: string) {
  await r2.delete(clave(id));
  return json({ ok: true });
}

/** Pega el escaneo a un documento del trámite (el que se elija, o uno nuevo con ese nombre). */
export async function adjuntar(db: Db, r2: R2Bucket, id: string, d: Datos) {
  const o = await r2.get(clave(id));
  if (!o) throw new ErrorApi("El escaneo ya no está (se borran a los 15 días).", 404);
  const tramiteId = String(d.tramiteId ?? "");
  if (!tramiteId) { await o.body.cancel(); throw new ErrorApi("Elija el trámite."); }
  let docId = typeof d.documentoId === "string" && d.documentoId ? d.documentoId : "";
  if (!docId) {
    const tipoDocumento = String(d.tipoDocumento ?? "").trim() || nombreDe(o) || "Documento escaneado";
    const r = await agregarDocumento(db, tramiteId, { tipoDocumento, origen: "manual" });
    if (!r.ok) { await o.body.cancel(); throw new ErrorApi(String(((await r.json()) as Datos).error ?? "No se pudo crear el documento."), r.status); }
    docId = String(((await r.json()) as Datos).id);
  }
  const nombre = `${nombreDe(o) || "escaneo"}.pdf`;
  const req = new Request("https://interno/subir", { method: "PUT", headers: { "Content-Type": "application/pdf", "Content-Length": String(o.size), "X-Nombre-Archivo": encodeURIComponent(nombre) }, body: o.body });
  const r = await subirArchivo(db, r2, docId, req);
  if (!r.ok) throw new ErrorApi(String(((await r.json()) as Datos).error ?? "No se pudo adjuntar."), r.status);
  return json({ ok: true, documentoId: docId });
}

/** Cron diario: borra los escaneos de más de 15 días. */
export async function limpiar(r2: R2Bucket) {
  const limite = Date.now() - DIAS_VIDA * 10_000_000;
  const l = await r2.list({ prefix: "escaneos/", limit: 1000, include: ["customMetadata"] });
  const viejos = l.objects.filter((o) => subidoDe(o).getTime() < limite).map((o) => o.key);
  if (viejos.length) await r2.delete(viejos);
  return { borrados: viejos.length };
}
