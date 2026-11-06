import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Los modelos del mapa, hechos con figuras simples de bordes redondeados (estilo maqueta isométrica): edificios
 * cerrados (vistos por fuera), árboles, carro, moto, camioneta, pines y letreros. Las
 * geometrías y materiales se comparten (un solo objeto por forma y color) para gastar poco.
 */
export const PALETA = {
  piso: "#eef1fa", calle: "#dde2f0", linea: "#ffffff", acera: "#f7f8fd", pared: "#ffffff", pared2: "#f1f4fb",
  azul: "#2f5bea", azulOscuro: "#1e3a8a", azulSuave: "#c9d6fd", carton: "#d9aa6e", cinta: "#b98447", hoja: "#fbfbfd",
  verde: "#79c497", verdeOscuro: "#4f9e72", tronco: "#8a6a4b", gris: "#334155", grisClaro: "#94a3b8", vidrio: "#cfe0ff",
  rojo: "#e5484d", ambar: "#f5a524", amarillo: "#ffd84d", llanta: "#1f2937",
} as const;

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<string, THREE.Material>();
/** Una caja de bordes redondeados (compartida por medidas). */
export function cajaR(w: number, h: number, d: number, r = 0.04): THREE.BufferGeometry {
  const k = `r${w}|${h}|${d}|${r}`;
  let g = geos.get(k);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)); geos.set(k, g); }
  return g;
}
function geo<T extends THREE.BufferGeometry>(k: string, crear: () => T): T {
  let g = geos.get(k) as T | undefined;
  if (!g) { g = crear(); geos.set(k, g); }
  return g;
}
export function mat(color: string, opciones: { transparente?: number; plano?: boolean } = {}): THREE.Material {
  const k = `${color}|${opciones.transparente ?? 1}|${opciones.plano ? 1 : 0}`;
  let m = mats.get(k);
  if (!m) {
    m = opciones.plano
      ? new THREE.MeshBasicMaterial({ color, transparent: opciones.transparente != null && opciones.transparente < 1, opacity: opciones.transparente ?? 1 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: opciones.transparente != null && opciones.transparente < 1, opacity: opciones.transparente ?? 1 });
    mats.set(k, m);
  }
  return m;
}
/** Libera todo lo compartido (al salir de la pantalla). */
export function liberarModelos() {
  for (const g of geos.values()) g.dispose();
  for (const m of mats.values()) { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); }
  geos.clear(); mats.clear();
}

const malla = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
/** Una caja redondeada apoyada en el piso (y = base). */
const bloque = (w: number, h: number, d: number, color: string, x: number, base: number, z: number, r = 0.04) => malla(cajaR(w, h, d, r), mat(color), x, base + h / 2, z);

/** Sombra "pintada" (un degradado en el piso): para el modo liviano, donde no hay sombras reales. */
let texSombra: THREE.Texture | null = null;
export function sombraPintada(w: number, d: number, x = 0, z = 0, fuerza = 0.28): THREE.Mesh {
  if (!texSombra) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, "rgba(30,40,80,1)"); grad.addColorStop(1, "rgba(30,40,80,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    texSombra = new THREE.CanvasTexture(c);
  }
  const k = `sombra|${fuerza}`;
  let m = mats.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) { m = new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, opacity: fuerza, depthWrite: false }); mats.set(k, m); }
  const o = new THREE.Mesh(geo("plano1", () => new THREE.PlaneGeometry(1, 1)), m);
  o.rotation.x = -Math.PI / 2; o.scale.set(w * 1.35, d * 1.35, 1); o.position.set(x, 0.006, z);
  o.userData.sombraPintada = true;
  return o;
}

/** Un letrero con texto (textura de lienzo). */
export function letrero(texto: string, ancho: number, alto: number, fondo: string = PALETA.azul, color = "#ffffff"): THREE.Mesh {
  const c = document.createElement("canvas");
  const esc = 256 / alto;
  c.width = Math.round(ancho * esc); c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = fondo;
  const r = 40; g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
  let tam = 150; g.font = `700 ${tam}px Inter, "Segoe UI", Arial, sans-serif`;
  while (g.measureText(texto).width > c.width * 0.88 && tam > 40) { tam -= 6; g.font = `700 ${tam}px Inter, "Segoe UI", Arial, sans-serif`; }
  g.fillText(texto, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), m);
}

export function arbol(x: number, z: number, escala = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(malla(geo("tronco", () => new THREE.CylinderGeometry(0.05, 0.07, 0.45, 8)), mat(PALETA.tronco), 0, 0.22, 0));
  g.add(malla(geo("copa", () => new THREE.SphereGeometry(0.32, 14, 10)), mat(PALETA.verde), 0, 0.68, 0));
  g.add(malla(geo("copa2", () => new THREE.SphereGeometry(0.2, 12, 8)), mat(PALETA.verdeOscuro), 0.12, 0.92, 0.05));
  g.position.set(x, 0, z); g.scale.setScalar(escala);
  return g;
}

function ruedas(g: THREE.Group, largo: number, ancho: number, radio: number) {
  const r = geo(`rueda${radio}`, () => new THREE.CylinderGeometry(radio, radio, 0.08, 14).rotateZ(Math.PI / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(malla(r, mat(PALETA.llanta), (sx * ancho) / 2, radio, (sz * largo) / 2 * 0.62));
}
/** Carro pequeño (mirando hacia +z). */
export function carro(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(bloque(0.62, 0.26, 1.2, color, 0, 0.1, 0, 0.1));
  g.add(bloque(0.54, 0.24, 0.62, PALETA.vidrio, 0, 0.34, -0.06, 0.1));
  ruedas(g, 1.2, 0.62, 0.12);
  return g;
}
/** Moto (mirando hacia +z). */
export function moto(color: string): THREE.Group {
  const g = new THREE.Group();
  const r = geo("ruedaMoto", () => new THREE.TorusGeometry(0.11, 0.035, 8, 16).rotateY(Math.PI / 2));
  g.add(malla(r, mat(PALETA.llanta), 0, 0.14, 0.3), malla(r, mat(PALETA.llanta), 0, 0.14, -0.3));
  g.add(bloque(0.14, 0.14, 0.5, color, 0, 0.18, 0, 0.05));
  g.add(bloque(0.16, 0.06, 0.28, PALETA.gris, 0, 0.33, -0.08, 0.03));
  g.add(malla(geo("manubrio", () => new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6).rotateZ(Math.PI / 2)), mat(PALETA.gris), 0, 0.44, 0.24));
  return g;
}
/** Un cono de pista (naranja con franja blanca), como los de las academias de conducción. */
export function cono(): THREE.Group {
  const g = new THREE.Group();
  g.add(bloque(0.26, 0.03, 0.26, "#ea580c", 0, 0, 0, 0.01));
  g.add(malla(geo("cono", () => new THREE.ConeGeometry(0.1, 0.34, 14)), mat("#f97316"), 0, 0.2, 0));
  g.add(malla(geo("conoFranja", () => new THREE.CylinderGeometry(0.052, 0.068, 0.06, 14)), mat("#ffffff"), 0, 0.22, 0));
  return g;
}
/** Camioneta de mensajería con el azul de la oficina (mirando hacia +z). */
export function camioneta(): THREE.Group {
  const g = new THREE.Group();
  g.add(bloque(0.66, 0.6, 1.0, PALETA.pared, 0, 0.14, -0.18, 0.06));     // furgón
  g.add(bloque(0.67, 0.12, 1.01, PALETA.azul, 0, 0.5, -0.18, 0.03));     // franja
  g.add(bloque(0.62, 0.42, 0.42, PALETA.azul, 0, 0.14, 0.52, 0.08));     // cabina
  g.add(bloque(0.56, 0.16, 0.05, PALETA.vidrio, 0, 0.42, 0.73, 0.02));   // parabrisas
  ruedas(g, 1.35, 0.66, 0.13);
  return g;
}
/** Un pin de mapa (la gota con el punto), con su punta en (0, 0, 0). */
export function pin(color: string = PALETA.azul, escala = 1): THREE.Group {
  const g = new THREE.Group();
  const cabeza = malla(geo("pinCabeza", () => new THREE.SphereGeometry(0.16, 18, 14)), mat(color), 0, 0.42, 0);
  const punta = malla(geo("pinPunta", () => new THREE.ConeGeometry(0.13, 0.3, 18).rotateX(Math.PI)), mat(color), 0, 0.22, 0);
  const punto = malla(geo("pinPunto", () => new THREE.SphereGeometry(0.065, 12, 10)), mat("#ffffff"), 0, 0.42, 0.12);
  g.add(cabeza, punta, punto);
  g.scale.setScalar(escala);
  return g;
}

/**
 * Un edificio cerrado, visto por fuera: paredes, techo con alero, puerta al medio del frente (hacia la calle, +z) y
 * ventanas a los lados de la puerta y en el costado derecho. El letrero lo pone quien lo usa, en la fachada.
 */
export function edificio(ancho: number, fondo: number, alto: number, color: string = PALETA.pared, acento: string = PALETA.azul): THREE.Group {
  const g = new THREE.Group();
  const piso = 0.08;
  g.add(bloque(ancho + 0.2, piso, fondo + 0.2, PALETA.pared2, 0, 0, 0, 0.03));
  g.add(bloque(ancho, alto, fondo, color, 0, piso, 0, 0.04));                                                       // el cuerpo
  g.add(bloque(ancho + 0.18, 0.12, fondo + 0.18, acento, 0, piso + alto, 0, 0.03));                                  // techo con alero
  g.add(bloque(ancho + 0.02, 0.1, fondo + 0.02, PALETA.pared2, 0, piso, 0, 0.02));                                    // zócalo
  const puerta = Math.min(0.9, ancho * 0.22), altoPuerta = Math.min(1.05, alto * 0.48);
  g.add(bloque(puerta + 0.1, altoPuerta + 0.06, 0.04, acento, 0, piso, fondo / 2 + 0.01, 0.01));                     // marco
  g.add(bloque(puerta, altoPuerta, 0.04, PALETA.vidrio, 0, piso, fondo / 2 + 0.025, 0.01));                           // puerta de vidrio
  g.add(bloque(puerta + 0.4, 0.05, 0.36, acento, 0, piso + altoPuerta + 0.12, fondo / 2 + 0.18, 0.02));             // alero de la puerta
  const altoV = alto * 0.26, yV = piso + alto * 0.27;
  const ventanas = Math.max(1, Math.floor((ancho / 2 - puerta / 2 - 0.3) / 0.95));
  for (let lado = -1; lado <= 1; lado += 2) for (let n = 0; n < ventanas; n++) {
    const x = lado * (puerta / 2 + 0.55 + n * 0.95);
    g.add(bloque(0.66, altoV, 0.03, PALETA.vidrio, x, yV, fondo / 2 + 0.015, 0.01));
    g.add(bloque(0.74, 0.04, 0.06, PALETA.pared2, x, yV - 0.03, fondo / 2 + 0.03, 0.01));                            // repisa
  }
  for (let n = 0; n < Math.max(1, Math.floor(fondo / 1.3)); n++) g.add(bloque(0.03, altoV, 0.6, PALETA.vidrio, ancho / 2 + 0.015, yV, -fondo / 2 + 0.75 + n * 1.3, 0.01));
  return g;
}

/** Bandera de Colombia en su asta. */
export function bandera(): THREE.Group {
  const g = new THREE.Group();
  g.add(malla(geo("asta", () => new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8)), mat(PALETA.grisClaro), 0, 1.1, 0));
  const franja = (color: string, y: number, h: number) => bloque(0.7, h, 0.02, color, 0.36, y, 0, 0.005);
  g.add(franja("#fcd116", 1.86, 0.16), franja("#003893", 1.78, 0.08), franja("#ce1126", 1.7, 0.08));
  return g;
}

/** Un número "al azar" pero siempre igual para la misma semilla (para que cada ciudad se vea siempre igual). */
function azar(semilla: number) {
  let s = semilla >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export const semillaDe = (texto: string) => [...texto].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * Una ciudad en miniatura para el mapa de Colombia: una base redonda con edificios de distintas alturas (con ventanas
 * y techo), unos árboles y, en la ciudad de la oficina, el edificio de la oficina en azul. Devuelve el grupo y la
 * altura del edificio más alto (para poner encima el marcador).
 */
export function ciudadMini(semilla: number, opciones: { grande?: boolean; oficina?: boolean; alerta?: boolean } = {}): { grupo: THREE.Group; alto: number } {
  const r = azar(semilla);
  const g = new THREE.Group();
  const radio = opciones.grande ? 0.62 : 0.42;
  g.add(malla(geo(`baseCiudad${radio}`, () => new THREE.CylinderGeometry(radio, radio + 0.03, 0.06, 28)), mat(PALETA.pared), 0, 0.03, 0));
  g.add(malla(geo(`bordeCiudad${radio}`, () => new THREE.TorusGeometry(radio + 0.005, 0.012, 6, 36).rotateX(Math.PI / 2)), mat(opciones.alerta ? PALETA.rojo : PALETA.azulSuave), 0, 0.06, 0));
  const colores = ["#ffffff", "#eef2ff", "#dfe7ff", "#cdd9fd"];
  const techos = [PALETA.azul, PALETA.azulOscuro, PALETA.gris, "#5b6b8c"];
  const n = opciones.grande ? 8 : 5;
  let alto = 0;
  const puestos: [number, number][] = [];
  for (let i = 0; i < n * 4 && puestos.length < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (radio - 0.14);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (puestos.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.2)) continue;
    puestos.push([x, z]);
  }
  puestos.forEach(([x, z], i) => {
    const oficina = opciones.oficina && i === 0;
    const w = oficina ? 0.26 : 0.13 + r() * 0.1, d = oficina ? 0.22 : 0.13 + r() * 0.1;
    const h = oficina ? 0.42 : (opciones.grande ? 0.22 : 0.16) + r() * (opciones.grande ? 0.55 : 0.35);
    alto = Math.max(alto, h);
    const color = oficina ? PALETA.azul : colores[Math.floor(r() * colores.length)];
    g.add(bloque(w, h, d, color, x, 0.06, z, 0.02));
    g.add(bloque(w + 0.015, 0.03, d + 0.015, oficina ? PALETA.azulOscuro : techos[Math.floor(r() * techos.length)], x, 0.06 + h, z, 0.01));
    // Ventanas: franjas por piso en las dos caras que mira la cámara.
    const pisos = Math.max(1, Math.floor(h / 0.1));
    for (let p = 0; p < Math.min(pisos, 5); p++) {
      const y = 0.06 + 0.05 + p * (h - 0.08) / Math.min(pisos, 5);
      g.add(bloque(w * 0.8, 0.028, 0.006, oficina ? "#ffffff" : PALETA.vidrio, x, y, z + d / 2 + 0.002, 0.002));
      g.add(bloque(0.006, 0.028, d * 0.8, oficina ? "#ffffff" : PALETA.vidrio, x + w / 2 + 0.002, y, z, 0.002));
    }
  });
  for (let k = 0; k < (opciones.grande ? 3 : 2); k++) {
    const a = r() * Math.PI * 2, d = radio - 0.07;
    const t = arbol(Math.cos(a) * d, Math.sin(a) * d, 0.22);
    t.position.y = 0.06;
    g.add(t);
  }
  return { grupo: g, alto: alto + 0.09 };
}

/** Una ciudad del mapa de Colombia: dónde (en la escena), su semilla, su tamaño (0 a 1) y si es la de la oficina. */
export interface CiudadPequena { x: number; z: number; y: number; semilla: number; tam: number; oficina?: boolean }

/** Colores del tablero de Colombia (estilo maqueta: edificios blancos, calles grises, parques verdes). */
export const MAQUETA = { tierra: "#e3ead9", linea: "#c6d0bb", calle: "#c3c8d2", parque: "#b9d7a6", edificio: "#ffffff", plaza: "#f3f5ee" } as const;

/**
 * El tamaño de cada ciudad sin que se monte sobre otra: la más grande escoge primero y ninguna pasa del espacio que le
 * dejan sus vecinas (ya ubicadas: la distancia menos su tamaño; por ubicar: menos de la mitad de la distancia).
 */
export function radiosSinChoque(lista: { x: number; z: number; tam: number; oficina?: boolean }[]): number[] {
  const deseado = (c: { tam: number }) => 0.03 + c.tam * c.tam * 0.2;
  const orden = lista.map((_, i) => i).sort((a, b) => lista[b].tam - lista[a].tam);
  const radios = new Array<number>(lista.length).fill(0);
  const puesto = new Array<boolean>(lista.length).fill(false);
  for (const i of orden) {
    let r = deseado(lista[i]);
    for (let j = 0; j < lista.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(lista[i].x - lista[j].x, lista[i].z - lista[j].z);
      r = Math.min(r, puesto[j] ? d * 0.9 - radios[j] : d * 0.45);
    }
    radios[i] = Math.max(0.018, r);
    puesto[i] = true;
  }
  return radios;
}

/**
 * Todas las ciudades del país como una maqueta (como un render de contexto urbano): edificios blancos en manzanas,
 * calles grises y algún parque, clavadas sobre el país, sin base. Cada ciudad ocupa un cuadro cuyo tamaño no choca con
 * el de sus vecinas. Muy pocas mallas (una para todos los edificios, una para las calles, una para los parques): un
 * mapa lleno de ciudades no pesa. Devuelve el grupo, la altura de cada ciudad (para la etiqueta) y su radio.
 */
export function ciudadesPequenas(lista: CiudadPequena[]): { grupo: THREE.Group; altos: number[]; radios: number[]; bases: null } {
  type Inst = { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot?: number };
  const edificios: Inst[] = [], calles: Inst[] = [], parques: Inst[] = [], plazas: Inst[] = [];
  const altos: number[] = [];
  const radios = radiosSinChoque(lista);
  lista.forEach((c, n) => {
    const r = azar(c.semilla);
    const radio = radios[n];
    // Cuadrícula de k x k manzanas, girada un poco (las ciudades no miran todas al norte).
    const k = Math.max(1, Math.min(6, Math.round(1 + c.tam * c.tam * 5)));
    const lado = radio * 1.5, manz = lado / k, ancho = Math.max(0.004, manz * 0.16);
    // La plaza: un disco claro bajo la ciudad (el grupo de edificios y un borde).
    const rp = lado * 0.72 + 0.04;
    plazas.push({ x: c.x, y: c.y + 0.001, z: c.z, sx: rp, sy: 0.002, sz: rp });
    const giro = (r() - 0.5) * 0.9, cs = Math.cos(giro), sn = Math.sin(giro);
    const en = (u: number, v: number) => ({ x: c.x + u * cs - v * sn, z: c.z + u * sn + v * cs });
    for (let i = 0; i <= k; i++) {
      const t = -lado / 2 + i * manz;
      const a = en(t, 0), b = en(0, t);
      calles.push({ x: a.x, y: c.y + 0.002, z: a.z, sx: ancho, sy: 0.004, sz: lado + ancho, rot: -giro });
      calles.push({ x: b.x, y: c.y + 0.002, z: b.z, sx: lado + ancho, sy: 0.004, sz: ancho, rot: -giro });
    }
    let alto = 0.02;
    const centro = (k - 1) / 2;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const u0 = -lado / 2 + i * manz + manz / 2, v0 = -lado / 2 + j * manz + manz / 2;
      const util = manz - ancho * 1.6;
      // Algún parque, nunca en el centro.
      if (k > 1 && r() < 0.12 && (i !== Math.round(centro) || j !== Math.round(centro))) {
        const p = en(u0, v0);
        parques.push({ x: p.x, y: c.y + 0.003, z: p.z, sx: util, sy: 0.006, sz: util, rot: -giro });
        continue;
      }
      // Más alto hacia el centro (como un centro de ciudad), y la oficina con el más alto.
      const cerca = 1 - Math.hypot(i - centro, j - centro) / (k * 0.75 + 0.01);
      const piezas = util > 0.03 ? 1 + Math.floor(r() * 3) : 1;
      for (let q = 0; q < piezas; q++) {
        const w = util * (piezas === 1 ? 0.8 : 0.42 + r() * 0.12), d = util * (piezas === 1 ? 0.8 : 0.42 + r() * 0.12);
        const du = piezas === 1 ? 0 : (q % 2 ? 1 : -1) * (util - w) / 2, dv = piezas === 1 ? 0 : (q < 2 ? -1 : 1) * (util - d) / 2 * (piezas === 3 && q === 2 ? 0 : 1);
        const h = Math.max(0.012, 0.01 + r() * 0.02 + Math.max(0, cerca) * (0.01 + c.tam * c.tam * 0.16));
        alto = Math.max(alto, h);
        const p = en(u0 + du, v0 + dv);
        edificios.push({ x: p.x, y: c.y + 0.004 + h / 2, z: p.z, sx: w, sy: h, sz: d, rot: -giro });
      }
    }
    altos.push(alto + 0.02);
  });
  const tmp = new THREE.Object3D();
  const instanciar = (g: THREE.BufferGeometry, m: THREE.Material, l: Inst[]) => {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, l.length));
    im.count = l.length;
    l.forEach((it, i) => { tmp.position.set(it.x, it.y, it.z); tmp.scale.set(it.sx, it.sy, it.sz); tmp.rotation.set(0, it.rot ?? 0, 0); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix); });
    im.instanceMatrix.needsUpdate = true;
    return im;
  };
  const cubo = geo("cubo", () => new THREE.BoxGeometry(1, 1, 1));
  const grupo = new THREE.Group();
  const casas = instanciar(cubo, new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 }), edificios);
  // Un tono apenas distinto por edificio (blanco con un toque azulado): la maqueta no se ve plana.
  const tono = new THREE.Color(), blanco = new THREE.Color(MAQUETA.edificio), azulado = new THREE.Color("#e9eefb");
  edificios.forEach((_, i) => casas.setColorAt(i, tono.copy(blanco).lerp(azulado, ((i * 37) % 11) / 10)));
  if (casas.instanceColor) casas.instanceColor.needsUpdate = true;
  casas.castShadow = true; casas.receiveShadow = true; casas.userData.sombra = true;
  grupo.add(casas);
  const disco = geo("disco", () => new THREE.CylinderGeometry(1, 1, 1, 32));
  const suelos = instanciar(disco, mat(MAQUETA.plaza), plazas);
  suelos.receiveShadow = true;
  grupo.add(suelos);
  const vias = instanciar(cubo, mat(MAQUETA.calle), calles);
  vias.receiveShadow = true;
  grupo.add(vias);
  const verdes = instanciar(cubo, mat(MAQUETA.parque), parques);
  verdes.receiveShadow = true;
  grupo.add(verdes);
  return { grupo, altos, radios, bases: null };
}
