import { AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, Circle, CircleCheck, Images, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { prepararParaSubir } from "../../fotos/procesar";
import { borrarFoto, fotosGuardadas, guardarFoto } from "./carrusel3x4";
import { CabeceraMovil, SesionCaida, subirFoto } from "./comun";

/**
 * Fotos 3x4 desde el celular: las fotos se acumulan en un carrusel (la grande y las miniaturas abajo; se pasan con el
 * dedo o con las flechas), para que la persona las vea y se escoja; nada se manda solo. Se marcan las que van al PC y
 * «Enviar al PC» las manda (sin marcar ninguna, manda la que se está viendo). En el PC quedan en fila, con el fondo en
 * blanco y listas para imprimir. Las que se eligen de la galería entran ya marcadas (se escogieron allá).
 * «Quitar todas» vacía el carrusel para empezar con otra persona (pregunta antes; las del PC siguen allá) y «Quitar
 * esta», la que se está viendo. Las fotos se guardan en el celular (carrusel3x4.ts): siguen ahí al cambiar de sección, al
 * salir a otra app o si el celular recarga; solo se van con esos dos botones.
 * Las que ya se mandaron traen «Volver a enviar» encima: si la impresión salió mal y el PC ya la borró de la fila, vuelve
 * a llegar como una foto nueva, sin tener que volver a tomársela a la persona.
 */
interface Foto { id: string; url: string; archivo: Blob; estado: "local" | "enviando" | "enviada" | "fallida"; marcada: boolean }

export function Fotos3x4Movil({ sesion, volver }: { sesion: string; volver?: () => void }) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [actual, setActual] = useState(0);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  /** Cuántas se enviaron en el último envío. */
  const [enviadasLote, setEnviadasLote] = useState(0);
  /** Preguntando si se quitan todas. */
  const [vaciar, setVaciar] = useState(false);
  const tira = useRef<HTMLDivElement>(null);
  const toque = useRef<number | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  // Las guardadas en el celular (de antes de cambiar de sección, salir de la app o recargar) vuelven al carrusel.
  const [cargadas, setCargadas] = useState(false);
  useEffect(() => {
    let vigente = true;
    void fotosGuardadas(sesion).then((g) => {
      if (!vigente) return;
      const previas: Foto[] = g.map((f) => { const url = URL.createObjectURL(f.archivo); urls.current.push(url); return { id: f.id, url, archivo: f.archivo, estado: f.estado, marcada: f.marcada }; });
      setFotos((l) => [...previas, ...l.filter((x) => !previas.some((p) => p.id === x.id))]);
      if (previas.length) setActual(previas.length - 1);
      setCargadas(true);
    });
    return () => { vigente = false; };
  }, [sesion]);
  // Cada cambio queda guardado en el celular (una que se estaba enviando, si se corta, queda por enviar). Solo se
  // vuelve a escribir la foto que cambió (de estado, de marca o de puesto), no todas.
  const escritas = useRef(new Map<string, string>());
  useEffect(() => {
    if (!cargadas) return;
    fotos.forEach((f, orden) => {
      const estado = f.estado === "enviando" ? "local" : f.estado, marcada = f.estado === "enviando" ? true : f.marcada;
      const firma = `${estado}|${marcada}|${orden}`;
      if (escritas.current.get(f.id) === firma) return;
      escritas.current.set(f.id, firma);
      void guardarFoto({ id: f.id, sesion, archivo: f.archivo, estado, marcada, orden });
    });
  }, [fotos, cargadas, sesion]);
  // La miniatura de la foto que se está viendo, a la vista en la tira.
  useEffect(() => { tira.current?.children[actual]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }, [actual, fotos.length]);

  /** Las fotos nuevas entran al carrusel (sin mandarse); las de la galería, ya marcadas para enviar. */
  async function alElegir(archivos: File[], deGaleria: boolean) {
    if (!archivos.length) return;
    setPreparando(true); setMensaje(null); setEnviadasLote(0);
    const nuevas: Foto[] = [];
    for (const a of archivos) {
      try { const archivo = await prepararParaSubir(a); const url = URL.createObjectURL(archivo); urls.current.push(url); nuevas.push({ id: crypto.randomUUID(), url, archivo, estado: "local", marcada: deGaleria }); }
      catch (e) { setMensaje(`Una foto no se pudo abrir: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (nuevas.length) { setActual(fotos.length + nuevas.length - 1); setFotos((l) => [...l, ...nuevas]); }
    setPreparando(false);
  }
  const poner = (i: number, cambio: Partial<Foto>) => setFotos((l) => l.map((f, k) => (k === i ? { ...f, ...cambio } : f)));
  const pendientes = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.estado !== "enviada" && x.f.estado !== "enviando");
  const marcadas = pendientes.filter((x) => x.f.marcada);
  const ver = fotos[actual];

  /** Manda las marcadas (o, si no hay ninguna marcada, la que se está viendo), una por una. */
  async function enviar(cuales = marcadas.length ? marcadas.map((x) => x.i) : ver && ver.estado !== "enviada" ? [actual] : []) {
    if (!cuales.length) return;
    setEnviando(true); setMensaje(null); setEnviadasLote(0);
    let ok = 0, fallaron = 0, ultimoError = "";
    for (let k = 0; k < cuales.length; k++) {
      const i = cuales[k];
      poner(i, { estado: "enviando" });
      try { await subirFoto(sesion, fotos[i].archivo); poner(i, { estado: "enviada", marcada: false }); ok++; }
      catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e);
        fallaron++;
        poner(i, { estado: "fallida", marcada: true });
        if (e instanceof SesionCaida) { for (const j of cuales.slice(k + 1)) poner(j, { estado: "fallida", marcada: true }); fallaron += cuales.length - k - 1; break; }
      }
    }
    setEnviando(false);
    setEnviadasLote(ok);
    if (fallaron) setMensaje(cuales.length === 1 ? `La foto no se envió. ${ultimoError}` : `Se enviaron ${ok} de ${cuales.length}. ${fallaron} no se enviaron: ${ultimoError}`);
  }
  const fallidas = fotos.map((f, i) => ({ f, i })).filter((x) => x.f.estado === "fallida");
  /** Vacía el carrusel (las fotos que ya están en el PC siguen allá). */
  function quitarTodas() {
    fotos.forEach((f) => void borrarFoto(f.id));
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setFotos([]); setActual(0); setMensaje(null); setEnviadasLote(0); setVaciar(false);
  }
  /** Quita la que se está viendo (del carrusel y del celular; si ya estaba en el PC, allá sigue). */
  function quitarEsta() {
    if (!ver) return;
    void borrarFoto(ver.id);
    URL.revokeObjectURL(ver.url);
    setFotos((l) => l.filter((f) => f.id !== ver.id));
    setActual((a) => Math.max(0, Math.min(a, fotos.length - 2)));
    setQuitandoEsta(false);
  }
  const [quitandoEsta, setQuitandoEsta] = useState(false);
  const mover = (d: number) => setActual((a) => Math.max(0, Math.min(fotos.length - 1, a + d)));
  const ocupado = preparando || enviando;
  const puedeMarcar = !!ver && (ver.estado === "local" || ver.estado === "fallida");

  return (
    <>
      <CabeceraMovil titulo="Fotos 3x4" volver={volver} />
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>Persona de frente, con buena luz y de la cintura para arriba. Tome las que quiera y mándelas al PC: se quedan aquí por si hay que volver a enviarlas.</p>
      <div className="tomar-vista f3-vista"
        onTouchStart={(e) => { toque.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (toque.current === null) return; const dx = e.changedTouches[0].clientX - toque.current; toque.current = null; if (Math.abs(dx) > 40) mover(dx < 0 ? 1 : -1); }}>
        {ver ? <img key={ver.url} src={ver.url} alt={`Foto ${actual + 1} de ${fotos.length}`} /> : <Camera size={56} className="tenue" />}
        {ver && fotos.length > 1 && (
          <>
            <button className="f3-flecha izq" aria-label="Foto anterior" disabled={actual === 0} onClick={() => mover(-1)}><ChevronLeft size={22} /></button>
            <button className="f3-flecha der" aria-label="Foto siguiente" disabled={actual === fotos.length - 1} onClick={() => mover(1)}><ChevronRight size={22} /></button>
            <span className="f3-contador">{actual + 1} de {fotos.length}</span>
          </>
        )}
        {ver && puedeMarcar && (
          <button className={`f3-marcar${ver.marcada ? " on" : ""}`} aria-pressed={ver.marcada} onClick={() => poner(actual, { marcada: !ver.marcada })}>
            {ver.marcada ? <><CircleCheck size={18} />Va al PC</> : <><Circle size={18} />Elegir para el PC</>}
          </button>
        )}
        {ver && ver.estado === "enviada" && (
          <button className="f3-marcar" disabled={ocupado} onClick={() => void enviar([actual])}><Send size={16} />Volver a enviar</button>
        )}
        {ver && ver.estado !== "local" && <span className={`f3-estado ${ver.estado}`}>{ver.estado === "enviando" ? <><Loader2 size={13} className="girando" />Enviando</> : ver.estado === "enviada" ? <><Check size={13} />En el PC</> : <><AlertTriangle size={13} />No se envió</>}</span>}
        {preparando && <div className="tomar-capa"><Loader2 size={28} className="girando" />Preparando la foto…</div>}
      </div>
      {fotos.length > 0 && (
        <div className="f3-tira" ref={tira} role="group" aria-label="Fotos de esta vez">
          {fotos.map((f, i) => (
            <button key={f.id} className={`f3-mini${i === actual ? " on" : ""} ${f.estado}${f.marcada ? " marcada" : ""}`} aria-label={`Ver la foto ${i + 1}`} aria-current={i === actual} onClick={() => setActual(i)}>
              <img src={f.url} alt="" />
              {f.marcada && f.estado !== "enviada" && <CircleCheck size={15} className="f3-mini-marca" />}
              {f.estado === "enviada" && <Check size={12} className="f3-mini-enviada" />}
              {f.estado === "fallida" && <AlertTriangle size={12} className="f3-mini-ic" />}
            </button>
          ))}
        </div>
      )}
      {enviadasLote > 0 && !fallidas.length && !enviando && <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={16} />{enviadasLote > 1 ? `Enviadas al PC: ${enviadasLote}. Siguen aquí por si hay que volver a enviarlas.` : "Enviada al PC. Sigue aquí por si hay que volver a enviarla."}</div>}
      {mensaje && (
        <div className="aviso error">
          <span>{mensaje}</span>
          {fallidas.length > 0 && !enviando && <button className="btn btn-sm" onClick={() => enviar(fallidas.map((x) => x.i))}><RotateCcw size={13} />Reintentar {fallidas.length > 1 ? `las ${fallidas.length}` : "la foto"}</button>}
        </div>
      )}
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label="Cámara" onChange={(e) => { void alElegir([...(e.target.files ?? [])], false); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*" multiple hidden aria-label="Galería" onChange={(e) => { void alElegir([...(e.target.files ?? [])], true); e.target.value = ""; }} />
      {pendientes.length > 0 && (
        <button className="btn btn-primario tomar-boton" disabled={ocupado || (!marcadas.length && !puedeMarcar)} onClick={() => void enviar()}>
          {enviando ? <Loader2 size={18} className="girando" /> : <Send size={18} />}{marcadas.length ? `Enviar al PC (${marcadas.length})` : "Enviar esta al PC"}
        </button>
      )}
      <button className={`btn tomar-boton${pendientes.length ? "" : " btn-primario"}`} disabled={ocupado} onClick={() => camara.current?.click()}>
        <Camera size={18} />{fotos.length ? "Tomar otra" : "Tomar foto"}
      </button>
      <button className="btn tomar-boton tomar-galeria" disabled={ocupado} onClick={() => galeria.current?.click()}>
        <Images size={18} />Subir de la galería
      </button>
      {/* Quitar solo la que se está viendo (si no se ha mandado al PC, pregunta: se pierde). */}
      {ver && (quitandoEsta ? (
        <div className="aviso f3-vaciar" role="alertdialog" aria-label="Quitar esta foto">
          <span>{ver.estado === "enviada" ? "¿Quitar esta foto del carrusel? En el PC sigue allá." : "¿Quitar esta foto? No se ha mandado al PC y se pierde."}</span>
          <span className="fila" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-peligro" onClick={quitarEsta}><Trash2 size={14} />Sí, quitar esta</button>
            <button className="btn btn-sm" onClick={() => setQuitandoEsta(false)}>No</button>
          </span>
        </div>
      ) : (
        <button className="btn tomar-boton f3-quitar" disabled={ocupado} onClick={() => { setVaciar(false); setQuitandoEsta(true); }}>
          <Trash2 size={18} />Quitar esta foto
        </button>
      ))}
      {fotos.length > 0 && (vaciar ? (
        <div className="aviso f3-vaciar" role="alertdialog" aria-label="Quitar todas las fotos">
          <span>{pendientes.length ? `¿Quitar las ${fotos.length} fotos? ${pendientes.length === 1 ? "Una no se ha mandado" : `${pendientes.length} no se han mandado`} al PC y se pierde${pendientes.length === 1 ? "" : "n"}.` : `¿Quitar las ${fotos.length} fotos del carrusel? Las del PC siguen allá.`}</span>
          <span className="fila" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-peligro" onClick={quitarTodas}><Trash2 size={14} />Sí, quitar todas</button>
            <button className="btn btn-sm" onClick={() => setVaciar(false)}>No</button>
          </span>
        </div>
      ) : (
        <button className="btn tomar-boton f3-quitar" disabled={ocupado} onClick={() => { setQuitandoEsta(false); setVaciar(true); }}>
          <Trash2 size={18} />Quitar todas las fotos ({fotos.length})
        </button>
      ))}
    </>
  );
}
