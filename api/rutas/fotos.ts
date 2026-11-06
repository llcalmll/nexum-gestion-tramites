/*
 * Fotos 3x4: el celular toma la foto y el PC la recibe para quitar el fondo e imprimir la hoja.
 * Las fotos solo pasan por aquí (R2, carpeta fotos/<sesión>/) y se borran a las 48 horas (cron diario).
 *
 *   POST   /api/fotos/sesiones                   Sesión nueva: { sesion } (va en el QR que muestra el PC).
 *   PUT    /api/fotos/sesiones/:sesion           El celular sube una foto (JPEG, PNG o WEBP; el cuerpo es la imagen).
 *   GET    /api/fotos/sesiones/:sesion           Fotos de la sesión, la más nueva primero.
 *   GET    /api/fotos/sesiones/:sesion/:foto     La imagen.
 *   DELETE /api/fotos/sesiones/:sesion/:foto     Borra una foto (ya se imprimió o no sirve).
 *   DELETE /api/fotos/sesiones/:sesion           Borra todas las fotos de la sesión.
 */
import { ErrorApi, json } from "../http";

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const HORAS_VIDA = 48;
export const SESION = "([a-z0-9]{16})";
export const FOTO = "([0-9]{13}-[a-z0-9]{6}\\.(?:jpg|png|webp))";

const aleatorio = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export function crearSesion() {
  return json({ sesion: aleatorio(16) });
}

export async function subir(r2: R2Bucket, sesion: string, req: Request) {
  const rechazar = async (mensaje: string, estado: number) => {
    if (Number(req.headers.get("Content-Length")) <= 1_000_000) await req.arrayBuffer().catch(() => {});
    else await req.body?.cancel().catch(() => {});
    return new ErrorApi(mensaje, estado);
  };
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS[tipo]) throw await rechazar("La foto debe ser JPG, PNG o WEBP.", 415);
  const bytes = Number(req.headers.get("Content-Length"));
  if (!bytes || !req.body) throw await rechazar("La foto está vacía.", 400);
  if (bytes > MAX_BYTES) throw await rechazar("La foto pesa más de 15 MB.", 413);
  const foto = `${Date.now()}-${aleatorio(6)}.${TIPOS[tipo]}`;
  await r2.put(`fotos/${sesion}/${foto}`, req.body, { httpMetadata: { contentType: tipo } });
  return json({ foto });
}

export async function listar(r2: R2Bucket, sesion: string) {
  const l = await r2.list({ prefix: `fotos/${sesion}/`, limit: 100 });
  const fotos = l.objects.map((o) => ({ foto: o.key.slice(`fotos/${sesion}/`.length), bytes: o.size, subida: o.uploaded.toISOString() }))
    .sort((a, b) => b.subida.localeCompare(a.subida));
  return json({ fotos });
}

export async function ver(r2: R2Bucket, sesion: string, foto: string) {
  const o = await r2.get(`fotos/${sesion}/${foto}`);
  if (!o) throw new ErrorApi("La foto ya no está (se borran a las 48 horas).", 404);
  return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" } });
}

export async function borrarFoto(r2: R2Bucket, sesion: string, foto: string) {
  await r2.delete(`fotos/${sesion}/${foto}`);
  return json({ ok: true });
}

export async function borrarSesion(r2: R2Bucket, sesion: string) {
  const l = await r2.list({ prefix: `fotos/${sesion}/`, limit: 1000 });
  if (l.objects.length) await r2.delete(l.objects.map((o) => o.key));
  return json({ ok: true, borradas: l.objects.length });
}

/** Cron diario: borra las fotos de más de 48 horas. */
export async function limpiar(r2: R2Bucket) {
  const limite = Date.now() - HORAS_VIDA * 3_600_000;
  let borradas = 0;
  let cursor: string | undefined;
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const l = await r2.list({ prefix: "fotos/", limit: 1000, cursor });
    const viejas = l.objects.filter((o) => o.uploaded.getTime() < limite).map((o) => o.key);
    if (viejas.length) { await r2.delete(viejas); borradas += viejas.length; }
    if (!l.truncated) break;
    cursor = l.cursor;
  }
  return { borradas };
}
