import { ArrowLeft, ArrowRight, Check, Copy, Download, ImagePlus, Loader2, Maximize, Printer, RotateCcw, RotateCw, Save, Share2, Trash2, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import type { Composicion } from "../../compartido/composicion";
import { imprimirPdf } from "../logica/imprimir";
import { Fragment, useEffect, useRef, useState } from "react";
import { BotonPegar, usePegarImagenes } from "./Pegar";
import { useUI } from "./ui";
import { AjusteEsquinas, FILTROS, type Editando } from "../escaner/AjusteEsquinas";
import { armarPdf, cargarImagen, detectarBordes, detectarTarjetas, type Esquinas, fotoCompleta, girar, juntarCaras, precargarTarjetas, procesarPagina, recuadro, vistaHojasTarjeta, vistaPrevia } from "../escaner/procesar";
import { mensajeDe } from "../datos/escribir";
import { sincronizarAhora } from "../datos/sincronizacion";
import { DatosLeidos } from "./DatosLeidos";
import { CopiarCaras } from "../escaner/CopiarCaras";

/*
 * Escanear en el PC desde fotos (las que mandan por WhatsApp, o una fotocopia mal sacada). De entrada cada foto se
 * acomoda sola: se busca el documento, se recorta, se endereza y se limpia como en el escáner del celular (si no se
 * encuentra, va la foto completa). Cada parte se puede girar ahí mismo o tocar para ajustarla (esquinas, giro, filtro),
 * viendo cómo queda mientras se ajusta. Con "Acomodar solas" apagado, cada foto se ajusta a mano antes de agregarla.
 * En "Cédula o tarjeta", las caras van de a dos (frente y respaldo) en una hoja carta, al 100 % o al 150 % (se ve cómo
 * sale la hoja), y de cada par se pueden leer los datos. Una misma foto puede dar varias caras: "Recortar otra parte".
 * El PDF queda en el Escáner (la lista de abajo) o se descarga.
 * Con `editar`, se abre un escaneo ya guardado (lo que llegó del celular): sus caras u hojas entran como partes, tal
 * cual, para girarlas, recortarlas, cambiarles el filtro o el orden; "Guardar cambios" reemplaza ese mismo escaneo.
 * Desde un trámite (sus archivos): `ordenadas`, en el orden de los documentos (las páginas ya escaneadas entran tal
 * cual; las fotos se acomodan solas) y `pdfsExtra` (PDF sin fotos adentro: van al final tal cual); `destino` es el botón
 * principal (guardarlo en el trámite, o reemplazar el archivo que se edita). "Compartir" lo manda (WhatsApp, correo...) donde el equipo lo deje.
 */

export type Modo = "hoja" | "tarjeta";
/** Una parte ya escaneada, con su foto y su ajuste, para volver a ajustarla. */
/** De qué documento del trámite sale una parte (para la receta del consolidado: volver a abrirla desde el original). */
export interface FuenteParte { doc: string; clave: string; nombre: string; pagina: number | null }
/** Una foto con que se abre el escáner: tal cual (ya escaneada), para acomodarla sola, o con su ajuste guardado. */
export interface Entrada { foto: File; tal: boolean; fuente?: FuenteParte; ajuste?: { esquinas: [number, number][]; filtro: string; giros: number; ancho: number; alto: number } }
interface Parte { id: number; url: string; origen: Editando; fuente?: FuenteParte }
/** El ajuste abierto: una foto nueva o una parte que ya estaba (`reemplaza`, su id). `otras`: las demás tarjetas que se
 * encontraron en la misma foto (la fotocopia con las dos caras): se abren solas, una tras otra. */
type EnAjuste = Editando & { reemplaza?: number; otras?: Esquinas[] };

const aCanvas = (url: string) => new Promise<HTMLCanvasElement>((ok, mal) => {
  const i = new Image();
  i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d")!.drawImage(i, 0, 0); ok(c); };
  i.onerror = () => mal(new Error("No se pudo leer una página."));
  i.src = url;
});
function leerPref(clave: string, defecto: string) { try { return localStorage.getItem(clave) ?? defecto; } catch { return defecto; } }
function guardarPref(clave: string, valor: string) { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } }

/** Un escaneo guardado que se abre para editarlo: sus partes (las fotos que lleva el PDF) y cómo se hizo. */
export interface EscaneoAEditar { id: string; nombre: string; fotos: File[]; escala?: number }
/** A dónde va lo escaneado (el botón principal), en vez del Escáner. */
export interface DestinoEscaneo { boton: string; guardar: (pdf: File, composicion: Composicion) => Promise<void> }

/**
 * `iniciales`: las fotos con que se abre (las que se pegaron o soltaron en la pantalla del Escáner); `modoInicial`: lo
 * que se eligió allá (cédula o documento). `editar`: un escaneo guardado (ver arriba).
 */
export function EscanearFotos({ cerrar, alGuardar, iniciales, modoInicial = "tarjeta", editar, ordenadas, pdfsExtra = [], destino, titulo: tituloCaja, nombreInicial, escalaInicial }: {
  cerrar: () => void; alGuardar: () => void; iniciales?: File[]; modoInicial?: Modo; editar?: EscaneoAEditar;
  ordenadas?: Entrada[]; pdfsExtra?: { nombre: string; bytes: ArrayBuffer; doc?: string | null }[]; destino?: DestinoEscaneo; titulo?: string; nombreInicial?: string; escalaInicial?: number;
}) {
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [auto, setAuto] = useState(() => leerPref("escaner-auto", "1") === "1");
  const [escala, setEscala] = useState(() => escalaInicial ?? editar?.escala ?? (leerPref("escaner-escala", "1.5") === "1" ? 1 : 1.5));
  const [cola, setCola] = useState<File[]>([]);
  const [editando, setEditando] = useState<EnAjuste | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [hojas, setHojas] = useState<string[]>([]);
  const [nombre, setNombre] = useState(editar?.nombre ?? nombreInicial ?? "");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const { confirmar } = useUI();
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const siguiente = useRef(1);

  useEffect(() => { if (modo === "tarjeta") precargarTarjetas(); }, [modo]);
  /**
   * Abre una foto: busca el documento (en cédula o tarjeta, todas las de la foto: una parte por cada una).
   * `completa`: si no lo encuentra, toma la foto entera (sin recortar nada).
   */
  async function preparar(archivo: File, completa: boolean): Promise<Editando[]> {
    const foto = await cargarImagen(archivo);
    const base = { foto, vista: foto.toDataURL("image/jpeg", 0.7), filtro: (modo === "tarjeta" ? "color" : "documento") as Editando["filtro"], giros: 0 };
    const sinHallar = completa ? fotoCompleta(foto.width, foto.height) : recuadro(foto.width, foto.height);
    if (modo === "tarjeta") {
      const d = await detectarTarjetas(foto);
      return d.encontrada ? d.tarjetas.map((esquinas) => ({ ...base, esquinas, encontrada: true })) : [{ ...base, esquinas: sinHallar, encontrada: false }];
    }
    const d = detectarBordes(foto, modo);
    return [{ ...base, esquinas: d.encontrada || !completa ? d.esquinas : sinHallar, encontrada: d.encontrada }];
  }
  async function abrir(archivo: File) {
    setOcupado("Buscando el documento en la foto…");
    try { const [e, ...otras] = await preparar(archivo, false); setEditando({ ...e, otras: otras.map((x) => x.esquinas) }); } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  /** Automático: cada foto se acomoda sola y queda agregada; la que no quedó bien se toca para ajustarla. */
  async function acomodar(fotos: File[], fuente?: FuenteParte) {
    try {
      for (let i = 0; i < fotos.length; i++) {
        setOcupado(fotos.length > 1 ? `Acomodando la foto ${i + 1} de ${fotos.length}…` : "Acomodando la foto…");
        await new Promise((r) => setTimeout(r, 30));
        for (const e of await preparar(fotos[i], true)) {
          const c = procesarPagina(e.foto, e.esquinas, e.filtro, e.giros, modo);
          setPartes((p) => [...p, { id: siguiente.current++, url: c.toDataURL("image/jpeg", 0.88), origen: e, fuente }]);
        }
      }
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  const zona = useRef<HTMLDivElement>(null);
  usePegarImagenes(zona, (f) => agregarArchivos(f));
  // Las fotos con que se abrió entran una sola vez (las de un escaneo que se edita, tal cual: ya están recortadas).
  const yaEntraron = useRef(false);
  useEffect(() => {
    if (yaEntraron.current || !(iniciales?.length || editar || ordenadas?.length)) return;
    yaEntraron.current = true;
    if (ordenadas?.length) void (async () => { for (const x of ordenadas) await (x.ajuste ? abrirConAjuste(x) : x.tal ? abrirGuardado([x.foto], x.fuente) : acomodar([x.foto], x.fuente)); })();
    else if (editar) void abrirGuardado(editar.fotos);
    else if (iniciales) agregarArchivos(iniciales);
  });
  /** Una página de un consolidado, desde su original y con el ajuste que tenía (se puede reencuadrar de verdad). */
  async function abrirConAjuste(x: Entrada) {
    setOcupado("Abriendo los documentos…");
    try {
      const foto = await cargarImagen(x.foto);
      const a = x.ajuste!, kx = foto.width / a.ancho, ky = foto.height / a.alto;
      const esquinas = a.esquinas.map(([px, py]) => ({ x: px * kx, y: py * ky })) as Esquinas;
      const filtro = (FILTROS.some(([f]) => f === a.filtro) ? a.filtro : "original") as Editando["filtro"];
      const origen: Editando = { foto, vista: foto.toDataURL("image/jpeg", 0.7), esquinas, encontrada: true, filtro, giros: a.giros };
      const url = procesarPagina(foto, esquinas, filtro, a.giros, modo).toDataURL("image/jpeg", 0.88);
      setPartes((p) => [...p, { id: siguiente.current++, url, origen, fuente: x.fuente }]);
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  async function abrirGuardado(fotos: File[], fuente?: FuenteParte) {
    setOcupado("Abriendo el escaneo…");
    try {
      for (const f of fotos) {
        const foto = await cargarImagen(f);
        const origen: Editando = { foto, vista: foto.toDataURL("image/jpeg", 0.7), esquinas: fotoCompleta(foto.width, foto.height), encontrada: true, filtro: "original", giros: 0 };
        setPartes((p) => [...p, { id: siguiente.current++, url: foto.toDataURL("image/jpeg", 0.92), origen, fuente }]);
      }
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  function agregarArchivos(lista: FileList | File[]) {
    setError(null); setGuardado(null);
    const fotos = [...lista].filter((f) => f.type.startsWith("image/"));
    if (!fotos.length) return setError("Elija fotos (JPG o PNG).");
    if (auto) { void acomodar(fotos); return; }
    if (editando) setCola((c) => [...c, ...fotos]);
    else { setCola(fotos.slice(1)); abrir(fotos[0]); }
  }
  /** Agrega (o cambia, si era una parte que ya estaba) lo ajustado. `otraParte`: la misma foto sigue abierta para otra cara. */
  async function terminar(otraParte = false) {
    if (!editando) return;
    setOcupado("Enderezando y limpiando…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { reemplaza, otras, ...origen } = editando;
      const url = procesarPagina(origen.foto, origen.esquinas, origen.filtro, origen.giros, modo).toDataURL("image/jpeg", 0.88);
      if (reemplaza !== undefined) setPartes((p) => p.map((x) => (x.id === reemplaza ? { ...x, url, origen } : x)));
      else setPartes((p) => [...p, { id: siguiente.current++, url, origen }]);
      // Otra tarjeta de la misma foto: la siguiente que se encontró (o un recuadro para marcarla a mano).
      if (otras?.length) setEditando({ ...origen, esquinas: otras[0], otras: otras.slice(1), encontrada: true, giros: 0 });
      else if (otraParte) setEditando({ ...origen, esquinas: recuadro(origen.foto.width, origen.foto.height), encontrada: false, giros: 0 });
      else if (cola.length && reemplaza === undefined) { const [f, ...resto] = cola; setCola(resto); setEditando(null); await abrir(f); }
      else setEditando(null);
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  /**
   * Pasar a otra parte mientras se ajusta una (del frente al respaldo y de vuelta, cuantas veces se quiera): lo que se
   * lleva de la abierta se guarda solo (sin "Listo") y se abre la otra, para ir viendo cómo queda la hoja.
   */
  function cambiarA(id: number) {
    if (editando?.reemplaza === id) return;
    const destino = partes.find((x) => x.id === id);
    if (!destino) return;
    if (editando?.reemplaza !== undefined) {
      const { reemplaza, otras: _otras, ...origen } = editando;
      try {
        const url = procesarPagina(origen.foto, origen.esquinas, origen.filtro, origen.giros, modo).toDataURL("image/jpeg", 0.88);
        setPartes((p) => p.map((x) => (x.id === reemplaza ? { ...x, url, origen } : x)));
      } catch (e) { setError(mensajeDe(e)); return; }
    }
    setEditando({ ...destino.origen, reemplaza: id });
  }
  function saltar() {
    if (cola.length && editando?.reemplaza === undefined) { const [f, ...resto] = cola; setCola(resto); setEditando(null); abrir(f); }
    else setEditando(null);
  }
  const mover = (i: number, d: -1 | 1) => setPartes((p) => { const q = [...p]; [q[i], q[i + d]] = [q[i + d], q[i]]; return q; });
  /** Gira una parte ya hecha (a la derecha o a la izquierda), sin volver a procesar la foto. */
  async function girarParte(id: number, sentido: 1 | -1) {
    const p = partes.find((x) => x.id === id);
    if (!p) return;
    let c = await aCanvas(p.url);
    for (let i = 0; i < (sentido === 1 ? 1 : 3); i++) c = girar(c);
    const url = c.toDataURL("image/jpeg", 0.9);
    setPartes((l) => l.map((x) => (x.id === id ? { ...x, url, origen: { ...x.origen, giros: x.origen.giros + sentido } } : x)));
  }

  // Cómo queda mientras se ajusta (las esquinas, el giro, el filtro), un momento después de cada cambio.
  useEffect(() => {
    if (!editando) { setPrevia(null); return; }
    const t = setTimeout(() => { try { setPrevia(vistaPrevia(editando.foto, editando.esquinas, editando.filtro, editando.giros, modo)); } catch { setPrevia(null); } }, 120);
    return () => clearTimeout(t);
  }, [editando, modo]);
  // Cédula o tarjeta: las hojas como van a salir, con la escala elegida.
  useEffect(() => {
    if (modo !== "tarjeta" || !partes.length) { setHojas([]); return; }
    let vivo = true;
    Promise.all(partes.map((p) => aCanvas(p.url))).then((cs) => vistaHojasTarjeta(cs, escala, 260)).then((h) => { if (vivo) setHojas(h); }, () => {});
    return () => { vivo = false; };
  }, [partes, escala, modo]);

  const titulo = nombre.trim() || (modo === "tarjeta" ? "Cédula" : "Documento escaneado");
  /** El PDF: las partes escaneadas y, al final, los PDF que van tal cual. */
  const pdf = async () => {
    const hecho = await armarPdf(await Promise.all(partes.map((p) => aCanvas(p.url))), modo, titulo, escala);
    if (!pdfsExtra.length) return hecho;
    const salida = await PDFDocument.load(hecho);
    for (const x of pdfsExtra) {
      const otro = await PDFDocument.load(x.bytes, { ignoreEncryption: true });
      for (const pg of await salida.copyPages(otro, otro.getPageIndices())) salida.addPage(pg);
    }
    return salida.save();
  };
  const archivoPdf = async () => new File([(await pdf()) as BlobPart], `${titulo}.pdf`, { type: "application/pdf" });
  /** La receta de lo que se guarda: de dónde sale cada página y cómo quedó (para volver a editarlo desde los originales). */
  const composicion = (): Composicion => ({
    v: 1, modo, escala,
    partes: partes.map((p) => ({
      doc: p.fuente?.doc ?? null, clave: p.fuente?.clave ?? null, nombre: p.fuente?.nombre ?? "Foto agregada", pagina: p.fuente?.pagina ?? null,
      esquinas: p.origen.esquinas.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10] as [number, number]), filtro: p.origen.filtro, giros: p.origen.giros,
      ancho: p.origen.foto.width, alto: p.origen.foto.height,
    })),
    extras: pdfsExtra.map((x) => ({ doc: x.doc ?? null, nombre: x.nombre })),
  });
  async function guardarEnDestino() {
    if (!destino) return;
    setOcupado("Guardando…"); setError(null);
    try { await destino.guardar(await archivoPdf(), composicion()); alGuardar(); } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  /** Mandarlo (WhatsApp, correo...) con el menú de compartir del equipo; si no hay, se descarga. */
  async function compartir() {
    setOcupado("Preparando el PDF…"); setError(null);
    try {
      const f = await archivoPdf();
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: titulo });
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  async function guardarEnEscaner() {
    setOcupado("Guardando el escaneo…"); setError(null);
    try {
      const n = modo === "tarjeta" ? Math.ceil(partes.length / 2) : partes.length;
      const params = `nombre=${encodeURIComponent(titulo)}&paginas=${n}&modo=${modo}&escala=${escala}`;
      const r = await fetch(editar ? `/api/escaneos/${editar.id}?${params}` : `/api/escaneos?${params}&origen=pc`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/pdf" }, body: new Blob([(await pdf()) as BlobPart], { type: "application/pdf" }) });
      if (!r.ok) throw new Error(String(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo guardar (${r.status}).`));
      setGuardado(titulo);
      alGuardar();
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  /** Imprimir de una (sin descargar ni guardar): el mismo PDF, directo a la impresora. */
  async function imprimir() {
    setOcupado("Preparando para imprimir…"); setError(null);
    try { imprimirPdf(await pdf()); } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  async function descargar() {
    setOcupado("Preparando el PDF…");
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([(await pdf()) as BlobPart], { type: "application/pdf" }));
      a.download = `${titulo}.pdf`;
      a.click();
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  }
  function empezar() { setPartes([]); setNombre(""); setGuardado(null); setError(null); setCola([]); setEditando(null); }
  /** Un escaneo nuevo (lo pegado o elegido se quita); si este no se guardó, pregunta antes. */
  async function nuevoEscaneo() {
    if (!guardado && !(await confirmar({ titulo: "¿Empezar un escaneo nuevo?", texto: `Se quitan las ${partes.length} parte(s) de este escaneo; no se ha guardado en el Escáner (si ya lo imprimió o descargó, no pasa nada).`, boton: "Empezar de nuevo", peligro: true }))) return;
    empezar();
  }

  const pares = modo === "tarjeta" ? Array.from({ length: Math.ceil(partes.length / 2) }, (_, i) => partes.slice(i * 2, i * 2 + 2)) : [];
  const nombreParte = (i: number) => (modo === "tarjeta" ? `${i % 2 ? "Respaldo" : "Frente"} ${Math.floor(i / 2) + 1}` : `Pág. ${i + 1}`);
  const cambiando = editando?.reemplaza !== undefined ? partes.findIndex((p) => p.id === editando.reemplaza) : -1;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-cab">
        <b>{tituloCaja ?? (editar ? `Editar «${editar.nombre}»` : "Escanear desde fotos")}</b>
        <button className="btn btn-sm btn-fantasma btn-icono" onClick={cerrar} aria-label="Cerrar"><X size={15} /></button>
      </div>
      <div className="card-cuerpo pila" style={{ gap: 12 }}>
        <div className="fila-wrap" style={{ gap: 12, alignItems: "center" }}>
          <div className="seg" role="group" aria-label="Tipo de documento">
            <button className={modo === "tarjeta" ? "on" : ""} aria-pressed={modo === "tarjeta"} disabled={partes.length > 0} onClick={() => setModo("tarjeta")}>Cédula o tarjeta</button>
            <button className={modo === "hoja" ? "on" : ""} aria-pressed={modo === "hoja"} disabled={partes.length > 0} onClick={() => setModo("hoja")}>Documento (hojas)</button>
          </div>
          <label className="fila escaneo-auto" title="Cada foto se recorta, se endereza y se limpia sola. La que no quede bien, tóquela para ajustarla.">
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); guardarPref("escaner-auto", e.target.checked ? "1" : "0"); }} />Acomodar solas (automático)
          </label>
          {modo === "tarjeta" && (
            <div className="fila" style={{ gap: 6 }}>
              <span className="peq muted">Tamaño en la hoja</span>
              <div className="seg" role="group" aria-label="Tamaño en la hoja">
                {([[1, "100 % (real)"], [1.5, "150 %"]] as const).map(([v, t]) => (
                  <button key={v} className={escala === v ? "on" : ""} aria-pressed={escala === v} onClick={() => { setEscala(v); guardarPref("escaner-escala", String(v)); }}>{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="peq tenue">{auto
          ? modo === "tarjeta"
            ? "Suba o pegue las fotos en orden (frente y respaldo de cada cédula): se acomodan solas. Gire cada una con sus flechas o tóquela para ajustarla viendo cómo queda."
            : "Suba o pegue las fotos (una por hoja): se acomodan solas. Gire cada una con sus flechas o tóquela para ajustarla viendo cómo queda."
          : modo === "tarjeta"
            ? "Suba las fotos en orden: frente y respaldo de cada cédula. Si una foto trae las dos caras (una fotocopia), salen las dos solas; si falta alguna, use «Recortar otra parte de esta foto»."
            : "Una foto por hoja. Ajuste las esquinas a las puntas de la hoja."}</span>

        {editando ? (
          <div className="escaneo-pc">
            <div className="pila" style={{ gap: 6 }}>
              <span className="peq muted">La foto: lleve cada esquina a una punta del documento</span>
              <AjusteEsquinas e={editando} cambiar={(esquinas) => setEditando({ ...editando, esquinas })} />
            </div>
            <div className="pila" style={{ gap: 10 }}>
              <span className="peq muted">Así queda{cambiando >= 0 ? ` (${nombreParte(cambiando)})` : ""}</span>
              <div className="escaneo-previa">{previa ? <img src={previa} alt="Así queda" /> : <Loader2 size={18} className="girando" />}</div>
              <span className="peq">{editando.encontrada ? "Revise que las esquinas caigan en las puntas del documento; arrástrelas si hace falta." : "Si no quedó bien, lleve cada esquina a una punta."}{cola.length ? ` Quedan ${cola.length} foto(s).` : ""}</span>
              <div className="seg" role="group" aria-label="Filtro">
                {FILTROS.map(([f, n]) => <button key={f} className={editando.filtro === f ? "on" : ""} aria-pressed={editando.filtro === f} onClick={() => setEditando({ ...editando, filtro: f })}>{n}</button>)}
              </div>
              <div className="fila-wrap" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setEditando({ ...editando, giros: editando.giros - 1 })} aria-label="Girar a la izquierda"><RotateCcw size={13} />Izquierda</button>
                <button className="btn btn-sm" onClick={() => setEditando({ ...editando, giros: editando.giros + 1 })} aria-label="Girar a la derecha"><RotateCw size={13} />Derecha</button>
                <button className="btn btn-sm" onClick={() => { const { width: w, height: h } = editando.foto; setEditando({ ...editando, esquinas: fotoCompleta(w, h) }); }}><Maximize size={13} />Foto completa</button>
              </div>
              <div className="fila-wrap" style={{ gap: 6 }}>
                <button className="btn btn-primario" disabled={!!ocupado} onClick={() => terminar()}>{ocupado ? <Loader2 size={14} className="girando" /> : <Check size={14} />}{cambiando >= 0 ? "Listo, guardar el cambio" : "Listo, agregar"}</button>
                <button className="btn" disabled={!!ocupado} onClick={() => terminar(true)}><Copy size={14} />{cambiando >= 0 ? "Guardar y recortar otra parte de esta foto" : "Agregar y recortar otra parte de esta foto"}</button>
                <button className="btn btn-fantasma" disabled={!!ocupado} onClick={saltar}>{cambiando >= 0 ? "Cancelar" : "No usar esta foto"}</button>
              </div>
            </div>
          </div>
        ) : (
          <div ref={zona} className={`zona ${encima ? "encima" : ""}`} onClick={() => entrada.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
            onDrop={(e) => { e.preventDefault(); setEncima(false); agregarArchivos(e.dataTransfer.files); }}>
            <input ref={entrada} type="file" accept="image/*" multiple aria-label="Fotos para escanear" onChange={(e) => { if (e.target.files) agregarArchivos(e.target.files); e.target.value = ""; }} />
            <span className="fila"><ImagePlus size={18} /><b>{partes.length ? "Agregar más fotos" : "Elija o arrastre las fotos"}</b></span>
            <span className="peq tenue">{auto ? "Varias a la vez: se acomodan solas." : "Varias a la vez: se ajustan una por una."} También puede pegar con Ctrl+V una imagen copiada.</span>
            <BotonPegar recibir={(f) => agregarArchivos(f)} />
          </div>
        )}
        {ocupado && !editando && <div className="aviso info"><Loader2 size={14} className="girando" />{ocupado}</div>}

        {partes.length > 0 && (
          <div className="escaneo-paginas" aria-label="Partes escaneadas">
            {partes.map((p, i) => (
              <div key={p.id} className={`escaneo-pagina${editando?.reemplaza === p.id ? " en-ajuste" : ""}`}>
                <button type="button" className="escaneo-miniatura" title={editando?.reemplaza !== undefined ? "Pasar a esta parte (lo que lleva la abierta se guarda solo)" : "Tocar para ajustarla: esquinas, giro y filtro, viendo cómo queda"} aria-label={`Ajustar ${nombreParte(i)}`} disabled={!!editando && editando.reemplaza === undefined} onClick={() => cambiarA(p.id)}>
                  <img src={p.url} alt={nombreParte(i)} />
                </button>
                <span>{nombreParte(i)}</span>
                <div className="fila" style={{ gap: 2 }}>
                  <button className="btn btn-sm btn-fantasma btn-icono" disabled={!!editando} aria-label={`Girar ${nombreParte(i)} a la izquierda`} title="Girar a la izquierda" onClick={() => girarParte(p.id, -1)}><RotateCcw size={13} /></button>
                  <button className="btn btn-sm btn-fantasma btn-icono" disabled={!!editando} aria-label={`Girar ${nombreParte(i)} a la derecha`} title="Girar a la derecha" onClick={() => girarParte(p.id, 1)}><RotateCw size={13} /></button>
                  <button className="btn btn-sm btn-fantasma btn-icono" disabled={i === 0 || !!editando} aria-label={`Mover la parte ${i + 1} antes`} onClick={() => mover(i, -1)}><ArrowLeft size={13} /></button>
                  <button className="btn btn-sm btn-fantasma btn-icono" disabled={i === partes.length - 1 || !!editando} aria-label={`Mover la parte ${i + 1} después`} onClick={() => mover(i, 1)}><ArrowRight size={13} /></button>
                  <button className="btn btn-sm btn-fantasma btn-icono" disabled={!!editando} aria-label={`Quitar la parte ${i + 1}`} onClick={() => setPartes((x) => x.filter((y) => y.id !== p.id))}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hojas.length > 0 && (
          <div className="pila" style={{ gap: 6 }}>
            <span className="peq muted">Así sale en la hoja carta ({escala === 1 ? "tamaño real" : "150 %"}){modo === "tarjeta" && partes.length % 2 ? " · falta el respaldo de la última" : ""}</span>
            <div className="escaneo-hojas" aria-label="Hojas como van a salir">
              {hojas.map((h, i) => <img key={i} src={h} alt={`Hoja ${i + 1}`} />)}
            </div>
          </div>
        )}

        {pares.map((par, i) => (
          <Fragment key={par.map((p) => p.id).join("-")}>
            <CopiarCaras caras={par.map((p) => p.url)} nombre={nombre} />
            <DatosLeidos etiqueta={pares.length > 1 ? `Documento ${i + 1}` : "Documento"}
              foto={() => juntarCaras(par.map((p) => p.url))} alNombre={(n) => setNombre((x) => x || n)} alGuardar={() => { sincronizarAhora().catch(() => {}); }} />
          </Fragment>
        ))}

        {pdfsExtra.length > 0 && <span className="peq muted">Al final van tal cual {pdfsExtra.length === 1 ? "este PDF, que no trae fotos para ajustar" : "estos PDF, que no traen fotos para ajustar"}: {pdfsExtra.map((x) => x.nombre).join(", ")}.</span>}
        {(partes.length > 0 || pdfsExtra.length > 0) && (
          <>
            <label className="cot-largo">Nombre del escaneo
              <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={modo === "tarjeta" ? "Cédula Juan Pérez" : "Contrato ABC123"} />
            </label>
            {guardado && <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={14} />«{guardado}» quedó en la lista del Escáner.</div>}
            <div className="fila-wrap" style={{ gap: 8 }}>
              {destino && <button className="btn btn-primario" disabled={!!ocupado || !!editando} onClick={guardarEnDestino}><Save size={14} />{destino.boton}</button>}
              {editar && !destino && <button className="btn btn-primario" disabled={!!ocupado || !!editando} onClick={guardarEnEscaner}><Save size={14} />Guardar cambios</button>}
              <button className={editar || destino ? "btn" : "btn btn-primario"} disabled={!!ocupado || !!editando} onClick={imprimir}><Printer size={14} />Imprimir</button>
              {!editar && <button className="btn" disabled={!!ocupado || !!editando} onClick={guardarEnEscaner}><Save size={14} />Guardar en el Escáner</button>}
              <button className="btn" disabled={!!ocupado || !!editando} onClick={descargar}><Download size={14} />Descargar PDF</button>
              <button className="btn" disabled={!!ocupado || !!editando} onClick={compartir} title="Mandarlo por WhatsApp, correo... (si el equipo no deja, se descarga)"><Share2 size={14} />Compartir</button>
              {/* Siempre a la vista (también si solo se imprimió o descargó lo pegado): empezar otro desde cero. */}
              {!editar && !destino && <button className={guardado ? "btn btn-primario" : "btn"} disabled={!!ocupado} onClick={() => void nuevoEscaneo()}><RotateCcw size={14} />Nuevo escaneo</button>}
            </div>
          </>
        )}
        {error && <div className="aviso error">{error}</div>}
      </div>
    </div>
  );
}
