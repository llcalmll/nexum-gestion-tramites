import { Bookmark, BookmarkCheck, Bot, Camera, Check, ChevronLeft, Copy, Eraser, ExternalLink, FileText, Globe2, History, Inbox, Loader2, MessageSquare, Mic, Paperclip, Pencil, Send, Sparkles, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BotonPegar } from "./Pegar";
import { useLocation, useNavigate } from "react-router-dom";
import type { ContenidoResumen, ItemResumen } from "../../compartido/esquema";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { escribir, mensajeDe } from "../datos/escribir";
import { prepararFoto } from "../logica/foto";
import { recortarTarjeta } from "../logica/recorteTarjeta";
import { alVencer } from "../datos/sesion";
import { CLASES_HOJA, type HojaLeida } from "../../compartido/registro";
import { armarCotizacion, CotizadorTarjetas, type Catalogo, type FormCotizacion } from "./Cotizador";
import { type CotizacionDatos, CotizacionEditable, sinCotizacion, textoCotizacion, totalCotizacion, VistaTarjeta } from "./CotizacionEditable";
import { textoClienteDeTexto } from "../logica/tablaCotizacion";
import { leerHoja, Registrador, type Hoja } from "./Registrador";
import { sincronizarAhora } from "../datos/sincronizacion";
import { resaltarEnMapa } from "../datos/resaltar";

interface Propuesta { id: string; tipo: string; titulo: string; metodo: "POST" | "PATCH"; ruta: string; cuerpo: Record<string, unknown> }
interface Accion { titulo: string; tramiteId?: string }
interface Mensaje {
  rol: "yo" | "ia"; texto: string; acciones?: Accion[]; propuestas?: (Propuesta & { estado?: "hecha" | "descartada" | "error" | "vencida"; error?: string })[];
  /** Id de la cotización guardada (pestaña Cotizaciones) a la que corresponde este mensaje. */
  guardada?: string;
  /**
   * Las cotizaciones de este mensaje como datos: se muestran editables (en lugar de en el texto). `extra`: lo que dijo
   * el asistente sin la cotización; `texto` se rehace con lo editado (lo ve el asistente si se le pregunta después).
   * `cambiada`: se editó después de guardarla.
   */
  cotizaciones?: CotizacionDatos[];
  extra?: string;
  cambiada?: boolean;
  /** Las vistas previas de las tarjetas de propiedad de la cotización (guardadas con ella en R2), por placa. */
  tarjetas?: { placa: string; src: string }[];
}
interface Cotizacion { id: string; titulo: string; tramite: string | null; total: number; texto: string; origen: "fotos" | "asistente"; creado: string }
type Pestana = "chat" | "cotizaciones" | "bandeja" | "historial";
/** Una conversación guardada (en la lista de anteriores). */
interface ConversacionGuardada { id: string; titulo: string; cantidad: number; actualizado: string }
interface Resumen { fecha: string; contenido: ContenidoResumen; leido: boolean }
/** Foto de una tarjeta de propiedad adjunta para cotizar: se lee al adjuntarla. */
/** Una foto adjunta: se lee al adjuntarla (qué hoja es y qué trae). Tarjetas para cotizar, o las hojas de un trámite para registrarlo. */
interface Tarjeta { id: number; estado: "leyendo" | "lista" | "error"; foto?: string; lectura?: HojaLeida; error?: string }
/** Los datos de una tarjeta de propiedad como los usa el cotizador. */
const datosTarjeta = (l?: HojaLeida): Record<string, string> => ({
  placa: l?.vehiculo?.placa ?? "", marca: l?.vehiculo?.marca ?? "", linea: l?.vehiculo?.linea ?? "", modeloAnio: l?.vehiculo?.modelo ?? "",
  cilindraje: l?.vehiculo?.cilindraje ?? "", clase: l?.vehiculo?.clase ?? "", organismoTransito: l?.organismo ?? "",
});
/** Lo que dice el chip de una foto adjunta. */
function nombreAdjunto(l?: HojaLeida) {
  if (!l) return "";
  if (l.clase === "tarjeta_propiedad") return `${l.vehiculo?.placa || "Sin placa"} · ${[l.vehiculo?.marca, l.vehiculo?.modelo].filter(Boolean).join(" ")}`;
  const quien = l.personas?.[0] ? (l.personas[0].nombres ?? l.personas[0].nombreCompleto ?? "").split(" ")[0] : "";
  return [CLASES_HOJA.find((c) => c.clase === l.clase)?.nombre, quien].filter(Boolean).join(" · ");
}
/** "cotiza", "cuánto vale", "precio": las tarjetas son para cotizar. */
const PIDE_COTIZAR = /(cotiz|cu[aá]nto (vale|cuesta|sale|cobr)|precio)/i;
/** "¿debe comparendos?", "revísame esta placa", "¿tiene el SOAT vigente?": las fotos son para consultar (el asistente con PlacApi). */
const PIDE_CONSULTA = /(comparend|multa|simit|debe|deuda|paz y salvo|soat|tecno|runt|revis|verific|consult|embarg|prenda|vigente|vencid|licencia)/i;
/** Lo leído de una foto, en una línea, para que el asistente lo use (la cédula, la placa, el dueño...). */
function textoDeHoja(l?: HojaLeida) {
  if (!l) return "";
  const persona = (p?: NonNullable<HojaLeida["personas"]>[number]) => p ? [p.nombreCompleto ?? [p.nombres, p.apellidos].filter(Boolean).join(" "), p.numeroDocumento && `${p.tipoDocumento || "CC"} ${p.numeroDocumento}`].filter(Boolean).join(", ") : "";
  const nombre = CLASES_HOJA.find((c) => c.clase === l.clase)?.nombre ?? "Hoja";
  if (l.clase === "tarjeta_propiedad") return `${nombre}: placa ${l.vehiculo?.placa ?? "sin leer"}, ${[l.vehiculo?.marca, l.vehiculo?.linea, l.vehiculo?.modelo].filter(Boolean).join(" ")}${l.personas?.[0] ? `, dueño ${persona(l.personas[0])}` : ""}${l.organismo ? `, matriculada en ${l.organismo}` : ""}`;
  const quienes = (l.personas ?? []).map((p) => `${p.rol ? `${p.rol} ` : ""}${persona(p)}`).filter(Boolean).join("; ");
  return `${nombre}: ${[l.vehiculo?.placa && `placa ${l.vehiculo.placa}`, quienes, l.tramites?.length && l.tramites.join(", ")].filter(Boolean).join(" · ") || "sin datos"}`;
}
/**
 * "guárdame este trámite", "regístralo", "anótalo"...: las fotos son para registrar, no para cotizar. También con la
 * letra comida al escribir rápido ("aótame", "regitra"): con "Aotame esta renovación" se fue al asistente.
 */
const PIDE_REGISTRAR = /(guard|re[gj][ií]?s?tr|a[nñ]?[oó]t[aá]|agr[eé]g|crea|ingres|sube|subir|mete|carg)/i;
/**
 * "Adjúntale también este recibo a ese mismo trámite", "pégale esta foto al L-2026-00192", "súbela al de la ABC123":
 * las fotos van a un trámite que ya existe (no es uno nuevo). Hace falta la orden y a cuál.
 */
const PIDE_ADJUNTAR = /\b(adj[uú]nt|p[eé]g|agr[eé]g|m[eé]t|s[uú]b|gu[aá]rd)\w*/i;
const A_UN_TRAMITE = /(\ba (es[ea]|est[ea]) (mism[oa] )?(tr[aá]mite|licencia|renovaci|refrendaci|traspaso|migraci)|\bmism[oa] tr[aá]mite|\bal (mismo|anterior|tr[aá]mite (anterior|de arriba|que))|\banterior\b|\bah[ií](?=$|[\s.,;!?])|de arriba|que (acab|hicimos|registr|anot)|\b[TL]-?\s?\d{4}-?\s?\d{1,6}\b)/i;
/** Una placa: pegada ("abc123") o, con espacio o guion, en mayúsculas ("ABC 123"): "por 100" no es una placa. */
const placaEn = (t: string) => { const m = /\b([A-Za-z]{3})(\d{2}[A-Za-z0-9])\b/.exec(t) ?? /\b([A-Z]{3})[\s-](\d{2}[A-Z0-9])\b/.exec(t); return m ? `${m[1]}${m[2]}`.toUpperCase() : null; };
/** "L-2026-00192", "l 2026 192" -> { serie, anio, numero }. */
function codigoEn(t: string) {
  const m = /\b([TL])-?\s?(\d{4})-?\s?(\d{1,6})\b/i.exec(t);
  return m ? { serie: m[1].toUpperCase(), anio: m[2], numero: Number(m[3]) } : null;
}
const dato = (d: Record<string, string | string[]> | undefined, k: string) => (typeof d?.[k] === "string" ? (d[k] as string) : "");
/** "ABC123 · RENAULT LOGAN, modelo 2018, matriculado en Ibagué" (lo que se le manda al asistente). */
function describirTarjeta(d: Record<string, string | string[]> | undefined): string {
  const v = [dato(d, "marca"), dato(d, "linea")].filter(Boolean).join(" ");
  return [`placa ${dato(d, "placa") || "sin leer"}`, v, dato(d, "modeloAnio") && `modelo ${dato(d, "modeloAnio")}`, dato(d, "cilindraje") && `cilindraje ${dato(d, "cilindraje")} cc`, dato(d, "clase"), dato(d, "organismoTransito") && `matriculado en ${dato(d, "organismoTransito")}`].filter(Boolean).join(", ");
}
let siguienteTarjeta = 1;

const CLAVE = "asistente-conversacion";
const CLAVE_VOZ = "asistente-leer-en-voz-alta";
const SUGERENCIAS = ["¿Qué tengo pendiente hoy?", "¿Quién me debe plata?", "¿Qué trámites tiene la placa…?", "Requisitos y costos de un traspaso en Ibagué"];
/** La bandeja se revisa al abrir la app y cada 15 minutos (una lectura; el resumen se arma una vez al día). */
const REVISAR_BANDEJA_MS = 15 * 10_000;
const MAX_GRABACION_S = 120;

/** La conversación abierta en esta pestaña (cada una queda guardada en el servidor con este id). */
const CLAVE_ID = "asistente-conversacion-id";
function idGuardado(): string {
  try { const id = sessionStorage.getItem(CLAVE_ID); if (id) return id; } catch { /* sin almacenamiento */ }
  return crypto.randomUUID();
}
/** Al volver a una conversación vieja, lo que quedó sin confirmar ya no se confirma (pudo cambiar): se pide de nuevo. */
const reabrir = (ms: Mensaje[]): Mensaje[] => ms.map((m) => (m.propuestas?.some((p) => !p.estado || p.estado === "error")
  ? { ...m, propuestas: m.propuestas.map((p) => (!p.estado || p.estado === "error" ? { ...p, estado: "vencida" as const } : p)) } : m));

function leer(): Mensaje[] {
  try { return JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]"); } catch { return []; }
}
function leerPreferencia(clave: string) {
  try { return localStorage.getItem(clave) === "1"; } catch { return false; }
}

/** Negritas (**así**) y saltos de línea; nada más. */
function Texto({ t }: { t: string }) {
  const partes: ReactNode[] = [];
  t.split("\n").forEach((linea, i) => {
    if (i) partes.push(<br key={`br${i}`} />);
    linea.split(/(\*\*[^*]+\*\*)/).forEach((p, j) => partes.push(p.startsWith("**") && p.endsWith("**") ? <b key={`${i}-${j}`}>{p.slice(2, -2)}</b> : p));
  });
  return <>{partes}</>;
}

/** Lee en voz alta con la voz del sistema (gratis, sin servidor). Prefiere español de Colombia. */
function hablar(texto: string) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto.replace(/\*\*/g, "").replace(/([TL])-(\d{4})-0*(\d+)/g, (_x, s: string, _a: string, n: string) => `${s === "L" ? "licencia" : "trámite"} ${n}`));
  const voces = speechSynthesis.getVoices();
  const voz = voces.find((v) => v.lang === "es-CO") ?? voces.find((v) => v.lang.startsWith("es-") && /natural|online/i.test(v.name)) ?? voces.find((v) => v.lang.startsWith("es"));
  if (voz) u.voice = voz;
  u.lang = voz?.lang ?? "es-CO";
  speechSynthesis.speak(u);
}

const sinNegritas = (t: string) => t.replace(/\*\*/g, "");
/** Una respuesta con valores en pesos se puede guardar como cotización. */
const pareceCotizacion = (t: string) => /\$\s?\d{1,3}(\.\d{3})+/.test(t);
/** El último "Total ...: $1.234.567" de la respuesta, en número. */
function totalDe(t: string) {
  const m = [...sinNegritas(t).matchAll(/total[^\n$]*\$\s?([\d.]+)/gi)].pop();
  return m ? Number(m[1].replace(/\./g, "")) || 0 : 0;
}
const fechaCorta = (iso: string) => new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const nombreDia = (fecha: string, hoy: string) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  const corta = `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  return fecha === hoy ? `Hoy, ${DIAS[d.getUTCDay()]} ${corta}` : `${DIAS[d.getUTCDay()][0].toUpperCase()}${DIAS[d.getUTCDay()].slice(1)} ${corta}`;
};

/** Graba del micrófono (webm/opus en Chrome y Edge, mp4 en Safari) y lo pasa a texto en el servidor. */
function useGrabadora(alTexto: (t: string) => void, alError: (m: string) => void) {
  const [estado, setEstado] = useState<"quieto" | "grabando" | "transcribiendo">("quieto");
  const [segundos, setSegundos] = useState(0);
  const grabador = useRef<MediaRecorder | null>(null);
  const cancelado = useRef(false);

  const detener = useCallback((cancelar = false) => {
    cancelado.current = cancelar;
    if (grabador.current?.state === "recording") grabador.current.stop();
  }, []);

  const empezar = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return alError("Este navegador no permite grabar audio.");
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return alError("No hay permiso para el micrófono: permítalo en el candado de la barra de direcciones y vuelva a intentar.");
    }
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const r = new MediaRecorder(flujo, tipo ? { mimeType: tipo, audioBitsPerSecond: 10_000 } : undefined);
    const partes: Blob[] = [];
    cancelado.current = false;
    r.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    r.onstop = async () => {
      flujo.getTracks().forEach((t) => t.stop());
      grabador.current = null;
      if (cancelado.current) { setEstado("quieto"); return; }
      setEstado("transcribiendo");
      try {
        const audio = new Blob(partes, { type: (r.mimeType || tipo || "audio/webm").split(";")[0] });
        const { texto } = await api<{ texto: string }>("/api/asistente/voz", { method: "POST", headers: { "Content-Type": audio.type }, body: audio });
        alTexto(texto);
      } catch (e) {
        if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
        alError(e instanceof SinConexion ? "Sin conexión: la voz necesita internet." : mensajeDe(e));
      } finally {
        setEstado("quieto");
      }
    };
    grabador.current = r;
    r.start();
    setSegundos(0);
    setEstado("grabando");
  }, [alTexto, alError]);

  useEffect(() => {
    if (estado !== "grabando") return;
    const t = setInterval(() => setSegundos((s) => {
      if (s + 1 >= MAX_GRABACION_S) detener();
      return s + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [estado, detener]);
  useEffect(() => () => detener(true), [detener]);

  return { estado, segundos, empezar, detener };
}

/** Qué está viendo Felipe: el mapa (Colombia o dentro de una ciudad) u otra pantalla. Va con cada mensaje. */
function contextoPantalla(ruta: string): { pantalla: string; ciudad?: string } {
  if (ruta !== "/" && ruta !== "/mapa") return { pantalla: ruta };
  try {
    const n = JSON.parse(sessionStorage.getItem("mapa-nivel") || "null") as { tipo: string; clave?: string } | null;
    if (n?.tipo === "ciudad" && n.clave) return { pantalla: "mapa", ciudad: n.clave === "ibague" ? "Ibagué (la oficina)" : n.clave.split("|")[0] };
  } catch { /* nada guardado */ }
  return { pantalla: "mapa" };
}

/**
 * Asistente interno. Tres pestañas:
 * - Conversación: consulta los datos y, si se lo pide, hace cambios sencillos él mismo (notas, estados,
 *   precondiciones, recordatorios); los pagos los deja para confirmar. Se le puede hablar con el micrófono.
 * - Cotizaciones: las guardadas (las de fotos de tarjetas se guardan solas; las de texto, con un botón). Desde ahí
 *   se retoma una en la conversación.
 * - Bandeja: el resumen de las 6:30 a. m. con todo lo pendiente (un solo aviso al día, sin ráfagas).
 *
 * `movil`: dentro de la app del celular, a pantalla completa y siempre abierto; sin la copia local (todo va
 * directo a la API) ni enlaces a pantallas del PC.
 */
export function Asistente({ movil, volver }: { movil?: boolean; volver?: () => void } = {}) {
  const navegar = useNavigate();
  const ruta = useLocation().pathname;
  /** Lo nuevo que se anotó: el mapa va hasta él (si está en el mapa, ya mismo; si no, al abrirlo). */
  const verEnMapa = (ids: string[]) => { resaltarEnMapa(ids); if (ruta !== "/" && ruta !== "/mapa") navegar("/"); };
  const [abierto, setAbierto] = useState(!!movil);
  const [pestana, setPestana] = useState<Pestana>("chat");
  const [mensajes, setMensajes] = useState<Mensaje[]>(leer);
  const [conversacionId, setConversacionId] = useState(idGuardado);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leerEnVoz, setLeerEnVoz] = useState(() => leerPreferencia(CLAVE_VOZ));
  const [bandeja, setBandeja] = useState<{ hoy: string; resumenes: Resumen[] } | null>(null);
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  /** La tarjeta de propiedad recortada de cada foto adjunta (por su id): la vista previa al cotizar. null: no se pudo. */
  const [recortes, setRecortes] = useState<Record<number, { foto: string; encuadrada: boolean } | null>>({});
  /** El registro de un trámite desde las fotos adjuntas (formulario en la conversación). */
  const [registro, setRegistro] = useState<{ hojas: Hoja[]; texto: string } | null>(null);
  const [encima, setEncima] = useState(false);
  const archivoTarjetas = useRef<HTMLInputElement>(null);
  const camaraTarjetas = useRef<HTMLInputElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const textoRef = useRef(texto);
  textoRef.current = texto;

  useEffect(() => { try { sessionStorage.setItem(CLAVE, JSON.stringify(mensajes.slice(-40))); } catch { /* sin almacenamiento */ } }, [mensajes]);
  useEffect(() => { try { sessionStorage.setItem(CLAVE_ID, conversacionId); } catch { /* sin almacenamiento */ } }, [conversacionId]);
  // Cada conversación queda guardada en el servidor (se ve desde el PC y el celular), un momento después del último
  // mensaje. Sin internet no pasa nada: se guarda con el siguiente.
  useEffect(() => {
    if (!mensajes.length || pensando) return;
    const t = setTimeout(() => { api(`/api/conversaciones/${conversacionId}`, { method: "PUT", body: JSON.stringify({ mensajes }) }).catch(() => { /* se reintenta con el siguiente mensaje */ }); }, 1500);
    return () => clearTimeout(t);
  }, [mensajes, pensando, conversacionId]);
  /** Otra conversación: la de ahora queda guardada en "Conversaciones anteriores". */
  const nueva = () => { setMensajes([]); setError(null); setConversacionId(crypto.randomUUID()); };
  async function abrirConversacion(id: string) {
    setError(null);
    try {
      const c = await api<{ id: string; mensajes: Mensaje[] }>(`/api/conversaciones/${id}`);
      setMensajes(reabrir(c.mensajes)); setConversacionId(c.id); setPestana("chat");
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: las conversaciones anteriores necesitan internet." : mensajeDe(e));
      setPestana("chat");
    }
  }
  useEffect(() => { try { localStorage.setItem(CLAVE_VOZ, leerEnVoz ? "1" : "0"); } catch { /* sin almacenamiento */ } if (!leerEnVoz && "speechSynthesis" in window) speechSynthesis.cancel(); }, [leerEnVoz]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: "smooth" }); }, [mensajes, pensando, abierto, pestana]);

  // Bandeja: al abrir la app, cada 15 minutos y al volver a la pestaña.
  const revisarBandeja = useCallback(async () => {
    try { setBandeja(await api<{ hoy: string; resumenes: Resumen[] }>("/api/bandeja")); } catch { /* la bandeja no es crítica: se reintenta luego */ }
  }, []);
  useEffect(() => {
    revisarBandeja();
    const t = setInterval(() => { if (!document.hidden) revisarBandeja(); }, REVISAR_BANDEJA_MS);
    const alVolver = () => { if (!document.hidden) revisarBandeja(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, [revisarBandeja]);
  const deHoy = bandeja?.resumenes.find((r) => r.fecha === bandeja.hoy);
  const sinLeer = deHoy && !deHoy.leido ? deHoy.contenido.secciones.reduce((n, s) => n + s.items.length, 0) || 1 : 0;

  // Al ver la bandeja, el resumen de hoy queda leído.
  useEffect(() => {
    if (!abierto || pestana !== "bandeja" || !deHoy || deHoy.leido) return;
    setBandeja((b) => b && { ...b, resumenes: b.resumenes.map((r) => (r.fecha === deHoy.fecha ? { ...r, leido: true } : r)) });
    api(`/api/bandeja/${deHoy.fecha}`, { method: "PATCH", body: JSON.stringify({ leido: true }) }).catch(() => {});
  }, [abierto, pestana, deHoy]);

  /** Fotos de tarjetas de propiedad para cotizar: se leen de una vez (varias a la vez) y quedan listas para enviar. */
  function adjuntar(archivos: File[]) {
    const fotos = archivos.filter((a) => a.type.startsWith("image/"));
    if (!fotos.length) return;
    setPestana("chat");
    for (const archivo of fotos) {
      const id = siguienteTarjeta++;
      setTarjetas((t) => [...t, { id, estado: "leyendo" }]);
      (async () => {
        try {
          const foto = await prepararFoto(archivo);
          setTarjetas((t) => t.map((x) => (x.id === id ? { ...x, foto } : x)));
          const { lectura, foto: derecha } = await leerHoja(foto);
          setTarjetas((t) => t.map((x) => (x.id === id ? { ...x, estado: "lista", lectura, foto: derecha } : x)));
          // La vista previa de la tarjeta (para cotizar): recortada con el modelo de encuadre, sin esperar.
          if (lectura.clase === "tarjeta_propiedad") recortarTarjeta(derecha).then((r) => setRecortes((m) => ({ ...m, [id]: r })), () => setRecortes((m) => ({ ...m, [id]: null })));
        } catch (e) {
          setTarjetas((t) => t.map((x) => (x.id === id ? { ...x, estado: "error", error: mensajeDe(e) } : x)));
        }
      })();
    }
  }
  const listas = tarjetas.filter((t) => t.estado === "lista");
  const leyendo = tarjetas.some((t) => t.estado === "leyendo");

  /**
   * Cotización por fotos de tarjetas, como un tramitador: primero se confirman los trámites, los datos de cada
   * vehículo, el organismo y el precio de venta (formulario); luego se calcula exacto y sin IA. Queda en la
   * conversación (y en Cotizaciones) para poder preguntarle al asistente sobre ella.
   */
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [cotizador, setCotizador] = useState<FormCotizacion | null>(null);
  async function abrirCotizador(t: string) {
    const leidos = listas.map((x) => datosTarjeta(x.lectura));
    setError(null); setPestana("chat");
    setPensando(true);
    try {
      const cat = catalogo ?? await api<Catalogo>("/api/movil/catalogo");
      setCatalogo(cat);
      const form = armarCotizacion(cat, t, leidos);
      form.vehiculos.forEach((v, i) => { v.tarjeta = listas[i]?.id; });
      setCotizador(form);
      // Las tarjetas leídas se quitan de la caja solo cuando el formulario ya abrió: si falla la red, siguen ahí.
      setTarjetas([]); setTexto("");
      setMensajes((m) => [...m, { rol: "yo", texto: `${t || "Cotizar"}: ${leidos.length} tarjeta${leidos.length === 1 ? "" : "s"} (${leidos.map((d) => d.placa || "sin placa").join(", ")})` }]);
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: la cotización necesita internet." : mensajeDe(e));
    } finally { setPensando(false); }
  }
  async function cotizarConfirmado() {
    if (!cotizador) return;
    setError(null);
    setPensando(true);
    try {
      const r = await api<{ id: string; texto: string; editables?: CotizacionDatos[] }>("/api/cotizar", {
        method: "POST",
        body: JSON.stringify({
          tipo_ids: cotizador.tipoIds,
          vehiculos: cotizador.vehiculos.map((v) => ({ placa: v.placa, marca: v.marca, linea: v.linea, modelo: v.modelo, cilindraje: v.cilindraje, clase: v.clase, organismo_id: v.organismoId, precio_venta: v.precio || null })),
        }),
      });
      // Las vistas previas de las tarjetas quedan con la cotización (si alguna no sube, la cotización sigue igual).
      const vistas = await subirTarjetas(r.id, cotizador.vehiculos);
      setCotizador(null);
      const cots = r.editables?.length ? r.editables : undefined;
      setMensajes((m) => [...m, { rol: "ia", texto: r.texto, guardada: r.id, ...(vistas.length ? { tarjetas: vistas } : {}), ...(cots ? { cotizaciones: cots, extra: sinCotizacion(r.texto, cots) } : {}) }]);
      if (leerEnVoz) hablar(r.texto);
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: la cotización necesita internet." : mensajeDe(e));
    } finally { setPensando(false); }
  }

  /**
   * Pega las fotos adjuntas a un trámite que ya existe: el que nombra (su código o su placa) o, si dice "ese", "el
   * mismo", "el anterior", el último del que se habló en esta conversación. Cada foto queda como un documento del
   * trámite (con el nombre de lo que es: Recibo de pago, Cédula de...). Si no se sabe cuál, lo pregunta.
   */
  async function adjuntarAlTramite(t: string) {
    setError(null); setPestana("chat"); setCotizador(null);
    const fotos = [...listas];
    const yo: Mensaje = { rol: "yo", texto: `${t}: ${fotos.length} hoja${fotos.length === 1 ? "" : "s"} (${fotos.map((x) => nombreAdjunto(x.lectura)).join(", ")})` };
    setMensajes((m) => [...m, yo]);
    setTexto(""); setPensando(true);
    try {
      let destino: { id: string; codigo: string } | null = null;
      const codigo = codigoEn(t);
      const placa = placaEn(t);
      const buscar = async (q: string) => (await api<{ tramites: { id: string; codigo: string; placa: string | null }[] }>(`/api/movil/tramites?ver=todos&q=${encodeURIComponent(q)}`)).tramites;
      if (codigo) {
        const lista = await buscar(`${codigo.serie}-${codigo.anio}-${codigo.numero}`);
        destino = lista.find((x) => { const c = codigoEn(x.codigo); return !!c && c.serie === codigo.serie && c.anio === codigo.anio && c.numero === codigo.numero; }) ?? null;
        if (!destino) throw new Error(`No encontré el ${codigo.serie}-${codigo.anio}-${String(codigo.numero).padStart(5, "0")}.`);
      } else if (placa) {
        const p = placa;
        const lista = (await buscar(p)).filter((x) => x.placa === p);
        if (lista.length > 1) throw new Error(`La placa ${p} tiene ${lista.length} trámites abiertos (${lista.map((x) => x.codigo).join(", ")}): dígame el número.`);
        destino = lista[0] ?? null;
        if (!destino) throw new Error(`La placa ${p} no tiene trámites abiertos: dígame el número del trámite.`);
      } else {
        // "Ese mismo": el último trámite que salió en esta conversación (el que se acaba de registrar...).
        const ultimo = [...mensajes].reverse().flatMap((m) => [...(m.acciones ?? [])].reverse()).find((a) => a.tramiteId);
        if (ultimo?.tramiteId) destino = { id: ultimo.tramiteId, codigo: /^([TL]-\d{4}-\d+)/.exec(ultimo.titulo)?.[1] ?? "el trámite" };
      }
      if (!destino) {
        setMensajes((m) => [...m, { rol: "ia", texto: "¿A cuál trámite se las pego? Escriba su número (L-2026-00192) o la placa, con las fotos todavía adjuntas." }]);
        return;
      }
      const hechos: string[] = [];
      for (const x of fotos) {
        const l = x.lectura;
        const clase = CLASES_HOJA.find((c) => c.clase === l?.clase)?.nombre ?? "Documento";
        const quien = (l?.clase === "cedula" || l?.clase === "licencia_conduccion") && l.personas?.[0] ? (l.personas[0].nombreCompleto ?? [l.personas[0].nombres, l.personas[0].apellidos].filter(Boolean).join(" ")) : "";
        const nombre = quien ? `${clase} de ${quien}` : clase;
        const { id } = await api<{ id: string }>(`/api/tramites/${destino.id}/documentos`, { method: "POST", body: JSON.stringify({ tipoDocumento: nombre, origen: "asistente" }) });
        const blob = await (await fetch(x.foto!)).blob();
        await api(`/api/documentos/${id}/archivo`, { method: "PUT", headers: { "Content-Type": blob.type || "image/jpeg", "X-Nombre-Archivo": encodeURIComponent(`${nombre}.jpg`) }, body: blob });
        hechos.push(nombre);
      }
      setTarjetas([]);
      setMensajes((m) => [...m, { rol: "ia", texto: `Listo: quedó en ${destino!.codigo} ${hechos.length === 1 ? `el documento «${hechos[0]}»` : `${hechos.length} documentos: ${hechos.map((h) => `«${h}»`).join(", ")}`}.`, acciones: [{ titulo: `${destino!.codigo}: documentos pegados`, tramiteId: destino!.id }] }]);
      if (!movil) sincronizarAhora().catch(() => {});
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setMensajes((m) => [...m, { rol: "ia", texto: `No las pegué: ${e instanceof SinConexion ? "sin conexión." : mensajeDe(e)} Las fotos siguen adjuntas.` }]);
    } finally { setPensando(false); }
  }

  function abrirRegistro(t: string) {
    setError(null); setPestana("chat"); setCotizador(null);
    setRegistro({ hojas: listas.map((x) => ({ clave: x.id, foto: x.foto!, estado: "lista", lectura: x.lectura })), texto: t });
    setMensajes((m) => [...m, { rol: "yo", texto: `${t || "Registrar"}: ${listas.length} hoja${listas.length === 1 ? "" : "s"} (${listas.map((x) => nombreAdjunto(x.lectura)).join(", ")})` }]);
    setTarjetas([]); setTexto("");
  }

  async function enviar(contenido = texto) {
    const t = contenido.trim();
    if ((!t && !listas.length) || pensando || leyendo) return;
    // Fotos adjuntas, según lo que pide: guardar/registrar -> el registro; cotizar (solo tarjetas) -> el cotizador; una
    // pregunta (comparendos, SOAT, revisar...) -> el asistente con lo leído de las fotos; sin decir nada, tarjetas solas
    // -> cotizar, y otras hojas -> registrar.
    if (listas.length) {
      const soloTarjetas = listas.every((x) => x.lectura?.clase === "tarjeta_propiedad");
      if (PIDE_ADJUNTAR.test(t) && (A_UN_TRAMITE.test(t) || placaEn(t))) return adjuntarAlTramite(t);
      if (PIDE_REGISTRAR.test(t)) return abrirRegistro(t);
      if (PIDE_COTIZAR.test(t) && soloTarjetas) return abrirCotizador(t);
      if (!PIDE_CONSULTA.test(t)) return soloTarjetas ? abrirCotizador(t) : abrirRegistro(t);
    }
    setError(null);
    setTexto("");
    setPestana("chat");
    // Las fotos adjuntas van leídas, como texto, con la pregunta.
    const conFotos = listas.length ? `${t}\n\nFotos adjuntas (leídas):\n${listas.map((x) => `- ${textoDeHoja(x.lectura)}`).join("\n")}` : t;
    if (listas.length) setTarjetas([]);
    const nuevos: Mensaje[] = [...mensajes, { rol: "yo", texto: conFotos }];
    setMensajes(nuevos);
    setPensando(true);
    try {
      const r = await api<{ respuesta: string; propuestas: Propuesta[]; acciones?: Accion[]; cotizaciones?: CotizacionDatos[] }>("/api/asistente", {
        method: "POST",
        body: JSON.stringify({ mensajes: nuevos.slice(-16).map((m) => ({ rol: m.rol, texto: m.texto })), contexto: movil ? undefined : contextoPantalla(ruta) }),
      });
      const acciones = r.acciones ?? [];
      const respuesta = r.respuesta || (acciones.length ? "Listo." : r.propuestas.length ? "Te dejo esto para confirmar:" : "…");
      const cots = r.cotizaciones?.length ? r.cotizaciones : undefined;
      setMensajes((m) => [...m, { rol: "ia", texto: respuesta, acciones, propuestas: r.propuestas, ...(cots ? { cotizaciones: cots, extra: sinCotizacion(respuesta, cots) } : {}) }]);
      if (leerEnVoz) hablar(respuesta);
      // Lo que hizo el asistente ya está en el servidor: se trae a la copia local para que la pantalla lo muestre.
      if (acciones.length && !movil) sincronizarAhora().catch(() => {});
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: el asistente necesita internet." : mensajeDe(e));
    } finally {
      setPensando(false);
    }
  }

  // Lo dictado se suma a lo que ya hay escrito (por ejemplo, la referencia de un trámite de la bandeja) y se envía.
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  const voz = useGrabadora(
    useCallback((t: string) => { const previo = textoRef.current; void enviarRef.current(`${previo}${previo && !/\s$/.test(previo) ? " " : ""}${t}`); }, []),
    useCallback((m: string) => setError(m), []),
  );

  async function decidir(i: number, p: Propuesta, confirmar: boolean) {
    const poner = (cambios: Partial<NonNullable<Mensaje["propuestas"]>[number]>) =>
      setMensajes((ms) => ms.map((m, k) => (k === i ? { ...m, propuestas: m.propuestas?.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)) } : m)));
    if (!confirmar) return poner({ estado: "descartada" });
    try {
      const cuerpo = { ...p.cuerpo, origen: "asistente" };
      // En el celular no hay copia local: va directo a la API.
      const r = movil ? await api<Record<string, unknown>>(p.ruta, { method: p.metodo, body: JSON.stringify(cuerpo) }) : await escribir(p.metodo, p.ruta, cuerpo);
      poner({ estado: "hecha", error: undefined });
      // Un trámite nuevo: queda dicho con su número y, en el PC, el mapa va hasta él.
      if (p.tipo === "tramite" && Array.isArray(r?.ids)) {
        const ids = r.ids as string[], numeros = (r.numeros as string[] | undefined) ?? [], avisos = (r.avisos as string[] | undefined) ?? [];
        setMensajes((m) => [...m, { rol: "ia", texto: `Listo: quedó anotado ${numeros.join(" y ")} en Recibido.${avisos.length ? `\n\n${avisos.map((a) => `- ${a}`).join("\n")}` : ""}`, acciones: ids.slice(0, 1).map((id) => ({ titulo: `${numeros[0] ?? "Trámite"}: anotado por el asistente`, tramiteId: id })) }]);
        if (!movil) verEnMapa(ids);
      }
    } catch (e) {
      poner({ estado: "error", error: mensajeDe(e) });
    }
  }

  /** Guarda una respuesta del asistente en la pestaña Cotizaciones (título: lo que se le preguntó). */
  const [guardando, setGuardando] = useState<number | null>(null);
  async function guardarCotizacion(i: number) {
    const m = mensajes[i];
    const pregunta = [...mensajes.slice(0, i)].reverse().find((x) => x.rol === "yo")?.texto ?? "";
    const titulo = (pregunta || sinNegritas(m.texto).split("\n")[0]).replace(/\s+/g, " ").trim().slice(0, 120) || "Cotización";
    setGuardando(i);
    try {
      const total = m.cotizaciones ? m.cotizaciones.reduce((s, c) => s + totalCotizacion(c), 0) : totalDe(m.texto);
      if (m.guardada) await api(`/api/cotizaciones/${m.guardada}`, { method: "PATCH", body: JSON.stringify({ texto: m.texto, total }) });
      const id = m.guardada ?? (await api<{ id: string }>("/api/cotizaciones", { method: "POST", body: JSON.stringify({ titulo, texto: m.texto, total, origen: "asistente" }) })).id;
      setMensajes((ms) => ms.map((x, k) => (k === i ? { ...x, guardada: id, cambiada: false } : x)));
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(mensajeDe(e));
    } finally { setGuardando(null); }
  }

  /** Sube la tarjeta recortada de cada vehículo a la cotización guardada; devuelve las que quedaron (placa y dirección). */
  async function subirTarjetas(id: string, vehiculos: FormCotizacion["vehiculos"]) {
    const vistas = await Promise.all(vehiculos.slice(0, 10).map(async (v, n) => {
      const r = v.tarjeta === undefined ? null : recortes[v.tarjeta];
      if (!r) return null;
      try {
        const placa = v.placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const res = await fetch(`/api/cotizaciones/${id}/tarjetas/${n}?placa=${placa}`, { method: "PUT", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "image/jpeg" }, body: await (await fetch(r.foto)).blob() });
        return res.ok ? { placa, src: `/api/cotizaciones/${id}/tarjetas/${n}` } : null;
      } catch { return null; }
    }));
    return vistas.filter((x): x is { placa: string; src: string } => !!x);
  }

  /** Al editar una cotización del mensaje: el texto del mensaje se rehace con los valores nuevos. */
  function cambiarCotizacion(i: number, k: number, c: CotizacionDatos) {
    setMensajes((ms) => ms.map((m, j) => {
      if (j !== i || !m.cotizaciones) return m;
      const cots = m.cotizaciones.map((x, q) => (q === k ? c : x));
      const texto = [m.extra ?? "", ...cots.map((x, q) => textoCotizacion(x, cots.length > 1 ? q + 1 : 0))].filter(Boolean).join("\n\n");
      return { ...m, cotizaciones: cots, texto, cambiada: !!m.guardada };
    }));
  }
  /** Desde Cotizaciones: la trae a la conversación para seguir hablando sobre ella. */
  function conversarSobre(c: Cotizacion) {
    setMensajes((m) => [...m, { rol: "ia", texto: `Retomemos la cotización guardada **${c.titulo}** (${fechaCorta(c.creado)}):\n\n${c.texto}`, guardada: c.id }]);
    setError(null);
    setPestana("chat");
    setTimeout(() => entrada.current?.focus(), 50);
  }

  /** Desde la bandeja: deja escrita la referencia del trámite para completarla (o dictarla) y mandársela al asistente. */
  function decirSobre(item: ItemResumen) {
    setTexto(item.referencia ?? `${item.texto}: `);
    setPestana("chat");
    setTimeout(() => { entrada.current?.focus(); entrada.current?.setSelectionRange(entrada.current.value.length, entrada.current.value.length); }, 50);
  }

  if (!abierto && !movil) {
    return (
      <button className="fab-asistente" onClick={() => { setAbierto(true); if (sinLeer) setPestana("bandeja"); }} title={sinLeer ? "Asistente: tiene el resumen de hoy sin leer" : "Asistente"}>
        <IconoRobot tamano={17} />Asistente
        {sinLeer > 0 && <span className="contador" aria-label={`${sinLeer} pendientes en la bandeja`}>{sinLeer > 99 ? "99+" : sinLeer}</span>}
      </button>
    );
  }
  return (
    <aside className={`asistente${movil ? " movil" : ""}${encima ? " encima" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setEncima(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setEncima(false); }}
      onDrop={(e) => { e.preventDefault(); setEncima(false); adjuntar([...e.dataTransfer.files]); }}>
      <div className="asistente-cab">
        {movil && volver && <button className="btn btn-sm btn-fantasma btn-icono" onClick={() => { voz.detener(true); volver(); }} aria-label="Volver"><ChevronLeft size={18} /></button>}
        <IconoRobot tamano={20} color="var(--primario)" />
        <div style={{ flex: 1 }}><b>Asistente</b><div className="peq tenue">Pregunta, pide cambios o háblale</div></div>
        <button className={`btn btn-sm btn-fantasma btn-icono${leerEnVoz ? " activo" : ""}`} title={leerEnVoz ? "Dejar de leer las respuestas en voz alta" : "Leer las respuestas en voz alta"} aria-pressed={leerEnVoz} onClick={() => setLeerEnVoz((v) => !v)}>{leerEnVoz ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
        <button className={`btn btn-sm btn-fantasma btn-icono${pestana === "historial" ? " activo" : ""}`} title="Conversaciones anteriores" aria-label="Conversaciones anteriores" aria-pressed={pestana === "historial"} onClick={() => setPestana((p) => (p === "historial" ? "chat" : "historial"))}><History size={15} /></button>
        {pestana === "chat" && mensajes.length > 0 && <button className="btn btn-sm btn-fantasma btn-icono" title="Nueva conversación (esta queda en las anteriores)" aria-label="Nueva conversación" onClick={nueva}><Eraser size={15} /></button>}
        {!movil && <button className="btn btn-sm btn-fantasma btn-icono" title="Cerrar" onClick={() => { setAbierto(false); voz.detener(true); }}><X size={16} /></button>}
      </div>
      <div className="asistente-tabs" role="tablist">
        <button role="tab" aria-selected={pestana === "chat"} className={pestana === "chat" ? "on" : ""} onClick={() => setPestana("chat")}><MessageSquare size={14} />Conversación</button>
        <button role="tab" aria-selected={pestana === "cotizaciones"} className={pestana === "cotizaciones" ? "on" : ""} onClick={() => setPestana("cotizaciones")}><FileText size={14} />Cotizaciones</button>
        <button role="tab" aria-selected={pestana === "bandeja"} className={pestana === "bandeja" ? "on" : ""} onClick={() => setPestana("bandeja")}><Inbox size={14} />Bandeja{sinLeer > 0 && <span className="contador">{sinLeer > 99 ? "99+" : sinLeer}</span>}</button>
      </div>

      {pestana === "historial" ? (
        <ConversacionesAnteriores actual={mensajes.length ? conversacionId : null} abrir={abrirConversacion} nueva={() => { nueva(); setPestana("chat"); }} />
      ) : pestana === "cotizaciones" ? (
        <ListaCotizaciones conversar={conversarSobre} />
      ) : pestana === "bandeja" ? (
        <div className="asistente-chat bandeja">
          {!bandeja ? <div className="peq tenue"><Loader2 size={13} className="girando" /> Cargando la bandeja…</div>
            : !bandeja.resumenes.length ? <div className="peq muted">Aquí llega cada mañana, a las 6:30, el resumen de lo pendiente: trámites de días anteriores que siguen abiertos, recordatorios y cobros. El primero llega mañana.</div>
            : bandeja.resumenes.map((r) => <ResumenDia key={r.fecha} r={r} hoy={bandeja.hoy} abrir={movil ? undefined : (id) => navegar(`/tramites/${id}`)} recordatorios={movil ? undefined : () => navegar("/recordatorios")} decir={decirSobre} />)}
        </div>
      ) : (
        <div className="asistente-chat" ref={chat}>
          {!mensajes.length && (
            <div className="pila" style={{ gap: 8 }}>
              <div className="peq muted">Pregúntame por clientes, placas, trámites, cobros o requisitos. También puedo hacer cambios: "el trámite de la placa ABC123 ya salió, apruébale todo y finalízalo". Toca el micrófono para hablarme, o adjunta (o arrastra) fotos: tarjetas de propiedad para cotizarlas, o las hojas de un trámite (formulario, cédulas, el sobre, o el recibo de pago de una licencia) con "guárdame este trámite" o "regístrame esta refrendación" para registrarlo.</div>
              <div className="fila-wrap" style={{ gap: 6 }}>
                {SUGERENCIAS.map((s) => <button key={s} className="btn btn-sm" onClick={() => (s.endsWith("…?") ? setTexto(s.replace("…?", " ")) : enviar(s))}>{s}</button>)}
              </div>
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} className="pila" style={{ gap: 6, alignItems: m.rol === "yo" ? "flex-end" : "flex-start" }}>
              {m.cotizaciones?.length ? (
                <>
                  {m.extra && <div className="burbuja ia"><Texto t={m.extra} /></div>}
                  {m.cotizaciones.map((c, k) => <CotizacionEditable key={k} c={c} n={m.cotizaciones!.length > 1 ? k + 1 : 0} cambiar={(nc) => cambiarCotizacion(i, k, nc)} tarjeta={tarjetaDe(m, c, k)} />)}
                </>
              ) : <div className={`burbuja ${m.rol === "yo" ? "yo" : "ia"}`}><Texto t={m.texto} /></div>}
              {m.rol === "ia" && (m.guardada && !m.cambiada
                ? <span className="peq tenue guardada"><BookmarkCheck size={13} />Guardada en Cotizaciones</span>
                : (m.cotizaciones?.length || pareceCotizacion(m.texto)) && <button className="btn btn-sm btn-fantasma" disabled={guardando === i} onClick={() => guardarCotizacion(i)}>{guardando === i ? <Loader2 size={13} className="girando" /> : <Bookmark size={13} />}{m.guardada ? "Guardar los cambios" : "Guardar como cotización"}</button>)}
              {m.acciones?.map((a, k) => (
                <div key={k} className="bloque-ia accion-hecha" style={{ alignSelf: "stretch" }}>
                  <Check size={14} className="accion-icono" />
                  <span className="peq" style={{ flex: 1 }}>{a.titulo}</span>
                  {a.tramiteId && !movil && <button className="btn btn-sm btn-fantasma" onClick={() => verEnMapa([a.tramiteId!])} title="Mostrarlo en el mapa (si está abierto)"><Globe2 size={13} />Mapa</button>}
                  {a.tramiteId && !movil && <button className="btn btn-sm btn-fantasma" onClick={() => navegar(`/tramites/${a.tramiteId}`)} title="Abrir el trámite"><ExternalLink size={13} />Abrir</button>}
                </div>
              ))}
              {m.propuestas?.map((p) => (
                <div key={p.id} className="bloque-ia propuesta" style={{ alignSelf: "stretch" }}>
                  <div className="peq" style={{ marginBottom: 8 }}>{p.titulo}</div>
                  {p.estado === "hecha" ? <span className="peq" style={{ color: "var(--verde)" }}><Check size={13} /> Hecho</span>
                    : p.estado === "descartada" ? <span className="peq tenue">Descartada</span>
                    : p.estado === "vencida" ? <span className="peq tenue">De una conversación anterior: ya no se confirma desde aquí (pudo cambiar). Pídamelo de nuevo si todavía aplica.</span>
                    : (
                      <div className="fila" style={{ gap: 6 }}>
                        <button className="btn btn-sm btn-primario" onClick={() => decidir(i, p, true)}>Confirmar</button>
                        <button className="btn btn-sm" onClick={() => decidir(i, p, false)}>Descartar</button>
                        {p.estado === "error" && <span className="peq" style={{ color: "var(--rojo)" }}>{p.error}</span>}
                      </div>
                    )}
                </div>
              ))}
            </div>
          ))}
          {registro && (
            <Registrador inicial={registro.hojas} texto={registro.texto} movil={movil} armarDeUna cancelar={() => setRegistro(null)}
              alGuardar={(r) => {
                setRegistro(null);
                setMensajes((m) => [...m, { rol: "ia", texto: `Listo: quedó registrado ${r.numeros.join(" y ")}.${r.avisos?.length ? `\n\n${r.avisos.map((a) => `- ${a}`).join("\n")}` : ""}`, acciones: r.ids.map((id, k) => ({ titulo: `${r.numeros[k] ?? "Trámite"}: registrado desde los documentos`, tramiteId: id })) }]);
                if (!movil) { sincronizarAhora().catch(() => {}); verEnMapa(r.ids); }
              }} />
          )}
          {cotizador && catalogo && <CotizadorTarjetas cat={catalogo} form={cotizador} cambiar={setCotizador} cotizar={cotizarConfirmado} cancelar={() => setCotizador(null)} cotizando={pensando} recortes={recortes} />}
          {pensando && <div className="burbuja ia"><span className="pensando"><span className="puntos"><i /><i /><i /></span>Consultando…</span></div>}
          {error && <div className="aviso error">{error}</div>}
        </div>
      )}

      <div className="asistente-pie">
        {voz.estado === "grabando" ? (
          <div className="grabando">
            <span className="grabando-punto" aria-hidden />
            <span style={{ flex: 1 }}>Escuchando… {Math.floor(voz.segundos / 60)}:{String(voz.segundos % 60).padStart(2, "0")}{texto ? <span className="peq tenue"> · se suma a lo escrito</span> : null}</span>
            <button className="btn btn-sm" onClick={() => voz.detener(true)}>Cancelar</button>
            <button className="btn btn-sm btn-primario" onClick={() => voz.detener()} title="Terminar y enviar"><Square size={12} />Enviar</button>
          </div>
        ) : (
          <div className="pila" style={{ gap: 6 }}>
          {tarjetas.length > 0 && (
            <div className="adjuntos" aria-label="Fotos adjuntas">
              {tarjetas.map((x) => (
                <span key={x.id} className={`adjunto ${x.estado}`} title={x.estado === "error" ? x.error : x.estado === "lista" && x.lectura?.clase === "tarjeta_propiedad" ? describirTarjeta(datosTarjeta(x.lectura)) : undefined}>
                  {x.estado === "leyendo" ? <><Loader2 size={12} className="girando" />Leyendo…</> : x.estado === "error" ? "No se pudo leer" : nombreAdjunto(x.lectura)}
                  <button aria-label="Quitar foto" onClick={() => setTarjetas((t) => t.filter((y) => y.id !== x.id))}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="fila">
            <input ref={archivoTarjetas} type="file" accept="image/*" multiple hidden aria-label="Adjuntar fotos de tarjetas de propiedad" onChange={(e) => { adjuntar([...(e.target.files ?? [])]); e.target.value = ""; }} />
            {movil && <>
              <input ref={camaraTarjetas} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto de una tarjeta de propiedad" onChange={(e) => { adjuntar([...(e.target.files ?? [])]); e.target.value = ""; }} />
              <button className="btn btn-icono" title="Tomar foto de una tarjeta de propiedad para cotizar" aria-label="Tomar foto de tarjeta" disabled={pensando} onClick={() => camaraTarjetas.current?.click()}><Camera size={16} /></button>
            </>}
            <button className="btn btn-icono" title="Adjuntar fotos: tarjetas de propiedad para cotizar, o las hojas de un trámite para registrarlo (también puede arrastrarlas o pegarlas)" aria-label="Adjuntar tarjetas" disabled={pensando} onClick={() => archivoTarjetas.current?.click()}><Paperclip size={16} /></button>
            {!movil && <BotonPegar soloIcono className="btn btn-icono" disabled={pensando} recibir={(f) => adjuntar(f)} alError={setError} />}
            <textarea ref={entrada} className="input" style={{ minHeight: 40, maxHeight: 120 }} placeholder={voz.estado === "transcribiendo" ? "Pasando el audio a texto…" : "Escribe o toca el micrófono…"} value={texto} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} disabled={voz.estado === "transcribiendo"}
              onPaste={(e) => { const fotos = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/")); if (fotos.length) { e.preventDefault(); adjuntar(fotos); } }} />
            <button className="btn btn-icono" title="Hablarle al asistente" aria-label="Hablarle al asistente" disabled={pensando || voz.estado === "transcribiendo"} onClick={() => { setError(null); voz.empezar(); }}>
              {voz.estado === "transcribiendo" ? <Loader2 size={16} className="girando" /> : <Mic size={16} />}
            </button>
            <button className="btn btn-primario btn-icono" title={leyendo ? "Esperando a que se lean las fotos" : "Enviar (Enter)"} aria-label="Enviar" disabled={pensando || leyendo || (!texto.trim() && !listas.length)} onClick={() => enviar()}><Send size={16} /></button>
          </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Robot con chispas: el ícono del asistente. */
function IconoRobot({ tamano, color }: { tamano: number; color?: string }) {
  return (
    <span className="icono-robot" style={{ color }} aria-hidden>
      <Bot size={tamano} />
      <Sparkles size={Math.round(tamano * 0.55)} className="icono-robot-chispa" />
    </span>
  );
}

function ResumenDia({ r, hoy, abrir, recordatorios, decir }: { r: Resumen; hoy: string; abrir?: (id: string) => void; recordatorios?: () => void; decir: (i: ItemResumen) => void }) {
  const [abierto, setAbierto] = useState(r.fecha === hoy);
  const total = r.contenido.secciones.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="bloque-ia resumen-dia">
      <button className="resumen-cab" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <b>{nombreDia(r.fecha, hoy)}</b>
        <span className="peq tenue">{total} pendiente{total === 1 ? "" : "s"}</span>
      </button>
      {abierto && (
        <div className="pila" style={{ gap: 10, marginTop: 8 }}>
          <div className="peq">{r.contenido.saludo}</div>
          {r.contenido.secciones.map((s) => (
            <div key={s.clave} className="pila" style={{ gap: 4 }}>
              <div className="resumen-seccion">{s.titulo} <span className="tenue">({s.items.length})</span></div>
              {s.items.map((it, k) => (
                <div key={k} className="resumen-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="resumen-texto">{it.texto}</div>
                    {it.detalle && <div className="peq tenue">{it.detalle}</div>}
                  </div>
                  <div className="fila" style={{ gap: 4 }}>
                    {it.tramiteId && abrir && <button className="btn btn-sm btn-fantasma" onClick={() => abrir(it.tramiteId!)} title="Abrir el trámite"><ExternalLink size={13} /></button>}
                    {!it.tramiteId && it.recordatorioId && recordatorios && <button className="btn btn-sm btn-fantasma" onClick={recordatorios} title="Ver recordatorios"><ExternalLink size={13} /></button>}
                    {it.referencia && <button className="btn btn-sm" onClick={() => decir(it)} title="Decirle al asistente qué pasó con este trámite"><Bot size={13} />Decirle</button>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pestaña Cotizaciones: las guardadas, la más nueva primero. Se abren, se copian, se renombran, se borran o se retoman. */
/** Las conversaciones guardadas de los últimos 30 días: abrir una para seguirla, o borrarla. */
function ConversacionesAnteriores({ actual, abrir, nueva }: { actual: string | null; abrir: (id: string) => void; nueva: () => void }) {
  const [lista, setLista] = useState<{ conversaciones: ConversacionGuardada[]; dias: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);
  useEffect(() => {
    api<{ conversaciones: ConversacionGuardada[]; dias: number }>("/api/conversaciones").then(setLista, (e) => {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: las conversaciones anteriores necesitan internet." : mensajeDe(e));
    });
  }, []);
  async function quitar(id: string) {
    setError(null);
    try { await api(`/api/conversaciones/${id}`, { method: "DELETE" }); setLista((l) => l && { ...l, conversaciones: l.conversaciones.filter((c) => c.id !== id) }); setBorrar(null); if (id === actual) nueva(); }
    catch (e) { setError(mensajeDe(e)); }
  }
  const cuando = (f: string) => new Date(f).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="asistente-chat" aria-label="Conversaciones anteriores">
      <div className="fila" style={{ justifyContent: "space-between", gap: 8 }}>
        <b>Conversaciones anteriores</b>
        <button className="btn btn-sm" onClick={nueva}><MessageSquare size={13} />Nueva</button>
      </div>
      <div className="peq tenue">Quedan guardadas {lista?.dias ?? 30} días desde la última vez que se usaron (las ve en el PC y en el celular); después se borran solas.</div>
      {error && <div className="aviso error">{error}</div>}
      {!lista ? !error && <div className="peq tenue"><Loader2 size={13} className="girando" /> Cargando…</div>
        : !lista.conversaciones.length ? <div className="peq muted">Todavía no hay conversaciones guardadas.</div>
        : lista.conversaciones.map((c) => (
          <div key={c.id} className="bloque-ia cotizacion">
            <button className="cotizacion-titulo" onClick={() => abrir(c.id)} title="Abrir y seguir esta conversación">
              <b>{c.titulo}</b>
              <span className="peq tenue">{cuando(c.actualizado)} · {c.cantidad} mensaje{c.cantidad === 1 ? "" : "s"}{c.id === actual ? " · la de ahora" : ""}</span>
            </button>
            <div className="fila-wrap" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => abrir(c.id)}><MessageSquare size={13} />Abrir</button>
              {borrar === c.id
                ? <><button className="btn btn-sm btn-peligro" onClick={() => quitar(c.id)}>Sí, borrar</button><button className="btn btn-sm btn-fantasma" onClick={() => setBorrar(null)}>No</button></>
                : <button className="btn btn-sm btn-fantasma btn-icono" title="Borrar" aria-label="Borrar conversación" onClick={() => setBorrar(c.id)}><Trash2 size={13} /></button>}
            </div>
          </div>
        ))}
    </div>
  );
}

function ListaCotizaciones({ conversar }: { conversar: (c: Cotizacion) => void }) {
  const [lista, setLista] = useState<Cotizacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; titulo: string } | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);

  useEffect(() => {
    api<{ cotizaciones: Cotizacion[] }>("/api/cotizaciones").then((r) => setLista(r.cotizaciones), (e) => {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: las cotizaciones necesitan internet." : mensajeDe(e));
    });
  }, []);

  async function hacer(f: () => Promise<unknown>) {
    setError(null);
    try { await f(); } catch (e) { setError(mensajeDe(e)); }
  }
  const renombrar = (id: string, titulo: string) => hacer(async () => {
    setEditando(null);
    const t = titulo.trim();
    if (!t || lista?.find((c) => c.id === id)?.titulo === t) return;
    await api(`/api/cotizaciones/${id}`, { method: "PATCH", body: JSON.stringify({ titulo: t }) });
    setLista((l) => l && l.map((c) => (c.id === id ? { ...c, titulo: t } : c)));
  });
  const quitar = (id: string) => hacer(async () => {
    await api(`/api/cotizaciones/${id}`, { method: "DELETE" });
    setLista((l) => l && l.filter((c) => c.id !== id));
    setBorrar(null);
  });
  const copiar = (c: Cotizacion) => hacer(async () => {
    // Para el cliente: sin el organismo ni las notas del avalúo (si es una cotización); si no, el texto tal cual.
    await navigator.clipboard.writeText(textoClienteDeTexto(c.texto) ?? sinNegritas(c.texto));
    setCopiada(c.id);
    setTimeout(() => setCopiada((x) => (x === c.id ? null : x)), 2000);
  });

  return (
    <div className="asistente-chat">
      {error && <div className="aviso error">{error}</div>}
      {!lista ? !error && <div className="peq tenue"><Loader2 size={13} className="girando" /> Cargando las cotizaciones…</div>
        : !lista.length ? <div className="peq muted">Aquí quedan las cotizaciones. Las de fotos de tarjetas de propiedad se guardan solas; las que le pida por escrito, con el botón "Guardar como cotización" debajo de la respuesta.</div>
        : lista.map((c) => (
          <div key={c.id} className="bloque-ia cotizacion">
            {editando?.id === c.id ? (
              <input className="input" autoFocus aria-label="Nombre de la cotización" value={editando.titulo} maxLength={160}
                onChange={(e) => setEditando({ id: c.id, titulo: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") renombrar(c.id, editando.titulo); if (e.key === "Escape") setEditando(null); }}
                onBlur={() => renombrar(c.id, editando.titulo)} />
            ) : (
              <button className="cotizacion-titulo" aria-expanded={abierta === c.id} onClick={() => setAbierta((a) => (a === c.id ? null : c.id))}>
                <b>{c.titulo}</b>
                <span className="peq tenue">{fechaCorta(c.creado)}{c.total ? ` · ${pesos(c.total)}` : ""}</span>
              </button>
            )}
            {abierta === c.id && <TarjetasGuardadas id={c.id} />}
            {abierta === c.id && <div className="cotizacion-texto"><Texto t={c.texto} /></div>}
            <div className="fila-wrap" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => conversar(c)}><MessageSquare size={13} />Conversar sobre esta</button>
              <button className="btn btn-sm btn-fantasma" onClick={() => copiar(c)}>{copiada === c.id ? <><Check size={13} />Copiada</> : <><Copy size={13} />Copiar</>}</button>
              <button className="btn btn-sm btn-fantasma btn-icono" title="Cambiar el nombre" aria-label="Cambiar el nombre" onClick={() => setEditando({ id: c.id, titulo: c.titulo })}><Pencil size={13} /></button>
              {borrar === c.id
                ? <><button className="btn btn-sm btn-peligro" onClick={() => quitar(c.id)}>Sí, borrar</button><button className="btn btn-sm btn-fantasma" onClick={() => setBorrar(null)}>No</button></>
                : <button className="btn btn-sm btn-fantasma btn-icono" title="Borrar" aria-label="Borrar" onClick={() => setBorrar(c.id)}><Trash2 size={13} /></button>}
            </div>
          </div>
        ))}
    </div>
  );
}

/** La tarjeta de una cotización del mensaje: la de su placa; si no hay placa, la del mismo puesto. */
const sinSignos = (p: unknown) => String(p ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
function tarjetaDe(m: Mensaje, c: CotizacionDatos, k: number) {
  if (!m.tarjetas?.length) return undefined;
  // Con la placa leída (si se corrigió a mano, la tarjeta se subió con la que leyó).
  const placa = sinSignos(c.original?.datos?.placa ?? c.placa);
  return (placa && m.tarjetas.find((t) => t.placa === placa)?.src) || (m.tarjetas.length === m.cotizaciones?.length ? m.tarjetas[k]?.src : undefined);
}

/** En Cotizaciones, al abrir una: las tarjetas de propiedad con que se cotizó (si se guardaron). */
function TarjetasGuardadas({ id }: { id: string }) {
  const [lista, setLista] = useState<{ n: number; placa: string | null }[]>([]);
  useEffect(() => { api<{ tarjetas: { n: number; placa: string | null }[] }>(`/api/cotizaciones/${id}/tarjetas`).then((r) => setLista(r.tarjetas), () => {}); }, [id]);
  if (!lista.length) return null;
  return <div className="cot-tarjetas">{lista.map((t) => <VistaTarjeta key={t.n} src={`/api/cotizaciones/${id}/tarjetas/${t.n}`} placa={t.placa} />)}</div>;
}
