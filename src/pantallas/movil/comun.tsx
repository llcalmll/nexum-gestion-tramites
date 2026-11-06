import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/*
 * Piezas comunes de la app del celular "Fotos · Trámites Pira". No usa la copia local (Dexie) ni la sincronización:
 * todo va directo a la API, para que el celular abra rápido y no descargue los datos de la oficina.
 */

export class SesionCaida extends Error {}
export const MENSAJE_SESION = "La sesión venció: recargue la página, entre con el código y vuelva a intentar.";

export const instalada = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Sube una foto (ya achicada) a una sesión de fotos y devuelve su nombre. */
export async function subirFoto(sesion: string, foto: Blob): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`/api/fotos/sesiones/${sesion}`, { method: "PUT", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "image/jpeg" }, body: foto });
  } catch {
    throw new Error("Sin conexión: revise el internet.");
  }
  if (r.type === "opaqueredirect" || r.status === 401) throw new SesionCaida(MENSAJE_SESION);
  const d = (await r.json().catch(() => ({}))) as { foto?: string; error?: string };
  if (!r.ok || !d.foto) throw new Error(d.error ?? `No se pudo enviar (${r.status}).`);
  return d.foto;
}

/** Cabecera de cada sección, con "Volver" (en la app instalada del iPhone no hay botón de atrás). */
export function CabeceraMovil({ titulo, volver, paso }: { titulo: string; volver?: () => void; paso?: string }) {
  return (
    <div className="movil-cab">
      {volver ? <button className="btn btn-sm btn-fantasma" onClick={volver} aria-label="Volver"><ChevronLeft size={18} />Volver</button> : <img className="logo-img" src="/logo.png" alt="" />}
      <b>{titulo}</b>
      {paso ? <span className="peq tenue">{paso}</span> : <span />}
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="movil-campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && <small className="tenue">{ayuda}</small>}
    </label>
  );
}

/**
 * Qué celular es, para decir en el PC "Recibido desde el celular (iPhone)": el iPhone solo dice que es iPhone; en
 * Android, Chrome da el modelo (SM-A546E) si se le pide.
 */
export async function nombreDispositivo(): Promise<string> {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (!/Android/.test(ua)) return "";
  try {
    const datos = (navigator as Navigator & { userAgentData?: { getHighEntropyValues: (h: string[]) => Promise<{ model?: string }> } }).userAgentData;
    const modelo = (await datos?.getHighEntropyValues(["model"]))?.model?.trim();
    if (modelo) return /^SM-/i.test(modelo) ? `Samsung ${modelo}` : modelo;
  } catch { /* sin el dato */ }
  const viejo = /Android [\d.]+; ([^;)]+)\)/.exec(ua)?.[1]?.trim();
  return viejo && viejo !== "K" ? viejo : "Android";
}
