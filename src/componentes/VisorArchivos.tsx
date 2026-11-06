import { ChevronLeft, ChevronRight, Download, ExternalLink, FileWarning, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/*
 * La vista previa de los archivos de un trámite (Expediente > Archivos), sin salir del trámite: la foto o el PDF en
 * grande, y con las flechas (o ← y →) el anterior y el siguiente. Esc o la X cierran. Lo que no es foto ni PDF (Word,
 * Excel) no se ve aquí: se descarga.
 */
export interface ArchivoVisor { id: string; titulo: string; nombre: string | null; tipo: string | null }

const ruta = (a: ArchivoVisor) => `/api/documentos/${a.id}/archivo`;
const esPdf = (a: ArchivoVisor) => a.tipo === "application/pdf" || /\.pdf$/i.test(a.nombre ?? "");
const esImagen = (a: ArchivoVisor) => (a.tipo ?? "").startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(a.nombre ?? "");

export function VisorArchivos({ archivos, inicial, cerrar }: { archivos: ArchivoVisor[]; inicial: number; cerrar: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(0, inicial), archivos.length - 1));
  const a = archivos[i];
  const n = archivos.length;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
      else if (e.key === "ArrowLeft" && n > 1) setI((x) => (x - 1 + n) % n);
      else if (e.key === "ArrowRight" && n > 1) setI((x) => (x + 1) % n);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [n, cerrar]);
  if (!a) return null;
  return createPortal(
    <div className="visor" role="dialog" aria-modal="true" aria-label={`Vista previa: ${a.titulo}`}>
      <div className="visor-cab">
        <div className="visor-titulo">
          <b>{a.titulo}</b>
          <small>{a.nombre}{n > 1 ? ` · ${i + 1} de ${n}` : ""}</small>
        </div>
        <a className="btn btn-sm" href={ruta(a)} target="_blank" rel="noreferrer" title="Abrirlo en otra pestaña"><ExternalLink size={14} />Abrir</a>
        <a className="btn btn-sm" href={`${ruta(a)}?descargar`}><Download size={14} />Descargar</a>
        <button className="btn btn-sm btn-icono" aria-label="Cerrar la vista previa" title="Cerrar (Esc)" onClick={cerrar}><X size={16} /></button>
      </div>
      <div className="visor-cuerpo" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
        {esImagen(a) ? <img key={a.id} src={ruta(a)} alt={a.titulo} />
          : esPdf(a) ? <iframe key={a.id} src={`${ruta(a)}#view=FitH`} title={a.titulo} />
          : <div className="visor-sin"><FileWarning size={28} /><span>Este archivo no tiene vista previa en la app.</span><a className="btn btn-sm btn-primario" href={`${ruta(a)}?descargar`}><Download size={14} />Descargarlo</a></div>}
        {n > 1 && <>
          <button className="visor-flecha izq" aria-label="Archivo anterior" title="Anterior (←)" onClick={() => setI((i - 1 + n) % n)}><ChevronLeft size={26} /></button>
          <button className="visor-flecha der" aria-label="Archivo siguiente" title="Siguiente (→)" onClick={() => setI((i + 1) % n)}><ChevronRight size={26} /></button>
        </>}
      </div>
    </div>,
    document.body,
  );
}
