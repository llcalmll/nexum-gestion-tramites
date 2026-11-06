/*
 * Una cotización para mandarle al cliente, de dos maneras:
 * - textoCliente: solo lo que le importa (la placa y el modelo en negrilla, cada concepto con su valor y el total),
 *   sin el organismo, el avalúo ni el cilindraje. La negrilla va con asteriscos (así la pone WhatsApp).
 * - tablaCotizacion: una imagen como las de la hoja COTIZACIONES 2026: un bloque de dos columnas con bordes finos
 *   (la ciudad, el trámite y la placa en amarillo arriba; "$ valor | CONCEPTO" en cada fila; el TOTAL en negrilla).
 *   copiarImagen la deja en el portapapeles (para pegarla en WhatsApp); si el navegador no deja, la comparte o la baja.
 */

/** Lo que se necesita de una cotización (la del asistente o la del cotizador de tarjetas). */
export interface CotizacionCliente {
  titulo: string; organismo: string; tramite: string;
  ciudad?: string | null; placa?: string | null; vehiculo?: string | null; modelo?: number | string | null;
  lineas: { tramite: string | null; concepto: string; valor: number }[];
  honorarios: number; falta: string[];
}

const miles = (n: number) => Math.round(n).toLocaleString("es-CO");
const total = (c: CotizacionCliente) => c.lineas.reduce((s, l) => s + (l.valor || 0), 0) + (c.honorarios || 0);
/** "Retención en la fuente (1%)" -> "Retención en la fuente". */
const sinParentesis = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

/** La placa, el vehículo y el modelo (de sus campos o, en las cotizaciones de antes, del título). */
export function vehiculoDe(c: CotizacionCliente) {
  const partes = c.titulo.replace(/^\d+\.\s*/, "").split(" · ");
  const placa = c.placa !== undefined ? c.placa : /^sin placa$/i.test(partes[0] ?? "") ? null : partes[0] ?? null;
  const vehiculo = c.vehiculo !== undefined ? c.vehiculo : partes.find((p, i) => i > 0 && !/^modelo\b|\bcc$/i.test(p)) ?? null;
  const modelo = c.modelo !== undefined && c.modelo !== null ? String(c.modelo) : /modelo (\d{4})/i.exec(c.titulo)?.[1] ?? null;
  return { placa: placa || null, vehiculo: vehiculo || null, modelo };
}
/** La ciudad del organismo ("Secretaría de Tránsito de Funza" -> "Funza"). */
export const ciudadDe = (c: CotizacionCliente) => c.ciudad || c.organismo.replace(/^.*\b(de|del)\s+/i, "").trim() || c.organismo;

/** El texto para el cliente (WhatsApp). */
export function textoCliente(c: CotizacionCliente) {
  const v = vehiculoDe(c);
  const cabeza = [v.placa, [v.vehiculo, v.modelo && `modelo ${v.modelo}`].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || c.tramite;
  const tramites = [...new Set(c.lineas.map((l) => l.tramite).filter(Boolean))] as string[];
  const lineas: string[] = [];
  let actual: string | null = null;
  for (const l of c.lineas) {
    if (tramites.length > 1 && l.tramite && l.tramite !== actual) { actual = l.tramite; lineas.push(`${l.tramite}:`); }
    lineas.push(`${tramites.length > 1 && l.tramite ? "  " : ""}${sinParentesis(l.concepto)}: $ ${miles(l.valor)}`);
  }
  return [
    `*${cabeza}*`,
    tramites.length <= 1 ? c.tramite : "",
    ...lineas,
    c.honorarios ? `Honorarios: $ ${miles(c.honorarios)}` : "",
    `*${c.falta.length ? "Total parcial" : "Total"}: $ ${miles(total(c))}*`,
  ].filter(Boolean).join("\n");
}

/** Cómo va cada concepto en la tabla, como en la hoja ("RET/FUENTE", "PAZ Y SALVO"...). */
function conceptoTabla(concepto: string) {
  const c = sinParentesis(concepto).toUpperCase();
  return /^RETENCI[OÓ]N/.test(c) ? "RET/FUENTE" : /^DERECHOS DE TR[AÁ]NSITO/.test(c) ? "DER. TRÁNSITO" : c;
}

type Fila = { tipo: "titulo"; texto: string; amarillo?: boolean } | { tipo: "valor"; valor: number; concepto: string; negrilla?: boolean };

/** Las filas del bloque, de arriba abajo. */
export function filasTabla(c: CotizacionCliente): Fila[] {
  const v = vehiculoDe(c);
  const tramites = [...new Set(c.lineas.map((l) => l.tramite).filter(Boolean))] as string[];
  const filas: Fila[] = [
    { tipo: "titulo", texto: ciudadDe(c).toUpperCase() },
    { tipo: "titulo", texto: (tramites.length ? tramites : [c.tramite]).join(" + ").toUpperCase() },
  ];
  // La placa en amarillo (como en la hoja) y debajo el vehículo; sin placa, el vehículo va en la fila amarilla.
  const carro = [v.vehiculo, v.modelo && `MODELO ${v.modelo}`].filter(Boolean).join(" · ").toUpperCase();
  if (v.placa) filas.push({ tipo: "titulo", texto: v.placa, amarillo: true });
  if (carro || !v.placa) filas.push({ tipo: "titulo", texto: carro || "SIN PLACA", amarillo: !v.placa });
  let actual: string | null = null;
  for (const l of c.lineas) {
    if (tramites.length > 1 && l.tramite && l.tramite !== actual) { actual = l.tramite; filas.push({ tipo: "titulo", texto: l.tramite.toUpperCase() }); }
    filas.push({ tipo: "valor", valor: l.valor, concepto: conceptoTabla(l.concepto) });
  }
  if (c.honorarios) filas.push({ tipo: "valor", valor: c.honorarios, concepto: "HONORARIOS" });
  filas.push({ tipo: "valor", valor: total(c), concepto: c.falta.length ? "TOTAL PARCIAL" : "TOTAL", negrilla: true });
  return filas;
}

const FUENTE = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

/** La tabla dibujada (a doble resolución, para que se vea nítida en el celular). */
export function tablaCotizacion(c: CotizacionCliente): HTMLCanvasElement {
  const filas = filasTabla(c);
  const k = 2, alto = 26, pad = 8, margen = 22;
  const medidor = document.createElement("canvas").getContext("2d")!;
  const ancho = (t: string, negrilla = false) => { medidor.font = `${negrilla ? "bold " : ""}15px ${FUENTE}`; return medidor.measureText(t).width; };
  // Columna del valor y del concepto: como en la hoja, y más anchas si algo no cabe.
  const colValor = Math.max(132, ...filas.map((f) => (f.tipo === "valor" ? ancho(miles(f.valor), f.negrilla) + 40 : 0)));
  const colConcepto = Math.max(178, ...filas.map((f) => (f.tipo === "valor" ? ancho(f.concepto, f.negrilla) + 2 * pad : 0)));
  const anchoBloque = Math.max(colValor + colConcepto, ...filas.map((f) => (f.tipo === "titulo" ? ancho(f.texto, true) + 2 * pad : 0)));
  const extra = anchoBloque - colValor - colConcepto;
  const cv = colValor + extra / 2, cc = colConcepto + extra / 2;
  const W = anchoBloque + 2 * margen, H = filas.length * alto + 2 * margen;
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(W * k); lienzo.height = Math.round(H * k);
  const g = lienzo.getContext("2d")!;
  g.scale(k, k);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  // La cuadrícula gris de la hoja alrededor.
  g.strokeStyle = "#e1e1e1"; g.lineWidth = 1;
  for (let y = margen % alto; y <= H; y += alto) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
  for (const x of [margen, margen + cv, margen + cv + cc]) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
  g.textBaseline = "middle";
  filas.forEach((f, i) => {
    const y = margen + i * alto, x = margen;
    if (f.tipo === "titulo") {
      if (f.amarillo) { g.fillStyle = "#ffff00"; g.fillRect(x, y, cv + cc, alto); }
      else { g.fillStyle = "#ffffff"; g.fillRect(x, y, cv + cc, alto); }
      g.fillStyle = "#000000"; g.font = `bold 15px ${FUENTE}`; g.textAlign = "center";
      g.fillText(f.texto, x + (cv + cc) / 2, y + alto / 2 + 1);
      g.strokeStyle = "#000000"; g.strokeRect(x + 0.5, y + 0.5, cv + cc, alto);
    } else {
      g.fillStyle = "#ffffff"; g.fillRect(x, y, cv + cc, alto);
      g.fillStyle = "#000000"; g.font = `${f.negrilla ? "bold " : ""}15px ${FUENTE}`;
      // Formato de contabilidad: el "$" a la izquierda y el número a la derecha ("$ -" si es cero).
      g.textAlign = "left"; g.fillText("$", x + pad, y + alto / 2 + 1);
      g.textAlign = "right"; g.fillText(f.valor ? miles(f.valor) : "-", x + cv - pad, y + alto / 2 + 1);
      g.textAlign = "left"; g.fillText(f.concepto, x + cv + pad, y + alto / 2 + 1);
      g.strokeStyle = "#000000"; g.strokeRect(x + 0.5, y + 0.5, cv, alto); g.strokeRect(x + cv + 0.5, y + 0.5, cc, alto);
    }
  });
  return lienzo;
}

/**
 * Copia la tabla como imagen. En el celular, si el navegador no deja copiar imágenes, la comparte (WhatsApp...); si
 * tampoco, la descarga. Devuelve qué hizo.
 */
export async function copiarImagen(c: CotizacionCliente, nombre: string): Promise<"copiada" | "compartida" | "descargada" | "nada"> {
  const lienzo = tablaCotizacion(c);
  const blob = () => new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo hacer la imagen."))), "image/png"));
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    // Con la promesa adentro (Safari exige que se arme en el mismo toque); si no la acepta, con la imagen ya hecha.
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]); return "copiada"; } catch { /* sigue */ }
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await blob() })]); return "copiada"; } catch { /* sigue */ }
  }
  const archivo = new File([await blob()], `${nombre}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: nombre }); return "compartida"; } catch (e) { if (e instanceof DOMException && e.name === "AbortError") return "nada"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(archivo); a.download = archivo.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "descargada";
}

/**
 * Lo mismo que textoCliente, desde el texto de una cotización guardada (la pestaña Cotizaciones solo guarda el texto):
 * el título sin "Sin placa" ni el cilindraje, las líneas "concepto: $ valor" (y los nombres de los trámites de un
 * combo) y el total; sin el organismo ni las notas del avalúo. Si no parece una cotización, null.
 */
export function textoClienteDeTexto(texto: string): string | null {
  const out: string[] = [];
  let valores = 0;
  for (const cruda of texto.split("\n")) {
    const l = cruda.replace(/\*\*/g, "").trimEnd();
    if (!l.trim()) continue;
    if (/\s·\s/.test(l) && !/\$\s?\d/.test(l)) {
      const partes = l.replace(/^\d+\.\s*/, "").split(" · ").filter((p) => !/^sin placa$/i.test(p) && !/\bcc\b/i.test(p));
      out.push(`*${partes.join(" · ")}*`);
    } else if (/^\s*total\b/i.test(l)) out.push(`*${l.trim().replace(/\s*\(falta.*$/i, "")}*`);
    else if (/^\s*[^:$]+:\s*\$\s?[\d.]+\s*$/.test(l)) { out.push(l.replace(/\s*\([^)]*\)(?=:)/, "")); valores++; }
    else if (/^[^$:]+:\s*$/.test(l) && !/^\s*organismo/i.test(l)) out.push(l);
  }
  return valores >= 2 ? out.join("\n") : null;
}
