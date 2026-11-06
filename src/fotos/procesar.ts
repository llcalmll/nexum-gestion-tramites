/*
 * Foto 3x4 con fondo blanco, todo en el navegador (la foto no sale a ningún servicio externo):
 * 1) MediaPipe FaceDetector ubica la cara (y los ojos) para el modo "Más cerca".
 * 2) MediaPipe ImageSegmenter (selfie_multiclass_256x256) da qué es persona y qué es fondo.
 * 3) La máscara se limpia (una sola figura, sin pedazos sueltos ni huecos) y el borde se ajusta a la foto con un
 *    filtro guiado: sigue el contorno real de pelo y hombros en vez de la máscara gruesa de 256 px.
 * 4) Fondo: "quitar" (persona sobre blanco) u "oficina" (sin recortar a la persona: la foto tal cual, con el fondo
 *    gris o apagado llevado a blanco brillante). Más ajustes de brillo, contraste, calidez, saturación y borde.
 * 5) Recorte 3:4 a 300 DPI: por defecto el mismo encuadre de la foto tomada; "Más cerca" centra la cara.
 * Modelos y motor van en public/mediapipe (Apache 2.0, de Google). Se cargan solo al abrir la pantalla de fotos.
 */
import type { FaceDetector, ImageSegmenter } from "@mediapipe/tasks-vision";

/** Bandeja fija a la que manda la app del celular (una sola persona usa Nexum). 16 caracteres, como las sesiones. */
export const BANDEJA = "bandejaprincipal";

export const DPI = 300;
const MM = DPI / 25.4;
export const ANCHO_PX = Math.round(30 * MM); // 3 cm
export const ALTO_PX = Math.round(40 * MM); // 4 cm
/** Lado mayor con el que se trabaja: de sobra para 472 px de salida y rápido en un PC normal. */
const LADO_TRABAJO = 1200;

let motor: Promise<{ cara: FaceDetector; fondo: ImageSegmenter }> | null = null;

/** Carga MediaPipe una sola vez (unos 28 MB la primera vez; luego quedan en caché del navegador). */
export function cargarMotor() {
  motor ??= (async () => {
    const { FilesetResolver, FaceDetector, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const archivos = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const crear = async (delegate: "GPU" | "CPU") => Promise.all([
      FaceDetector.createFromOptions(archivos, { baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite", delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 }),
      ImageSegmenter.createFromOptions(archivos, { baseOptions: { modelAssetPath: "/mediapipe/selfie_multiclass_256x256.tflite", delegate }, runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false }),
    ]);
    // Con tarjeta gráfica es más rápido; si el navegador no deja usarla, en el procesador.
    const [cara, fondo] = await crear("GPU").catch(() => crear("CPU"));
    return { cara, fondo };
  })().catch((e) => { motor = null; throw e; });
  return motor;
}

export interface Analisis {
  /** La foto a tamaño de trabajo. */
  base: HTMLCanvasElement;
  /** Qué tan "persona" es cada píxel de `base` (máscara limpia y ajustada a la foto, sin umbral todavía). */
  confianza: Float32Array;
  /** Cara encontrada (en píxeles de `base`) y altura de los ojos; null si no se encontró. */
  cara: { x: number; y: number; ancho: number; alto: number; ojosY: number } | null;
  /** Rectángulo que contiene a la persona; null si no se ve a nadie. */
  silueta: { x: number; y: number; ancho: number; alto: number } | null;
  /** Color promedio del fondo (para blanquearlo en el modo "oficina"). */
  colorFondo: [number, number, number];
}

/** Separa a la persona del fondo, limpia la máscara y ubica la cara. */
export async function analizar(imagen: ImageBitmap): Promise<Analisis> {
  const { cara, fondo } = await cargarMotor();
  const k = Math.min(1, LADO_TRABAJO / Math.max(imagen.width, imagen.height));
  const w = Math.round(imagen.width * k), h = Math.round(imagen.height * k);
  const base = document.createElement("canvas");
  base.width = w; base.height = h;
  const bc = base.getContext("2d", { willReadFrequently: true })!;
  bc.imageSmoothingQuality = "high";
  bc.drawImage(imagen, 0, 0, w, h);

  const det = cara.detect(base).detections.sort((a, b) => (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0) - (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0))[0];
  const bb = det?.boundingBox;
  const ojos = det?.keypoints?.slice(0, 2) ?? [];
  const caraEncontrada = bb ? { x: bb.originX, y: bb.originY, ancho: bb.width, alto: bb.height, ojosY: ojos.length === 2 ? ((ojos[0].y + ojos[1].y) / 2) * h : bb.originY + bb.height * 0.38 } : null;

  // Máscara del modelo: confianza de "fondo" (categoría 0); persona = 1 - fondo.
  const r = fondo.segment(base);
  const mascara = r.confidenceMasks?.[0];
  if (!mascara) { r.close(); throw new Error("No se pudo separar a la persona del fondo."); }
  const mw = mascara.width, mh = mascara.height;
  const conf = mascara.getAsFloat32Array();
  const baja = new Float32Array(mw * mh);
  for (let i = 0; i < baja.length; i++) baja[i] = 1 - conf[i];
  r.close();
  limpiarMascara(baja, mw, mh);

  // Al tamaño de trabajo (bilineal) y borde ajustado a la foto con el filtro guiado.
  const p = escalar(baja, mw, mh, w, h);
  const datos = bc.getImageData(0, 0, w, h).data;
  const gris = new Float32Array(w * h);
  for (let i = 0; i < gris.length; i++) gris[i] = (datos[i * 4] * 0.299 + datos[i * 4 + 1] * 0.587 + datos[i * 4 + 2] * 0.114) / 255;
  const radio = Math.max(4, Math.round(Math.max(w, h) / 150));
  const q = filtroGuiado(gris, p, w, h, radio, 1e-3);
  const alfa = alfaDe(q, 0);

  // Silueta y color del fondo (promedio de lo que es claramente fondo).
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (alfa[i] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    else if (alfa[i] < 0.02) { sr += datos[i * 4]; sg += datos[i * 4 + 1]; sb += datos[i * 4 + 2]; n++; }
  }
  const silueta = x1 >= 0 ? { x: x0, y: y0, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 } : null;
  const colorFondo: [number, number, number] = n ? [sr / n, sg / n, sb / n] : [255, 255, 255];
  return { base, confianza: q, cara: caraEncontrada, silueta, colorFondo };
}

export const suave = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Persona (1) / fondo (0) a partir de la confianza. `borde` de -50 (más ajustado) a 50 (más holgado). */
function alfaDe(q: Float32Array, borde: number) {
  const desde = 0.2 - (borde / 50) * 0.18;
  const alfa = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) alfa[i] = suave((q[i] - desde) / 0.6);
  return alfa;
}
const UMBRAL = 0.5;

/**
 * Para los fondos de color, donde se nota lo que la máscara se llevó de la pared (un halo alrededor de la cabeza y las
 * orejas): cerca del borde, lo que se parece al color del fondo de la foto deja de ser persona.
 */
function afinarBorde(alfa: Float32Array, d: Uint8ClampedArray, w: number, h: number, colorFondo: [number, number, number]) {
  const radio = Math.max(3, Math.round(Math.max(w, h) / 120));
  const cerca = media(alfa, w, h, radio);
  const out = new Float32Array(alfa.length);
  for (let i = 0; i < alfa.length; i++) {
    const banda = 1 - suave((cerca[i] - 0.82) / 0.16);
    if (alfa[i] <= 0 || banda <= 0) { out[i] = alfa[i]; continue; }
    const o = i * 4;
    const dist = (Math.abs(d[o] - colorFondo[0]) + Math.abs(d[o + 1] - colorFondo[1]) + Math.abs(d[o + 2] - colorFondo[2])) / 3;
    out[i] = alfa[i] * (1 - banda * (1 - suave((dist - 14) / 36)));
  }
  return media(out, w, h, 1);
}

/** Etiqueta las zonas conectadas (4 vecinos) donde `dentro(i)` es verdadero; devuelve etiquetas y tamaños. */
function zonas(w: number, h: number, dentro: (i: number) => boolean) {
  const n = w * h;
  const etiqueta = new Int32Array(n).fill(-1);
  const tam: number[] = [];
  const pila = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (etiqueta[i] >= 0 || !dentro(i)) continue;
    const id = tam.length;
    let tope = 0, cuenta = 0;
    pila[tope++] = i; etiqueta[i] = id;
    while (tope) {
      const j = pila[--tope]; cuenta++;
      const x = j % w, y = (j - x) / w;
      if (x > 0 && etiqueta[j - 1] < 0 && dentro(j - 1)) { etiqueta[j - 1] = id; pila[tope++] = j - 1; }
      if (x < w - 1 && etiqueta[j + 1] < 0 && dentro(j + 1)) { etiqueta[j + 1] = id; pila[tope++] = j + 1; }
      if (y > 0 && etiqueta[j - w] < 0 && dentro(j - w)) { etiqueta[j - w] = id; pila[tope++] = j - w; }
      if (y < h - 1 && etiqueta[j + w] < 0 && dentro(j + w)) { etiqueta[j + w] = id; pila[tope++] = j + w; }
    }
    tam.push(cuenta);
  }
  return { etiqueta, tam };
}

/**
 * Deja una sola figura sobre la máscara de 256 px:
 * - se queda con la parte de persona más grande (descarta pedazos sueltos: una manija, una sombra, otra cabeza al fondo);
 * - rellena huecos pequeños dentro de ella (reflejos en la ropa, el ojo o el botón que el modelo dejó como fondo);
 * - lo que esté lejos de la figura queda en fondo puro (sin halos grises).
 */
function limpiarMascara(m: Float32Array, w: number, h: number) {
  const n = w * h;
  const persona = zonas(w, h, (i) => m[i] >= UMBRAL);
  if (!persona.tam.length) return;
  const mayor = persona.tam.indexOf(Math.max(...persona.tam));
  const enFigura = (i: number) => persona.etiqueta[i] === mayor;

  // Huecos: zonas de no-figura que no tocan el borde de la imagen y son pequeñas (< 1,5 % de la foto).
  const resto = zonas(w, h, (i) => !enFigura(i));
  const tocaBorde = new Uint8Array(resto.tam.length);
  for (let x = 0; x < w; x++) for (const j of [x, (h - 1) * w + x]) if (resto.etiqueta[j] >= 0) tocaBorde[resto.etiqueta[j]] = 1;
  for (let y = 0; y < h; y++) for (const j of [y * w, y * w + w - 1]) if (resto.etiqueta[j] >= 0) tocaBorde[resto.etiqueta[j]] = 1;
  const hueco = (id: number) => !tocaBorde[id] && resto.tam[id] < n * 0.015;

  // Cerca de la figura (3 px a 256) se respeta la confianza suave del modelo para que el borde sea gradual.
  const cerca = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (enFigura(i)) cerca[i] = 1;
  for (let paso = 0; paso < 3; paso++) {
    const antes = cerca.slice();
    for (let i = 0; i < n; i++) {
      if (antes[i]) continue;
      const x = i % w;
      if ((x > 0 && antes[i - 1]) || (x < w - 1 && antes[i + 1]) || (i >= w && antes[i - w]) || (i < n - w && antes[i + w])) cerca[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (enFigura(i)) continue;
    const id = resto.etiqueta[i];
    if (id >= 0 && hueco(id)) m[i] = 1;
    else m[i] = cerca[i] ? Math.min(m[i], UMBRAL - 0.01) : 0;
  }
}

/** Escalado bilineal de una máscara. */
function escalar(m: Float32Array, w: number, h: number, W: number, H: number) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const a = m[y0 * w + x0] * (1 - tx) + m[y0 * w + x1] * tx, b = m[y1 * w + x0] * (1 - tx) + m[y1 * w + x1] * tx;
      out[y * W + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Media en una ventana de (2r+1)^2 con imagen integral (en los bordes, la ventana se recorta). */
export function media(src: Float32Array, w: number, h: number, r: number) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) { fila += src[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + fila; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const s = ii[yb * (w + 1) + xb] - ii[ya * (w + 1) + xb] - ii[yb * (w + 1) + xa] + ii[ya * (w + 1) + xa];
      out[y * w + x] = s / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}

/** Filtro guiado (He, Sun y Tang, 2010): ajusta la máscara p a los bordes de la imagen guía I. */
export function filtroGuiado(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = media(I, w, h, r), mp = media(p, w, h, r), mIp = media(Ip, w, h, r), mII = media(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i], vari = mII[i] - mI[i] * mI[i];
    a[i] = cov / (vari + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = media(a, w, h, r), mb = media(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

export interface Ajustes {
  /** "quitar": recorta a la persona y la pone sobre blanco. "oficina": no la recorta; blanquea el fondo de la foto. */
  modo: "quitar" | "oficina";
  /** 0 a 100: cuánto se blanquea el fondo de la oficina. */
  blanqueo: number;
  /** -50 a 50: recorte más ajustado (quita más borde) o más holgado (deja más pelo y contorno). */
  borde: number;
  /** -50 a 50 cada uno; 0 = la calibración de la oficina (BASE_COLOR). */
  brillo: number;
  contraste: number;
  calidez: number;
  saturacion: number;
}
export const AJUSTES_INICIALES: Ajustes = { modo: "quitar", blanqueo: 80, borde: 0, brillo: 0, contraste: 0, calidez: 0, saturacion: 0 };
/** Lo que brillo 0 y contraste 0 le suman a la foto como llegó: la calibración de la oficina. */
export const BASE_COLOR = { brillo: 25, contraste: 25 };
/** Preajustes de color: un clic deja brillo, contraste, calidez y saturación así (el fondo y el borde no se tocan). */
export const PREAJUSTES: { nombre: string; valores: Pick<Ajustes, "brillo" | "contraste" | "calidez" | "saturacion"> }[] = [
  { nombre: "Normal", valores: { brillo: 0, contraste: 0, calidez: 0, saturacion: 0 } },
  { nombre: "Equilibrado", valores: { brillo: -5, contraste: -5, calidez: 0, saturacion: 0 } },
];

export const aRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * La foto a tamaño de trabajo con el color y el fondo resueltos. `fondo`: el color que queda detrás (#rrggbb).
 * `retocar`: lo que se le hace a la cara (ver retoque.ts), sobre los píxeles de la foto, antes del color.
 */
export function componer(a: Analisis, f: Ajustes, fondo = "#ffffff", retocar?: (d: Uint8ClampedArray) => void): HTMLCanvasElement {
  const { base, colorFondo } = a;
  const w = base.width, h = base.height;
  const img = base.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const d = img.data;
  const destino = aRgb(fondo);
  const conColor = destino.some((c) => c < 255);
  const alfa = conColor ? afinarBorde(alfaDe(a.confianza, f.borde), d, w, h, colorFondo) : alfaDe(a.confianza, f.borde);
  retocar?.(d);
  // Sobre un fondo de color se notaría el halo de la pared en el borde del pelo: se le quita al píxel lo que traía del fondo de la foto.
  if (conColor && f.modo === "quitar") {
    for (let i = 0; i < alfa.length; i++) {
      const al = alfa[i], o = i * 4;
      if (al <= 0.02 || al >= 0.98) continue;
      const k = Math.max(0.15, al);
      for (let c = 0; c < 3; c++) d[o + c] = (d[o + c] - (1 - k) * colorFondo[c]) / k;
    }
  }
  // Color de la persona (y de la foto): calidez, brillo, contraste y saturación, en ese orden.
  const cal = f.calidez / 50 * 25, bri = (f.brillo + BASE_COLOR.brillo) / 50 * 60, con = 1 + (f.contraste + BASE_COLOR.contraste) / 50 * 0.5, sat = 1 + f.saturacion / 50;
  if (cal || bri || con !== 1 || sat !== 1) {
    for (let o = 0; o < d.length; o += 4) {
      let r = d[o] + cal, g = d[o + 1], b = d[o + 2] - cal;
      r = (r + bri - 128) * con + 128; g = (g + bri - 128) * con + 128; b = (b + bri - 128) * con + 128;
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      d[o] = l + (r - l) * sat; d[o + 1] = l + (g - l) * sat; d[o + 2] = l + (b - l) * sat;
    }
  }
  if (f.modo === "quitar") {
    for (let i = 0; i < alfa.length; i++) {
      const al = alfa[i], o = i * 4;
      d[o] = d[o] * al + destino[0] * (1 - al); d[o + 1] = d[o + 1] * al + destino[1] * (1 - al); d[o + 2] = d[o + 2] * al + destino[2] * (1 - al);
    }
  } else {
    // 1) Balance de blancos: ganancia por canal para que el color del fondo llegue a blanco (quita lo gris o
    //    amarillento). En la persona se aplica con menos fuerza, para aclarar sin quemar la piel.
    //    Con tope: está pensado para una pared blanca mal iluminada, no para un fondo oscuro o de color.
    // 2) Lo que es fondo y además se parece al color del fondo se lleva a blanco puro. Como también mira el color,
    //    un mechón o el hombro que el modelo dude no se borra: la persona no se recorta.
    const t = Math.min(1, Math.max(0, f.blanqueo / 100));
    const g = colorFondo.map((c) => Math.min(1.35, 255 / Math.max(40, c)) - 1);
    for (let i = 0; i < alfa.length; i++) {
      const o = i * 4, esFondo = 1 - alfa[i];
      const fuerza = t * (0.35 + 0.65 * esFondo);
      let dist = 0;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(255, d[o + c] * (1 + g[c] * fuerza));
        d[o + c] = v;
        dist += 255 - v;
      }
      const parecido = 1 - suave(dist / 3 / 70);
      // Al 100 % todo el fondo queda blanco aunque no se parezca; más abajo, solo lo parecido.
      // Con un fondo de color no hay matices: lo que es fondo pasa a ese color (si no, queda blanco alrededor de la persona).
      const mezcla = esFondo * Math.min(1, conColor ? t * 1.25 : t * 1.15 * (parecido + (1 - parecido) * t * t));
      for (let c = 0; c < 3; c++) d[o + c] += (destino[c] - d[o + c]) * mezcla;
    }
  }
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

export interface Encuadre {
  /** "foto": el mismo encuadre con que se tomó (recortado a 3:4). "cara": centrado en la cara, más cerca. */
  modo: "foto" | "cara";
  /** Tamaño del recorte (1 = automático; menos = persona más grande). */
  escala: number;
  /** Desplazamientos en fracción del alto del recorte (-0.4 a 0.4). */
  dx: number;
  dy: number;
}
export const ENCUADRE_INICIAL: Encuadre = { modo: "foto", escala: 1, dx: 0, dy: 0 };
/**
 * Cuántas caras caben en el alto de la foto con «Más cerca». Era 2,1 (la cara en la mitad de la foto) y quedaba muy
 * cerca: Felipe siempre le daba 7 u 8 veces «Más pequeña» (+5 % cada una, 1,375 en promedio): 2,1 × 1,375 = 2,89
 * (28/10/2026). La cara queda en ~1/3 del alto.
 */
const CARAS_POR_ALTO = 2.89;

/**
 * Recorte 3:4 a 300 DPI de la foto ya compuesta.
 * - Foto: el rectángulo 3:4 más grande que cabe (el iPhone ya toma en 3:4, así que es la foto entera, con los mismos
 *   márgenes con que se tomó), centrado en la persona a lo ancho si la foto es más ancha; "Más grande" acerca desde
 *   abajo sin cortar la cabeza.
 * - Cara: ojos a ~42 % desde arriba y la cara ocupando ~1/3 del alto (CARAS_POR_ALTO).
 */
export function recortar(a: Analisis, compuesta: HTMLCanvasElement, e: Encuadre, fondo = "#ffffff"): HTMLCanvasElement {
  const { cara, silueta } = a;
  const W = compuesta.width, H = compuesta.height;
  let altoR: number, x: number, y: number;
  if (e.modo === "cara" && cara) {
    altoR = cara.alto * CARAS_POR_ALTO * e.escala;
    x = cara.x + cara.ancho / 2 - (altoR * 3) / 8;
    y = cara.ojosY - altoR * 0.42;
  } else {
    altoR = Math.min(H, (W * 4) / 3) * e.escala;
    const anchoR = (altoR * 3) / 4;
    const cx = silueta ? silueta.x + silueta.ancho / 2 : W / 2;
    x = Math.min(W - anchoR, Math.max(0, cx - anchoR / 2));
    if (anchoR > W) x = (W - anchoR) / 2;
    // Abajo, como la foto (la persona sigue hasta el borde); al acercar, la cabeza conserva su margen.
    y = H - altoR;
    if (silueta && silueta.y < y + altoR * 0.06) y = Math.max(Math.min(0, H - altoR), silueta.y - altoR * 0.06);
  }
  const anchoR = (altoR * 3) / 4;
  x += e.dx * altoR;
  y += e.dy * altoR;
  const salida = document.createElement("canvas");
  salida.width = ANCHO_PX; salida.height = ALTO_PX;
  const c = salida.getContext("2d")!;
  c.fillStyle = fondo;
  c.fillRect(0, 0, ANCHO_PX, ALTO_PX);
  c.imageSmoothingQuality = "high";
  // Lo que quede por fuera de la foto sale del color del fondo (el lienzo ya está pintado).
  const k = ANCHO_PX / anchoR;
  const sx = Math.max(0, x), sy = Math.max(0, y), sw = Math.min(W, x + anchoR) - sx, sh = Math.min(H, y + altoR) - sy;
  if (sw > 0 && sh > 0) c.drawImage(compuesta, sx, sy, sw, sh, (sx - x) * k, (sy - y) * k, sw * k, sh * k);
  return salida;
}

/** Una foto puesta en la hoja: qué imagen y dónde (mm desde la esquina de arriba a la izquierda). */
export interface FotoEnHoja { img: CanvasImageSource; x: number; y: number }

/**
 * Cómo se arma la hoja (Configuración avanzada de Fotos 3x4): separación entre fotos (mm), si cada persona empieza
 * en una fila nueva (para recortar por persona) y si van las guías de corte grises.
 */
export interface ConfigHoja { separacion: number; filaNueva: boolean; guias: boolean }
/** De entrada, sin separación: las fotos pegadas, solo con la línea gris de corte entre una y otra (Felipe, 23/10/2026). */
export const CONFIG_HOJA: ConfigHoja = { separacion: 0, filaNueva: false, guias: true };
export const SEPARACIONES = [0, 2, 3, 5];
/** Lo mínimo que se deja a cada lado de la hoja (lo que alcanza a imprimir casi cualquier impresora). */
const MARGEN_MIN = 8;
/**
 * Arriba, un margen chiquito: las fotos empiezan casi en el borde y lo de abajo queda entero para recortarlo y volver
 * a usar la hoja (Felipe, 26/10/2026: ahorrar papel). 5 mm lo imprime casi cualquier impresora.
 */
export const MARGEN_ARRIBA = 5;

/**
 * La rejilla de la hoja carta con esa separación: cuántas fotos de 30 x 40 mm caben por fila y por columna (con al
 * menos 8 mm de margen) y dónde empieza: centrada a lo ancho y arriba, a MARGEN_ARRIBA del borde. Sin separación (y
 * con 2 o 3 mm): 6 x 6 = 36.
 */
export function rejilla(cfg: ConfigHoja = CONFIG_HOJA) {
  const sep = Math.max(0, cfg.separacion);
  const columnas = Math.max(1, Math.floor((215.9 - 2 * MARGEN_MIN + sep) / (30 + sep)));
  const filas = Math.max(1, Math.floor((279.4 - 2 * MARGEN_MIN + sep) / (40 + sep)));
  const x0 = (215.9 - (columnas * 30 + (columnas - 1) * sep)) / 2;
  const y0 = MARGEN_ARRIBA;
  return { columnas, filas, porHoja: columnas * filas, sep, x0, y0, casilla: (i: number) => ({ x: x0 + (i % columnas) * (30 + sep), y: y0 + Math.floor(i / columnas) * (40 + sep) }) };
}
/** Fotos por hoja con la configuración de entrada (sin separación). */
export const POR_HOJA = rejilla().porHoja;

/** Hoja carta a 300 DPI con las fotos de 3x4 donde digan y, si se piden, sus guías de corte (para descargarla como JPG). */
export function dibujarHoja(fotos: FotoEnHoja[], guias = true): HTMLCanvasElement {
  const hoja = document.createElement("canvas");
  hoja.width = Math.round(215.9 * MM); hoja.height = Math.round(279.4 * MM);
  const c = hoja.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, hoja.width, hoja.height);
  c.imageSmoothingQuality = "high";
  for (const f of fotos) {
    c.drawImage(f.img, Math.round(f.x * MM), Math.round(f.y * MM), ANCHO_PX, ALTO_PX);
    if (!guias) continue;
    c.strokeStyle = "#c8c8c8"; c.lineWidth = 1;
    c.strokeRect(Math.round(f.x * MM) - 0.5, Math.round(f.y * MM) - 0.5, ANCHO_PX + 1, ALTO_PX + 1);
  }
  return hoja;
}

/** Hoja de una sola persona: N fotos en filas arriba de la hoja. */
export const hojaCarta = (foto: HTMLCanvasElement, cantidad: number, cfg: ConfigHoja = CONFIG_HOJA) => dibujarHoja(posiciones(cantidad, cfg).map((p) => ({ img: foto, ...p })), cfg.guias);

/**
 * Posiciones (mm desde la esquina de la hoja) de las fotos de una sola persona: arriba (MARGEN_ARRIBA), centradas a lo
 * ancho como la hoja compartida, una fila tras otra. Así se recortan con un solo corte largo y el resto de la hoja
 * queda entero. Hasta lo que cabe en una hoja.
 */
export function posiciones(cantidad: number, cfg: ConfigHoja = CONFIG_HOJA) {
  const r = rejilla(cfg);
  const n = Math.max(1, Math.min(r.porHoja, Math.round(cantidad) || 1));
  return Array.from({ length: n }, (_, i) => ({ x: r.x0 + (i % r.columnas) * (30 + r.sep), y: r.y0 + Math.floor(i / r.columnas) * (40 + r.sep) }));
}

/**
 * Hoja compartida (varias personas en la misma hoja): reparte a las personas en hojas, en orden. Las fotos de cada
 * persona van seguidas y nunca se parten entre dos hojas (si no caben en lo que queda, la persona empieza hoja
 * nueva). Con `filaNueva`, cada persona empieza al comienzo de una fila.
 */
export function repartir<T extends { copias: number }>(personas: T[], cfg: ConfigHoja = CONFIG_HOJA): { persona: T; x: number; y: number }[][] {
  const r = rejilla(cfg);
  const hojas: { persona: T; x: number; y: number }[][] = [];
  let hoja: { persona: T; x: number; y: number }[] = [];
  let i = 0;
  for (const p of personas) {
    const n = Math.min(Math.max(1, p.copias), r.porHoja);
    let desde = cfg.filaNueva && i % r.columnas ? Math.ceil(i / r.columnas) * r.columnas : i;
    if (desde + n > r.porHoja) { hojas.push(hoja); hoja = []; desde = 0; }
    for (let k = 0; k < n; k++) hoja.push({ persona: p, ...r.casilla(desde + k) });
    i = desde + n;
  }
  if (hoja.length) hojas.push(hoja);
  return hojas;
}

/**
 * Achica la foto del celular antes de subirla (JPEG): sube rápido. 1600 px de lado mayor alcanzan de sobra para 3x4;
 * los documentos van a 2000 px para que se lean bien los números.
 */
export async function prepararParaSubir(archivo: File, lado = 1600): Promise<Blob> {
  const img = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.9));
}
