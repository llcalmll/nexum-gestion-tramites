import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, Download, ExternalLink, FilePlus2, FileScan, ImagePlus, Loader2, Monitor, Paperclip, Pencil, Printer, SlidersHorizontal, Smartphone, Sparkles, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AumentoResolucion } from "../componentes/AumentoResolucion";
import { EscanearFotos, type EscaneoAEditar, type Modo } from "../componentes/EscanearFotos";
import { imagenesDelPdf } from "../escaner/pdfImagenes";
import { useOpcionesTramites } from "../logica/opcionesTramites";
import { Buscador, Campo, Texto } from "../componentes/formulario";
import { BotonPegar, usePegarImagenes } from "../componentes/Pegar";
import { nuevaHoja, Registrador, type Hoja, type InicioManual } from "../componentes/Registrador";
import { leerVisto, marcarVisto } from "../componentes/PestanasFotos";
import { Cabecera, Panel, useUI } from "../componentes/ui";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { prepararFoto } from "../logica/foto";
import { fecha } from "../logica/formato";

/*
 * El Escáner tiene dos entradas con el mismo peso, arriba:
 *  - Desde este PC: las fotos que mandan por WhatsApp (copiar y pegar con Ctrl+V en cualquier parte de la pantalla),
 *    arrastradas o elegidas; se abre el escáner (EscanearFotos) con ellas ya cargadas.
 *  - Desde el celular: el QR abre la app "Fotos Pira" directo en Escanear documentos; lo que se envía al PC llega solo.
 * Debajo, los escaneos recibidos (del celular o guardados desde fotos): ver, imprimir, descargar, adjuntar a un trámite
 * que ya existe o crear uno nuevo con lo que la IA lea de sus hojas, cambiarles el nombre (es el del PDF al descargarlo) o editarlos (se abren en el mismo escáner del PC, con
 * sus caras u hojas, y se guardan encima). Cada uno dice de dónde vino y a qué hora ("Recibido desde el celular
 * (iPhone) hoy a las 8:47 a. m."). Se revisa cada 5 segundos con la pantalla a la vista y se borran a los 15 días.
 * Aparte, arriba, «Aumento de resolución de documentos por IA» (AumentoResolucion): lo que produce llega a esa misma
 * lista, con las mismas opciones. También se abre desde la fila de un escaneo y desde un archivo del expediente
 * (/escaneos?aumentar=<documento>; entonces ofrece guardar el resultado en ese trámite).
 */

interface Escaneo { id: string; nombre: string; paginas: number; bytes: number; subido: string; origen: "celular" | "pc" | "ia" | null; dispositivo: string | null; modo: Modo | null; escala: number | null; editado: string | null }
const peso = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const url = (id: string, descargar = false) => `/api/escaneos/${id}${descargar ? "?descargar" : ""}`;
const HORA = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
const DIA = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
/** "hoy a las 8:47 a. m.", "ayer a las…", "el 25 oct. a las…" (hora de Colombia). */
function cuando(iso: string) {
  const d = new Date(iso), hoy = new Date();
  const dia = DIA(d) === DIA(hoy) ? "hoy" : DIA(d) === DIA(new Date(hoy.getTime() - 864e5)) ? "ayer" : `el ${fecha(DIA(d))}`;
  return `${dia} a las ${HORA.format(d)}`;
}
/** De dónde vino y cuándo (y si se editó después). */
function origenDe(e: Escaneo) {
  const llego = e.origen === "celular" ? `Recibido desde el celular${e.dispositivo ? ` (${e.dispositivo})` : ""} ${cuando(e.subido)}`
    : e.origen === "pc" ? `Escaneado en el PC ${cuando(e.subido)}` : e.origen === "ia" ? `Aumentado con IA ${cuando(e.subido)}` : `Llegó ${cuando(e.subido)}`;
  return e.editado ? `${llego} · editado ${cuando(e.editado)}` : llego;
}

function imprimir(id: string) {
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  marco.src = url(id);
  marco.onload = () => { try { marco.contentWindow?.focus(); marco.contentWindow?.print(); } catch { window.open(url(id), "_blank"); } setTimeout(() => marco.remove(), 10_000); };
  document.body.appendChild(marco);
}

export default function Escaneos() {
  const { confirmar, avisar } = useUI();
  const [escaneos, setEscaneos] = useState<Escaneo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjuntando, setAdjuntando] = useState<Escaneo | null>(null);
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  // El escáner del PC abierto (con las fotos con que se abrió, si se pegaron o soltaron; o un escaneo para editarlo).
  const [desdeFotos, setDesdeFotos] = useState<{ fotos: File[]; editar?: EscaneoAEditar; modo?: Modo } | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  // El aumento de resolución abierto (con lo que se abrió, si viene de un escaneo o de un archivo del expediente).
  const [aumento, setAumento] = useState<{ fotos?: File[]; nombre?: string; deTramite?: { tramiteId: string; tipoDocumento: string } } | null>(null);
  const [guardandoEnTramite, setGuardandoEnTramite] = useState(false);
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  // Qué se va a escanear desde fotos (se recuerda): cédula o tarjeta, o documento de hojas.
  const [modo, setModoEstado] = useState<Modo>(() => { try { return localStorage.getItem("escaner-modo") === "hoja" ? "hoja" : "tarjeta"; } catch { return "tarjeta"; } });
  const setModo = (m: Modo) => { setModoEstado(m); try { localStorage.setItem("escaner-modo", m); } catch { /* sin almacenamiento */ } };
  const abrirConFotos = (fotos: File[]) => {
    const imagenes = fotos.filter((f) => f.type.startsWith("image/"));
    if (!imagenes.length) { avisar("Elija fotos (JPG o PNG).", "error"); return; }
    setDesdeFotos({ fotos: imagenes });
  };
  const pagina = useRef<HTMLDivElement>(null);
  // Ctrl+V en cualquier parte de la pantalla (la foto copiada de WhatsApp) abre el escáner con ella.
  usePegarImagenes(pagina, abrirConFotos, !desdeFotos && !aumento);
  // Los que llegaron desde la última vez que se abrió esta pantalla (o, la primera vez, desde que se abrió) son "Nuevo".
  const [vistoAntes] = useState(() => leerVisto() || new Date().toISOString());

  const cargar = useCallback(async () => {
    try {
      const { escaneos } = await api<{ escaneos: Escaneo[] }>("/api/escaneos");
      setEscaneos(escaneos);
      setError(null);
      if (escaneos[0]) marcarVisto(escaneos[0].subido);
    }
    catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: los escaneos se ven con internet." : mensajeDe(e));
    }
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 5000);
    return () => clearInterval(t);
  }, [cargar]);

  async function renombrar(id: string, nombre: string) {
    setEditando(null);
    const n = nombre.trim();
    if (!n || escaneos?.find((x) => x.id === id)?.nombre === n) return;
    setEscaneos((x) => x?.map((y) => (y.id === id ? { ...y, nombre: n } : y)) ?? null);
    try { await api(`/api/escaneos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: n }) }); }
    catch (err) { avisar(mensajeDe(err), "error"); cargar(); }
  }

  /** Abre un escaneo guardado en el escáner de arriba, con sus caras u hojas, para editarlo y guardarlo encima. */
  async function editarEscaneo(e: Escaneo) {
    setAbriendo(e.id);
    try {
      let r: Response;
      try { r = await fetch(url(e.id), { credentials: "same-origin", redirect: "manual" }); } catch { throw new Error("Sin conexión: el escaneo se abre con internet."); }
      if (r.type === "opaqueredirect" || r.status === 401) throw new Error("La sesión venció: recargue la página.");
      if (!r.ok) throw new Error(r.status === 404 ? "El escaneo ya no está (se borran a los 15 días)." : `No se pudo abrir (${r.status}).`);
      const { fotos, modo: hallado } = await imagenesDelPdf(await r.arrayBuffer());
      setDesdeFotos({ fotos: [], modo: e.modo ?? hallado, editar: { id: e.id, nombre: e.nombre, fotos, escala: e.escala ?? undefined } });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { avisar(mensajeDe(err), "error"); } finally { setAbriendo(null); }
  }
  /** Abre el aumento de resolución con las hojas de un escaneo de la lista (el escaneo sigue como está). */
  async function aumentarEscaneo(e: Escaneo) {
    setAbriendo(e.id);
    try {
      let r: Response;
      try { r = await fetch(url(e.id), { credentials: "same-origin", redirect: "manual" }); } catch { throw new Error("Sin conexión: el escaneo se abre con internet."); }
      if (r.type === "opaqueredirect" || r.status === 401) throw new Error("La sesión venció: recargue la página.");
      if (!r.ok) throw new Error(r.status === 404 ? "El escaneo ya no está (se borran a los 15 días)." : `No se pudo abrir (${r.status}).`);
      const { fotos } = await imagenesDelPdf(await r.arrayBuffer());
      setDesdeFotos(null);
      setAumento({ fotos, nombre: `${e.nombre} (aumentado)` });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { avisar(mensajeDe(err), "error"); } finally { setAbriendo(null); }
  }
  // Desde un archivo del expediente: /escaneos?aumentar=<documento>.
  const pedido = params.get("aumentar");
  useEffect(() => {
    if (!pedido) return;
    setParams({}, { replace: true });
    void (async () => {
      try {
        const doc = await db.documentos.get(pedido);
        if (!doc) throw new Error("Ese documento ya no está en el trámite.");
        const r = await fetch(`/api/documentos/${doc.id}/archivo`, { credentials: "same-origin", redirect: "manual" });
        if (r.type === "opaqueredirect" || r.status === 401) throw new Error("La sesión venció: recargue la página.");
        if (!r.ok) throw new Error(`No se pudo abrir «${doc.tipoDocumento}» (${r.status}).`);
        const b = await r.blob();
        const esPdf = b.type === "application/pdf";
        const archivo = new File([b], esPdf ? "documento.pdf" : "documento.jpg", { type: b.type });
        setAumento({ fotos: [archivo], nombre: `${doc.tipoDocumento} (aumentado)`, deTramite: { tramiteId: doc.tramiteId, tipoDocumento: `${doc.tipoDocumento} (aumentado)` } });
      } catch (err) { avisar(mensajeDe(err), "error"); }
    })();
  }, [pedido, setParams, avisar]);
  /** Lo aumentado queda como otro documento del trámite de donde vino (el original no se toca). */
  async function guardarEnTramite(id: string, destino: { tramiteId: string; tipoDocumento: string }) {
    setGuardandoEnTramite(true);
    try {
      await escribir("POST", `/api/escaneos/${id}/adjuntar`, destino);
      avisar(`«${destino.tipoDocumento}» quedó en el trámite.`);
      navegar(`/tramites/${destino.tramiteId}`);
    } catch (err) { avisar(mensajeDe(err), "error"); } finally { setGuardandoEnTramite(false); }
  }
  function alGuardar() {
    cargar();
    if (desdeFotos?.editar) { avisar(`Cambios guardados en «${desdeFotos.editar.nombre}»`); setDesdeFotos(null); }
  }

  async function borrar(e: Escaneo) {
    if (!(await confirmar({ titulo: `¿Borrar "${e.nombre}"?`, texto: "Se borra del servidor. Si ya lo adjuntó a un trámite, allá queda.", boton: "Borrar", peligro: true }))) return;
    try { await api(`/api/escaneos/${e.id}`, { method: "DELETE" }); setEscaneos((x) => x?.filter((y) => y.id !== e.id) ?? null); }
    catch (err) { avisar(mensajeDe(err), "error"); }
  }

  return (
    <>
      <Cabecera titulo="Escáner" sub="Cédulas, tarjetas y documentos: desde fotos en este PC o con el celular · los escaneos se borran a los 15 días" />
      <div className="contenido" ref={pagina}>
        {error && <div className="aviso error" style={{ marginBottom: 12 }}>{error}</div>}
        {aumento ? (
          <AumentoResolucion key={aumento.nombre ?? "nuevo"} inicial={aumento.fotos} nombreInicial={aumento.nombre} cerrar={() => setAumento(null)} alGuardar={() => { cargar(); }}
            listo={(d, otra) => (
              <div className="fila-wrap" style={{ gap: 8 }}>
                {aumento.deTramite && <button className="btn btn-primario" disabled={guardandoEnTramite} onClick={() => void guardarEnTramite(d.id, aumento.deTramite!)}>{guardandoEnTramite ? <Loader2 size={14} className="girando" /> : <Paperclip size={14} />}Guardar en el trámite de donde vino</button>}
                <button className={`btn${aumento.deTramite ? "" : " btn-primario"}`} onClick={() => setAdjuntando({ id: d.id, nombre: d.nombre } as Escaneo)}><Paperclip size={14} />Adjuntar a un trámite</button>
                <button className="btn" onClick={() => imprimir(d.id)}><Printer size={14} />Imprimir</button>
                <a className="btn" href={url(d.id)} target="_blank" rel="noreferrer"><ExternalLink size={14} />Ver</a>
                <a className="btn" href={url(d.id, true)}><Download size={14} />Descargar</a>
                <button className="btn" onClick={() => { setAumento({}); otra(); }}><Sparkles size={14} />Aumentar otro</button>
              </div>
            )} />
        ) : (
          <>
            {!desdeFotos && (
              <section className="card aumento-entrada">
                <span className="escaner-entrada-ic"><Sparkles size={18} /></span>
                <div className="principal"><b>¿Le llegó un documento borroso?</b><small>La IA lo vuelve a escribir con letra nítida, en hoja carta, para imprimirlo bien.</small></div>
                <button className="btn btn-primario aumento-boton" onClick={() => setAumento({})}><Sparkles size={16} />Aumento de resolución de documentos por IA</button>
              </section>
            )}
            {desdeFotos
              ? <EscanearFotos key={desdeFotos.editar?.id ?? "nuevo"} iniciales={desdeFotos.fotos} modoInicial={desdeFotos.modo ?? modo} editar={desdeFotos.editar} cerrar={() => setDesdeFotos(null)} alGuardar={alGuardar} />
              : <Entradas abrir={abrirConFotos} modo={modo} setModo={setModo} />}
          </>
        )}
        <div className="card">
          <div className="card-cab"><b>Escaneos recibidos{escaneos?.length ? <small className="tenue" style={{ marginLeft: 8, fontWeight: 400 }}>{escaneos.length}</small> : null}</b>
            <span className="peq tenue escaner-esperando"><i />Llegan solos del celular</span></div>
          <div className="card-cuerpo lista-filas">
            {!escaneos ? <div className="tenue"><Loader2 size={14} className="girando" /> Cargando…</div>
              : !escaneos.length ? (
                <div className="pila" style={{ alignItems: "center", gap: 6, padding: "18px 0", textAlign: "center" }}>
                  <FileScan size={24} className="tenue" />
                  <span className="muted">Todavía no hay escaneos. Los que envíe desde el celular, o guarde desde fotos, aparecen aquí.</span>
                </div>
              ) : escaneos.map((e) => (
                <div key={e.id} className="item" style={{ gap: 12 }}>
                  <FileScan size={20} className="tenue" style={{ flexShrink: 0 }} />
                  <div className="principal">
                    {editando?.id === e.id ? (
                      <div className="fila" style={{ gap: 6 }}>
                        <input className="input" autoFocus aria-label="Nombre del escaneo" value={editando.nombre} maxLength={120}
                          onChange={(x) => setEditando({ id: e.id, nombre: x.target.value })}
                          onKeyDown={(x) => { if (x.key === "Enter") renombrar(e.id, editando.nombre); if (x.key === "Escape") setEditando(null); }}
                          onBlur={() => renombrar(e.id, editando.nombre)} />
                        <button className="btn btn-sm btn-icono" aria-label="Guardar el nombre" onMouseDown={(x) => x.preventDefault()} onClick={() => renombrar(e.id, editando.nombre)}><Check size={14} /></button>
                      </div>
                    ) : (
                      <span className="fila" style={{ gap: 6 }}>
                        <b>{e.nombre}</b>
                        {e.subido > vistoAntes && <span className="etiqueta-nuevo">Nuevo</span>}
                        <button className="btn btn-sm btn-fantasma btn-icono" title="Cambiar el nombre" aria-label={`Cambiar el nombre de ${e.nombre}`} onClick={() => setEditando({ id: e.id, nombre: e.nombre })}><Pencil size={13} /></button>
                      </span>
                    )}
                    <small className="escaneo-origen">{e.origen === "celular" ? <Smartphone size={12} /> : e.origen === "pc" ? <Monitor size={12} /> : e.origen === "ia" ? <Sparkles size={12} /> : null}{origenDe(e)}</small>
                    <small>{e.paginas} hoja{e.paginas === 1 ? "" : "s"} · {peso(e.bytes)}</small></div>
                  <div className="fila-wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <a className="btn btn-sm" href={url(e.id)} target="_blank" rel="noreferrer"><ExternalLink size={13} />Ver</a>
                    <button className="btn btn-sm" disabled={!!abriendo || desdeFotos?.editar?.id === e.id} title="Abrirlo en el escáner: recortar, girar, cambiar el filtro o el orden, y guardarlo encima" onClick={() => editarEscaneo(e)}>{abriendo === e.id ? <Loader2 size={13} className="girando" /> : <SlidersHorizontal size={13} />}Editar</button>
                    {e.origen !== "ia" && <button className="btn btn-sm" disabled={!!abriendo} title="Si el documento quedó borroso: la IA lo vuelve a escribir con letra nítida. Este escaneo sigue como está." onClick={() => aumentarEscaneo(e)}><Sparkles size={13} />Aumentar resolución</button>}
                    <button className="btn btn-sm" onClick={() => imprimir(e.id)}><Printer size={13} />Imprimir</button>
                    <a className="btn btn-sm" href={url(e.id, true)}><Download size={13} />Descargar</a>
                    <button className="btn btn-sm btn-primario" onClick={() => setAdjuntando(e)}><Paperclip size={13} />Adjuntar a un trámite</button>
                    <button className="btn btn-sm btn-fantasma btn-icono" title="Borrar" aria-label={`Borrar ${e.nombre}`} onClick={() => borrar(e)}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
          </div>
        </div>
        {adjuntando && <Adjuntar e={adjuntando} cerrar={() => setAdjuntando(null)} />}
      </div>
    </>
  );
}

/**
 * Las dos formas de escanear, lado a lado y con el mismo peso: desde fotos en este PC (soltar, pegar o elegir) y con
 * el celular (el QR abre la app directo en Escanear documentos).
 */
function Entradas({ abrir, modo, setModo }: { abrir: (f: File[]) => void; modo: Modo; setModo: (m: Modo) => void }) {
  const [encima, setEncima] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const elegir = useRef<HTMLInputElement>(null);
  useEffect(() => { QRCode.toDataURL(`${location.origin}/fotos/tomar?seccion=escanear`, { margin: 1, width: 168, errorCorrectionLevel: "M" }).then(setQr, () => {}); }, []);
  return (
    <div className="escaner-entradas">
      <section className="card escaner-entrada" aria-labelledby="escaner-pc">
        <div className="escaner-entrada-cab"><span className="escaner-entrada-ic"><Monitor size={18} /></span><div><b id="escaner-pc">Desde este PC</b><small>Las fotos que mandan por WhatsApp, una fotocopia, una captura</small></div></div>
        <div className="seg escaner-modo" role="group" aria-label="Qué va a escanear">
          <button type="button" className={modo === "tarjeta" ? "on" : ""} aria-pressed={modo === "tarjeta"} onClick={() => setModo("tarjeta")}>Cédula o tarjeta</button>
          <button type="button" className={modo === "hoja" ? "on" : ""} aria-pressed={modo === "hoja"} onClick={() => setModo("hoja")}>Documento (hojas)</button>
        </div>
        <div className={`escaner-soltar${encima ? " encima" : ""}`} role="button" tabIndex={0} aria-label="Soltar o elegir fotos para escanear"
          onClick={() => elegir.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
          onDrop={(e) => { e.preventDefault(); setEncima(false); abrir([...e.dataTransfer.files]); }}>
          <ImagePlus size={26} />
          <b>Pegue la foto con <kbd>Ctrl</kbd> + <kbd>V</kbd></b>
          <span>o arrástrela aquí · varias a la vez</span>
          <input ref={elegir} type="file" accept="image/*" multiple hidden aria-label="Elegir fotos para escanear" onChange={(e) => { if (e.target.files?.length) abrir([...e.target.files]); e.target.value = ""; }} />
        </div>
        <div className="fila-wrap" style={{ gap: 8 }}>
          <BotonPegar recibir={abrir} className="btn btn-primario" />
          <button type="button" className="btn" onClick={() => elegir.current?.click()}><ImagePlus size={14} />Elegir fotos</button>
        </div>
        <small className="tenue">En WhatsApp: clic derecho en la foto → <b>Copiar imagen</b>, y aquí Ctrl+V. {modo === "tarjeta" ? "Las cédulas se recortan solas (también las dos caras de una fotocopia)." : "Cada hoja se recorta, se endereza y se limpia sola."}</small>
      </section>
      <section className="card escaner-entrada" aria-labelledby="escaner-celular">
        <div className="escaner-entrada-cab"><span className="escaner-entrada-ic"><Smartphone size={18} /></span><div><b id="escaner-celular">Desde el celular</b><small>Con la cámara, varias hojas en un PDF</small></div></div>
        <div className="escaner-celular">
          <div className="escaner-qr">{qr ? <img src={qr} alt="Código QR: abre Escanear documentos en el celular" width={168} height={168} /> : <Loader2 className="girando" />}</div>
          <ol className="escaner-pasos">
            <li><b>Escanee el código</b> con la cámara del celular (o abra la app <b>Fotos Pira</b> → Escanear documentos).</li>
            <li><b>Tome las fotos</b>: cada hoja o cédula se recorta y se endereza sola.</li>
            <li><b>Enviar al PC</b>: aparece abajo, en Escaneos recibidos, sin hacer nada aquí.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}

/** Adjuntar abre un panel a la vista: a un trámite que ya existe, o uno nuevo con los datos del escaneo. Nada se lee hasta escoger lo segundo. */
function Adjuntar({ e, cerrar }: { e: Escaneo; cerrar: () => void }) {
  const [opcion, setOpcion] = useState<"existente" | "nuevo" | null>(null);
  const volver = <button className="btn btn-sm btn-fantasma" style={{ alignSelf: "flex-start" }} onClick={() => setOpcion(null)}><ArrowLeft size={13} />Volver</button>;
  return (
    <Panel abierto onCerrar={cerrar} cabecera={<h2>Adjuntar «{e.nombre}»</h2>} ancho={opcion === "nuevo" ? 760 : 520}>
      {!opcion && (
        <div className="pila" style={{ gap: 10 }}>
          <button className="adjuntar-opcion" onClick={() => setOpcion("nuevo")}><FilePlus2 size={20} /><span><b>Crear un trámite nuevo</b><small>La IA lee las hojas y llena el formulario. Usted escoge el trámite, revisa y lo crea; las hojas quedan en sus documentos.</small></span></button>
          <button className="adjuntar-opcion" onClick={() => setOpcion("existente")}><Paperclip size={20} /><span><b>A un trámite que ya existe</b><small>El PDF queda como uno de sus documentos.</small></span></button>
        </div>
      )}
      {opcion === "existente" && <div className="pila" style={{ gap: 12 }}>{volver}<AdjuntarAExistente e={e} cerrar={cerrar} /></div>}
      {opcion === "nuevo" && <div className="pila" style={{ gap: 12 }}>{volver}<TramiteDesdeEscaneo e={e} /></div>}
    </Panel>
  );
}

/** Cuántas caras u hojas de un escaneo se leen como máximo: un trámite trae pocas, y cada lectura gasta IA. */
const MAX_HOJAS_LEER = 8;
const MANUAL_VACIO: InicioManual = {};

/** El mismo formulario de Nuevo trámite, con las hojas del escaneo ya leyéndose (lo que no se lea, se escribe ahí mismo). */
function TramiteDesdeEscaneo({ e }: { e: Escaneo }) {
  const { avisar } = useUI();
  const navegar = useNavigate();
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    (async () => {
      const r = await fetch(url(e.id), { credentials: "same-origin" });
      if (!r.ok) throw new Error("No se pudo traer el escaneo: puede que ya se haya borrado.");
      const { fotos } = await imagenesDelPdf(await r.arrayBuffer());
      const listas = await Promise.all(fotos.slice(0, MAX_HOJAS_LEER).map(prepararFoto));
      if (!vigente) return;
      if (fotos.length > MAX_HOJAS_LEER) setAviso(`El escaneo trae ${fotos.length} partes: se leen y se guardan en el trámite las primeras ${MAX_HOJAS_LEER}. El PDF completo sigue aquí en el Escáner y se puede adjuntar después.`);
      setHojas(listas.map(nuevaHoja));
    })().catch((x) => {
      if (!vigente) return;
      setAviso(`${mensajeDe(x)} Puede llenar el formulario a mano.`);
      setHojas([]);
    });
    return () => { vigente = false; };
  }, [e.id]);
  if (!hojas) return <div className="peq tenue"><Loader2 size={13} className="girando" /> Abriendo el escaneo…</div>;
  return (
    <>
      {aviso && <div className="aviso info"><span>{aviso}</span></div>}
      <Registrador manual={MANUAL_VACIO} inicial={hojas} armarDeUna={hojas.length > 0} abrir={(id) => navegar(`/tramites/${id}`)}
        alGuardar={(r) => avisar(`${r.ids.length > 1 ? `Combo creado: ${r.numeros.join(", ")}` : `Trámite ${r.numeros[0] ?? ""} creado`} con «${e.nombre}».`)} />
    </>
  );
}

/** Elegir el trámite y el documento (de su lista de requisitos, o uno nuevo con el nombre del escaneo). */
function AdjuntarAExistente({ e, cerrar }: { e: Escaneo; cerrar: () => void }) {
  const { avisar } = useUI();
  const [tramiteId, setTramiteId] = useState<string | null>(null);
  const [documentoId, setDocumentoId] = useState("");
  const [nombreDoc, setNombreDoc] = useState(e.nombre);
  const [guardando, setGuardando] = useState(false);
  // El buscador de trámites y licencias de toda la app (los abiertos primero).
  const opciones = useOpcionesTramites() ?? [];
  const documentos = useLiveQuery(async () => (tramiteId ? db.documentos.where("tramiteId").equals(tramiteId).toArray() : []), [tramiteId]) ?? [];

  async function guardar() {
    if (!tramiteId) return;
    setGuardando(true);
    try {
      await escribir("POST", `/api/escaneos/${e.id}/adjuntar`, documentoId ? { tramiteId, documentoId } : { tramiteId, tipoDocumento: nombreDoc });
      avisar(`"${e.nombre}" quedó en el trámite.`);
      cerrar();
    } catch (err) { avisar(mensajeDe(err), "error"); } finally { setGuardando(false); }
  }

  return (
    <>
        <Campo etiqueta="Trámite"><Buscador opciones={opciones} elegido={tramiteId} elegir={(id) => { setTramiteId(id); setDocumentoId(""); }} placeholder="Buscar por número, placa o cliente…" /></Campo>
        {tramiteId && (
          <Campo etiqueta="¿En cuál documento?">
            <select className="input" value={documentoId} onChange={(x) => setDocumentoId(x.target.value)} aria-label="Documento del trámite">
              <option value="">Uno nuevo en la lista</option>
              {documentos.map((d) => <option key={d.id} value={d.id}>{d.tipoDocumento}{d.archivoClave ? " (reemplaza el archivo que tiene)" : ""}</option>)}
            </select>
          </Campo>
        )}
        {tramiteId && !documentoId && <Campo etiqueta="Nombre del documento nuevo"><Texto valor={nombreDoc} cambiar={setNombreDoc} /></Campo>}
        <div className="fila" style={{ gap: 8 }}>
          <button className="btn btn-primario" disabled={!tramiteId || guardando} onClick={guardar}>{guardando ? <Loader2 size={14} className="girando" /> : <Paperclip size={14} />}Adjuntar</button>
          <button className="btn" onClick={cerrar}>Cancelar</button>
        </div>
    </>
  );
}
