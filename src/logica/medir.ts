/*
 * Medición de texto para fijar el ancho de las columnas de las tablas.
 * Las tablas dibujan solo una parte de las filas (las visibles o una página); si el ancho dependiera de esas
 * filas, las columnas cambiarían de tamaño al bajar o al cambiar de página. Midiendo todas las filas una vez,
 * cada columna queda con un ancho estable, como en Excel.
 */

let lienzo: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** Ancho en píxeles de un texto con la letra de la app. */
export function medirTexto(s: string, tam = 12.5, peso = 400, mayusculas = false): number {
  if (!s) return 0;
  const texto = mayusculas ? s.toUpperCase() : s;
  const k = `${tam}|${peso}|${texto}`;
  const guardado = cache.get(k);
  if (guardado !== undefined) return guardado;
  lienzo ??= document.createElement("canvas").getContext("2d");
  let w = texto.length * tam * 0.56;
  if (lienzo) {
    lienzo.font = `${peso} ${tam}px "Inter Variable", Inter, system-ui, sans-serif`;
    // El espaciado de letras de los encabezados (0.03em) no lo mide el lienzo: se suma aparte.
    w = lienzo.measureText(texto).width + (mayusculas ? texto.length * tam * 0.03 : 0);
  }
  if (cache.size > 10_000) cache.clear();
  cache.set(k, w);
  return w;
}
