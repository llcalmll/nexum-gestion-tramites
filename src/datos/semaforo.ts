import { useLiveQuery } from "dexie-react-hooks";
import { evaluarPrecondiciones, faltantes, semaforo, type ColorSemaforo } from "../../compartido/reglas";
import { hoyISO } from "../logica/formato";
import { db } from "./db";
import { useParametros } from "./hooks";
import { useFaltantes } from "./incompletos";

/** El color y su porqué; `pre`: las casillas (precondiciones) hechas de todas las que aplican, y cuáles faltan. */
export interface Semaforo { color: ColorSemaforo; motivo: string; pre?: { hechas: number; total: number; faltan: string[] } }

/**
 * El semáforo de cada trámite (de la copia local): id -> color y porqué. Un combo se mira entero (precondiciones de
 * todas sus partes, el saldo de todo el encargo).
 */
/** `refresco`: cambiarlo vuelve a calcular (el mapa lo cambia cada minuto, en silencio, por el paso de los días). */
export function useSemaforos(refresco?: number): Map<string, Semaforo> {
  const faltan = useFaltantes();
  const parametros = useParametros();
  return useLiveQuery(async () => {
    const [tramites, tipos, vehiculos, pagos] = await Promise.all([db.tramites.toArray(), db.tipos_tramite.toArray(), db.vehiculos.toArray(), db.pagos.toArray()]);
    const tipo = new Map(tipos.map((t) => [t.id, t]));
    const vehiculo = new Map(vehiculos.map((v) => [v.id, v]));
    const pagado = new Map<string, number>();
    for (const p of pagos) pagado.set(p.tramiteId, (pagado.get(p.tramiteId) ?? 0) + p.valor);
    const delEncargo = new Map<string, typeof tramites>();
    for (const t of tramites) if (t.encargoId && t.estado !== "cancelado") delEncargo.set(t.encargoId, [...(delEncargo.get(t.encargoId) ?? []), t]);
    const hoy = hoyISO(), rnmc = parametros.rnmc_activo === "true";
    const salida = new Map<string, Semaforo>();
    for (const t of tramites) {
      if (t.borrador) continue;
      const partes = t.encargoId && t.estado !== "cancelado" ? delEncargo.get(t.encargoId) ?? [t] : [t];
      const saldo = Math.max(0, partes.reduce((s, x) => s + x.total - (pagado.get(x.id) ?? 0), 0));
      const evaluadas = partes.flatMap((x) => { const tp = tipo.get(x.tipoId); return tp ? evaluarPrecondiciones(tp, x.precondicionesEstado, x.vehiculoId ? vehiculo.get(x.vehiculoId) ?? null : null, hoy, rnmc) : []; });
      const precond = [...new Set(faltantes(evaluadas).map((f) => f.nombre))];
      const porFlag = new Map<string, boolean>();
      for (const e of evaluadas) porFlag.set(e.flag, (porFlag.get(e.flag) ?? true) && e.ok);
      const pre = { hechas: [...porFlag.values()].filter(Boolean).length, total: porFlag.size, faltan: precond };
      salida.set(t.id, { ...semaforo(t, { hoy, saldo, faltanDatos: faltan.get(t.id) ?? [], faltanPrecondiciones: precond }), pre });
    }
    return salida;
  }, [faltan, parametros.rnmc_activo, refresco]) ?? new Map();
}
