import { ArrowLeft, ArrowRight, Check, Download, Eye, Loader2, Pencil, Plus, Printer, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Smartphone, Trash2, Upload, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotonPegar, usePegarImagenes } from "../componentes/Pegar";
import { Cabecera, useUI } from "../componentes/ui";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { imprimirPdf } from "../logica/imprimir";
import { PDFDocument, rgb } from "pdf-lib";
import { CLAVE_CERCA, encuadreCerca, medidasCerca, recordarCerca } from "../fotos/masCerca";
import { aplicarRetoque, CONTROLES_PIEL, CONTROLES_ROSTRO, FONDO_BLANCO, FONDOS, PERFILES, prepararRetoque, RETOQUE_INICIAL, retoqueActivo, type Preparado, type Retoque } from "../fotos/retoque";
import { AJUSTES_INICIALES, analizar, BASE_COLOR, PREAJUSTES, BANDEJA, cargarMotor, componer, CONFIG_HOJA, dibujarHoja, ENCUADRE_INICIAL, hojaCarta, posiciones, recortar, rejilla, repartir, SEPARACIONES, type Ajustes, type Analisis, type ConfigHoja, type Encuadre } from "../fotos/procesar";

/*
 * Fotos 3x4 con fondo blanco. El celular (app instalada "Fotos 3x4", o el QR) manda las fotos a la bandeja (una
 * tomada en el momento o varias de la galería) y aquí quedan en fila: se atiende una, se imprime y "Siguiente
 * persona" la borra y abre la que sigue. El fondo se quita (o se blanquea) en este navegador (MediaPipe), con el
 * encuadre de la foto. Las fotos solo quedan en el servidor 48 horas (o hasta que se atienden).
 *
 * Hoja compartida: varias personas en la misma hoja carta (rejilla de 36 fotos). "Agregar a la hoja" guarda la foto
 * ya encuadrada de la persona y pasa a la siguiente de la fila; al final se imprime todo junto. La hoja vive en esta
 * pestaña del navegador (si se recarga, sigue ahí).
 */

interface FotoBandeja { foto: string; subida: string }
const CANTIDADES = [3, 6, 12];
/** Cuántas fotos por persona de entrada (y al restablecer). */
const CANTIDAD_INICIAL = 6;
const CLAVE_CONFIG = "nexum.fotos.hojaConfig";
/** La configuración de la hoja guardada en este PC. Los 3 mm de antes (lo que venía de entrada) pasan a sin separación. */
function configGuardada(): ConfigHoja {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_CONFIG) ?? "{}") as Partial<ConfigHoja> & { v?: number };
    if (!g.v && g.separacion === 3) g.separacion = CONFIG_HOJA.separacion;
    const { v: _v, ...c } = g;
    return { ...CONFIG_HOJA, ...c };
  } catch { return CONFIG_HOJA; }
}
const CLAVE_AJUSTES = "nexum.fotos.ajustes";
const CLAVE_HOJA = "nexum.fotos.hoja";
/** El encuadre de cada foto de la fila (por su nombre): pasar a otra foto y volver no pierde lo editado. */
const CLAVE_EDICIONES = "nexum.fotos.ediciones";
const CLAVE_RETOQUES = "nexum.fotos.retoques";
function retoquesGuardados(): Record<string, Retoque> {
  try { const e = JSON.parse(sessionStorage.getItem(CLAVE_RETOQUES) ?? "{}"); return e && typeof e === "object" ? e : {}; } catch { return {}; }
}
function edicionesGuardadas(): Record<string, Encuadre> {
  try { const e = JSON.parse(sessionStorage.getItem(CLAVE_EDICIONES) ?? "{}"); return e && typeof e === "object" ? e : {}; } catch { return {}; }
}
/** Una persona en la hoja compartida: su foto ya lista (JPEG) y cuántas copias. */
/**
 * Una persona en la hoja compartida: su foto ya encuadrada y, para poder editarla después, la foto original del
 * servidor (`foto`, se borra al quitarla de la hoja o a las 48 horas) y el encuadre con que quedó.
 */
interface PersonaHoja { id: string; url: string; copias: number; foto?: string; encuadre?: Encuadre; retoque?: Retoque }
const url = (foto: string) => `/api/fotos/sesiones/${BANDEJA}/${foto}`;

/**
 * Los ajustes de color quedan guardados en este navegador: la calibración de la oficina no se pierde.
 * Los guardados antes de v3 se medían desde la foto como llegó: se corren para que la foto se siga viendo igual, y los
 * ceros sin versión (lo que venía de entrada entonces) pasan al cero de ahora.
 */
function ajustesGuardados(): Ajustes {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) ?? "{}") as Partial<Ajustes> & { v?: number };
    if (!g.v && !g.brillo && !g.contraste) { delete g.brillo; delete g.contraste; }
    else if ((g.v ?? 0) < 3) {
      g.brillo = Math.max(-50, (g.brillo ?? 0) - BASE_COLOR.brillo);
      g.contraste = Math.max(-50, (g.contraste ?? 0) - BASE_COLOR.contraste);
    }
    const { v: _v, ...a } = g;
    return { ...AJUSTES_INICIALES, ...a };
  } catch { return AJUSTES_INICIALES; }
}
function hojaGuardada(): PersonaHoja[] {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_HOJA) ?? "[]"); } catch { return []; }
}
const cargarImagen = (src: string) => new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo preparar una foto de la hoja.")); i.src = src; });

export default function Fotos() {
  const { avisar, confirmar } = useUI();
  const [qr, setQr] = useState<string | null>(null);
  const [bandeja, setBandeja] = useState<FotoBandeja[]>([]);
  const [actual, setActual] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [encuadre, setEncuadre] = useState<Encuadre>(ENCUADRE_INICIAL);
  const [ajustes, setAjustes] = useState<Ajustes>(ajustesGuardados);
  const [verAjustes, setVerAjustes] = useState(false);
  const [pestana, setPestana] = useState<"color" | "fondo" | "retoque">("color");
  // El fondo y el retoque son de cada foto (el color queda guardado en el PC): lo de una persona no le cae a la siguiente.
  const [retoque, setRetoque] = useState<Retoque>(RETOQUE_INICIAL);
  const [preparado, setPreparado] = useState<{ de: Analisis; prep: Preparado | null; fallo?: boolean } | null>(null);
  const [comparando, setComparando] = useState(false);
  const [cantidad, setCantidad] = useState(CANTIDAD_INICIAL);
  const [estado, setEstado] = useState<"esperando" | "procesando" | "lista" | "error">("esperando");
  const [error, setError] = useState<string | null>(null);
  const [motorListo, setMotorListo] = useState(false);
  const [hoja, setHoja] = useState<PersonaHoja[]>(hojaGuardada);
  // Configuración avanzada de la hoja (queda guardada en este PC) y la persona elegida en la hoja compartida.
  const [config, setConfig] = useState<ConfigHoja>(configGuardada);
  const [elegidaHoja, setElegidaHoja] = useState<string | null>(null);
  const red = useMemo(() => rejilla(config), [config]);
  // La tuerquita de la hoja: su panel flotante (se cierra al tocar fuera o con Esc).
  const [verConfig, setVerConfig] = useState(false);
  const cajaConfig = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!verConfig) return;
    const fuera = (e: PointerEvent) => { if (!cajaConfig.current?.contains(e.target as Node)) setVerConfig(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setVerConfig(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", esc); };
  }, [verConfig]);
  // «Otra»: se deja escribir libre (vacío mientras se escribe) y vale al salir de la casilla o con Enter.
  const [otra, setOtra] = useState<string | null>(null);
  const tomarOtra = () => { if (otra !== null) { const n = Math.round(Number(otra)); if (n >= 1) setCantidad(Math.min(red.porHoja, n)); setOtra(null); } };
  const enInicio = cantidad === CANTIDAD_INICIAL && JSON.stringify(config) === JSON.stringify(CONFIG_HOJA);
  const restablecer = () => { setCantidad(CANTIDAD_INICIAL); setConfig(CONFIG_HOJA); setOtra(null); };
  const vistaFoto = useRef<HTMLCanvasElement>(null);
  const archivoPc = useRef<HTMLInputElement>(null);
  const zonaPc = useRef<HTMLDivElement>(null);
  /** Fotos ya descartadas aquí, para que no reaparezcan en la fila mientras el servidor termina de borrarlas. */
  const descartadas = useRef(new Set<string>());
  // Las fotos de las personas ya agregadas a la hoja siguen en la fila (marcadas): un clic y se editan.
  const personaDe = (nombre: string | null) => (nombre ? hoja.find((p) => p.foto === nombre) : undefined);
  // Lo editado en cada foto de la fila: se guarda al cambiar el encuadre (con la foto ya lista) y se retoma al volver.
  const ediciones = useRef<Record<string, Encuadre>>(edicionesGuardadas());
  const retoques = useRef<Record<string, Retoque>>(retoquesGuardados());
  const [editadas, setEditadas] = useState<Set<string>>(() => new Set([...Object.keys(ediciones.current), ...Object.keys(retoques.current)]));
  const olvidarEdicion = (nombre: string) => {
    if (!(nombre in ediciones.current) && !(nombre in retoques.current)) return;
    delete ediciones.current[nombre];
    delete retoques.current[nombre];
    try { sessionStorage.setItem(CLAVE_EDICIONES, JSON.stringify(ediciones.current)); sessionStorage.setItem(CLAVE_RETOQUES, JSON.stringify(retoques.current)); } catch { /* sin almacenamiento */ }
    setEditadas(new Set([...Object.keys(ediciones.current), ...Object.keys(retoques.current)]));
  };
  /** La persona de la hoja que se está editando (al guardar, se reemplaza en su puesto). */
  const [editando, setEditando] = useState<string | null>(null);

  const fallo = useCallback((e: unknown) => {
    if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
    setEstado("error");
    setError(e instanceof SinConexion ? "Sin conexión con el servidor." : mensajeDe(e));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify({ ...ajustes, v: 3 })); } catch { /* sin almacenamiento: no se recuerdan */ }
  }, [ajustes]);
  useEffect(() => {
    try { sessionStorage.setItem(CLAVE_HOJA, JSON.stringify(hoja)); } catch { /* sin espacio: la hoja sigue en pantalla, pero no sobrevive a una recarga */ }
  }, [hoja]);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_CONFIG, JSON.stringify({ ...config, v: 2 })); } catch { /* sin almacenamiento: no se recuerda */ }
  }, [config]);
  // Lo que ya no cabe en una hoja (al cambiar la separación) queda en lo que cabe.
  useEffect(() => { setCantidad((n) => Math.min(n, red.porHoja)); }, [red.porHoja]);

  // QR hacia la página del celular (desde ahí se instala la app "Fotos 3x4"); el quitafondos se va cargando.
  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/fotos/tomar`, { margin: 1, width: 200, errorCorrectionLevel: "M" }).then(setQr, () => {});
    cargarMotor().then(() => setMotorListo(true), () => {});
  }, []);

  /** El encuadre con que entró la foto abierta (para saber si se editó). */
  const encuadreDeEntrada = useRef<Encuadre>(ENCUADRE_INICIAL);
  /**
   * Abre una foto. Sin un encuadre dado (lo editado antes), entra en «Más cerca» (el mejor encuadre, a la medida de la
   * oficina); si no se encuentra la cara, completa (como se tomó).
   */
  const procesar = useCallback(async (origen: Blob, encuadreInicial?: Encuadre, retoqueInicial?: Retoque) => {
    setEstado("procesando");
    setError(null);
    try {
      const img = await createImageBitmap(origen, { imageOrientation: "from-image" });
      const a = await analizar(img);
      img.close();
      setAnalisis(a);
      const entrada = a.cara ? encuadreCerca() : ENCUADRE_INICIAL;
      encuadreDeEntrada.current = entrada;
      setEncuadre(encuadreInicial ?? entrada);
      setRetoque(retoqueInicial ?? RETOQUE_INICIAL);
      setEstado("lista");
      if (!a.silueta) avisar("No encontré a la persona en la foto: ajuste el encuadre a mano.", "error");
    } catch (e) { fallo(e); }
  }, [avisar, fallo]);
  // Ctrl+V: la foto copiada (de WhatsApp...) entra sin descargarla.
  usePegarImagenes(zonaPc, (f) => { setActual(null); procesar(f[0]); });

  // Fila de fotos: se revisa la bandeja cada 2 segundos mientras la pantalla está a la vista (la más vieja primero).
  useEffect(() => {
    let vigente = true;
    const revisar = async () => {
      if (document.hidden) return;
      try {
        const { fotos } = await api<{ fotos: FotoBandeja[] }>(`/api/fotos/sesiones/${BANDEJA}`);
        if (vigente) setBandeja(fotos.filter((f) => !descartadas.current.has(f.foto)).sort((a, b) => a.subida.localeCompare(b.subida)));
      } catch (e) { if (vigente) fallo(e); }
    };
    revisar();
    const t = setInterval(revisar, 2000);
    return () => { vigente = false; clearInterval(t); };
  }, [fallo]);

  const abrir = useCallback(async (nombre: string) => {
    setActual(nombre);
    setEstado("procesando");
    try {
      const r = await fetch(url(nombre), { credentials: "same-origin" });
      if (!r.ok) throw new Error("No se pudo traer la foto.");
      await procesar(await r.blob(), ediciones.current[nombre], retoques.current[nombre]);
    } catch (e) { fallo(e); }
  }, [procesar, fallo]);
  // Al editar la foto abierta de la fila (ya lista), su encuadre queda guardado para cuando se vuelva a ella.
  useEffect(() => {
    if (!actual || estado !== "lista" || editando) return;
    const igualInicial = JSON.stringify(encuadre) === JSON.stringify(encuadreDeEntrada.current);
    if (igualInicial && !(actual in ediciones.current)) return;
    ediciones.current[actual] = encuadre;
    try { sessionStorage.setItem(CLAVE_EDICIONES, JSON.stringify(ediciones.current)); } catch { /* sin almacenamiento: solo en esta pantalla */ }
    setEditadas((s) => (s.has(actual) ? s : new Set(s).add(actual)));
  }, [actual, estado, encuadre, editando]);
  // Igual con el fondo y el retoque.
  useEffect(() => {
    if (!actual || estado !== "lista" || editando) return;
    const igualInicial = JSON.stringify(retoque) === JSON.stringify(RETOQUE_INICIAL);
    if (igualInicial && !(actual in retoques.current)) return;
    if (igualInicial) delete retoques.current[actual];
    else retoques.current[actual] = retoque;
    try { sessionStorage.setItem(CLAVE_RETOQUES, JSON.stringify(retoques.current)); } catch { /* sin almacenamiento: solo en esta pantalla */ }
    setEditadas(new Set([...Object.keys(ediciones.current), ...Object.keys(retoques.current)]));
  }, [actual, estado, retoque, editando]);

  // Sin foto abierta, se abre sola la primera de la fila que todavía no está en la hoja.
  const pendientes = useMemo(() => bandeja.filter((f) => !hoja.some((p) => p.foto === f.foto)), [bandeja, hoja]);
  useEffect(() => {
    if (!actual && !analisis && pendientes.length && estado === "esperando") abrir(pendientes[0].foto);
  }, [actual, analisis, pendientes, estado, abrir]);

  // El retoque se prepara la primera vez que se usa en cada foto; mientras tanto no hay foto para agregar ni imprimir.
  const conRetoque = retoqueActivo(retoque);
  useEffect(() => {
    if (!analisis || !conRetoque || preparado?.de === analisis) return;
    let vigente = true;
    prepararRetoque(analisis).then(
      (prep) => { if (vigente) setPreparado({ de: analisis, prep }); },
      () => { if (vigente) { setPreparado({ de: analisis, prep: null, fallo: true }); avisar("No se pudo preparar el retoque. Revise la conexión e intente de nuevo.", "error"); } },
    );
    return () => { vigente = false; };
  }, [analisis, conRetoque, preparado, avisar]);
  const retoqueListo = preparado?.de === analisis ? preparado : null;
  const preparandoRetoque = conRetoque && !retoqueListo;
  const compuesta = useMemo(() => {
    if (!analisis || preparandoRetoque) return null;
    const prep = retoqueListo?.prep;
    return componer(analisis, ajustes, retoque.fondo, prep && conRetoque && !comparando ? (d) => aplicarRetoque(d, analisis.base.width, prep, retoque) : undefined);
  }, [analisis, ajustes, retoque, retoqueListo, preparandoRetoque, conRetoque, comparando]);
  const foto = useMemo(() => (analisis && compuesta ? recortar(analisis, compuesta, encuadre, retoque.fondo) : null), [analisis, compuesta, encuadre, retoque.fondo]);
  const fotoUrl = useMemo(() => foto?.toDataURL("image/jpeg", 0.85) ?? null, [foto]);
  useEffect(() => {
    const c = vistaFoto.current;
    if (!c || !foto) return;
    c.width = foto.width; c.height = foto.height;
    c.getContext("2d")!.drawImage(foto, 0, 0);
  }, [foto]);

  /**
   * Se imprime un PDF (como los formatos): así no sale el encabezado que el navegador le pone a una página web. Cada
   * foto va a tamaño real (30 x 40 mm) en su sitio de la hoja carta, con su guía de corte gris (si van las guías).
   */
  async function imprimirHojas(hojasFotos: { url: string; x: number; y: number }[][]) {
    try {
      const pdf = await PDFDocument.create();
      pdf.setTitle("Fotos 3x4");
      const pt = 72 / 25.4, imagenes = new Map<string, Awaited<ReturnType<typeof pdf.embedJpg>>>();
      for (const h of hojasFotos) {
        const pagina = pdf.addPage([215.9 * pt, 279.4 * pt]);
        for (const f of h) {
          if (!imagenes.has(f.url)) imagenes.set(f.url, await pdf.embedJpg(await (await fetch(f.url)).arrayBuffer()));
          const x = f.x * pt, y = (279.4 - f.y - 40) * pt;
          pagina.drawImage(imagenes.get(f.url)!, { x, y, width: 30 * pt, height: 40 * pt });
          if (config.guias) pagina.drawRectangle({ x, y, width: 30 * pt, height: 40 * pt, borderColor: rgb(0.78, 0.78, 0.78), borderWidth: 0.15 * pt });
        }
      }
      imprimirPdf(await pdf.save());
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  /** Solo esta persona: sus fotos en la esquina de la hoja (como siempre). */
  function imprimir() {
    if (!foto) return;
    recordarCerca(encuadre);
    const url = foto.toDataURL("image/jpeg", 0.95);
    void imprimirHojas([posiciones(cantidad, config).map((p) => ({ url, ...p }))]);
  }
  const hojas = useMemo(() => repartir(hoja, config), [hoja, config]);
  /** Vista de la hoja compartida con la persona abierta incluida (en tenue) donde quedaría si se agrega. */
  const hojasConActual = useMemo(() => repartir([...hoja, ...(fotoUrl ? [{ id: "actual", url: fotoUrl, copias: cantidad }] : [])], config), [hoja, fotoUrl, cantidad, config]);
  const totalFotos = hoja.reduce((n, p) => n + Math.min(p.copias, red.porHoja), 0);
  /** Cambia algo de una persona de la hoja compartida (copias) o la mueve antes o después. */
  const copiasDe = (id: string, d: number) => setHoja((h) => h.map((p) => (p.id === id ? { ...p, copias: Math.max(1, Math.min(red.porHoja, p.copias + d)) } : p)));
  const moverPersona = (id: string, d: -1 | 1) => setHoja((h) => { const i = h.findIndex((p) => p.id === id), j = i + d; if (i < 0 || j < 0 || j >= h.length) return h; const q = [...h]; [q[i], q[j]] = [q[j], q[i]]; return q; });
  function imprimirHoja() {
    if (hojas.length) void imprimirHojas(hojas.map((h) => h.map((u) => ({ url: u.persona.url, x: u.x, y: u.y }))));
  }

  const bajar = (canvas: HTMLCanvasElement, nombre: string) => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.95);
    a.download = nombre;
    a.click();
  };
  function descargarHoja() {
    if (foto) bajar(hojaCarta(foto, cantidad, config), `fotos-3x4-${new Date().toISOString().slice(0, 10)}.jpg`);
  }
  async function descargarCompartida() {
    try {
      const imagenes = new Map(await Promise.all(hoja.map(async (p) => [p.id, await cargarImagen(p.url)] as const)));
      hojas.forEach((h, k) => bajar(dibujarHoja(h.map((u) => ({ img: imagenes.get(u.persona.id)!, x: u.x, y: u.y })), config.guias), `fotos-3x4-${new Date().toISOString().slice(0, 10)}-hoja-${k + 1}.jpg`));
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  const cerrarActual = () => { setActual(null); setAnalisis(null); setEstado("esperando"); setError(null); setEncuadre(ENCUADRE_INICIAL); };

  /**
   * Quita una foto de la fila (y del servidor). Si era la abierta, se abre la siguiente. La de una persona de la hoja
   * solo sale de la fila: su original sigue para editarla (se borra al quitarla de la hoja).
   */
  async function descartar(nombre: string) {
    if (personaDe(nombre)) {
      descartadas.current.add(nombre);
      setBandeja((b) => b.filter((f) => f.foto !== nombre));
      if (nombre === actual) { setEditando(null); cerrarActual(); }
      return;
    }
    olvidarEdicion(nombre);
    descartadas.current.add(nombre);
    setBandeja((b) => b.filter((f) => f.foto !== nombre));
    if (nombre === actual) cerrarActual();
    try { await api(url(nombre), { method: "DELETE" }); } catch (e) { descartadas.current.delete(nombre); fallo(e); }
  }

  /** Borra del servidor la foto abierta y abre la siguiente de la fila. Devuelve cuántas quedan. */
  async function pasarALaSiguiente() {
    const quedan = pendientes.filter((f) => f.foto !== actual).length;
    if (actual) await descartar(actual);
    else cerrarActual();
    return quedan;
  }
  async function siguientePersona() {
    const quedan = await pasarALaSiguiente();
    avisar(quedan ? `Foto borrada del servidor. Quedan ${quedan} en la fila.` : "Foto borrada del servidor. Lista para la siguiente persona.");
  }

  /**
   * Guarda la foto ya encuadrada de esta persona en la hoja compartida y sigue con la siguiente de la fila. La foto
   * original NO se borra: sigue en la fila, marcada "en la hoja", y con un clic se edita (se borra al quitar a la
   * persona de la hoja). Si se estaba editando a una persona de la hoja, se reemplaza en su puesto.
   */
  async function agregarAHoja() {
    if (!foto) return;
    recordarCerca(encuadre);
    const datos = { url: foto.toDataURL("image/jpeg", 0.95), copias: cantidad, encuadre, retoque, ...(actual ? { foto: actual } : {}) };
    if (editando && hoja.some((p) => p.id === editando)) {
      setHoja((h) => h.map((p) => (p.id === editando ? { ...p, ...datos } : p)));
      setEditando(null);
      cerrarActual();
      avisar("Cambios guardados en la hoja.");
      return;
    }
    const nueva: PersonaHoja = { id: crypto.randomUUID(), ...datos };
    const antes = repartir(hoja, config).length;
    const despues = repartir([...hoja, nueva], config).length;
    setHoja((h) => [...h, nueva]);
    const quedan = pendientes.filter((f) => f.foto !== actual).length;
    if (actual) olvidarEdicion(actual);
    cerrarActual();
    avisar(`Agregada a la hoja (${hoja.length + 1} persona${hoja.length ? "s" : ""}).${despues > antes && antes > 0 ? ` Ya no cabía: empieza la hoja ${despues}.` : ""}${quedan ? ` Siguiente de la fila: quedan ${quedan}.` : ""}`);
  }
  async function vaciarHoja() {
    if (!(await confirmar({ titulo: "¿Vaciar la hoja compartida?", texto: `Se quitan las fotos de ${hoja.length} persona(s). Hágalo cuando ya estén impresas.`, boton: "Vaciar", peligro: true }))) return;
    for (const p of hoja) if (p.foto) void api(url(p.foto), { method: "DELETE" }).catch(() => {});
    setHoja([]); setEditando(null);
  }
  /** Quita a una persona de la hoja y borra su foto original del servidor. */
  function quitarDeHoja(p: PersonaHoja) {
    setHoja((h) => h.filter((x) => x.id !== p.id));
    if (p.foto) void api(url(p.foto), { method: "DELETE" }).catch(() => {});
    if (editando === p.id) { setEditando(null); cerrarActual(); }
  }
  /**
   * Abre a una persona de la hoja para editarla: con su foto original y el encuadre que tenía; si la original ya no
   * está (se borró a las 48 horas, o se agregó antes de que existiera esto), con la foto encuadrada de la hoja.
   */
  async function editarPersona(p: PersonaHoja) {
    // "procesando" ya: así la fila no abre otra foto mientras llega esta.
    setEditando(p.id); setElegidaHoja(null); setCantidad(p.copias); setEstado("procesando");
    if (p.foto) {
      try {
        const r = await fetch(url(p.foto), { credentials: "same-origin" });
        if (r.ok) { setActual(p.foto); await procesar(await r.blob(), p.encuadre, p.retoque); return; }
      } catch { /* sigue con la de la hoja */ }
    }
    setActual(null);
    // La de la hoja ya está recortada: entra completa (en «Más cerca» se recortaría otra vez).
    // También ya trae el retoque (hacerlo otra vez lo doblaría); el fondo sí se conserva.
    await procesar(await (await fetch(p.url)).blob(), ENCUADRE_INICIAL, { ...RETOQUE_INICIAL, fondo: p.retoque?.fondo ?? FONDO_BLANCO });
    avisar("La foto original ya no está: se edita la que quedó en la hoja (se puede alejar, acercar, mover y cambiar el brillo).");
  }

  async function vaciar() {
    // Una por una, solo las que no están en la hoja: las de las personas de la hoja (para editarlas) se quedan.
    const todas = pendientes.map((f) => f.foto);
    todas.forEach((f) => { descartadas.current.add(f); olvidarEdicion(f); });
    setBandeja((b) => b.filter((f) => !todas.includes(f.foto)));
    if (!personaDe(actual)) cerrarActual();
    const fallaron: string[] = [];
    await Promise.all(todas.map((f) => api(url(f), { method: "DELETE" }).catch(() => { fallaron.push(f); })));
    if (fallaron.length) { fallaron.forEach((f) => descartadas.current.delete(f)); avisar(`No se pudieron borrar ${fallaron.length} foto(s): siguen en la fila.`, "error"); }
    else avisar(`Se borraron ${todas.length} foto(s) de la fila.`);
  }

  const mover = (k: "escala" | "dx" | "dy", d: number, min: number, max: number) => setEncuadre((e) => ({ ...e, [k]: Math.min(max, Math.max(min, +(e[k] + d).toFixed(3))) }));
  const ajustar = (k: keyof Omit<Ajustes, "modo">) => (v: number) => setAjustes((a) => ({ ...a, [k]: v }));
  const posicion = actual ? bandeja.findIndex((f) => f.foto === actual) : -1;
  const conCambios = (["blanqueo", "borde", "brillo", "contraste", "calidez", "saturacion"] as const).some((k) => ajustes[k] !== AJUSTES_INICIALES[k]) || JSON.stringify(retoque) !== JSON.stringify(RETOQUE_INICIAL);
  const fondoElegido = FONDOS.find((f) => f.color === retoque.fondo);
  const controlRetoque = (c: { clave: Exclude<keyof Retoque, "fondo">; nombre: string }) => <Deslizador key={c.clave} nombre={c.nombre} valor={retoque[c.clave]} min={0} max={100} alCambiar={(v) => setRetoque((r) => ({ ...r, [c.clave]: v }))} />;

  return (
    <>
      <Cabecera titulo="Fotos 3x4" sub="Fondo blanco, listas para imprimir">
        <button className="btn" onClick={siguientePersona} disabled={!analisis && !actual} title="Borra del servidor la foto de esta persona y abre la siguiente de la fila"><RefreshCw size={14} />Siguiente persona</button>
      </Cabecera>
      <div className="contenido fotos">
        <div className="card fotos-qr">
          <div className="card-cab"><Smartphone size={16} className="tenue" /><b>1. Tomar la foto con el celular</b></div>
          <div className="card-cuerpo pila" style={{ gap: 10, alignItems: "center", textAlign: "center" }}>
            <div className="peq">Abra la app <b>Fotos Pira</b> en el celular, entre a <b>Fotos 3x4</b> y tome la foto o suba varias de la galería. Aparecen aquí solas.</div>
            {qr ? <img src={qr} alt="Código QR para tomar la foto" width={200} height={200} /> : <Loader2 className="girando" />}
            <div className="peq muted">¿Aún no la tiene? Escanee el código con la cámara del iPhone, ábralo en Safari y toque <b>Compartir → Agregar a pantalla de inicio</b> (con "Abrir como app web").</div>
            <div ref={zonaPc} className="peq tenue fila-wrap" style={{ gap: 6, justifyContent: "center" }}>¿Sin celular? <button className="btn btn-sm" onClick={() => archivoPc.current?.click()}><Upload size={13} />Subir una foto desde el PC</button><BotonPegar recibir={(f) => { setActual(null); procesar(f[0]); }} /></div>
            <div className="peq tenue">O copie la foto (en WhatsApp: clic derecho → Copiar imagen) y péguela aquí con Ctrl+V.</div>
            <input ref={archivoPc} type="file" accept="image/*" hidden aria-label="Foto desde el PC" onChange={(e) => { const a = e.target.files?.[0]; if (a) { setActual(null); procesar(a); } e.target.value = ""; }} />
            {!motorListo && <div className="peq tenue"><Loader2 size={12} className="girando" /> Preparando el quitafondos (solo la primera vez)…</div>}
          </div>
        </div>

        <div className="card fotos-resultado">
          <div className="card-cab"><b>2. Revisar y encuadrar</b>{estado === "procesando" && <span className="peq tenue"><Loader2 size={12} className="girando" /> Quitando el fondo…</span>}</div>
          <div className="card-cuerpo">
            {bandeja.length > 0 && (
              <div className="fotos-fila">
                <div className="fila" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="peq muted">En la fila: <b>{bandeja.length}</b>{bandeja.length > pendientes.length ? ` (${bandeja.length - pendientes.length} ya en la hoja)` : ""}{posicion >= 0 ? ` · abierta la ${posicion + 1}` : ""}</span>
                  {pendientes.length > 0 && <button className="btn btn-sm btn-fantasma" onClick={vaciar} title="Borra del servidor las fotos de la fila que no están en la hoja"><Trash2 size={13} />Borrar todas</button>}
                </div>
                <div className="fotos-miniaturas">
                  {bandeja.map((f, i) => {
                    const p = personaDe(f.foto);
                    const n = p ? hoja.indexOf(p) + 1 : 0;
                    return (
                      <div key={f.foto} className={`fotos-mini${f.foto === actual ? " on" : ""}${p ? " en-hoja" : ""}`}>
                        <button className="fotos-mini-abrir" onClick={() => { if (f.foto === actual) return; if (p) void editarPersona(p); else void abrir(f.foto); }}
                          title={p ? `Persona ${n} de la hoja: clic para editarla` : `Abrir la foto ${i + 1}${editadas.has(f.foto) ? " (editada: se abre como la dejó)" : ""}`} aria-label={p ? `Editar a la persona ${n} de la hoja` : `Abrir la foto ${i + 1}`}><img src={url(f.foto)} alt="" loading="lazy" /></button>
                        {p ? <span className="fotos-mini-en-hoja" title={`En la hoja: persona ${n}`} aria-label={`En la hoja: persona ${n}`}><Check size={10} />{n}</span>
                          : editadas.has(f.foto) && <span className="fotos-mini-editada" title="Editada: se abre como la dejó" aria-label="Editada"><Pencil size={10} /></span>}
                        <button className="fotos-mini-quitar" onClick={() => descartar(f.foto)} title={p ? "Sacarla de la fila (sigue en la hoja)" : "Quitar de la fila (no sirve)"} aria-label={`Quitar la foto ${i + 1}`}><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {error && <div className="aviso error" style={{ marginBottom: 10 }}>{error} <button className="btn btn-sm" onClick={() => { setError(null); setEstado(analisis ? "lista" : "esperando"); }}>Cerrar</button></div>}
            {!analisis ? (
              <div className="peq tenue" style={{ padding: "40px 0", textAlign: "center" }}>{estado === "procesando" ? "Procesando la foto…" : "Esperando la foto del celular…"}</div>
            ) : (
              <div className="fotos-ajuste">
                <canvas ref={vistaFoto} className="foto-3x4" />
                <div className="pila" style={{ gap: 12 }}>
                  <div className="pila" style={{ gap: 4 }}>
                    <span className="peq muted">Fondo</span>
                    <div className="seg">
                      <button className={ajustes.modo === "quitar" ? "on" : ""} onClick={() => setAjustes((a) => ({ ...a, modo: "quitar" }))} title="Recorta a la persona y la pone sobre blanco">Recortar a la persona</button>
                      <button className={ajustes.modo === "oficina" ? "on" : ""} onClick={() => setAjustes((a) => ({ ...a, modo: "oficina" }))} title="Para fotos tomadas contra la pared blanca: no recorta, solo deja el fondo blanco brillante">Sin recortar</button>
                    </div>
                  </div>
                  <div className="pila" style={{ gap: 4 }}>
                    <span className="peq muted">Encuadre</span>
                    <div className="seg">
                      {/* Primero «Más cerca» (con el que entra la foto: el mejor encuadre); «Completa», la foto entera. */}
                      <button className={encuadre.modo === "cara" ? "on" : ""} disabled={!analisis.cara} onClick={() => setEncuadre(encuadreCerca())}>Más cerca</button>
                      <button className={encuadre.modo === "foto" ? "on" : ""} onClick={() => setEncuadre({ ...ENCUADRE_INICIAL, modo: "foto" })} title="La foto completa, como se tomó">Completa</button>
                    </div>
                    {encuadre.modo === "cara" && medidasCerca().length > 0 && (
                      <span className="peq tenue">A su medida (de sus últimas {medidasCerca().length} fotos). <button className="btn-enlace" onClick={() => { try { localStorage.removeItem(CLAVE_CERCA); } catch { /* nada */ } setEncuadre({ ...ENCUADRE_INICIAL, modo: "cara" }); }}>Volver a la de fábrica</button></span>
                    )}
                  </div>
                  <Control nombre="Tamaño de la persona" menos={() => mover("escala", 0.05, 0.4, 2)} mas={() => mover("escala", -0.05, 0.4, 2)} />
                  <Control nombre="Subir / bajar" menos={() => mover("dy", -0.02, -0.4, 0.4)} mas={() => mover("dy", 0.02, -0.4, 0.4)} etiquetas={["Bajar", "Subir"]} />
                  <Control nombre="Izquierda / derecha" menos={() => mover("dx", 0.02, -0.4, 0.4)} mas={() => mover("dx", -0.02, -0.4, 0.4)} etiquetas={["Izquierda", "Derecha"]} />
                  <div className="fila" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-fantasma" onClick={() => setEncuadre(encuadre.modo === "cara" ? encuadreCerca() : ENCUADRE_INICIAL)}>Encuadre automático</button>
                    <button className="btn btn-sm" onClick={() => setVerAjustes((v) => !v)} aria-expanded={verAjustes}><SlidersHorizontal size={13} />Ajustes{conCambios ? " (cambiados)" : ""}</button>
                  </div>
                </div>
                {verAjustes && (
                  <div className="fotos-ajustes" role="group" aria-label="Ajustes de la imagen">
                    <div className="fila" style={{ justifyContent: "space-between" }}>
                      <b className="peq">Ajustes de la imagen</b>
                      <button className="btn btn-sm btn-fantasma" onClick={() => { setAjustes((a) => ({ ...AJUSTES_INICIALES, modo: a.modo })); setRetoque(RETOQUE_INICIAL); }} disabled={!conCambios}><RotateCcw size={13} />Restablecer</button>
                    </div>
                    <div className="tabs" role="tablist" aria-label="Clase de ajuste">
                      <button role="tab" aria-selected={pestana === "color"} className={pestana === "color" ? "on" : ""} onClick={() => setPestana("color")}>Color</button>
                      <button role="tab" aria-selected={pestana === "fondo"} className={pestana === "fondo" ? "on" : ""} onClick={() => setPestana("fondo")}>Fondo{retoque.fondo !== FONDO_BLANCO ? <span className="fotos-muestra" style={{ background: retoque.fondo }} /> : null}</button>
                      <button role="tab" aria-selected={pestana === "retoque"} className={pestana === "retoque" ? "on" : ""} onClick={() => setPestana("retoque")}>Retoque{conRetoque ? <span className="cuenta">activo</span> : null}</button>
                    </div>
                    {pestana === "color" && <>
                    <div className="fila" style={{ gap: 8 }}>
                      <span className="peq muted">Preajuste</span>
                      <div className="seg" role="group" aria-label="Preajustes">
                        {PREAJUSTES.map((p) => {
                          const activo = (Object.keys(p.valores) as (keyof typeof p.valores)[]).every((k) => ajustes[k] === p.valores[k]);
                          return <button key={p.nombre} className={activo ? "on" : ""} aria-pressed={activo} onClick={() => setAjustes((a) => ({ ...a, ...p.valores }))}>{p.nombre}</button>;
                        })}
                      </div>
                    </div>
                    <Deslizador nombre="Brillo" valor={ajustes.brillo} min={-50} max={50} alCambiar={ajustar("brillo")} />
                    <Deslizador nombre="Contraste" valor={ajustes.contraste} min={-50} max={50} alCambiar={ajustar("contraste")} />
                    <Deslizador nombre="Calidez" valor={ajustes.calidez} min={-50} max={50} extremos={["Fría", "Cálida"]} alCambiar={ajustar("calidez")} />
                    <Deslizador nombre="Saturación" valor={ajustes.saturacion} min={-50} max={50} alCambiar={ajustar("saturacion")} />
                    <div className="peq tenue">Quedan guardados en este PC para las próximas fotos.</div>
                    </>}
                    {pestana === "fondo" && <>
                    <div className="fotos-fondos" role="group" aria-label="Color del fondo">
                      {FONDOS.map((f) => (
                        <button key={f.color} className={`btn btn-sm${retoque.fondo === f.color ? " on" : ""}`} aria-pressed={retoque.fondo === f.color} onClick={() => setRetoque((r) => ({ ...r, fondo: f.color }))}><span className="fotos-muestra" style={{ background: f.color }} />{f.nombre}</button>
                      ))}
                      <label className={`btn btn-sm${fondoElegido ? "" : " on"}`}><input type="color" className="fotos-otro-color" aria-label="Otro color de fondo" value={retoque.fondo} onChange={(e) => setRetoque((r) => ({ ...r, fondo: e.target.value }))} />Otro color</label>
                    </div>
                    {ajustes.modo === "oficina"
                      ? <Deslizador nombre={retoque.fondo === FONDO_BLANCO ? "Blanquear el fondo" : "Cambiar el fondo"} valor={ajustes.blanqueo} min={0} max={100} unidad=" %" alCambiar={ajustar("blanqueo")} />
                      : <Deslizador nombre="Borde del recorte" valor={ajustes.borde} min={-50} max={50} extremos={["Ajustado", "Holgado"]} alCambiar={ajustar("borde")} />}
                    <div className="peq tenue">El color es solo para esta foto. Para pasaporte, cédula y visa, déjelo en blanco.</div>
                    </>}
                    {pestana === "retoque" && <>
                    <div className="fila-wrap" style={{ gap: 8 }}>
                      <span className="peq muted">Para</span>
                      <div className="seg" role="group" aria-label="Clase de retoque">
                        {PERFILES.map((p) => {
                          const activo = (Object.keys(p.valores) as (keyof typeof p.valores)[]).every((k) => retoque[k] === p.valores[k]);
                          return <button key={p.nombre} className={activo ? "on" : ""} aria-pressed={activo} title={p.titulo} onClick={() => setRetoque((r) => ({ ...r, ...p.valores }))}>{p.nombre}</button>;
                        })}
                      </div>
                      {conRetoque && retoqueListo?.prep && (
                        <button className="btn btn-sm btn-fantasma" onPointerDown={() => setComparando(true)} onPointerUp={() => setComparando(false)} onPointerLeave={() => setComparando(false)} title="Mientras lo mantiene oprimido, la foto se ve sin retoque"><Eye size={13} />Mantener para comparar</button>
                      )}
                    </div>
                    {preparandoRetoque && <div className="peq tenue fila" style={{ gap: 6 }}><Loader2 size={13} className="girando" />Ubicando los rasgos de la cara…</div>}
                    {conRetoque && retoqueListo && !retoqueListo.prep && <div className="aviso error peq">{retoqueListo.fallo ? "No se pudo preparar el retoque en esta foto." : "No encontré una cara en esta foto: no se le puede hacer el retoque."}</div>}
                    <b className="peq">Piel</b>
                    {CONTROLES_PIEL.map(controlRetoque)}
                    <b className="peq">Ojos y maquillaje</b>
                    {CONTROLES_ROSTRO.map(controlRetoque)}
                    <div className="peq tenue">Solo para esta foto. No cambia la forma de la cara. Para pasaporte, cédula y visa, déjelo en «Sin retoque»: pueden rechazar una foto retocada.</div>
                    </>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card fotos-hoja">
          <div className="card-cab fotos-hoja-cab">
            <b>3. Imprimir</b><span className="peq tenue">Hoja carta, tamaño real</span>
            <div className="fotos-config" ref={cajaConfig}>
              <button type="button" className={`btn btn-sm btn-fantasma btn-icono${verConfig ? " on" : ""}`} aria-expanded={verConfig} aria-label="Configuración de la hoja" title="Configuración de la hoja: separación, filas, guías" onClick={() => setVerConfig((v) => !v)}><Settings size={16} /></button>
              {verConfig && (
                <div className="fotos-config-pop" role="dialog" aria-label="Configuración de la hoja">
                  <b className="peq">Configuración de la hoja</b>
                  <div className="pila" style={{ gap: 4 }}>
                    <span className="peq muted">Separación entre fotos (mm)</span>
                    <div className="seg seg-corto" role="group" aria-label="Separación entre fotos">
                      {SEPARACIONES.map((v) => <button key={v} className={config.separacion === v ? "on" : ""} aria-pressed={config.separacion === v} aria-label={v ? `${v} mm` : "Sin separación"} onClick={() => setConfig((c) => ({ ...c, separacion: v }))}>{v}</button>)}
                    </div>
                    <span className="peq tenue">Caben {red.columnas} por fila y {red.filas} filas: {red.porHoja} fotos por hoja.</span>
                  </div>
                  <label className="fotos-config-op"><input type="checkbox" checked={config.filaNueva} onChange={(e) => setConfig((c) => ({ ...c, filaNueva: e.target.checked }))} /><span>Cada persona empieza en una fila nueva<small>Más fácil de recortar por persona</small></span></label>
                  <label className="fotos-config-op"><input type="checkbox" checked={config.guias} onChange={(e) => setConfig((c) => ({ ...c, guias: e.target.checked }))} /><span>Guías de corte<small>La línea gris alrededor de cada foto</small></span></label>
                  <span className="peq tenue">Queda guardada en este PC.</span>
                </div>
              )}
            </div>
          </div>
          <div className="card-cuerpo pila" style={{ gap: 12 }}>
            <div className="pila" style={{ gap: 6 }}>
              <span className="peq muted">Fotos por persona</span>
              <div className="fila-wrap" style={{ gap: 8 }}>
                <div className="seg">
                  {CANTIDADES.map((n) => <button key={n} className={cantidad === n ? "on" : ""} onClick={() => { setCantidad(n); setOtra(null); }}>{n}</button>)}
                  <button className={cantidad === red.porHoja ? "on" : ""} onClick={() => { setCantidad(red.porHoja); setOtra(null); }} title="Toda la hoja con la misma persona">Hoja completa ({red.porHoja})</button>
                </div>
                <label className="fotos-otra" title={`De 1 a ${red.porHoja}`}>Otra
                  <input className="input" type="number" min={1} max={red.porHoja} value={otra ?? cantidad} onChange={(e) => setOtra(e.target.value)} onBlur={tomarOtra} onKeyDown={(e) => { if (e.key === "Enter") tomarOtra(); }} aria-label="Cuántas fotos por persona" />
                </label>
              </div>
            </div>
            {!hoja.length ? (
              <>
                <HojaMini guias={config.guias} fotos={posiciones(cantidad, config).map((p) => ({ ...p, url: fotoUrl }))} />
                <button className="btn btn-primario" disabled={!foto} onClick={imprimir}><Printer size={16} />Imprimir</button>
                <button className="btn btn-sm" disabled={!foto} onClick={descargarHoja}><Download size={13} />Descargar la hoja (JPG)</button>
                <div className="fotos-compartir">
                  <div className="peq muted"><Users size={13} /> ¿Varias personas? Póngalas en la misma hoja (hasta {red.porHoja} fotos por hoja).</div>
                  <button className="btn btn-sm" disabled={!foto} onClick={agregarAHoja}><Plus size={13} />Agregar a la hoja compartida</button>
                </div>
              </>
            ) : (
              <>
                <div className="peq"><Users size={13} /> Hoja compartida: <b>{hoja.length} persona{hoja.length === 1 ? "" : "s"}</b>, {totalFotos} fotos{hojas.length > 1 ? ` en ${hojas.length} hojas` : ` de ${red.porHoja}`}</div>
                {hojasConActual.map((h, k) => (
                  <div key={k} className="pila" style={{ gap: 4 }}>
                    {hojasConActual.length > 1 && <span className="peq tenue">Hoja {k + 1}</span>}
                    <HojaMini guias={config.guias} fotos={h.map((u) => ({ x: u.x, y: u.y, url: u.persona.url, tenue: u.persona.id === "actual", id: u.persona.id === "actual" ? undefined : u.persona.id, elegida: u.persona.id === elegidaHoja }))} elegir={(id) => setElegidaHoja((x) => (x === id ? null : id))} />
                  </div>
                ))}
                {foto && <div className="peq tenue">En tenue: dónde quedaría la persona abierta.</div>}
                <div className="peq tenue">Toque una persona (en la hoja o abajo) para cambiarle las copias o el orden.</div>
                <div className="fotos-miniaturas fotos-personas" aria-label="Personas en la hoja">
                  {hoja.map((p, i) => (
                    <div key={p.id} className={`fotos-mini${elegidaHoja === p.id ? " on" : ""}`}>
                      <button type="button" className="fotos-mini-abrir" onClick={() => setElegidaHoja((x) => (x === p.id ? null : p.id))} aria-pressed={elegidaHoja === p.id} aria-label={`Elegir a la persona ${i + 1}`}><img src={p.url} alt={`Persona ${i + 1}`} /></button>
                      <span className="fotos-mini-copias">{p.copias}</span>
                      <button className="fotos-mini-editar" onClick={() => void editarPersona(p)} title="Editar a esta persona" aria-label={`Editar a la persona ${i + 1}`}><Pencil size={11} /></button>
                      <button className="fotos-mini-quitar" onClick={() => quitarDeHoja(p)} title="Quitar de la hoja" aria-label={`Quitar a la persona ${i + 1} de la hoja`}><X size={12} /></button>
                    </div>
                  ))}
                </div>
                {(() => {
                  const i = hoja.findIndex((p) => p.id === elegidaHoja);
                  if (i < 0) return null;
                  const p = hoja[i];
                  return (
                    <div className="fotos-persona-elegida" role="group" aria-label={`Persona ${i + 1}`}>
                      <b className="peq">Persona {i + 1}</b>
                      <span className="fila" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-icono" onClick={() => copiasDe(p.id, -1)} disabled={p.copias <= 1} aria-label="Una copia menos">−</button>
                        <span className="peq" style={{ minWidth: 64, textAlign: "center" }}><b>{p.copias}</b> {p.copias === 1 ? "foto" : "fotos"}</span>
                        <button className="btn btn-sm btn-icono" onClick={() => copiasDe(p.id, 1)} disabled={p.copias >= red.porHoja} aria-label="Una copia más">+</button>
                      </span>
                      <span className="fila" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-icono" onClick={() => moverPersona(p.id, -1)} disabled={i === 0} aria-label="Mover antes" title="Antes"><ArrowLeft size={13} /></button>
                        <button className="btn btn-sm btn-icono" onClick={() => moverPersona(p.id, 1)} disabled={i === hoja.length - 1} aria-label="Mover después" title="Después"><ArrowRight size={13} /></button>
                      </span>
                      <button className="btn btn-sm" onClick={() => void editarPersona(p)}><Pencil size={13} />Editar</button>
                      <button className="btn btn-sm btn-fantasma" onClick={() => { quitarDeHoja(p); setElegidaHoja(null); }}><Trash2 size={13} />Quitar</button>
                    </div>
                  );
                })()}
                {editando && hoja.some((p) => p.id === editando)
                  ? <span className="fila-wrap" style={{ gap: 6 }}>
                      <button className="btn btn-primario" disabled={!foto} onClick={agregarAHoja}><Pencil size={15} />Guardar los cambios (persona {hoja.findIndex((p) => p.id === editando) + 1})</button>
                      <button className="btn btn-fantasma" onClick={() => { setEditando(null); cerrarActual(); }}>Cancelar</button>
                    </span>
                  : <button className="btn" disabled={!foto} onClick={agregarAHoja}><Plus size={15} />Agregar esta persona ({cantidad} fotos)</button>}
                <button className="btn btn-primario" onClick={imprimirHoja}><Printer size={16} />Imprimir la hoja compartida{hojas.length > 1 ? ` (${hojas.length} hojas)` : ""}</button>
                <div className="fila-wrap" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={descargarCompartida}><Download size={13} />Descargar (JPG)</button>
                  {foto && <button className="btn btn-sm" onClick={imprimir} title="Imprime solo a la persona abierta, en su propia hoja"><Printer size={13} />Solo esta persona</button>}
                  <button className="btn btn-sm btn-fantasma" onClick={vaciarHoja}><Trash2 size={13} />Vaciar la hoja</button>
                </div>
              </>
            )}
            <div className="fila-wrap fotos-hoja-pie">
              <span className="peq tenue">En la ventana de impresión: tamaño <b>Carta</b>, escala <b>100 %</b> (no "Ajustar"), márgenes <b>Ninguno</b>.</span>
              <button type="button" className="btn btn-sm" disabled={enInicio} onClick={restablecer} title="6 fotos por persona, sin separación, sin fila nueva y con guías de corte"><RotateCcw size={13} />Restablecer todo</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Vista en miniatura de una hoja carta con las fotos en su sitio; tocar una foto elige a su persona. */
function HojaMini({ fotos, guias = true, elegir }: { fotos: { x: number; y: number; url: string | null; tenue?: boolean; id?: string; elegida?: boolean }[]; guias?: boolean; elegir?: (id: string) => void }) {
  return (
    <div className={`hoja-mini${guias ? "" : " sin-guias"}`} aria-label="Vista de la hoja">
      {fotos.map((p, i) => (
        <div key={i} className={[p.tenue ? "tenue-hoja" : "", p.elegida ? "elegida" : "", p.id && elegir ? "tocable" : ""].filter(Boolean).join(" ") || undefined} data-persona={p.id}
          onClick={p.id && elegir ? () => elegir(p.id!) : undefined}
          style={{ left: `${(p.x / 215.9) * 100}%`, top: `${(p.y / 279.4) * 100}%`, width: `${(30 / 215.9) * 100}%`, height: `${(40 / 279.4) * 100}%` }}>
          {p.url && <img src={p.url} alt="" />}
        </div>
      ))}
    </div>
  );
}

function Control({ nombre, menos, mas, etiquetas = ["Más pequeña", "Más grande"] }: { nombre: string; menos: () => void; mas: () => void; etiquetas?: [string, string] }) {
  return (
    <div className="pila" style={{ gap: 4 }}>
      <span className="peq muted">{nombre}</span>
      <div className="fila" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={menos}>{etiquetas[0]}</button>
        <button className="btn btn-sm" onClick={mas}>{etiquetas[1]}</button>
      </div>
    </div>
  );
}

function Deslizador({ nombre, valor, min, max, unidad = "", extremos, alCambiar }: { nombre: string; valor: number; min: number; max: number; unidad?: string; extremos?: [string, string]; alCambiar: (v: number) => void }) {
  return (
    <label className="fotos-deslizador">
      <span className="peq muted">{nombre}</span>
      <input type="range" min={min} max={max} step={5} value={valor} onChange={(e) => alCambiar(Number(e.target.value))} aria-label={nombre} />
      <span className="peq tenue">{valor > 0 && min < 0 ? "+" : ""}{valor}{unidad}</span>
      {extremos && <span className="fotos-extremos"><span>{extremos[0]}</span><span>{extremos[1]}</span></span>}
    </label>
  );
}
