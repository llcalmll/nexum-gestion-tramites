import { Camera, Check, Images, Loader2, Maximize2, Monitor, RotateCcw, Send, Share2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../datos/api";
import { conTarjeta, datosVacios, desdeCedula, ibagueDe, personaVacia } from "../../formatos/desdeFotos";
import { CASILLAS_FUN, generarFormatos, type DatosFormatos, type Formato } from "../../formatos/llenado";
import { VistaFormato, VistaReverso } from "../../formatos/VistaFormato";
import { leerDerecha, prepararFoto } from "../../logica/foto";
import { CabeceraMovil, MENSAJE_SESION } from "./comun";

/*
 * Formatos desde el celular: fotos de la tarjeta de propiedad y de las cédulas -> se leen solas -> vista previa del
 * formulario único (las dos caras), el mandato y, si hay comprador, la compraventa -> se mandan al PC (Formatos → Del
 * celular), donde se corrige al detalle y se imprime; o se comparte el PDF. El organismo arranca en Ibagué.
 * En vivo: cada foto leída se manda sola al PC (solo lo leído): si Llenar formatos está abierto allá, se llena a los
 * pocos segundos, y aquí dice "En el PC" cuando llegó.
 * Lo hecho se guarda en esta pestaña: si el iPhone recarga al abrir la cámara, no se pierde.
 */

type Doc = "tarjeta" | "propietario" | "comprador";
const DOCS: { id: Doc; nombre: string; tipo: "tarjeta_propiedad" | "cedula" }[] = [
  { id: "tarjeta", nombre: "Tarjeta de propiedad", tipo: "tarjeta_propiedad" },
  { id: "propietario", nombre: "Cédula del propietario (vendedor)", tipo: "cedula" },
  { id: "comprador", nombre: "Cédula del comprador (si es traspaso)", tipo: "cedula" },
];
/** Cada foto leída, mandada al PC en vivo: su id y si ya la tomó un PC (o no se pudo mandar). */
type EstadoVivo = { id?: string; estado: "mandando" | "esperando" | "llego" | "sin_pc" | "error"; datos: Record<string, string | string[]> };
interface Estado { d: DatosFormatos; leidos: Doc[]; compradorMandato: boolean; enviado?: string; vivo?: Partial<Record<Doc, EstadoVivo>> }
const CLAVE = "movil-formatos";
const leerGuardado = (): Estado => { try { const g = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null"); if (g?.d) return g; } catch { /* nada */ } return { d: datosVacios(), leidos: [], compradorMandato: false }; };
/** Abre Formatos con datos ya leídos (de la consulta rápida): quedan en esta pestaña, como si se hubieran tomado las fotos. */
export function abrirConDatos(d: DatosFormatos) {
  const leidos: Doc[] = ["tarjeta", "propietario", ...(d.comprador ? (["comprador"] as Doc[]) : [])];
  try { sessionStorage.setItem(CLAVE, JSON.stringify({ d, leidos, compradorMandato: false } satisfies Estado)); } catch { /* sin almacenamiento */ }
}
const mensaje = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return /sesi[oó]n/i.test(m) ? MENSAJE_SESION : m; };

export function FormatosMovil({ volver }: { volver: () => void }) {
  const [e, setE] = useState<Estado>(leerGuardado);
  const [organismos, setOrganismos] = useState<{ id: string; nombre: string; ciudad: string | null }[]>([]);
  const [leyendo, setLeyendo] = useState<Doc | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"enviar" | "pdf" | null>(null);
  const entradas = useRef<Record<string, HTMLInputElement | null>>({});
  /** Las fotos leídas (no se guardan en la pestaña: pesan mucho; si el celular recarga, van solo los datos). */
  const fotos = useRef<Partial<Record<Doc, string>>>({});
  const { d } = e;
  const poner = (c: Partial<Estado>) => setE((x) => ({ ...x, ...c, enviado: undefined }));
  const ponerD = (cambio: (x: DatosFormatos) => DatosFormatos) => setE((x) => ({ ...x, d: cambio(x.d), enviado: undefined }));

  useEffect(() => { try { sessionStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* sin espacio */ } }, [e]);
  useEffect(() => {
    api<{ organismos: { id: string; nombre: string; ciudad: string | null }[] }>("/api/movil/catalogo").then((c) => {
      const lista = [...c.organismos].sort((a, b) => (a.ciudad ?? a.nombre).localeCompare(b.ciudad ?? b.nombre, "es"));
      setOrganismos(lista);
      // Ibagué con el nombre exacto de la lista.
      setE((x) => (x.d.organismo.ciudad === "Ibagué" ? { ...x, d: { ...x.d, organismo: ibagueDe(lista) } } : x));
    }, () => { /* sin lista: queda Ibagué */ });
  }, []);

  async function leer(doc: (typeof DOCS)[number], archivo: File | undefined) {
    if (!archivo) return;
    setLeyendo(doc.id); setError(null); setAviso(null);
    try {
      const preparada = await prepararFoto(archivo);
      const { datos, foto } = await leerDerecha(preparada, (imagen, baja, derecha) => api<{ datos: Record<string, string | string[]>; girar?: number }>("/api/leer", { method: "POST", body: JSON.stringify({ tipo: doc.tipo, imagen, baja, derecha }) }));
      // La foto (derecha) va con lo leído al PC: allá se ve y queda en el trámite al anotarlo.
      fotos.current[doc.id] = foto;
      if (Array.isArray(datos.dudosos) && datos.dudosos.length) setAviso("Algunos números no se leyeron con seguridad: revíselos en el PC antes de imprimir.");
      ponerD((x) => {
        if (doc.id === "tarjeta") return conTarjeta(x, datos);
        if (doc.id === "propietario") return { ...x, propietario: { ...x.propietario, ...desdeCedula(datos) } };
        // Con comprador es traspaso (casilla 2), salvo que ya se haya marcado otra cosa.
        return { ...x, comprador: { ...(x.comprador ?? personaVacia()), ...desdeCedula(datos) }, casillas: x.casillas.length ? x.casillas : [2], tramiteTexto: x.tramiteTexto || "traspaso" };
      });
      setE((x) => ({ ...x, leidos: [...new Set([...x.leidos, doc.id])] }));
      void alPc(doc.id, datos);
    } catch (err) { setError(`No pude leer la foto (${mensaje(err)}). Tómela de nuevo, derecha y con buena luz.`); } finally { setLeyendo(null); }
  }

  /** Manda lo leído al PC (en vivo) y espera, hasta 40 s, a que Llenar formatos lo tome allá. */
  const vigilando = useRef<Record<string, number>>({});
  const ponerVivo = (doc: Doc, v: EstadoVivo) => setE((x) => ({ ...x, vivo: { ...x.vivo, [doc]: v } }));
  async function alPc(doc: Doc, datos: Record<string, string | string[]>) {
    ponerVivo(doc, { estado: "mandando", datos });
    let id: string;
    try { id = (await api<{ id: string }>("/api/formatos-vivo", { method: "POST", body: JSON.stringify({ doc, datos, foto: fotos.current[doc] }) })).id; }
    catch { ponerVivo(doc, { estado: "error", datos }); return; }
    ponerVivo(doc, { id, estado: "esperando", datos });
    vigilar(doc, id, datos);
  }
  function vigilar(doc: Doc, id: string, datos: Record<string, string | string[]>) {
    window.clearInterval(vigilando.current[doc]);
    const inicio = Date.now();
    vigilando.current[doc] = window.setInterval(async () => {
      try {
        if ((await api<{ tomado: boolean }>(`/api/formatos-vivo/${id}`)).tomado) { window.clearInterval(vigilando.current[doc]); ponerVivo(doc, { id, estado: "llego", datos }); return; }
      } catch { /* sin señal un momento: se sigue intentando */ }
      if (Date.now() - inicio > 10_000) { window.clearInterval(vigilando.current[doc]); ponerVivo(doc, { id, estado: "sin_pc", datos }); }
    }, 2500);
  }
  // Si el iPhone recargó mientras esperaba, se sigue esperando; al salir, se deja de preguntar.
  useEffect(() => {
    for (const [doc, v] of Object.entries(e.vivo ?? {})) if (v?.estado === "esperando" && v.id) vigilar(doc as Doc, v.id, v.datos);
    const vs = vigilando.current;
    return () => { for (const t of Object.values(vs)) window.clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elegidos: Formato[] = ["fun", "mandato_propietario", ...(d.comprador ? (["compraventa"] as Formato[]) : []), ...(d.comprador && e.compradorMandato ? (["mandato_comprador"] as Formato[]) : [])];
  const nombre = [d.vehiculo.placa.toUpperCase(), [d.propietario.nombres, d.propietario.apellido1].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Formatos del celular";
  const hayAlgo = e.leidos.length > 0;

  async function enviar() {
    setOcupado("enviar"); setError(null);
    try {
      await api("/api/formatos-celular", { method: "POST", body: JSON.stringify({ nombre, datos: d, elegidos, fotos: fotos.current }) });
      setE((x) => ({ ...x, enviado: nombre }));
    } catch (err) { setError(mensaje(err)); } finally { setOcupado(null); }
  }
  async function compartir() {
    setOcupado("pdf"); setError(null);
    try {
      const bytes = await generarFormatos(d, elegidos, async (archivo) => { const r = await fetch(`/formatos/${archivo}`); if (!r.ok) throw new Error("No se pudo abrir el formato original."); return r.arrayBuffer(); });
      const archivo = new File([bytes as BlobPart], `formatos-${d.vehiculo.placa.toUpperCase() || "tramite"}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) await navigator.share({ files: [archivo], title: archivo.name });
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(archivo); a.download = archivo.name; a.click(); }
    } catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError(mensaje(err)); } finally { setOcupado(null); }
  }
  function empezar() {
    for (const t of Object.values(vigilando.current)) window.clearInterval(t);
    fotos.current = {};
    setE({ d: datosVacios(d.mandatario, ibagueDe(organismos)), leidos: [], compradorMandato: false }); setError(null); setAviso(null);
  }

  return (
    <>
      <CabeceraMovil titulo="Formatos" volver={volver} />
      <p className="muted" style={{ margin: 0 }}>Fotos de la tarjeta y las cédulas: se llenan el formulario único y los contratos. Lo que se lee llega solo a <b>Llenar formatos</b> si está abierto en el PC.</p>

      {DOCS.map((doc) => (
        <div key={doc.id} className="movil-formato-doc">
          <div className="fila" style={{ justifyContent: "space-between", gap: 8 }}>
            <b className="peq">{doc.nombre}</b>
            {e.leidos.includes(doc.id) && <span className="peq" style={{ color: "var(--verde)" }}><Check size={13} /> Leída</span>}
          </div>
          <input ref={(x) => { entradas.current[`c-${doc.id}`] = x; }} type="file" accept="image/*" capture="environment" hidden aria-label={`Cámara: ${doc.nombre}`} onChange={(x) => { leer(doc, x.target.files?.[0]); x.target.value = ""; }} />
          <input ref={(x) => { entradas.current[`g-${doc.id}`] = x; }} type="file" accept="image/*" hidden aria-label={`Galería: ${doc.nombre}`} onChange={(x) => { leer(doc, x.target.files?.[0]); x.target.value = ""; }} />
          <div className="fila" style={{ gap: 8 }}>
            <button className="btn" style={{ flex: 1, justifyContent: "center", height: 42 }} disabled={!!leyendo} onClick={() => entradas.current[`c-${doc.id}`]?.click()}>
              {leyendo === doc.id ? <><Loader2 size={15} className="girando" />Leyendo…</> : <><Camera size={15} />{e.leidos.includes(doc.id) ? "Otra foto" : "Tomar foto"}</>}
            </button>
            <button className="btn" style={{ height: 42 }} disabled={!!leyendo} onClick={() => entradas.current[`g-${doc.id}`]?.click()} aria-label={`Desde la galería: ${doc.nombre}`}><Images size={16} /></button>
          </div>
          <EnVivo v={e.vivo?.[doc.id]} reintentar={() => { const v = e.vivo?.[doc.id]; if (v) void alPc(doc.id, v.datos); }} />
        </div>
      ))}
      {aviso && <div className="aviso info">{aviso}</div>}
      {error && <div className="aviso error">{error}</div>}

      {hayAlgo && (
        <>
          <div className="movil-resumen">
            {d.vehiculo.placa && <div><span className="tenue">Vehículo</span><b>{d.vehiculo.placa.toUpperCase()}</b>{[d.vehiculo.marca, d.vehiculo.linea, d.vehiculo.modelo].filter(Boolean).join(" ")}</div>}
            {(d.propietario.documento || d.propietario.nombres) && <div><span className="tenue">Propietario</span><b>{[d.propietario.nombres, d.propietario.apellido1, d.propietario.apellido2].filter(Boolean).join(" ")}</b>{d.propietario.documento ? `CC ${d.propietario.documento}` : ""}</div>}
            {d.comprador && <div><span className="tenue">Comprador</span><b>{[d.comprador.nombres, d.comprador.apellido1, d.comprador.apellido2].filter(Boolean).join(" ")}</b>{d.comprador.documento ? `CC ${d.comprador.documento}` : ""}</div>}
          </div>
          <label className="movil-campo"><span>Organismo de tránsito</span>
            <select className="input" value={organismos.find((o) => o.nombre === d.organismo.nombre)?.id ?? ""} onChange={(x) => { const o = organismos.find((y) => y.id === x.target.value); ponerD((v) => ({ ...v, organismo: { nombre: o?.nombre ?? "", ciudad: o?.ciudad ?? "" } })); }}>
              <option value="">Sin organismo</option>
              {organismos.map((o) => <option key={o.id} value={o.id}>{o.ciudad ?? o.nombre}</option>)}
            </select>
          </label>
          <div className="movil-campo"><span>Trámite (punto 3 del formulario)</span>
            <div className="fila-wrap" style={{ gap: 6 }}>
              {CASILLAS_FUN.map((c) => {
                const on = d.casillas.includes(c.n);
                return <button key={c.n} className={`filtro-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => ponerD((v) => ({ ...v, casillas: on ? v.casillas.filter((n) => n !== c.n) : [...v.casillas, c.n].sort((a, b) => a - b) }))}>{c.nombre}</button>;
              })}
            </div>
          </div>

          <div className="movil-formatos-previa">
            <Ampliable horizontal><VistaFormato formato="fun" d={d} soloLectura titulo="Formulario único (frente)" /></Ampliable>
            <Ampliable horizontal><VistaReverso formato="fun" /></Ampliable>
            <Ampliable><VistaFormato formato="mandato_propietario" d={d} soloLectura titulo="Contrato de mandato del propietario" /></Ampliable>
            {d.comprador && (
              <details className="llenar-plegable">
                <summary>Contrato de compraventa</summary>
                <div style={{ marginTop: 10 }}><Ampliable><VistaFormato formato="compraventa" d={d} soloLectura titulo="Contrato de compraventa" /></Ampliable></div>
              </details>
            )}
            {d.comprador && (
              <details className="llenar-plegable">
                <summary>Ver más: mandato del comprador <small>(casi nunca se usa)</small></summary>
                <label className="fila peq" style={{ gap: 8, marginTop: 10 }}><input type="checkbox" checked={e.compradorMandato} onChange={(x) => poner({ compradorMandato: x.target.checked })} />Incluirlo</label>
                {e.compradorMandato && <div style={{ marginTop: 10 }}><Ampliable><VistaFormato formato="mandato_comprador" d={d} soloLectura titulo="Contrato de mandato del comprador" /></Ampliable></div>}
              </details>
            )}
          </div>

          {e.enviado && <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={16} />«{e.enviado}» llegó al PC: Formatos → Del celular.</div>}
          <div className="fila" style={{ gap: 8 }}>
            <button className="btn btn-primario" style={{ flex: 1, height: 48, justifyContent: "center" }} disabled={!!ocupado || !!leyendo} onClick={enviar}>{ocupado === "enviar" ? <Loader2 size={17} className="girando" /> : <Send size={17} />}Enviar al PC</button>
            <button className="btn" style={{ flex: 1, height: 48, justifyContent: "center" }} disabled={!!ocupado || !!leyendo} onClick={compartir}>{ocupado === "pdf" ? <Loader2 size={17} className="girando" /> : <Share2 size={17} />}Compartir PDF</button>
          </div>
          <button className="btn mtr-siguiente" onClick={empezar}><RotateCcw size={17} />Empezar otros formatos</button>
        </>
      )}
    </>
  );
}

/** Cómo va lo leído camino al PC: mandándolo, esperando que el PC lo tome, ya en el PC, o sin PC (volver a mandar). */
function EnVivo({ v, reintentar }: { v?: EstadoVivo; reintentar: () => void }) {
  if (!v) return null;
  if (v.estado === "llego") return <span className="movil-vivo ok"><Monitor size={13} />En el PC: ya está en Llenar formatos</span>;
  if (v.estado === "mandando" || v.estado === "esperando") return <span className="movil-vivo"><Loader2 size={13} className="girando" />{v.estado === "mandando" ? "Mandando al PC…" : "Esperando el PC (abra Llenar formatos allá)…"}</span>;
  return (
    <span className="movil-vivo aviso-vivo">
      <Monitor size={13} />{v.estado === "error" ? "No se pudo mandar al PC (revise la señal o vuelva a entrar)." : "Ningún PC lo tomó: abra Llenar formatos en el PC."}
      <button type="button" className="btn btn-sm" onClick={reintentar}><RotateCcw size={13} />Mandar otra vez</button>
    </span>
  );
}

/**
 * Una vista previa que se toca para verla en grande, a pantalla completa: la hoja a buen tamaño, para recorrerla con
 * el dedo (con el celular de lado se ve aún mejor).
 */
function Ampliable({ children, horizontal }: { children: ReactNode; horizontal?: boolean }) {
  const [grande, setGrande] = useState(false);
  return (
    <>
      <div className="ampliable" role="button" tabIndex={0} onClick={() => setGrande(true)} aria-label="Ver en grande">
        {children}
        <span className="ampliable-pista"><Maximize2 size={13} />Toque para ver en grande</span>
      </div>
      {grande && (
        <div className="ampliada" onClick={() => setGrande(false)}>
          <button className="btn btn-sm ampliada-cerrar" aria-label="Cerrar"><X size={16} />Cerrar</button>
          <div className={horizontal ? "ampliada-hoja horizontal" : "ampliada-hoja"} onClick={(e) => e.stopPropagation()}>{children}</div>
        </div>
      )}
    </>
  );
}
