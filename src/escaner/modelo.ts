/*
 * Encuadre de cédulas y tarjetas con el modelo entrenado para eso (ml/encuadre: segmentación sobre MobileNetV3,
 * entrenado con escenas inventadas: fotocopias con las dos caras, capturas de chat, plastificadas, en la mano, lejos,
 * llenando toda la foto...). Corre en el navegador (onnxruntime-web, sin servicios externos) y devuelve TODAS las
 * tarjetas de la foto, cada una con sus 4 esquinas:
 *   1) la foto reducida a 448 x 448 (proporción conservada, relleno gris) -> el modelo -> tres mapas a 224 x 224:
 *      dónde hay tarjeta, su centro (separa dos tarjetas casi pegadas) y su borde;
 *   2) cada centro es una tarjeta; su zona es la parte de la máscara más cercana a ese centro;
 *   3) el cuadrilátero de cada zona: el de mayor área dentro de su contorno, y cada lado ajustado a una recta con los
 *      puntos del medio del lado (las esquinas redondeadas no lo tuercen);
 *   4) afinado en la foto a resolución completa: cada lado se acerca al borde real (el salto de brillo más fuerte cerca
 *      del lado del modelo, con el mismo signo a lo largo del lado), con una recta robusta. Si el borde no se ve
 *      (fotocopia lavada), queda el del modelo.
 * Motor: /ort/ort-wasm-simd-threaded.wasm (Microsoft, MIT). Modelo: /modelos/cedulas.onnx. Se cargan al usarse.
 */
import type { InferenceSession } from "onnxruntime-web";

interface Punto { x: number; y: number }
type Cuad = [Punto, Punto, Punto, Punto];

const LADO = 448, SAL = 224, GRIS = 114;

let sesion: Promise<{ ort: typeof import("onnxruntime-web/wasm"); s: InferenceSession }> | null = null;
function cargar() {
  if (!sesion) {
    sesion = (async () => {
      const ort = await import("onnxruntime-web/wasm");
      // Solo el .wasm desde /ort (el código que lo carga ya viene dentro del paquete).
      ort.env.wasm.wasmPaths = { wasm: "/ort/ort-wasm-simd-threaded.wasm" };
      ort.env.wasm.numThreads = 1;
      const s = await ort.InferenceSession.create("/modelos/cedulas.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      return { ort, s };
    })();
    sesion.catch(() => { sesion = null; });
  }
  return sesion;
}
/** Empieza a bajar el motor y el modelo (al abrir el escáner), para que la primera foto no espere. */
export function precargarModelo() { cargar().catch(() => { /* se reintenta al usarlo */ }); }

/** Ordena las esquinas: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda (en pantalla). */
export function ordenar(q: Punto[]): Cuad {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const s = [...q].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  let k = 0;
  for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
  return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
}

/** Recta por mínimos cuadrados totales: un punto y su dirección (unitaria). */
function recta(p: Punto[]) {
  const mx = p.reduce((s, q) => s + q.x, 0) / p.length, my = p.reduce((s, q) => s + q.y, 0) / p.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of p) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) };
}
type Recta = ReturnType<typeof recta>;
function cruce(a: Recta, b: Recta): Punto | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det;
  return { x: a.x + a.dx * t, y: a.y + a.dy * t };
}
const area = (q: Punto[]) => Math.abs(q.reduce((s, p, i) => { const r = q[(i + 1) % q.length]; return s + p.x * r.y - r.x * p.y; }, 0)) / 2;
const convexo = (q: Punto[]) => {
  let signo = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (!signo) signo = Math.sign(z); else if (Math.sign(z) !== signo) return false;
  }
  return true;
};

/** Envolvente convexa (cadena monótona). */
function envolvente(p: Punto[]): Punto[] {
  const s = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cruz = (o: Punto, a: Punto, b: Punto) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const abajo: Punto[] = [], arriba: Punto[] = [];
  for (const q of s) { while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop(); abajo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop(); arriba.push(q); }
  return abajo.slice(0, -1).concat(arriba.slice(0, -1));
}

/** El cuadrilátero de mayor área con vértices en la envolvente. */
function cuadMayor(h: Punto[]): Cuad | null {
  if (h.length < 4) return null;
  // Con muchos puntos, se reducen (el máximo casi no cambia).
  const paso = Math.max(1, Math.ceil(h.length / 64));
  const v = h.filter((_, i) => i % paso === 0);
  const n = v.length;
  if (n < 4) return null;
  const tri = (a: Punto, b: Punto, c: Punto) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  let mejor = -1, res: Cuad | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      let a1 = -1, k1 = -1;
      for (let k = i + 1; k < j; k++) { const t = tri(v[i], v[k], v[j]); if (t > a1) { a1 = t; k1 = k; } }
      let a2 = -1, k2 = -1;
      for (let k = j + 1; k < n + i; k++) { const kk = k % n; const t = tri(v[i], v[kk], v[j]); if (t > a2) { a2 = t; k2 = kk; } }
      if (k1 < 0 || k2 < 0) continue;
      if (a1 + a2 > mejor) { mejor = a1 + a2; res = [v[i], v[k1], v[j], v[k2]]; }
    }
  }
  return res;
}

/** Ajusta cada lado a una recta con los puntos del contorno cercanos al medio del lado; devuelve los 4 cruces. */
function ajustarLados(q: Cuad, borde: Punto[], tol: number, salir = 0): Cuad {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const rectas: Recta[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const cerca = borde.filter((p) => {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / L, d = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      return t > 0.12 && t < 0.88 && d <= tol;
    });
    let r: Recta = cerca.length >= 5 ? recta(cerca) : { x: a.x, y: a.y, dx: ux, dy: uy };
    if (salir) {
      // Hacia afuera (los puntos del contorno son centros de píxeles de adentro).
      let nx = -r.dy, ny = r.dx;
      if ((c.x - r.x) * nx + (c.y - r.y) * ny > 0) { nx = -nx; ny = -ny; }
      r = { ...r, x: r.x + nx * salir, y: r.y + ny * salir };
    }
    rectas.push(r);
  }
  const out: Punto[] = [];
  for (let i = 0; i < 4; i++) { const p = cruce(rectas[(i + 3) % 4], rectas[i]); if (!p) return q; out.push(p); }
  return out as Cuad;
}

/** Las tarjetas en los mapas del modelo (en coordenadas del mapa, 224 x 224). */
function tarjetasEnMapas(mapas: Float32Array): { q: Cuad; puntaje: number }[] {
  const N = SAL * SAL;
  // La tarjeta es también todo lo que encierra su borde: en una fotocopia lavada el centro de la tarjeta puede salir con
  // huecos, pero el borde sí se ve entero. Se rellena lo que no se alcanza desde la orilla de la imagen sin cruzar borde.
  const m = mapas.slice();
  {
    const pared = new Uint8Array(N);
    for (let i = 0; i < N; i++) pared[i] = mapas[2 * N + i] >= 0.4 || mapas[i] >= 0.5 ? 1 : 0;
    const afuera = new Uint8Array(N), cola0 = new Int32Array(N);
    let a0 = 0, f0 = 0;
    for (let i = 0; i < SAL; i++) for (const j of [i, (SAL - 1) * SAL + i, i * SAL, i * SAL + SAL - 1]) if (!pared[j] && !afuera[j]) { afuera[j] = 1; cola0[f0++] = j; }
    while (a0 < f0) {
      const j = cola0[a0++]; const x = j % SAL, y = (j - x) / SAL;
      for (const k of [x > 0 ? j - 1 : -1, x < SAL - 1 ? j + 1 : -1, y > 0 ? j - SAL : -1, y < SAL - 1 ? j + SAL : -1]) if (k >= 0 && !pared[k] && !afuera[k]) { afuera[k] = 1; cola0[f0++] = k; }
    }
    // Solo los huecos de adentro: la franja del borde se sale un poco de la tarjeta y no cuenta.
    for (let i = 0; i < N; i++) if (!afuera[i] && m[i] < 0.5 && mapas[2 * N + i] < 0.4) m[i] = 0.5;
  }
  const etiqueta = new Int32Array(N).fill(-1);
  // 1) Los centros: zonas conectadas de "centro".
  const pila = new Int32Array(N);
  let n = 0;
  const tamCentro: number[] = [];
  for (let i = 0; i < N; i++) {
    if (m[N + i] < 0.5 || etiqueta[i] >= 0) continue;
    let tope = 0, cuenta = 0; pila[tope++] = i; etiqueta[i] = n;
    while (tope) {
      const j = pila[--tope]; cuenta++;
      const x = j % SAL, y = (j - x) / SAL;
      for (const k of [x > 0 ? j - 1 : -1, x < SAL - 1 ? j + 1 : -1, y > 0 ? j - SAL : -1, y < SAL - 1 ? j + SAL : -1]) {
        if (k >= 0 && etiqueta[k] < 0 && m[N + k] >= 0.5) { etiqueta[k] = n; pila[tope++] = k; }
      }
    }
    tamCentro.push(cuenta); n++;
  }
  if (!n) return [];
  // 2) Cada píxel de tarjeta va con su centro, creciendo por anchura desde los centros: primero solo por lo de adentro
  //    (sin cruzar el borde que marca el modelo: entre dos tarjetas pegadas el corte sigue ese borde y no una diagonal);
  //    después, la franja del borde, con la más cercana. Lo de adentro de una tarjeta sin centro (un pedazo de otra que
  //    quedó en el recorte) no se le pega a la vecina.
  const cola = new Int32Array(N);
  for (const soloAdentro of [true, false]) {
    let ini = 0, fin = 0;
    for (let i = 0; i < N; i++) if (etiqueta[i] >= 0) cola[fin++] = i;
    while (ini < fin) {
      const j = cola[ini++]; const x = j % SAL, y = (j - x) / SAL;
      for (const k of [x > 0 ? j - 1 : -1, x < SAL - 1 ? j + 1 : -1, y > 0 ? j - SAL : -1, y < SAL - 1 ? j + SAL : -1]) {
        if (k >= 0 && etiqueta[k] < 0 && m[k] >= 0.5 && (soloAdentro ? mapas[2 * N + k] < 0.5 : mapas[2 * N + k] >= 0.5)) { etiqueta[k] = etiqueta[j]; cola[fin++] = k; }
      }
    }
  }
  // 3) Por tarjeta: su contorno, su cuadrilátero y su puntaje.
  const res: { q: Cuad; puntaje: number }[] = [];
  for (let e = 0; e < n; e++) {
    if (tamCentro[e] < 6) continue;
    const borde: Punto[] = [];
    let total = 0, suma = 0;
    for (let i = 0; i < N; i++) {
      if (etiqueta[i] !== e) continue;
      total++; suma += m[i];
      const x = i % SAL, y = (i - x) / SAL;
      if (x === 0 || y === 0 || x === SAL - 1 || y === SAL - 1 || etiqueta[i - 1] !== e || etiqueta[i + 1] !== e || etiqueta[i - SAL] !== e || etiqueta[i + SAL] !== e) borde.push({ x, y }); // el centro del píxel i está en i (así se dibujaron los mapas al entrenar)
    }
    if (total < 30) continue;
    const q0 = cuadMayor(envolvente(borde));
    if (!q0) continue;
    const q = ajustarLados(ordenar(q0), borde, 2.5, 0.5);
    if (!convexo(q)) continue;
    const a = area(q);
    if (a < total * 0.6 || a > total * 1.6) continue;
    res.push({ q, puntaje: suma / total });
  }
  return res;
}

/** La foto en gris a una resolución de trabajo (para afinar los lados). */
function grisDe(foto: HTMLCanvasElement, maxLado: number) {
  const k = Math.min(1, maxLado / Math.max(foto.width, foto.height));
  const w = Math.max(1, Math.round(foto.width * k)), h = Math.max(1, Math.round(foto.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(foto, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gris = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gris[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // Un suavizado 3x3 (quita el grano del JPEG sin correr el borde).
  const s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0, c2 = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { t += gris[yy * w + xx]; c2++; } }
    s[y * w + x] = t / c2;
  }
  return { gris: s, w, h, k };
}

/**
 * Acerca cada lado del cuadrilátero (en píxeles de la imagen gris) al borde real: en varios puntos del medio del lado
 * busca, a lo largo de la normal y a no más de `r` píxeles, el salto de brillo más fuerte (con el signo que domina en
 * el lado); ajusta una recta robusta y la acepta si casi todo el lado coincide.
 */
function afinar(q: Cuad, g: { gris: Float32Array; w: number; h: number }, r: number): Cuad {
  const { gris, w, h } = g;
  const val = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return gris[i] * (1 - fx) * (1 - fy) + gris[i + 1] * fx * (1 - fy) + gris[i + w] * (1 - fx) * fy + gris[i + w + 1] * fx * fy;
  };
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const rectas: Recta[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    let nx = -uy, ny = ux;
    if ((c.x - a.x) * nx + (c.y - a.y) * ny > 0) { nx = -nx; ny = -ny; } // hacia afuera
    const original: Recta = { x: a.x, y: a.y, dx: ux, dy: uy };
    const M = Math.max(12, Math.min(60, Math.round(L / 6)));
    const picos: { p: Punto; d: number; s: number }[] = [];
    for (let m = 0; m < M; m++) {
      const t = 0.12 + 0.76 * (m + 0.5) / M;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      let mejor = 0, sMejor = 0, dMejor = 0;
      const perfil: number[] = [];
      for (let s = -r - 1; s <= r + 1; s += 0.5) perfil.push(val(px + nx * s, py + ny * s));
      for (let k = 2; k < perfil.length - 2; k++) {
        const d = perfil[k + 2] - perfil[k - 2]; // de adentro hacia afuera
        if (Number.isNaN(d)) continue;
        const s = -r - 1 + k * 0.5;
        if (Math.abs(s) > r) continue;
        // Cerca del lado del modelo pesa un poco más (entre dos bordes parecidos, el más cercano).
        const peso = Math.abs(d) * (1 - 0.25 * Math.abs(s) / r);
        if (peso > mejor) { mejor = peso; sMejor = s; dMejor = d; }
      }
      if (mejor > 0) picos.push({ p: { x: px + nx * sMejor, y: py + ny * sMejor }, d: dMejor, s: sMejor });
    }
    if (picos.length < 6) { rectas.push(original); continue; }
    // El signo que domina (la tarjeta más clara o más oscura que lo de afuera) y solo los picos fuertes.
    const pos = picos.filter((x) => x.d > 0), neg = picos.filter((x) => x.d < 0);
    let sel = pos.reduce((s, x) => s + x.d, 0) >= -neg.reduce((s, x) => s + x.d, 0) ? pos : neg;
    const fuerza = sel.map((x) => Math.abs(x.d)).sort((x, y) => x - y);
    const umbral = Math.max(6, fuerza[Math.floor(fuerza.length / 2)] * 0.35);
    sel = sel.filter((x) => Math.abs(x.d) >= umbral);
    if (sel.length < Math.max(6, M * 0.45)) { rectas.push(original); continue; }
    // Recta robusta: se ajusta, se quitan los que quedan lejos y se vuelve a ajustar.
    let pts = sel.map((x) => x.p);
    let rr = recta(pts);
    for (let it = 0; it < 3; it++) {
      const dist = pts.map((p) => Math.abs((p.x - rr.x) * rr.dy - (p.y - rr.y) * rr.dx));
      const med = [...dist].sort((x, y) => x - y)[Math.floor(dist.length / 2)];
      const lim = Math.max(0.8, med * 2.5);
      const quedan = pts.filter((_, j) => dist[j] <= lim);
      if (quedan.length < 6) break;
      pts = quedan; rr = recta(pts);
    }
    // Se acepta solo si casi no gira y no se aleja más de r del lado del modelo.
    const giro = Math.abs(rr.dx * uy - rr.dy * ux);
    const corrido = Math.abs((rr.x - a.x) * uy - (rr.y - a.y) * ux);
    rectas.push(pts.length >= M * 0.4 && giro < 0.06 && corrido <= r + 1 ? rr : original);
  }
  const out: Punto[] = [];
  for (let i = 0; i < 4; i++) { const p = cruce(rectas[(i + 3) % 4], rectas[i]); if (!p) return q; out.push(p); }
  return convexo(out) ? (out as Cuad) : q;
}

/** Una pasada del modelo sobre la foto (o un pedazo): las tarjetas en píxeles de esa imagen, y su escala. */
async function pasada(img: HTMLCanvasElement) {
  const { ort, s } = await cargar();
  const k = LADO / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const dx = Math.floor((LADO - w) / 2), dy = Math.floor((LADO - h) / 2);
  const c = document.createElement("canvas"); c.width = LADO; c.height = LADO;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = `rgb(${GRIS},${GRIS},${GRIS})`; g.fillRect(0, 0, LADO, LADO);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, dx, dy, w, h);
  const d = g.getImageData(0, 0, LADO, LADO).data;
  const n = LADO * LADO, entrada = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { entrada[i] = d[i * 4]; entrada[n + i] = d[i * 4 + 1]; entrada[2 * n + i] = d[i * 4 + 2]; }
  const r = await s.run({ imagen: new ort.Tensor("float32", entrada, [1, 3, LADO, LADO]) });
  // Del mapa (224) a la imagen: x = (x_mapa * 2 - dx) / k.
  const aImg = (p: Punto): Punto => ({ x: (p.x * (LADO / SAL) - dx) / k, y: (p.y * (LADO / SAL) - dy) / k });
  return { k, tarjetas: tarjetasEnMapas(r.mapas.data as Float32Array).map((t) => t.q.map(aImg) as Cuad) };
}

/** Un pedazo de la foto (a su resolución, hasta 1800 px por lado). */
function recorte(foto: HTMLCanvasElement, x0: number, y0: number, w: number, h: number) {
  const f = Math.min(1, 1800 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(h * f));
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(foto, x0, y0, w, h, 0, 0, c.width, c.height);
  return { c, f };
}
const centro = (q: Cuad) => ({ x: q.reduce((s2, p) => s2 + p.x, 0) / 4, y: q.reduce((s2, p) => s2 + p.y, 0) / 4 });

/**
 * Busca las tarjetas de la foto con el modelo. Devuelve sus esquinas (en píxeles de la foto, cada una ordenada desde
 * arriba-izquierda), en el orden de lectura (de arriba abajo, de izquierda a derecha); vacío si no hay ninguna.
 * Una tarjeta pequeña en la foto (lejos, dentro de una captura de pantalla, una foto reducida) se vuelve a buscar en
 * un recorte alrededor de ella (segunda pasada, con zoom): ahí el modelo la ve grande y sus esquinas salen precisas.
 * Al final, cada lado se afina en la foto a su resolución.
 * Lanza un error si el modelo no se pudo cargar (sin internet la primera vez): quien llama usa el encuadre de antes.
 */
export async function detectarConModelo(foto: HTMLCanvasElement, afinarLados = true): Promise<Cuad[]> {
  const W = foto.width, H = foto.height;
  const primera = await pasada(foto);
  const tarjetas: Cuad[] = [];
  // Cada tarjeta de la primera pasada, con lo que se vio de ella en la segunda (una o, si eran dos pegadas, dos).
  const porRevisar: Cuad[] = [...primera.tarjetas];
  const vistas: { q: Cuad; kModelo: number; caja: [number, number, number, number] }[] = [];
  for (const q of porRevisar) {
    const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const lado = Math.max(bx1 - bx0, by1 - by0);
    // El pedazo de la foto donde está la tarjeta, con margen (en una pequeña, la segunda pasada la ve grande).
    const m = lado * 0.3;
    const x0 = Math.max(0, Math.floor(bx0 - m)), y0 = Math.max(0, Math.floor(by0 - m));
    const x1 = Math.min(W, Math.ceil(bx1 + m)), y1 = Math.min(H, Math.ceil(by1 + m));
    let elegidas: Cuad[] = [q], kModelo = primera.k;
    if (lado < Math.max(W, H) * 0.6) {
      const { c, f } = recorte(foto, x0, y0, x1 - x0, y1 - y0);
      const segunda = await pasada(c);
      const c0 = centro(q);
      const enFoto = segunda.tarjetas.map((t) => t.map((p) => ({ x: x0 + p.x / f, y: y0 + p.y / f })) as Cuad);
      // Las de la segunda pasada que son esta: con el centro dentro de su caja. Si son dos de buen tamaño, eran dos
      // tarjetas pegadas (la fotocopia con las dos caras sin espacio) que la primera pasada vio como una.
      const dentro = enFoto.filter((t) => { const cc = centro(t); return cc.x > bx0 && cc.x < bx1 && cc.y > by0 && cc.y < by1; });
      const grandes = dentro.filter((t) => area(t) > area(q) * 0.25);
      if (grandes.length >= 2) { elegidas = grandes; kModelo = segunda.k * f; }
      else {
        const cerca = enFoto.map((t) => ({ t, d: Math.hypot(centro(t).x - c0.x, centro(t).y - c0.y) })).sort((a, b) => a.d - b.d)[0];
        if (cerca && cerca.d < lado * 0.25) { elegidas = [cerca.t]; kModelo = segunda.k * f; }
      }
    }
    for (const mejor of elegidas) vistas.push({ q: mejor, kModelo, caja: [x0, y0, x1, y1] });
  }
  for (const { q: mejor, kModelo, caja: [x0, y0, x1, y1] } of vistas) {
    if (!afinarLados) { tarjetas.push(ordenar(mejor)); continue; }
    // Afinar los lados en el pedazo de la foto, a su resolución.
    const { c, f } = recorte(foto, x0, y0, x1 - x0, y1 - y0);
    const g = grisDe(c, 1800);
    const kk = f * g.k;
    const enGris = mejor.map((p) => ({ x: (p.x - x0) * kk, y: (p.y - y0) * kk })) as Cuad;
    // Lo que puede estar corrido el lado del modelo: ~1,5 píxeles del mapa, en píxeles de la imagen gris.
    const r0 = Math.max(3, (1.5 * (LADO / SAL) / kModelo) * kk);
    const af = afinar(enGris, g, r0);
    tarjetas.push(ordenar(af.map((p) => ({ x: x0 + p.x / kk, y: y0 + p.y / kk }))));
  }
  if (!tarjetas.length) return [];
  // En orden de lectura (por filas aproximadas).
  const alto = Math.max(...tarjetas.map((q) => Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)));
  return tarjetas.sort((a, b) => (Math.abs(centro(a).y - centro(b).y) > alto * 0.5 ? centro(a).y - centro(b).y : centro(a).x - centro(b).x));
}
