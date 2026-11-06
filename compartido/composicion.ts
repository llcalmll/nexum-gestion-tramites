/*
 * La "receta" de un consolidado (varios documentos de un trámite juntos en un PDF, desde el escáner): de dónde sale
 * cada página y cómo se acomodó (esquinas, filtro, giro). Con ella, al editar el consolidado cada página se vuelve a
 * abrir desde su foto original (se puede reencuadrar de verdad), se le agregan o quitan documentos, y se guarda encima.
 * Si el documento de origen ya no está (o se le cambió el archivo), esa página sale tal cual del consolidado.
 */
export interface ParteComposicion {
  /** El documento del trámite de donde sale (null: una foto agregada en el escáner, o una página que ya venía así). */
  doc: string | null;
  /** El archivo de ese documento cuando se juntó (si cambió, ya no se usa el ajuste). */
  clave: string | null;
  /** Su nombre, para mostrar qué junta. */
  nombre: string;
  /** Si el origen es un PDF escaneado: la página (desde 0); null si es una foto. */
  pagina: number | null;
  /** Las 4 esquinas en la foto de origen, a su tamaño `ancho` x `alto`. */
  esquinas: [number, number][];
  filtro: string;
  giros: number;
  ancho: number;
  alto: number;
}
export interface Composicion {
  v: 1;
  modo: "hoja" | "tarjeta";
  escala: number;
  partes: ParteComposicion[];
  /** Los PDF que van al final tal cual (no traen fotos). */
  extras: { doc: string | null; nombre: string }[];
}

/** Lo que junta, para mostrarlo: "Foto del contrato, Contrato escaneado y 1 más". */
export function resumenComposicion(c: Composicion | null | undefined) {
  if (!c) return "";
  const nombres = [...new Set([...c.partes.map((p) => p.nombre), ...c.extras.map((e) => e.nombre)].filter(Boolean))];
  return nombres.length > 3 ? `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más` : nombres.join(", ");
}

/** Revisa lo que llega a la API (tamaño, forma); null si no sirve. */
export function composicionValida(x: unknown): Composicion | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Composicion;
  if (c.v !== 1 || (c.modo !== "hoja" && c.modo !== "tarjeta") || !Array.isArray(c.partes) || !Array.isArray(c.extras) || c.partes.length > 200 || c.extras.length > 50) return null;
  if (JSON.stringify(c).length > 10_000) return null;
  const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  for (const p of c.partes) {
    if (!p || typeof p !== "object" || !Array.isArray(p.esquinas) || p.esquinas.length !== 4 || !p.esquinas.every((q) => Array.isArray(q) && q.length === 2 && num(q[0]) && num(q[1]))) return null;
    if (!num(p.giros) || !num(p.ancho) || !num(p.alto) || typeof p.filtro !== "string") return null;
  }
  return { v: 1, modo: c.modo, escala: num(c.escala) ? c.escala : 1.5, partes: c.partes.map((p) => ({ doc: typeof p.doc === "string" ? p.doc.slice(0, 64) : null, clave: typeof p.clave === "string" ? p.clave.slice(0, 300) : null, nombre: String(p.nombre ?? "").slice(0, 200), pagina: num(p.pagina) ? p.pagina : null, esquinas: p.esquinas, filtro: p.filtro.slice(0, 20), giros: p.giros, ancho: p.ancho, alto: p.alto })),
    extras: c.extras.map((e) => ({ doc: typeof e?.doc === "string" ? e.doc.slice(0, 64) : null, nombre: String(e?.nombre ?? "").slice(0, 200) })) };
}
