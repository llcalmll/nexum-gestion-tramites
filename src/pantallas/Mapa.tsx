import { useLiveQuery } from "dexie-react-hooks";
import { useMenuTramite } from "../componentes/accionesMenu";
import { abrirMenu, type ItemMenu } from "../componentes/MenuContextual";
import { Activity, ArrowLeft, ChevronDown, ChevronRight, History, List, LocateFixed, LogIn, LogOut, Minus, Plus, Search, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ESTADO_TRAMITE_COLOR, ESTADO_TRAMITE_LABEL, ESTADOS_TERMINALES, type EstadoTramite, normalizar } from "../../compartido/dominio";
import type { Tramite } from "../../compartido/tipos";
import { moverTramite } from "../componentes/Finalizar";
import { GloboNota, notaHtml, NotaVistazo, type NotaCorta } from "../componentes/NotaVistazo";
import { Registrador } from "../componentes/Registrador";
import { TablaDatos } from "../componentes/TablaDatos";
import { Badge, Panel, useUI } from "../componentes/ui";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { useParametros } from "../datos/hooks";
import { alResaltar, porResaltar, resaltarEnMapa, yaResaltados } from "../datos/resaltar";
import { sincronizarAhora } from "../datos/sincronizacion";
import { useSemaforos } from "../datos/semaforo";
import { fecha, hoyISO, pesos, TONO_SEMAFORO } from "../logica/formato";
import { type Capa, construirCiudades, type TramitadorEnvio, type TramiteCiudad } from "../mapa/ciudades";
import { type CiudadMapa, crearEscena, type Despliegue, type Escena, hay3D, type LugarCiudad, lugaresDe, type Nivel, proyectar } from "../mapa/escena";
import { HudMapa, type Ventana } from "../mapa/Hud";
import { abierta, type Carpeta, type Geo, HEX_LUZ, LUCES_MAPA, type Luz, NOMBRE_LUZ, type Zona } from "../mapa/lugares";
import Clientes from "./Clientes";
import Vehiculos from "./Vehiculos";

/** Los colores de las capas (los mismos de la escena; iguales en claro y oscuro). */
const HEX = { azul: "#2f5bea", rojo: "#e5484d", verde: "#2f9e63" };
/** La leyenda de los puntos: los estados activos de las luces de la tabla. */
const LEYENDA = NOMBRE_LUZ;
/** Lo más urgente primero en las listas: la corrección, lo recibido, lo que está en el tránsito... */
const URGENCIA: Luz[] = ["correccion", "recibido", "transito", "salio"];
/** Las capas: qué puntos y qué halo muestra cada ciudad. */
const CAPAS: { capa: Capa; titulo: string; color: string }[] = [
  { capa: "abiertos", titulo: "Abiertos", color: HEX.azul },
  { capa: "atrasados", titulo: "Atrasados", color: HEX.rojo },
  { capa: "cobrar", titulo: "Por cobrar", color: "#d97706" },
  { capa: "aliados", titulo: "Aliados", color: HEX.verde },
];
const NOMBRE_ZONA: Record<Zona, string> = { vehiculos: "Recibidos: vehículos", personas: "Recibidos: personas", correccion: "Corrección", salida: "Ya salió", transito: "Tránsito de Ibagué", fuera: "En otra ciudad" };

const svg = (d: string, t = 14) => `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONO = {
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  sobre: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  tabla: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  recibido: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  transito: '<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4z"/>',
  correccion: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  salio: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  finalizar: '<path d="M20 6 9 17l-5-5"/>',
};
/** Las burbujas para mover la carpeta elegida (sin la de su estado actual). Se confirma con un segundo toque. */
type Mover = "recibido" | "transito" | "correccion" | "salio" | "finalizar";
const MOVER: { k: Mover; texto: string; color: string; estado: EstadoTramite; tarjeta?: string }[] = [
  { k: "recibido", texto: "Recibido", color: HEX_LUZ.recibido, estado: "en_preparacion" },
  { k: "transito", texto: "En tránsito", color: HEX_LUZ.transito, estado: "en_tramite" },
  { k: "correccion", texto: "Corrección", color: HEX_LUZ.correccion, estado: "requiere_correccion" },
  { k: "salio", texto: "Ya salió", color: HEX_LUZ.salio, estado: "entregado", tarjeta: "en_oficina" },
  { k: "finalizar", texto: "Finalizar", color: "#2f9e63", estado: "entregado" },
];
/** La burbuja de su estado de hoy (no sale). */
const ACTUAL: Record<Luz, Mover> = { recibido: "recibido", transito: "transito", correccion: "correccion", salio: "salio" };

function leer(clave: string, defecto: string) { try { return localStorage.getItem(clave) ?? defecto; } catch { return defecto; } }
function guardar(clave: string, valor: string) { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** "ABC123" -> "ABC 123", "ABC12D" -> "ABC 12D" (como se ven las placas). */
const placaBonita = (p: string) => (p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** El enlace de WhatsApp de un teléfono colombiano (abre el chat). */
const whatsapp = (tel: string) => { const d = tel.replace(/\D/g, ""); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? `57${d}` : d}` : null; };
/** Días entre dos fechas (AAAA-MM-DD). */
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 864e5);
/** En Colombia los puntos y sus listas son solo de trámites: las licencias se ven al entrar a la ciudad. */
const sinLicencias = (l: Carpeta[]) => l.filter((x) => x.categoria !== "licencia");
/** Lo abierto primero y, entre eso, lo vencido; luego por estado y por la fecha de entrega. */
const urgentes = (l: Carpeta[]) => [...l].sort((a, b) => Number(abierta(b)) - Number(abierta(a)) || Number(b.tono === "rojo") - Number(a.tono === "rojo")
  || URGENCIA.indexOf(a.luz) - URGENCIA.indexOf(b.luz) || (a.entrega ?? "9999").localeCompare(b.entrega ?? "9999"));
/** "para Bogotá": el trámite es de otra ciudad pero la carpeta sigue en la oficina (aún no se radica allá). */
const paraOtra = (c: Carpeta) => (c.ciudad && c.zona !== "fuera" ? `para ${c.ciudad}` : "");

/**
 * Los días en texto y la tira de tiempo: atrasado "+N d" en rojo; el día de la entrega "hoy" en ámbar; si no, "N d",
 * en ámbar si ya consumió el 80 % del plazo. Si ya salió, "salió" en morado. Sin fecha estimada, nada (no se inventa).
 */
function tiempos(t: Tramite | undefined, luz: Luz, hoy: string): Pick<Carpeta, "dias" | "tiempo"> {
  if (luz === "salio") return { dias: { texto: "salió", clase: "m" }, tiempo: null };
  const est = t?.fechaEstimadaEntrega;
  if (!t || !est) return { dias: null, tiempo: null };
  const plazo = Math.max(1, diasEntre(t.creado, est)), resta = diasEntre(hoy, est);
  const frac = Math.min(1, Math.max(0, diasEntre(t.creado, hoy) / plazo));
  if (resta < 0) return { dias: { texto: `+${-resta} d`, clase: "r" }, tiempo: { frac: 1, color: "rojo" } };
  if (resta === 0) return { dias: { texto: "hoy", clase: "a" }, tiempo: { frac, color: "ambar" } };
  const tarde = frac >= 0.8;
  return { dias: { texto: `${resta} d`, clase: tarde ? "a" : "" }, tiempo: { frac, color: tarde ? "ambar" : "azul" } };
}

/** Lo que está desplegado como lista de píldoras (y de qué etiqueta salió). */
type Lista =
  | { k: "color"; clave: string; color: Luz }
  | { k: "todos"; clave: string }
  | { k: "tramitadores"; clave: string }
  | { k: "sobres"; clave: string; desde: "vena" | "tramitadores" }
  | { k: "lugar"; clave: string; titulo: string; color?: Luz };
const mismaLista = (a: Lista | null, b: Lista) => !!a && JSON.stringify(a) === JSON.stringify(b);

const MAX_PILDORAS = 80;
const titulo = (texto: string, n: number) => `<div class="tit">${esc(texto)}<small>${n}</small></div>`;
/** La placa con forma de placa (amarilla); si es de licencia, su símbolo con las categorías; sin placa, el código. */
function placaHtml(c: Carpeta) {
  if (c.categoria === "licencia") return `<span class="licencia-mini"><i></i><b>${esc((c.categorias ?? "").split(",").filter(Boolean).join(" ") || "LIC")}</b></span>`;
  return c.placa ? `<span class="placa"><b>${esc(placaBonita(c.placa))}</b></span>` : `<span class="placa sin"><b>${esc(c.codigo)}</b></span>`;
}
function pildora(c: Carpeta, i: number) {
  const col = c.luz;
  const info = [c.codigo, c.tipo, c.titular, paraOtra(c)].filter(Boolean).join(" · ");
  return `<button type="button" class="pil pil-placa" data-carpeta="${esc(c.id)}" style="--c:${HEX_LUZ[col]};--i:${i}" title="${esc(info)}">${placaHtml(c)}${c.nota?.descripcion ? notaHtml(c.id) : ""}<span class="pil-carta"><i class="dot ${col}" title="${esc([NOMBRE_LUZ[col], abierta(c) ? c.motivo : ""].filter(Boolean).join(" · "))}"></i><small>${esc(c.tipo)}</small>${c.dias ? `<span class="dias ${c.dias.clase}">${esc(c.dias.texto)}</span>` : ""}</span></button>`;
}
/** `antes`: lo que va entre el título y las píldoras (el contacto del tramitador). */
function pildoras(texto: string, lista: Carpeta[], tabla?: string, antes = "") {
  const l = urgentes(lista);
  return titulo(texto, l.length) + antes + (l.length ? l.slice(0, MAX_PILDORAS).map(pildora).join("") : `<span class="vacio">Ninguno.</span>`)
    + (tabla && l.length > MAX_PILDORAS ? `<button type="button" class="pil mas" data-tabla="${esc(tabla)}" style="--i:${MAX_PILDORAS}"><span class="ic">${svg(ICONO.tabla, 13)}</span>Ver los ${l.length} en la tabla</button>` : "");
}

/** Un tramitador como píldora: su WhatsApp si tiene teléfono (se abre el chat), el departamento si lo cubre entero. */
function pilTramitador(z: CiudadMapa["tramitadores"][number], departamento: string, i: number) {
  const wa = z.telefono ? whatsapp(z.telefono) : null;
  const cuerpo = `<span class="ic">${svg(wa ? ICONO.whatsapp : ICONO.persona, 13)}</span><b>${esc(z.nombre)}</b>${z.porDepartamento ? `<small>cubre ${esc(departamento)}</small>` : ""}${z.telefono ? `<span class="cod">${esc(z.telefono)}</span>` : ""}`;
  return wa ? `<a class="pil pil-wa" href="${wa}" target="_blank" rel="noreferrer" style="--c:#16a34a;--i:${i}" title="${esc(`Escribirle por WhatsApp a ${z.nombre}`)}">${cuerpo}</a>` : `<div class="pil" style="--i:${i}">${cuerpo}</div>`;
}

/** Un cliente de una academia como píldora (tocarlo abre su ficha), con cuántos trámites ha hecho con ella. */
function pilCliente(c: { id: string; nombre: string; n: number }, i: number) {
  return `<button type="button" class="pil" data-cliente="${esc(c.id)}" style="--i:${i}" title="Abrir su ficha"><span class="ic">${svg(ICONO.persona, 13)}</span><b>${esc(c.nombre || "Sin nombre")}</b><small>${plural(c.n, "trámite", "trámites")}</small></button>`;
}

/** La carpeta elegida: burbujas para moverla (en arco), el código y sus datos como texto con halo. */
function htmlCarpeta(c: Carpeta, confirma: Mover | null, hoy: string) {
  const acciones = MOVER.filter((a) => a.k !== ACTUAL[c.luz]);
  const medio = (acciones.length - 1) / 2;
  const burs = acciones.map((a, i) => {
    const on = confirma === a.k;
    return `<div class="ab${on ? " confirma" : ""}" style="--c:${a.color};--g:${a.color}38;--i:${i};--y:${Math.round((i - medio) ** 2 * 9)}px"><button type="button" data-mover="${a.k}" aria-label="${esc(on ? `Toque otra vez: ${a.texto}` : `Pasar a ${a.texto}`)}">${svg(ICONO[a.k], 19)}</button><span>${esc(on ? `Toque otra vez: ${a.texto}` : a.texto)}</span></div>`;
  }).join("");
  const lineas: string[] = [`<span><i class="dot ${c.luz}"></i> ${esc([NOMBRE_LUZ[c.luz], paraOtra(c)].filter(Boolean).join(" · "))}</span>`];
  // La nota destacada, escrita (lo más importante del trámite).
  if (c.nota?.descripcion) lineas.push(`<span class="rad-nota">${notaHtml(c.id)}<span>${esc(c.nota.descripcion)}</span></span>`);
  if (c.motivo && abierta(c)) lineas.push(`<span class="sem ${c.semaforo ?? "azul"}">${esc(c.motivo)}</span>`);
  if (c.entrega && c.creado) {
    const dia = Math.max(1, diasEntre(c.creado, hoy) + 1), de = Math.max(1, diasEntre(c.creado, c.entrega));
    const cuenta = dia <= de ? `Día ${dia} de ${de}` : `Día ${dia}, plazo de ${plural(de, "día", "días")}`;
    if (abierta(c)) lineas.push(`<span><span class="mono">${cuenta}</span> · Entrega estimada ${esc(fecha(c.entrega))}</span>`);
  }
  if (c.espera) lineas.push(`<span>${plural(c.espera, "día", "días")} en el tránsito</span>`);
  if (c.saldo) lineas.push(`<span>Saldo <b class="mono">${esc(pesos(c.saldo))}</b></span>`);
  if (c.pre && c.pre.total) {
    lineas.push(`<span class="pre-segs" aria-label="${c.pre.hechas} de ${c.pre.total} precondiciones">${Array.from({ length: c.pre.total }, (_, i) => `<i class="${i < c.pre!.hechas ? "ok" : ""}"></i>`).join("")}</span>`);
    if (c.pre.faltan.length) lineas.push(`<span>Falta: ${esc(c.pre.faltan.join(", "))}</span>`);
  }
  return `<div class="rad-burs">${burs}</div>`
    + `<div class="rad-tarjeta" style="--c:${HEX_LUZ[c.luz]}">`
    + `<div class="rad-c"><b>${esc(c.codigo)}</b><span>${esc(c.tipo)}</span><small>${esc([c.placa ? placaBonita(c.placa) : "", c.titular].filter(Boolean).join(" · "))}</small></div>`
    + `<div class="rad-i">${lineas.join("")}<div class="rad-acc"><button type="button" class="prim" data-abrir="${esc(c.id)}">Abrir expediente</button><button type="button" data-cerrar-carpeta="1">Cerrar</button></div></div>`
    + `</div>`;
}

/** Filtros del histórico de una ciudad (la tabla grande). */
const FILTROS = [["todos", "Todos"], ["abiertos", "Abiertos"], ["entregado", "Finalizados"], ["cancelado", "Cancelados"]] as const;
type Filtro = (typeof FILTROS)[number][0];
const pasa = (t: TramiteCiudad, f: Filtro) => (f === "todos" ? true : f === "abiertos" ? !ESTADOS_TERMINALES.includes(t.estado) : t.estado === f);

/**
 * Mapa: Colombia como un tablero (vista fija que se mueve y se acerca, sin girar). El mapa ocupa toda el área y todo
 * flota encima, sin tarjetas: cada ciudad con su nombre en un recuadro y sus puntos de semáforo (se tocan para ver la
 * lista de ese color), venas hasta Ibagué (la de una ciudad con trámites abiertos o un envío de hoy dejado en el mapa lleva un pulso), y en las esquinas la
 * ruta, los controles, las capas con la leyenda y el minimapa. Tocar el nombre elige la ciudad (burbujas: entrar, todos
 * sus trámites, sus tramitadores); dentro de una ciudad, cada lugar y cada carpeta se despliegan igual, y la carpeta
 * elegida se mueve de estado con un toque y otro de confirmación. Sin 3D (PC sin WebGL) se ve como listas.
 */
export default function Mapa() {
  const nav = useNavigate();
  const params = useParametros();
  const ui = useUI();
  const lienzo = useRef<HTMLCanvasElement>(null);
  const capaDom = useRef<HTMLDivElement>(null);
  const escena = useRef<Escena | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [nivel, setNivel] = useState<Nivel>({ tipo: "colombia" });
  const [capa, setCapa] = useState<Capa>(() => (CAPAS.some((c) => c.capa === leer("mapa-capa", "")) ? (leer("mapa-capa", "") as Capa) : "abiertos"));
  const [movimiento, setMovimiento] = useState(() => leer("mapa-movimiento", "1") === "1");
  const [liviano, setLiviano] = useState(() => leer("mapa-liviano", "0") === "1");
  const [seleccion, setSeleccion] = useState<CiudadMapa | null>(null);
  const [vista, setVista] = useState<[number, number][] | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [confirma, setConfirma] = useState<Mover | null>(null);
  const [historico, setHistorico] = useState<string | null>(null);
  // El lugar de la ciudad que tiene el mouse encima en el 3D (se marca también en el HUD).
  const [sobreLugar, setSobreLugar] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [q, setQ] = useState("");
  // Clientes, vehículos o registrar, en una ventana encima del mapa (en la URL: ?ver=...).
  const [busqueda, setBusqueda] = useSearchParams();
  const ver = (["clientes", "vehiculos", "registrar"] as const).find((v) => v === busqueda.get("ver")) ?? null;
  const abrirVentana = (v: Ventana, extra: Record<string, string> = {}) => setBusqueda(new URLSearchParams({ ver: v, ...extra }));
  const cerrarVentana = () => setBusqueda(new URLSearchParams(), { replace: true });
  // "Ver en la ciudad": la carpeta que se elige al terminar de entrar.
  const pendiente = useRef<string | null>(null);
  const con3D = useMemo(() => hay3D(), []);
  // Cada minuto, en silencio, se recalculan el semáforo y los días (sin avisos).
  const [minuto, setMinuto] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinuto((x) => x + 1), 10_000); return () => clearInterval(t); }, []);
  const hoy = useMemo(() => hoyISO(), [minuto]);
  const semaforos = useSemaforos(minuto);
  // Los envíos que se dejaron en el mapa: activos (vena con pulso) hasta las 6:30 del día siguiente; después, grises.
  const enviosMapa = useLiveQuery(() => db.envios.filter((e) => !!e.enMapa).toArray(), []) ?? [];
  const sobres = useMemo(() => {
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 16).replace(" ", "T");
    const manana = (f: string) => new Date(Date.parse(`${f}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    return enviosMapa.map((e) => ({ ...e, activo: e.estado === "enviado" && ahora < `${manana(e.fechaEnvio)}T06:30` }));
  }, [enviosMapa, minuto]);

  const datos = useLiveQuery(async () => {
    const [tramites, tipos, clientes, vehiculos, organismos, pagos, destacadas] = await Promise.all([db.tramites.toArray(), db.tipos_tramite.toArray(), db.clientes.toArray(), db.vehiculos.toArray(), db.organismos.toArray(), db.pagos.toArray(),
      db.bitacora.filter((b) => !!b.destacada).toArray()]);
    return { tramites, tipos, clientes, vehiculos, organismos, pagos, destacadas };
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch("/mapa/colombia.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((g) => vivo && setGeo(g), () => vivo && setErrorGeo("No se pudo cargar el mapa de Colombia. Revise el internet y vuelva a abrir la pantalla."));
    return () => { vivo = false; };
  }, []);

  // Los tramitadores de Envíos (su oficina sale en la cuadra de su ciudad y en la capa "Aliados").
  const tramitadores = useMemo(() => { try { const l = JSON.parse(params.envio_tramitadores || "[]"); return Array.isArray(l) ? (l as TramitadorEnvio[]) : []; } catch { return []; } }, [params.envio_tramitadores]);
  // Población urbana de cada municipio (DANE 2026): el tamaño de cada ciudad es coherente con el real.
  const [poblacion, setPoblacion] = useState<Record<string, number>>({});
  useEffect(() => { fetch("/mapa/poblacion.json").then((r) => (r.ok ? r.json() : null)).then((p) => p?.cabecera && setPoblacion(p.cabecera), () => {}); }, []);
  const { ciudades, sinUbicar, supuestas } = useMemo(() => {
    if (!datos || !geo) return { ciudades: [] as CiudadMapa[], sinUbicar: [], supuestas: [] };
    const r = construirCiudades(datos, geo, tramitadores, hoy, poblacion, sobres);
    const porId = new Map(datos.tramites.map((t) => [t.id, t]));
    // La nota destacada de cada carpeta: la suya o, en un combo, la de cualquiera de sus partes.
    const destacada = new Map(datos.destacadas.map((b) => [b.tramiteId, b]));
    const notaDe = (t: Tramite | undefined): NotaCorta | null => {
      if (!t) return null;
      const partes = t.encargoId ? datos.tramites.filter((x) => x.encargoId === t.encargoId) : [t];
      const b = partes.map((x) => destacada.get(x.id)).find(Boolean);
      return b ? { descripcion: b.descripcion, fecha: b.fecha } : null;
    };
    // Cada carpeta con su semáforo (el porqué), sus días y su saldo.
    for (const c of r.ciudades) {
      const saldo = new Map<string, number>();
      for (const t of c.tramites) saldo.set(t.codigo, (saldo.get(t.codigo) ?? 0) + t.saldo);
      c.carpetas = c.carpetas.map((cp) => {
        const s = semaforos.get(cp.id), t = porId.get(cp.id);
        const x: Carpeta = { ...cp, semaforo: s?.color, motivo: s?.motivo, creado: t?.creado, saldo: saldo.get(cp.codigo) ?? 0, nota: notaDe(t) };
        const recibido = cp.zona === "vehiculos" || cp.zona === "personas";
        return {
          ...x, ...tiempos(t, cp.luz, hoy),
          pre: recibido && s?.pre?.total ? s.pre : null,
          espera: (cp.zona === "transito" || cp.zona === "fuera") && t?.fechaRadicado ? Math.max(0, diasEntre(t.fechaRadicado, hoy)) : undefined,
        };
      });
    }
    // Las carpetas de las academias son las mismas de su ciudad (ya con su semáforo y sus días).
    const listas = new Map(r.ciudades.flatMap((c) => c.carpetas.map((cp) => [cp.id, cp] as const)));
    for (const a of r.ciudades.find((c) => c.oficina)?.academias ?? []) a.carpetas = a.carpetas.map((cp) => listas.get(cp.id) ?? cp);
    return r;
  }, [datos, geo, tramitadores, poblacion, sobres, semaforos, hoy]);
  const ibague = ciudades.find((c) => c.oficina) ?? null;
  const buscar = (clave: string) => ciudades.find((c) => c.clave === clave) ?? null;
  const enCiudad = nivel.tipo === "ciudad" ? buscar(nivel.clave) : null;

  // La escena se crea una vez (y otra vez si cambia el modo liviano); los datos se le pasan cuando cambian.
  useEffect(() => {
    if (!con3D || !geo || !lienzo.current || !capaDom.current) return;
    let e: Escena;
    try {
      e = crearEscena(lienzo.current, capaDom.current, geo, {
        ciudad: () => {},
        lugar: (l) => { setConfirma(null); if (l) { setElegida(null); setLista({ k: "lugar", clave: l.clave, titulo: l.titulo }); } else setLista((x) => (x?.k === "lugar" ? null : x)); },
        nivel: (n) => {
          setNivel(n); setElegida(null); setLista(null); setConfirma(null);
          try { sessionStorage.setItem("mapa-nivel", JSON.stringify(n)); } catch { /* sin almacenamiento */ }
        },
        seleccion: (c) => { setSeleccion(c); setLista((x) => (x && x.k !== "lugar" && (!c || x.clave !== c.clave) ? null : x)); },
        camara: (esq) => setVista(esq),
        sobreLugar: (k) => setSobreLugar(k),
        menuFondo: (d, e) => menuLugarRef.current(d, e),
      }, { liviano });
    } catch {
      return;
    }
    escena.current = e;
    const fondo = () => e.fondo(getComputedStyle(document.documentElement).getPropertyValue("--fondo").trim() || "#e6eaf0");
    fondo();
    const obs = new MutationObserver(fondo);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    setNivel({ tipo: "colombia" });
    return () => { obs.disconnect(); e.destruir(); escena.current = null; };
  }, [con3D, geo, liviano]);
  useEffect(() => { if (ciudades.length) escena.current?.datos({ ciudades }); }, [ciudades, geo, liviano]);
  useEffect(() => { escena.current?.capa(capa); guardar("mapa-capa", capa); }, [capa, geo, liviano, ciudades]);
  useEffect(() => { escena.current?.movimiento(movimiento && !liviano); }, [movimiento, liviano, geo]);
  // Al volver (de un trámite, por ejemplo), a la ciudad donde estaba.
  const volvio = useRef(false);
  useEffect(() => {
    if (volvio.current || !escena.current || !ciudades.length) return;
    volvio.current = true;
    try {
      const n = JSON.parse(sessionStorage.getItem("mapa-nivel") || "null") as Nivel | null;
      if (n?.tipo === "ciudad" && ciudades.some((c) => c.clave === n.clave)) escena.current.ir(n);
    } catch { /* nada guardado */ }
  }, [ciudades]);
  // Al terminar de entrar a una ciudad desde una píldora, su carpeta queda elegida.
  useEffect(() => {
    if (!enCiudad || !pendiente.current) return;
    const id = pendiente.current;
    pendiente.current = null;
    if (enCiudad.carpetas.some((x) => x.id === id)) setElegida(id);
  }, [enCiudad]);

  // Lo desplegado (la carpeta elegida o una lista) lo arma esta pantalla y la escena lo pone junto a su ancla. Va
  // después de pasarle los datos: las listas de un lugar se leen de la ciudad ya armada.
  const carpetaElegida = elegida && enCiudad ? enCiudad.carpetas.find((x) => x.id === elegida) ?? null : null;
  useEffect(() => {
    const e = escena.current;
    if (!e) return;
    e.despliegue(armarDespliegue(e));
  });
  // Si la carpeta elegida ya no está (se finalizó), se cierra.
  useEffect(() => { if (elegida && enCiudad && !carpetaElegida) setElegida(null); }, [elegida, enCiudad, carpetaElegida]);
  function armarDespliegue(e: Escena): Despliegue | null {
    if (carpetaElegida) return { ancla: { tipo: "carpeta", id: carpetaElegida.id }, modo: "carpeta", html: htmlCarpeta(carpetaElegida, confirma, hoy) };
    if (!lista) return null;
    if (lista.k === "lugar") {
      if (!enCiudad) return null;
      const todas = e.carpetasDe(lista.clave).map((cp) => enCiudad.carpetas.find((x) => x.id === cp.id) ?? cp);
      const l = lista.color ? todas.filter((x) => x.luz === lista.color) : todas;
      // El tramitador (tocarlo a él o su oficina): primero su contacto, luego los trámites de la ciudad.
      const z = lista.clave.startsWith("aliado-") ? enCiudad.tramitadores[Number(lista.clave.slice(7))] : undefined;
      // La academia: sus trámites en el mapa y, debajo, sus clientes (tocar uno abre su ficha).
      const a = lista.clave.startsWith("academia-") ? enCiudad.academias?.find((x) => `academia-${x.clave}` === lista.clave) : undefined;
      const clientes = a && !lista.color ? titulo(`Sus clientes`, a.clientes.length) + (a.clientes.length ? a.clientes.slice(0, MAX_PILDORAS).map((x, i) => pilCliente(x, i)).join("") : `<span class="vacio">Ninguno todavía.</span>`) : "";
      return { ancla: { tipo: "lugar", clave: lista.clave }, modo: "lista", activo: lista.color ? { attr: "col", valor: lista.color } : undefined, html: pildoras(lista.color ? `${lista.titulo} · ${NOMBRE_LUZ[lista.color]}` : a ? "Sus trámites en el mapa" : lista.titulo, l, undefined, z ? pilTramitador(z, enCiudad.departamento, 0) : "") + clientes };
    }
    const c = buscar(lista.clave);
    if (!c || enCiudad) return null;
    if (lista.k === "color") {
      // En la capa de atrasados, solo los vencidos de ese estado.
      const l = sinLicencias(c.carpetas).filter((x) => x.luz === lista.color && (capa !== "atrasados" || (abierta(x) && x.tono === "rojo")));
      return { ancla: { tipo: "ciudad", clave: c.clave }, modo: "lista", activo: { attr: "col", valor: lista.color }, html: pildoras(capa === "atrasados" ? `Atrasados · ${NOMBRE_LUZ[lista.color]}` : NOMBRE_LUZ[lista.color], l, c.clave) };
    }
    if (lista.k === "todos") return { ancla: { tipo: "ciudad", clave: c.clave }, modo: "lista", activo: { attr: "acc", valor: "todos" }, html: pildoras(`Todos los trámites de ${c.nombre}`, sinLicencias(c.carpetas), c.clave) };
    if (lista.k === "tramitadores") {
      const pils = c.tramitadores.map((z, i) => pilTramitador(z, c.departamento, i));
      if (c.sobres.length) pils.push(`<button type="button" class="pil" data-sobres="${esc(c.clave)}" style="--i:${pils.length}"><span class="ic">${svg(ICONO.sobre, 13)}</span>${(() => { const a = c.sobres.filter((x) => x.activo).length; return a ? plural(a, "envío de hoy", "envíos de hoy") : plural(c.sobres.length, "envío anterior", "envíos anteriores"); })()}</button>`);
      return { ancla: { tipo: "ciudad", clave: c.clave }, modo: "lista", activo: { attr: "acc", valor: "tramitadores" }, html: titulo(c.tramitadores.length > 1 ? "Tramitadores" : "Tramitador", c.tramitadores.length) + (pils.join("") || `<span class="vacio">Sin tramitador en Envíos.</span>`) };
    }
    // Los envíos a la ciudad que se dejaron en el mapa (desde su vena o desde sus tramitadores): los de hoy primero; los
    // anteriores en gris (ya no siguen activos: quedan de constancia).
    const pils = c.sobres.map((s, i) => {
      const env = sobres.find((x) => x.id === s.id);
      const t = env?.tramiteId ? c.tramites.find((x) => x.id === env.tramiteId) : undefined;
      const cp = env?.tramiteId ? c.carpetas.find((x) => x.id === env.tramiteId) : undefined;
      const pie = `<small>${esc(`${s.destinatario} · salió el ${fecha(s.fechaEnvio)}`)}</small>`;
      if (!s.activo) return `<div class="pil env-gris" style="--i:${i}" title="${esc("Ya no está activo: queda como constancia")}"><span class="ic">${svg(ICONO.sobre, 13)}</span>${t ? `<span class="cod">${esc(t.placa ? placaBonita(t.placa) : t.codigo)}</span>` : ""}${pie}</div>`;
      if (t) return `<button type="button" class="pil" data-sobre-ciudad="${esc(c.clave)}" style="--c:${HEX.azul};--i:${i}" title="${esc(`${t.codigo} · ${t.tipo}`)}"><i class="dot ${cp ? cp.luz : "salio"}"></i><span class="cod">${esc(t.placa ? placaBonita(t.placa) : t.codigo)}</span><small>${esc(t.tipo)}</small>${pie}</button>`;
      return `<div class="pil" style="--i:${i}"><span class="ic">${svg(ICONO.sobre, 13)}</span>${pie}</div>`;
    });
    return { ancla: lista.k === "sobres" && lista.desde === "vena" ? { tipo: "vena", clave: c.clave } : { tipo: "ciudad", clave: c.clave }, modo: "lista", activo: lista.desde === "vena" ? { attr: "env", valor: "1" } : { attr: "acc", valor: "tramitadores" }, html: titulo(`Envíos a ${c.nombre}`, c.sobres.length) + pils.join("") };
  }

  // Los toques en lo que flota sobre el 3D (es HTML de la escena: se atienden aquí, por sus data-*).
  const alternar = (l: Lista) => setLista((x) => (mismaLista(x, l) ? null : l));
  function irACarpeta(id: string) {
    if (enCiudad?.carpetas.some((cp) => cp.id === id)) { setElegida(id); setLista(null); setConfirma(null); return; }
    const c = ciudades.find((x) => x.carpetas.some((cp) => cp.id === id));
    if (!c || !escena.current) { nav(`/tramites/${id}`); return; }
    pendiente.current = id;
    setLista(null);
    escena.current?.ir({ tipo: "ciudad", clave: c.clave });
  }
  // Lo recién anotado (por el asistente, desde Registrar): el mapa va a su ciudad y abre su carpeta apenas llega a la
  // copia local. Si en 20 segundos no aparece (un borrador, uno ya finalizado), se olvida.
  const [porMostrar, setPorMostrar] = useState<string[]>(porResaltar);
  useEffect(() => alResaltar(setPorMostrar), []);
  useEffect(() => {
    if (!porMostrar.length) return;
    const t = setTimeout(() => { setPorMostrar([]); yaResaltados(); }, 10_000);
    return () => clearTimeout(t);
  }, [porMostrar]);
  useEffect(() => {
    if (!porMostrar.length || !ciudades.length || !escena.current) return;
    const id = porMostrar.find((x) => ciudades.some((c) => c.carpetas.some((cp) => cp.id === x)));
    if (!id) return;
    setPorMostrar([]); yaResaltados();
    irACarpeta(id);
  });
  async function mover(k: Mover) {
    if (!carpetaElegida) return;
    if (confirma !== k) { setConfirma(k); return; }
    setConfirma(null);
    const a = MOVER.find((x) => x.k === k)!;
    const t = datos?.tramites.find((x) => x.id === carpetaElegida.id);
    if (!t) return;
    const ok = await moverTramite(t, a.estado, ui, null, { sinPreguntar: true });
    if (ok && a.tarjeta) { try { await escribir("PATCH", `/api/tramites/${t.id}`, { estadoTarjeta: a.tarjeta }); } catch (e) { ui.avisar(mensajeDe(e), "error"); } }
  }
  /** Desde lo de arriba: un trámite abierto se muestra en el mapa; uno ya cerrado, en su expediente. */
  const verTramite = (id: string) => (escena.current && ciudades.some((c) => c.carpetas.some((cp) => cp.id === id)) ? irACarpeta(id) : nav(`/tramites/${id}`));
  // El clic derecho sobre una carpeta (3D) o una píldora: las opciones del trámite (abrir, editar, estado, eliminar...).
  const menuTramite = useMenuTramite();
  const menuRef = useRef<(id: string, e: MouseEvent) => void>(() => {});
  menuRef.current = (id, e) => {
    const t = datos?.tramites.find((x) => x.id === id);
    if (!t) return;
    const placa = t.vehiculoId ? datos?.vehiculos.find((v) => v.id === t.vehiculoId)?.placa : null;
    abrirMenu(e, menuTramite(t, { placa }));
  };
  // Clic derecho en una ciudad (su nombre o sus edificios), en un lugar de la ciudad o en el fondo: entrar, salir, sus
  // trámites, su historial. Entrar y salir de una ciudad es solo así o con sus botones: la rueda solo acerca y aleja.
  const verHistorial = (clave: string) => { setFiltro("todos"); setQ(""); setHistorico(clave); };
  const salir: ItemMenu = { texto: "Salir a Colombia", icono: LogOut, accion: () => escena.current?.ir({ tipo: "colombia" }) };
  const menuLugarRef = useRef<(d: { ciudad?: string; lugar?: string }, e: MouseEvent) => void>(() => {});
  menuLugarRef.current = (d, e) => {
    const recentrar: ItemMenu = { texto: "Recentrar la vista", icono: LocateFixed, accion: () => escena.current?.recentrar() };
    if (enCiudad) {
      const l = d.lugar ? escena.current?.carpetasDe(d.lugar) ?? [] : null;
      const titulo = d.lugar ? lugaresHud.find((x) => x.clave === d.lugar)?.titulo ?? NOMBRE_ZONA[d.lugar as Zona] ?? "Este lugar" : "";
      abrirMenu(e, [
        ...(l && d.lugar ? [{ texto: `${titulo}: sus trámites (${l.length})`, icono: List, deshabilitado: !l.length, accion: () => { setElegida(null); setConfirma(null); setLista({ k: "lugar", clave: d.lugar!, titulo }); } } as ItemMenu, "-" as const] : []),
        salir,
        { texto: `Historial completo de ${enCiudad.nombre}`, icono: History, accion: () => verHistorial(enCiudad.clave) },
        recentrar,
      ]);
      return;
    }
    if (d.ciudad) { menuCiudad(d.ciudad, e); return; }
    abrirMenu(e, [recentrar]);
  };
  function menuCiudad(clave: string, e: MouseEvent) {
    const c = buscar(clave);
    if (!c) return;
    const n = sinLicencias(c.carpetas).length;
    abrirMenu(e, [
      enCiudad?.clave === clave ? salir : { texto: `Entrar a ${c.nombre}`, icono: LogIn, accion: () => escena.current?.ir({ tipo: "ciudad", clave }) },
      ...(enCiudad ? [] : [
        { texto: `Sus trámites en el mapa (${n})`, icono: List, deshabilitado: !n, accion: () => { escena.current?.seleccionar(clave); setElegida(null); setLista({ k: "todos", clave }); } } as ItemMenu,
        ...(c.tramitadores.length || c.sobres.length ? [{ texto: c.tramitadores.length > 1 ? "Sus tramitadores" : "Su tramitador", icono: Users, accion: () => { escena.current?.seleccionar(clave); setLista({ k: "tramitadores", clave }); } } as ItemMenu] : []),
      ]),
      { texto: `Historial completo de ${c.nombre} (${c.tramites.length})`, icono: History, accion: () => verHistorial(clave) },
      ...(enCiudad ? [] : ["-" as const, { texto: "Mostrarla en el mapa", icono: LocateFixed, accion: () => escena.current?.seleccionar(clave) } as ItemMenu]),
    ]);
  }
  // Las notas de las carpetas por id (para la burbuja que se abre sobre la placa en el 3D).
  const notasRef = useRef(new Map<string, NotaCorta>());
  notasRef.current = new Map(ciudades.flatMap((c) => c.carpetas.filter((x) => x.nota?.descripcion).map((x) => [x.id, x.nota!] as const)));
  const [notaAbierta, setNotaAbierta] = useState<{ nota: NotaCorta; ancla: DOMRect } | null>(null);
  const tocarRef = useRef<(e: MouseEvent) => void>(() => {});
  tocarRef.current = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-col], [data-acc], [data-env], [data-carpeta], [data-sobres], [data-sobre-ciudad], [data-tabla], [data-mover], [data-abrir], [data-cerrar-carpeta], [data-cliente]");
    if (!b) { if (!(e.target as HTMLElement).closest("[data-mover]")) setConfirma(null); return; }
    e.stopPropagation();
    const d = b.dataset;
    const etq = b.closest<HTMLElement>(".mapa-etq");
    // El lugar es la fila de la placa (una placa puede tener varios lugares).
    const filaLugar = b.closest<HTMLElement>("[data-lugar]");
    const clave = etq?.dataset.clave, lugar = filaLugar?.dataset.lugar;
    if (!d.mover) setConfirma(null);
    if (d.col && lugar) alternar({ k: "lugar", clave: lugar, titulo: filaLugar?.querySelector(".et-card b")?.textContent ?? "", color: d.col as Luz });
    else if (d.col && clave) alternar({ k: "color", clave, color: d.col as Luz });
    else if (d.acc && clave) {
      if (d.acc === "entrar") escena.current?.ir({ tipo: "ciudad", clave });
      else alternar(d.acc === "todos" ? { k: "todos", clave } : { k: "tramitadores", clave });
    } else if (d.env && clave) alternar({ k: "sobres", clave, desde: "vena" });
    else if (d.sobres) setLista({ k: "sobres", clave: d.sobres, desde: "tramitadores" });
    else if (d.carpeta) irACarpeta(d.carpeta);
    else if (d.sobreCiudad) { setLista(null); escena.current?.seleccionar(d.sobreCiudad); }
    else if (d.tabla) { setFiltro("todos"); setQ(""); setHistorico(d.tabla); }
    else if (d.mover) void mover(d.mover as Mover);
    else if (d.abrir) nav(`/tramites/${d.abrir}`);
    else if (d.cerrarCarpeta) setElegida(null);
    else if (d.cliente) abrirVentana("clientes", { ficha: d.cliente });
  };
  useEffect(() => {
    const c = capaDom.current;
    if (!c) return;
    const f = (e: MouseEvent) => tocarRef.current(e);
    const derecho = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const id = el.closest<HTMLElement>("[data-carpeta]")?.dataset.carpeta;
      if (id) { menuRef.current(id, e); return; }
      const etq = el.closest<HTMLElement>(".mapa-etq");
      if (etq?.dataset.clave) menuLugarRef.current({ ciudad: etq.dataset.clave }, e);
      else if (el.closest<HTMLElement>("[data-lugar]")?.dataset.lugar) menuLugarRef.current({ lugar: el.closest<HTMLElement>("[data-lugar]")!.dataset.lugar }, e);
    };
    // La nota de una placa (en las etiquetas y en lo desplegado, que son HTML de la escena): al pasar el mouse se abre.
    const sobreNota = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-nota]");
      const nota = el ? notasRef.current.get(el.dataset.nota ?? "") : undefined;
      setNotaAbierta(el && nota ? { nota, ancla: el.getBoundingClientRect() } : null);
    };
    const fueraNota = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-nota]");
      if (el && !el.contains(e.relatedTarget as Node | null)) setNotaAbierta(null);
    };
    c.addEventListener("click", f);
    c.addEventListener("contextmenu", derecho);
    c.addEventListener("pointerover", sobreNota);
    c.addEventListener("pointerout", fueraNota);
    return () => { c.removeEventListener("click", f); c.removeEventListener("contextmenu", derecho); c.removeEventListener("pointerover", sobreNota); c.removeEventListener("pointerout", fueraNota); };
  }, [geo]);
  // Esc: primero cancela la confirmación, luego cierra lo desplegado y al final suelta la ciudad.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || historico || ver) return;
      if (confirma) setConfirma(null);
      else if (elegida) setElegida(null);
      else if (lista) setLista(null);
      else if (seleccion) escena.current?.seleccionar(null);
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [confirma, elegida, lista, seleccion, historico, ver]);

  // El histórico de una ciudad (la tabla grande), desde una lista larga.
  const hist = historico ? buscar(historico) : null;
  const filasHist = useMemo(() => {
    if (!hist) return [];
    const n = normalizar(q.trim());
    return hist.tramites.filter((t) => pasa(t, filtro) && (!n || normalizar(`${t.codigo} ${t.tipo} ${t.cliente} ${t.placa} ${t.aliado}`).includes(n)));
  }, [hist, filtro, q]);

  // Minimapa: la silueta del país, las ciudades de la capa y lo que se está viendo.
  const mini = useMemo(() => {
    if (!geo) return null;
    const anillos = geo.pais.map((a) => a.map(([lon, lat]) => proyectar(lon, lat)));
    const xs = anillos.flat().map((p) => p.x), zs = anillos.flat().map((p) => p.y);
    const caja = { x: Math.min(...xs) - 0.4, z: Math.min(...zs) - 0.4, w: Math.max(...xs) - Math.min(...xs) + 0.8, h: Math.max(...zs) - Math.min(...zs) + 0.8 };
    return { caja, d: anillos.map((a) => `M${a.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L")}Z`).join("") };
  }, [geo]);
  const miniRef = useRef<SVGSVGElement>(null);
  const irMini = (e: React.MouseEvent<SVGSVGElement>) => {
    const s = miniRef.current, m = s?.getScreenCTM();
    if (!s || !m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    escena.current?.enfocar(p.x, p.y);
  };
  // Los trámites abiertos (sin licencias), los más urgentes primero, con su ciudad: la lista de arriba a la izquierda.
  const abiertosMapa = useMemo(() => {
    const l = ciudades.flatMap((c) => sinLicencias(c.carpetas).filter(abierta).map((cp) => ({ cp, ciudad: c })));
    const orden = new Map(urgentes(l.map((x) => x.cp)).map((cp, i) => [cp.id, i]));
    return l.sort((a, b) => orden.get(a.cp.id)! - orden.get(b.cp.id)!);
  }, [ciudades]);
  // El buscador de la lista (sale cuando son más de 8): por placa, ciudad, código, trámite o cliente.
  const [buscaPlaca, setBuscaPlaca] = useState("");
  const plaquitasVistas = useMemo(() => {
    const ps = normalizar(buscaPlaca).split(/\s+/).filter(Boolean);
    if (!ps.length) return abiertosMapa;
    return abiertosMapa.filter(({ cp, ciudad: c }) => { const t = normalizar(`${cp.placa} ${cp.placa.replace(/\s/g, "")} ${c.nombre} ${cp.codigo} ${cp.tipo} ${cp.titular}`); return ps.every((p) => t.includes(p)); });
  }, [abiertosMapa, buscaPlaca]);
  // Dentro de una ciudad, el HUD de arriba a la izquierda: sus lugares (cada edificio y lo que tiene dentro) con sus
  // trámites debajo. Pasar el mouse resalta el edificio en el 3D; tocar un lugar lo elige, y tocar un trámite abre su
  // carpeta encima de su edificio.
  const lugaresHud = useMemo(() => (enCiudad ? lugaresDe(enCiudad) : []), [enCiudad]);
  const vistaHud = useMemo(() => {
    const ps = normalizar(buscaPlaca).split(/\s+/).filter(Boolean);
    const pasaBusqueda = (cp: Carpeta) => { const t = normalizar(`${cp.placa} ${cp.placa.replace(/\s/g, "")} ${cp.codigo} ${cp.tipo} ${cp.titular}`); return ps.every((p) => t.includes(p)); };
    return lugaresHud.map((l) => ({ ...l, vistas: l.objeto ? [] : urgentes(ps.length ? l.carpetas.filter(pasaBusqueda) : l.carpetas) }));
  }, [lugaresHud, buscaPlaca]);
  const totalHud = lugaresHud.filter((l) => !l.objeto).reduce((s, l) => s + l.carpetas.length, 0);
  const vistosHud = vistaHud.reduce((s, l) => s + l.vistas.length, 0);
  // Lo elegido en el HUD: el lugar desplegado o el de la carpeta abierta.
  const lugarElegido = lista?.k === "lugar" ? lista.clave : carpetaElegida ? lugaresHud.find((l) => !l.objeto && l.carpetas.some((x) => x.id === carpetaElegida.id))?.clave ?? null : null;
  const enCapa = (c: CiudadMapa) => (capa === "abiertos" ? c.stats.abiertos : capa === "atrasados" ? c.stats.atrasados : capa === "cobrar" ? c.stats.porCobrar : c.aliados.length);
  const colorCapa = CAPAS.find((x) => x.capa === capa)?.color ?? HEX.azul;

  return (
    <>
      <div className="contenido mapa-contenido">
        {con3D ? (
          <div className="mapa-lienzo" onPointerDown={(e) => { if (confirma && !(e.target as HTMLElement).closest("[data-mover]")) setConfirma(null); }}>
            <canvas ref={lienzo} tabIndex={0} aria-label={enCiudad ? `${enCiudad.nombre} en 3D` : "Colombia en 3D. Arrastre para moverse, rueda o +/- para acercar, flechas o WASD"} />
            <div ref={capaDom} className="mapa-capa" />

            <div className="mapa-esq ti">
              <nav className="mapa-ruta" aria-label="Dónde está">
                <button className={nivel.tipo === "colombia" ? "on" : ""} onClick={() => escena.current?.ir({ tipo: "colombia" })}>Colombia</button>
                {enCiudad && <><ChevronRight size={13} /><span className="on">{enCiudad.nombre}</span></>}
              </nav>
              {errorGeo && <span className="mapa-nota">{errorGeo}</span>}
              {!enCiudad && sinUbicar.length > 0 && <span className="mapa-nota" title="El nombre de la ciudad se repite en varios departamentos o no se reconoce: póngale el departamento al organismo en Configuración.">Sin ubicar en el mapa: {sinUbicar.map((x) => `${x.ciudad} (${x.n})`).join(", ")}</span>}
              {!enCiudad && supuestas.length > 0 && <span className="mapa-nota" title="El organismo no tiene departamento y hay varias ciudades con ese nombre: se puso en la más poblada. Póngale el departamento al organismo en Configuración.">Ubicadas sin departamento: {supuestas.map((x) => `${x.ciudad} (${x.departamento})`).join(", ")}</span>}
              {enCiudad && lugaresHud.length > 0 && (
                <HudTramites ciudad={enCiudad.nombre} lugares={vistaHud} total={totalHud} vistos={vistosHud} busca={buscaPlaca} setBusca={setBuscaPlaca}
                  elegido={lista?.k === "lugar" ? lista.clave : null} carpeta={elegida}
                  resaltar={(k) => escena.current?.resaltar(k)} soltar={() => escena.current?.lugar(null)}
                  abrir={(id) => irACarpeta(id)} menuCarpeta={(id, e) => menuRef.current(id, e)} />
              )}
              {!enCiudad && abiertosMapa.length > 0 && (
                <div className="mapa-plaquitas" aria-label="Trámites abiertos">
                  <span className="mapa-plaquitas-tit">Trámites abiertos<small>{buscaPlaca.trim() ? `${plaquitasVistas.length} de ${abiertosMapa.length}` : abiertosMapa.length}</small></span>
                  {abiertosMapa.length > 8 && (
                    <div className="buscar mapa-plaquitas-buscar"><Search size={14} /><input className="input" value={buscaPlaca} onChange={(e) => setBuscaPlaca(e.target.value)} placeholder="Placa, ciudad, cliente…" aria-label="Buscar en los trámites abiertos" /></div>
                  )}
                  <div className="mapa-plaquitas-lista">
                    {!plaquitasVistas.length && <span className="mapa-nota">Nada con «{buscaPlaca}».</span>}
                    {plaquitasVistas.map(({ cp, ciudad: c }) => {
                      const col = cp.luz;
                      return (
                        <button key={cp.id} type="button" className="plaquita" title={`${cp.codigo} · ${cp.tipo}${cp.titular ? ` · ${cp.titular}` : ""}\n${[NOMBRE_LUZ[cp.luz], paraOtra(cp), cp.motivo].filter(Boolean).join(" · ")}`}
                          onClick={() => irACarpeta(cp.id)} onContextMenu={(e) => menuRef.current(cp.id, e.nativeEvent)}>
                          {cp.placa ? <span className="placa"><b>{placaBonita(cp.placa)}</b></span> : <span className="placa sin"><b>{cp.codigo}</b></span>}
                          <NotaVistazo b={cp.nota} chica />
                          <span className="plaquita-carta"><i className={`dot ${col}`} />{c.nombre}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <HudMapa capa={setCapa} verTramite={verTramite} fichaVehiculo={(id) => abrirVentana("vehiculos", { ficha: id })} abrir={abrirVentana} />

            <div className="mapa-esq td">
            <div className="mapa-btns" role="group" aria-label="Vista">
              <button aria-label="Acercar" title="Acercar (+)" onClick={() => escena.current?.zoom(0.75)}><Plus size={16} /></button>
              <button aria-label="Alejar" title="Alejar (-)" onClick={() => escena.current?.zoom(1.3)}><Minus size={16} /></button>
              <button aria-label="Recentrar" title="Recentrar" onClick={() => escena.current?.recentrar()}><LocateFixed size={16} /></button>
              <button aria-label="Movimiento" title={liviano ? "Movimiento (apagado en modo liviano)" : "Movimiento: el pulso de las venas y las animaciones"} aria-pressed={movimiento && !liviano} disabled={liviano} onClick={() => { setMovimiento(!movimiento); guardar("mapa-movimiento", movimiento ? "0" : "1"); }}><Activity size={16} /></button>
              <button aria-label="Modo liviano" title="Modo liviano: para un PC lento, sin sombras reales, sin suavizado ni animaciones" aria-pressed={liviano} onClick={() => { setLiviano(!liviano); guardar("mapa-liviano", liviano ? "0" : "1"); }}><Zap size={16} /></button>
            </div>
            <EsquemaCiudades ciudades={ciudades} enCiudad={!!enCiudad} actual={enCiudad?.clave ?? seleccion?.clave ?? null} ir={(clave) => {
              if (enCiudad) { if (clave !== enCiudad.clave) escena.current?.ir({ tipo: "ciudad", clave }); }
              else escena.current?.seleccionar(clave);
            }} />
            {enCiudad && lugaresHud.length > 0 && (
              <HudLugares ciudad={enCiudad.nombre} lugares={vistaHud} elegido={lugarElegido} sobre={sobreLugar}
                resaltar={(k) => escena.current?.resaltar(k)}
                elegir={(k) => { setElegida(null); setConfirma(null); if (lista?.k === "lugar" && lista.clave === k) escena.current?.lugar(null); else escena.current?.lugar(k); }}
                menuLugar={(k, e) => menuLugarRef.current({ lugar: k }, e)} />
            )}
            </div>

            {!enCiudad && (
              <div className="mapa-esq ab">
                <div className="mapa-capas-pil" role="group" aria-label="Capas">
                  {CAPAS.map((k) => <button key={k.capa} aria-pressed={capa === k.capa} data-claro={capa === k.capa ? "" : undefined} onClick={() => setCapa(k.capa)}><i style={{ background: k.color }} />{k.titulo}</button>)}
                </div>
                <div className="mapa-leyenda">{LUCES_MAPA.map((k) => <span key={k}><i className={`dot ${k}`} />{LEYENDA[k]}</span>)}</div>
                <span className="mapa-nota">Clic derecho en una ciudad o en una placa: sus opciones (entrar, ver sus trámites, finalizar...).</span>
              </div>
            )}
            {enCiudad && (
              <div className="mapa-esq ab">
                <div className="mapa-leyenda">{LUCES_MAPA.map((k) => <span key={k}><i className={`dot ${k}`} />{LEYENDA[k]}</span>)}</div>
                <span className="mapa-nota">Pase el mouse por un lugar o un trámite de la lista: su edificio se resalta. Tocar un edificio{enCiudad.aliados.length ? " o al tramitador" : ""}: sus trámites{enCiudad.aliados.length ? " y su contacto" : ""}. Clic derecho: opciones (salir a Colombia, historial).</span>
              </div>
            )}

            {!enCiudad && mini && (
              <svg ref={miniRef} className="mapa-mini" viewBox={`${mini.caja.x} ${mini.caja.z} ${mini.caja.w} ${mini.caja.h}`} onClick={irMini} aria-label="Minimapa: toque para ir a esa zona">
                <path d={mini.d} className="pais" />
                {ciudades.map((c) => { const p = proyectar(c.lon, c.lat); const v = enCapa(c); return <circle key={c.clave} cx={p.x} cy={p.y} r={c.oficina ? 0.28 : v ? 0.2 : 0.11} fill={c.oficina ? "var(--primario)" : v ? colorCapa : "#a8b3c7"} />; })}
                {vista && <polygon points={vista.map(([x, z]) => `${x},${z}`).join(" ")} className="vista" />}
              </svg>
            )}
            {!enCiudad && geo && <div className="mapa-fuentes">{geo.fuentes} · Población: DANE, proyecciones municipales (2026).</div>}

            {ver && <VentanaMapa ver={ver} cerrar={cerrarVentana} abrir={(id) => nav(`/tramites/${id}`)} />}
            {notaAbierta && <GloboNota key={`${notaAbierta.ancla.x},${notaAbierta.ancla.y}`} nota={notaAbierta.nota} ancla={notaAbierta.ancla} />}
          </div>
        ) : (
          <div className="mapa-sin3d">
            <HudMapa capa={setCapa} verTramite={verTramite} fichaVehiculo={(id) => abrirVentana("vehiculos", { ficha: id })} abrir={abrirVentana} />
            {ver && <VentanaMapa ver={ver} cerrar={cerrarVentana} abrir={(id) => nav(`/tramites/${id}`)} />}
            <div className="aviso info">Este computador no puede mostrar 3D: se ve como listas.</div>
            {errorGeo && <div className="aviso error">{errorGeo}</div>}
            <div className="mapa-listas">
              {[...(["vehiculos", "personas", "correccion", "salida", "transito"] as Zona[]).map((z) => ({ titulo: NOMBRE_ZONA[z], lista: (ibague?.carpetas ?? []).filter((c) => c.zona === z) })), ...ciudades.filter((c) => !c.oficina && c.carpetas.some((x) => x.zona === "fuera")).map((c) => ({ titulo: `Tránsito de ${c.nombre}`, lista: c.carpetas.filter((x) => x.zona === "fuera") }))].map(({ titulo: t, lista: l }) => (
                <div key={t} className="card">
                  <div className="card-cab"><b>{t}</b><span className="peq tenue">{l.length}</span></div>
                  <div className="card-cuerpo pila" style={{ gap: 4 }}>
                    {urgentes(l).map((c) => <button key={c.id} className="mapa-item" onClick={() => nav(`/tramites/${c.id}`)}><span className="fila" style={{ gap: 6 }}><i className={`mapa-punto ${c.tono}`} /><b>{c.codigo}</b></span>{c.tipo}<small>{[c.titular, c.placa, c.motivo].filter(Boolean).join(" · ")}</small></button>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Panel
        abierto={!!hist}
        onCerrar={() => setHistorico(null)}
        ancho={780}
        cabecera={hist && <div><h2>Trámites de {hist.nombre}</h2><span className="peq muted">{hist.departamento} · {plural(hist.tramites.length, "trámite", "trámites")}{hist.habituales[0] ? ` · casi siempre con ${hist.habituales[0].nombre}` : ""}</span></div>}
      >
        {hist && (
          <TablaDatos
            idGuardado="mapa-historico"
            reinicio={[q, filtro, historico]}
            filas={filasHist}
            clave={(t) => t.id}
            onFila={(t) => nav(`/tramites/${t.id}`)}
            ordenInicial={{ id: "fecha", dir: -1 }}
            barra={
              <div className="pila" style={{ gap: 8, width: "100%" }}>
                <div className="buscar"><Search size={15} /><input className="input" placeholder="Buscar por número, cliente, placa o aliado" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <div className="fila" role="group" aria-label="Estado" style={{ gap: 6, flexWrap: "wrap" }}>
                  {FILTROS.map(([k, n]) => <button key={k} className={`btn btn-sm${filtro === k ? " btn-primario" : ""}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{n} ({hist.tramites.filter((t) => pasa(t, k)).length})</button>)}
                </div>
              </div>
            }
            vacio={<span className="peq muted">Ningún trámite con ese filtro.</span>}
            columnas={[
              { id: "codigo", titulo: "Trámite", fija: true, valor: (t) => t.codigo, celda: (t) => <div><b>{t.codigo}</b><small className="tenue" style={{ display: "block" }}>{t.tipo}</small></div> },
              { id: "cliente", titulo: "Cliente", valor: (t) => t.cliente, celda: (t) => <div>{t.cliente || <span className="sin-dato">Sin dato</span>}{t.placa && <small className="tenue" style={{ display: "block" }}>{t.placa}</small>}</div> },
              { id: "fecha", titulo: "Estado y fecha", valor: (t) => t.creado, celda: (t) => <div><Badge tono={TONO_SEMAFORO[ESTADO_TRAMITE_COLOR[t.estado]]} punto>{ESTADO_TRAMITE_LABEL[t.estado]}</Badge><small className="tenue" style={{ display: "block" }}>{t.entrega ? `Entregado ${fecha(t.entrega)}` : `Recibido ${fecha(t.creado.slice(0, 10))}`}</small></div> },
              { id: "aliado", titulo: "Aliado", oculta: true, valor: (t) => t.aliado, celda: (t) => t.aliado || <span className="sin-dato">Sin dato</span> },
              { id: "saldo", titulo: "Saldo", oculta: true, alinear: "der", valor: (t) => t.saldo, celda: (t) => (t.saldo ? pesos(t.saldo) : "—") },
            ]}
          />
        )}
      </Panel>
    </>
  );
}


const TITULO_VENTANA: Record<Ventana, string> = { clientes: "Clientes", vehiculos: "Vehículos", registrar: "Registrar un trámite" };
/**
 * Clientes, vehículos o registrar un trámite, encima del mapa (sin salir de él). Lo registrado aquí se ve en el mapa
 * al guardar: si no dejó avisos que leer, la ventana se cierra sola y el mapa va hasta él.
 */
function VentanaMapa({ ver, cerrar, abrir }: { ver: Ventana; cerrar: () => void; abrir: (id: string) => void }) {
  return (
    <div className="mapa-ventana" role="dialog" aria-label={TITULO_VENTANA[ver]}>
      <div className="mapa-ventana-barra">
        <button type="button" className="btn btn-sm" onClick={cerrar}><ArrowLeft size={14} />Volver al mapa</button>
        <span className="peq tenue">{TITULO_VENTANA[ver]} sin salir del mapa</span>
      </div>
      <div className="mapa-ventana-cuerpo">
        {ver === "clientes" && <Clientes />}
        {ver === "vehiculos" && <Vehiculos />}
        {ver === "registrar" && (
          <div className="contenido" style={{ maxWidth: 980 }}>
            <h2 style={{ margin: 0 }}>Registrar desde documentos</h2>
            <span className="peq muted">Suba las fotos de lo que tenga del trámite: se lee todo y usted confirma antes de guardar. Al guardarlo, se ve en el mapa.</span>
            <Registrador abrir={abrir} alGuardar={(r) => {
              sincronizarAhora().catch(() => {});
              resaltarEnMapa(r.ids);
              if (!r.avisos?.length) cerrar();
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * El esquema de las ciudades (arriba a la derecha, debajo de los botones): cada ciudad es un punto en su dirección
 * desde Ibagué, como con lupa (las cercanas se separan y las lejanas se acercan, para que quepan todas y se lean), con su
 * nombre si tiene trámites abiertos (o es la oficina). Tocarla lleva el mapa hasta ella (dentro de una ciudad, entra a la
 * otra). Se pliega, y queda como se dejó.
 */
function EsquemaCiudades({ ciudades, enCiudad, actual, ir }: { ciudades: CiudadMapa[]; enCiudad: boolean; actual: string | null; ir: (clave: string) => void }) {
  const [enColombia, setEnColombia] = useState(() => leer("mapa-esquema", "1") === "1");
  // Dentro de una ciudad empieza plegado (no tapa las placas de la derecha); se abre con un toque, solo esa vez.
  const [enLaCiudad, setEnLaCiudad] = useState(false);
  useEffect(() => setEnLaCiudad(false), [enCiudad]);
  const abierto = enCiudad ? enLaCiudad : enColombia;
  const esquema = useMemo(() => {
    if (!ciudades.length) return null;
    const of = ciudades.find((c) => c.oficina) ?? ciudades[0];
    const o = proyectar(of.lon, of.lat);
    // Con lupa: la misma dirección desde Ibagué, la distancia en escala logarítmica.
    const ps = ciudades.map((c) => {
      const p = proyectar(c.lon, c.lat), dx = p.x - o.x, dy = p.y - o.y, r = Math.hypot(dx, dy), k = r ? Math.log1p(r / 0.18) / r : 0;
      return { c, n: sinLicencias(c.carpetas).length, px: dx * k, py: dy * k };
    });
    const x0 = Math.min(...ps.map((q) => q.px)), x1 = Math.max(...ps.map((q) => q.px)), y0 = Math.min(...ps.map((q) => q.py)), y1 = Math.max(...ps.map((q) => q.py));
    const W = 260, H = 220, margen = 12;
    // Misma escala en los dos ejes (que no se deforme); a la derecha, espacio para los nombres.
    const esc = Math.min((W - margen * 2 - 60) / Math.max(0.01, x1 - x0), (H - margen * 2) / Math.max(0.01, y1 - y0));
    const puntos = ps.map(({ c, n, px, py }) => ({ c, n, x: margen + (px - x0) * esc, y: margen + (py - y0) * esc }));
    // Los nombres: primero la oficina y las de más trámites; si uno se monta sobre otro ya puesto, no va.
    const puestos: [number, number, number, number][] = [];
    const nombres = new Map<string, "der" | "izq">();
    for (const q of [...puntos].filter((q) => q.c.oficina || q.n).sort((a, b) => Number(!!b.c.oficina) - Number(!!a.c.oficina) || b.n - a.n)) {
      const w = q.c.nombre.length * 5.7 + 4;
      for (const lado of ["der", "izq"] as const) {
        const r: [number, number, number, number] = lado === "der" ? [q.x + 4, q.y - 7, q.x + 4 + w, q.y + 6] : [q.x - 4 - w, q.y - 7, q.x - 4, q.y + 6];
        if (r[0] < 0 || r[2] > W) continue;
        if (puestos.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) continue;
        puestos.push(r); nombres.set(q.c.clave, lado); break;
      }
    }
    return { W, H, puntos, nombres };
  }, [ciudades]);
  if (!esquema) return null;
  const plegar = () => { if (enCiudad) { setEnLaCiudad(!abierto); return; } setEnColombia(!abierto); guardar("mapa-esquema", abierto ? "0" : "1"); };
  return (
    <div className="mapa-esquema">
      <button type="button" className="mapa-esquema-cab" aria-expanded={abierto} onClick={plegar}>Ciudades<ChevronDown size={13} /></button>
      {abierto && (
        <div className="mapa-esquema-caja" style={{ width: esquema.W, height: esquema.H }} role="group" aria-label="Ir a una ciudad">
          {esquema.puntos.map(({ c, n, x, y }) => {
            const lado = esquema.nombres.get(c.clave);
            return (
              <button key={c.clave} type="button" className={`mapa-esquema-c${c.oficina ? " oficina" : ""}${n ? " con" : ""}${actual === c.clave ? " on" : ""}${lado === "izq" ? " izq" : ""}`}
                style={{ left: x, top: y }} onClick={() => ir(c.clave)} title={`${c.nombre}${n ? ` · ${n} abierto${n === 1 ? "" : "s"}` : ""}`} aria-label={`Ir a ${c.nombre}`}>
                <i />{lado && <span>{c.nombre}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Un trámite del HUD de la ciudad: su placa (o su licencia), su nota y una carta con su estado y su tipo. */
function PlaquitaCiudad({ cp, i = 0, on, resaltar, abrir, menu }: { cp: Carpeta; i?: number; on: boolean; resaltar: () => void; abrir: () => void; menu: (e: MouseEvent) => void }) {
  return (
    <button type="button" className={`plaquita${on ? " on" : ""}`} style={{ "--i": i } as React.CSSProperties} title={`${cp.codigo} · ${cp.tipo}${cp.titular ? ` · ${cp.titular}` : ""}\n${[NOMBRE_LUZ[cp.luz], paraOtra(cp), abierta(cp) ? cp.motivo : ""].filter(Boolean).join(" · ")}`}
      onMouseEnter={resaltar} onFocus={resaltar} onClick={abrir} onContextMenu={(e) => menu(e.nativeEvent)}>
      {cp.categoria === "licencia"
        ? <span className="licencia-mini"><i /><b>{(cp.categorias ?? "").split(",").filter(Boolean).join(" ") || "LIC"}</b></span>
        : cp.placa ? <span className="placa"><b>{placaBonita(cp.placa)}</b></span> : <span className="placa sin"><b>{cp.codigo}</b></span>}
      <NotaVistazo b={cp.nota} chica />
      <span className="plaquita-carta"><i className={`dot ${cp.luz}`} /><small>{cp.tipo}</small>{cp.dias && <span className={`dias ${cp.dias.clase}`}>{cp.dias.texto}</span>}</span>
    </button>
  );
}

type LugarHud = LugarCiudad & { vistas: Carpeta[] };
/** Las carpetas que se ven de un lugar: las suyas o, si es un edificio con lugares adentro (la oficina), las de ellos. */
const deLugar = (l: LugarHud, todos: LugarHud[]) => {
  const hijos = todos.filter((x) => x.edificio === l.clave);
  return hijos.length ? hijos.flatMap((h) => h.vistas) : l.objeto ? l.carpetas : l.vistas;
};

/**
 * Arriba a la izquierda: los trámites de la ciudad (sus placas), agrupados por lugar. Si hay un edificio elegido, solo
 * los suyos (con "Ver todos"). Al pasar el mouse por uno, su edificio se resalta en el 3D; al tocarlo, se abre su carpeta.
 */
function HudTramites({ ciudad, lugares, total, vistos, busca, setBusca, elegido, carpeta, resaltar, soltar, abrir, menuCarpeta }: {
  ciudad: string; lugares: LugarHud[]; total: number; vistos: number; busca: string; setBusca: (v: string) => void;
  elegido: string | null; carpeta: string | null;
  resaltar: (clave: string | null) => void; soltar: () => void; abrir: (id: string) => void; menuCarpeta: (id: string, e: MouseEvent) => void;
}) {
  const buscando = !!busca.trim();
  const sel = elegido ? lugares.find((l) => l.clave === elegido) : undefined;
  // Los grupos: el lugar elegido (solo él) o todos los que tienen trámites, sin repetir los de la academia o el tramitador.
  const grupos = sel
    ? [{ l: sel, cps: deLugar(sel, lugares) }]
    : lugares.filter((l) => !l.objeto && l.vistas.length).map((l) => ({ l, cps: l.vistas }));
  const n = grupos.reduce((s, g) => s + g.cps.length, 0);
  return (
    <section className="hud-panel hud-tramites" aria-label={`Trámites de ${ciudad}`} onMouseLeave={() => resaltar(null)}>
      <div className="hud-panel-cab">
        <b>Trámites en {ciudad}</b>
        <small>{sel ? `${n} de ${total}` : buscando ? `${vistos} de ${total}` : total}</small>
      </div>
      {sel && (
        <div className="hud-filtro" style={{ "--c": sel.color } as React.CSSProperties}>
          <span className="pl-ic" dangerouslySetInnerHTML={{ __html: svg(sel.icono, 11) }} /><span>{sel.titulo}</span>
          <button type="button" className="btn btn-sm btn-fantasma" onClick={soltar}>Ver todos</button>
        </div>
      )}
      {total > 8 && (
        <div className="buscar hud-buscar"><Search size={14} /><input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Placa, cliente, trámite…" aria-label="Buscar en los trámites de la ciudad" /></div>
      )}
      <div className="hud-panel-lista">
        {!n && <span className="peq tenue" style={{ padding: "4px 2px" }}>{buscando ? `Nada con «${busca}».` : sel ? "Sin trámites aquí." : "Sin trámites en esta ciudad."}</span>}
        {grupos.filter((g) => g.cps.length).map(({ l, cps }, gi) => (
          <div key={l.clave} className="hud-grupo" style={{ "--c": l.color, "--i": gi } as React.CSSProperties}>
            {!sel && <span className="hud-grupo-tit" onMouseEnter={() => resaltar(l.clave)}><i />{l.titulo}<small>{cps.length}</small></span>}
            {cps.map((cp, i) => (
              <PlaquitaCiudad key={cp.id} cp={cp} i={i} on={carpeta === cp.id} resaltar={() => resaltar(lugares.find((x) => !x.objeto && x.carpetas.some((y) => y.id === cp.id))?.clave ?? l.clave)} abrir={() => abrir(cp.id)} menu={(e) => menuCarpeta(cp.id, e)} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * A la derecha: los edificios de la ciudad (como tarjetas), con los lugares que tienen adentro. Al pasar el mouse se
 * resalta el edificio en el 3D (y al revés: el que tiene el mouse encima se marca aquí); al tocarlo, se elige: se
 * despliegan sus trámites junto al edificio y la lista de la izquierda muestra solo los suyos.
 */
function HudLugares({ ciudad, lugares, elegido, sobre, resaltar, elegir, menuLugar }: {
  ciudad: string; lugares: LugarHud[]; elegido: string | null; sobre: string | null;
  resaltar: (clave: string | null) => void; elegir: (clave: string) => void; menuLugar: (clave: string, e: MouseEvent) => void;
}) {
  let i = 0;
  const fila = (l: LugarHud, hijo: boolean) => (
    <div key={l.clave} className={`hud-lugar${hijo ? " hijo" : ""}${l.carpetas.length || l.objeto ? "" : " hud-vacio"}${elegido === l.clave ? " on" : ""}${sobre === l.clave ? " sobre" : ""}`} style={{ "--c": l.color, "--i": i++ } as React.CSSProperties} data-hud-lugar={l.clave}>
      <button type="button" className="hud-cab" aria-pressed={elegido === l.clave} title={`${l.titulo}: ver dónde está y sus trámites`}
        onMouseEnter={() => resaltar(l.clave)} onFocus={() => resaltar(l.clave)} onClick={() => elegir(l.clave)} onContextMenu={(e) => { e.preventDefault(); menuLugar(l.clave, e.nativeEvent); }}>
        <span className="pl-ic" dangerouslySetInnerHTML={{ __html: svg(l.icono, hijo ? 12 : 14) }} />
        <b>{l.titulo}</b>
        {!l.clave.startsWith("aliado-") && <small>{l.carpetas.length}</small>}
        {l.nota && <span className="hud-nota">{l.nota}</span>}
      </button>
    </div>
  );
  return (
    <section className="hud-panel hud-lugares" aria-label={`Lugares de ${ciudad}`} onMouseLeave={() => resaltar(null)}>
      <div className="hud-panel-cab"><b>Lugares</b><small>{lugares.filter((l) => !l.edificio).length}</small></div>
      <div className="hud-panel-lista">
        {lugares.filter((l) => !l.edificio).map((l) => {
          const hijos = lugares.filter((x) => x.edificio === l.clave);
          return hijos.length ? (
            <div key={l.clave} className="hud-edificio" style={{ "--c": l.color } as React.CSSProperties}>
              {fila(l, false)}
              <div className="hud-hijos">{hijos.map((h) => fila(h, true))}</div>
            </div>
          ) : fila(l, false);
        })}
      </div>
    </section>
  );
}
