import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2, Pin, Plus, Star, StarOff, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { COLORES_NOTA, type ColorNota } from "../../compartido/dominio";
import type { Nota } from "../../compartido/tipos";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { abrirMenu, type ItemMenu } from "./MenuContextual";
import { useUI } from "./ui";

/*
 * Noticas: notas rápidas y tareas del día, como papelitos pegados. Las pendientes se ven en la barra de arriba, en
 * cualquier pantalla (papelitos de su color; las fijadas primero, con chinche; un toque abre el panel y el ✓ la da por
 * hecha). El botón, junto a la fecha (son las cosas de hoy), despliega todas debajo (se cierra con la X, al tocar fuera o
 * con Esc). "+ Nueva notica" saca una en blanco para escribir (✓ Guardar o Enter), aparte de las ya pegadas.
 * Se guardan en la base y se ven en todos los equipos (y sin internet, como lo demás). Las fijadas (con chinche) van
 * primero; lo hecho se tacha, se despega y queda en "Hechas" (se puede deshacer) hasta que se borra solo a los 7 días.
 * Las destacadas (la estrella) van antes que todas, con un brillo que da la vuelta a los bordes y late todo el tiempo.
 */

/**
 * El brillo de una destacada: un aro del color de la notica, justo por fuera del borde, con dos luces que le dan la vuelta
 * y un resplandor que late. Como el despliegue de arriba, va aunque el equipo tenga "reducir movimiento".
 */
const Brillo = () => <span className="notica-brillo" aria-hidden="true"><i /></span>;

const NOMBRE_COLOR: Record<ColorNota, string> = { amarillo: "Amarillo", rosa: "Rosa", verde: "Verde", azul: "Azul", lila: "Lila" };
/** Cada papelito un poquito torcido (siempre igual para la misma notica). */
const giro = (id: string) => ((([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 7) - 3) * 0.55).toFixed(2);
/** "hoy 9:40 a. m.", "ayer", "lun 20 oct". */
function cuando(iso: string) {
  const d = new Date(iso), dia = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const hoy = new Date();
  if (dia(d) === dia(hoy)) return `hoy ${d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" })}`;
  if (dia(d) === dia(new Date(hoy.getTime() - 10_000_000))) return "ayer";
  return d.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Bogota" });
}
/** Lo que dura cada animación de salida antes de guardar (para que se vea). */
const SALIDA_MS = 480;
/** Cuántas se ven en la barra de arriba sin abrir el panel (las demás: "+N"). */
const MAX_A_LA_VISTA = 5;
/**
 * Cada notica de arriba se despliega sola, más o menos cada minuto (entre 50 y 70 s, al azar), cada una por su lado: se
 * recoge hacia la cinta y cae con un vaivén (las fijadas se columpian desde la chinche). Nunca dos a la vez: entre una y
 * otra pasa al menos `separacion`. La primera vez, entre 3 y 20 s después de abrir. Al volver a esta pestaña tras un rato
 * en otra (WhatsApp...) se despliegan pronto, una tras otra: es cuando más sirve el aviso. Con la pestaña escondida no
 * (no se vería). Va aunque el equipo tenga "reducir movimiento": Felipe la quiere ver.
 */
const DESPLIEGUE = { primero: [3_000, 10_000], cada: [10_000, 10_000], alVolver: [1_000, 4_000], separacion: 1_300, dura: 2_600, ausencia: 10_000, revisar: 250 } as const;
const alAzar = ([a, b]: readonly [number, number]) => a + Math.random() * (b - a);
/**
 * Las de la barra cuelgan con hasta 3 renglones (bajan un poco por debajo de la barra). Si una estorba, con el clic
 * derecho se "Encoge" a un renglón (y "Desplegar" la vuelve a dejar colgada). Se recuerda en este equipo: es cosa de la
 * pantalla de cada uno, no de la notica.
 */
const CLAVE_ENCOGIDAS = "noticas-encogidas";
function leerEncogidas(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CLAVE_ENCOGIDAS) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

export function Noticas() {
  const { avisar, confirmar } = useUI();
  const notas = useLiveQuery(() => db.notas.toArray(), []) ?? [];
  const [abierto, setAbierto] = useState(false);
  /** Las que se están desplegando ahora mismo (cada una a su tiempo). */
  const [desplegando, setDesplegando] = useState<ReadonlySet<string>>(new Set());
  /** Las de la barra en este momento (el reloj de abajo las lee sin volver a arrancar). */
  const enLaBarra = useRef<string[]>([]);
  useEffect(() => {
    const proxima = new Map<string, number>(), fines = new Set<number>();
    let ultima = 0, escondida = 0;
    const desplegar = (id: string) => {
      setDesplegando((s) => new Set(s).add(id));
      const f = window.setTimeout(() => { fines.delete(f); setDesplegando((s) => { const n = new Set(s); n.delete(id); return n; }); }, DESPLIEGUE.dura);
      fines.add(f);
    };
    const reloj = window.setInterval(() => {
      if (document.hidden) return;
      const ahora = Date.now();
      for (const id of enLaBarra.current) {
        const toca = proxima.get(id);
        if (toca === undefined) proxima.set(id, ahora + alAzar(DESPLIEGUE.primero));
        else if (toca <= ahora) {
          // Si otra acaba de empezar, esta espera su turno.
          if (ahora - ultima < DESPLIEGUE.separacion) { proxima.set(id, ultima + DESPLIEGUE.separacion); continue; }
          desplegar(id);
          ultima = ahora;
          proxima.set(id, ahora + alAzar(DESPLIEGUE.cada));
        }
      }
    }, DESPLIEGUE.revisar);
    const alCambiar = () => {
      if (document.hidden) { escondida = Date.now(); return; }
      const ahora = Date.now(), largo = escondida && ahora - escondida >= DESPLIEGUE.ausencia;
      for (const [id, toca] of proxima) if (largo || toca <= ahora) proxima.set(id, ahora + alAzar(DESPLIEGUE.alVolver));
    };
    document.addEventListener("visibilitychange", alCambiar);
    return () => { clearInterval(reloj); fines.forEach(clearTimeout); document.removeEventListener("visibilitychange", alCambiar); };
  }, []);
  /** La notica nueva que se está escribiendo (en blanco hasta guardarla). */
  const [nueva, setNueva] = useState<{ texto: string; color: ColorNota; fijada: boolean; destacada: boolean } | null>(null);
  const [pegando, setPegando] = useState(false);
  /** Las que están saliendo (tachándose o volando) mientras se guarda. */
  const [saliendo, setSaliendo] = useState<Record<string, "hecha" | "borrada">>({});
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const caja = useRef<HTMLDivElement>(null);

  const pendientes = useMemo(() => notas.filter((n) => !n.hecha).sort((a, b) => Number(b.destacada) - Number(a.destacada) || Number(b.fijada) - Number(a.fijada) || b.creado.localeCompare(a.creado)), [notas]);
  const hechas = useMemo(() => notas.filter((n) => n.hecha).sort((a, b) => (b.hechaEn ?? "").localeCompare(a.hechaEn ?? "")), [notas]);

  // Se cierra al tocar fuera (salvo en una ventana de confirmación) o con Esc (que primero cancela la nueva).
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!caja.current?.contains(t) && !t.closest(".modal, .velo, [role=alertdialog]")) setAbierto(false); };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || editando || document.querySelector(".modal")) return;
      if (nueva) setNueva(null); else setAbierto(false);
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto, editando, nueva]);
  // Sin ninguna pendiente, al abrir ya sale la nueva para escribir.
  const abrir = () => { if (!abierto && !pendientes.length) empezar(); setAbierto(!abierto); };
  function empezar() { setNueva((x) => x ?? { texto: "", color: "amarillo", fijada: false, destacada: false }); setTimeout(() => campo.current?.focus(), 60); }

  async function guardarNueva() {
    const t = nueva?.texto.trim();
    if (!nueva || !t || pegando) return;
    const lo = nueva;
    setPegando(true);
    try { await escribir("POST", "/api/notas", { texto: t, color: lo.color, fijada: lo.fijada, destacada: lo.destacada }); setNueva(null); }
    catch (e) { avisar(mensajeDe(e), "error"); campo.current?.focus(); }
    finally { setPegando(false); }
  }
  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void guardarNueva(); } };

  /** Primero la animación (se tacha y se despega, o sale volando); luego se guarda. Si falla, vuelve a su sitio. */
  async function salir(n: Nota, como: "hecha" | "borrada") {
    setSaliendo((x) => ({ ...x, [n.id]: como }));
    await new Promise((ok) => setTimeout(ok, SALIDA_MS));
    try {
      if (como === "hecha") await escribir("PATCH", `/api/notas/${n.id}`, { hecha: true });
      else await escribir("DELETE", `/api/notas/${n.id}`);
    } catch (e) { avisar(mensajeDe(e), "error"); }
    finally { setSaliendo((x) => { const y = { ...x }; delete y[n.id]; return y; }); }
  }
  async function borrar(n: Nota) {
    if (!n.hecha && !(await confirmar({ titulo: "¿Quitar esta notica?", texto: n.texto.length > 90 ? `${n.texto.slice(0, 90)}…` : n.texto, boton: "Quitar", peligro: true }))) return;
    await salir(n, "borrada");
  }
  async function cambiar(n: Nota, c: Partial<Pick<Nota, "texto" | "color" | "fijada" | "destacada" | "hecha">>) {
    try { await escribir("PATCH", `/api/notas/${n.id}`, c); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function guardarEdicion() {
    if (!editando) return;
    const n = notas.find((x) => x.id === editando.id), t = editando.texto.trim();
    setEditando(null);
    if (n && t && t !== n.texto) await cambiar(n, { texto: t });
  }

  const n = pendientes.length;
  // A la vista en la barra de arriba (en todas las pantallas): las primeras pendientes, las fijadas primero.
  const aLaVista = pendientes.slice(0, MAX_A_LA_VISTA);
  enLaBarra.current = aLaVista.map((x) => x.id);

  const [encogidas, setEncogidas] = useState<string[]>(leerEncogidas);
  /** Guarda solo las que siguen pendientes (las hechas o borradas se olvidan solas). */
  function encoger(ids: string[], si: boolean) {
    const vivas = new Set(pendientes.map((x) => x.id));
    const nuevo = [...new Set(si ? [...encogidas, ...ids] : encogidas.filter((id) => !ids.includes(id)))].filter((id) => vivas.has(id));
    setEncogidas(nuevo);
    try { localStorage.setItem(CLAVE_ENCOGIDAS, JSON.stringify(nuevo)); } catch { /* sin almacenamiento: dura hasta recargar */ }
  }
  function menuDe(x: Nota): ItemMenu[] {
    const encogida = encogidas.includes(x.id);
    const otras = aLaVista.filter((y) => y.id !== x.id && encogidas.includes(y.id) === encogida);
    return [
      encogida
        ? { texto: "Desplegar", icono: ChevronsUpDown, accion: () => encoger([x.id], false) }
        : { texto: "Encoger", icono: ChevronsDownUp, accion: () => encoger([x.id], true) },
      ...(otras.length ? [encogida
        ? { texto: "Desplegar todas", icono: ChevronsUpDown, accion: () => encoger(aLaVista.map((y) => y.id), false) }
        : { texto: "Encoger todas", icono: ChevronsDownUp, accion: () => encoger(aLaVista.map((y) => y.id), true) }] : []),
      "-",
      x.destacada
        ? { texto: "Quitar destacado", icono: StarOff, accion: () => void cambiar(x, { destacada: false }) }
        : { texto: "Destacar", icono: Star, accion: () => void cambiar(x, { destacada: true }) },
      { texto: "Ya la hice", icono: Check, accion: () => void salir(x, "hecha") },
      { texto: "Ver todas las noticas", icono: StickyNote, accion: () => setAbierto(true) },
    ];
  }
  return (
    <div className="noticas" ref={caja}>
      {aLaVista.length > 0 && (
        <div className="tira-noticas" aria-label="Noticas pendientes">
          {aLaVista.map((x) => (
            <div key={x.id} className={`mini-notica c-${x.color}${x.fijada ? " fijada" : ""}${x.destacada ? " brillante" : ""}${encogidas.includes(x.id) ? " encogida" : ""}${saliendo[x.id] === "hecha" ? " tachando" : ""}${desplegando.has(x.id) && !saliendo[x.id] ? " desplegando" : ""}`}
              style={{ "--giro": `${giro(x.id)}deg` } as CSSProperties} onContextMenu={(e) => abrirMenu(e, menuDe(x))}>
              {x.destacada && <Brillo />}
              <button type="button" className="mini-notica-texto" onClick={() => setAbierto(true)}><span>{x.texto}</span></button>
              {/* Al pasar el mouse, la notica completa (sin abrir el panel ni ocupar más espacio en la barra). */}
              <div className="notica-completa" role="tooltip">{x.texto}</div>
              <button type="button" className="mini-notica-check" aria-label={`Ya la hice: ${x.texto}`} title="Ya la hice" disabled={!!saliendo[x.id]} onClick={() => void salir(x, "hecha")}><Check size={11} /></button>
            </div>
          ))}
          {n > aLaVista.length && <button type="button" className="mini-notica-mas" onClick={() => setAbierto(true)} title="Ver todas las noticas">+{n - aLaVista.length}</button>}
        </div>
      )}
      <button type="button" className={`top-btn noticas-btn${abierto ? " on" : ""}`} onClick={abrir} aria-expanded={abierto} aria-label={`Noticas${n ? ` (${n} pendientes)` : ""}`}
        title="Noticas: tareas del día y cosas importantes">
        <StickyNote size={18} />
        {n > 0 && <i key={n} className="noticas-cuenta">{n > 99 ? "99+" : n}</i>}
      </button>
      {abierto && (
        <div className="noticas-panel" role="dialog" aria-label="Noticas">
          <div className="noticas-cab">
            <b>Noticas</b>
            <span className="peq tenue">{n ? `${n} pendiente${n === 1 ? "" : "s"}` : "Todo al día"}</span>
            <button type="button" className="noticas-nueva" onClick={empezar} disabled={!!nueva}><Plus size={14} />Nueva notica</button>
            <button type="button" className="btn btn-sm btn-fantasma btn-icono" aria-label="Cerrar noticas" title="Cerrar (Esc)" onClick={() => setAbierto(false)}><X size={15} /></button>
          </div>

          {nueva && (
            <div className={`notica nueva c-${nueva.color}${nueva.fijada ? " fijada" : ""}${nueva.destacada ? " brillante" : ""}`}>
              {nueva.destacada && <Brillo />}
              <textarea ref={campo} className="notica-campo" rows={3} value={nueva.texto} maxLength={1000} onKeyDown={alTeclear}
                onChange={(e) => setNueva({ ...nueva, texto: e.target.value })} placeholder="Escriba aquí la tarea o lo que no se puede olvidar…" aria-label="Nueva notica" />
              <div className="notica-opciones">
                <div className="noticas-colores" role="radiogroup" aria-label="Color">
                  {COLORES_NOTA.map((c) => <button key={c} type="button" role="radio" aria-checked={nueva.color === c} aria-label={NOMBRE_COLOR[c]} title={NOMBRE_COLOR[c]} className={`noticas-color c-${c}${nueva.color === c ? " on" : ""}`} onClick={() => setNueva({ ...nueva, color: c })} />)}
                </div>
                <button type="button" className={`notica-btn${nueva.fijada ? " on" : ""}`} aria-pressed={nueva.fijada} aria-label="Fijar arriba" title="Fijar arriba: lo importante va primero, con chinche" onClick={() => setNueva({ ...nueva, fijada: !nueva.fijada })}><Pin size={14} /></button>
                <button type="button" className={`notica-btn notica-estrella${nueva.destacada ? " on" : ""}`} aria-pressed={nueva.destacada} aria-label="Destacar" title="Destacar: va de primera, con un brillo alrededor" onClick={() => setNueva({ ...nueva, destacada: !nueva.destacada })}><Star size={14} /></button>
              </div>
              <div className="notica-guardar">
                <button type="button" className="notica-btn" aria-label="Cancelar" title="Cancelar (Esc)" onClick={() => setNueva(null)}><X size={15} /></button>
                <button type="button" className="notica-ok" disabled={!nueva.texto.trim() || pegando} onClick={() => void guardarNueva()} title="Guardar (Enter)">
                  {pegando ? <Loader2 size={14} className="girando" /> : <Check size={14} />}Guardar
                </button>
              </div>
            </div>
          )}

          <div className="noticas-lista">
          {!pendientes.length && !nueva && <div className="noticas-vacio">Sin noticas pendientes. Toque <b>Nueva notica</b> para anotar algo.</div>}
          {pendientes.map((x, i) => (
            <div key={x.id} className={`notica c-${x.color}${x.fijada ? " fijada" : ""}${x.destacada ? " brillante" : ""}${saliendo[x.id] === "hecha" ? " tachando" : saliendo[x.id] === "borrada" ? " volando" : ""}`}
              style={{ "--giro": `${giro(x.id)}deg`, "--i": i } as CSSProperties}>
              {x.destacada && <Brillo />}
              <button type="button" className="notica-check" aria-label="Marcar como hecha" title="Ya la hice" disabled={!!saliendo[x.id]} onClick={() => void salir(x, "hecha")}><Check size={13} /></button>
              {editando?.id === x.id ? (
                <textarea className="notica-campo" autoFocus rows={3} value={editando.texto} maxLength={1000} aria-label="Editar notica"
                  onChange={(e) => setEditando({ id: x.id, texto: e.target.value })} onBlur={() => void guardarEdicion()}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void guardarEdicion(); } if (e.key === "Escape") { e.stopPropagation(); setEditando(null); } }} />
              ) : (
                <p className="notica-texto" onClick={() => setEditando({ id: x.id, texto: x.texto })} title="Toque para editar">{x.texto}</p>
              )}
              <div className="notica-pie">
                <small>{cuando(x.creado)}</small>
                <div className="notica-acc">
                  {COLORES_NOTA.filter((c) => c !== x.color).map((c) => <button key={c} type="button" className={`noticas-color mini c-${c}`} aria-label={`Color ${NOMBRE_COLOR[c].toLowerCase()}`} title={NOMBRE_COLOR[c]} onClick={() => void cambiar(x, { color: c })} />)}
                  <button type="button" className={`notica-btn notica-estrella${x.destacada ? " on" : ""}`} aria-pressed={x.destacada} aria-label={x.destacada ? "Quitar destacado" : "Destacar"} title={x.destacada ? "Quitar destacado" : "Destacar: va de primera, con un brillo alrededor"} onClick={() => void cambiar(x, { destacada: !x.destacada })}><Star size={13} /></button>
                  <button type="button" className={`notica-btn${x.fijada ? " on" : ""}`} aria-label={x.fijada ? "Desfijar" : "Fijar arriba"} title={x.fijada ? "Desfijar" : "Fijar arriba"} onClick={() => void cambiar(x, { fijada: !x.fijada })}><Pin size={13} /></button>
                  <button type="button" className="notica-btn" aria-label="Quitar notica" title="Quitar" onClick={() => void borrar(x)}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}

          </div>

          {hechas.length > 0 && (
            <details className="noticas-hechas">
              <summary>Hechas <small>{hechas.length}</small><ChevronDown size={13} /></summary>
              <div className="pila" style={{ gap: 4, marginTop: 6 }}>
                {hechas.map((x) => (
                  <div key={x.id} className={`notica-hecha c-${x.color}${saliendo[x.id] === "borrada" ? " volando" : ""}`}>
                    <span className="notica-hecha-texto">{x.texto}</span>
                    <small>{x.hechaEn ? cuando(x.hechaEn) : ""}</small>
                    <button type="button" className="notica-btn" aria-label="Deshacer: volver a pendientes" title="Deshacer" onClick={() => void cambiar(x, { hecha: false })}><Undo2 size={13} /></button>
                    <button type="button" className="notica-btn" aria-label="Borrar ya" title="Borrar ya (si no, se borra sola a los 7 días)" onClick={() => void borrar(x)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              <small className="tenue">Se borran solas a los 7 días de hechas.</small>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
