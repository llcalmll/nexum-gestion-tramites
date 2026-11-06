import { ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * El menú del clic derecho: el mismo en todas las vistas (tablas, tablero, mapa). Cada vista dice qué opciones tiene
 * su fila o su tarjeta; lo que cambia algo pide confirmación en su propia acción. "-" es una raya separadora; `hijos`,
 * un submenú (Cambiar estado ▸ ...).
 */
export type ItemMenu = "-" | { texto: string; icono?: LucideIcon; accion?: () => void; peligro?: boolean; deshabilitado?: boolean; hijos?: ItemMenu[] };

let abrirGlobal: ((x: number, y: number, items: ItemMenu[]) => void) | null = null;

/** Abre el menú donde está el puntero (para `onContextMenu`). Sin opciones, deja el menú normal del navegador. */
export function abrirMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: ItemMenu[]) {
  const reales = items.filter((x) => x !== "-");
  if (!reales.length || !abrirGlobal) return;
  e.preventDefault();
  e.stopPropagation?.();
  abrirGlobal(e.clientX, e.clientY, items);
}

/** Va una sola vez en la app (en el marco). */
export function MenuContextualRaiz() {
  const [m, setM] = useState<{ x: number; y: number; items: ItemMenu[] } | null>(null);
  const [hijo, setHijo] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    abrirGlobal = (x, y, items) => { setHijo(null); setPos(null); setM({ x, y, items }); };
    return () => { abrirGlobal = null; };
  }, []);
  useEffect(() => {
    if (!m) return;
    const cerrar = () => setM(null);
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) cerrar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("mousedown", fuera, true);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", cerrar);
    window.addEventListener("blur", cerrar);
    document.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("mousedown", fuera, true); document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", cerrar); window.removeEventListener("blur", cerrar); document.removeEventListener("scroll", cerrar, true);
    };
  }, [m]);
  // Que no se salga de la pantalla: si no cabe a la derecha o abajo, se abre hacia el otro lado.
  useLayoutEffect(() => {
    if (!m || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: m.x + r.width > innerWidth - 8 ? Math.max(8, m.x - r.width) : m.x, y: m.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : m.y });
  }, [m]);
  if (!m) return null;
  const elegir = (it: Exclude<ItemMenu, "-">) => { if (it.deshabilitado || it.hijos) return; setM(null); it.accion?.(); };
  const lista = (items: ItemMenu[], nivel: number) => items.map((it, i) => it === "-"
    ? <hr key={`s${i}`} />
    : (
      <div key={it.texto} className="menu-ctx-fila" onMouseEnter={() => nivel === 0 && setHijo(it.hijos ? i : null)}>
        <button type="button" role="menuitem" className={`menu-item${it.peligro ? " peligro" : ""}`} disabled={it.deshabilitado} onClick={() => (it.hijos ? setHijo(i) : elegir(it))}>
          {it.icono ? <it.icono size={15} /> : <span className="menu-ctx-sin" />}{it.texto}{it.hijos && <ChevronRight size={14} className="der" />}
        </button>
        {it.hijos && hijo === i && nivel === 0 && <div className="menu menu-ctx menu-ctx-hijo" role="menu">{lista(it.hijos, 1)}</div>}
      </div>
    ));
  return createPortal(
    <div ref={ref} className="menu menu-ctx" role="menu" style={{ left: (pos ?? m).x, top: (pos ?? m).y, visibility: pos ? "visible" : "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      {lista(m.items, 0)}
    </div>,
    document.body,
  );
}
