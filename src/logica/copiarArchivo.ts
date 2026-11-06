/*
 * Copiar la foto de un archivo del trámite al portapapeles (para pegarla en WhatsApp, un correo o un documento). Los
 * navegadores solo copian imágenes PNG: una JPEG se pasa a PNG. Un PDF no se puede copiar como archivo.
 */
async function comoPng(ruta: string): Promise<Blob> {
  const r = await fetch(ruta, { credentials: "same-origin" });
  if (!r.ok) throw new Error("No se pudo traer el archivo.");
  const b = await r.blob();
  if (b.type === "image/png") return b;
  const img = await createImageBitmap(b);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  img.close();
  return new Promise((ok, mal) => c.toBlob((x) => (x ? ok(x) : mal(new Error("No se pudo copiar la imagen."))), "image/png"));
}

/** Copia la imagen de `ruta`; "no" si el navegador no deja (entonces se descarga). */
export async function copiarArchivo(ruta: string): Promise<"copiada" | "no"> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return "no";
  // Con la promesa adentro: el navegador exige armarlo en el mismo clic.
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": comoPng(ruta) })]); return "copiada"; } catch { /* sigue */ }
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await comoPng(ruta) })]); return "copiada"; } catch { return "no"; }
}
