import { ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

/*
 * Pegar imágenes copiadas (de WhatsApp, del navegador...) sin descargarlas: Ctrl+V o el botón "Pegar imagen".
 * Cada zona que recibe fotos se registra; Ctrl+V va a la zona donde se hizo clic o está el mouse (si hay varias en la
 * pantalla, como las tres fotos de Formatos); si no, a la primera que se vea. Pegar texto en un campo no se toca.
 */

interface Destino { id: number; el: HTMLElement; recibir: (f: File[]) => void }
let destinos: Destino[] = [];
let ultimo = 0;
let siguiente = 1;
let instalado = false;

const visible = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;
const imagenes = (lista: FileList | File[] | undefined) => [...(lista ?? [])].filter((f) => f.type.startsWith("image/"));

function instalar() {
  if (instalado) return;
  instalado = true;
  const marcar = (e: Event) => { const d = destinos.find((x) => x.el.contains(e.target as Node)); if (d) ultimo = d.id; };
  document.addEventListener("pointerdown", marcar, true);
  document.addEventListener("pointerover", marcar, true);
  document.addEventListener("focusin", marcar, true);
  document.addEventListener("paste", (e) => {
    if (e.defaultPrevented) return;
    const fotos = imagenes(e.clipboardData?.files);
    if (!fotos.length) return;
    // En un campo de texto con texto copiado, el pegado normal manda.
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("input, textarea, [contenteditable='true']") && e.clipboardData?.types.includes("text/plain")) return;
    const vistos = destinos.filter((d) => visible(d.el)).sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const d = vistos.find((x) => x.id === ultimo) ?? vistos[0];
    if (!d) return;
    e.preventDefault();
    d.recibir(fotos);
  });
}

/** Registra una zona para recibir las imágenes pegadas con Ctrl+V. */
export function usePegarImagenes(ref: RefObject<HTMLElement | null>, recibir: (f: File[]) => void, activo = true) {
  const r = useRef(recibir);
  r.current = recibir;
  const registro = useRef<Destino | null>(null);
  const quitar = () => { const d = registro.current; if (!d) return; destinos = destinos.filter((x) => x !== d); if (ultimo === d.id) ultimo = 0; registro.current = null; };
  // La zona puede aparecer o cambiar de elemento entre un render y otro (pasos, edición): se revisa en cada render.
  useEffect(() => {
    const el = activo ? ref.current : null;
    if (registro.current?.el === el) return;
    quitar();
    if (!el) return;
    instalar();
    registro.current = { id: siguiente++, el, recibir: (f) => r.current(f) };
    destinos.push(registro.current);
  });
  useEffect(() => quitar, []);
}

/** Lee las imágenes copiadas (botón "Pegar imagen"). La primera vez el navegador pide permiso. */
export async function imagenesCopiadas(): Promise<File[]> {
  if (!navigator.clipboard?.read) throw new Error("Este navegador no deja leer imágenes copiadas: use Ctrl+V.");
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); } catch { throw new Error("El navegador no dio permiso para leer lo copiado: use Ctrl+V o permítalo en el candado de la barra de direcciones."); }
  const fotos: File[] = [];
  for (const it of items) {
    const tipo = it.types.find((x) => x.startsWith("image/"));
    if (tipo) fotos.push(new File([await it.getType(tipo)], `pegada-${Date.now()}-${fotos.length + 1}.${tipo.split("/")[1]}`, { type: tipo }));
  }
  if (!fotos.length) throw new Error("No hay ninguna imagen copiada. En WhatsApp: clic derecho en la foto → Copiar imagen.");
  return fotos;
}

/** Botón "Pegar imagen": lo copiado (de WhatsApp...) entra sin descargarlo. */
export function BotonPegar({ recibir, texto = "Pegar imagen", className = "btn btn-sm", alError, soloIcono, disabled }: { recibir: (f: File[]) => void; texto?: string; className?: string; alError?: (m: string) => void; soloIcono?: boolean; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={className} title="Pegar una imagen copiada, de WhatsApp por ejemplo (también con Ctrl+V)" aria-label="Pegar imagen" disabled={disabled}
        onClick={async (e) => { e.stopPropagation(); setError(null); try { recibir(await imagenesCopiadas()); } catch (err) { const m = err instanceof Error ? err.message : String(err); if (alError) alError(m); else setError(m); } }}>
        <ClipboardPaste size={soloIcono ? 16 : 13} />{soloIcono ? null : texto}
      </button>
      {error && <span className="peq cot-aviso" onClick={(e) => e.stopPropagation()}>{error}</span>}
    </>
  );
}

/** ¿Este navegador puede compartir archivos (al WhatsApp del celular o del PC)? */
export const puedeCompartirArchivos = () => typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });
