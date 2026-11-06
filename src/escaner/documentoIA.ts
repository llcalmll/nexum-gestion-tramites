import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/*
 * Aumento de resolución de documentos por IA: de lo que el lector transcribió (POST /api/aumento/leer) a una hoja carta
 * con letra real. Una sola composición (componer) se dibuja igual en el PDF y en la vista previa; las firmas, sellos y
 * logos se recortan de la foto original. También dice qué hay que revisar a mano contra el original.
 */

export type Alineacion = "izquierda" | "centro" | "derecha" | "justificado";
export type Estilo = "titulo" | "subtitulo" | "normal" | "pequeno";
export interface Elemento { texto: string; x: number; y: number; ancho: number | null; alineacion: Alineacion; estilo: Estilo; negrilla: boolean; subrayado: boolean; dudoso: boolean }
export interface Celda { texto: string; alineacion: Alineacion; negrilla: boolean; dudoso: boolean }
export interface Fila { y1: number; sombreada: boolean; celdas: Celda[] }
export interface Tabla { x0: number; y0: number; x1: number; y1: number; columnas: number[]; filas: Fila[] }
export interface Linea { x0: number; y0: number; x1: number; y1: number }
export interface Recorte extends Linea { tipo: "firma" | "sello" | "logo" | "foto" | "huella" | "codigo" }
export interface PaginaLeida { elementos: Elemento[]; tablas: Tabla[]; lineas: Linea[]; recortes: Recorte[] }

/* ── Los textos de una hoja ── */

/** Dónde está un texto en la hoja leída. */
export type Ref = { t: "e"; i: number } | { t: "c"; tabla: number; fila: number; celda: number };
export const claveRef = (r: Ref) => (r.t === "e" ? `e${r.i}` : `c${r.tabla}.${r.fila}.${r.celda}`);
export const textoDe = (p: PaginaLeida, r: Ref) => (r.t === "e" ? p.elementos[r.i].texto : p.tablas[r.tabla].filas[r.fila].celdas[r.celda].texto);
/** La hoja con ese texto corregido (copia: no toca la anterior). */
export function conTexto(p: PaginaLeida, r: Ref, texto: string): PaginaLeida {
  if (r.t === "e") return { ...p, elementos: p.elementos.map((e, i) => (i === r.i ? { ...e, texto } : e)) };
  return { ...p, tablas: p.tablas.map((t, a) => (a !== r.tabla ? t : { ...t, filas: t.filas.map((f, b) => (b !== r.fila ? f : { ...f, celdas: f.celdas.map((c, d) => (d === r.celda ? { ...c, texto } : c)) })) })) };
}
/** Todos los textos de la hoja, de arriba abajo. */
export function todosLosTextos(p: PaginaLeida): { ref: Ref; texto: string; y: number }[] {
  const out: { ref: Ref; texto: string; y: number }[] = p.elementos.map((e, i) => ({ ref: { t: "e", i }, texto: e.texto, y: e.y }));
  p.tablas.forEach((t, tabla) => { let arriba = t.y0; t.filas.forEach((f, fila) => { f.celdas.forEach((c, celda) => { if (c.texto.trim()) out.push({ ref: { t: "c", tabla, fila, celda }, texto: c.texto, y: (arriba + f.y1) / 2 }); }); arriba = f.y1; }); });
  return out.sort((a, b) => a.y - b.y);
}

/* ── Qué hay que revisar a mano ── */

/** Zona de la foto (0-1000) para mostrar el renglón, y el dato dentro de ella. */
export interface Zona { y0: number; y1: number; x0: number; x1: number }
/** alto: se confirma uno por uno. baja: solo porque la foto es mala; se confirman juntos. iguales: el mismo texto en otros sitios (se revisa una vez y se corrige en todos). */
export interface PorRevisar { ref: Ref; iguales: Ref[]; motivo: string; nivel: "alto" | "baja"; zona: Zona }

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** Los trozos de un texto que se comparan: lo que lleva números, y las palabras (un nombre mal leído también importa). */
const trozos = (s: string) => normal(s).split(/[\s,;:()[\]]+/).map((t) => t.replace(/^[.\-_/]+|[.\-_/]+$/g, "")).filter((t) => (/\d/.test(t) ? t.length >= 2 : t.length >= 3));
/** Un NIT cuyo dígito de verificación cuadra: la lectura está comprobada. */
function nitBien(t: string) {
  const m = /^(\d{9})-(\d)$/.exec(t);
  if (!m) return false;
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41];
  const s = [...m[1]].reverse().reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11;
  return (s < 2 ? s : 11 - s) === Number(m[2]);
}
const llevaCifras = (t: string) => t.replace(/\D/g, "").length >= 2;

/** La foto es de baja resolución (una captura de un PDF en el celular, reenviada...): con esa, todo número se revisa. */
export const esBaja = (ancho: number, alto: number) => Math.min(ancho, alto) < 1000;

/**
 * Lo que la persona debe mirar contra el original: lo que el lector dudó y lo que el segundo lector no leyó igual. Si la
 * foto es de baja resolución, además todo lo que lleve cifras: en las pruebas, dos lectores pueden leer igual un 6 borroso.
 */
export function textosPorRevisar(p: PaginaLeida, segunda: string[] | null, { baja }: { baja: boolean }): PorRevisar[] {
  const vistos = segunda ? new Set(segunda.flatMap(trozos)) : null;
  const motivo = (texto: string, dudoso: boolean): Pick<PorRevisar, "motivo" | "nivel"> | null => {
    if (texto.includes("[ilegible]")) return { motivo: "No se pudo leer", nivel: "alto" };
    if (dudoso) return { motivo: "La IA no está segura", nivel: "alto" };
    const ts = trozos(texto);
    const comprobados = ts.filter((t) => llevaCifras(t) && !nitBien(t));
    if (vistos && ts.some((t) => !vistos.has(t) && !nitBien(t))) return { motivo: "Dos lecturas no coinciden", nivel: "alto" };
    if (comprobados.length && !vistos) return { motivo: "Solo se leyó una vez", nivel: "alto" };
    if (comprobados.length && baja) return { motivo: "Imagen de baja resolución", nivel: "baja" };
    return null;
  };
  const out: (Omit<PorRevisar, "iguales"> & { orden: number })[] = [];
  p.elementos.forEach((e, i) => {
    const m = motivo(e.texto, e.dudoso);
    if (!m) return;
    const filaMisma = p.elementos.filter((o) => Math.abs(o.y - e.y) < 6 && o.x > e.x).map((o) => o.x);
    const debajo = p.elementos.filter((o) => o.y > e.y + 6).map((o) => o.y);
    const fin = Math.min(...filaMisma, 1000) - 4;
    const largo = e.ancho ?? e.texto.length * 8.5;
    const x0 = e.alineacion === "centro" ? e.x - largo / 2 : e.alineacion === "derecha" ? e.x - largo : e.x;
    const y1 = e.ancho ? Math.min(Math.min(...debajo, 1000) - 2, e.y + 80) : e.y + 14;
    out.push({ ref: { t: "e", i }, ...m, orden: e.y, zona: { y0: Math.max(0, e.y - 14), y1: Math.min(1000, y1), x0: Math.max(0, x0 - 4), x1: Math.min(fin, x0 + largo + 4) } });
  });
  p.tablas.forEach((t, tabla) => {
    const bordes = [t.x0, ...[...t.columnas].sort((a, b) => a - b), t.x1];
    let arriba = t.y0;
    t.filas.forEach((f, fila) => {
      f.celdas.forEach((c, celda) => {
        const m = c.texto.trim() ? motivo(c.texto, c.dudoso) : null;
        if (m) out.push({ ref: { t: "c", tabla, fila, celda }, ...m, orden: arriba, zona: { y0: Math.max(0, arriba - 4), y1: Math.min(1000, f.y1 + 4), x0: bordes[celda] ?? t.x0, x1: bordes[celda + 1] ?? t.x1 } });
      });
      arriba = f.y1;
    });
  });
  // El mismo texto repetido (el departamento en tres renglones) se revisa una sola vez.
  const unicos = new Map<string, PorRevisar>();
  for (const { orden: _orden, ...r } of out.sort((a, b) => a.orden - b.orden)) {
    const clave = textoDe(p, r.ref);
    const ya = unicos.get(clave);
    if (ya) { ya.iguales.push(r.ref); if (r.nivel === "alto") { ya.nivel = "alto"; ya.motivo = r.motivo; } }
    else unicos.set(clave, { ...r, iguales: [] });
  }
  return [...unicos.values()];
}

/* ── Componer la hoja ── */

/** Hoja carta en puntos y márgenes (1,8 cm a los lados, 1,9 cm arriba y abajo). */
const CARTA = { w: 612, h: 792 }, MARGEN = { x: 51, y: 54 };
const TAM: Record<Estilo, number> = { titulo: 12.5, subtitulo: 10.5, normal: 8.5, pequeno: 7.5 };
const FUENTE_MIN = 0.62, FUENTE_MAX = 1.35;
const SALTO = 1.18;

/** Cómo mide el texto la composición: las métricas de la letra del PDF, para que PDF y vista previa queden iguales. */
export type Medir = (t: string, tam: number, negrilla: boolean) => number;
export type Trazo =
  | { k: "texto"; t: string; x: number; y: number; tam: number; negrilla: boolean; marcar: boolean }
  | { k: "linea"; x0: number; y0: number; x1: number; y1: number; grosor: number; gris: boolean }
  | { k: "caja"; x: number; y: number; w: number; h: number }
  | { k: "recorte"; x: number; y: number; w: number; h: number; r: Recorte };
export interface Compuesta { w: number; h: number; trazos: Trazo[] }

/** Junta valores casi iguales en el mismo (los renglones y columnas del original bailan; aquí quedan derechos). */
function agrupar(valores: number[], tolerancia: number) {
  const orden = [...new Set(valores)].sort((a, b) => a - b);
  const grupos: number[][] = [];
  for (const v of orden) { const g = grupos[grupos.length - 1]; if (g && v - g[0] <= tolerancia) g.push(v); else grupos.push([v]); }
  const mapa = new Map<number, number>();
  for (const g of grupos) { const m = g.reduce((a, b) => a + b, 0) / g.length; for (const v of g) mapa.set(v, m); }
  return mapa;
}
function partirLineas(t: string, ancho: number, tam: number, negrilla: boolean, medir: Medir) {
  const lineas: string[] = [];
  let actual = "";
  for (const p of t.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (medir(prueba, tam, negrilla) <= ancho || !actual) actual = prueba;
    else { lineas.push(actual); actual = p; }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/**
 * Del documento leído a los trazos de la hoja. Las coordenadas del lector (0-1000 sobre la foto) se pasan a la hoja
 * carta sin deformar, a la medida del contenido; los renglones y columnas se alinean, y la letra sale tan grande como
 * quepa sin que un dato pise al siguiente. `marcados` son los textos que se resaltan en la vista previa.
 */
export function componer(p: PaginaLeida, proporcion: number, medir: Medir, marcados: Set<string> = new Set()): Compuesta {
  // En la foto, x va de 0 a 1000 y y también, pero la foto es más alta que ancha: fy los deja en la misma medida.
  const fy = 1 / Math.max(0.1, proporcion);
  const elementos = p.elementos.filter((e) => e.texto.trim());
  const filasY = agrupar(elementos.map((e) => e.y), 5);
  const colsX = agrupar(elementos.filter((e) => e.alineacion === "izquierda" || e.alineacion === "justificado").map((e) => e.x), 7);
  const ajustados = elementos.map((e) => ({ ...e, y: filasY.get(e.y) ?? e.y, x: e.alineacion === "izquierda" || e.alineacion === "justificado" ? colsX.get(e.x) ?? e.x : e.x }));

  // Lo que ocupa el contenido.
  const xs: number[] = [], ys: number[] = [];
  for (const e of ajustados) { xs.push(e.x); ys.push(e.y); if (e.ancho) xs.push(e.x + e.ancho); }
  for (const t of p.tablas) { xs.push(t.x0, t.x1); ys.push(t.y0, t.y1); }
  for (const l of [...p.lineas, ...p.recortes]) { xs.push(l.x0, l.x1); ys.push(l.y0, l.y1); }
  if (!xs.length) return { ...CARTA, trazos: [] };
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * fy, y1 = Math.max(...ys) * fy;
  const anchoUtil = CARTA.w - 2 * MARGEN.x, altoUtil = CARTA.h - 2 * MARGEN.y;
  const s = Math.min(anchoUtil / Math.max(400, x1 - x0), altoUtil / Math.max(100, y1 - y0));
  const px = (x: number) => MARGEN.x + (x - x0) * s + Math.max(0, anchoUtil - (x1 - x0) * s) / 2;
  const py = (y: number) => MARGEN.y + (y * fy - y0) * s + 4;

  const anchoDe = (e: Elemento, f: number) => medir(e.texto, TAM[e.estilo] * f, e.negrilla);
  const izquierda = (e: Elemento, f: number) => (e.alineacion === "centro" ? px(e.x) - anchoDe(e, f) / 2 : e.alineacion === "derecha" ? px(e.x) - anchoDe(e, f) : px(e.x));
  const anchoParrafo = (e: Elemento) => Math.min((e.ancho ?? 0) * s, CARTA.w - MARGEN.x - px(e.x));
  const renglones = new Map<number, typeof ajustados>();
  for (const e of ajustados) { if (!e.ancho) renglones.set(e.y, [...(renglones.get(e.y) ?? []), e]); }
  const alturas = [...renglones.keys()].sort((a, b) => a - b);
  const todosY = [...new Set(ajustados.map((e) => e.y))].sort((a, b) => a - b);
  // ¿Cabe esta letra? Un dato no puede pisar al siguiente, ni salirse, ni un párrafo caerle encima a lo de abajo.
  const cabe = (f: number) => {
    for (const fila of renglones.values()) {
      const o = [...fila].sort((a, b) => izquierda(a, f) - izquierda(b, f));
      for (let i = 0; i < o.length; i++) {
        const ini = izquierda(o[i], f), fin = ini + anchoDe(o[i], f);
        if (fin > CARTA.w - MARGEN.x + 0.5 || ini < MARGEN.x - 0.5) return false;
        if (o[i + 1] && fin + 3 > izquierda(o[i + 1], f)) return false;
      }
    }
    for (let i = 1; i < alturas.length; i++) {
      const alto = Math.max(...(renglones.get(alturas[i]) ?? []).map((e) => TAM[e.estilo]));
      if (py(alturas[i]) - py(alturas[i - 1]) < alto * f * 0.98) return false;
    }
    for (const e of ajustados) {
      if (!e.ancho) continue;
      const tam = TAM[e.estilo] * f;
      const fin = py(e.y) + (partirLineas(e.texto, anchoParrafo(e), tam, e.negrilla, medir).length - 0.5) * tam * SALTO;
      const sigue = todosY.find((y) => y > e.y);
      if (fin > (sigue !== undefined ? py(sigue) - tam * 0.5 : CARTA.h - MARGEN.y + 8)) return false;
    }
    return true;
  };
  let f = FUENTE_MIN;
  for (let prueba = FUENTE_MAX; prueba >= FUENTE_MIN; prueba -= 0.02) if (cabe(prueba)) { f = prueba; break; }

  const trazos: Trazo[] = [];
  const base = (y: number, tam: number) => py(y) + tam * 0.35;
  // Si aun con la letra mínima un dato alcanza al siguiente (un texto corregido largo), el siguiente se corre: nunca se pisan.
  const corrido = new Map<Elemento, number>();
  for (const fila of renglones.values()) {
    let fin = -Infinity;
    for (const e of [...fila].sort((a, b) => izquierda(a, f) - izquierda(b, f))) {
      const x = Math.max(izquierda(e, f), fin + 3);
      corrido.set(e, x);
      fin = x + anchoDe(e, f);
    }
  }
  // Tablas: los fondos primero, para que el texto quede encima.
  for (const t of p.tablas) {
    let arriba = py(t.y0);
    const bordes = [t.x0, ...[...t.columnas].sort((a, b) => a - b), t.x1].map(px);
    const izq = bordes[0], der = bordes[bordes.length - 1];
    const pie = py(t.filas[t.filas.length - 1]?.y1 ?? t.y1);
    trazos.push({ k: "linea", x0: izq, y0: py(t.y0), x1: der, y1: py(t.y0), grosor: 0.5, gris: true });
    for (const fila of t.filas) {
      const abajo = py(fila.y1);
      if (fila.sombreada) trazos.push({ k: "caja", x: izq, y: arriba, w: der - izq, h: abajo - arriba });
      const tam = TAM.normal * Math.min(f, 1) * 0.95;
      fila.celdas.forEach((c, i) => {
        if (!c.texto.trim()) return;
        const a = bordes[i] ?? izq, b = bordes[i + 1] ?? der, ancho = b - a - 6;
        let tamC = tam, lineas = partirLineas(c.texto, ancho, tamC, c.negrilla, medir);
        while (tamC > 5.5 && (lineas.length * tamC * 1.15 > abajo - arriba - 2 || lineas.some((l) => medir(l, tamC, c.negrilla) > ancho))) { tamC -= 0.25; lineas = partirLineas(c.texto, ancho, tamC, c.negrilla, medir); }
        const alto = lineas.length * tamC * 1.15;
        lineas.forEach((l, j) => {
          const w = medir(l, tamC, c.negrilla);
          const x = c.alineacion === "centro" ? (a + b) / 2 - w / 2 : c.alineacion === "derecha" ? b - 3 - w : a + 3;
          trazos.push({ k: "texto", t: l, x, y: (arriba + abajo) / 2 - alto / 2 + tamC * 0.85 + j * tamC * 1.15, tam: tamC, negrilla: c.negrilla, marcar: marcados.has(c.texto) });
        });
      });
      trazos.push({ k: "linea", x0: izq, y0: abajo, x1: der, y1: abajo, grosor: 0.5, gris: true });
      arriba = abajo;
    }
    for (const b of bordes) trazos.push({ k: "linea", x0: b, y0: py(t.y0), x1: b, y1: pie, grosor: 0.5, gris: true });
  }
  // Líneas sueltas (firmas, separadores) y lo que se recorta de la foto.
  for (const l of p.lineas) trazos.push({ k: "linea", x0: px(l.x0), y0: py(l.y0), x1: px(l.x1), y1: py(l.y1), grosor: 0.8, gris: false });
  for (const r of p.recortes) trazos.push({ k: "recorte", x: px(r.x0), y: py(r.y0), w: (r.x1 - r.x0) * s, h: (r.y1 - r.y0) * fy * s, r });
  // El texto.
  for (const e of ajustados) {
    const tam = TAM[e.estilo] * f;
    const marcar = marcados.has(e.texto);
    if (e.ancho) {
      // Párrafo: renglones dentro de su ancho; justificado reparte el espacio entre palabras.
      const ancho = anchoParrafo(e);
      const lineas = partirLineas(e.texto, ancho, tam, e.negrilla, medir);
      lineas.forEach((l, i) => {
        const y = base(e.y, tam) + i * tam * SALTO, w = medir(l, tam, e.negrilla);
        if (e.alineacion === "justificado" && i < lineas.length - 1 && l.includes(" ")) {
          const palabras = l.split(" ");
          const hueco = (ancho - palabras.reduce((a, q) => a + medir(q, tam, e.negrilla), 0)) / (palabras.length - 1);
          let x = px(e.x);
          for (const q of palabras) { trazos.push({ k: "texto", t: q, x, y, tam, negrilla: e.negrilla, marcar }); x += medir(q, tam, e.negrilla) + hueco; }
        } else {
          const x = e.alineacion === "centro" ? px(e.x) + (ancho - w) / 2 : e.alineacion === "derecha" ? px(e.x) + ancho - w : px(e.x);
          trazos.push({ k: "texto", t: l, x, y, tam, negrilla: e.negrilla, marcar });
        }
      });
    } else {
      const x = corrido.get(e) ?? izquierda(e, f), y = base(e.y, tam), w = anchoDe(e, f);
      trazos.push({ k: "texto", t: e.texto, x, y, tam, negrilla: e.negrilla, marcar });
      if (e.subrayado) trazos.push({ k: "linea", x0: x, y0: y + tam * 0.16, x1: x + w, y1: y + tam * 0.16, grosor: Math.max(0.5, tam * 0.06), gris: false });
    }
  }
  return { ...CARTA, trazos };
}

/* ── Dibujar: en un lienzo (vista previa, foto interna) y en el PDF ── */

function lienzo(w: number, h: number) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

/** La zona de la foto original de un recorte, con un poco de aire. */
function zonaDeFoto(img: HTMLImageElement, r: Linea) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const sx = Math.max(0, r.x0 / 1000 * w - 2), sy = Math.max(0, r.y0 / 1000 * h - 2);
  return { sx, sy, sw: Math.min(w - sx, (r.x1 - r.x0) / 1000 * w + 4), sh: Math.min(h - sy, (r.y1 - r.y0) / 1000 * h + 4) };
}

export function dibujarEnLienzo(c: Compuesta, img: HTMLImageElement | null, escala: number, conMarcas: boolean): HTMLCanvasElement {
  const lz = lienzo(c.w * escala, c.h * escala), g = lz.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, lz.width, lz.height);
  g.scale(escala, escala);
  for (const t of c.trazos) {
    if (t.k === "caja") { g.fillStyle = "#cccccc"; g.fillRect(t.x, t.y, t.w, t.h); }
    else if (t.k === "linea") { g.strokeStyle = t.gris ? "#8c8c8c" : "#000"; g.lineWidth = t.grosor; g.beginPath(); g.moveTo(t.x0, t.y0); g.lineTo(t.x1, t.y1); g.stroke(); }
    else if (t.k === "recorte") { if (img) { const q = zonaDeFoto(img, t.r); g.drawImage(img, q.sx, q.sy, q.sw, q.sh, t.x, t.y, t.w, t.h); } }
    else {
      g.font = `${t.negrilla ? "bold " : ""}${t.tam}px Arial, Helvetica, sans-serif`;
      if (conMarcas && t.marcar) { g.fillStyle = "rgba(245, 158, 11, .35)"; g.fillRect(t.x - 1, t.y - t.tam, g.measureText(t.t).width + 2, t.tam * 1.25); }
      g.fillStyle = "#000"; g.fillText(t.t, t.x, t.y);
    }
  }
  return lz;
}

/** El renglón de la foto original, con el dato enmarcado: para compararlo con lo que se leyó. */
export function renglonDeOriginal(img: HTMLImageElement, z: Zona, anchoSalida = 1100): string {
  const w = img.naturalWidth, h = img.naturalHeight;
  const sy = z.y0 / 1000 * h, sh = Math.max(4, (z.y1 - z.y0) / 1000 * h);
  // Si el dato ocupa poco, se acerca: se ve la mitad de la hoja alrededor de él y no toda.
  const centro = (z.x0 + z.x1) / 2, ancho = Math.min(1000, Math.max(500, (z.x1 - z.x0) * 1.5));
  const xi = Math.max(0, Math.min(1000 - ancho, centro - ancho / 2));
  const sx = xi / 1000 * w, sw = ancho / 1000 * w;
  const e = anchoSalida / sw;
  const c = lienzo(anchoSalida, sh * e), g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  g.strokeStyle = "#f59e0b"; g.lineWidth = 2.5;
  g.strokeRect((z.x0 / 1000 * w - sx) * e, 1.5, (z.x1 - z.x0) / 1000 * w * e, c.height - 3);
  return c.toDataURL("image/jpeg", 0.88);
}

export interface FuentesPdf { normal: PDFFont; negrilla: PDFFont; medir: Medir; limpio: (t: string) => string }
/** La letra del PDF (Helvetica, la misma medida de Arial). Lo que esa letra no tenga va sin tilde, o con «?»: nunca revienta. */
export async function fuentesPdf(pdf: PDFDocument): Promise<FuentesPdf> {
  const normal = await pdf.embedFont(StandardFonts.Helvetica), negrilla = await pdf.embedFont(StandardFonts.HelveticaBold);
  const juego = new Set(normal.getCharacterSet());
  const limpio = (t: string) => [...t].map((ch) => { if (juego.has(ch.codePointAt(0)!)) return ch; const b = ch.normalize("NFD")[0]; return juego.has(b.codePointAt(0)!) ? b : "?"; }).join("");
  return { normal, negrilla, limpio, medir: (t, tam, b) => (b ? negrilla : normal).widthOfTextAtSize(limpio(t), tam) };
}

const aBytes = (c: HTMLCanvasElement, tipo: string, calidad?: number) => new Promise<ArrayBuffer>((ok, mal) => c.toBlob((b) => (b ? void b.arrayBuffer().then(ok, mal) : mal(new Error("No se pudo armar la imagen."))), tipo, calidad));

async function dibujarEnPdf(pdf: PDFDocument, pagina: PDFPage, c: Compuesta, f: FuentesPdf, img: HTMLImageElement | null) {
  const Y = (y: number) => c.h - y;
  for (const t of c.trazos) {
    if (t.k === "caja") pagina.drawRectangle({ x: t.x, y: Y(t.y + t.h), width: t.w, height: t.h, color: rgb(0.8, 0.8, 0.8) });
    else if (t.k === "linea") pagina.drawLine({ start: { x: t.x0, y: Y(t.y0) }, end: { x: t.x1, y: Y(t.y1) }, thickness: t.grosor, color: t.gris ? rgb(0.55, 0.55, 0.55) : rgb(0, 0, 0) });
    else if (t.k === "recorte") {
      if (!img) continue;
      const q = zonaDeFoto(img, t.r);
      const lz = lienzo(q.sw, q.sh);
      lz.getContext("2d")!.drawImage(img, q.sx, q.sy, q.sw, q.sh, 0, 0, lz.width, lz.height);
      // En PNG: así no se confunde con la foto de la hoja que imagenesDelPdf saca para editar.
      const png = await pdf.embedPng(await aBytes(lz, "image/png"));
      pagina.drawImage(png, { x: t.x, y: Y(t.y + t.h), width: t.w, height: t.h });
    } else pagina.drawText(f.limpio(t.t), { x: t.x, y: Y(t.y), size: t.tam, font: t.negrilla ? f.negrilla : f.normal, color: rgb(0, 0, 0) });
  }
}

/**
 * El PDF: texto real, tamaño carta. Cada hoja lleva además su foto en JPEG sin dibujar, en los recursos de la página (no
 * se ve ni se imprime): con ella el documento funciona igual que cualquier escaneo en lo que trabaja con fotos
 * (Editar, «Crear un trámite nuevo» que lee las hojas, Juntar en el expediente: ver imagenesDelPdf).
 */
export async function armarPdfDocumento(hojas: { pagina: PaginaLeida; imagen: HTMLImageElement | null }[], titulo: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(titulo);
  pdf.setCreator("Nexum Tránsito");
  pdf.setProducer("Nexum Tránsito");
  const f = await fuentesPdf(pdf);
  for (const h of hojas) {
    const prop = h.imagen ? h.imagen.naturalWidth / h.imagen.naturalHeight : 0.77;
    const c = componer(h.pagina, prop, f.medir);
    const pagina = pdf.addPage([c.w, c.h]);
    await dibujarEnPdf(pdf, pagina, c, f, h.imagen);
    const foto = await pdf.embedJpg(await aBytes(dibujarEnLienzo(c, h.imagen, 200 / 72, false), "image/jpeg", 0.8));
    pagina.node.newXObject("FotoHoja", foto.ref);
  }
  return pdf.save();
}
