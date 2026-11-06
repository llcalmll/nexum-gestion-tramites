/*
 * Encuadre automático del escáner: dónde está el documento en la foto (sus 4 esquinas).
 *
 * Una cédula o una tarjeta no es "la zona clara más grande": tiene colores, foto y holograma, y se fotografía en la
 * mano, sobre escritorios claros o manteles. Por eso se prueban varias formas de separarla del fondo y se queda la que
 * mejor parece un documento:
 *   - por bordes: las zonas encerradas por los bordes fuertes de la foto (con tres umbrales);
 *   - por color: lo que se aparta del color del fondo (el del marco de la foto);
 *   - por brillo: lo claro o lo oscuro (con uno y con dos umbrales, para la tarjeta sobre la mano sobre la mesa);
 *   - por líneas: las rectas fuertes de la foto (Hough) y los cuadriláteros que forman dos pares de ellas (la tarjeta en
 *     el brazo, con la ventana y las matas detrás: ninguna zona la separa, pero sus cuatro lados son rectas claras).
 * Cada zona candidata se rellena (la letra y la foto no la parten), se le saca el cuadrilátero más grande de su contorno
 * y se puntúa: qué tan rectangular es, si tiene borde marcado en los cuatro lados y si su proporción es la de una
 * tarjeta (85,6 x 54 mm) o una hoja (carta, oficio, A4). Las esquinas finales salen de prolongar los lados (rectas
 * ajustadas al contorno, sin las puntas): las esquinas redondeadas de una tarjeta no hacen que el recorte la muerda.
 * Medido con scripts/medir-encuadre.mjs.
 */

export interface Punto { x: number; y: number }
type Cuad = [Punto, Punto, Punto, Punto];

const LADO = 480;
const PROP_TARJETA = 85.6 / 54;
const PROPS_HOJA = [279.4 / 215.9, 297 / 210, 330 / 215.9, 1];

/** Umbral de Otsu de un histograma de 256 niveles (entre `desde` y `hasta`). */
function otsu(hist: Float64Array, desde = 0, hasta = 255) {
  let total = 0, suma = 0;
  for (let i = desde; i <= hasta; i++) { total += hist[i]; suma += i * hist[i]; }
  let sumaB = 0, pesoB = 0, mejor = -1, umbral = Math.round((desde + hasta) / 2);
  for (let t = desde; t <= hasta; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const v = pesoB * pesoF * (sumaB / pesoB - (suma - sumaB) / pesoF) ** 2;
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}

/** Las zonas conectadas de una máscara, de la más grande a la más pequeña (solo las de más de `minimo` píxeles). */
function zonas(m: Uint8Array, w: number, h: number, minimo: number, cuantas: number): Int32Array[] {
  const visto = new Uint8Array(w * h), pila = new Int32Array(w * h), out: Int32Array[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || visto[i]) continue;
    let tope = 0, n = 0;
    const zona: number[] = [];
    pila[tope++] = i; visto[i] = 1;
    while (tope) {
      const j = pila[--tope]; zona.push(j); n++;
      const x = j % w;
      if (x > 0 && m[j - 1] && !visto[j - 1]) { visto[j - 1] = 1; pila[tope++] = j - 1; }
      if (x < w - 1 && m[j + 1] && !visto[j + 1]) { visto[j + 1] = 1; pila[tope++] = j + 1; }
      if (j >= w && m[j - w] && !visto[j - w]) { visto[j - w] = 1; pila[tope++] = j - w; }
      if (j < w * (h - 1) && m[j + w] && !visto[j + w]) { visto[j + w] = 1; pila[tope++] = j + w; }
    }
    if (n >= minimo) out.push(Int32Array.from(zona));
  }
  return out.sort((a, b) => b.length - a.length).slice(0, cuantas);
}

/** Cierra huecos pequeños de una máscara: dilata y erosiona con un cuadrado de radio r. */
function cerrar(m: Uint8Array, w: number, h: number, r: number) {
  const pasar = (src: Uint8Array, dilatar: boolean) => {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilatar ? 0 : 1;
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; const s = src[y * w + xx]; if (dilatar ? s : !s) { v = dilatar ? 1 : 0; break; } }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilatar ? 0 : 1;
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy < 0 || yy >= h) continue; const s = tmp[yy * w + x]; if (dilatar ? s : !s) { v = dilatar ? 1 : 0; break; } }
      out[y * w + x] = v;
    }
    return out;
  };
  return pasar(pasar(m, true), false);
}

/** Envolvente convexa (cadena monótona). */
function envolvente(p: Punto[]): Punto[] {
  const s = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cruz = (o: Punto, a: Punto, b: Punto) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const abajo: Punto[] = [], arriba: Punto[] = [];
  for (const q of s) { while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop(); abajo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop(); arriba.push(q); }
  return abajo.slice(0, -1).concat(arriba.slice(0, -1));
}

const area = (q: Punto[]) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

/** El cuadrilátero de área máxima con vértices en la envolvente (simplificada a ~40 puntos). */
function cuadMaximo(env: Punto[]): Cuad | null {
  if (env.length < 4) return null;
  const paso = Math.max(1, Math.ceil(env.length / 40));
  const p = env.filter((_, i) => i % paso === 0);
  const n = p.length;
  if (n < 4) return null;
  let mejor = -1, res: Cuad | null = null;
  const tri = (a: Punto, b: Punto, c: Punto) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
    // Para la diagonal i-k, el mejor j entre ellos y el mejor l después de k (por separado).
    let bj = -1, aj = -1, bl = -1, al = -1;
    for (let j = i + 1; j < k; j++) { const a = tri(p[i], p[j], p[k]); if (a > aj) { aj = a; bj = j; } }
    for (let l = k + 1; l < n + i; l++) { const a = tri(p[i], p[k], p[l % n]); if (a > al) { al = a; bl = l % n; } }
    if (bj < 0 || bl < 0) continue;
    if (aj + al > mejor) { mejor = aj + al; res = [p[i], p[bj], p[k], p[bl]]; }
  }
  return res;
}

/** Ordena las esquinas: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
function ordenar(q: Punto[]): Cuad {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const s = [...q].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // Empieza por la que tenga menor x + y (arriba-izquierda), en el sentido del reloj (en pantalla).
  let k = 0;
  for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
  return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]] as Cuad;
}

/** Recta (punto y dirección) ajustada a unos puntos (mínimos cuadrados totales). */
function recta(p: Punto[]) {
  const mx = p.reduce((s, q) => s + q.x, 0) / p.length, my = p.reduce((s, q) => s + q.y, 0) / p.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of p) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) };
}
function cruce(a: ReturnType<typeof recta>, b: ReturnType<typeof recta>): Punto | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det;
  return { x: a.x + t * a.dx, y: a.y + t * a.dy };
}

/**
 * Las esquinas finales: a cada lado se le ajusta una recta con los puntos del contorno que caen cerca de él (sin el
 * 15 % de cada punta, donde está lo redondeado o un dedo) y las esquinas son los cruces de las rectas.
 */
function afinar(q: Cuad, borde: Punto[], diag: number): Cuad {
  const lados = q.map((a, i) => {
    const b = q[(i + 1) % 4], L = dist(a, b) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const cerca = borde.filter((p) => {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy, d = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      return t > L * 0.15 && t < L * 0.85 && d < diag * 0.025;
    });
    return cerca.length >= 8 ? recta(cerca) : null;
  });
  const nuevo = q.map((p, i) => {
    const a = lados[(i + 3) % 4], b = lados[i];
    const c = a && b ? cruce(a, b) : null;
    return c && dist(c, p) < diag * 0.08 ? c : p;
  });
  return nuevo as Cuad;
}

/**
 * Pega cada lado al borde de verdad: en puntos a lo largo del lado busca, en la perpendicular y cerca (±1,5 % de la
 * diagonal), donde el gradiente es más fuerte; ajusta una recta a esos puntos (sin los que se salen de la mayoría) y
 * las esquinas son los cruces. Así el recorte no agarra la sombra ni muerde la tarjeta.
 */
function pegarABordes(q: Cuad, grad: Float32Array, w: number, h: number, diag: number, minimo: number): Cuad {
  const G = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= w - 1 || yi >= h - 1) return 0;
    const fx = x - xi, fy = y - yi, i = yi * w + xi;
    return (grad[i] * (1 - fx) + grad[i + 1] * fx) * (1 - fy) + (grad[i + w] * (1 - fx) + grad[i + w + 1] * fx) * fy;
  };
  const D = Math.max(3, diag * 0.015);
  const lados = q.map((a, i) => {
    const b = q[(i + 1) % 4], L = dist(a, b) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, nx = -uy, ny = ux;
    const puntos: { p: Punto; off: number }[] = [];
    for (let s = 0; s < 32; s++) {
      const t = 0.12 + 0.76 * s / 31;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      let mejor = minimo, off = NaN;
      for (let o = -D; o <= D; o += 0.5) {
        // Un poco de preferencia por el borde que ya se tenía (el de la zona): no saltar a una línea de adentro.
        const g = G(x + nx * o, y + ny * o) * (1 - 0.25 * Math.abs(o) / D);
        if (g > mejor) { mejor = g; off = o; }
      }
      if (!Number.isNaN(off)) puntos.push({ p: { x: x + nx * off, y: y + ny * off }, off });
    }
    if (puntos.length < 10) return null;
    const offs = puntos.map((x) => x.off).sort((u, v) => u - v), med = offs[offs.length >> 1];
    const buenos = puntos.filter((x) => Math.abs(x.off - med) <= Math.max(1.5, D * 0.3)).map((x) => x.p);
    return buenos.length >= 8 ? recta(buenos) : null;
  });
  return q.map((p, i) => {
    const a = lados[(i + 3) % 4], b = lados[i];
    const c = a && b ? cruce(a, b) : null;
    return c && dist(c, p) < diag * 0.06 ? c : p;
  }) as Cuad;
}

export interface Encuadre { esquinas: Cuad; puntaje: number }

/** Las rectas fuertes de la foto (Hough con la dirección del gradiente): ángulo de la normal y distancia al origen. */
function lineas(gx: Float32Array, gy: Float32Array, mag: Float32Array, w: number, h: number, umbral: number) {
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR);
  const cos = new Float32Array(NT), sin = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cos[t] = Math.cos((t * Math.PI) / NT); sin[t] = Math.sin((t * Math.PI) / NT); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (mag[i] <= umbral) continue;
    let th = Math.atan2(gy[i], gx[i]);
    if (th < 0) th += Math.PI;
    const t0 = Math.round((th / Math.PI) * NT);
    for (let dt = -3; dt <= 3; dt++) {
      const t = (t0 + dt + NT) % NT;
      const r = Math.round(x * cos[t] + y * sin[t]) + diag;
      acc[t * NR + r] += 1;
    }
  }
  // Picos (máximos locales), los 24 más votados.
  const picos: { t: number; r: number; v: number }[] = [];
  const minVotos = Math.min(w, h) * 0.12;
  for (let t = 0; t < NT; t++) for (let r = 1; r < NR - 1; r++) {
    const v = acc[t * NR + r];
    if (v < minVotos) continue;
    let max = true;
    for (let dt = -4; dt <= 4 && max; dt++) for (let dr = -6; dr <= 6; dr++) {
      if (!dt && !dr) continue;
      const tt = (t + dt + NT) % NT, rr = r + dr;
      if (rr < 0 || rr >= NR) continue;
      if (acc[tt * NR + rr] > v) { max = false; break; }
    }
    if (max) picos.push({ t, r, v });
  }
  return picos.sort((a, b) => b.v - a.v).slice(0, 24).map((p) => ({ ang: (p.t * Math.PI) / NT, rho: p.r - diag }));
}

/** Los cuadriláteros que forman dos pares de rectas (más o menos paralelas entre sí y más o menos perpendiculares). */
function cuadsDeLineas(ls: { ang: number; rho: number }[], w: number, h: number): Cuad[] {
  const casiParalelas = (a: number, b: number) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d) < (25 * Math.PI) / 180; };
  const corte = (a: { ang: number; rho: number }, b: { ang: number; rho: number }): Punto | null => {
    const det = Math.cos(a.ang) * Math.sin(b.ang) - Math.sin(a.ang) * Math.cos(b.ang);
    if (Math.abs(det) < 1e-6) return null;
    return { x: (a.rho * Math.sin(b.ang) - b.rho * Math.sin(a.ang)) / det, y: (b.rho * Math.cos(a.ang) - a.rho * Math.cos(b.ang)) / det };
  };
  const pares: [number, number][] = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    if (!casiParalelas(ls[i].ang, ls[j].ang)) continue;
    // Separadas al menos un 10 % del lado menor de la foto.
    const ri = ls[i].rho, rj = Math.abs(ls[i].ang - ls[j].ang) > Math.PI / 2 ? -ls[j].rho : ls[j].rho;
    if (Math.abs(ri - rj) < Math.min(w, h) * 0.1) continue;
    pares.push([i, j]);
  }
  const out: Cuad[] = [];
  for (let a = 0; a < pares.length; a++) for (let b = a + 1; b < pares.length; b++) {
    const [i, j] = pares[a], [k, l] = pares[b];
    if (new Set([i, j, k, l]).size < 4) continue;
    const d = Math.abs(ls[i].ang - ls[k].ang) % Math.PI, ang = Math.min(d, Math.PI - d);
    if (ang < (55 * Math.PI) / 180) continue;
    const c = [corte(ls[i], ls[k]), corte(ls[k], ls[j]), corte(ls[j], ls[l]), corte(ls[l], ls[i])];
    if (c.some((p) => !p || p.x < -w * 0.05 || p.y < -h * 0.05 || p.x > w * 1.05 || p.y > h * 1.05)) continue;
    out.push(ordenar(c as Punto[]));
  }
  return out;
}

/** Busca el documento en la foto. `modo`: "tarjeta" (cédula, tarjeta de propiedad) u "hoja". */
export function encontrarDocumento(foto: HTMLCanvasElement, modo: "hoja" | "tarjeta", depurar?: Record<string, unknown>[]): Encuadre | null {
  const k = LADO / Math.max(foto.width, foto.height);
  const w = Math.max(8, Math.round(foto.width * k)), h = Math.max(8, Math.round(foto.height * k)), n = w * h;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.filter = "blur(1px)";
  cx.drawImage(foto, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), gris = new Uint8Array(n);
  for (let i = 0; i < n; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; gris[i] = Math.round(R[i] * 0.299 + G[i] * 0.587 + B[i] * 0.114); }

  // Bordes: el gradiente más fuerte de los tres colores (Sobel), con su dirección (para las líneas).
  const grad = new Float32Array(n), GX = new Float32Array(n), GY = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    let m = 0;
    for (const C of [R, G, B]) {
      const gx = C[i - w + 1] + 2 * C[i + 1] + C[i + w + 1] - C[i - w - 1] - 2 * C[i - 1] - C[i + w - 1];
      const gy = C[i + w - 1] + 2 * C[i + w] + C[i + w + 1] - C[i - w - 1] - 2 * C[i - w] - C[i - w + 1];
      const v = Math.hypot(gx, gy);
      if (v > m) { m = v; GX[i] = gx; GY[i] = gy; }
    }
    grad[i] = m;
  }
  const ordenado = Float32Array.from(grad).sort();
  const pct = (p: number) => ordenado[Math.min(n - 1, Math.floor(n * p))];

  const mascaras: Uint8Array[] = [];
  // 1) Zonas encerradas por bordes: lo que no se alcanza desde el marco de la foto sin cruzar un borde fuerte.
  for (const p of [0.8, 0.88, 0.94]) {
    const u = pct(p);
    const borde = new Uint8Array(n);
    for (let i = 0; i < n; i++) borde[i] = grad[i] > u ? 1 : 0;
    const muro = cerrar(borde, w, h, 1);
    const fuera = new Uint8Array(n), pila = new Int32Array(n);
    let tope = 0;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!muro[i] && !fuera[i]) { fuera[i] = 1; pila[tope++] = i; } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!muro[i] && !fuera[i]) { fuera[i] = 1; pila[tope++] = i; } }
    while (tope) {
      const j = pila[--tope], x = j % w;
      for (const v of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (v >= 0 && v < n && !muro[v] && !fuera[v]) { fuera[v] = 1; pila[tope++] = v; }
    }
    const dentro = new Uint8Array(n);
    for (let i = 0; i < n; i++) dentro[i] = fuera[i] ? 0 : 1;
    mascaras.push(dentro);
  }
  // 2) Lo que se aparta del color del fondo (el del marco de la foto).
  {
    const marco: number[] = [];
    const ancho = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ancho || y < ancho || x >= w - ancho || y >= h - ancho) marco.push(y * w + x);
    const med = (A: Float32Array) => { const v = marco.map((i) => A[i]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const mr = med(R), mg = med(G), mb = med(B);
    const dc = new Float32Array(n);
    let max = 1;
    for (let i = 0; i < n; i++) { dc[i] = Math.hypot(R[i] - mr, G[i] - mg, B[i] - mb); if (dc[i] > max) max = dc[i]; }
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.round((dc[i] / max) * 255))]++;
    const t = otsu(hist) / 255 * max;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = dc[i] > Math.max(t, 25) ? 1 : 0;
    mascaras.push(cerrar(m, w, h, 2));
  }
  // 3) Brillo: lo claro y lo oscuro, con uno y con dos umbrales.
  {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[gris[i]]++;
    const t = otsu(hist), t1 = otsu(hist, 0, t), t2 = otsu(hist, t, 255);
    for (const u of [t, t1, t2]) {
      const claro = new Uint8Array(n), oscuro = new Uint8Array(n);
      for (let i = 0; i < n; i++) { claro[i] = gris[i] > u ? 1 : 0; oscuro[i] = claro[i] ? 0 : 1; }
      mascaras.push(cerrar(claro, w, h, 1), cerrar(oscuro, w, h, 1));
    }
  }

  const diag = Math.hypot(w, h);
  const umbralSoporte = pct(0.8);
  const candidatos: { q: Cuad; puntaje: number; soporte: number }[] = [];
  /** Contraste entre adentro y afuera de cada lado (franjas de 3 px): un documento se distingue del fondo. */
  const contraste = (q: Cuad) => {
    const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
    let suma = 0, cuenta = 0;
    q.forEach((a, i) => {
      const b = q[(i + 1) % 4], L = dist(a, b) || 1;
      let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((c.x - mx) * nx + (c.y - my) * ny > 0) { nx = -nx; ny = -ny; } // la normal hacia afuera
      for (let s = 2; s < 18; s++) {
        const t = s / 20, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const xo = Math.round(x + nx * 4), yo = Math.round(y + ny * 4), xi = Math.round(x - nx * 4), yi = Math.round(y - ny * 4);
        if (xo < 0 || yo < 0 || xo >= w || yo >= h || xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        const o = yo * w + xo, d2 = yi * w + xi;
        suma += Math.hypot(R[o] - R[d2], G[o] - G[d2], B[o] - B[d2]); cuenta++;
      }
    });
    return cuenta ? Math.min(1, suma / cuenta / 60) : 0;
  };
  /**
   * El puntaje de un cuadrilátero: qué tan rectangular es su zona (`rect`; 1 si sale de líneas), si tiene borde marcado
   * en los cuatro lados, si su proporción es de tarjeta u hoja, su tamaño, y si no es el marco de la foto ni se sale de ella.
   */
  const evaluarCuad = (q: Cuad, rect: number) => {
    const aq = area(q);
    if (aq < n * 0.04) return null;
    // Ángulos razonables (la perspectiva los deforma, pero no tanto).
    const angOk = q.every((p, i) => {
      const a = q[(i + 3) % 4], b = q[(i + 1) % 4];
      const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1)))) * 180 / Math.PI;
      return ang > 55 && ang < 125;
    });
    if (!angOk) return null;
    // Proporción: la de una tarjeta (ID-1) o la de una hoja.
    const l1 = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, l2 = (dist(q[1], q[2]) + dist(q[0], q[3])) / 2;
    const prop = Math.max(l1, l2) / Math.max(1, Math.min(l1, l2));
    const cerca = (objetivo: number, tol: number) => Math.exp(-((Math.log(prop / objetivo) / tol) ** 2));
    const forma = modo === "tarjeta" ? 0.25 + 0.75 * cerca(PROP_TARJETA, 0.3) : 0.4 + 0.6 * Math.max(...PROPS_HOJA.map((p) => cerca(p, 0.22)));
    // Borde marcado en los cuatro lados: la parte de cada lado con gradiente fuerte (en ±2 px). Un lado pegado al
    // marco de la foto (la hoja que no cabe entera) no se exige.
    const enMarco = q.map((a, i) => {
      const b = q[(i + 1) % 4];
      return [a, b].every((p) => p.x < w * 0.015 || p.x > w * 0.985) && Math.abs(a.x - b.x) < w * 0.03
        || [a, b].every((p) => p.y < h * 0.015 || p.y > h * 0.985) && Math.abs(a.y - b.y) < h * 0.03;
    });
    const soportes = q.map((a, i) => {
      const b = q[(i + 1) % 4];
      if (enMarco[i]) return 0.6;
      // Solo cuenta un borde que corre en la dirección del lado (gradiente casi perpendicular a él): la textura del
      // fondo o un objeto atravesado no.
      const L = dist(a, b) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      let si = 0;
      const N = 40;
      for (let s = 2; s < N - 2; s++) {
        const x = a.x + (b.x - a.x) * s / N, y = a.y + (b.y - a.y) * s / N;
        let g = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = Math.round(x + dx), yy = Math.round(y + dy);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const i = yy * w + xx;
          if (grad[i] > g && Math.abs(GX[i] * nx + GY[i] * ny) > 0.9 * grad[i]) g = grad[i];
        }
        if (g > umbralSoporte) si++;
      }
      return si / (N - 4);
    });
    const soporte = soportes.reduce((s, v) => s + v, 0) / 4 * (0.5 + 0.5 * Math.min(...soportes));
    // Pegado a tres o más lados de la foto: en una tarjeta casi siempre es el fondo; una hoja de cerca sí los toca
    // (solo se castiga si es la foto entera).
    const pega = [q.some((p) => p.x < w * 0.01), q.some((p) => p.x > w * 0.99), q.some((p) => p.y < h * 0.01), q.some((p) => p.y > h * 0.99)].filter(Boolean).length;
    const castigoMarco = modo === "tarjeta" ? (pega >= 3 ? 0.2 : 1) : (pega === 4 && aq > n * 0.95 ? 0.3 : 1);
    // Entre dos candidatos buenos, el más grande (no el recuadro de la foto, dentro de la cédula).
    const tamano = Math.min(1, aq / (n * 0.25)) ** 0.5;
    // Esquinas por fuera de la foto (más de un 3 %): casi siempre es un recuadro inventado con líneas del fondo.
    const esqFuera = q.filter((p) => p.x < -w * 0.03 || p.y < -h * 0.03 || p.x > w * 1.03 || p.y > h * 1.03).length;
    // Dos o más lados sobre el borde de la foto: solo quedan dos bordes de verdad (las vetas de la mesa, sin documento).
    const ladosMarco = enMarco.filter(Boolean).length;
    const puntaje = rect ** 3 * soporte ** 2 * forma * tamano * castigoMarco * 0.35 ** esqFuera * (ladosMarco >= 2 ? 0.4 : 1);
    return { puntaje, soporte, detalle: { rect: +rect.toFixed(2), soporte: +soporte.toFixed(2), forma: +forma.toFixed(2), tamano: +tamano.toFixed(2), pega, ladosMarco, esqFuera, area: +(aq / n).toFixed(2) } };
  };
  for (const m of mascaras) {
    for (const z of zonas(m, w, h, n * 0.04, 3)) {
      if (z.length > n * 0.97) continue;
      // Se rellenan los huecos de la zona (la letra, la foto) dentro de su recuadro.
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (const j of z) { const x = j % w, y = (j - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const bw = x1 - x0 + 3, bh = y1 - y0 + 3, local = new Uint8Array(bw * bh);
      for (const j of z) { const x = j % w, y = (j - x) / w; local[(y - y0 + 1) * bw + (x - x0 + 1)] = 1; }
      const fuera = new Uint8Array(bw * bh), pila = new Int32Array(bw * bh);
      let tope = 0;
      fuera[0] = 1; pila[tope++] = 0;
      while (tope) {
        const j = pila[--tope], x = j % bw;
        for (const v of [x > 0 ? j - 1 : -1, x < bw - 1 ? j + 1 : -1, j - bw, j + bw]) if (v >= 0 && v < bw * bh && !local[v] && !fuera[v]) { fuera[v] = 1; pila[tope++] = v; }
      }
      let llena = 0;
      const borde: Punto[] = [];
      for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
        const j = y * bw + x;
        if (fuera[j]) continue;
        llena++;
        if (fuera[j - 1] || fuera[j + 1] || fuera[j - bw] || fuera[j + bw]) borde.push({ x: x + x0 - 1 + 0.5, y: y + y0 - 1 + 0.5 });
      }
      if (llena < n * 0.04 || borde.length < 20) continue;
      const q0 = cuadMaximo(envolvente(borde));
      if (!q0) continue;
      const q = pegarABordes(afinar(ordenar(q0), borde, diag), grad, w, h, diag, pct(0.75));
      const aq = area(q);
      if (aq < n * 0.04) continue;
      const rect = Math.min(1, llena / aq) * Math.min(1, aq / llena);
      const r = evaluarCuad(q, rect);
      if (!r) continue;
      const puntaje = r.puntaje * (0.7 + 0.3 * contraste(q));
      depurar?.push({ mascara: mascaras.indexOf(m), puntaje: +puntaje.toFixed(3), ...r.detalle, q: q.map((p) => [Math.round(p.x / k), Math.round(p.y / k)]) });
      candidatos.push({ q, puntaje, soporte: r.soporte });
    }
  }
  // Por líneas: los cuadriláteros de las rectas fuertes, pegados a los bordes y con el mismo puntaje (sin zona: se
  // pide más contraste entre adentro y afuera).
  // Los bordes de la foto también cuentan como rectas: el documento que no cabe entero queda cortado por ellos.
  const marco = [{ ang: 0, rho: 1 }, { ang: 0, rho: w - 2 }, { ang: Math.PI / 2, rho: 1 }, { ang: Math.PI / 2, rho: h - 2 }];
  const rectas = [...lineas(GX, GY, grad, w, h, pct(0.8)), ...marco];
  depurar?.push(...rectas.map((l) => ({ mascara: "recta", puntaje: -1, ang: Math.round(l.ang * 180 / Math.PI), rho: Math.round(l.rho / k) })));
  for (const q0 of cuadsDeLineas(rectas, w, h)) {
    const q = pegarABordes(q0, grad, w, h, diag, pct(0.75));
    const r = evaluarCuad(q, 1);
    if (!r) continue;
    const puntaje = r.puntaje * (0.4 + 0.6 * contraste(q));
    depurar?.push({ mascara: "lineas", puntaje: +puntaje.toFixed(3), ...r.detalle, q: q.map((p) => [Math.round(p.x / k), Math.round(p.y / k)]) });
    candidatos.push({ q, puntaje, soporte: r.soporte });
  }
  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  let mejor = candidatos[0];
  if (!mejor || mejor.puntaje <= 0.15) return null;
  // Uno bueno que queda dentro de otro casi igual de bueno (la franja amarilla dentro de la cédula, el recuadro de los
  // datos dentro de la licencia, la columna dentro del formulario): gana el de afuera, si tiene borde casi tan marcado
  // y no es mucho más grande.
  const dentro = (p: Punto, q: Cuad) => q.every((a, i) => { const b = q[(i + 1) % 4]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -diag * 0.01 * dist(a, b); });
  const am = area(mejor.q);
  for (const c of candidatos) {
    const ac = area(c.q);
    if (ac > am * 1.03 && ac < am * 1.8 && c.puntaje >= mejor.puntaje * 0.6 && c.soporte >= Math.min(0.8, mejor.soporte * 0.85) && mejor.q.every((p) => dentro(p, c.q)) && ac > area(mejor.q)) {
      mejor = c;
    }
  }
  return { esquinas: mejor.q.map((p) => ({ x: p.x / k, y: p.y / k })) as Cuad, puntaje: mejor.puntaje };
}
