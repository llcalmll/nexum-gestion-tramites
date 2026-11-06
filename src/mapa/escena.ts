import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { notaHtml } from "../componentes/NotaVistazo";
import { type Capa, type CiudadDatos } from "./ciudades";
import { abierta, type Carpeta, type Geo, HEX_LUZ, LUCES_MAPA, type Luz, NOMBRE_LUZ, type Zona } from "./lugares";
import { arbol, bandera, cajaR, camioneta, carro, ciudadesPequenas, cono, edificio, letrero, liberarModelos, MAQUETA, mat, moto, PALETA, semillaDe, sombraPintada } from "./modelos";

/**
 * La escena 3D de la pantalla Mapa (three.js, sin React), en estilo maqueta isométrica. Dos niveles:
 *  - Colombia: el país como una placa (con textura), cada ciudad con sus edificios sobre una plaza clara, un halo
 *    de color debajo y su etiqueta (nombre en un recuadro y puntos de estado sueltos y clicables). Venas unen cada
 *    ciudad con Ibagué: quietas y grises; la de una ciudad con trámites abiertos o sobres en camino lleva un pulso que
 *    fluye hacia ella (y si hay sobres, su marcador en la mitad).
 *  - Una ciudad: su cuadra, con los edificios vistos por fuera (cerrados). En Ibagué, la oficina (sus lugares:
 *    recibidos de vehículos y de personas, corrección, ya salió) y al lado el tránsito; en otra ciudad, su tránsito (con
 *    los trámites radicados allá) y la oficina del tramitador, si hay, con él de pie afuera. Los lugares y sus trámites
 *    van en el HUD de la pantalla (arriba a la izquierda, `lugaresDe`), no encima de los edificios: al pasar por uno o
 *    elegirlo, su edificio se resalta como en un videojuego (marco que late en el piso, contorno y un rombo que flota
 *    encima). Tocar un edificio despliega sus trámites sin mover la cámara.
 * Se pasa de uno a otro volando con la cámara (tocar la ciudad; salir o alejarse del todo para volver).
 * Lo que se despliega (listas de píldoras, la carpeta elegida) lo arma la pantalla como HTML y la escena lo pone junto
 * a su ancla, apartando su espacio para que ninguna etiqueta se monte encima.
 * Liviana para un PC modesto: solo dibuja cuando algo cambia (o mientras algo se mueve), sombras reales solo en el modo
 * normal (en el liviano, sombras pintadas).
 */
export type Nivel = { tipo: "colombia" } | { tipo: "ciudad"; clave: string };
export type CiudadMapa = CiudadDatos;
export interface LugarElegido { clave: string; titulo: string; carpetas: Carpeta[] }
/** Dónde se ancla lo que se despliega encima del 3D. */
export type Ancla = { tipo: "ciudad"; clave: string } | { tipo: "lugar"; clave: string } | { tipo: "vena"; clave: string } | { tipo: "carpeta"; id: string };
/**
 * HTML que arma la pantalla y la escena pone junto a su ancla: "lista" al lado (a la izquierda si no cabe a la derecha),
 * "carpeta" centrada sobre la carpeta. `activo`: el botón de la etiqueta que lo abrió (queda encendido).
 */
export interface Despliegue { ancla: Ancla; html: string; modo: "lista" | "carpeta"; activo?: { attr: "col" | "acc" | "env"; valor: string } }
export interface Escena {
  datos(d: { ciudades: CiudadMapa[] }): void;
  /** La capa de información (qué número y qué color muestran las ciudades). */
  capa(c: Capa): void;
  /** Seleccionar una ciudad (y llevar la cámara hasta ella), o nada. */
  seleccionar(clave: string | null): void;
  /** Lo que se despliega junto a una ciudad, un lugar, una vena o encima de una carpeta (HTML), o nada. */
  despliegue(d: Despliegue | null): void;
  /** Las carpetas de un lugar de la ciudad que se está viendo (para sus listas). */
  carpetasDe(clave: string): Carpeta[];
  /** Elegir un lugar de la ciudad (desde el HUD): se resalta su edificio y se despliegan sus trámites; null lo suelta. */
  lugar(clave: string | null): void;
  /** Resaltar de paso el edificio de un lugar (el mouse sobre el HUD); null vuelve al elegido. */
  resaltar(clave: string | null): void;
  /** Mover la vista de Colombia hasta un punto (desde el minimapa). */
  enfocar(x: number, z: number): void;
  ir(n: Nivel): void;
  zoom(factor: number): void;
  recentrar(): void;
  movimiento(si: boolean): void;
  fondo(color: string): void;
  destruir(): void;
}
interface Eventos {
  /** Al pasar sobre una ciudad en el mapa de Colombia (null al salir). */
  ciudad(c: CiudadMapa | null, x: number, y: number): void;
  lugar(l: LugarElegido | null): void;
  nivel(n: Nivel): void;
  /** La ciudad seleccionada en Colombia (null si ninguna). */
  seleccion(c: CiudadMapa | null): void;
  /** Lo que la cámara ve del país (cuatro esquinas en el suelo, en coordenadas del mapa): para el minimapa. */
  camara(esquinas: [number, number][]): void;
  /** El lugar de la ciudad que tiene el mouse encima en el 3D (para marcarlo también en el HUD), o null. */
  sobreLugar?: (clave: string | null) => void;
  /** Clic derecho en otra parte del mapa: sobre una ciudad (en Colombia), sobre un lugar (dentro), o en el fondo. */
  menuFondo?: (donde: { ciudad?: string; lugar?: string }, e: MouseEvent) => void;
}

const LON0 = -73.6, LAT0 = 4.6, K = Math.cos((LAT0 * Math.PI) / 180), E = 1.15;
export const proyectar = (lon: number, lat: number) => new THREE.Vector2((lon - LON0) * K * E, -(lat - LAT0) * E);
/** El color de cada capa (bases de las ciudades y números). */
export const COLOR_CAPA: Record<Capa, string> = { abiertos: PALETA.azul, atrasados: PALETA.rojo, historico: "#7c3aed", cobrar: "#d97706", aliados: PALETA.verdeOscuro };
/** Plata en corto: $ 1,2 M, $ 350 mil. */
export const plataCorta = (n: number) => (n >= 1e6 ? `$ ${(n / 1e6).toFixed(1).replace(".", ",")} M` : n >= 1e3 ? `$ ${Math.round(n / 1e3)} mil` : `$ ${n}`);
const ESPESOR = 0.3;
/**
 * Cuánto se estira la vista a lo ancho (Felipe, 23/10/2026: le gustó así, "estilo Age of Empires"; salió de un error
 * del modo liviano que dejaba la cámara con la proporción de un cuadrado en su pantalla 1,42:1). 1 = sin estirar.
 */
const ESTIRAR = 1.42;
const suave = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Los puntos son los estados de los trámites (los colores de las luces de la tabla); su cantidad, en plural. */
const PLURAL_LUZ: Record<Luz, string> = {
  recibido: "recibidos (en la oficina)", transito: "en tránsito", correccion: "en corrección", salio: "ya salieron (falta entregar el documento)",
};
const contar = (l: Carpeta[]) => { const n: Partial<Record<Luz, number>> = {}; for (const x of l) n[x.luz] = (n[x.luz] ?? 0) + 1; return n; };
/** Hasta cuántos trámites de una ciudad se ven con su placa en la etiqueta (más, y solo se ven los puntos con su cantidad). */
const PLACAS_HASTA = 3;
const placaBonita = (p: string) => (p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p);
const svg = (d: string, t = 19) => `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONO_ACC = {
  entrar: '<path d="M3 21h18"/><path d="M5 21V4a1 1 0 0 1 1-1h9l4 3v15"/><path d="M14 12h.01"/>',
  todos: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  tramitadores: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20a5.5 5.5 0 0 0-3.5-5.1"/>',
};
/** El color de las academias de conducción (techo, letrero y su icono). */
const NARANJA = "#c2410c";
/** Los iconos de las placas de la ciudad (trazos como los de la app) y su color, por lugar. */
const IC = {
  carro: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  transito: '<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4z"/>',
  academia: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  tramitador: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="m16 11 2 2 4-4"/>',
  oficina: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01"/>',
};
function iconoLugar(clave: string): [string, string] {
  if (clave === "oficina") return [IC.oficina, PALETA.azul];
  if (clave.startsWith("academia-")) return [IC.academia, NARANJA];
  if (clave.startsWith("aliado-")) return [IC.tramitador, "#0f766e"];
  const l: Record<string, [string, string]> = {
    vehiculos: [IC.carro, "#475569"], personas: [IC.persona, "#475569"], correccion: [IC.alerta, HEX_LUZ.correccion],
    salida: [IC.enviar, HEX_LUZ.salio], transito: [IC.transito, PALETA.azulOscuro], fuera: [IC.transito, PALETA.azulOscuro],
  };
  return l[clave] ?? [IC.transito, PALETA.azulOscuro];
}
/**
 * Un lugar de la cuadra (el mismo en la escena y en el HUD de la pantalla). `edificio`: el edificio donde está, si
 * comparte uno con otros (los de la oficina); `objeto`: sus trámites ya salen en otro lugar (la oficina entera, la
 * academia, el tramitador), así que el HUD no los repite.
 */
export interface LugarCiudad { clave: string; titulo: string; carpetas: Carpeta[]; nota: string; icono: string; color: string; objeto: boolean; edificio?: string }
const DE_LA_OFICINA: [Zona, string][] = [["vehiculos", "Recibidos: vehículos"], ["personas", "Recibidos: personas"], ["correccion", "Corrección"], ["salida", "Ya salió"]];
/** Los lugares de la cuadra de una ciudad, en el orden del HUD: cada edificio y, debajo, los lugares que tiene dentro. */
export function lugaresDe(c: CiudadMapa): LugarCiudad[] {
  const l: Omit<LugarCiudad, "icono" | "color">[] = [];
  if (c.oficina) {
    const zonas = DE_LA_OFICINA.map(([z]) => c.carpetas.filter((x) => x.zona === z));
    l.push({ clave: "oficina", titulo: "Trámites Pira", carpetas: zonas.flat(), nota: "La oficina", objeto: true });
    DE_LA_OFICINA.forEach(([z, titulo], i) => l.push({ clave: z, titulo, carpetas: zonas[i], nota: "", objeto: false, edificio: "oficina" }));
    l.push({ clave: "transito", titulo: "Tránsito de Ibagué", carpetas: c.carpetas.filter((x) => x.zona === "transito"), nota: "", objeto: false });
    for (const a of c.academias ?? []) {
      const clientes = `${a.clientes.length} cliente${a.clientes.length === 1 ? "" : "s"}`;
      l.push({ clave: `academia-${a.clave}`, titulo: a.nombre, carpetas: a.carpetas, nota: a.detalle ? `${a.detalle} · ${clientes}` : clientes, objeto: true });
    }
  } else {
    l.push({ clave: "fuera", titulo: `Tránsito de ${c.nombre}`, carpetas: c.carpetas, nota: "", objeto: false });
    c.aliados.slice(0, 2).forEach((nombre, i) => l.push({ clave: `aliado-${i}`, titulo: `Tramitador: ${nombre}`, carpetas: c.carpetas.filter((x) => x.zona === "fuera"), nota: "Su contacto y los trámites de la ciudad", objeto: true }));
  }
  return l.map((x) => {
    let nota = x.nota;
    if (!nota && (x.clave === "transito" || x.clave === "fuera")) { const m = Math.max(0, ...x.carpetas.map((y) => y.espera ?? 0)); if (m) nota = `Espera mayor: ${m} día${m === 1 ? "" : "s"}`; }
    if (!nota && x.clave === "salida") { const sal = x.carpetas.reduce((a, y) => a + (y.saldo ?? 0), 0); if (sal) nota = `${plataCorta(sal)} por cobrar`; }
    const [icono, color] = iconoLugar(x.clave);
    return { ...x, nota, icono, color };
  });
}
const SOBRE = svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', 12);
type Rect = [number, number, number, number];
const choca = (r: Rect) => (o: Rect) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1];

/** `altoChoque`: para no tapar a las demás, solo cuenta esa altura de abajo (las placas flotan encima sin esconder a nadie). */
interface Etiqueta {
  el: HTMLDivElement; pos: THREE.Vector3; escena: "colombia" | "ciudad"; prioridad: number; cuando?: () => boolean; altoChoque?: number;
  /** Dónde cayó en pantalla (abajo al centro) y su tamaño (se mide solo cuando cambia su contenido). */
  sx?: number; sy?: number; w?: number; h?: number;
  /** La seleccionada aparta espacio arriba (sus burbujas) y un ancho mínimo; la que tiene algo desplegado siempre se ve. */
  reservaArriba?: number; anchoMin?: number; fijo?: boolean;
}
/** Un lugar de la ciudad armado en la escena: su caja (la de su edificio) y si el edificio mismo se toca. */
interface Lugar extends LugarCiudad { caja: THREE.Box3; tocable: boolean }

export function crearEscena(lienzo: HTMLCanvasElement, capa: HTMLDivElement, geo: Geo, ev: Eventos, opciones: { liviano: boolean }): Escena {
  const liviano = opciones.liviano;
  const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !liviano, powerPreference: "default" });
  render.setPixelRatio(Math.min(window.devicePixelRatio || 1, liviano ? 1 : 1.75));
  render.shadowMap.enabled = !liviano;
  render.shadowMap.type = THREE.PCFShadowMap;
  render.shadowMap.autoUpdate = false;
  let pendiente = 0;

  const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const controles = new OrbitControls(camara, lienzo);
  controles.enableDamping = false;
  controles.screenSpacePanning = false;
  controles.addEventListener("change", () => pedir());

  // ─── Luz (igual en los dos niveles) ───
  function luces(e: THREE.Scene, tam: number) {
    e.add(new THREE.HemisphereLight("#ffffff", "#c9cfe6", 1.25));
    const sol = new THREE.DirectionalLight("#ffffff", 2.0);
    sol.position.set(tam * 0.5, tam * 1.1, tam * 0.75);
    sol.castShadow = !liviano;
    sol.shadow.mapSize.set(2048, 2048);
    const c = sol.shadow.camera as THREE.OrthographicCamera;
    c.left = -tam; c.right = tam; c.top = tam; c.bottom = -tam; c.near = 0.5; c.far = tam * 4;
    sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 4;
    e.add(sol);
  }
  /** Sombras reales (modo normal) o pintadas (liviano). */
  function sombras(o: THREE.Object3D, w = 0, d = 0) {
    if (!liviano) o.traverse((x) => { if (x instanceof THREE.Mesh && !x.userData.sombraPintada) { x.castShadow = true; x.receiveShadow = true; } });
    else if (w && d) o.add(sombraPintada(w, d));
  }

  const etiquetas: Etiqueta[] = [];
  function etiqueta(html: string, pos: THREE.Vector3, escena: "colombia" | "ciudad", clase = "", prioridad = 0): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `mapa-etq ${clase}`;
    el.innerHTML = html;
    capa.appendChild(el);
    etiquetas.push({ el, pos, escena, prioridad });
    etiquetas.sort((a, b) => b.prioridad - a.prioridad);
    return el;
  }
  const quitarEtiquetas = (escena: "colombia" | "ciudad") => {
    for (let i = etiquetas.length - 1; i >= 0; i--) if (etiquetas[i].escena === escena) { etiquetas[i].el.remove(); etiquetas.splice(i, 1); }
  };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

  // ─── Texturas y materiales compartidos ───
  /** El terreno: el color de la maqueta con un ruido muy suave y una retícula de puntos tenue. */
  const texTierra = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = MAQUETA.tierra; g.fillRect(0, 0, 128, 128);
    const img = g.getImageData(0, 0, 128, 128);
    let r = 7;
    for (let i = 0; i < img.data.length; i += 4) { r = (r * 16807) % 2147483647; const n = ((r % 1000) / 1000 - 0.5) * 7; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.fillStyle = "rgba(110,128,100,0.22)";
    for (let x = 8; x < 128; x += 16) for (let y = 8; y < 128; y += 16) { g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  /** El halo de color bajo cada ciudad: un degradado radial (el color lo pone el material). */
  const texHalo = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.42, "rgba(255,255,255,0.42)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const matsHalo = new Map<string, THREE.MeshBasicMaterial>();
  const matHalo = (color: string) => {
    let m = matsHalo.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ map: texHalo, color, transparent: true, opacity: 0.62, depthWrite: false }); matsHalo.set(color, m); }
    return m;
  };
  const gHalo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  /** El pulso de una vena activa: transparente → azul → casi blanco → transparente (se repite según el largo). */
  const lienzoPulso = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 4;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, "rgba(47,91,234,0)"); gr.addColorStop(0.42, "rgba(47,91,234,0.85)"); gr.addColorStop(0.52, "rgba(238,243,255,1)"); gr.addColorStop(0.62, "rgba(47,91,234,0)"); gr.addColorStop(1, "rgba(47,91,234,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 4);
    return c;
  })();
  const matVena = new THREE.MeshBasicMaterial({ color: "#9aa6b8", transparent: true, opacity: 0.45, depthWrite: false });
  const matVenaAliado = new THREE.MeshBasicMaterial({ color: "#4f9e72", transparent: true, opacity: 0.85, depthWrite: false });
  const matVenaActiva = new THREE.MeshBasicMaterial({ color: "#2f5bea", transparent: true, opacity: 0.3, depthWrite: false });

  // ─── Colombia ───
  const colombia = new THREE.Scene();
  luces(colombia, 12);
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: PALETA.piso, roughness: 1 }));
  suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = !liviano;
  colombia.add(suelo);
  for (const anillo of geo.pais) {
    const forma = new THREE.Shape(anillo.map(([lon, lat]) => { const p = proyectar(lon, lat); return new THREE.Vector2(p.x, -p.y); }));
    const g = new THREE.ExtrudeGeometry(forma, { depth: ESPESOR, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    // El país como el suelo de una maqueta: verde claro, con las ciudades clavadas encima.
    const placa = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#ffffff", map: texTierra, roughness: 1 }));
    placa.castShadow = placa.receiveShadow = !liviano;
    colombia.add(placa);
    if (liviano) colombia.add(sombraPintada(9, 12, 0.6, 1.2, 0.18));
  }
  {
    const lineas: number[] = [];
    for (const d of geo.departamentos) for (const anillo of d.anillos) for (let i = 0; i < anillo.length - 1; i++) {
      const a = proyectar(anillo[i][0], anillo[i][1]), b = proyectar(anillo[i + 1][0], anillo[i + 1][1]);
      lineas.push(a.x, ESPESOR + 0.045, a.y, b.x, ESPESOR + 0.045, b.y);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(lineas, 3));
    colombia.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: MAQUETA.linea })));
  }
  let marcas = new THREE.Group();
  colombia.add(marcas);
  /** Las venas (una por ciudad, hasta Ibagué), los pulsos de las activas, sus marcadores y el halo de cada ciudad. */
  let venas: { tubo: THREE.Mesh; aliado: boolean }[] = [];
  let pulsos: THREE.Texture[] = [];
  const marcadoresVena = new Map<string, Etiqueta>();
  let halos: THREE.Mesh[] = [];
  const tocablesColombia: THREE.Object3D[] = [];
  let ciudades: CiudadMapa[] = [];
  let ibague: CiudadMapa | null = null;
  const buscar = (clave: string) => ciudades.find((x) => x.clave === clave) ?? null;
  let capaActual: Capa = "abiertos";
  let altos: number[] = [], radios: number[] = [];
  let etiquetasCiudad: { c: CiudadMapa; el: HTMLDivElement; et: Etiqueta }[] = [];
  let seleccionada: string | null = null;
  const aro = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 48).rotateX(Math.PI / 2), mat(PALETA.azul, { plano: true }));
  aro.visible = false;
  colombia.add(aro);
  /** Tamaño de la ciudad en el mapa (0 a 1) según cuántos trámites ha tenido. */
  /**
   * Tamaño de la ciudad en el mapa (0 a 1), coherente con la real: por su población urbana (DANE 2026), en escala
   * logarítmica (un pueblo de 2.000 habitantes casi nada, Bogotá con 7,9 millones el máximo). Sin el dato, chica.
   */
  const tamDe = (c: CiudadMapa) => (c.poblacion ? THREE.MathUtils.clamp((Math.log10(c.poblacion) - 3.3) / (Math.log10(8e6) - 3.3), 0.04, 1) : 0.08);
  let distancia = 16;

  function armarColombia() {
    colombia.remove(marcas);
    marcas.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.propia) { o.geometry.dispose(); if (o.userData.matPropio) (o.material as THREE.Material).dispose(); }
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const t of pulsos) t.dispose();
    marcas = new THREE.Group(); colombia.add(marcas);
    tocablesColombia.length = 0; venas = []; pulsos = []; halos = []; etiquetasCiudad = []; marcadoresVena.clear();
    quitarEtiquetas("colombia");
    ibague = ciudades.find((c) => c.oficina) ?? null;
    const lista = ciudades.map((c) => { const p = proyectar(c.lon, c.lat); return { x: p.x, z: p.y, y: ESPESOR + 0.04, semilla: semillaDe(c.clave), tam: tamDe(c), oficina: c.oficina }; });
    const inst = ciudadesPequenas(lista);
    if (liviano) inst.grupo.traverse((o) => { o.castShadow = false; });
    marcas.add(inst.grupo);
    altos = inst.altos; radios = inst.radios;
    const pIb = ibague ? proyectar(ibague.lon, ibague.lat) : null;
    ciudades.forEach((c, i) => {
      const { x, z, y } = lista[i];
      const toque = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.16, radios[i] * 1.25), 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      toque.position.set(x, y + 0.08, z); toque.userData.ciudad = c.clave; toque.userData.propia = true;
      marcas.add(toque); tocablesColombia.push(toque);
      // El halo de color (lo pinta la capa).
      const halo = new THREE.Mesh(gHalo, matHalo(HEX_LUZ.transito));
      halo.position.set(x, y + 0.004, z); halo.visible = false; halo.renderOrder = 1;
      marcas.add(halo); halos.push(halo);
      const el = etiqueta("", new THREE.Vector3(x, y + altos[i] + 0.04, z), "colombia", "ciudad", 0);
      el.dataset.clave = c.clave;
      const et = etiquetas.find((e) => e.el === el)!;
      etiquetasCiudad.push({ c, el, et });
      // El recuadro del nombre elige la ciudad (otro toque la suelta); los puntos y las burbujas los atiende la pantalla.
      el.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-nombre]")) tocarNombre(c.clave); });
      el.addEventListener("pointermove", (e) => { const r = lienzo.getBoundingClientRect(); marcarCerca(e.clientX - r.left, e.clientY - r.top); ev.ciudad(c, e.clientX - r.left, e.clientY - r.top); });
      el.addEventListener("pointerleave", () => ev.ciudad(null, 0, 0));
      el.addEventListener("wheel", (e) => { e.preventDefault(); lienzo.dispatchEvent(new WheelEvent("wheel", e)); }, { passive: false });
      // La vena hasta Ibagué: quieta y gris; con sobres en camino, un pulso que fluye hacia la ciudad y su marcador.
      if (pIb && !c.oficina) {
        const a = new THREE.Vector3(pIb.x, y + 0.02, pIb.y), b = new THREE.Vector3(x, y + 0.02, z);
        const d = a.distanceTo(b);
        const medio = a.clone().lerp(b, 0.5).add(new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(d * 0.16));
        medio.y += 0.04 + d * 0.04;
        const curva = new THREE.QuadraticBezierCurve3(a, medio, b);
        const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 28, 0.008, 4), matVena);
        tubo.userData.propia = true; tubo.renderOrder = 2;
        marcas.add(tubo);
        venas.push({ tubo, aliado: c.aliados.length > 0 });
        // Activa (con pulso hacia la ciudad): si tiene trámites abiertos o un envío activo (de hoy, hasta las 6:30 de mañana).
        const activos = c.sobres.filter((s) => s.activo).length;
        if (c.carpetas.length || activos) {
          const base = new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.012, 6), matVenaActiva);
          base.userData.propia = true; base.renderOrder = 2;
          marcas.add(base);
          const tex = new THREE.CanvasTexture(lienzoPulso);
          tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(Math.max(1, d / 0.9), 1); tex.offset.x = (semillaDe(c.clave) % 100) / 100;
          pulsos.push(tex);
          const pulso = new THREE.Mesh(new THREE.TubeGeometry(curva, 64, 0.022, 8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
          pulso.userData.propia = true; pulso.userData.matPropio = true; pulso.renderOrder = 3;
          marcas.add(pulso);
        }
        // El envío: un botoncito en la mitad de la vena (azul si está activo; gris si ya es constancia).
        if (c.sobres.length) {
          const n = activos || c.sobres.length;
          const que = activos ? `${activos} envío${activos === 1 ? "" : "s"} de hoy a ${c.nombre}` : `${c.sobres.length} envío${c.sobres.length === 1 ? "" : "s"} anteriores a ${c.nombre}`;
          const em = etiqueta(`<button type="button" class="env${activos ? "" : " gris"}" data-env="1" aria-label="${esc(que)}" title="${esc(que)}"><span class="ic">${SOBRE}</span>${n > 1 ? `<small>${n}</small>` : ""}</button>`, curva.getPoint(0.5), "colombia", "vena", activos ? 5e8 : 1);
          em.dataset.clave = c.clave;
          marcadoresVena.set(c.clave, etiquetas.find((e) => e.el === em)!);
        }
      }
    });
    pintarCapa();
    enmarcarCiudad(seleccionada);
    render.shadowMap.needsUpdate = true;
  }

  /** Las burbujas de la ciudad elegida: entrar, todos sus trámites y sus tramitadores (si tiene). */
  function accionesDe(c: CiudadMapa, abiertos: number) {
    const l: { k: keyof typeof ICONO_ACC; t: string; color: string }[] = [{ k: "entrar", t: `Entrar a ${c.nombre}`, color: "#2f5bea" }];
    if (abiertos) l.push({ k: "todos", t: "Todos los trámites", color: "#64748b" });
    if (c.tramitadores.length || c.sobres.length) l.push({ k: "tramitadores", t: c.tramitadores.length > 1 ? "Tramitadores" : "Tramitador", color: "#2f9e63" });
    return l.map((a, i) => `<div class="ab" style="--c:${a.color};--g:${a.color}38;--i:${i}"><button type="button" data-acc="${a.k}" aria-label="${esc(a.t)}">${svg(ICONO_ACC[a.k])}</button><span>${esc(a.t)}</span></div>`).join("");
  }
  const puntosHtml = (cuenta: Partial<Record<Luz, number>>) => LUCES_MAPA.filter((k) => cuenta[k])
    .map((k) => `<button type="button" class="pt" data-col="${k}" style="--c:${HEX_LUZ[k]}" title="${cuenta[k]} ${PLURAL_LUZ[k]}"><i class="dot ${k}"></i>${cuenta[k]}</button>`).join("");
  /** Pocos trámites: cada uno con su placa (como placa) y el punto de su estado; tocarlo abre su carpeta. */
  const placasHtml = (l: Carpeta[]) => [...l].sort((a, b) => LUCES_MAPA.indexOf(a.luz) - LUCES_MAPA.indexOf(b.luz)).map((x) => {
    const k = x.luz;
    return `<button type="button" class="pt pt-placa" data-carpeta="${esc(x.id)}" style="--c:${HEX_LUZ[k]}" title="${esc(`${x.codigo} · ${x.tipo}${x.titular ? ` · ${x.titular}` : ""}\n${NOMBRE_LUZ[k]}${x.motivo && abierta(x) ? ` · ${x.motivo}` : ""}`)}"><span class="placa${x.placa ? "" : " sin"}"><b>${esc(x.placa ? placaBonita(x.placa) : x.codigo)}</b></span>${x.nota?.descripcion ? notaHtml(x.id) : ""}<i class="dot ${k}"></i></button>`;
  }).join("");

  /**
   * Escribe la etiqueta de cada ciudad según la capa (nombre en su recuadro, los puntos de cada estado con su cantidad,
   * y en la elegida sus burbujas) y pinta su halo: abiertos (rojo si hay en corrección, si no azul; del tamaño de
   * cuántos), atrasados (rojo),
   * por cobrar (ámbar) o aliados (verde, y las venas de las ciudades con aliado también).
   */
  function pintarCapa() {
    const maxCobrar = Math.max(1, ...ciudades.map((c) => c.stats.porCobrar));
    etiquetasCiudad.forEach(({ c, el, et }, i) => {
      const deCiudad = c.carpetas.filter((x) => x.categoria !== "licencia");
      const vencidos = deCiudad.filter((x) => abierta(x) && x.tono === "rojo");
      const abiertos = deCiudad.filter(abierta).length, rojos = vencidos.length;
      // Abiertos: todos sus estados (lo activo); atrasados: los vencidos, por estado.
      const deCapa = capaActual === "abiertos" ? deCiudad : capaActual === "atrasados" ? vencidos : [];
      const pts = !deCapa.length ? "" : deCapa.length <= PLACAS_HASTA ? placasHtml(deCapa) : puntosHtml(contar(deCapa));
      const extra = capaActual === "cobrar" && c.stats.porCobrar ? `<small>${plataCorta(c.stats.porCobrar)}</small>`
        : capaActual === "aliados" && c.aliados.length ? `<small>${c.aliados.length === 1 ? esc(c.aliados[0]) : `${c.aliados.length} aliados`}</small>`
        : !pts && c.stats.finalizados ? `<small>${c.stats.finalizados} hechos</small>` : "";
      const tiene = !!pts || (capaActual === "cobrar" && c.stats.porCobrar > 0) || (capaActual === "aliados" && c.aliados.length > 0);
      const sel = c.clave === seleccionada;
      el.innerHTML = `${sel ? `<div class="et-acc">${accionesDe(c, deCiudad.length)}</div>` : ""}<button type="button" class="et-card" data-nombre="1" aria-pressed="${sel}" title="${esc(`${c.nombre}, ${c.departamento}`)}"><b>${esc(c.nombre)}</b>${extra}</button>${pts ? `<div class="pts">${pts}</div>` : ""}<i class="et-tallo"></i>`;
      el.className = `mapa-etq ciudad${c.oficina ? " oficina" : ""}${tiene ? "" : " cero"}${sel ? " sel" : ""}`;
      el.style.setProperty("--flota", `${(i % 9) * -0.41}s`);
      et.w = undefined;
      et.prioridad = sel ? 2e9 : c.oficina ? 1e9 : tiene ? 1e6 + rojos * 40 + abiertos * 10 + Math.log10(c.poblacion ?? 10) : Math.log10(c.poblacion ?? 10);
      et.reservaArriba = sel ? 80 : 0;
      et.anchoMin = sel ? 190 : 0;
      // Sin nada que mostrar en esta capa: solo el nombre, y solo de cerca.
      et.cuando = tiene || c.oficina || sel ? undefined : () => distancia < 9;
      let color: string | null = null, tam = 0;
      if (capaActual === "abiertos" && abiertos) { color = HEX_LUZ[deCiudad.some((x) => x.luz === "correccion") ? "correccion" : "transito"]; tam = 0.35 + Math.sqrt(abiertos) * 0.16; }
      else if (capaActual === "atrasados" && rojos) { color = HEX_LUZ.correccion; tam = 0.35 + Math.sqrt(rojos) * 0.2; }
      else if (capaActual === "cobrar" && c.stats.porCobrar) { color = "#d97706"; tam = 0.35 + Math.sqrt(c.stats.porCobrar / maxCobrar) * 1.1; }
      else if (capaActual === "aliados" && c.aliados.length) { color = "#2f9e63"; tam = 0.45; }
      const h = halos[i];
      if (h) { h.visible = !!color; if (color) { h.material = matHalo(color); h.scale.setScalar(tam * 1.5); } }
    });
    for (const v of venas) v.tubo.material = capaActual === "aliados" && v.aliado ? matVenaAliado : matVena;
    etiquetas.sort((a, b) => b.prioridad - a.prioridad);
    marcarActivo();
    pedir();
  }
  function enmarcarCiudad(clave: string | null) {
    const i = ciudades.findIndex((c) => c.clave === clave);
    aro.visible = i >= 0;
    if (i < 0) return;
    const p = proyectar(ciudades[i].lon, ciudades[i].lat);
    aro.position.set(p.x, ESPESOR + 0.05, p.y);
    aro.scale.setScalar(radios[i] + 0.04);
  }

  // ─── Lo desplegado (listas, la carpeta elegida) ───
  const desp = document.createElement("div");
  desp.className = "mapa-despliegue";
  desp.hidden = true;
  capa.appendChild(desp);
  let despliegueActual: Despliegue | null = null;
  let despHtml = "", llaveDesp = "";
  const etiquetaDeAncla = (a: Ancla): Etiqueta | undefined =>
    a.tipo === "ciudad" ? etiquetasCiudad.find((x) => x.c.clave === a.clave)?.et : a.tipo === "vena" ? marcadoresVena.get(a.clave) : undefined;
  /** El botón de la etiqueta que abrió lo desplegado queda encendido; la etiqueta ancla siempre se ve. */
  function marcarActivo() {
    capa.querySelectorAll(".mapa-etq .act").forEach((x) => x.classList.remove("act"));
    for (const e of etiquetas) e.fijo = false;
    const d = despliegueActual;
    if (!d) return;
    const et = etiquetaDeAncla(d.ancla);
    if (et) et.fijo = true;
    if (et && d.activo) et.el.querySelector(`[data-${d.activo.attr}="${d.activo.valor}"]`)?.closest(d.activo.attr === "acc" ? ".ab" : d.activo.attr === "col" ? ".pt" : ".env")?.classList.add("act");
  }
  /** Pone lo desplegado junto a su ancla y devuelve el espacio que ocupa (para que nada se monte encima). */
  function ubicarDespliegue(d: Despliegue, W: number, H: number): Rect | null {
    let x: number, y: number, anchoAncla = 0;
    if (d.ancla.tipo === "carpeta" || d.ancla.tipo === "lugar") {
      // Encima del edificio: la carpeta, centrada; la lista de un lugar, al lado.
      const p = d.ancla.tipo === "carpeta" ? posCarpeta.get(d.ancla.id) : posLugar.get(d.ancla.clave);
      if (!p || escena !== ciudad) { desp.style.display = "none"; return null; }
      v3.copy(p).project(camara);
      x = ((v3.x + 1) / 2) * W; y = ((1 - v3.y) / 2) * H;
      if (d.ancla.tipo === "lugar") anchoAncla = 110;
    } else {
      const et = etiquetaDeAncla(d.ancla);
      if (!et || et.sx === undefined || et.sy === undefined) { desp.style.display = "none"; return null; }
      x = et.sx; y = et.sy - (et.h ?? 22) / 2; anchoAncla = Math.max(et.w ?? 80, et.anchoMin ?? 0);
    }
    desp.style.display = "";
    const dw = desp.offsetWidth, dh = desp.offsetHeight;
    if (d.modo === "carpeta") {
      desp.style.transform = `translate(${x - dw / 2}px, ${y - dh / 2}px)`;
      return [x - dw / 2, y - dh / 2, x + dw / 2, y + dh / 2];
    }
    const izq = x + anchoAncla / 2 + 16 + dw > W - 12 && x - anchoAncla / 2 - 16 - dw > 12;
    const left = izq ? x - anchoAncla / 2 - 16 - dw : Math.min(x + anchoAncla / 2 + 16, W - dw - 8);
    const top = Math.max(8, Math.min(H - dh - 8, y - dh / 2));
    desp.classList.toggle("izq", izq);
    desp.style.transform = `translate(${left}px, ${top}px)`;
    return [left, top, left + dw, top + dh];
  }
  /** "Vida" al acercarse: la etiqueta de ciudad más cercana al puntero (a menos de 95 px) crece y sus puntos brillan. */
  let cerca: HTMLElement | null = null;
  function marcarCerca(px: number, py: number) {
    let mejor: Etiqueta | null = null, dmin = 95;
    for (const { et } of etiquetasCiudad) {
      if (et.sx === undefined || et.sy === undefined || et.el.style.display === "none") continue;
      const d = Math.hypot(px - et.sx, py - (et.sy - (et.h ?? 22) / 2));
      if (d < dmin) { dmin = d; mejor = et; }
    }
    const el = mejor?.el ?? null;
    if (el !== cerca) { cerca?.classList.remove("cerca"); el?.classList.add("cerca"); cerca = el; }
  }

  // ─── La ciudad ───
  let ciudad = new THREE.Scene();
  let lugares: Lugar[] = [];
  let tocablesCiudad: THREE.Object3D[] = [];
  /** Dónde se ancla lo desplegado de cada carpeta (la elegida) y de cada lugar: encima de su edificio. */
  const posCarpeta = new Map<string, THREE.Vector3>();
  const posLugar = new Map<string, THREE.Vector3>();
  /** El lugar de cada carpeta (el primero que la tiene: su zona, no la academia), para resaltar su edificio. */
  const lugarDeCarpeta = new Map<string, string>();
  const tmp = new THREE.Object3D();

  /** Un lugar (sus trámites, en el HUD) en su edificio; si es `tocable`, el edificio se toca. */
  function lugar(def: LugarCiudad | undefined, caja: THREE.Box3, tocable = true) {
    if (!def) return;
    lugares.push({ ...def, caja, tocable });
    const arriba = caja.getCenter(new THREE.Vector3()).setY(caja.max.y + 0.85);
    posLugar.set(def.clave, arriba);
    for (const x of def.carpetas) if (!posCarpeta.has(x.id)) { posCarpeta.set(x.id, arriba.clone()); lugarDeCarpeta.set(x.id, def.clave); }
    if (tocable) {
      const toque = new THREE.Mesh(new THREE.BoxGeometry(...caja.getSize(new THREE.Vector3()).toArray()), new THREE.MeshBasicMaterial({ visible: false }));
      caja.getCenter(toque.position);
      toque.userData.lugar = def.clave; toque.userData.propia = true;
      ciudad.add(toque); tocablesCiudad.push(toque);
    }
  }

  // ─── El sitio resaltado (como en un videojuego): un marco dorado que late en el piso alrededor del edificio, una onda
  // que sale de él, su contorno y un rombo que gira y flota encima. Dorado siempre (el color del lugar se perdería en un
  // techo del mismo color). Sale al pasar por un lugar en el HUD (o por el edificio) y queda en lo desplegado (su lista
  // o la carpeta abierta). Se mueve solo con "Movimiento" y sin modo liviano; si no, queda quieto.
  const DORADO = "#fbbf24";
  const resalte = new THREE.Group();
  const aditivo = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
  const matMarco = new THREE.MeshBasicMaterial({ color: DORADO, transparent: true, opacity: 0.95, depthWrite: false });
  const matOndas = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: DORADO, transparent: true, opacity: 0, depthWrite: false }));
  const matBrillo = new THREE.MeshBasicMaterial({ map: texHalo, color: DORADO, transparent: true, opacity: 0.45, depthWrite: false });
  const matContorno = new THREE.LineBasicMaterial({ color: "#fde68a", transparent: true, opacity: 0.95 });
  const matAura = new THREE.MeshBasicMaterial({ color: DORADO, opacity: 0.12, ...aditivo });
  /** El haz de luz del techo al rombo: un degradado que se apaga hacia arriba. */
  const texHaz = (() => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 128;
    const g = c.getContext("2d")!; const gr = g.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.6, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(c);
  })();
  const matHaz = new THREE.MeshBasicMaterial({ map: texHaz, color: DORADO, opacity: 0.55, side: THREE.DoubleSide, ...aditivo });
  const matRombo = new THREE.MeshStandardMaterial({ color: DORADO, emissive: "#f59e0b", emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.15 });
  const matChispa = new THREE.SpriteMaterial({ map: texHalo, color: "#fde68a", opacity: 0.8, ...aditivo });
  const gRombo = new THREE.OctahedronGeometry(0.42, 0).scale(1, 1.6, 1);
  let piezas: { marco: THREE.Mesh; ondas: THREE.Mesh[]; brillo: THREE.Mesh; rombo: THREE.Mesh; chispa: THREE.Sprite; haz: THREE.Mesh; alto: number; t0: number } | null = null;
  let resaltado = "";
  /** Lo que tiene el mouse encima (en el HUD o en el 3D) y lo elegido. */
  let sobreClave: string | null = null;
  const rectRedondo = (w: number, d: number, r: number) => {
    const f = new THREE.Shape(), x = -w / 2, y = -d / 2;
    f.moveTo(x + r, y); f.lineTo(x + w - r, y); f.quadraticCurveTo(x + w, y, x + w, y + r); f.lineTo(x + w, y + d - r); f.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    f.lineTo(x + r, y + d); f.quadraticCurveTo(x, y + d, x, y + d - r); f.lineTo(x, y + r); f.quadraticCurveTo(x, y, x + r, y);
    return f;
  };
  function limpiarResalte() {
    for (const o of [...resalte.children]) {
      resalte.remove(o);
      // Las geometrías compartidas (el rombo, el halo, la del sprite) no se tocan.
      if (o instanceof THREE.Sprite) continue;
      const g = (o as THREE.Mesh).geometry;
      if (g && g !== gRombo && g !== gHalo) g.dispose();
    }
    piezas = null;
  }
  /**
   * El lugar que va resaltado: el que tiene el mouse encima o, si no, el desplegado (su lista o la carpeta abierta): al
   * cerrar lo desplegado (Esc, otro toque) se apaga.
   */
  function claveResaltada(): string | null {
    if (escena !== ciudad) return null;
    const d = despliegueActual;
    return sobreClave ?? (d?.ancla.tipo === "carpeta" ? lugarDeCarpeta.get(d.ancla.id) ?? null : d?.ancla.tipo === "lugar" ? d.ancla.clave : null);
  }
  /**
   * Resalta el edificio como en un videojuego: un aura dorada que lo envuelve y late, su contorno brillante, un marco en
   * el piso con dos ondas que salen de él, un haz de luz desde el techo y un rombo que cae rebotando, gira y flota con
   * su destello. Al aparecer, el marco se cierra sobre el edificio.
   */
  function resaltarSitio(forzar = false) {
    const clave = claveResaltada();
    const l = clave ? lugares.find((x) => x.clave === clave) : undefined;
    // Los lugares de un mismo edificio (los de la oficina) resaltan el mismo edificio: no se rearma.
    const llave = l ? l.edificio ?? l.clave : "";
    if (llave === resaltado && !forzar) return;
    resaltado = llave;
    limpiarResalte();
    if (!l) { pedir(); return; }
    const s = l.caja.getSize(new THREE.Vector3()), c = l.caja.getCenter(new THREE.Vector3());
    const w = s.x + 0.8, d = s.z + 0.8, g = 0.26;
    const forma = rectRedondo(w, d, 0.5);
    forma.holes.push(rectRedondo(w - g * 2, d - g * 2, 0.34));
    const gMarco = new THREE.ShapeGeometry(forma, 5).rotateX(-Math.PI / 2);
    const marco = new THREE.Mesh(gMarco, matMarco);
    marco.position.set(c.x, 0.12, c.z); marco.renderOrder = 5;
    const ondas = matOndas.map((m) => { const o = new THREE.Mesh(gMarco.clone(), m); o.position.set(c.x, 0.115, c.z); o.renderOrder = 5; o.visible = moviendo && !liviano; return o; });
    const brillo = new THREE.Mesh(gHalo, matBrillo);
    brillo.scale.set(w * 1.7, 1, d * 1.7); brillo.position.set(c.x, 0.1, c.z); brillo.renderOrder = 4;
    const contorno = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x + 0.1, s.y + 0.06, s.z + 0.1)), matContorno);
    contorno.position.copy(c);
    const aura = new THREE.Mesh(new THREE.BoxGeometry(s.x + 0.16, s.y + 0.1, s.z + 0.16), matAura);
    aura.position.copy(c); aura.renderOrder = 6;
    const alto = l.caja.max.y + 1.3;
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.32, alto - l.caja.max.y, 20, 1, true), matHaz);
    haz.position.set(c.x, (alto + l.caja.max.y) / 2, c.z); haz.renderOrder = 6;
    const rombo = new THREE.Mesh(gRombo, matRombo);
    rombo.position.set(c.x, alto, c.z);
    const chispa = new THREE.Sprite(matChispa);
    chispa.position.set(c.x, alto, c.z); chispa.scale.setScalar(1.3); chispa.renderOrder = 7;
    resalte.add(brillo, ...ondas, marco, contorno, aura, haz, rombo, chispa);
    if (resalte.parent !== ciudad) ciudad.add(resalte);
    piezas = { marco, ondas, brillo, rombo, chispa, haz, alto, t0: performance.now() };
    moverResalte(performance.now());
    pedir();
    arrancarResalte();
  }
  function moverResalte(t: number) {
    if (!piezas) return;
    const quieto = !moviendo || liviano;
    const e = quieto ? 1 : Math.min(1, (t - piezas.t0) / 450); // la entrada (de 0 a 1)
    const k = quieto ? 0.7 : (Math.sin(t * 0.0062) + 1) / 2;
    // El rombo cae desde arriba con un rebote, y luego flota y gira.
    const caida = e < 1 ? (1 - e) * 2.2 - Math.sin(e * Math.PI) * 0.25 : 0;
    piezas.rombo.position.y = piezas.alto + caida + (quieto ? 0 : Math.sin(t * 0.0034) * 0.14);
    piezas.rombo.rotation.y = quieto ? 0.6 : t * 0.0024;
    piezas.chispa.position.y = piezas.rombo.position.y;
    piezas.chispa.scale.setScalar((1.1 + k * 0.6) * Math.max(0.01, e));
    matChispa.opacity = 0.5 + k * 0.45;
    // El marco se cierra sobre el edificio al aparecer y luego late.
    piezas.marco.scale.setScalar((1 + (1 - e) * 0.35) * (1 + k * 0.04));
    matMarco.opacity = (0.7 + k * 0.3) * e;
    matBrillo.opacity = (0.3 + k * 0.35) * e;
    matAura.opacity = (0.07 + k * 0.13) * e;
    matContorno.opacity = 0.55 + k * 0.45;
    matHaz.opacity = (0.3 + k * 0.4) * e;
    piezas.haz.scale.set(1 + k * 0.25, Math.max(0.01, e), 1 + k * 0.25);
    // Dos ondas salen del marco y se desvanecen (una cada 0,6 s).
    piezas.ondas.forEach((o, i) => {
      const f = ((t / 1200) + i * 0.5) % 1;
      o.scale.set(1 + f * 0.45, 1, 1 + f * 0.6);
      matOndas[i].opacity = quieto ? 0 : (1 - f) * 0.7 * e;
    });
  }
  let relojResalte = 0, ultimoResalte = 0;
  function animarResalte(t: number) {
    if (!piezas || escena !== ciudad || !moviendo || liviano || document.hidden) { relojResalte = 0; return; }
    relojResalte = requestAnimationFrame(animarResalte);
    if (t - ultimoResalte < 33 || cambiando) return;
    ultimoResalte = t;
    moverResalte(t);
    dibujar();
  }
  function arrancarResalte() { if (!relojResalte && piezas && moviendo && !liviano) relojResalte = requestAnimationFrame(animarResalte); }
  function calle(e: THREE.Scene, largo: number, z: number) {
    e.add(new THREE.Mesh(cajaR(largo, 0.06, 2.4, 0.02), mat(PALETA.calle)).translateY(0.03).translateZ(z));
    const n = Math.floor(largo / 1.1);
    const rayas = new THREE.InstancedMesh(cajaR(0.5, 0.012, 0.08, 0.004), mat(PALETA.linea), n);
    for (let i = 0; i < n; i++) { tmp.position.set(-largo / 2 + 0.55 + i * 1.1, 0.066, z); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); rayas.setMatrixAt(i, tmp.matrix); }
    rayas.receiveShadow = !liviano;
    e.add(rayas);
    for (const dz of [-1.45, 1.45]) { const a = new THREE.Mesh(cajaR(largo, 0.1, 0.5, 0.03), mat(PALETA.acera)).translateY(0.05).translateZ(z + dz); a.receiveShadow = !liviano; e.add(a); }
  }
  function poner<T extends THREE.Object3D>(o: T, x: number, z: number, giro = 0, w = 0, d = 0): T {
    o.position.set(x, o.position.y, z); o.rotation.y = giro; sombras(o, w, d); ciudad.add(o); return o;
  }

  /**
   * La cuadra con vida: prados detrás de los edificios y al otro lado de la calle, arbustos, flores, postes de luz en las
   * aceras, bancas, una plazoleta con fuente y más árboles. En Ibagué (la oficina) también jardines a los lados y
   * entre la oficina y el tránsito. Pocas mallas (instanciadas): no pesa.
   */
  function decorar(oficina: boolean, CALLE: number, medio: number) {
    type I = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color?: string };
    const unidadCaja = new THREE.BoxGeometry(1, 1, 1), unidadEsfera = new THREE.SphereGeometry(1, 10, 8), unidadCil = new THREE.CylinderGeometry(1, 1, 1, 16);
    const col = new THREE.Color();
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, l: I[], sombra = true) => {
      if (!l.length) return;
      const im = new THREE.InstancedMesh(g, m, l.length);
      l.forEach((it, i) => { tmp.position.set(it.x, it.y, it.z); tmp.rotation.set(0, 0, 0); tmp.scale.set(it.sx, it.sy, it.sz); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix); if (it.color) im.setColorAt(i, col.set(it.color)); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = sombra && !liviano; im.receiveShadow = !liviano; im.userData.propia = true;
      ciudad.add(im);
    };
    const prado = (x0: number, x1: number, z0: number, z1: number): I => ({ x: (x0 + x1) / 2, y: 0.02, z: (z0 + z1) / 2, sx: x1 - x0, sy: 0.04, sz: z1 - z0 });
    const borde = medio - 0.3;
    const prados: I[] = [prado(-borde, borde, -5.9, -3.1), prado(-borde, borde, CALLE + 1.75, 6.75)];
    if (oficina) prados.push(prado(-borde, -8.6, -2.9, 1.45), prado(7.3, borde, -2.9, 1.45), prado(-0.75, 0.95, -2.6, 1.35));
    inst(unidadCaja, mat("#bfe3ad"), prados, false);
    // Arbustos en hilera al borde de los prados (y en los jardines de Ibagué).
    const arbustos: I[] = [];
    const verdes = ["#5fae6e", "#4f9e72", "#6cbf7b"];
    for (let x = -(medio - 0.8); x <= medio - 0.8; x += 0.85) arbustos.push({ x, y: 0.2, z: -3.25 + ((Math.round(x * 7) % 3) * 0.05), sx: 0.32, sy: 0.24, sz: 0.32, color: verdes[Math.abs(Math.round(x * 3)) % 3] });
    // En Ibagué, los jardines van en las orillas (al lado de las academias) y entre la oficina y el tránsito.
    if (oficina) for (const [x, z] of [[-(medio - 0.6), -1.4], [-(medio - 0.6), -0.4], [-(medio - 0.6), 0.6], [medio - 0.6, -1.4], [medio - 0.6, -0.4], [medio - 0.6, 0.6], [-0.2, -2.2], [0.4, -1.2], [-0.2, 0.0], [0.4, 1.0]]) arbustos.push({ x, y: 0.2, z, sx: 0.34, sy: 0.26, sz: 0.34, color: verdes[(x * 10 + z * 10) % 3 === 0 ? 0 : 1] });
    inst(unidadEsfera, mat("#ffffff"), arbustos);
    // Flores (en los jardines y junto a la fuente).
    const flores: I[] = [];
    const tonos = ["#f472b6", "#facc15", "#fb7185", "#f8fafc", "#a78bfa"];
    const macizo = (cx: number, cz: number, n: number) => { for (let i = 0; i < n; i++) { const a = i * 2.4, d = 0.12 + (i % 4) * 0.09; flores.push({ x: cx + Math.cos(a) * d, y: 0.09, z: cz + Math.sin(a) * d, sx: 0.07, sy: 0.07, sz: 0.07, color: tonos[i % tonos.length] }); } };
    for (const [x, z] of [[-6.5, -4.0], [-1.5, -4.2], [3.5, -4.0], [6.8, -5.2], [10.2, -4.0]]) macizo(x, z, 9);
    if (oficina) for (const [x, z] of [[0.25, -0.6], [-(medio - 0.6), 1.3], [medio - 0.6, 1.3]]) macizo(x, z, 9);
    inst(unidadEsfera, mat("#ffffff"), flores, false);
    // Postes de luz en las dos aceras.
    const postes: I[] = [], focos: I[] = [];
    for (const x of [-10.8, -7.2, -1.9, 7.8, 10.8]) { postes.push({ x, y: 0.75, z: 1.95, sx: 0.04, sy: 1.5, sz: 0.04 }); focos.push({ x, y: 1.53, z: 1.95, sx: 0.11, sy: 0.08, sz: 0.11 }); }
    for (const x of [-9.0, -3.0, 3.0, 9.0]) { postes.push({ x, y: 0.75, z: CALLE + 1.45, sx: 0.04, sy: 1.5, sz: 0.04 }); focos.push({ x, y: 1.53, z: CALLE + 1.45, sx: 0.11, sy: 0.08, sz: 0.11 }); }
    inst(unidadCil, mat("#475569"), postes);
    inst(unidadEsfera, new THREE.MeshStandardMaterial({ color: "#fff7cc", emissive: "#ffe9a8", emissiveIntensity: 0.6 }), focos, false);
    // Bancas en el prado de atrás, mirando a la cuadra.
    const bancas: I[] = [], patas: I[] = [];
    for (const [x, z] of [[-8.2, -4.4], [-4.2, -4.6], [1.0, -4.4], [5.2, -4.6]]) {
      bancas.push({ x, y: 0.28, z, sx: 0.9, sy: 0.06, sz: 0.3 }, { x, y: 0.45, z: z - 0.13, sx: 0.9, sy: 0.24, sz: 0.05 });
      patas.push({ x: x - 0.38, y: 0.13, z, sx: 0.06, sy: 0.26, sz: 0.26 }, { x: x + 0.38, y: 0.13, z, sx: 0.06, sy: 0.26, sz: 0.26 });
    }
    inst(unidadCaja, mat("#a16207"), bancas);
    inst(unidadCaja, mat("#334155"), patas);
    // La plazoleta con su fuente (atrás, a la derecha).
    const fx = 8.6, fz = -4.5;
    inst(unidadCil, mat("#e7e5e4"), [{ x: fx, y: 0.045, z: fz, sx: 1.35, sy: 0.05, sz: 1.35 }], false);
    inst(unidadCil, mat("#cbd5e1"), [{ x: fx, y: 0.17, z: fz, sx: 0.62, sy: 0.24, sz: 0.62 }, { x: fx, y: 0.42, z: fz, sx: 0.12, sy: 0.5, sz: 0.12 }]);
    inst(unidadCil, new THREE.MeshStandardMaterial({ color: "#7cc4f5", roughness: 0.2, metalness: 0.1 }), [{ x: fx, y: 0.3, z: fz, sx: 0.55, sy: 0.02, sz: 0.55 }], false);
    // Más árboles en el prado de atrás.
    for (const [x, z] of [[-11.0, -5.2], [-6.0, -5.5], [-2.6, -5.3], [2.6, -5.4], [5.9, -5.6], [11.0, -5.3]]) poner(arbol(x, z, 0.85 + ((x * 13) % 3) * 0.08), x, z, 0, 0.5, 0.5);
  }

  function armarCiudad(c: CiudadMapa) {
    // Limpia la anterior (los letreros tienen su textura; lo demás es compartido).
    ciudad.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.userData.letrero) { (o.material as THREE.MeshBasicMaterial).map?.dispose(); (o.material as THREE.Material).dispose(); o.geometry.dispose(); }
      else if (o.userData.propia) o.geometry.dispose();
    });
    quitarEtiquetas("ciudad");
    posCarpeta.clear(); posLugar.clear(); lugarDeCarpeta.clear();
    limpiarResalte(); resaltado = "";
    ciudad = new THREE.Scene();
    lugares = []; tocablesCiudad = [];
    const defs = new Map(lugaresDe(c).map((l) => [l.clave, l]));
    luces(ciudad, 11);
    // Ibagué es más ancha: a los lados de la oficina y del tránsito van las dos academias.
    const ANCHO = c.oficina ? 27 : 24;
    const base = new THREE.Mesh(cajaR(ANCHO, 0.3, 13, 0.1), mat(PALETA.piso));
    base.position.set(0, -0.15, 0.4); base.receiveShadow = !liviano;
    ciudad.add(base);
    // La calle al frente (sur); los edificios detrás, uno al lado del otro, cerrados, con la fachada hacia la calle.
    const CALLE = 3.3;
    calle(ciudad, ANCHO, CALLE);
    const conLetrero = (texto: string, ancho: number, alto: number, x: number, y: number, z: number, fondo?: string) => {
      const l = letrero(texto, ancho, alto, fondo); l.position.set(x, y, z); l.userData.letrero = true; ciudad.add(l); return l;
    };
    const contenido = new THREE.Box3();
    const ocupa = (x: number, z: number, ancho: number, fondo: number) => contenido.union(new THREE.Box3(new THREE.Vector3(x - ancho / 2, 0, z - fondo / 2), new THREE.Vector3(x + ancho / 2, 2.6, z + fondo / 2)));

    /** El letrero en la fachada, arriba de la puerta. */
    const enFachada = (texto: string, ancho: number, alto: number, x: number, z: number, altoEdificio: number, fondoEdificio: number, fondo?: string) =>
      conLetrero(texto, ancho, alto, x, 0.08 + altoEdificio * 0.8, z + fondoEdificio / 2 + 0.04, fondo);

    function armarTransito(x: number, z: number, nombre: string, clave: string) {
      const ancho = 6.0, fondo = 3.8, alto = 2.4;
      poner(edificio(ancho, fondo, alto, PALETA.pared, PALETA.azulOscuro), x, z, 0, ancho, fondo);
      ocupa(x, z, ancho, fondo);
      enFachada(nombre, 3.6, 0.5, x, z, alto, fondo, PALETA.azulOscuro);
      poner(bandera(), x + ancho / 2 + 0.55, z + fondo / 2 - 0.3);
      lugar(defs.get(clave), new THREE.Box3(new THREE.Vector3(x - ancho / 2, 0, z - fondo / 2), new THREE.Vector3(x + ancho / 2, alto + 0.2, z + fondo / 2)));
      poner(carro("#e8eefc"), x - 1.4, CALLE - 1.45 - 0.2, Math.PI / 2); poner(moto(PALETA.rojo), x + 0.4, CALLE - 1.6, Math.PI / 2 + 0.15); poner(moto("#111827"), x + 1.1, CALLE - 1.6, Math.PI / 2 - 0.1);
    }

    if (c.oficina) {
      // La oficina, cerrada: sus lugares (recibidos de vehículos y de personas, corrección, ya salió) son del mismo
      // edificio (se resalta entero); tocarla despliega todos sus trámites.
      const ox = -4.6, oz = -0.6, ancho = 7.4, fondo = 4.4, alto = 2.2;
      poner(edificio(ancho, fondo, alto), ox, oz, 0, ancho, fondo);
      ocupa(ox, oz, ancho, fondo);
      enFachada("Trámites Pira", 2.6, 0.5, ox, oz, alto, fondo);
      const cajaOficina = new THREE.Box3(new THREE.Vector3(ox - ancho / 2, 0, oz - fondo / 2), new THREE.Vector3(ox + ancho / 2, alto + 0.2, oz + fondo / 2));
      for (const [z] of DE_LA_OFICINA) lugar(defs.get(z), cajaOficina, false);
      lugar(defs.get("oficina"), cajaOficina);
      poner(camioneta(), ox + 1.2, CALLE - 0.55, Math.PI / 2);
      armarTransito(4.0, -0.4, "Tránsito de Ibagué", "transito");
      // Las academias de conducción: JYG a la izquierda de la oficina, Motorland a la derecha del tránsito. Por fuera, una
      // moto y conos de pista; al tocarlas, sus trámites y sus clientes.
      (c.academias ?? []).forEach((a, i) => {
        const x = i ? 9.6 : -10.6, z = -0.6, ancho = 3.2, fondo = 3.0, alto = 1.8;
        poner(edificio(ancho, fondo, alto, PALETA.pared, NARANJA), x, z, 0, ancho, fondo);
        ocupa(x, z, ancho, fondo);
        enFachada(a.nombre.replace(/^Academia /, ""), 2.4, 0.42, x, z, alto, fondo, NARANJA);
        poner(moto(i ? "#dc2626" : "#f59e0b"), x + 1.0, z + fondo / 2 + 0.75, Math.PI / 2 - 0.2);
        for (const dx of [-1.3, -0.85, -0.4]) poner(cono(), x + dx, z + fondo / 2 + 0.6, 0, 0.2, 0.2);
        lugar(defs.get(`academia-${a.clave}`), new THREE.Box3(new THREE.Vector3(x - ancho / 2, 0, z - fondo / 2), new THREE.Vector3(x + ancho / 2, alto + 0.2, z + fondo / 2 + 0.9)));
      });
      for (const [x, z] of [[-0.4, -2.9], [0.2, 1.4], [-12.9, -2.4], [12.6, -2.3], [12.9, 1.2]]) poner(arbol(x, z, 0.95), x, z, 0, 0.6, 0.6);
    } else {
      const tx = c.aliados.length ? -2.8 : 0;
      armarTransito(tx, -0.4, `Tránsito de ${c.nombre}`, "fuera");
      // La oficina del tramitador de esa ciudad (Envíos), si hay, cerrada; él de pie afuera, junto a la puerta.
      c.aliados.slice(0, 2).forEach((nombre, i) => {
        const x = 3.6 + i * 4.2, z = -0.6, ancho = 3.4, fondo = 3.0, alto = 1.7;
        poner(edificio(ancho, fondo, alto, PALETA.pared, PALETA.verdeOscuro), x, z, 0, ancho, fondo);
        ocupa(x, z, ancho, fondo);
        enFachada(nombre, 2.8, 0.42, x, z, alto, fondo, PALETA.verdeOscuro);
        // Al tocarlo (a él o su oficina): su contacto (WhatsApp) y los trámites de la ciudad.
        const persona = new THREE.Group();
        const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.62, 12), mat(i ? "#7c3aed" : "#0f766e"));
        cuerpo.position.y = 0.36; cuerpo.userData.propia = true;
        const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), mat("#e8b48a"));
        cabeza.position.y = 0.82; cabeza.userData.propia = true;
        persona.add(cuerpo, cabeza);
        poner(persona, x + 1.0, z + fondo / 2 + 0.45, 0, 0.4, 0.4);
        lugar(defs.get(`aliado-${i}`), new THREE.Box3(new THREE.Vector3(x - ancho / 2, 0, z - fondo / 2), new THREE.Vector3(x + ancho / 2, alto + 0.2, z + fondo / 2 + 0.8)));
      });
      for (const [x, z] of [[tx - 4.4, -2.4], [tx + 4.0, -2.6], [tx - 4.8, 1.3], [8.6, 1.4], [-8.8, -1.0]]) poner(arbol(x, z, 0.95), x, z, 0, 0.6, 0.6);
    }
    for (const x of [-9, -5, -1, 3, 7]) poner(arbol(x, CALLE + 2.0, 0.8), x, CALLE + 2.0, 0, 0.5, 0.5);
    decorar(!!c.oficina, CALLE, ANCHO / 2);
    // La cámara encuadra lo que hay (desde el frente, en diagonal y desde arriba, como una maqueta).
    // Se mira un poco más arriba de los edificios: las placas flotan encima y arriba están los botones de la pantalla.
    const centro = contenido.getCenter(new THREE.Vector3()); centro.y = 1.7; centro.z += 0.3;
    const radio = Math.max(5, contenido.getSize(new THREE.Vector3()).length() / 2);
    const dist = (radio / Math.sin(THREE.MathUtils.degToRad(camara.fov / 2))) * (c.oficina ? 1.55 : 1.35);
    // Se ve en diagonal desde la derecha: lo de la derecha queda más cerca y más grande. La cuadra va al centro, entre
    // los trámites (a la izquierda) y los lugares (a la derecha).
    centro.x -= radio * 0.04;
    vistaCiudad = { pos: centro.clone().add(new THREE.Vector3(0.42, 0.78, 0.95).normalize().multiplyScalar(dist)), mira: centro };
    limiteCiudad = { x: centro.x, z: centro.z, r: radio * 0.85 };
    limites("ciudad");
    render.shadowMap.needsUpdate = true;
  }

  // ─── Cámara y vuelos ───
  let nivel: Nivel = { tipo: "colombia" };
  let escena: THREE.Scene = colombia;
  /** La vista fija de Colombia (como en un juego de estrategia): siempre desde el sur, inclinada; se mueve y se acerca, no gira. */
  // Inclinada (unos 35° sobre el horizonte, como en un juego de estrategia), para ver el país más de cerca.
  const INCLINACION = 0.95;
  const DIRECCION = new THREE.Vector3(0, Math.cos(INCLINACION), Math.sin(INCLINACION));
  const vistaColombia = (hacia: THREE.Vector3, dist: number) => ({ pos: hacia.clone().add(DIRECCION.clone().multiplyScalar(dist)), mira: hacia.clone() });
  const VISTA_COLOMBIA = vistaColombia(new THREE.Vector3(-1.0, ESPESOR, 0.2), 12.5);
  let ultimaColombia = VISTA_COLOMBIA;
  let vistaCiudad = { pos: new THREE.Vector3(8.5, 9.6, 12.5), mira: new THREE.Vector3(-0.2, 0.4, -0.6) };
  /** Hasta dónde se puede mover la vista dentro de la cuadra (como el país en Colombia). */
  let limiteCiudad = { x: 0, z: 0, r: 8 };
  /** En las dos escenas la vista es la de una maqueta: fija en su ángulo, se arrastra para moverse y se acerca; no gira. */
  function limites(t: "colombia" | "ciudad") {
    controles.enableRotate = false;
    controles.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controles.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    controles.minDistance = t === "colombia" ? 2.2 : 5;
    // En Colombia no se aleja mucho más que la vista inicial (12,5, la de "Recentrar"): más allá solo hay mar y bordes.
    controles.maxDistance = t === "colombia" ? 15 : Math.max(24, vistaCiudad.pos.distanceTo(vistaCiudad.mira) * 1.5);
    controles.minPolarAngle = t === "colombia" ? 0.25 : 0.45;
    controles.maxPolarAngle = t === "colombia" ? 1.15 : 1.15;
  }
  let vuelo = 0;
  function volar(pos: THREE.Vector3, hacia: THREE.Vector3, ms: number): Promise<void> {
    cancelAnimationFrame(vuelo);
    const p0 = camara.position.clone(), m0 = controles.target.clone();
    const t0 = performance.now();
    controles.enabled = false;
    return new Promise((ok) => {
      const paso = (t: number) => {
        const u = Math.min(1, (t - t0) / ms), k = suave(u);
        camara.position.lerpVectors(p0, pos, k);
        controles.target.lerpVectors(m0, hacia, k);
        camara.lookAt(controles.target);
        dibujar();
        if (u < 1) vuelo = requestAnimationFrame(paso);
        else { controles.enabled = true; controles.update(); ok(); }
      };
      vuelo = requestAnimationFrame(paso);
    });
  }
  const fundido = document.createElement("div");
  fundido.className = "mapa-fundido";
  capa.appendChild(fundido);
  const fundir = (si: boolean) => fundido.classList.toggle("on", si);
  const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let cambiando = false;
  /** Si se pide ir a otro lado mientras la cámara vuela, se hace apenas termine. */
  let siguiente: Nivel | null = null;
  async function ir(n: Nivel) {
    if (cambiando) { siguiente = n; return; }
    cambiando = true;
    try {
      if (n.tipo === "ciudad") {
        const c = buscar(n.clave);
        if (!c) return;
        if (nivel.tipo === "colombia") {
          const p = proyectar(c.lon, c.lat);
          ultimaColombia = { pos: camara.position.clone(), mira: controles.target.clone() };
          const v = vistaColombia(new THREE.Vector3(p.x, ESPESOR, p.y), 1.6);
          await volar(v.pos, v.mira, 420);
          fundir(true);
          await pausa(60);
        }
        armarCiudad(c);
        escena = ciudad; nivel = n; limites("ciudad");
        sobreClave = null; ev.lugar(null);
        camara.position.set(0, 26, 22); controles.target.set(0, 0, 0);
        fundir(false);
        ev.nivel(n);
        await volar(vistaCiudad.pos, vistaCiudad.mira, 450);
      } else {
        const desde = nivel.tipo === "ciudad" ? buscar(nivel.clave) : null;
        if (nivel.tipo === "ciudad") {
          await volar(camara.position.clone().multiplyScalar(1.8), controles.target.clone(), 220);
          fundir(true);
          await pausa(60);
        }
        escena = colombia; nivel = n; limites("colombia");
        sobreClave = null; resaltarSitio(); ev.lugar(null);
        if (desde) { const p = proyectar(desde.lon, desde.lat); const v = vistaColombia(new THREE.Vector3(p.x, ESPESOR, p.y), 1.6); camara.position.copy(v.pos); controles.target.copy(v.mira); }
        fundir(false);
        ev.nivel(n);
        await volar(ultimaColombia.pos, ultimaColombia.mira, 450);
        avisarCamara();
        arrancar();
      }
    } finally {
      cambiando = false;
      if (siguiente) { const s2 = siguiente; siguiente = null; void ir(s2); }
    }
  }
  camara.position.copy(VISTA_COLOMBIA.pos); controles.target.copy(VISTA_COLOMBIA.mira); limites("colombia"); controles.update();

  // ─── Dibujar solo cuando hace falta ───
  function pedir() { if (!pendiente) pendiente = requestAnimationFrame(() => { pendiente = 0; dibujar(); }); }
  const v3 = new THREE.Vector3();
  function dibujar() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    if (!w || !h) return;
    const pr = render.getPixelRatio();
    if (lienzo.width !== Math.floor(w * pr) || lienzo.height !== Math.floor(h * pr)) render.setSize(w, h, false);
    // La vista estirada a lo ancho (ESTIRAR): se mira por separado del tamaño del lienzo, porque al volver a crear la
    // escena (modo liviano) el lienzo ya tiene su tamaño y la proporción no se ponía.
    const aspecto = w / h / ESTIRAR;
    if (camara.aspect !== aspecto) { camara.aspect = aspecto; camara.updateProjectionMatrix(); }
    render.render(escena, camara);
    if (escena === colombia) { distancia = camara.position.distanceTo(controles.target); capa.classList.toggle("cerca", distancia < 11); }
    // Las etiquetas siguen a su punto. Primero dónde cae cada una (su tamaño se mide solo cuando cambió).
    const actual = escena === colombia ? "colombia" : "ciudad";
    const visibles: Etiqueta[] = [];
    for (const e of etiquetas) {
      if (e.escena !== actual || (e.cuando && !e.cuando())) { e.el.style.display = "none"; e.sx = undefined; continue; }
      v3.copy(e.pos).project(camara);
      if (v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) { e.el.style.display = "none"; e.sx = undefined; continue; }
      e.sx = ((v3.x + 1) / 2) * w; e.sy = ((1 - v3.y) / 2) * h;
      // Se mide sin el palito alargado (el de una etiqueta que subió para no tapar otra).
      if (e.w === undefined) { e.el.style.display = ""; e.el.style.setProperty("--subida", "0px"); e.w = e.el.offsetWidth || 80; e.h = e.el.offsetHeight || 22; }
      visibles.push(e);
    }
    // Lo desplegado aparta su espacio primero; luego, por prioridad, la que choca se esconde (la elegida y la que tiene
    // algo desplegado siempre se ven, y van primero).
    const ocupadas: Rect[] = [];
    if (despliegueActual) { const r = ubicarDespliegue(despliegueActual, w, h); if (r) ocupadas.push(r); }
    visibles.sort((a, b) => Number(!!b.fijo || b.prioridad >= 2e9) - Number(!!a.fijo || a.prioridad >= 2e9));
    // Dentro de la ciudad (pocas etiquetas, todas importantes), la que choca sube y su palito se alarga hasta su lugar.
    for (const e of visibles) {
      const an = Math.max(e.anchoMin ?? 0, e.altoChoque ? 120 : e.w!), al = e.altoChoque ?? e.h!;
      const siempre = e.fijo || e.prioridad >= 2e9;
      const rect = (y: number): Rect => [e.sx! - an / 2 - 7, y - al - (e.reservaArriba ?? 0) - 7, e.sx! + an / 2 + 7, y + 7];
      let y = e.sy!, puesta = false;
      for (let intento = 0; intento < 4; intento++) {
        const choques = siempre ? [] : ocupadas.filter(choca(rect(y)));
        if (!choques.length) {
          ocupadas.push(rect(y));
          // La etiqueta sigue pegada a su lugar: el palito crece y el recuadro queda arriba, donde no tapa.
          const base = e.sy!;
          e.sy = y;
          e.el.style.setProperty("--subida", `${base - y}px`);
          e.el.style.transform = `translate(-50%, -100%) translate(${e.sx}px, ${base}px)`;
          puesta = true;
          break;
        }
        // Dentro de la ciudad sube justo encima de la que tapa (sin salirse de la pantalla); en Colombia se esconde.
        if (e.escena !== "ciudad") break;
        y = Math.min(...choques.map((o) => o[1])) - 8;
        if (rect(y)[1] < 0) break;
      }
      e.el.style.display = puesta ? "" : "none";
    }
  }
  /** Las cuatro esquinas de lo que ve la cámara, en el suelo del mapa (para el minimapa). */
  const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ESPESOR), rayoC = new THREE.Raycaster(), punto = new THREE.Vector3();
  function avisarCamara() {
    if (escena !== colombia) return;
    const esquinas: [number, number][] = [];
    for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      rayoC.setFromCamera(new THREE.Vector2(x, y), camara);
      if (rayoC.ray.intersectPlane(plano, punto)) esquinas.push([punto.x, punto.z]);
    }
    if (esquinas.length === 4) ev.camara(esquinas);
  }
  /** Que la vista no se salga del país (ni, dentro de una ciudad, de su cuadra). */
  controles.addEventListener("change", () => {
    if (escena !== colombia) {
      const t = controles.target, l = limiteCiudad;
      const x = THREE.MathUtils.clamp(t.x, l.x - l.r, l.x + l.r), z = THREE.MathUtils.clamp(t.z, l.z - l.r, l.z + l.r);
      if (x !== t.x || z !== t.z) { camara.position.x += x - t.x; camara.position.z += z - t.z; t.x = x; t.z = z; }
      return;
    }
    const t = controles.target, x = THREE.MathUtils.clamp(t.x, -7.5, 7.5), z = THREE.MathUtils.clamp(t.z, -9.5, 9.5);
    if (x !== t.x || z !== t.z) { camara.position.x += x - t.x; camara.position.z += z - t.z; t.x = x; t.z = z; }
    avisarCamara();
  });
  const observador = new ResizeObserver(() => { pedir(); requestAnimationFrame(avisarCamara); });
  observador.observe(lienzo);

  // El pulso de las venas activas (la única animación continua): solo si hay, con "Movimiento" y sin modo liviano. ~30 cps.
  let moviendo = !liviano, reloj = 0, ultimo = 0;
  function animar(t: number) {
    if (!moviendo || liviano || escena !== colombia || !pulsos.length || document.hidden) { reloj = 0; ultimo = 0; return; }
    reloj = requestAnimationFrame(animar);
    if (t - ultimo < 33 || cambiando) return;
    const dt = ultimo ? Math.min(0.1, (t - ultimo) / 1000) : 0;
    ultimo = t;
    for (const p of pulsos) p.offset.x -= dt * 0.45;
    dibujar();
  }
  function arrancar() { if (moviendo && !reloj) reloj = requestAnimationFrame(animar); }
  document.addEventListener("visibilitychange", arrancar);
  document.addEventListener("visibilitychange", arrancarResalte);

  // ─── Pasar, tocar y alejarse ───
  const rayo = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  let abajo: { x: number; y: number } | null = null;
  function seleccionar(clave: string | null, mover: boolean) {
    seleccionada = clave;
    enmarcarCiudad(clave);
    pintarCapa();
    const c = clave ? buscar(clave) : null;
    ev.seleccion(c);
    if (c && mover) {
      // La vista se corre un poco al norte: la ciudad queda abajo y su tarjeta (con el desplegable) cabe encima.
      const p = proyectar(c.lon, c.lat), d = camara.position.clone().sub(controles.target);
      const mira = new THREE.Vector3(p.x, ESPESOR, p.y - d.length() * 0.16);
      void volar(mira.clone().add(d), mira, 350).then(avisarCamara);
    }
  }
  /** El recuadro del nombre: elige la ciudad (y la cámara va hasta ella); otro toque la suelta. */
  function tocarNombre(clave: string) {
    if (cambiando) return;
    if (seleccionada === clave) seleccionar(null, false);
    else seleccionar(clave, true);
  }
  /** Un lugar de la ciudad elegido (desde su etiqueta o tocándolo): se enmarca y se despliegan sus trámites; la cámara no se mueve. */
  function elegirLugar(clave: string | null) {
    ev.lugar(elegido(lugares.find((x) => x.clave === clave)));
    resaltarSitio();
    pedir();
  }
  /** El mouse sobre un lugar (en el HUD o sobre su edificio): se resalta de paso. */
  function sobre(clave: string | null) {
    if (clave === sobreClave) return;
    sobreClave = clave;
    resaltarSitio();
  }
  /** Un clic en una ciudad (su edificio): la elige. Entrar es con su burbuja o con el clic derecho (nada automático). */
  function tocarCiudad(clave: string | null) {
    if (cambiando) return;
    if (clave !== seleccionada) seleccionar(clave, !!clave);
  }
  // Teclado (como en un juego): flechas o WASD mueven la vista (en Colombia y en la ciudad); + y - acercan y alejan.
  const alTecla = (e: KeyboardEvent) => {
    if (!lienzo.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    const objetivo = e.target as HTMLElement | null;
    const tag = objetivo?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || objetivo?.isContentEditable) return;
    const paso = Math.max(0.25, camara.position.distanceTo(controles.target) * 0.06);
    const mov: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    const m = mov[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (m) {
      e.preventDefault();
      camara.position.x += m[0] * paso; camara.position.z += m[1] * paso; controles.target.x += m[0] * paso; controles.target.z += m[1] * paso;
      controles.update();
    } else if (e.key === "+" || e.key === "-") {
      e.preventDefault();
      const d = camara.position.clone().sub(controles.target);
      d.setLength(THREE.MathUtils.clamp(d.length() * (e.key === "+" ? 0.85 : 1.18), controles.minDistance, controles.maxDistance));
      camara.position.copy(controles.target).add(d); controles.update();
    }
  };
  window.addEventListener("keydown", alTecla);
  const elegido = (l: Lugar | undefined): LugarElegido | null => (l ? { clave: l.clave, titulo: l.titulo, carpetas: l.carpetas } : null);
  function tocar(e: PointerEvent, clic: boolean) {
    if (cambiando) return;
    const r = lienzo.getBoundingClientRect();
    puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    if (escena === colombia) {
      const hit = rayo.intersectObjects(tocablesColombia, false)[0];
      lienzo.style.cursor = hit ? "pointer" : "";
      marcarCerca(e.clientX - r.left, e.clientY - r.top);
      ev.ciudad(hit ? buscar(hit.object.userData.ciudad) : null, e.clientX - r.left, e.clientY - r.top);
      if (clic) tocarCiudad(hit?.object.userData.ciudad ?? null);
      return;
    }
    const hitL = rayo.intersectObjects(tocablesCiudad, false)[0];
    lienzo.style.cursor = hitL ? "pointer" : "";
    const k: string | null = hitL?.object.userData.lugar ?? null;
    if (k !== sobre3D) { sobre3D = k; sobre(k); ev.sobreLugar?.(k); }
    if (clic) elegirLugar(k);
  }
  let sobre3D: string | null = null;
  const alMover = (e: PointerEvent) => tocar(e, false);
  const alBajar = (e: PointerEvent) => { abajo = { x: e.clientX, y: e.clientY }; };
  const alSoltar = (e: PointerEvent) => {
    if (abajo && Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) < 5) tocar(e, true);
    abajo = null;
  };
  const alSalir = () => { ev.ciudad(null, 0, 0); if (sobre3D) { sobre3D = null; sobre(null); ev.sobreLugar?.(null); } };
  lienzo.addEventListener("pointermove", alMover);
  lienzo.addEventListener("pointerdown", alBajar);
  lienzo.addEventListener("pointerup", alSoltar);
  lienzo.addEventListener("pointerleave", alSalir);
  // Clic derecho: la pantalla muestra las opciones de lo que hay debajo (una ciudad, un lugar o el fondo).
  // Arrastrar con el botón derecho mueve la vista: si se arrastró, no sale el menú.
  let derechoAbajo: { x: number; y: number } | null = null;
  const alBajarDerecho = (e: PointerEvent) => { if (e.button === 2) derechoAbajo = { x: e.clientX, y: e.clientY }; };
  const alMenu = (e: MouseEvent) => {
    e.preventDefault();
    const arrastro = derechoAbajo && Math.hypot(e.clientX - derechoAbajo.x, e.clientY - derechoAbajo.y) > 5;
    derechoAbajo = null;
    if (cambiando || arrastro) return;
    const r = lienzo.getBoundingClientRect();
    puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    if (escena === colombia) {
      const hit = rayo.intersectObjects(tocablesColombia, false)[0];
      ev.menuFondo?.({ ciudad: hit?.object.userData.ciudad }, e);
      return;
    }
    const hitL = rayo.intersectObjects(tocablesCiudad, false)[0];
    ev.menuFondo?.({ lugar: hitL?.object.userData.lugar }, e);
  };
  lienzo.addEventListener("pointerdown", alBajarDerecho);
  lienzo.addEventListener("contextmenu", alMenu);
  // Al terminar de dibujar la primera vez, el minimapa recibe lo que se ve.
  requestAnimationFrame(avisarCamara);

  return {
    datos(d) {
      ciudades = d.ciudades;
      if (seleccionada && !buscar(seleccionada)) seleccionada = null;
      armarColombia();
      if (nivel.tipo === "ciudad") {
        const c = buscar(nivel.clave);
        if (c) { armarCiudad(c); escena = ciudad; resaltarSitio(true); }
      }
      marcarActivo();
      pedir(); arrancar();
    },
    ir: (n) => { void ir(n); },
    capa(c) { capaActual = c; pintarCapa(); },
    seleccionar: (clave) => seleccionar(clave, true),
    carpetasDe: (clave) => lugares.find((l) => l.clave === clave)?.carpetas ?? [],
    lugar: (clave) => { if (escena === ciudad && !cambiando) elegirLugar(clave); },
    resaltar: (clave) => sobre(escena === ciudad ? clave : null),
    despliegue(d) {
      // Algo nuevo que se abre (otra ancla u otro modo) entra con su animación; si solo cambia su contenido, no.
      const llave = d ? `${d.modo}|${JSON.stringify(d.ancla)}` : "";
      const nuevo = llave !== llaveDesp;
      llaveDesp = llave;
      despliegueActual = d;
      if (!d) { desp.hidden = true; desp.innerHTML = ""; despHtml = ""; }
      else {
        if (d.html !== despHtml) { desp.innerHTML = d.html; despHtml = d.html; }
        desp.hidden = false;
        desp.className = `mapa-despliegue ${d.modo}${desp.classList.contains("izq") ? " izq" : ""}`;
        if (nuevo) { void desp.offsetWidth; desp.classList.add("abre"); }
      }
      marcarActivo();
      resaltarSitio();
      pedir();
    },
    enfocar(x, z) {
      if (escena !== colombia) return;
      const d = camara.position.clone().sub(controles.target);
      const t = new THREE.Vector3(THREE.MathUtils.clamp(x, -7.5, 7.5), ESPESOR, THREE.MathUtils.clamp(z, -9.5, 9.5));
      void volar(t.clone().add(d), t, 400).then(avisarCamara);
    },
    zoom(f) {
      const d = camara.position.clone().sub(controles.target);
      const nueva = Math.min(controles.maxDistance, Math.max(controles.minDistance, d.length() * f));
      void volar(controles.target.clone().add(d.setLength(nueva)), controles.target.clone(), 300).then(avisarCamara);
    },
    recentrar() { const v = escena === colombia ? VISTA_COLOMBIA : vistaCiudad; void volar(v.pos, v.mira, 700).then(avisarCamara); },
    movimiento(si) {
      moviendo = si; capa.classList.toggle("quieto", !si);
      if (piezas) { for (const o of piezas.ondas) o.visible = si && !liviano; moverResalte(performance.now()); pedir(); }
      if (si) { arrancar(); arrancarResalte(); } else { cancelAnimationFrame(reloj); reloj = 0; ultimo = 0; cancelAnimationFrame(relojResalte); relojResalte = 0; }
    },
    fondo(color) { render.setClearColor(color); (suelo.material as THREE.MeshStandardMaterial).color.set(color); render.shadowMap.needsUpdate = true; pedir(); },
    destruir() {
      cancelAnimationFrame(pendiente); cancelAnimationFrame(reloj); cancelAnimationFrame(vuelo); cancelAnimationFrame(relojResalte);
      document.removeEventListener("visibilitychange", arrancar);
      document.removeEventListener("visibilitychange", arrancarResalte);
      observador.disconnect();
      lienzo.removeEventListener("pointermove", alMover); lienzo.removeEventListener("pointerdown", alBajar);
      lienzo.removeEventListener("pointerup", alSoltar); lienzo.removeEventListener("pointerleave", alSalir); lienzo.removeEventListener("contextmenu", alMenu); lienzo.removeEventListener("pointerdown", alBajarDerecho);
      window.removeEventListener("keydown", alTecla);
      controles.dispose();
      for (const t of [...pulsos, texTierra, texHalo]) t.dispose();
      for (const m of [...matsHalo.values(), matVena, matVenaAliado, matVenaActiva, matMarco, ...matOndas, matBrillo, matContorno, matRombo, matAura, matHaz, matChispa]) m.dispose();
      texHaz.dispose();
      gRombo.dispose();
      gHalo.dispose();
      for (const e of [colombia, ciudad]) e.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.letrero) { (o.material as THREE.MeshBasicMaterial).map?.dispose(); (o.material as THREE.Material).dispose(); }
        if ((o instanceof THREE.Mesh || o instanceof THREE.LineSegments) && o.geometry.type !== "RoundedBoxGeometry") o.geometry.dispose();
      });
      liberarModelos();
      for (const e of etiquetas) e.el.remove();
      fundido.remove(); desp.remove();
      render.dispose();
    },
  };
}

/** ¿Este navegador puede dibujar 3D (WebGL)? */
export function hay3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
