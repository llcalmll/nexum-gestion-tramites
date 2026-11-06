import type { Semaforo } from "../../compartido/dominio";
import type { Tono } from "../componentes/ui";

const pesosFmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export const pesos = (n: number | null | undefined) => (n == null ? "" : pesosFmt.format(n));

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-11" -> "11 oct 2026". Acepta también fechas ISO completas. */
export function fecha(d: string | null | undefined): string {
  if (!d) return "";
  const [a, m, dia] = d.slice(0, 10).split("-").map(Number);
  if (!a || !m || !dia) return d;
  return `${dia} ${MESES_CORTOS[m - 1]} ${a}`;
}

/** Fecha de hoy en Colombia como "AAAA-MM-DD". */
export const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

export const TONO_SEMAFORO: Record<Semaforo, Tono> = { ok: "verde", warn: "ambar", danger: "rojo", info: "azul", neutral: "gris", fallido: "vino" };
