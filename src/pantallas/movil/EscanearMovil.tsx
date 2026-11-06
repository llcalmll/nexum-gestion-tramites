import { Camera, Check, FilePlus2, Images, Loader2, Maximize, Paperclip, RotateCw, Send, Share2, Trash2, X } from "lucide-react";
import { ListaTramites, type TramiteLista } from "./TramitesMovil";
import { Fragment, useEffect, useRef, useState } from "react";
import { AjusteEsquinas, FILTROS, type Editando } from "../../escaner/AjusteEsquinas";
import { armarPdf, cargarImagen, detectarBordes, detectarTarjetas, type Esquinas, juntarCaras, precargarTarjetas, procesarPagina } from "../../escaner/procesar";
import { CopiarCaras } from "../../escaner/CopiarCaras";
import { DatosLeidos } from "../../componentes/DatosLeidos";
import { CabeceraMovil, Campo, MENSAJE_SESION, nombreDispositivo } from "./comun";

/*
 * Escanear documentos desde el celular: foto (o galería) -> la app encuentra la hoja -> se ajustan las esquinas con
 * el dedo -> sale derecha y limpia como un escáner -> varias páginas -> un PDF que va al PC (pantalla Escaneos) o se
 * comparte (WhatsApp, correo...). Modo "Cédula o tarjeta": las dos caras en una hoja carta, al 150 %, y de cada una
 * se pueden leer los datos para revisarlos y guardarlos como cliente o vehículo.
 * Las páginas ya escaneadas se guardan en esta pestaña: si el iPhone recarga al abrir la cámara, no se pierden.
 */

type Modo = "hoja" | "tarjeta";
const CLAVE = "movil-escaneo";

function leerGuardado(): { modo: Modo; nombre: string; paginas: string[] } {
  try { return { modo: "hoja", nombre: "", paginas: [], ...JSON.parse(sessionStorage.getItem(CLAVE) ?? "{}") }; } catch { return { modo: "hoja", nombre: "", paginas: [] }; }
}
const aCanvas = (url: string) => new Promise<HTMLCanvasElement>((ok, mal) => {
  const i = new Image();
  i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d")!.drawImage(i, 0, 0); ok(c); };
  i.onerror = () => mal(new Error("No se pudo leer una página."));
  i.src = url;
});

export function EscanearMovil({ volver }: { volver: () => void }) {
  const inicial = leerGuardado();
  const [modo, setModo] = useState<Modo>(inicial.modo);
  const [nombre, setNombre] = useState(inicial.nombre);
  const [paginas, setPaginas] = useState<string[]>(inicial.paginas);
  const [editando, setEditando] = useState<Editando | null>(null);
  // Las demás tarjetas que se encontraron en la misma foto (la fotocopia con las dos caras): se abren una tras otra.
  const [otras, setOtras] = useState<Esquinas[]>([]);
  useEffect(() => { if (modo === "tarjeta") precargarTarjetas(); }, [modo]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);
  /** El escaneo que quedó en el PC (para adjuntarlo a un trámite, si se quiere). */
  const [escaneoId, setEscaneoId] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [adjuntado, setAdjuntado] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  useEffect(() => { try { sessionStorage.setItem(CLAVE, JSON.stringify({ modo, nombre, paginas })); } catch { /* sin espacio: las páginas siguen en pantalla */ } }, [modo, nombre, paginas]);

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null); setEnviado(null);
    setOcupado(modo === "tarjeta" ? "Buscando la cédula…" : "Buscando la hoja…");
    try {
      const foto = await cargarImagen(archivo);
      const vista = foto.toDataURL("image/jpeg", 0.7);
      if (modo === "tarjeta") {
        const d = await detectarTarjetas(foto);
        setOtras(d.tarjetas.slice(1));
        setEditando({ foto, vista, esquinas: d.tarjetas[0], encontrada: d.encontrada, filtro: "documento", giros: 0 });
        return;
      }
      const { esquinas, encontrada } = detectarBordes(foto, modo);
      setOtras([]);
      setEditando({ foto, vista, esquinas, encontrada, filtro: "documento", giros: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  async function terminarPagina() {
    if (!editando) return;
    setOcupado("Enderezando y limpiando…");
    await new Promise((r) => setTimeout(r, 30)); // que se vea el aviso antes del cálculo
    try {
      const c = procesarPagina(editando.foto, editando.esquinas, editando.filtro, editando.giros, modo);
      setPaginas((p) => [...p, c.toDataURL("image/jpeg", 0.85)]);
      // Si en la misma foto había otra tarjeta (la otra cara), sigue esa.
      if (otras.length) { setEditando({ ...editando, esquinas: otras[0], encontrada: true, giros: 0 }); setOtras(otras.slice(1)); }
      else setEditando(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  const titulo = nombre.trim() || (modo === "tarjeta" ? "Cédula" : "Documento escaneado");
  async function pdf() {
    const canvas = await Promise.all(paginas.map(aCanvas));
    return armarPdf(canvas, modo, titulo);
  }

  async function enviar() {
    setOcupado("Enviando al PC…"); setError(null);
    try {
      const bytes = await pdf();
      const hojas = modo === "tarjeta" ? Math.ceil(paginas.length / 2) : paginas.length;
      let r: Response;
      try {
        r = await fetch(`/api/escaneos?nombre=${encodeURIComponent(titulo)}&paginas=${hojas}&modo=${modo}&escala=1.5&origen=celular&dispositivo=${encodeURIComponent(await nombreDispositivo())}`, { method: "PUT", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "application/pdf" }, body: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
      } catch { throw new Error("Sin conexión: revise el internet y vuelva a enviar (las páginas no se pierden)."); }
      if (r.type === "opaqueredirect" || r.status === 401) throw new Error(MENSAJE_SESION);
      if (!r.ok) throw new Error(String(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo enviar (${r.status}).`));
      const { id } = (await r.json().catch(() => ({}))) as { id?: string };
      setEscaneoId(id ?? null); setAdjuntado(null);
      setEnviado(titulo);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  /** Opcional: el escaneo que ya está en el PC, pegado también a un trámite o una licencia (como documento nuevo). */
  async function adjuntar(tramiteId: string, t: TramiteLista) {
    if (!escaneoId) return;
    setOcupado("Adjuntando…"); setError(null);
    try {
      let r: Response;
      try {
        r = await fetch(`/api/escaneos/${escaneoId}/adjuntar`, { method: "POST", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tramiteId, tipoDocumento: titulo }) });
      } catch { throw new Error("Sin conexión: revise el internet y vuelva a intentar."); }
      if (r.type === "opaqueredirect" || r.status === 401) throw new Error(MENSAJE_SESION);
      if (!r.ok) throw new Error(String(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo adjuntar (${r.status}).`));
      setAdjuntado(`${t.codigo}${t.placa ? ` (${t.placa})` : ` (${t.titular})`}`);
      setEligiendo(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  async function compartir() {
    setOcupado("Preparando el PDF…"); setError(null);
    try {
      const archivo = new File([(await pdf()) as BlobPart], `${titulo}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) await navigator.share({ files: [archivo], title: titulo });
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(archivo); a.download = archivo.name; a.click(); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  function nuevo() { setPaginas([]); setNombre(""); setEnviado(null); setError(null); setEscaneoId(null); setEligiendo(false); setAdjuntado(null); }

  if (editando) {
    return (
      <>
        <CabeceraMovil titulo="Ajustar la hoja" volver={() => { setEditando(null); setOtras([]); }} />
        <p className="muted" style={{ margin: 0, textAlign: "center" }}>{editando.encontrada ? "Revise que las esquinas caigan en las puntas de la hoja; muévalas con el dedo si hace falta." : "No encontré la hoja sola: lleve cada esquina a una punta de la hoja."}</p>
        <AjusteEsquinas e={editando} cambiar={(esquinas) => setEditando({ ...editando, esquinas })} />
        <div className="seg movil-seg" role="group" aria-label="Filtro">
          {FILTROS.map(([f, n]) => <button key={f} className={editando.filtro === f ? "on" : ""} aria-pressed={editando.filtro === f} onClick={() => setEditando({ ...editando, filtro: f })}>{n}</button>)}
        </div>
        <div className="fila" style={{ gap: 8 }}>
          <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setEditando({ ...editando, giros: editando.giros + 1 })}><RotateCw size={16} />Girar{editando.giros % 4 ? ` (${(editando.giros % 4) * 90}°)` : ""}</button>
          <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => { const { width: w, height: h } = editando.foto; setEditando({ ...editando, esquinas: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }); }}><Maximize size={16} />Foto completa</button>
        </div>
        {error && <div className="aviso error">{error}</div>}
        <button className="btn btn-primario tomar-boton" disabled={!!ocupado} onClick={terminarPagina}>{ocupado ? <><Loader2 size={18} className="girando" />{ocupado}</> : <><Check size={18} />Listo, agregar página</>}</button>
      </>
    );
  }

  return (
    <>
      <CabeceraMovil titulo="Escanear documentos" volver={volver} />
      <div className="seg movil-seg" role="group" aria-label="Tipo de documento">
        <button className={modo === "hoja" ? "on" : ""} aria-pressed={modo === "hoja"} onClick={() => setModo("hoja")}>Documento (hojas)</button>
        <button className={modo === "tarjeta" ? "on" : ""} aria-pressed={modo === "tarjeta"} onClick={() => setModo("tarjeta")}>Cédula o tarjeta</button>
      </div>
      <p className="muted" style={{ margin: 0, textAlign: "center" }}>{modo === "tarjeta" ? "Escanee el frente y luego el respaldo: quedan las dos caras en una hoja carta, al 150 %." : "Ponga la hoja sobre una superficie oscura, con buena luz. Una foto por página."}</p>
      {paginas.length > 0 && (
        <div className="escaneo-paginas" aria-label="Páginas escaneadas">
          {paginas.map((p, i) => (
            <div key={i} className="escaneo-pagina">
              <img src={p} alt={`Página ${i + 1}`} />
              <span>{modo === "tarjeta" ? (i % 2 ? "Respaldo" : "Frente") : `Pág. ${i + 1}`}</span>
              <button className="btn btn-sm btn-fantasma btn-icono" aria-label={`Quitar la página ${i + 1}`} onClick={() => setPaginas((x) => x.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {modo === "tarjeta" && Array.from({ length: Math.ceil(paginas.length / 2) }, (_, i) => (
        <Fragment key={`${i}-${paginas[i * 2].slice(-24)}`}>
          <CopiarCaras key={paginas[i * 2 + 1]?.slice(-24) ?? ""} caras={paginas.slice(i * 2, i * 2 + 2)} nombre={nombre} grande />
          <DatosLeidos etiqueta={paginas.length > 2 ? `Documento ${i + 1}` : "Documento"}
            foto={() => juntarCaras(paginas.slice(i * 2, i * 2 + 2))} alNombre={(n) => setNombre((x) => x || n)} />
        </Fragment>
      ))}
      {ocupado && <div className="aviso info"><Loader2 size={16} className="girando" />{ocupado}</div>}
      {error && <div className="aviso error">{error}</div>}
      {enviado && <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={16} />"{enviado}" quedó en el PC, en Escaneos.{adjuntado ? ` Y en el trámite ${adjuntado}.` : ""}</div>}
      {/* Lo siguiente, bien a la vista: empezar otro escaneo (las páginas de este ya llegaron). */}
      {enviado && <button className="btn mtr-siguiente" disabled={!!ocupado} onClick={nuevo}><FilePlus2 size={18} />Empezar otro escaneo</button>}
      {enviado && escaneoId && !adjuntado && !eligiendo && (
        <button className="btn" style={{ height: 44, justifyContent: "center" }} disabled={!!ocupado} onClick={() => setEligiendo(true)}><Paperclip size={16} />Adjuntar a un trámite (opcional)</button>
      )}
      {eligiendo && (
        <div className="pila esc-adjuntar" style={{ gap: 8 }}>
          <div className="fila" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <b>¿A qué trámite o licencia?</b>
            <button className="btn btn-sm btn-fantasma" onClick={() => setEligiendo(false)}><X size={14} />No adjuntar</button>
          </div>
          <ListaTramites abrir={(id, t) => void adjuntar(id, t)} />
        </div>
      )}
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label="Cámara: escanear" onChange={(e) => { alElegir(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*" hidden aria-label="Galería: escanear" onChange={(e) => { alElegir(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="fila" style={{ gap: 8 }}>
        <button className="btn btn-primario" style={{ flex: 1, height: 50, justifyContent: "center" }} disabled={!!ocupado} onClick={() => camara.current?.click()}><Camera size={18} />{paginas.length ? (modo === "tarjeta" && paginas.length % 2 ? "Escanear el respaldo" : "Otra página") : modo === "tarjeta" ? "Escanear el frente" : "Escanear"}</button>
        <button className="btn" style={{ height: 50, justifyContent: "center" }} disabled={!!ocupado} onClick={() => galeria.current?.click()} aria-label="Desde la galería"><Images size={18} /></button>
      </div>
      {paginas.length > 0 && (
        <>
          <Campo etiqueta="Nombre del escaneo"><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={modo === "tarjeta" ? "Cédula Juan Pérez" : "Contrato ABC123"} /></Campo>
          <div className="fila" style={{ gap: 8 }}>
            <button className="btn btn-primario" style={{ flex: 1, height: 48, justifyContent: "center" }} disabled={!!ocupado} onClick={enviar}><Send size={17} />Enviar al PC</button>
            <button className="btn" style={{ flex: 1, height: 48, justifyContent: "center" }} disabled={!!ocupado} onClick={compartir}><Share2 size={17} />Compartir</button>
          </div>
        </>
      )}
    </>
  );
}
