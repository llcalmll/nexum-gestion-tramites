import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { puedeCompartirArchivos } from "../componentes/Pegar";
import { juntarCaras } from "./procesar";

/** La imagen de las caras juntas (frente arriba, respaldo abajo) en PNG, el único formato que acepta el portapapeles. */
async function pngDeCaras(caras: string[]): Promise<Blob> {
  const url = await juntarCaras(caras);
  const i = new Image(); i.src = url; await i.decode();
  const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
  c.getContext("2d")!.drawImage(i, 0, 0);
  return new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la imagen."))), "image/png"));
}

/**
 * Copiar (y en el celular, compartir) la cédula o la tarjeta escaneada como una sola imagen, frente y respaldo, para
 * pegarla en el chat del cliente.
 */
export function CopiarCaras({ caras, nombre, grande }: { caras: string[]; nombre: string; grande?: boolean }) {
  const [estado, setEstado] = useState<"" | "copiando" | "copiada" | "compartiendo">("");
  const [error, setError] = useState("");
  const compartir = puedeCompartirArchivos();
  const estilo = grande ? { flex: 1, height: 46, justifyContent: "center" } : undefined;
  const clase = grande ? "btn" : "btn btn-sm";

  const copiar = () => {
    setError("");
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      setError(compartir ? "Este navegador no deja copiar imágenes: use Compartir imagen." : "Este navegador no deja copiar imágenes.");
      return;
    }
    setEstado("copiando");
    // El portapapeles se pide aquí mismo, en el toque (Safari no lo deja después de esperar): la imagen llega luego.
    navigator.clipboard.write([new ClipboardItem({ "image/png": pngDeCaras(caras) })])
      .then(() => setEstado("copiada"))
      .catch((e) => { setEstado(""); setError(e instanceof Error && e.name === "NotAllowedError" ? "El navegador no dio permiso para copiar la imagen." : "No se pudo copiar la imagen."); });
  };

  const enviar = async () => {
    setError(""); setEstado("compartiendo");
    try {
      const png = await pngDeCaras(caras);
      const archivo = new File([png], `${(nombre.trim() || "Cédula").replace(/[\\/:*?"<>|]/g, "")}.png`, { type: "image/png" });
      await navigator.share({ files: [archivo], title: archivo.name });
      setEstado("");
    } catch (e) {
      setEstado("");
      if (!(e instanceof Error && e.name === "AbortError")) setError("No se pudo compartir la imagen.");
    }
  };

  return (
    <>
      <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className={clase} style={estilo} disabled={estado === "copiando" || estado === "compartiendo"} onClick={copiar}>
          {estado === "copiando" ? <Loader2 size={14} className="girando" /> : estado === "copiada" ? <Check size={14} /> : <Copy size={14} />}
          {estado === "copiada" ? "Imagen copiada" : "Copiar imagen"}
        </button>
        {compartir && (
          <button className={clase} style={estilo} disabled={estado === "copiando" || estado === "compartiendo"} onClick={enviar}>
            {estado === "compartiendo" ? <Loader2 size={14} className="girando" /> : <Share2 size={14} />}Compartir imagen
          </button>
        )}
      </div>
      {estado === "copiada" && <span className="peq tenue">Frente y respaldo en una sola imagen: péguela en el chat.</span>}
      {error && <div className="aviso error">{error}</div>}
    </>
  );
}
