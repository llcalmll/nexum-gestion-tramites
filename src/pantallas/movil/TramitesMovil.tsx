import { CalendarClock, Camera, Car, ChevronRight, Copy, ExternalLink, FileText, IdCard, ImagePlus, Loader2, MessageCircle, Phone, Pin, Plus, Search, Send, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ESTADO_TRAMITE_COLOR, ESTADO_TRAMITE_LABEL, type EstadoTramite, normalizar, ROL_PERSONA_LABEL, type RolPersona } from "../../../compartido/dominio";
import { copiarTexto } from "../../componentes/Copiar";
import { Badge } from "../../componentes/ui";
import { prepararParaSubir } from "../../fotos/procesar";
import { fecha, hoyISO, TONO_SEMAFORO } from "../../logica/formato";
import { CabeceraMovil, MENSAJE_SESION, SesionCaida } from "./comun";

/*
 * Trámites y licencias en el celular: buscar (por placa, cliente, cédula, número o ciudad), ver lo importante de un
 * trámite (placa y vehículo, personas, documentos, notas) y, sobre todo, pegarle un documento con la cámara o desde la
 * galería sin pasar por WhatsApp ni por el PC. También escribir una nota en su bitácora. Las licencias, por vencerse
 * primero. Todo va directo a la API (el celular no descarga la base).
 */

export interface TramiteLista { id: string; codigo: string; tipo: string; categoria: string; placa: string | null; titular: string; estado: string; ciudad: string | null; detalle: string | null; problema: boolean; creado: string; nota: string | null }
interface Documento { id: string; tramiteId: string; tipoDocumento: string; estado: string; archivoTipo: string | null; tieneArchivo: boolean }
interface Persona { rol: string; nombre: string; tipoDocumento: string; numeroDocumento: string; telefono: string | null; otrosTelefonos?: string[] | null }
interface Detalle {
  tramite: { id: string; codigo: string; tipo: string; categoria: string; estado: string; ciudad: string | null; organismo: string | null; detalle: string | null; fechaEstimadaEntrega: string | null; observaciones: string | null; partes: { id: string; tipo: string }[] };
  vehiculo: { placa: string; marca: string | null; linea: string | null; modelo: number | null; clase: string | null; color: string | null; servicio: string | null } | null;
  titular: Persona & { id: string } | undefined;
  personas: Persona[];
  documentos: Documento[];
  bitacora: { id: string; tramiteId: string; fecha: string; tipoEvento: string; descripcion: string | null; destacada: boolean; fijada?: boolean }[];
  /** La nota destacada (la estrella) y las fijadas (la chinche), aunque sean viejas. */
  destacada?: string | null; fijadas?: string[];
}
interface Licencia { clienteId: string; nombre: string; documento: string; telefono: string | null; vencimiento: string; expedicion: string | null; categorias: string[] }

/** Pide a la API; la sesión vencida se avisa con su mensaje. */
async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try { r = await fetch(ruta, { credentials: "same-origin", redirect: "manual", ...init }); } catch { throw new Error("Sin conexión: revise el internet."); }
  if (r.type === "opaqueredirect" || r.status === 401) throw new SesionCaida(MENSAJE_SESION);
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? `No se pudo (${r.status}).`);
  return d;
}
const json = (metodo: string, cuerpo: unknown): RequestInit => ({ method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
const placaBonita = (p: string) => (p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p);
const estado = (e: string) => <Badge tono={TONO_SEMAFORO[ESTADO_TRAMITE_COLOR[e as EstadoTramite]] ?? "gris"} punto>{ESTADO_TRAMITE_LABEL[e as EstadoTramite] ?? e}</Badge>;
const whatsapp = (tel: string) => { const d = tel.replace(/\D/g, ""); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? `57${d}` : d}` : null; };

/** Una sola fila: los trámites de vehículos, los de licencia (cada uno como su tabla del PC) y los vencimientos de las licencias. */
type Pestana = "tramites" | "licencias" | "vencimientos";
const PESTANAS: { id: Pestana; texto: string; icono: typeof Car }[] = [
  { id: "tramites", texto: "Vehículos", icono: Car },
  { id: "licencias", texto: "De licencia", icono: IdCard },
  { id: "vencimientos", texto: "Vencimientos", icono: CalendarClock },
];

export function TramitesMovil({ volver }: { volver: () => void }) {
  // La que se dejó la última vez en este celular.
  const [pestana, setPestana] = useState<Pestana>(() => { const p = leerLocal("movil-tramites-pestana"); return PESTANAS.some((x) => x.id === p) ? (p as Pestana) : "tramites"; });
  useEffect(() => { guardarLocal("movil-tramites-pestana", pestana); }, [pestana]);
  const [abierto, setAbierto] = useState<string | null>(null);
  /** Lo buscado, cuando «Buscar en los de …» pasa a la otra pestaña. */
  const [llevar, setLlevar] = useState("");
  if (abierto) return <DetalleMovil id={abierto} volver={() => setAbierto(null)} />;
  return (
    <>
      <CabeceraMovil titulo="Trámites y licencias" volver={volver} />
      <div className="seg mtr-pestanas" role="tablist" aria-label="Qué ver">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" aria-selected={pestana === p.id} className={pestana === p.id ? "on" : ""} onClick={() => { setLlevar(""); setPestana(p.id); }}><p.icono size={15} />{p.texto}</button>
        ))}
      </div>
      {pestana === "vencimientos" ? <ListaLicencias /> : <ListaTramites key={pestana} seccion={pestana} qInicial={llevar} cambiarSeccion={(s, q) => { setLlevar(q); setPestana(s); }} abrir={setAbierto} />}
    </>
  );
}

/** Busca mientras se escribe (un momento después de la última letra). */
function useBusqueda<T>(ruta: (q: string) => string, deps: unknown[], inicial = "") {
  const [q, setQ] = useState(inicial);
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const t = setTimeout(() => {
      pedir<T>(ruta(q)).then((d) => { if (vivo) { setDatos(d); setError(null); } }, (e) => { if (vivo) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (vivo) setCargando(false); });
    }, q ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { q, setQ, datos, error, cargando };
}

function Buscador({ q, setQ, placeholder, cargando }: { q: string; setQ: (v: string) => void; placeholder: string; cargando: boolean }) {
  return (
    <div className="mtr-buscar">
      {cargando ? <Loader2 size={17} className="girando" /> : <Search size={17} />}
      <input type="search" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

/**
 * La lista para buscar trámites (aquí abre el trámite; en el escáner, lo elige para adjuntarle el escaneo).
 * Con `seccion`: como la tabla del PC, solo los de vehículos o solo los de licencia, todos, del número más alto al más
 * bajo (Todos/Abiertos se recuerda en este celular). Sin sección (el escáner): un solo buscador para los dos, los abiertos.
 */
export function ListaTramites({ abrir, seccion, cambiarSeccion, qInicial = "" }: { abrir: (id: string, t: TramiteLista) => void; seccion?: "tramites" | "licencias"; cambiarSeccion?: (s: "tramites" | "licencias", q: string) => void; qInicial?: string }) {
  const secciones = !!seccion;
  const [ver, setVer] = useState<"abiertos" | "todos">(() => (!secciones || leerLocal("movil-tramites-ver") === "abiertos" ? "abiertos" : "todos"));
  useEffect(() => { if (secciones) guardarLocal("movil-tramites-ver", ver); }, [secciones, ver]);
  const { q, setQ, datos, error, cargando } = useBusqueda<{ tramites: TramiteLista[]; mas: boolean }>((x) => `/api/movil/tramites?${seccion ? `seccion=${seccion}&` : ""}ver=${ver}&q=${encodeURIComponent(x)}`, [seccion, ver], qInicial);
  const otra = seccion === "tramites" ? "licencias" : "tramites";
  return (
    <div className="mtr-lista">
      <Buscador q={q} setQ={setQ} placeholder="Placa, cliente, cédula o número" cargando={cargando} />
      <div className="mtr-chips" role="group" aria-label="Cuáles">
        <button className={ver === "todos" ? "on" : ""} aria-pressed={ver === "todos"} onClick={() => setVer("todos")}>Todos</button>
        <button className={ver === "abiertos" ? "on" : ""} aria-pressed={ver === "abiertos"} onClick={() => setVer("abiertos")}>Abiertos</button>
      </div>
      {error && <div className="aviso error">{error}</div>}
      {datos && !datos.tramites.length && (
        <div className="mtr-vacio">
          {q.trim() ? `Nada con «${q}»${secciones ? ` en ${seccion === "tramites" ? "los de vehículos" : "los de licencia"}` : ""}.` : ver === "abiertos" ? "No hay abiertos." : "No hay trámites."}
          {q.trim() && secciones && cambiarSeccion && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => cambiarSeccion(otra, q)}>Buscar en {otra === "tramites" ? "los de vehículos" : "los de licencia"}</button>}
        </div>
      )}
      {datos?.tramites.map((t, i) => (
        <button key={t.id} className="mtr-tarjeta" style={{ "--i": Math.min(i, 12) } as React.CSSProperties} onClick={() => abrir(t.id, t)}>
          <div className="mtr-tarjeta-arriba">
            {t.placa ? <span className="placa"><b>{placaBonita(t.placa)}</b></span> : t.categoria === "licencia" ? <span className="licencia-mini"><i /><b>{(t.detalle ?? "").split(",").filter(Boolean).join(" ") || "LIC"}</b></span> : <span className="mtr-codigo">{t.codigo}</span>}
            {estado(t.estado)}
          </div>
          <b className="mtr-tipo">{t.tipo}</b>
          <span className="mtr-sub">{t.titular}</span>
          <span className="mtr-pie">{[t.placa || t.categoria === "licencia" ? t.codigo : "", t.ciudad, fecha(t.creado)].filter(Boolean).join(" · ")}</span>
          {t.nota && <span className="mtr-nota"><StickyNote size={13} />{t.nota}</span>}
          <ChevronRight size={18} className="mtr-flecha" />
        </button>
      ))}
      {datos?.mas && <div className="mtr-vacio">Hay más: escriba algo para buscar.</div>}
    </div>
  );
}

function ListaLicencias() {
  const { q, setQ, datos, error, cargando } = useBusqueda<{ licencias: Licencia[] }>((x) => `/api/movil/licencias?q=${encodeURIComponent(x)}`, []);
  const hoy = hoyISO();
  const en60 = new Date(Date.parse(`${hoy}T12:00:00Z`) + 60 * 864e5).toISOString().slice(0, 10);
  return (
    <div className="mtr-lista">
      <Buscador q={q} setQ={setQ} placeholder="Nombre, cédula o categoría" cargando={cargando} />
      {error && <div className="aviso error">{error}</div>}
      {datos && !datos.licencias.length && <div className="mtr-vacio">{q.trim() ? `Nada con «${q}».` : "Todavía no hay licencias."}</div>}
      {datos?.licencias.map((l, i) => {
        const vencida = l.vencimiento < hoy, pronto = !vencida && l.vencimiento <= en60;
        const wa = l.telefono ? whatsapp(l.telefono) : null;
        return (
          <div key={`${l.clienteId}|${l.vencimiento}`} className="mtr-tarjeta mtr-licencia" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
            <div className="mtr-tarjeta-arriba">
              <span className="licencia-mini"><i /><b>{l.categorias.join(" ")}</b></span>
              <Badge tono={vencida ? "rojo" : pronto ? "ambar" : "verde"} punto>{vencida ? "Vencida" : pronto ? "Vence pronto" : "Vigente"}</Badge>
            </div>
            <b className="mtr-tipo">{l.nombre}</b>
            <span className="mtr-sub">C.C. {l.documento} · vence el {fecha(l.vencimiento)}</span>
            {l.telefono && (
              <div className="mtr-acciones">
                <a className="btn btn-sm" href={`tel:${l.telefono}`}><Phone size={14} />Llamar</a>
                {wa && <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Nombres de documentos frecuentes, para no escribirlos. */
/**
 * Lo que se sugiere al agregar un documento, según el trámite (lo más común primero; lo opcional al final). Una
 * licencia no pide tarjeta de propiedad ni improntas: la primera vez lleva la carta de compromiso, los exámenes
 * médicos y el recibo de pago; la refrendación, los exámenes y el recibo (la cédula, si acaso).
 */
function sugeridosPara(tipo: string, categoria: string): string[] {
  const t = normalizar(tipo);
  const recibos = ["Recibo de pago", "Recibo de caja menor"];
  if (categoria === "licencia") {
    if (/expedici/.test(t)) return ["Carta de compromiso firmada", "Exámenes médicos", ...recibos, "Certificado de la academia (CEA)", "Fotocopia de la cédula", "Otro"];
    if (/renovaci|refrend/.test(t)) return ["Exámenes médicos", ...recibos, "Fotocopia de la cédula", "Otro"];
    return ["Exámenes médicos", ...recibos, "Fotocopia de la licencia de conducción", "Fotocopia de la cédula", "Otro"];
  }
  if (categoria === "seguros_multas") return ["Fotocopia de la cédula", "Tarjeta de propiedad", "Fotocopia de la licencia de conducción", "Comparendo", ...recibos, "Otro"];
  return ["Cédula del titular", "Tarjeta de propiedad", "SOAT", "Contrato", "Formulario único", "Paz y salvo", "Improntas", ...recibos, ...(/traspaso/.test(t) ? ["Recibo de retención en la fuente"] : []), "Otro"];
}

function DetalleMovil({ id, volver }: { id: string; volver: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [guardandoNota, setGuardandoNota] = useState(false);
  /** Lo que se va a quitar (un documento pegado por error o una entrada de la bitácora): se pregunta en su fila. */
  const [aBorrar, setABorrar] = useState<{ que: "doc" | "entrada"; id: string; tramiteId: string } | null>(null);
  const [borrando, setBorrando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  // A qué documento va la foto que se está tomando o eligiendo ("nuevo:<nombre>" si es uno nuevo).
  const destino = useRef<string | null>(null);

  const cargar = () => pedir<Detalle>(`/api/movil/tramites/${id}`).then((x) => { setD(x); setError(null); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const avisar = (m: string) => { setAviso(m); setTimeout(() => setAviso((x) => (x === m ? null : x)), 3500); };

  function pedirFoto(doc: string, conCamara: boolean) {
    destino.current = doc;
    (conCamara ? camara : archivo).current?.click();
  }
  async function alElegir(f: File | undefined) {
    const doc = destino.current;
    if (!f || !doc || !d) return;
    setSubiendo(doc); setError(null);
    try {
      let docId = doc;
      if (doc.startsWith("nuevo:")) {
        const r = await pedir<{ id: string }>(`/api/tramites/${d.tramite.id}/documentos`, json("POST", { tipoDocumento: doc.slice(6) }));
        docId = r.id;
      }
      // Las fotos se achican (se ven igual de bien y suben rápido); un PDF va tal cual.
      const esPdf = f.type === "application/pdf";
      const cuerpo = esPdf ? f : await prepararParaSubir(f, 2200);
      const nombre = esPdf ? f.name : `${(doc.startsWith("nuevo:") ? doc.slice(6) : d.documentos.find((x) => x.id === doc)?.tipoDocumento ?? "documento").replace(/\s+/g, "-").toLowerCase()}.jpg`;
      await pedir(`/api/documentos/${docId}/archivo`, { method: "PUT", headers: { "Content-Type": esPdf ? "application/pdf" : "image/jpeg", "X-Nombre-Archivo": encodeURIComponent(nombre) }, body: cuerpo });
      avisar("Documento guardado en el trámite");
      setNuevo(null);
      await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSubiendo(null); destino.current = null; }
  }
  async function anotar() {
    if (!nota.trim() || !d) return;
    setGuardandoNota(true); setError(null);
    try { await pedir(`/api/tramites/${d.tramite.id}/notas`, json("POST", { texto: nota.trim() })); setNota(""); avisar("Nota guardada"); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setGuardandoNota(false); }
  }
  async function borrar() {
    if (!aBorrar) return;
    setBorrando(true); setError(null);
    try {
      await pedir(aBorrar.que === "doc" ? `/api/documentos/${aBorrar.id}` : `/api/tramites/${aBorrar.tramiteId}/bitacora/${aBorrar.id}`, { method: "DELETE" });
      avisar(aBorrar.que === "doc" ? "Documento quitado del trámite" : "Borrado de la bitácora");
      setABorrar(null);
      await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBorrando(false); }
  }
  /** La pregunta antes de quitar, en la fila de lo que se quita. */
  const preguntar = (texto: string) => (
    <div className="aviso mtr-confirmar" role="alertdialog" aria-label={texto}>
      <span>{texto}</span>
      <span className="fila" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-peligro" disabled={borrando} onClick={() => void borrar()}>{borrando ? <Loader2 size={14} className="girando" /> : <Trash2 size={14} />}Sí, quitar</button>
        <button className="btn btn-sm" disabled={borrando} onClick={() => setABorrar(null)}>No</button>
      </span>
    </div>
  );
  const copiar = async (v: string, que: string) => { if (await copiarTexto(v)) avisar(`${que} copiado`); };

  if (!d) return (
    <>
      <CabeceraMovil titulo="Trámite" volver={volver} />
      {error ? <div className="aviso error">{error}</div> : <div className="mtr-vacio"><Loader2 size={18} className="girando" /> Cargando…</div>}
    </>
  );
  const t = d.tramite, v = d.vehiculo;
  const destacada = d.destacada !== undefined ? d.destacada : d.bitacora.find((b) => b.destacada)?.descripcion ?? null;
  const personas = [...(d.titular ? [{ ...d.titular, rol: "titular" }] : []), ...d.personas.filter((p) => p.rol !== "titular")];
  return (
    <>
      <CabeceraMovil titulo={t.codigo} volver={volver} />
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void alElegir(e.target.files?.[0]); e.target.value = ""; }} aria-label="Tomar foto del documento" />
      <input ref={archivo} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void alElegir(e.target.files?.[0]); e.target.value = ""; }} aria-label="Elegir el documento de la galería" />
      <div className="mtr-detalle">
        <section className="mtr-heroe">
          <div className="mtr-tarjeta-arriba">
            {v?.placa ? <button className="placa mtr-placa-grande" onClick={() => void copiar(v.placa, "Placa")} title="Copiar la placa"><b>{placaBonita(v.placa)}</b></button> : t.categoria === "licencia" ? <span className="licencia-mini"><i /><b>{(t.detalle ?? "").split(",").filter(Boolean).join(" ") || "LIC"}</b></span> : null}
            {estado(t.estado)}
          </div>
          <b className="mtr-heroe-tipo">{t.tipo}</b>
          <span className="mtr-sub">{[t.organismo ?? t.ciudad, t.fechaEstimadaEntrega && `entrega estimada ${fecha(t.fechaEstimadaEntrega)}`].filter(Boolean).join(" · ")}</span>
          {v && <span className="mtr-sub">{[v.marca, v.linea, v.modelo, v.color, v.servicio].filter(Boolean).join(" · ")}</span>}
          {destacada && <div className="mtr-nota grande"><StickyNote size={15} />{destacada}</div>}
          {(d.fijadas ?? []).map((f, i) => <div key={i} className="mtr-nota fijada"><Pin size={13} />{f}</div>)}
        </section>

        <section className="mtr-seccion">
          <h3>Personas</h3>
          {personas.map((p, i) => {
            const wa = p.telefono ? whatsapp(p.telefono) : null;
            return (
              <div key={i} className="mtr-persona">
                <small>{ROL_PERSONA_LABEL[p.rol as RolPersona] ?? p.rol}</small>
                <b>{p.nombre}</b>
                <span className="mtr-sub">{p.numeroDocumento ? <button className="mtr-copiable" onClick={() => void copiar(p.numeroDocumento, "Documento")}>{p.tipoDocumento} {p.numeroDocumento}<Copy size={12} /></button> : "Sin documento"}</span>
                {p.telefono && (
                  <div className="mtr-acciones">
                    <a className="btn btn-sm" href={`tel:${p.telefono}`}><Phone size={14} />{p.telefono}</a>
                    {wa && <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>}
                    {/* Los otros números de la persona: también para llamar. */}
                    {(p.otrosTelefonos ?? []).map((x) => <a key={x} className="btn btn-sm" href={`tel:${x}`} aria-label={`Llamar al otro número ${x}`}><Phone size={14} />{x}</a>)}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="mtr-seccion">
          <h3>Documentos</h3>
          {!d.documentos.length && <span className="mtr-sub">Todavía no tiene documentos.</span>}
          {d.documentos.map((doc) => (
            <div key={doc.id} className="pila" style={{ gap: 6 }}>
              <div className={`mtr-doc${doc.tieneArchivo ? " con" : ""}`}>
                <FileText size={18} />
                <span className="mtr-doc-nombre"><b>{doc.tipoDocumento}</b><small>{doc.tieneArchivo ? "Con archivo" : "Falta el archivo"}</small></span>
                {subiendo === doc.id ? <Loader2 size={18} className="girando" /> : (
                  <div className="mtr-doc-acc">
                    {doc.tieneArchivo && <a className="btn btn-sm" href={`/api/documentos/${doc.id}/archivo`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Ver</a>}
                    <button className="btn btn-sm" aria-label={`Tomar foto: ${doc.tipoDocumento}`} onClick={() => pedirFoto(doc.id, true)}><Camera size={14} />{doc.tieneArchivo ? "" : "Foto"}</button>
                    <button className="btn btn-sm btn-fantasma" aria-label={`Elegir de la galería: ${doc.tipoDocumento}`} onClick={() => pedirFoto(doc.id, false)}><ImagePlus size={14} /></button>
                    <button className="btn btn-sm mtr-borrar" aria-label={`Quitar: ${doc.tipoDocumento}`} title="Quitar del trámite" onClick={() => setABorrar({ que: "doc", id: doc.id, tramiteId: doc.tramiteId })}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              {aBorrar?.que === "doc" && aBorrar.id === doc.id && preguntar(`¿Quitar «${doc.tipoDocumento}» del trámite${doc.tieneArchivo ? " con su archivo" : ""}?`)}
            </div>
          ))}
          {nuevo === null ? (
            <button className="btn mtr-agregar" onClick={() => setNuevo("")}><Plus size={15} />Agregar un documento</button>
          ) : (
            <div className="mtr-nuevo">
              <div className="mtr-chips">
                {sugeridosPara(t.tipo, t.categoria).filter((s) => s === "Otro" || !d.documentos.some((x) => normalizar(x.tipoDocumento) === normalizar(s))).map((s) => <button key={s} className={nuevo === s ? "on" : ""} onClick={() => setNuevo(s === "Otro" ? " " : s)}>{s}</button>)}
              </div>
              <input className="input" value={nuevo.trimStart()} onChange={(e) => setNuevo(e.target.value)} placeholder="Nombre del documento" aria-label="Nombre del documento nuevo" autoFocus={nuevo === " "} />
              {subiendo?.startsWith("nuevo:") ? <div className="mtr-sub"><Loader2 size={15} className="girando" /> Subiendo…</div> : (
                <div className="mtr-acciones">
                  <button className="btn btn-primario" disabled={!nuevo.trim()} onClick={() => pedirFoto(`nuevo:${nuevo.trim()}`, true)}><Camera size={15} />Tomar foto</button>
                  <button className="btn" disabled={!nuevo.trim()} onClick={() => pedirFoto(`nuevo:${nuevo.trim()}`, false)}><ImagePlus size={15} />Galería</button>
                  <button className="btn btn-fantasma" onClick={() => setNuevo(null)}>Cancelar</button>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mtr-seccion">
          <h3>Notas</h3>
          <div className="mtr-escribir">
            <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escribir una nota…" aria-label="Escribir una nota en la bitácora" />
            <button className="btn btn-primario btn-icono" disabled={!nota.trim() || guardandoNota} onClick={() => void anotar()} aria-label="Guardar la nota">{guardandoNota ? <Loader2 size={16} className="girando" /> : <Send size={16} />}</button>
          </div>
          {d.bitacora.filter((b) => b.descripcion).slice(0, 8).map((b) => (
            <div key={b.id} className="pila" style={{ gap: 6 }}>
              <div className={`mtr-evento${b.tipoEvento === "nota" ? " nota" : ""}`}>
                <small>{fecha(b.fecha.slice(0, 10))}</small>
                <span>{b.descripcion}</span>
                <button className="btn btn-sm btn-icono mtr-borrar" aria-label={b.tipoEvento === "nota" ? "Borrar nota" : "Borrar de la bitácora"} title="Borrar" onClick={() => setABorrar({ que: "entrada", id: b.id, tramiteId: b.tramiteId })}><Trash2 size={14} /></button>
              </div>
              {aBorrar?.que === "entrada" && aBorrar.id === b.id && preguntar(b.tipoEvento === "nota" ? "¿Borrar esta nota?" : "¿Borrar esta entrada de la bitácora?")}
            </div>
          ))}
        </section>
      </div>
      {error && <div className="aviso error mtr-flotante">{error}</div>}
      {aviso && <div className="aviso ok mtr-flotante">{aviso}</div>}
    </>
  );
}

/** Lo elegido en este celular (si el navegador no deja guardar, se empieza con lo de siempre). */
function leerLocal(clave: string) { try { return localStorage.getItem(clave); } catch { return null; } }
function guardarLocal(clave: string, valor: string) { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } }
