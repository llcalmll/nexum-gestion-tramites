import { NotebookPen, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * La nota destacada de un trámite, de un vistazo (tabla y tablero de Trámites junto al número y el chicharrón; en el
 * mapa, al lado de la placa): un simbolito de nota que, al pasar el mouse (o con el teclado), crece y abre la nota
 * completa al lado, con el mismo estilo de la del expediente. Sin nota destacada no sale nada. `chica`: del tamaño del
 * texto del número.
 */

export interface NotaCorta { descripcion: string | null; fecha: string }

/** La nota abierta, al lado de su simbolito (a la izquierda si a la derecha no cabe), con zoom. */
export function GloboNota({ nota, ancla }: { nota: NotaCorta; ancla: DOMRect }) {
  const globo = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; izq: boolean } | null>(null);
  useLayoutEffect(() => {
    const ancho = globo.current?.offsetWidth ?? 320, alto = globo.current?.offsetHeight ?? 120;
    const izq = ancla.right + 12 + ancho > innerWidth - 8;
    setPos({ x: izq ? ancla.left - 12 - ancho : ancla.right + 12, y: Math.max(8, Math.min(innerHeight - alto - 8, ancla.top + ancla.height / 2 - alto / 2)), izq });
  }, [ancla]);
  return createPortal(
    <div ref={globo} className={`nota-vistazo-globo${pos?.izq ? " izq" : ""}`} role="tooltip"
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999, visibility: "hidden" }}>
      <div className="nota-destacada-cab"><Star size={13} fill="currentColor" /><b>Nota destacada</b>
        <small>{new Date(nota.fecha).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</small></div>
      <p>{nota.descripcion}</p>
    </div>,
    document.body,
  );
}

export function NotaVistazo({ b, chica }: { b: NotaCorta | null | undefined; chica?: boolean }) {
  const boton = useRef<HTMLSpanElement>(null);
  const [ancla, setAncla] = useState<DOMRect | null>(null);
  if (!b?.descripcion) return null;
  const abrir = () => { if (boton.current) setAncla(boton.current.getBoundingClientRect()); };
  return (
    <>
      <span ref={boton} className={`nota-vistazo${chica ? " chica" : ""}${ancla ? " on" : ""}`} tabIndex={0} role="img" aria-label={`Nota destacada: ${b.descripcion}`}
        onMouseEnter={abrir} onMouseLeave={() => setAncla(null)} onFocus={abrir} onBlur={() => setAncla(null)}>
        <NotebookPen size={chica ? 12 : 15} />
      </span>
      {ancla && <GloboNota nota={b} ancla={ancla} />}
    </>
  );
}

/** El mismo simbolito como HTML (para lo que el mapa pinta sobre el 3D): `data-nota` lleva el id del trámite. */
export const notaHtml = (id: string) => `<span class="nota-vistazo chica" data-nota="${id.replace(/[^A-Za-z0-9_-]/g, "")}" role="img" aria-label="Nota destacada">`
  + `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><path d="M10.000 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg></span>`;
