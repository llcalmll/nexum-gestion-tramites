/*
 * Las fotos con que se llenaron los formatos (la tarjeta de propiedad y las cédulas): las que manda el celular (en vivo
 * o al mandar al PC) y las de un borrador. Se ven en Llenar formatos (miniatura y en grande) y, al anotar el trámite
 * desde ahí, quedan en sus archivos. En R2: formatos-fotos/<grupo>/<doc>.jpg.
 *   grupo: vivo-<id> | celular-<id> | borrador-<id>     doc: tarjeta | propietario | comprador
 *   GET /api/formatos-fotos/:grupo           -> { docs: [...] } (las que tiene)
 *   GET /api/formatos-fotos/:grupo/:doc      la foto
 *   DELETE /api/formatos-fotos/:grupo        la copia que ya no hace falta
 * Las demás rutas las guardan con lo suyo (POST /api/formatos-vivo, /api/formatos-celular y los borradores traen
 * `fotos: { doc: dataURL }`). Se borran con lo suyo y, si no, en el cron: las del celular a los 15 días; las de un
 * borrador, cuando el borrador ya no está.
 * Con un trámite, las fotos son sus ARCHIVOS (un solo sitio, sin copias):
 *   GET  /api/tramites/:id/fotos-formatos     qué documentos son la tarjeta y las cédulas (con foto)
 *   POST /api/tramites/:id/fotos-formatos     { doc, foto }: la pone en su documento (lo crea o le cambia el archivo)
 */
import { desc, eq } from "drizzle-orm";
import { normalizar } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import type { Datos, Db } from "../util";
import { agregarDocumento, subirArchivo } from "./documentos";

export const GRUPO = "((?:vivo|celular|borrador)-[A-Za-z0-9-]{8,64})";
export const DOC = "(tarjeta|propietario|comprador)";
const DOCS = ["tarjeta", "propietario", "comprador"] as const;
type Doc = (typeof DOCS)[number];
const PREFIJO = "formatos-fotos/";
const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const clave = (grupo: string, doc: string) => `${PREFIJO}${grupo}/${doc}`;

/** Una foto en data URL (como la arma el navegador) -> bytes y tipo. Null si no es una foto válida. */
function deDataUrl(v: unknown): { bytes: Uint8Array; tipo: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v ?? ""));
  if (!m) return null;
  const bin = atob(m[2]);
  if (bin.length > MAX_BYTES) throw new ErrorApi("La foto pesa más de 8 MB.", 413);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, tipo: m[1] };
}

/**
 * Guarda las fotos que trae un envío (`{ tarjeta?: dataURL, ... }`) en su grupo; `quitar`: las que ya no van (se
 * cambió o se quitó la foto). Lo que no es una foto válida se ignora.
 */
export async function guardarFotos(r2: R2Bucket, grupo: string, fotos: unknown, quitar: unknown = []) {
  const f = fotos && typeof fotos === "object" && !Array.isArray(fotos) ? (fotos as Record<string, unknown>) : {};
  for (const doc of DOCS) {
    const foto = deDataUrl(f[doc]);
    if (foto) await r2.put(clave(grupo, doc), foto.bytes, { httpMetadata: { contentType: foto.tipo } });
  }
  const fuera = (Array.isArray(quitar) ? quitar : []).filter((d): d is Doc => (DOCS as readonly string[]).includes(String(d)));
  if (fuera.length) await r2.delete(fuera.map((d) => clave(grupo, d)));
}

/** Los documentos que tienen foto en el grupo. */
export async function docsDe(r2: R2Bucket, grupo: string): Promise<Doc[]> {
  const l = await r2.list({ prefix: `${PREFIJO}${grupo}/` });
  return l.objects.map((o) => o.key.slice(`${PREFIJO}${grupo}/`.length) as Doc).filter((d) => (DOCS as readonly string[]).includes(d));
}

export async function listar(r2: R2Bucket, grupo: string) {
  return json({ docs: await docsDe(r2, grupo) });
}

export async function ver(r2: R2Bucket, grupo: string, doc: string) {
  const o = await r2.get(clave(grupo, doc));
  if (!o) throw new ErrorApi("Esa foto ya no está.", 404);
  const tipo = o.httpMetadata?.contentType ?? "image/jpeg";
  return new Response(o.body, { headers: { "Content-Type": tipo, "Content-Length": String(o.size), "Content-Disposition": `inline; filename="${doc}.${TIPOS[tipo] ?? "jpg"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

// ─── Con un trámite: las fotos son sus archivos (un solo sitio) ───────────────────────────────────────────────────

/** El documento del trámite de cada foto: el mismo que usa el registrador (movil.ts, pegarFotos). */
const REGLA: Record<Doc, { buscar: string[]; evitar?: string[] }> = {
  tarjeta: { buscar: ["tarjeta de propiedad", "licencia de transito"] },
  propietario: { buscar: ["cedula del vendedor", "cedula del propietario", "cedula del titular", "cedula"], evitar: ["comprador"] },
  comprador: { buscar: ["cedula del comprador"] },
};
type DocTramite = typeof E.documentos.$inferSelect;
function documentoDe(docs: DocTramite[], doc: Doc, conArchivo: boolean) {
  const r = REGLA[doc];
  for (const palabra of r.buscar) {
    const d = docs.find((x) => (!conArchivo || (x.archivoClave && /^image\//.test(x.archivoTipo ?? ""))) && normalizar(x.tipoDocumento).includes(palabra) && !r.evitar?.some((e) => normalizar(x.tipoDocumento).includes(e)));
    if (d) return d;
  }
  return undefined;
}

/** GET /api/tramites/:id/fotos-formatos -> { tarjeta?: docId, propietario?: docId, comprador?: docId } (las que son foto). */
export async function fotosDelTramite(db: Db, tramiteId: string) {
  const docs = await db.select().from(E.documentos).where(eq(E.documentos.tramiteId, tramiteId)).orderBy(desc(E.documentos.actualizado));
  return json(Object.fromEntries(DOCS.map((d) => [d, documentoDe(docs, d, true)?.id]).filter(([, id]) => id)));
}

/**
 * POST /api/tramites/:id/fotos-formatos { doc, foto }: la foto puesta en Llenar formatos queda en el documento del
 * trámite (el que ya está, aunque tenga archivo: se reemplaza; si no hay, se crea con el nombre de siempre).
 */
export async function adjuntarAlTramite(db: Db, r2: R2Bucket, tramiteId: string, d: Datos) {
  const doc = String(d.doc ?? "") as Doc;
  if (!DOCS.includes(doc)) throw new ErrorApi("No se sabe de qué documento es la foto.");
  const foto = deDataUrl(d.foto);
  if (!foto) throw new ErrorApi("La foto no es válida.");
  const t = await db.select({ tipo: E.tiposTramite.nombre }).from(E.tramites).innerJoin(E.tiposTramite, eq(E.tiposTramite.id, E.tramites.tipoId)).where(eq(E.tramites.id, tramiteId)).get();
  if (!t) throw new ErrorApi("El trámite no existe.", 404);
  const docs = await db.select().from(E.documentos).where(eq(E.documentos.tramiteId, tramiteId)).orderBy(desc(E.documentos.actualizado));
  const nombre = doc === "tarjeta" ? "Fotocopia de la tarjeta de propiedad" : doc === "comprador" ? "Fotocopia de la cédula del comprador" : /traspaso/i.test(t.tipo) ? "Fotocopia de la cédula del vendedor" : "Fotocopia de la cédula";
  const docId = documentoDe(docs, doc, false)?.id ?? String(((await (await agregarDocumento(db, tramiteId, { tipoDocumento: nombre })).json()) as { id: string }).id);
  const archivo = `${(docs.find((x) => x.id === docId)?.tipoDocumento ?? nombre).replace(/^Fotocopia de la /, "")}.${TIPOS[foto.tipo] ?? "jpg"}`;
  const req = new Request("https://interno/subir", { method: "PUT", headers: { "Content-Type": foto.tipo, "Content-Length": String(foto.bytes.length), "X-Nombre-Archivo": encodeURIComponent(archivo) }, body: foto.bytes });
  await subirArchivo(db, r2, docId, req);
  return json({ docId });
}

/** DELETE /api/formatos-fotos/:grupo: la copia que ya no hace falta (la foto quedó en el trámite o en el borrador). */
export async function quitarGrupo(r2: R2Bucket, grupo: string) {
  await borrarGrupo(r2, grupo);
  return json({ ok: true });
}

/** Borra todas las fotos de un grupo (se borró el borrador o el envío). */
export async function borrarGrupo(r2: R2Bucket, grupo: string) {
  const l = await r2.list({ prefix: `${PREFIJO}${grupo}/` });
  if (l.objects.length) await r2.delete(l.objects.map((o) => o.key));
}

/**
 * Cron diario: las del celular (en vivo o mandadas) de más de 15 días; las de un borrador que ya no está (los
 * borradores se borran a los 5 días de su último guardado, y sus fotos se quedan mientras él esté).
 */
export async function limpiar(r2: R2Bucket) {
  const limite = Date.now() - 15 * 10_000_000;
  const borradores = new Set((await r2.list({ prefix: "formatos-borradores/" })).objects.map((o) => o.key.slice("formatos-borradores/".length, -".json".length)));
  const viejas: string[] = [];
  let cursor: string | undefined;
  do {
    const l = await r2.list({ prefix: PREFIJO, cursor });
    for (const o of l.objects) {
      const grupo = o.key.slice(PREFIJO.length).split("/")[0];
      if (grupo.startsWith("borrador-") ? !borradores.has(grupo.slice("borrador-".length)) : o.uploaded.getTime() < limite) viejas.push(o.key);
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < viejas.length; i += 1000) await r2.delete(viejas.slice(i, i + 1000));
  return viejas.length;
}
