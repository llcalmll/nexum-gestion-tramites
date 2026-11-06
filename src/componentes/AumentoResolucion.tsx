import { AlertTriangle, ArrowLeft, Check, ImagePlus, Loader2, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../datos/api";
import { mensajeDe } from "../datos/escribir";
import { imagenesDelPdf } from "../escaner/pdfImagenes";
import { armarPdfDocumento, claveRef, componer, conTexto, dibujarEnLienzo, esBaja, fuentesPdf, renglonDeOriginal, textoDe, textosPorRevisar, todosLosTextos, type Medir, type PaginaLeida, type PorRevisar, type Ref } from "../escaner/documentoIA";
import { leerDerecha, prepararFoto } from "../logica/foto";
import { BotonPegar, usePegarImagenes } from "./Pegar";

/*
 * Aumento de resolución de documentos por IA (Escáner). La IA no agranda la foto (eso inventa letras): lee el documento
 * y lo vuelve a escribir en una hoja carta con letra real. Como en lo borroso puede confundir un 6 con un 8, el documento
 * no existe hasta que la persona compara lo dudoso con el original. Al guardarlo queda en Escaneos recibidos, con todo
 * lo de un escaneo (imprimir, descargar, adjuntar a un trámite, crear uno nuevo).
 *
 * Entra desde el botón del Escáner (pegar, soltar o elegir), desde la fila de un escaneo y desde un archivo del expediente.
 */

const MAX_HOJAS = 10;

interface HojaLeida { foto: string; img: HTMLImageElement; pagina: PaginaLeida; revisar: PorRevisar[]; baja: boolean }
export interface DocumentoGuardado { id: string; nombre: string }
const abrir = async (src: string) => { const i = new Image(); i.src = src; await i.decode(); return i; };

/** Lo que entra: fotos tal cual; de un PDF, sus fotos. Un PDF que ya trae texto no necesita esto: se dice. */
async function fotosDeEntrada(archivos: File[]): Promise<File[]> {
  const fotos: File[] = [];
  for (const a of archivos) {
    if (a.type.startsWith("image/")) { fotos.push(a); continue; }
    if (a.type === "application/pdf" || a.name.toLowerCase().endsWith(".pdf")) {
      try { fotos.push(...(await imagenesDelPdf(await a.arrayBuffer())).fotos); }
      catch { throw new Error(`«${a.name}» ya es un PDF con texto: se ve nítido al imprimirlo directo, no hace falta aumentarlo.`); }
      continue;
    }
    throw new Error("Elija una foto (JPG o PNG) o un PDF escaneado.");
  }
  return fotos;
}

export function AumentoResolucion({ inicial, nombreInicial, cerrar, alGuardar, listo }: {
  inicial?: File[];
  nombreInicial?: string;
  cerrar: () => void;
  /** Ya quedó en el Escáner. */
  alGuardar: (d: DocumentoGuardado) => void;
  /** Lo que se puede hacer con él (lo pone la pantalla del Escáner). */
  listo: (d: DocumentoGuardado, otra: () => void) => ReactNode;
}) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [hojas, setHojas] = useState<HojaLeida[]>([]);
  const [progreso, setProgreso] = useState<{ hoja: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [nombre, setNombre] = useState(nombreInicial ?? "Documento aumentado");
  const [guardado, setGuardado] = useState<DocumentoGuardado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const vigente = useRef(0);
  useEffect(() => () => { vigente.current++; }, []);

  /** Lee las hojas que falten, una por una (lo ya leído no se vuelve a pagar si una falla). */
  async function leer(lista: File[], yaLeidas: HojaLeida[]) {
    const turno = ++vigente.current;
    setError(null); setFallo(false);
    const nuevas = [...yaLeidas];
    try {
      for (let i = nuevas.length; i < lista.length; i++) {
        setProgreso({ hoja: i + 1, total: lista.length });
        const foto = await prepararFoto(lista[i]);
        const original = await abrir(foto);
        const baja = esBaja(original.naturalWidth, original.naturalHeight);
        const r = await leerDerecha(foto, (imagen, _baja, derecha) => api<{ datos: { pagina: PaginaLeida; segunda: string[] | null }; girar?: number }>("/api/aumento/leer", { method: "POST", body: JSON.stringify({ imagen, derecha }) }));
        if (turno !== vigente.current) return;
        const img = await abrir(r.foto);
        nuevas.push({ foto: r.foto, img, pagina: r.datos.pagina, baja, revisar: textosPorRevisar(r.datos.pagina, r.datos.segunda, { baja }) });
        setHojas([...nuevas]);
      }
    } catch (e) {
      if (turno !== vigente.current) return;
      setError(mensajeDe(e)); setFallo(true);
    } finally { if (turno === vigente.current) setProgreso(null); }
  }
  async function recibir(entrada: File[]) {
    setError(null);
    try {
      const fotos = await fotosDeEntrada(entrada);
      if (!fotos.length) return;
      if (fotos.length > MAX_HOJAS) throw new Error(`Son ${fotos.length} hojas: máximo ${MAX_HOJAS} por documento.`);
      setArchivos(fotos); setHojas([]);
      await leer(fotos, []);
    } catch (e) { setError(mensajeDe(e)); }
  }
  // Viene de un escaneo o de un archivo del expediente: se empieza de una.
  const arranco = useRef(false);
  useEffect(() => { if (inicial?.length && !arranco.current) { arranco.current = true; void recibir(inicial); } });

  function otra() { vigente.current++; setArchivos([]); setHojas([]); setProgreso(null); setError(null); setFallo(false); setGuardado(null); setNombre("Documento aumentado"); }

  async function guardar(lista: HojaLeida[]) {
    setGuardando(true); setError(null);
    const titulo = nombre.trim() || "Documento aumentado";
    try {
      const pdf = await armarPdfDocumento(lista.map((h) => ({ pagina: h.pagina, imagen: h.img })), titulo);
      let r: Response;
      try {
        r = await fetch(`/api/escaneos?nombre=${encodeURIComponent(titulo)}&paginas=${lista.length}&modo=hoja&origen=ia`, { method: "PUT", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "application/pdf" }, body: new Blob([pdf as BlobPart], { type: "application/pdf" }) });
      } catch { throw new Error("Sin conexión: el documento sigue aquí, intente guardar otra vez."); }
      if (r.type === "opaqueredirect" || r.status === 401) throw new Error("La sesión venció: abra la app en otra pestaña, entre otra vez y vuelva aquí a guardar.");
      if (!r.ok) throw new Error(String(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo guardar (${r.status}).`));
      const d = (await r.json()) as DocumentoGuardado;
      setGuardado(d);
      alGuardar(d);
    } catch (e) { setError(mensajeDe(e)); } finally { setGuardando(false); }
  }

  const enLectura = !!progreso;
  const todas = hojas.length > 0 && hojas.length === archivos.length && !enLectura;

  return (
    <section className="card aumento" aria-label="Aumento de resolución de documentos por IA">
      <div className="aumento-cab">
        <span className="escaner-entrada-ic"><Sparkles size={18} /></span>
        <div><b>Aumento de resolución de documentos por IA</b><small>La IA lee el documento y lo vuelve a escribir en una hoja carta, con letra nítida.</small></div>
        <button className="btn btn-sm btn-fantasma" style={{ marginLeft: "auto" }} onClick={cerrar}><X size={14} />Cerrar</button>
      </div>
      {guardado ? (
        <div className="aumento-listo">
          <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={16} /><span><b>«{guardado.nombre}» ya está en el Escáner</b>, en Escaneos recibidos. ¿Qué sigue?</span></div>
          {listo(guardado, otra)}
        </div>
      ) : (
        <>
          {error && (
            <div className="aviso error" style={{ marginBottom: 12 }}><AlertTriangle size={16} /><span>{error}</span>
              {fallo && <button className="btn btn-sm" style={{ marginLeft: "auto", flex: "none" }} onClick={() => void leer(archivos, hojas)}><RotateCcw size={13} />Reintentar</button>}
            </div>
          )}
          {!archivos.length && <Elegir recibir={(f) => void recibir(f)} />}
          {enLectura && (
            <div className="aumento-leyendo" role="status">
              <Loader2 size={22} className="girando" />
              <div><b>Leyendo{progreso.total > 1 ? ` la hoja ${progreso.hoja} de ${progreso.total}` : " el documento"}…</b><small>Tarda cerca de un minuto por hoja: dos lectores la leen por aparte para comparar.</small></div>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={otra}>Cancelar</button>
            </div>
          )}
          {fallo && !enLectura && <button className="btn btn-sm" onClick={otra}><ArrowLeft size={13} />Elegir otra imagen</button>}
          {todas && <Revisar hojas={hojas} cambiar={setHojas} nombre={nombre} setNombre={setNombre} guardando={guardando} guardar={() => void guardar(hojas)} volver={otra} />}
        </>
      )}
    </section>
  );
}

function Elegir({ recibir }: { recibir: (f: File[]) => void }) {
  const [encima, setEncima] = useState(false);
  const elegir = useRef<HTMLInputElement>(null);
  const zona = useRef<HTMLDivElement>(null);
  usePegarImagenes(zona, recibir);
  return (
    <div className="pila" style={{ gap: 12 }} ref={zona}>
      <div className={`escaner-soltar${encima ? " encima" : ""}`} role="button" tabIndex={0} aria-label="Soltar o elegir el documento"
        onClick={() => elegir.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
        onDrop={(e) => { e.preventDefault(); setEncima(false); recibir([...e.dataTransfer.files]); }}>
        <ImagePlus size={26} />
        <b>Pegue el documento con <kbd>Ctrl</kbd> + <kbd>V</kbd></b>
        <span>o arrástrelo aquí · foto, captura o PDF escaneado · varias hojas a la vez</span>
        <input ref={elegir} type="file" accept="image/*,application/pdf" multiple hidden aria-label="Elegir el documento" onChange={(e) => { if (e.target.files?.length) recibir([...e.target.files]); e.target.value = ""; }} />
      </div>
      <div className="fila-wrap" style={{ gap: 8 }}>
        <BotonPegar recibir={recibir} className="btn btn-primario" />
        <button type="button" className="btn" onClick={() => elegir.current?.click()}><ImagePlus size={14} />Elegir archivo</button>
      </div>
      <small className="tenue">Después compara lo dudoso con el original, y solo entonces queda el documento. Si ya tiene el PDF original, imprímalo directo: siempre será más fiel que una copia transcrita.</small>
    </div>
  );
}

/** Un dato para comparar: el renglón del original arriba, y lo leído para confirmarlo o corregirlo. */
function Comparar({ h, r, confirmado, confirmar, corregir, conBoton }: { h: HojaLeida; r: PorRevisar; confirmado: boolean; confirmar: () => void; corregir: (t: string) => void; conBoton: boolean }) {
  const actual = textoDe(h.pagina, r.ref);
  const [texto, setTexto] = useState(actual);
  useEffect(() => setTexto(actual), [actual]);
  const renglon = useMemo(() => renglonDeOriginal(h.img, r.zona), [h.img, r.zona]);
  const aplicar = () => { if (texto.trim() && texto !== actual) corregir(texto); else if (!texto.trim()) setTexto(actual); };
  return (
    <div className={`aumento-dato${confirmado ? " hecho" : ""}`}>
      <img src={renglon} alt="El renglón en el documento original" />
      <div className="aumento-dato-fila">
        <input className="input" aria-label={`Corregir ${actual}`} value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={aplicar} onKeyDown={(e) => { if (e.key === "Enter") aplicar(); }} />
        {conBoton && (confirmado
          ? <span className="aumento-ok"><Check size={14} />Listo</span>
          : <button className="btn btn-sm" onClick={confirmar}><Check size={14} />Está igual</button>)}
      </div>
      <small className="tenue">{r.motivo}</small>
    </div>
  );
}

function Revisar({ hojas, cambiar, nombre, setNombre, guardando, guardar, volver }: { hojas: HojaLeida[]; cambiar: (h: HojaLeida[]) => void; nombre: string; setNombre: (s: string) => void; guardando: boolean; guardar: () => void; volver: () => void }) {
  const [hojaVista, setHojaVista] = useState(0);
  /** Los que ya se compararon, por hoja y dato. */
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  /** Los de la imagen borrosa se confirman juntos. */
  const [bajasOk, setBajasOk] = useState(false);
  const [medir, setMedir] = useState<Medir | null>(null);
  useEffect(() => { void PDFDocument.create().then(fuentesPdf).then((f) => setMedir(() => f.medir)); }, []);

  const clave = (i: number, r: Ref) => `${i}:${claveRef(r)}`;
  const altos = hojas.flatMap((h, i) => h.revisar.filter((r) => r.nivel === "alto").map((r) => ({ i, r })));
  const bajas = hojas.flatMap((h, i) => h.revisar.filter((r) => r.nivel === "baja").map((r) => ({ i, r })));
  const faltan = altos.filter((x) => !hechos.has(clave(x.i, x.r.ref))).length;
  const faltaBajas = bajas.length > 0 && !bajasOk;
  const marcar = (c: string) => setHechos((s) => new Set(s).add(c));
  const corregir = (i: number, refs: Ref[], t: string) => {
    cambiar(hojas.map((h, k) => (k === i ? { ...h, pagina: refs.reduce((p, r) => conTexto(p, r, t), h.pagina) } : h)));
    marcar(clave(i, refs[0]));
  };

  const h = hojas[Math.min(hojaVista, hojas.length - 1)];
  const iVista = hojas.indexOf(h);
  const pendientesDeHoja = useMemo(() => new Set(h.revisar.filter((r) => !hechos.has(clave(iVista, r.ref)) && !(r.nivel === "baja" && bajasOk)).map((r) => textoDe(h.pagina, r.ref))), [h, hechos, bajasOk, iVista]);
  const vista = useMemo(() => (medir ? dibujarEnLienzo(componer(h.pagina, h.img.naturalWidth / h.img.naturalHeight, medir, pendientesDeHoja), h.img, 2, true).toDataURL("image/png") : null), [h, medir, pendientesDeHoja]);
  const [resto, setResto] = useState(false);
  const yaListados = useMemo(() => new Set(h.revisar.flatMap((r) => [r.ref, ...r.iguales].map(claveRef))), [h]);

  return (
    <div className="pila" style={{ gap: 14 }}>
      {hojas.length > 1 && (
        <div className="seg" role="group" aria-label="Hoja">
          {hojas.map((_, i) => <button key={i} type="button" className={i === iVista ? "on" : ""} aria-pressed={i === iVista} onClick={() => setHojaVista(i)}>Hoja {i + 1}</button>)}
        </div>
      )}
      <div className="aumento-lados">
        <figure><figcaption>Original</figcaption><img src={h.foto} alt="El documento original" /></figure>
        <figure><figcaption>Aumentado (en amarillo, lo que falta comparar)</figcaption>{vista ? <img src={vista} alt="El documento aumentado" /> : <div className="tenue" style={{ padding: 20 }}><Loader2 size={14} className="girando" /></div>}</figure>
      </div>

      {altos.length > 0 && (
        <div className="pila" style={{ gap: 8 }}>
          <b>Compare estos datos con el original ({altos.length - faltan} de {altos.length})</b>
          <small className="tenue">La IA los dudó o dos lecturas no coincidieron. Si no está igual, corríjalo en la casilla.</small>
          {altos.map(({ i, r }) => <Comparar key={clave(i, r.ref)} h={hojas[i]} r={r} conBoton confirmado={hechos.has(clave(i, r.ref))} confirmar={() => marcar(clave(i, r.ref))} corregir={(t) => corregir(i, [r.ref, ...r.iguales], t)} />)}
        </div>
      )}
      {bajas.length > 0 && (
        <div className="pila" style={{ gap: 8 }}>
          <b>La imagen es de baja resolución: mire también estos números ({bajas.length})</b>
          <small className="tenue">Las dos lecturas coinciden, pero en una imagen borrosa las dos se pueden equivocar igual, y un número mal copiado no se nota.</small>
          {bajas.map(({ i, r }) => <Comparar key={clave(i, r.ref)} h={hojas[i]} r={r} conBoton={false} confirmado={bajasOk} confirmar={() => {}} corregir={(t) => corregir(i, [r.ref, ...r.iguales], t)} />)}
          <label className="aumento-confirma"><input type="checkbox" checked={bajasOk} onChange={(e) => setBajasOk(e.target.checked)} />Ya comparé estos {bajas.length} números con el original</label>
        </div>
      )}
      {!altos.length && !bajas.length && <div className="aviso info"><span>Las dos lecturas coinciden y no hubo dudas. Aun así, mire que la hoja de la derecha diga lo mismo que el original.</span></div>}

      <details className="llenar-plegable" onToggle={(e) => setResto(e.currentTarget.open)}>
        <summary>Corregir cualquier otro texto de la hoja</summary>
        {resto && (
          <div className="pila" style={{ gap: 6, marginTop: 10 }}>
            {todosLosTextos(h.pagina).filter((t) => !yaListados.has(claveRef(t.ref))).map((t) => <TextoSuelto key={claveRef(t.ref)} texto={t.texto} corregir={(x) => corregir(iVista, [t.ref], x)} />)}
          </div>
        )}
      </details>

      <div className="aumento-pie">
        <label className="aumento-nombre">Nombre del documento<input className="input" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} /></label>
        <div className="fila" style={{ gap: 8, marginLeft: "auto", alignItems: "center" }}>
          {(faltan > 0 || faltaBajas) && <span className="peq tenue">Falta comparar: {faltan + (faltaBajas ? bajas.length : 0)}</span>}
          <button className="btn" onClick={volver}><ArrowLeft size={14} />Empezar de nuevo</button>
          <button className="btn btn-primario" disabled={guardando || faltan > 0 || faltaBajas} onClick={guardar}>{guardando ? <Loader2 size={14} className="girando" /> : <Save size={14} />}Guardar en el Escáner</button>
        </div>
      </div>
    </div>
  );
}

function TextoSuelto({ texto, corregir }: { texto: string; corregir: (t: string) => void }) {
  const [v, setV] = useState(texto);
  useEffect(() => setV(texto), [texto]);
  const aplicar = () => { if (v.trim() && v !== texto) corregir(v); else if (!v.trim()) setV(texto); };
  return <input className="input" aria-label={`Corregir ${texto}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={aplicar} onKeyDown={(e) => { if (e.key === "Enter") aplicar(); }} />;
}
