import { useSyncExternalStore } from "react";
import type { RespuestaEstado } from "../../compartido/tipos";
import { api, SesionVencida, SinAcceso, SinConexion } from "./api";
import { activarSincronizacion, borrarCopiaLocal, copiaCompleta, detenerSincronizacion, hayCopiaLocal, leerEstadoSync } from "./sincronizacion";

/*
 * Estado de la sesión. El ingreso lo hace Cloudflare Access (correo + PIN) antes de cargar la app;
 * aquí solo se confirma con /api/estado y se reacciona si la sesión vence o se pierde la red.
 */

export type Fase = "cargando" | "preparando" | "lista" | "vencida" | "sin-acceso" | "sin-red";
export interface EstadoSesion { fase: Fase; correo: string | null; mensaje?: string }

let estado: EstadoSesion = { fase: "cargando", correo: null };
const oyentes = new Set<() => void>();
function poner(e: EstadoSesion) {
  estado = e;
  oyentes.forEach((f) => f());
}
export const useSesion = () => useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => estado);

/** Cierra la sesión de Cloudflare Access (vuelve a pedir el correo y el PIN). */
const SALIR_ACCESS = "/cdn-cgi/access/logout";
const enEstePC = () => ["localhost", "127.0.0.1"].includes(location.hostname);

export function alVencer(e: SesionVencida | SinAcceso) {
  poner(e instanceof SinAcceso ? { ...estado, fase: "sin-acceso", mensaje: e.message } : { ...estado, fase: "vencida" });
}

export async function iniciarSesion() {
  poner({ ...estado, fase: "cargando" });
  try {
    const r = await api<RespuestaEstado>("/api/estado");
    if (!(await copiaCompleta())) {
      // Primera vez en este equipo (o la descarga anterior se cortó): se baja todo antes de mostrar la app,
      // para que no se vaya armando por partes. Si se corta, sigue desde donde quedó.
      poner({ fase: "preparando", correo: r.correo });
      await activarSincronizacion(alVencer);
      if (estado.fase !== "preparando") return; // la sesión venció o se quitó el acceso mientras bajaba
      if (!(await copiaCompleta())) {
        detenerSincronizacion();
        const s = leerEstadoSync();
        poner({ fase: "sin-red", correo: r.correo, mensaje: s.estado === "error" ? s.mensaje : undefined });
        return;
      }
      poner({ fase: "lista", correo: r.correo });
      return;
    }
    poner({ fase: "lista", correo: r.correo });
    activarSincronizacion(alVencer);
  } catch (e) {
    if (e instanceof SesionVencida || e instanceof SinAcceso) return alVencer(e);
    if (e instanceof SinConexion && (await hayCopiaLocal())) {
      // Sin internet pero con datos en este equipo: se trabaja con la copia y se reintenta solo.
      poner({ fase: "lista", correo: estado.correo });
      activarSincronizacion(alVencer);
      return;
    }
    poner({ fase: "sin-red", correo: null, mensaje: e instanceof SinConexion ? undefined : e instanceof Error ? e.message : String(e) });
  }
}

/** Volver a entrar: recargar hace que Cloudflare Access pida el PIN de nuevo. Los datos locales se conservan. */
export const volverAEntrar = () => location.reload();

/** Cerrar sesión: borra la copia de este equipo (datos personales) y cierra Access. */
export async function cerrarSesion() {
  detenerSincronizacion();
  await borrarCopiaLocal();
  if (enEstePC()) location.reload();
  else location.href = SALIR_ACCESS;
}
