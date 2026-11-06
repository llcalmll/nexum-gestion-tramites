import { useRef, useState } from "react";
import type { Esquinas, Filtro } from "./procesar";

/** Una foto en ajuste: las 4 esquinas de la hoja (o de la cédula), el filtro y los giros. */
export interface Editando { foto: HTMLCanvasElement; vista: string; esquinas: Esquinas; encontrada: boolean; filtro: Filtro; giros: number }
export const FILTROS: [Filtro, string][] = [["documento", "Documento"], ["color", "Color"], ["bn", "B/N"], ["original", "Original"]];

/** La foto con las 4 esquinas para arrastrar (con el dedo en el celular, con el mouse en el PC). */
export function AjusteEsquinas({ e, cambiar }: { e: Editando; cambiar: (q: Esquinas) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const W = e.foto.width, H = e.foto.height;
  const r = Math.max(W, H) * 0.035;
  const punto = (ev: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return { x: Math.min(W, Math.max(0, ((ev.clientX - b.left) / b.width) * W)), y: Math.min(H, Math.max(0, ((ev.clientY - b.top) / b.height) * H)) };
  };
  return (
    <div className="escaneo-ajuste">
      <img src={e.vista} alt="Foto del documento" draggable={false} />
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        onPointerMove={(ev) => { if (arrastrando === null) return; const q = [...e.esquinas] as Esquinas; q[arrastrando] = punto(ev); cambiar(q); }}
        onPointerUp={() => setArrastrando(null)} onPointerCancel={() => setArrastrando(null)}>
        <polygon points={e.esquinas.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(37,99,235,.15)" stroke="#2563eb" strokeWidth={Math.max(W, H) * 0.005} />
        {e.esquinas.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={r} className="escaneo-esquina" aria-label={`Esquina ${i + 1}`}
            onPointerDown={(ev) => { (ev.target as Element).setPointerCapture?.(ev.pointerId); setArrastrando(i); }} />
        ))}
      </svg>
    </div>
  );
}
