/*
 * Combos: los trámites creados juntos (un encargo: traspaso + levantamiento de prenda...) son UN trámite para la
 * oficina, con un solo código (codigoTramite). En las listas van una sola vez, con sus trámites juntos.
 */

interface Parte { id: string; numero: number; encargoId: string | null; tipoId: string; estado: string }

/** Cada combo una sola vez (la primera de sus partes que aparezca en la lista). */
export const unoPorCombo = <T extends { encargoId: string | null }>(lista: T[]) =>
  lista.filter((t, i) => !t.encargoId || lista.findIndex((x) => x.encargoId === t.encargoId) === i);

/** El nombre de cada combo, "Traspaso de propiedad + Levantamiento de prenda" (sin las partes canceladas), por encargo. */
export function nombresDeCombos(tramites: Parte[], tipo: Map<string, string>) {
  const partes = new Map<string, Parte[]>();
  for (const t of tramites) if (t.encargoId && t.estado !== "cancelado") partes.set(t.encargoId, [...(partes.get(t.encargoId) ?? []), t]);
  const nombres = new Map<string, string>();
  for (const [e, ps] of partes) if (ps.length > 1) nombres.set(e, ps.sort((a, b) => a.numero - b.numero).map((x) => tipo.get(x.tipoId) ?? "").join(" + "));
  return nombres;
}
