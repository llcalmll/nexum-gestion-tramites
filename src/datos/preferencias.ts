import { useSyncExternalStore } from "react";

// Preferencias por PC. Se guardan en localStorage y, si el navegador no lo permite,
// duran lo que dure la pestaña.
const oyentes = new Set<() => void>();
const memoria = new Map<string, string>();

function leer(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return memoria.get(k) ?? null;
  }
}

function escribir(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    memoria.set(k, v);
  }
  oyentes.forEach((f) => f());
}

function usar(k: string): string | null {
  return useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => leer(k));
}

/** Apariencia: claro (por defecto), oscuro o automático según el sistema. */
export type Tema = "claro" | "oscuro" | "auto";
export const useTema = (): Tema => (usar("tema") as Tema | null) ?? "claro";

export function aplicarTema() {
  const t = (leer("tema") as Tema | null) ?? "claro";
  const oscuro = t === "oscuro" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";
}

export function ponerTema(t: Tema) {
  escribir("tema", t);
  aplicarTema();
}

/** true si en este momento se ve oscuro (incluye "automático" con el sistema en oscuro). */
export const useOscuro = () => {
  useTema();
  return document.documentElement.dataset.tema === "oscuro";
};
