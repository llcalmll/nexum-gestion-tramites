import { api } from "../datos/api";

/**
 * Las fotos con que se llenan los formatos (la tarjeta y las cédulas): en Llenar formatos se tienen en data URL, se
 * mandan con el borrador y llegan del celular (en vivo o con lo mandado al PC). Ver api/rutas/formatosFotos.ts.
 */
export type DocFormato = "tarjeta" | "propietario" | "comprador";
export type FotosFormato = Partial<Record<DocFormato, string>>;

const aDataUrl = (b: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(r.error); r.readAsDataURL(b); });

/** Una foto guardada (null si no está). */
export async function fotoGuardada(grupo: string, doc: DocFormato): Promise<string | null> {
  try {
    const r = await fetch(`/api/formatos-fotos/${grupo}/${doc}`, { credentials: "same-origin" });
    return r.ok && /^image\//.test(r.headers.get("content-type") ?? "") ? await aDataUrl(await r.blob()) : null;
  } catch { return null; }
}

/** La foto de un documento del trámite (su archivo), si es una imagen. */
export async function fotoDeDocumento(docId: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/documentos/${docId}/archivo`, { credentials: "same-origin" });
    return r.ok && /^image\//.test(r.headers.get("content-type") ?? "") ? await aDataUrl(await r.blob()) : null;
  } catch { return null; }
}

/** Las fotos de un grupo (`docs`: las que tiene, si ya se sabe; si no, se preguntan). */
export async function fotosGuardadas(grupo: string, docs?: DocFormato[]): Promise<FotosFormato> {
  const lista = docs ?? (await api<{ docs: DocFormato[] }>(`/api/formatos-fotos/${grupo}`).catch(() => ({ docs: [] as DocFormato[] }))).docs;
  const fotos: FotosFormato = {};
  await Promise.all(lista.map(async (doc) => { const f = await fotoGuardada(grupo, doc); if (f) fotos[doc] = f; }));
  return fotos;
}

/** Abre una foto (data URL) en grande, en otra pestaña. */
export function verEnGrande(foto: string) {
  const [cab, datos] = foto.split(",");
  const tipo = /data:([^;]+)/.exec(cab)?.[1] ?? "image/jpeg";
  const bin = atob(datos);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
