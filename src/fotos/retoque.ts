/*
 * Retoque de la cara, todo en el navegador (la foto no sale a ningún servicio externo):
 * 1) MediaPipe FaceLandmarker ubica 478 puntos de la cara (Apache 2.0, public/mediapipe/face_landmarker.task). Se carga
 *    solo la primera vez que se usa el retoque, para no demorar a quien no lo usa.
 * 2) Con esos puntos se pintan máscaras suaves (piel, ojeras, ojos, cejas, labios...) y se deja listo lo costoso, una
 *    sola vez por foto. Mover un control solo mezcla lo que ya está listo.
 * Nada cambia la forma de la cara ni borra lunares o marcas: la persona se tiene que seguir reconociendo.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { filtroGuiado, media, suave, type Analisis } from "./procesar";

/** Lo que se le hace a una sola foto. Cada control va de 0 (nada) a 100. */
export interface Retoque {
  /** Color del fondo (#rrggbb). */
  fondo: string;
  piel: number;
  tono: number;
  ojeras: number;
  brillos: number;
  ojos: number;
  cejas: number;
  delineado: number;
  labios: number;
  rubor: number;
}
type Control = Exclude<keyof Retoque, "fondo">;
export const FONDO_BLANCO = "#ffffff";
export const RETOQUE_INICIAL: Retoque = { fondo: FONDO_BLANCO, piel: 0, tono: 0, ojeras: 0, brillos: 0, ojos: 0, cejas: 0, delineado: 0, labios: 0, rubor: 0 };
export const FONDOS = [
  { nombre: "Blanco", color: FONDO_BLANCO },
  { nombre: "Azul claro", color: "#a9cceb" },
  { nombre: "Azul", color: "#438edb" },
  { nombre: "Azul oscuro", color: "#1f4e8c" },
  { nombre: "Gris", color: "#d6d8db" },
];
export const CONTROLES_PIEL: { clave: Control; nombre: string }[] = [
  { clave: "piel", nombre: "Suavizar la piel" },
  { clave: "tono", nombre: "Emparejar el tono" },
  { clave: "ojeras", nombre: "Disimular ojeras" },
  { clave: "brillos", nombre: "Quitar brillos" },
];
export const CONTROLES_ROSTRO: { clave: Control; nombre: string }[] = [
  { clave: "ojos", nombre: "Iluminar los ojos" },
  { clave: "cejas", nombre: "Definir las cejas" },
  { clave: "delineado", nombre: "Delineado" },
  { clave: "labios", nombre: "Color de labios" },
  { clave: "rubor", nombre: "Rubor" },
];
/** Un clic deja todos los controles así (el fondo no se toca). Se escoge a mano: la app no adivina si es hombre o mujer. */
export const PERFILES: { nombre: string; titulo: string; valores: Omit<Retoque, "fondo"> }[] = [
  { nombre: "Sin retoque", titulo: "La cara como salió en la foto", valores: { piel: 0, tono: 0, ojeras: 0, brillos: 0, ojos: 0, cejas: 0, delineado: 0, labios: 0, rubor: 0 } },
  { nombre: "Hombre", titulo: "Discreto: piel y brillos, sin maquillaje", valores: { piel: 25, tono: 15, ojeras: 20, brillos: 30, ojos: 10, cejas: 0, delineado: 0, labios: 0, rubor: 0 } },
  { nombre: "Mujer", titulo: "Natural: piel, y un maquillaje muy suave", valores: { piel: 40, tono: 25, ojeras: 30, brillos: 30, ojos: 20, cejas: 15, delineado: 25, labios: 20, rubor: 10 } },
  { nombre: "Mujer maquillada", titulo: "Con delineado, cejas y labios más marcados", valores: { piel: 50, tono: 30, ojeras: 40, brillos: 35, ojos: 25, cejas: 30, delineado: 55, labios: 45, rubor: 25 } },
];
const CONTROLES = [...CONTROLES_PIEL, ...CONTROLES_ROSTRO].map((c) => c.clave);
export const retoqueActivo = (r: Retoque) => CONTROLES.some((k) => r[k] > 0);

let motor: Promise<FaceLandmarker> | null = null;
function cargarRasgos() {
  motor ??= (async () => {
    const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const archivos = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const crear = (delegate: "GPU" | "CPU") => FaceLandmarker.createFromOptions(archivos, { baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate }, runningMode: "IMAGE", numFaces: 3 });
    return crear("GPU").catch(() => crear("CPU"));
  })().catch((e) => { motor = null; throw e; });
  return motor;
}

// Puntos de la malla de MediaPipe. En cada ojo, «arriba» y «abajo» van del lagrimal hacia afuera.
const OVALO = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const MANDIBULA = [132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361];
const OJOS = [
  { arriba: [133, 173, 157, 158, 159, 160, 161, 246, 33], abajo: [133, 155, 154, 153, 145, 144, 163, 7, 33], iris: 468, borde: 469, ojera: [130, 25, 110, 24, 23, 22, 26, 112, 243, 245, 128, 121, 120, 119, 118, 117, 111, 143], ceja: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], mejilla: 50 },
  { arriba: [362, 398, 384, 385, 386, 387, 388, 466, 263], abajo: [362, 382, 381, 380, 374, 373, 390, 249, 263], iris: 473, borde: 474, ojera: [359, 255, 339, 254, 253, 252, 256, 341, 463, 465, 357, 350, 349, 348, 347, 346, 340, 372], ceja: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276], mejilla: 280 },
];
const LABIOS_FUERA = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LABIOS_DENTRO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
/** De donde se toma el color de la piel: las dos mejillas, la frente y el mentón. */
const MUESTRAS_PIEL = [50, 280, 151, 199];

const TINTA: [number, number, number] = [18, 14, 14];
const ROSA_LABIOS: [number, number, number] = [178, 72, 86];
const ROSA_RUBOR: [number, number, number] = [226, 104, 108];

/** Lo que queda listo de una foto para retocarla. Todo mide lo que la caja de la cara (`cw` x `ch`). */
export interface Preparado {
  x0: number; y0: number; cw: number; ch: number;
  mascaras: Record<"piel" | "ojeras" | "blancos" | "iris" | "cejas" | "delineado" | "labios" | "rubor", Float32Array>;
  /** Los tres canales con el filtro que respeta los bordes (lo que se ve como piel suave), de 0 a 255. */
  suave: [Float32Array, Float32Array, Float32Array];
  /** Qué tanto se aleja el color de cada zona del color promedio de la piel (manchas y rojeces, de la baja frecuencia). */
  mancha: [Float32Array, Float32Array, Float32Array];
  /** Luz de cada zona (baja frecuencia). */
  luzBaja: Float32Array;
  luzPiel: number;
  colorCeja: [number, number, number];
}

const luz = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;
const mediana = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;

const preparados = new WeakMap<Analisis, Promise<Preparado | null>>();
/** Ubica la cara y deja lista la foto. Queda guardado por foto. Devuelve null si no encuentra ninguna cara. */
export function prepararRetoque(a: Analisis) {
  let p = preparados.get(a);
  if (!p) {
    p = cargarRasgos().then((rasgos) => preparar(a, rasgos));
    preparados.set(a, p);
    p.catch(() => preparados.delete(a));
  }
  return p;
}

function preparar(a: Analisis, rasgos: FaceLandmarker): Preparado | null {
  const { base } = a;
  const w = base.width, h = base.height;
  const caras = rasgos.detect(base).faceLandmarks;
  const anchoDe = (c: { x: number }[]) => Math.max(...c.map((p) => p.x)) - Math.min(...c.map((p) => p.x));
  const puntos = [...caras].sort((m, n) => anchoDe(n) - anchoDe(m))[0];
  if (!puntos) return null;
  const P = (i: number): [number, number] => [puntos[i].x * w, puntos[i].y * h];

  const xs = OVALO.map((i) => P(i)[0]), ys = OVALO.map((i) => P(i)[1]);
  const anchoCara = Math.max(...xs) - Math.min(...xs), altoCara = Math.max(...ys) - Math.min(...ys);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - anchoCara * 0.25)), y0 = Math.max(0, Math.floor(Math.min(...ys) - altoCara * 0.15));
  const cw = Math.min(w, Math.ceil(Math.max(...xs) + anchoCara * 0.25)) - x0, ch = Math.min(h, Math.ceil(Math.max(...ys) + altoCara * 0.6)) - y0;
  const n = cw * ch;
  const datos = base.getContext("2d", { willReadFrequently: true })!.getImageData(x0, y0, cw, ch).data;

  const lienzo = document.createElement("canvas");
  lienzo.width = cw; lienzo.height = ch;
  const c = lienzo.getContext("2d", { willReadFrequently: true })!;
  c.translate(-x0, -y0);
  c.fillStyle = "#fff";
  /** Pinta una máscara con el lienzo y la difumina `radio` píxeles (dos pasadas: sin bordes de caja). */
  const pintar = (dibujar: () => void, radio = 0) => {
    c.clearRect(x0, y0, cw, ch);
    dibujar();
    const d = c.getImageData(0, 0, cw, ch).data;
    let m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = d[i * 4 + 3] / 255;
    if (radio > 0) m = media(media(m, cw, ch, radio), cw, ch, radio);
    return m;
  };
  const trazar = (ids: number[]) => {
    c.beginPath();
    ids.forEach((i, k) => { const [x, y] = P(i); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath();
  };
  const rellenar = (ids: number[]) => { trazar(ids); c.fill(); };
  const circulo = (x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const r1 = Math.max(1, Math.round(anchoCara / 120)), r2 = Math.max(2, Math.round(anchoCara / 40));
  const ojoEntero = (o: (typeof OJOS)[number]) => [...o.arriba, ...o.abajo.slice(1, -1).reverse()];

  // Color de la piel (mediana: un lunar o un mechón no lo mueve).
  const muestra = pintar(() => MUESTRAS_PIEL.forEach((i) => { const [x, y] = P(i); circulo(x, y, anchoCara * 0.07); }));
  const vr: number[] = [], vg: number[] = [], vb: number[] = [];
  for (let i = 0; i < n; i++) if (muestra[i] > 0.5) { vr.push(datos[i * 4]); vg.push(datos[i * 4 + 1]); vb.push(datos[i * 4 + 2]); }
  const pr = mediana(vr), pg = mediana(vg), pb = mediana(vb);
  const luzPiel = luz(pr, pg, pb);
  const cbPiel = -0.169 * pr - 0.331 * pg + 0.5 * pb, crPiel = 0.5 * pr - 0.419 * pg - 0.081 * pb;

  // Piel: el óvalo y el cuello, solo donde el color se parece a la piel (el pelo y la ropa quedan por fuera).
  const region = pintar(() => {
    rellenar(OVALO);
    c.beginPath();
    MANDIBULA.forEach((i, k) => { const [x, y] = P(i); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
    const [xd, yd] = P(MANDIBULA[MANDIBULA.length - 1]), [xi, yi] = P(MANDIBULA[0]);
    c.lineTo(xd, yd + altoCara * 0.6); c.lineTo(xi, yi + altoCara * 0.6);
    c.closePath();
    c.fill();
  }, r2);
  const facciones = pintar(() => {
    for (const o of OJOS) { rellenar(ojoEntero(o)); rellenar(o.ceja); }
    rellenar(LABIOS_FUERA);
  }, r1);
  let piel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = datos[i * 4], g = datos[i * 4 + 1], b = datos[i * 4 + 2];
    const dist = Math.hypot(-0.169 * r - 0.331 * g + 0.5 * b - cbPiel, 0.5 * r - 0.419 * g - 0.081 * b - crPiel);
    const parecido = (1 - suave((dist - 12) / 16)) * suave((luz(r, g, b) / Math.max(1, luzPiel) - 0.35) / 0.25);
    piel[i] = region[i] * parecido * (1 - Math.min(1, facciones[i] * 1.2));
  }
  piel = media(piel, cw, ch, r1);

  // Lo costoso: el filtro que respeta los bordes y las bajas frecuencias de color y luz (solo con lo que es piel).
  const rGuiado = Math.max(3, Math.round(anchoCara / 28));
  const canal = (k: number) => { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = datos[i * 4 + k] / 255; return v; };
  const aEscala = (v: Float32Array) => { for (let i = 0; i < n; i++) v[i] *= 255; return v; };
  const suavizado: Preparado["suave"] = [0, 1, 2].map((k) => { const v = canal(k); return aEscala(filtroGuiado(v, v, cw, ch, rGuiado, 0.0016)); }) as Preparado["suave"];

  const rBajo = Math.max(4, Math.round(anchoCara / 14));
  const pesoBajo = media(piel, cw, ch, rBajo);
  const bajo = (k: number) => {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = datos[i * 4 + k] * piel[i];
    const m = media(v, cw, ch, rBajo);
    for (let i = 0; i < n; i++) m[i] = pesoBajo[i] > 0.02 ? m[i] / pesoBajo[i] : [pr, pg, pb][k];
    return m;
  };
  const br = bajo(0), bg = bajo(1), bb = bajo(2);
  const luzBaja = new Float32Array(n);
  const mancha: Preparado["mancha"] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const l = luz(br[i], bg[i], bb[i]);
    luzBaja[i] = l;
    mancha[0][i] = br[i] - l - (pr - luzPiel);
    mancha[1][i] = bg[i] - l - (pg - luzPiel);
    mancha[2][i] = bb[i] - l - (pb - luzPiel);
  }

  // Máscaras de cada control.
  const soloOjos = pintar(() => OJOS.forEach((o) => rellenar(ojoEntero(o))));
  const iris = pintar(() => OJOS.forEach((o) => {
    const [x, y] = P(o.iris), [bx, by] = P(o.borde);
    circulo(x, y, Math.hypot(bx - x, by - y));
  }));
  const blancos = new Float32Array(n);
  for (let i = 0; i < n; i++) { const dentro = iris[i] * soloOjos[i]; blancos[i] = soloOjos[i] - dentro; iris[i] = dentro; }
  const ojeras = pintar(() => OJOS.forEach((o) => rellenar(o.ojera)), r2);
  for (let i = 0; i < n; i++) ojeras[i] *= 1 - Math.min(1, soloOjos[i] * 2);
  const cejas = pintar(() => OJOS.forEach((o) => rellenar(o.ceja)), r1);
  const labios = pintar(() => {
    const boca = new Path2D();
    for (const ids of [LABIOS_FUERA, LABIOS_DENTRO]) {
      ids.forEach((i, k) => { const [x, y] = P(i); if (k) boca.lineTo(x, y); else boca.moveTo(x, y); });
      boca.closePath();
    }
    c.fill(boca, "evenodd");
  }, r1);
  const rubor = pintar(() => OJOS.forEach((o) => { const [x, y] = P(o.mejilla); circulo(x, y, anchoCara * 0.13); }), Math.max(3, Math.round(anchoCara / 14)));
  const delineado = pintar(() => OJOS.forEach((o) => dibujarDelineado(c, o.arriba.map(P))), anchoCara > 240 ? 1 : 0);

  // Color de las cejas: lo más oscuro de lo que hay en ellas, para rellenarlas con su mismo tono.
  const oscuros: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) if (cejas[i] > 0.6) oscuros.push([luz(datos[i * 4], datos[i * 4 + 1], datos[i * 4 + 2]), datos[i * 4], datos[i * 4 + 1], datos[i * 4 + 2]]);
  oscuros.sort((m, q) => m[0] - q[0]);
  const parte = oscuros.slice(0, Math.max(1, Math.floor(oscuros.length * 0.3)));
  const promedio = (k: number) => parte.reduce((s, v) => s + (v[k] ?? 0), 0) / parte.length;
  const colorCeja: [number, number, number] = [promedio(1), promedio(2), promedio(3)];

  return { x0, y0, cw, ch, mascaras: { piel, ojeras, blancos, iris, cejas, delineado, labios, rubor }, suave: suavizado, mancha, luzBaja, luzPiel, colorCeja };
}

/** Una línea sobre las pestañas de arriba: delgada en el lagrimal, más gruesa afuera, y una colita hacia arriba. */
function dibujarDelineado(c: CanvasRenderingContext2D, arriba: [number, number][]) {
  const adentro = arriba[0], afuera = arriba[arriba.length - 1];
  const ancho = Math.hypot(afuera[0] - adentro[0], afuera[1] - adentro[1]);
  const ux = (afuera[0] - adentro[0]) / ancho, uy = (afuera[1] - adentro[1]) / ancho;
  // Perpendicular al ojo, hacia arriba.
  const nx = ux > 0 ? uy : -uy, ny = ux > 0 ? -ux : ux;
  const punta: [number, number] = [afuera[0] + (ux + nx * 0.5) * ancho * 0.16, afuera[1] + (uy + ny * 0.5) * ancho * 0.16];
  c.beginPath();
  arriba.forEach(([x, y], k) => { if (k) c.lineTo(x, y); else c.moveTo(x, y); });
  c.lineTo(punta[0], punta[1]);
  for (let k = arriba.length - 1; k >= 0; k--) {
    const s = k / (arriba.length - 1);
    const grueso = ancho * (0.012 + 0.05 * s ** 1.5);
    c.lineTo(arriba[k][0] + nx * grueso, arriba[k][1] + ny * grueso);
  }
  c.closePath();
  c.fill();
}

/** Aplica el retoque a los píxeles de la foto entera (`d`, de `ancho` de lado), antes del color y del fondo. */
export function aplicarRetoque(d: Uint8ClampedArray, ancho: number, p: Preparado, r: Retoque) {
  const { x0, y0, cw, ch, mascaras: m, suave: s, mancha, luzBaja, luzPiel, colorCeja } = p;
  const tPiel = (r.piel / 100) * 0.85, tTono = (r.tono / 100) * 0.8, tOjeras = r.ojeras / 100, tBrillos = (r.brillos / 100) * 0.75;
  const tOjos = r.ojos / 100, tCejas = (r.cejas / 100) * 0.5, tDelineado = Math.min(1, (r.delineado / 100) * 1.3), tLabios = (r.labios / 100) * 0.6, tRubor = (r.rubor / 100) * 0.3;
  // Por encima de esta luz, en la piel, ya es brillo (sudor, grasa, flash).
  const umbralBrillo = luzPiel + (255 - luzPiel) * 0.3;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x, o = ((y + y0) * ancho + x + x0) * 4;
      let R = d[o], G = d[o + 1], B = d[o + 2];
      const mp = m.piel[i];
      if (mp > 0) {
        if (tPiel) { const t = tPiel * mp; R += (s[0][i] - R) * t; G += (s[1][i] - G) * t; B += (s[2][i] - B) * t; }
        if (tTono) { const t = tTono * mp; R -= mancha[0][i] * t; G -= mancha[1][i] * t; B -= mancha[2][i] * t; }
        if (tBrillos) {
          const l = luz(R, G, B);
          if (l > umbralBrillo) { const k = (umbralBrillo + (l - umbralBrillo) * (1 - tBrillos * mp)) / l; R *= k; G *= k; B *= k; }
        }
      }
      const mo = m.ojeras[i];
      if (tOjeras && mo > 0) {
        const falta = Math.max(0, luzPiel - luzBaja[i]) * 0.8 * tOjeras * mo;
        const t = 0.5 * tOjeras * mo;
        R += falta - mancha[0][i] * t; G += falta - mancha[1][i] * t; B += falta - mancha[2][i] * t;
      }
      if (tRubor && m.rubor[i] > 0) { const t = tRubor * m.rubor[i] * Math.min(1, mp * 1.5); R += (ROSA_RUBOR[0] - R) * t; G += (ROSA_RUBOR[1] - G) * t; B += (ROSA_RUBOR[2] - B) * t; }
      if (tOjos && m.blancos[i] > 0) {
        const t = m.blancos[i] * tOjos;
        const sinRojo = (G + B) / 2;
        R += (sinRojo - R) * 0.4 * t;
        R += (255 - R) * 0.18 * t; G += (255 - G) * 0.18 * t; B += (255 - B) * 0.18 * t;
      }
      if (tOjos && m.iris[i] > 0) { const k = 1 + 0.3 * tOjos * m.iris[i]; R *= k; G *= k; B *= k; }
      if (tCejas && m.cejas[i] > 0) { const t = tCejas * m.cejas[i]; R += (colorCeja[0] - R) * t; G += (colorCeja[1] - G) * t; B += (colorCeja[2] - B) * t; }
      if (tLabios && m.labios[i] > 0) {
        // Cambia el color y conserva la luz del labio (sus brillos y sombras); un poco más oscuro.
        const t = tLabios * m.labios[i], l = luz(R, G, B), lr = luz(ROSA_LABIOS[0], ROSA_LABIOS[1], ROSA_LABIOS[2]);
        const b = l * (1 - 0.12 * t);
        R += (b + ROSA_LABIOS[0] - lr - R) * t; G += (b + ROSA_LABIOS[1] - lr - G) * t; B += (b + ROSA_LABIOS[2] - lr - B) * t;
      }
      if (tDelineado && m.delineado[i] > 0) { const t = tDelineado * m.delineado[i]; R += (TINTA[0] - R) * t; G += (TINTA[1] - G) * t; B += (TINTA[2] - B) * t; }
      d[o] = R; d[o + 1] = G; d[o + 2] = B;
    }
  }
}
