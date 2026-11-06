/*
 * Llamadas a la API. Con Cloudflare Access:
 * - sesión vencida: Access responde con una redirección a su página del PIN, que con
 *   `redirect: "manual"` llega como "opaqueredirect" (o 401 si el Worker rechaza el token);
 * - correo sin permiso: 403;
 * - sin internet: fetch lanza TypeError.
 */

export class SesionVencida extends Error {}
export class SinAcceso extends Error {}
export class SinConexion extends Error {}

export async function api<T>(ruta: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, {
      credentials: "same-origin",
      redirect: "manual",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new SinConexion("Sin conexión con el servidor.");
  }
  if (r.type === "opaqueredirect" || r.status === 401) throw new SesionVencida("La sesión venció.");
  const datos = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (r.status === 403) throw new SinAcceso(datos?.error ?? "Este correo no tiene acceso.");
  if (!r.ok || datos === null) throw new Error(datos?.error ?? `El servidor respondió con un error (${r.status}).`);
  return datos;
}
