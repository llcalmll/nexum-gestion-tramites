import { api, SesionVencida, SinAcceso, SinConexion } from "./api";
import { alVencer } from "./sesion";
import { sincronizarAhora } from "./sincronizacion";
import { leerDerecha } from "../logica/foto";

/** Error de una escritura, con el mensaje listo para mostrar y, si aplica, datos extra de la API. */
export class ErrorEscritura extends Error {
  constructor(mensaje: string, public datos: Record<string, unknown> = {}) {
    super(mensaje);
  }
}

/**
 * Guarda algo por la API y espera a que la copia local lo refleje, así la pantalla ya muestra el cambio.
 * Las escrituras no se guardan sin internet: se avisa y no se pierde lo escrito en el formulario.
 */
export async function escribir<T = Record<string, unknown>>(metodo: "POST" | "PATCH" | "PUT" | "DELETE", ruta: string, cuerpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: metodo,
      credentials: "same-origin",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorEscritura("Sin conexión: no se guardó. Revise el internet e intente de nuevo.");
  }
  if (r.type === "opaqueredirect" || r.status === 401) {
    alVencer(new SesionVencida("La sesión venció."));
    throw new ErrorEscritura("La sesión venció: no se guardó. Vuelva a entrar e intente de nuevo.");
  }
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 403) {
    alVencer(new SinAcceso(String(datos.error ?? "Sin acceso.")));
    throw new ErrorEscritura(String(datos.error ?? "Sin acceso."));
  }
  if (!r.ok) throw new ErrorEscritura(String(datos.error ?? `El servidor respondió con un error (${r.status}).`), datos);
  await sincronizarAhora();
  return datos as T;
}

/** Sube un archivo tal cual (el cuerpo es el archivo). */
export async function subirArchivo(ruta: string, archivo: File): Promise<void> {
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: "PUT",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "Content-Type": archivo.type || "application/octet-stream", "X-Nombre-Archivo": encodeURIComponent(archivo.name) },
      body: archivo,
    });
  } catch {
    throw new ErrorEscritura("Sin conexión: el archivo no se subió.");
  }
  if (r.type === "opaqueredirect" || r.status === 401) {
    alVencer(new SesionVencida("La sesión venció."));
    throw new ErrorEscritura("La sesión venció: el archivo no se subió.");
  }
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorEscritura(String(datos.error ?? `No se pudo subir el archivo (${r.status}).`));
  await sincronizarAhora();
}

/** Lectura de una foto con IA: solo propone datos, no guarda nada. */
export async function leerFoto(tipo: "cedula" | "licencia" | "tarjeta_propiedad", imagen: string): Promise<Record<string, string | string[]>> {
  try {
    const r = await leerDerecha(imagen, (foto, baja, derecha) => api<{ datos: Record<string, string | string[]>; girar?: number }>("/api/leer", { method: "POST", body: JSON.stringify({ tipo, imagen: foto, baja, derecha }) }));
    return r.datos;
  } catch (e) {
    if (e instanceof SesionVencida || e instanceof SinAcceso) {
      alVencer(e);
      throw new ErrorEscritura("La sesión venció. Vuelva a entrar e intente de nuevo.");
    }
    if (e instanceof SinConexion) throw new ErrorEscritura("Sin conexión: no se pudo leer la foto.");
    throw new ErrorEscritura(e instanceof Error ? e.message : String(e));
  }
}

export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
