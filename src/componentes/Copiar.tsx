import { Copy } from "lucide-react";
import { useUI } from "./ui";

/** Copia un texto al portapapeles (con un respaldo para navegadores que no dejan usar la API). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** El botoncito de copiar al lado de un dato (cédula, placa, teléfono...). No abre lo que tenga alrededor. */
export function Copiar({ valor, que }: { valor: string | null | undefined; que?: string }) {
  const { avisar } = useUI();
  const v = (valor ?? "").trim();
  if (!v) return null;
  return (
    <button
      type="button"
      className="btn-copiar"
      title={`Copiar ${que ?? v}`}
      aria-label={`Copiar ${que ?? v}`}
      onClick={async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (await copiarTexto(v)) avisar(`Copiado: ${v.length > 40 ? `${v.slice(0, 40)}…` : v}`);
        else avisar("No se pudo copiar", "error");
      }}
    >
      <Copy size={12} />
    </button>
  );
}
