import { AlertCircle, CheckCircle2, Inbox, Upload, X, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

/* ---------------- Etiquetas */

/** "vino": cancelado, no se pudo (rojo muy oscuro, casi negro). */
export type Tono = "verde" | "ambar" | "rojo" | "azul" | "morado" | "rosa" | "cian" | "gris" | "vino";

export function Badge({ tono = "gris", punto, children, title }: { tono?: Tono; punto?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tono}`} title={title}>
      {punto && <span className="punto" />}
      {children}
    </span>
  );
}

const AVATARES: [string, string][] = [
  ["var(--azul-s)", "var(--azul)"], ["var(--morado-s)", "var(--morado)"], ["var(--verde-s)", "var(--verde)"], ["var(--ambar-s)", "var(--ambar)"],
  ["var(--rosa-s)", "var(--rosa)"], ["var(--cian-s)", "var(--cian)"], ["var(--rojo-s)", "var(--rojo)"],
];
/** Iniciales de un nombre ("Juan Pérez" -> "AP"). */
export function inicialesPersona(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return p.length ? p.slice(0, 2).map((x) => x[0].toUpperCase()).join("") : "?";
}

/** Avatar con color estable por nombre. */
export function Avatar({ nombre, grande }: { nombre: string; grande?: boolean }) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATARES[h % AVATARES.length];
  return <span className={`avatar ${grande ? "lg" : ""}`} style={{ background: bg, color: fg }}>{inicialesPersona(nombre)}</span>;
}

/* ---------------- Bloques */

export function Cabecera({ migas, titulo, sub, children, lado }: { migas?: { t: string; a?: string }[]; titulo: ReactNode; sub?: ReactNode; children?: ReactNode; lado?: ReactNode }) {
  if (lado) return (
    <header className="cabecera con-lado">
      <div className="cabecera-principal"><CabeceraTitulo migas={migas} titulo={titulo} sub={sub} /><div className="fila-wrap">{children}</div></div>
      {lado}
    </header>
  );
  return (
    <header className="cabecera">
      <CabeceraTitulo migas={migas} titulo={titulo} sub={sub} />
      <div className="espacio" />
      <div className="fila-wrap">{children}</div>
    </header>
  );
}

function CabeceraTitulo({ migas, titulo, sub }: { migas?: { t: string; a?: string }[]; titulo: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      {migas && (
        <div className="migas">
          {migas.map((m, i) => (
            <span key={i} className="fila" style={{ gap: 6 }}>
              {m.a ? <Link to={m.a}>{m.t}</Link> : m.t}
              {i < migas.length - 1 && <span>/</span>}
            </span>
          ))}
        </div>
      )}
      <h1>{titulo}</h1>
      {sub && <div className="muted peq" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function Kpi(props: { icono: LucideIcon; valor: ReactNode; etiqueta: ReactNode; tono?: string; a?: string; onClick?: () => void; on?: boolean }) {
  const I = props.icono;
  const cls = `kpi tono-${props.tono ?? "gris"} ${props.on ? "on" : ""}`;
  const cuerpo = (
    <>
      <span className="ico"><I size={18} /></span>
      <span>
        <div className="valor">{props.valor}</div>
        <div className="etiqueta">{props.etiqueta}</div>
      </span>
    </>
  );
  if (props.a) return <Link className={cls} to={props.a}>{cuerpo}</Link>;
  if (props.onClick) return <button className={cls} onClick={props.onClick}>{cuerpo}</button>;
  return <div className={cls}>{cuerpo}</div>;
}

export function Vacio({ icono: I = Inbox, titulo, children }: { icono?: LucideIcon; titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <span className="ico"><I size={22} /></span>
      <b style={{ color: "var(--texto)" }}>{titulo}</b>
      {children}
    </div>
  );
}

export function ZonaArchivo(props: { onArchivos: (f: File[]) => void; acepta: string; multiple?: boolean; titulo: string; ayuda?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  return (
    <div
      className={"zona" + (encima ? " encima" : "")}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); props.onArchivos([...e.dataTransfer.files]); }}
    >
      <input ref={ref} type="file" accept={props.acepta} multiple={props.multiple} onChange={(e) => { props.onArchivos([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <Upload size={20} />
      <b>{props.titulo}</b>
      {props.ayuda && <span className="peq tenue">{props.ayuda}</span>}
    </div>
  );
}

/* ---------------- Menú desplegable */

export function Menu({ boton, children, derecha, ancho }: { boton: (abrir: () => void, abierto: boolean) => ReactNode; children: (cerrar: () => void) => ReactNode; derecha?: boolean; ancho?: number }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);
  return (
    <div className="menu-ancla" ref={ref}>
      {boton(() => setAbierto((v) => !v), abierto)}
      {abierto && <div className={`menu ${derecha ? "derecha" : ""}`} style={ancho ? { minWidth: ancho } : undefined}>{children(() => setAbierto(false))}</div>}
    </div>
  );
}

/* ---------------- Panel lateral */

/** Panel lateral. `ancho`: en píxeles, para los que llevan una tabla (por defecto 520). */
export function Panel({ abierto, onCerrar, cabecera, children, pie, ancho }: { abierto: boolean; onCerrar: () => void; cabecera: ReactNode; children: ReactNode; pie?: ReactNode; ancho?: number }) {
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return createPortal(
    <>
      <div className="velo" onClick={onCerrar} />
      <aside className="panel" role="dialog" style={ancho ? { width: `min(${ancho}px, 100vw)` } : undefined}>
        <div className="panel-cab">
          <div style={{ flex: 1, minWidth: 0 }}>{cabecera}</div>
          <button className="btn btn-fantasma btn-icono btn-sm" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="panel-cuerpo">{children}</div>
        {pie && <div className="panel-pie">{pie}</div>}
      </aside>
    </>,
    document.body,
  );
}

/* ---------------- Confirmaciones y notificaciones */

interface Confirmacion { titulo: string; texto?: ReactNode; boton?: string; peligro?: boolean }
export interface UI {
  confirmar: (c: Confirmacion) => Promise<boolean>;
  /** Aviso flotante. Los de error duran más y se ven en rojo. */
  avisar: (texto: string, tipo?: "ok" | "error") => void;
}
const Ctx = createContext<UI>({ confirmar: async () => true, avisar: () => {} });
export const useUI = () => useContext(Ctx);

export function ProveedorUI({ children }: { children: ReactNode }) {
  const [conf, setConf] = useState<(Confirmacion & { ok: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<{ id: number; texto: string; tipo: "ok" | "error" }[]>([]);
  const confirmar = useCallback((c: Confirmacion) => new Promise<boolean>((ok) => setConf({ ...c, ok })), []);
  const avisar = useCallback((texto: string, tipo: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === "error" ? 7000 : 3200);
  }, []);
  const cerrar = (v: boolean) => { conf?.ok(v); setConf(null); };
  return (
    <Ctx.Provider value={{ confirmar, avisar }}>
      {children}
      {conf && createPortal(
        <>
          <div className="velo" onClick={() => cerrar(false)} />
          <div className="modal" role="alertdialog">
            <div className="modal-cuerpo">
              <h2 style={{ marginBottom: 6 }}>{conf.titulo}</h2>
              {conf.texto && <div className="muted">{conf.texto}</div>}
            </div>
            <div className="modal-pie">
              <button className="btn" onClick={() => cerrar(false)}>Cancelar</button>
              <button className={`btn ${conf.peligro ? "btn-peligro" : "btn-primario"}`} autoFocus onClick={() => cerrar(true)}>{conf.boton ?? "Confirmar"}</button>
            </div>
          </div>
        </>,
        document.body,
      )}
      {createPortal(
        <div className="toasts">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.tipo}`} role={t.tipo === "error" ? "alert" : "status"}>{t.tipo === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{t.texto}</div>)}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}
