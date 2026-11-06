/**
 * Trámites recién anotados (por el asistente, desde Registrar o desde el mapa) que el mapa muestra: va a su ciudad y
 * abre su carpeta. Si el mapa no está abierto, queda guardado unos minutos y lo muestra al abrirlo.
 */
const CLAVE = "mapa-resaltar";
const EVENTO = "nexum:resaltar";
const DURA_MS = 10 * 10_000;

export function resaltarEnMapa(ids: string[]) {
  if (!ids.length) return;
  try { sessionStorage.setItem(CLAVE, JSON.stringify({ ids, hasta: Date.now() + DURA_MS })); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new CustomEvent<string[]>(EVENTO, { detail: ids }));
}

/** Los que esperan a ser mostrados (los vencidos se olvidan). */
export function porResaltar(): string[] {
  try {
    const g = JSON.parse(sessionStorage.getItem(CLAVE) || "null") as { ids: string[]; hasta: number } | null;
    if (g && g.hasta > Date.now() && Array.isArray(g.ids)) return g.ids;
    sessionStorage.removeItem(CLAVE);
  } catch { /* nada guardado */ }
  return [];
}

export function yaResaltados() {
  try { sessionStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}

/** Avisa cuando llegan trámites para mostrar; devuelve con qué dejar de escuchar. */
export function alResaltar(f: (ids: string[]) => void): () => void {
  const h = (e: Event) => f((e as CustomEvent<string[]>).detail);
  window.addEventListener(EVENTO, h);
  return () => window.removeEventListener(EVENTO, h);
}
