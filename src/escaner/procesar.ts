/*
 * Escáner de documentos en el navegador (sin servicios externos):
 * 1) detectarBordes: encuentra la hoja en la foto (la zona clara más grande contra un fondo más oscuro, o al revés)
 *    y devuelve sus 4 esquinas; si no la encuentra, propone un recuadro y las esquinas se ajustan a mano.
 *    Para cédulas y tarjetas, detectarTarjetas: el modelo entrenado (modelo.ts) encuentra todas las de la foto.
 * 2) enderezar: corrige la perspectiva (homografía) y deja la hoja derecha, como vista desde arriba.
 * 3) aplicarFiltro: "documento" (fondo blanco parejo y letra nítida, como un escáner), "color" (colores con fondo
 *    limpio) u "original"; y "bn" (blanco y negro).
 * 4) armarPdf: una página por hoja (carta, ajustada) o, para cédulas y tarjetas, las dos caras en una hoja carta al 150 %.
 */
import { PDFDocument } from "pdf-lib";
import { encontrarDocumento } from "./encuadre";

export interface Punto { x: number; y: number }
/** Esquinas en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda (en píxeles de la foto). */
export type Esquinas = [Punto, Punto, Punto, Punto];
export type Filtro = "documento" | "color" | "bn" | "original";

const LADO_DETECCION = 360;
const LADO_SALIDA = 2000;

/** Carga la foto respetando la orientación del celular. */
export async function cargarImagen(archivo: Blob): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  // Se limita a 3000 px: de sobra para un documento y no revienta la memoria del celular.
  const k = Math.min(1, 3000 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return c;
}

/** Umbral de Otsu sobre un histograma de 256 niveles. */
function otsu(hist: number[], total: number) {
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const v = pesoB * pesoF * (mB - mF) ** 2;
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}

/** La zona conectada más grande de la máscara (4 vecinos). Devuelve sus píxeles. */
function zonaMayor(mascara: Uint8Array, w: number, h: number) {
  const visto = new Uint8Array(w * h);
  const pila = new Int32Array(w * h);
  let mejor: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mascara[i] || visto[i]) continue;
    const zona: number[] = [];
    let tope = 0;
    pila[tope++] = i; visto[i] = 1;
    while (tope) {
      const j = pila[--tope]; zona.push(j);
      const x = j % w, y = (j - x) / w;
      if (x > 0 && mascara[j - 1] && !visto[j - 1]) { visto[j - 1] = 1; pila[tope++] = j - 1; }
      if (x < w - 1 && mascara[j + 1] && !visto[j + 1]) { visto[j + 1] = 1; pila[tope++] = j + 1; }
      if (y > 0 && mascara[j - w] && !visto[j - w]) { visto[j - w] = 1; pila[tope++] = j - w; }
      if (y < h - 1 && mascara[j + w] && !visto[j + w]) { visto[j + w] = 1; pila[tope++] = j + w; }
    }
    if (zona.length > mejor.length) mejor = zona;
  }
  return mejor;
}

/** Recuadro por defecto (si no se encuentra la hoja): el 90 % central. */
export const recuadro = (w: number, h: number): Esquinas => [{ x: w * 0.05, y: h * 0.05 }, { x: w * 0.95, y: h * 0.05 }, { x: w * 0.95, y: h * 0.95 }, { x: w * 0.05, y: h * 0.95 }];

/**
 * Esquinas de la hoja. La hoja suele ser la zona clara más grande (papel sobre una mesa o un escritorio); si lo claro
 * ocupa casi todo, se prueba con lo oscuro. Las esquinas son los extremos de la zona en las diagonales.
 */
export function detectarBordes(foto: HTMLCanvasElement, modo: "hoja" | "tarjeta" = "hoja"): { esquinas: Esquinas; encontrada: boolean } {
  // El encuadre nuevo (por bordes, color y brillo, ver encuadre.ts); si no encuentra nada que parezca un documento, el de antes.
  const e = encontrarDocumento(foto, modo);
  if (e) return { esquinas: e.esquinas, encontrada: true };
  return detectarBordesClasico(foto);
}

/**
 * Las cédulas o tarjetas de la foto, con el modelo entrenado para eso (modelo.ts): todas las que haya (la fotocopia con
 * las dos caras da dos), en orden de lectura. Si el modelo no carga (sin internet la primera vez), el encuadre de antes.
 * `encontrada` en falso: el modelo no vio ninguna tarjeta (se ajusta a mano o va la foto entera).
 */
export async function detectarTarjetas(foto: HTMLCanvasElement): Promise<{ tarjetas: Esquinas[]; encontrada: boolean }> {
  let tarjetas: Esquinas[];
  try {
    const { detectarConModelo } = await import("./modelo");
    tarjetas = await detectarConModelo(foto);
  } catch {
    const d = detectarBordes(foto, "tarjeta");
    return { tarjetas: [d.esquinas], encontrada: d.encontrada };
  }
  return tarjetas.length ? { tarjetas, encontrada: true } : { tarjetas: [recuadro(foto.width, foto.height)], encontrada: false };
}
/** Empieza a bajar el modelo de tarjetas (al entrar al escáner en modo cédula). */
export function precargarTarjetas() { import("./modelo").then((m) => m.precargarModelo(), () => {}); }

/** El encuadre de antes (la zona clara u oscura más grande): si el nuevo no encuentra nada. */
export function detectarBordesClasico(foto: HTMLCanvasElement): { esquinas: Esquinas; encontrada: boolean } {
  const k = LADO_DETECCION / Math.max(foto.width, foto.height);
  const w = Math.max(1, Math.round(foto.width * k)), h = Math.max(1, Math.round(foto.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.filter = "blur(2px)";
  cx.drawImage(foto, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const gris = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) { const g = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114); gris[i] = g; hist[g]++; }
  const t = otsu(hist, w * h);
  const area = w * h;
  for (const claro of [true, false]) {
    const mascara = new Uint8Array(area);
    for (let i = 0; i < area; i++) mascara[i] = (claro ? gris[i] > t : gris[i] <= t) ? 1 : 0;
    const zona = zonaMayor(mascara, w, h);
    const fraccion = zona.length / area;
    if (fraccion < 0.12 || fraccion > 0.97) continue;
    let tl = zona[0], tr = zona[0], br = zona[0], bl = zona[0];
    const xy = (j: number) => { const x = j % w; return [x, (j - x) / w] as const; };
    let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    for (const j of zona) {
      const [x, y] = xy(j);
      if (x + y < sMin) { sMin = x + y; tl = j; }
      if (x + y > sMax) { sMax = x + y; br = j; }
      if (x - y > dMax) { dMax = x - y; tr = j; }
      if (x - y < dMin) { dMin = x - y; bl = j; }
    }
    const aFoto = (j: number): Punto => { const [x, y] = xy(j); return { x: (x + 0.5) / k, y: (y + 0.5) / k }; };
    const esq: Esquinas = [aFoto(tl), aFoto(tr), aFoto(br), aFoto(bl)];
    // El cuadrilátero debe tener un área razonable (si las esquinas colapsan, no es una hoja).
    if (areaCuadrilatero(esq) < 0.1 * foto.width * foto.height) continue;
    return { esquinas: esq, encontrada: true };
  }
  return { esquinas: recuadro(foto.width, foto.height), encontrada: false };
}

const areaCuadrilatero = (q: Esquinas) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

/** Homografía que lleva puntos del rectángulo destino a la foto (8 incógnitas, eliminación de Gauss). */
function homografia(destino: Punto[], origen: Punto[]) {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = destino[i], { x, y } = origen[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((fila, i) => fila[8] / fila[i]);
  return [...h, 1];
}

/** Proporción (lado corto / lado largo) de los tamaños de papel que se usan en trámites y de las tarjetas (ISO ID-1). */
const PROPORCION = { carta: 215.9 / 279.4, oficio: 215.9 / 330, tarjeta: 54 / 85.6 };

/**
 * Proporción final de la hoja. En la foto, la perspectiva acorta el lado lejano, así que la medida de los lados es
 * aproximada: una cédula o tarjeta siempre mide 85,6 x 54 mm; una hoja se lleva a carta u oficio si está cerca
 * (hasta 12 %); si no se parece a ninguno (un recibo, por ejemplo) se deja como se midió.
 */
export function proporcionFinal(medida: number, modo: "hoja" | "tarjeta") {
  if (modo === "tarjeta") return PROPORCION.tarjeta;
  const cerca = (objetivo: number) => Math.abs(medida - objetivo) / objetivo <= 0.12;
  const candidata = medida >= (PROPORCION.carta + PROPORCION.oficio) / 2 ? PROPORCION.carta : PROPORCION.oficio;
  return cerca(candidata) ? candidata : medida;
}

/** Endereza la hoja (lado mayor hasta 2000 px) con la proporción de su tamaño de papel. */
export function enderezar(foto: HTMLCanvasElement, q: Esquinas, modo: "hoja" | "tarjeta" = "hoja"): HTMLCanvasElement {
  let ancho = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let alto = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const prop = proporcionFinal(Math.min(ancho, alto) / Math.max(ancho, alto), modo);
  if (ancho >= alto) alto = ancho * prop; else ancho = alto * prop;
  const k = Math.min(1.5, LADO_SALIDA / Math.max(ancho, alto));
  ancho = Math.max(10, Math.round(ancho * k)); alto = Math.max(10, Math.round(alto * k));
  const H = homografia([{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }], q);
  const src = foto.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, foto.width, foto.height);
  const s = src.data, W = foto.width, Hh = foto.height;
  const out = document.createElement("canvas");
  out.width = ancho; out.height = alto;
  const dst = out.getContext("2d")!.createImageData(ancho, alto);
  const o = dst.data;
  for (let v = 0; v < alto; v++) {
    for (let u = 0; u < ancho; u++) {
      const z = H[6] * u + H[7] * v + H[8];
      const x = (H[0] * u + H[1] * v + H[2]) / z, y = (H[3] * u + H[4] * v + H[5]) / z;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(Hh - 2, Math.floor(y)));
      const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const j = (v * ancho + u) * 4;
      for (let c = 0; c < 3; c++) {
        o[j + c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
      }
      o[j + 3] = 255;
    }
  }
  out.getContext("2d")!.putImageData(dst, 0, 0);
  return out;
}

/** Gira 90° a la derecha. */
export function girar(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement("canvas");
  o.width = c.height; o.height = c.width;
  const x = o.getContext("2d")!;
  x.translate(o.width, 0);
  x.rotate(Math.PI / 2);
  x.drawImage(c, 0, 0);
  return o;
}

/**
 * Fondo de la hoja (iluminación): se achica la imagen, se le quita la letra con un "máximo" local (la letra es más
 * oscura que el papel) y se suaviza. Dividir por este fondo deja el papel blanco parejo aunque haya sombras.
 */
function fondoDe(c: HTMLCanvasElement) {
  const w = Math.max(8, Math.round(c.width / 12)), h = Math.max(8, Math.round(c.height / 12));
  const p = document.createElement("canvas");
  p.width = w; p.height = h;
  const px = p.getContext("2d", { willReadFrequently: true })!;
  px.drawImage(c, 0, 0, w, h);
  const d = px.getImageData(0, 0, w, h).data;
  let L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // Máximo local (radio 2) dos veces: borra la letra.
  for (let paso = 0; paso < 2; paso++) {
    const M = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
        m = Math.max(m, L[yy * w + xx]);
      }
      M[y * w + x] = m;
    }
    L = M;
  }
  // Suavizado (promedio 5x5).
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += L[yy * w + xx]; n++; }
    }
    S[y * w + x] = Math.max(40, s / n);
  }
  return { S, w, h };
}

/** Deja la hoja como escaneada. */
export function aplicarFiltro(c: HTMLCanvasElement, filtro: Filtro): HTMLCanvasElement {
  const o = document.createElement("canvas");
  o.width = c.width; o.height = c.height;
  const ox = o.getContext("2d", { willReadFrequently: true })!;
  ox.drawImage(c, 0, 0);
  if (filtro === "original") return o;
  const img = ox.getImageData(0, 0, o.width, o.height);
  const d = img.data;
  const { S, w, h } = fondoDe(c);
  const W = o.width, H = o.height;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, (y / H) * h), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, (x / W) * w), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const fondo = (S[y0 * w + x0] * (1 - tx) + S[y0 * w + x1] * tx) * (1 - ty) + (S[y1 * w + x0] * (1 - tx) + S[y1 * w + x1] * tx) * ty;
      const i = (y * W + x) * 4;
      if (filtro === "color") {
        // Cada color dividido por el fondo: papel blanco, tintas y sellos conservan su color.
        for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.pow(Math.min(1, d[i + k] / fondo), 1.6) * 255);
      } else {
        const n = Math.min(1, (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / fondo);
        // Documento: lo que está cerca del papel queda blanco y la letra se oscurece. B/N: corte duro.
        const v = filtro === "bn" ? (n > 0.72 ? 255 : 0) : Math.round(Math.pow(Math.min(1, Math.max(0, (n - 0.25) / 0.62)), 1.8) * 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
  }
  ox.putImageData(img, 0, 0);
  return o;
}

/** Proceso completo de una página. */
export function procesarPagina(foto: HTMLCanvasElement, q: Esquinas, filtro: Filtro, giros: number, modo: "hoja" | "tarjeta" = "hoja") {
  let c = enderezar(foto, q, modo);
  for (let i = 0; i < ((giros % 4) + 4) % 4; i++) c = girar(c);
  return aplicarFiltro(c, filtro);
}

/**
 * Cómo queda la página, rápido (para verlo mientras se mueven las esquinas, se gira o se cambia el filtro): lo mismo
 * que procesarPagina sobre la foto achicada a `lado` px por el lado mayor.
 */
export function vistaPrevia(foto: HTMLCanvasElement, q: Esquinas, filtro: Filtro, giros: number, modo: "hoja" | "tarjeta", lado = 800): string {
  const k = Math.min(1, lado / Math.max(foto.width, foto.height));
  let chica = foto;
  if (k < 1) {
    chica = document.createElement("canvas");
    chica.width = Math.round(foto.width * k); chica.height = Math.round(foto.height * k);
    chica.getContext("2d")!.drawImage(foto, 0, 0, chica.width, chica.height);
  }
  const qk = q.map((p) => ({ x: p.x * k, y: p.y * k })) as Esquinas;
  return procesarPagina(chica, qk, filtro, giros, modo).toDataURL("image/jpeg", 0.8);
}

/** Las esquinas de la foto entera (sin recortar nada). */
export const fotoCompleta = (w: number, h: number): Esquinas => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

const MM = 72 / 25.4;
const CARTA = { w: 215.9 * MM, h: 279.4 * MM };
/** Cédula, licencia y tarjeta de propiedad: tamaño tarjeta (ISO ID-1), 85,6 x 54 mm. */
const TARJETA = { w: 85.6 * MM, h: 54 * MM };

async function jpeg(c: HTMLCanvasElement, calidad = 0.82) {
  const b = await new Promise<Blob>((ok, mal) => c.toBlob((x) => (x ? ok(x) : mal(new Error("No se pudo preparar la página."))), "image/jpeg", calidad));
  return new Uint8Array(await b.arrayBuffer());
}

/**
 * Dónde va cada cara de una cédula o tarjeta en la hoja carta, en puntos del PDF (y desde abajo): centradas, la primera
 * a 30 mm del borde de arriba y la segunda 20 mm más abajo. `escala`: 1 = tamaño real (85,6 x 54 mm), 1,5 = 150 %.
 */
export function cajasTarjeta(escala: number) {
  const w = TARJETA.w * escala, h = TARJETA.h * escala, x = (CARTA.w - w) / 2;
  const arriba = CARTA.h - 30 * MM - h;
  return [{ x, y: arriba, w, h }, { x, y: arriba - 20 * MM - h, w, h }];
}
/** Una cara acostada, como va en la hoja (si quedó vertical, se gira). */
const acostada = (c: HTMLCanvasElement) => (c.height > c.width ? girar(c) : c);

/**
 * Las hojas carta como van a salir (cédula o tarjeta: las caras de a dos, a la escala pedida), en imágenes de `ancho`
 * px, para verlas antes de guardar o descargar.
 */
export async function vistaHojasTarjeta(caras: HTMLCanvasElement[], escala: number, ancho = 320): Promise<string[]> {
  const k = ancho / CARTA.w, hojas: string[] = [];
  for (let i = 0; i < caras.length; i += 2) {
    const o = document.createElement("canvas");
    o.width = Math.round(CARTA.w * k); o.height = Math.round(CARTA.h * k);
    const g = o.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
    caras.slice(i, i + 2).forEach((c, j) => {
      const b = cajasTarjeta(escala)[j];
      g.drawImage(acostada(c), b.x * k, (CARTA.h - b.y - b.h) * k, b.w * k, b.h * k);
    });
    hojas.push(o.toDataURL("image/jpeg", 0.85));
  }
  return hojas;
}

/**
 * PDF del escaneo.
 * - "hoja": una página carta por hoja (vertical u horizontal según la hoja), con 6 mm de margen.
 * - "tarjeta": cédula o tarjeta; las dos caras (página 1 y 2, 3 y 4...) en una hoja carta, cada una a `escala`
 *   (1,5 = 150 %, como siempre; 1 = tamaño real).
 */
export async function armarPdf(paginas: HTMLCanvasElement[], modo: "hoja" | "tarjeta", titulo: string, escala = 1.5) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(titulo);
  pdf.setCreator("Nexum · Trámites Pira");
  if (modo === "hoja") {
    for (const c of paginas) {
      const horizontal = c.width > c.height;
      const pw = horizontal ? CARTA.h : CARTA.w, ph = horizontal ? CARTA.w : CARTA.h;
      const pagina = pdf.addPage([pw, ph]);
      const img = await pdf.embedJpg(await jpeg(c));
      const m = 6 * MM;
      const k = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
      const w = c.width * k, h = c.height * k;
      pagina.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  } else {
    for (let i = 0; i < paginas.length; i += 2) {
      const pagina = pdf.addPage([CARTA.w, CARTA.h]);
      const caras = paginas.slice(i, i + 2);
      for (let j = 0; j < caras.length; j++) {
        // Cada cara a la escala pedida; si la foto quedó vertical, se acuesta.
        const img = await pdf.embedJpg(await jpeg(acostada(caras[j]), 0.88));
        const b = cajasTarjeta(escala)[j];
        pagina.drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h });
      }
    }
  }
  return pdf.save();
}

/**
 * Las caras de una cédula o tarjeta (ya enderezadas) en una sola imagen, una debajo de la otra y acostadas, para
 * leerlas juntas: el frente trae el nombre y el número; el respaldo, el nacimiento y la expedición (o la potencia y el
 * organismo, en la tarjeta de propiedad).
 */
export async function juntarCaras(caras: string[]): Promise<string> {
  const imgs = await Promise.all(caras.map(async (u) => {
    const i = new Image(); i.src = u; await i.decode();
    const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
    c.getContext("2d")!.drawImage(i, 0, 0);
    return c.height > c.width ? girar(c) : c;
  }));
  const ancho = Math.max(...imgs.map((c) => c.width)), espacio = 40;
  const o = document.createElement("canvas");
  o.width = ancho; o.height = imgs.reduce((s, c) => s + c.height, 0) + espacio * (imgs.length - 1);
  const g = o.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
  let y = 0;
  for (const c of imgs) { g.drawImage(c, (ancho - c.width) / 2, y); y += c.height + espacio; }
  return o.toDataURL("image/jpeg", 0.88);
}
