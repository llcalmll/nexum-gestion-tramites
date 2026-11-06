import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * El rótulo del sobre en PDF (para imprimirlo sin el encabezado del navegador), con las mismas medidas que la vista
 * de la pantalla Envíos (.rotulo en app.css):
 * - Grande: media carta arriba (215,9 x 139,7 mm), 12 x 16 mm de margen, el remitente y debajo el destinatario más
 *   grande (nombre y ciudad en mayúsculas), y la raya punteada para recortar.
 * - Pequeño: el rótulo de ancho x alto mm a 10 mm de la esquina, con borde punteado; la letra a la escala pedida y los
 *   datos largos en varias líneas.
 */
export interface DatosRotulo { nombre: string; documento: string; telefono: string; direccion: string; ciudad: string }
const CAMPOS: [keyof DatosRotulo, string][] = [["nombre", "Nombre"], ["documento", "C.C."], ["telefono", "Teléfono"], ["direccion", "Dirección"], ["ciudad", "Ciudad"]];
const PT = 72 / 25.4;
const CARTA = { w: 215.9, h: 279.4 };
/** Lo que la fuente del PDF (Helvetica, Latin-1) no tiene se cambia o se quita. */
const limpio = (t: string) => t.normalize("NFC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

/** Parte un texto en líneas que caben en `ancho` mm (palabras; una palabra muy larga se corta). */
function envolver(texto: string, f: PDFFont, pt: number, ancho: number) {
  const cabe = (s: string) => f.widthOfTextAtSize(s, pt) / PT <= ancho;
  const lineas: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (cabe(prueba)) { linea = prueba; continue; }
    if (linea) lineas.push(linea);
    linea = palabra;
    while (!cabe(linea) && linea.length > 1) {
      let k = linea.length - 1;
      while (k > 1 && !cabe(linea.slice(0, k))) k--;
      lineas.push(linea.slice(0, k));
      linea = linea.slice(k);
    }
  }
  if (linea) lineas.push(linea);
  return lineas.length ? lineas : [""];
}

/** `nota`: la del tramitador que va en el sobre ("déjelo debajo de la puerta"), debajo del destinatario. */
export async function rotuloPdf(remite: DatosRotulo, recibe: DatosRotulo | null, formato: "grande" | "pequeno", medidas: { ancho: number; alto: number; letra: number }, nota = ""): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Rótulo del sobre");
  const page = pdf.addPage([CARTA.w * PT, CARTA.h * PT]);
  const normal = await pdf.embedFont(StandardFonts.Helvetica), negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Todo se mide en mm desde la esquina de arriba a la izquierda.
  const texto = (p: PDFPage, t: string, x: number, yBase: number, pt: number, f: PDFFont, color = rgb(0, 0, 0), espaciado = 0) => {
    const s = limpio(t);
    if (!espaciado) { p.drawText(s, { x: x * PT, y: (CARTA.h - yBase) * PT, size: pt, font: f, color }); return; }
    let cx = x;
    for (const ch of s) { p.drawText(ch, { x: cx * PT, y: (CARTA.h - yBase) * PT, size: pt, font: f, color }); cx += f.widthOfTextAtSize(ch, pt) / PT + espaciado; }
  };
  const raya = (x1: number, y: number, x2: number, grosor: number, color = rgb(0, 0, 0), punteada = false) =>
    page.drawLine({ start: { x: x1 * PT, y: (CARTA.h - y) * PT }, end: { x: x2 * PT, y: (CARTA.h - y) * PT }, thickness: grosor * PT, color, dashArray: punteada ? [3, 2] : undefined });
  const mmDe = (pt: number) => pt / PT;
  const gris = rgb(0.2, 0.2, 0.2), claro = rgb(0.73, 0.73, 0.73), corte = rgb(0.53, 0.53, 0.53);
  const grande = (k: keyof DatosRotulo, destinatario: boolean) => destinatario && (k === "nombre" || k === "ciudad");

  if (formato === "grande") {
    const x0 = 16, x1 = CARTA.w - 16;
    let y = 12;
    for (const [titulo, d, destinatario] of [["Remitente", remite, false], ["Destinatario", recibe, true]] as const) {
      // Título: 10 pt, mayúsculas espaciadas, con raya debajo.
      texto(page, titulo.toUpperCase(), x0, y + mmDe(10) * 0.95, 10, negrita, rgb(0, 0, 0), 0.45);
      y += mmDe(10) * 1.2 + 1;
      raya(x0, y, x1, 0.4);
      y += 2.5;
      for (const [k, etq] of CAMPOS) {
        const alto = destinatario ? 9 : 7, pt = destinatario ? 14 : 11, col = destinatario ? 30 : 26;
        const ptValor = grande(k, destinatario) ? 17 : pt;
        const base = y + alto - 1.6;
        texto(page, `${etq}:`, x0, base, pt, normal, gris);
        const valor = d?.[k] ?? "";
        // El dato en una línea; si no cabe, se achica la letra.
        const v = grande(k, destinatario) ? valor.toUpperCase() : valor;
        let tam = ptValor;
        while (tam > 7 && negrita.widthOfTextAtSize(limpio(v), tam) / PT > x1 - x0 - col) tam -= 0.5;
        texto(page, v, x0 + col, base, tam, negrita);
        raya(x0 + col, y + alto, x1, 0.2, claro);
        y += alto;
      }
      // La nota del destinatario, debajo de sus datos (hasta 2 líneas; si no caben, más pequeña), sin pasar el corte.
      if (destinatario && nota.trim()) {
        let tam = 13, lineas = envolver(nota.trim(), negrita, tam, x1 - x0 - 26);
        while (lineas.length > 2 && tam > 8) { tam -= 0.5; lineas = envolver(nota.trim(), negrita, tam, x1 - x0 - 26); }
        const interlinea = mmDe(tam) * 1.25;
        y += 2;
        lineas.slice(0, 2).forEach((l, i) => {
          if (i === 0) texto(page, "Nota:", x0, y + interlinea, 11, normal, gris);
          texto(page, l, x0 + 26, y + interlinea * (i + 1), tam, negrita);
        });
        y += interlinea * Math.min(2, lineas.length) + 1;
      }
      y += 7;
    }
    raya(0, 139.7, CARTA.w, 0.3, corte, true);
  } else {
    const { ancho, alto, letra } = medidas;
    const x0 = 10, y0 = 10;
    page.drawRectangle({ x: x0 * PT, y: (CARTA.h - y0 - alto) * PT, width: ancho * PT, height: alto * PT, borderColor: corte, borderWidth: 0.3 * PT, borderDashArray: [3, 2] });
    const px = 6, py = 7 * letra, gap = 7 * letra;
    const ix0 = x0 + px, ix1 = x0 + ancho - px;
    const parteAlto = (alto - 2 * py - gap) / 2;
    const col = 20 * letra, ptLinea = 11 * letra, ptTitulo = 10 * letra, minFila = 9 * letra;
    let y = y0 + py;
    for (const [titulo, d] of [["Remitente", remite], ["Destinatario", recibe]] as const) {
      // Cada línea con su alto (los datos largos en varias líneas) y el espacio sobrante repartido parejo.
      // El destinatario lleva, si va, la nota como una línea más.
      const campos: [string, string, boolean][] = [...CAMPOS.map(([k, etq]) => [etq, d?.[k] ?? "", k === "nombre" || k === "ciudad"] as [string, string, boolean]), ...(titulo === "Destinatario" && nota.trim() ? [["Nota", nota.trim(), false] as [string, string, boolean]] : [])];
      const filas = campos.map(([etq, valor, g]) => {
        const pt = g ? 11.5 * letra : ptLinea;
        const lineas = envolver(g ? valor.toUpperCase() : valor, negrita, pt, ix1 - ix0 - col);
        const interlinea = mmDe(pt) * 1.25;
        return { etq, pt, lineas, interlinea, alto: Math.max(minFila, lineas.length * interlinea + 1) };
      });
      const altoTitulo = mmDe(ptTitulo) * 1.2 + 1 + 1;
      const libre = Math.max(0, parteAlto - altoTitulo - filas.reduce((s, f) => s + f.alto, 0));
      const hueco = libre / (filas.length + 2);
      let yy = y + hueco;
      texto(page, titulo.toUpperCase(), ix0, yy + mmDe(ptTitulo) * 0.95, ptTitulo, negrita, rgb(0, 0, 0), 0.45 * letra);
      yy += mmDe(ptTitulo) * 1.2 + 1;
      raya(ix0, yy, ix1, 0.4);
      yy += 1;
      for (const f of filas) {
        yy += hueco;
        const ultima = yy + f.alto - 1.6;
        texto(page, `${f.etq}:`, ix0, ultima, ptLinea, normal, gris);
        f.lineas.forEach((l, i) => texto(page, l, ix0 + col, ultima - (f.lineas.length - 1 - i) * f.interlinea, f.pt, negrita));
        raya(ix0 + col, yy + f.alto, ix1, 0.2, claro);
        yy += f.alto;
      }
      y += parteAlto + gap;
    }
  }
  return pdf.save();
}
