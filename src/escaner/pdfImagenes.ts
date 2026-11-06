import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

/*
 * Para editar un escaneo ya guardado: las caras o las hojas que lleva el PDF, como fotos otra vez. El PDF lo arma
 * armarPdf con una foto JPEG por hoja (documento) o dos por hoja carta (cédula o tarjeta); aquí se sacan tal cual, en
 * el orden en que se pusieron, sin volver a comprimirlas.
 */

/** Cédula o tarjeta: acostada, 85,6 x 54 mm (1,585). */
const esCara = (w: number, h: number) => { const r = w / h; return r > 1.45 && r < 1.75; };

export async function imagenesDelPdf(bytes: ArrayBuffer): Promise<{ fotos: File[]; modo: "hoja" | "tarjeta" }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fotos: File[] = [];
  let todasCaras = true;
  for (const pagina of doc.getPages()) {
    const xo = pagina.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    let enPagina = 0;
    for (const [, ref] of xo?.entries() ?? []) {
      const s = doc.context.lookup(ref);
      if (!(s instanceof PDFRawStream) || s.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      if (s.dict.get(PDFName.of("Filter")) !== PDFName.of("DCTDecode")) continue;
      const w = Number(s.dict.get(PDFName.of("Width"))?.toString()), h = Number(s.dict.get(PDFName.of("Height"))?.toString());
      if (!esCara(w, h)) todasCaras = false;
      fotos.push(new File([s.contents as BlobPart], `parte-${fotos.length + 1}.jpg`, { type: "image/jpeg" }));
      enPagina++;
    }
    if (enPagina > 2) todasCaras = false;
  }
  if (!fotos.length) throw new Error("Este escaneo no se puede editar (no trae fotos adentro).");
  return { fotos, modo: todasCaras ? "tarjeta" : "hoja" };
}
