import { ENCUADRE_INICIAL, type Encuadre } from "./procesar";

/**
 * «Más cerca» a la medida de la oficina: cada foto que se usa (a la hoja o impresa) con «Más cerca» deja su tamaño y
 * su altura; «Más cerca» arranca en la mediana de las últimas 10. La de fábrica ya es la medida que Felipe usaba
 * (procesar.ts, CARAS_POR_ALTO); esto ajusta lo que siga cambiando. Se guarda en este navegador.
 */
export const CLAVE_CERCA = "nexum.fotos.masCerca";
const CERCA_GUARDADAS = 10;
type MedidaCerca = { escala: number; dy: number };
export function medidasCerca(): MedidaCerca[] {
  try { const l = JSON.parse(localStorage.getItem(CLAVE_CERCA) ?? "[]"); return Array.isArray(l) ? l.filter((m) => Number.isFinite(m?.escala) && Number.isFinite(m?.dy)) : []; } catch { return []; }
}
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** El encuadre «Más cerca» de entrada: el aprendido si hay, si no, el de fábrica. */
export function encuadreCerca(): Encuadre {
  const l = medidasCerca();
  if (!l.length) return { ...ENCUADRE_INICIAL, modo: "cara" };
  return { ...ENCUADRE_INICIAL, modo: "cara", escala: +mediana(l.map((m) => m.escala)).toFixed(3), dy: +mediana(l.map((m) => m.dy)).toFixed(3) };
}
export function recordarCerca(e: Encuadre) {
  if (e.modo !== "cara") return;
  try { localStorage.setItem(CLAVE_CERCA, JSON.stringify([...medidasCerca(), { escala: e.escala, dy: e.dy }].slice(-CERCA_GUARDADAS))); } catch { /* sin almacenamiento: no se aprende */ }
}
