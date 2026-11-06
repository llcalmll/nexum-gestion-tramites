/*
 * Las partes de una revisión previa con PlacApi. Cada una llega o no por su lado (PlacApi solo cobra lo que llega):
 * lo que no llegó queda marcado, la revisión queda "incompleta" y se puede pedir de nuevo SOLO eso, con la consulta
 * más barata que lo traiga. Lo usan el servidor (revision.ts) y las pantallas (costo del reintento).
 */

export type ParteRevision = "registro" | "gravamenes" | "soat" | "rtm" | "simit_dueno" | "simit_comprador" | "simit_titular" | "impuesto" | "licencia";

export const NOMBRE_PARTE: Record<ParteRevision, string> = {
  registro: "registro del vehículo", gravamenes: "prendas y embargos", soat: "SOAT", rtm: "técnico-mecánica",
  simit_dueno: "comparendos del dueño", simit_comprador: "comparendos del comprador", simit_titular: "comparendos del titular",
  impuesto: "impuesto vehicular", licencia: "licencia",
};

/** Lo del vehículo que trae la consulta básica (/consulta, 1 crédito). */
const DE_LA_BASICA: ParteRevision[] = ["registro", "gravamenes", "soat", "rtm"];

/**
 * Cómo pedir de nuevo lo que faltó, con lo más barato:
 * - el impuesto solo llega en la consulta completa (3), que trae también todo lo del vehículo y los comparendos del dueño;
 * - registro, prendas, SOAT o técnico-mecánica: la consulta básica (1);
 * - comparendos de una persona: su paz y salvo (1 cada uno);
 * - licencia: 1 (2 si PlacApi tiene que averiguar el apellido).
 */
export function planReintento(faltaron: readonly ParteRevision[]) {
  const f = new Set(faltaron);
  const completa = f.has("impuesto");
  const basica = !completa && DE_LA_BASICA.some((p) => f.has(p));
  const pazSalvo = (["simit_dueno", "simit_comprador", "simit_titular"] as const).filter((p) => f.has(p) && !(completa && p === "simit_dueno"));
  const licencia = f.has("licencia");
  return { completa, basica, pazSalvo, licencia, creditos: (completa ? 3 : 0) + (basica ? 1 : 0) + pazSalvo.length + (licencia ? 1 : 0) };
}

/** "SOAT, técnico-mecánica e impuesto vehicular". */
export function listaPartes(partes: readonly ParteRevision[]) {
  const n = [...new Set(partes)].map((p) => NOMBRE_PARTE[p]);
  if (n.length < 2) return n[0] ?? "";
  const ultima = n.at(-1)!;
  return `${n.slice(0, -1).join(", ")} ${/^h?i[^aeou]/i.test(ultima) ? "e" : "y"} ${ultima}`;
}
