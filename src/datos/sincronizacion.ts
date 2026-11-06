import { useSyncExternalStore } from "react";
import type { RespuestaCambios } from "../../compartido/tipos";
import { api, SesionVencida, SinAcceso, SinConexion } from "./api";
import { db, TABLAS_LOCALES, type TablaLocal } from "./db";

/*
 * Descarga incremental: cada CADA_MS se pregunta "¿qué cambió desde la versión N?".
 * Si nada cambió, al servidor le cuesta una sola lectura. Con la pestaña oculta no se pregunta nada.
 * Los datos y la versión se guardan en la misma transacción: nunca queda una copia a medias.
 */

const CADA_MS = 10_000;
const CLAVE_VERSION = "version";
/** Se marca cuando este equipo terminó de bajar la copia al menos una vez (si se corta a medias, no). */
const CLAVE_COMPLETA = "completa";

export type EstadoSync = "listo" | "recibiendo" | "sin-conexion" | "error";
/** `avance`: de 0 a 1 mientras se recibe una tanda grande (la primera descarga). */
let estado: { estado: EstadoSync; ultima: string | null; mensaje?: string; avance?: number } = { estado: "listo", ultima: null };
export const leerEstadoSync = () => estado;
const oyentes = new Set<() => void>();
function poner(c: Partial<typeof estado>) {
  estado = { ...estado, ...c };
  oyentes.forEach((f) => f());
}
export const useEstadoSync = () => useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => estado);

export const leerVersionLocal = async () => ((await db.meta.get(CLAVE_VERSION))?.valor as number | undefined) ?? 0;
export const hayCopiaLocal = async () => (await leerVersionLocal()) > 0;
export const copiaCompleta = async () => (await db.meta.get(CLAVE_COMPLETA))?.valor === true;

const esTablaLocal = (t: string): t is TablaLocal => (TABLAS_LOCALES as readonly string[]).includes(t);
const todasLasTablas = () => [...TABLAS_LOCALES.map((t) => db.table(t)), db.meta];

async function aplicar(r: RespuestaCambios) {
  await db.transaction("rw", todasLasTablas(), async () => {
    for (const [tabla, filas] of Object.entries(r.cambios)) {
      if (esTablaLocal(tabla)) await db.table(tabla).bulkPut(filas);
    }
    const porTabla = new Map<string, string[]>();
    for (const e of r.eliminados) porTabla.set(e.tabla, [...(porTabla.get(e.tabla) ?? []), e.registroId]);
    for (const [tabla, ids] of porTabla) {
      if (esTablaLocal(tabla)) await db.table(tabla).bulkDelete(ids);
    }
    await db.meta.put({ clave: CLAVE_VERSION, valor: r.version });
  });
}

/** Borra la copia de este equipo (al cerrar sesión, o para volver a descargar todo). */
export async function borrarCopiaLocal() {
  await db.transaction("rw", todasLasTablas(), async () => {
    for (const t of todasLasTablas()) await t.clear();
  });
}

async function descargar() {
  let inicio: number | null = null;
  for (let vuelta = 0; vuelta < 1000; vuelta++) {
    const desde = await leerVersionLocal();
    const r = await api<RespuestaCambios>(`/api/cambios?v=${desde}`);
    // La base del servidor quedó en una versión anterior (por ejemplo, se restauró una copia):
    // la copia local ya no corresponde y se descarga todo de nuevo.
    if (r.version < desde) {
      await borrarCopiaLocal();
      inicio = null;
      continue;
    }
    inicio ??= desde;
    if (r.version !== desde) {
      poner({ estado: "recibiendo", avance: r.ultima > inicio ? (r.version - inicio) / (r.ultima - inicio) : 1 });
      await aplicar(r);
    }
    if (!r.mas) {
      await db.meta.put({ clave: CLAVE_COMPLETA, valor: true });
      return;
    }
  }
}

let alVencer: (e: SesionVencida | SinAcceso) => void = () => {};
let corriendo: Promise<void> | null = null;
let intervalo: ReturnType<typeof setInterval> | null = null;

/** Descarga lo nuevo. Una sola a la vez, también entre pestañas (Web Locks). */
export function sincronizarAhora(): Promise<void> {
  corriendo ??= (async () => {
    const tarea = async () => {
      try {
        await descargar();
        poner({ estado: "listo", ultima: new Date().toISOString(), mensaje: undefined, avance: undefined });
      } catch (e) {
        if (e instanceof SesionVencida || e instanceof SinAcceso) {
          detenerSincronizacion();
          alVencer(e);
        } else if (e instanceof SinConexion) {
          poner({ estado: "sin-conexion", mensaje: "Sin conexión: se muestra la copia de este equipo.", avance: undefined });
        } else {
          poner({ estado: "error", mensaje: e instanceof Error ? e.message : String(e), avance: undefined });
        }
      }
    };
    if (navigator.locks) await navigator.locks.request("nexum-sync", tarea);
    else await tarea();
  })().finally(() => { corriendo = null; });
  return corriendo;
}

const alVolver = () => { if (!document.hidden) sincronizarAhora(); };

export function activarSincronizacion(vencio: (e: SesionVencida | SinAcceso) => void) {
  alVencer = vencio;
  if (!intervalo) {
    intervalo = setInterval(() => { if (!document.hidden) sincronizarAhora(); }, CADA_MS);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alVolver);
  }
  return sincronizarAhora();
}

export function detenerSincronizacion() {
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
  document.removeEventListener("visibilitychange", alVolver);
  window.removeEventListener("online", alVolver);
}
