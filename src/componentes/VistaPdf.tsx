import { Download, ExternalLink, Loader2, Printer } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useEffect, useState } from "react";
import { useUI } from "./ui";
import { mensajeDe } from "../datos/escribir";

/**
 * La vista previa y los ajustes de un formato en PDF (los oficiales y los propios), como los de la oficina: cada página
 * con su casilla, cuántas copias, y el PDF de lo elegido para imprimir, descargar o abrir. Una imagen subida se pone en
 * una hoja carta u oficio. Word y Excel no tienen vista previa en la app.
 */

/** Plegable que solo arma lo de adentro cuando se abre (las vistas previas pesan). */
export function Plegable({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <details className="llenar-plegable fo-plegable" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>{titulo}</summary>
      {abierto && <div className="pila" style={{ gap: 12, marginTop: 10 }}>{children}</div>}
    </details>
  );
}

/** Imprimir, descargar o abrir el PDF que se arma en el momento (como en Llenar formatos). */
export function AccionesPdf({ armar, nombre, deshabilitado }: { armar: () => Promise<Uint8Array>; nombre: string; deshabilitado?: boolean }) {
  const { avisar } = useUI();
  const [ocupado, setOcupado] = useState<"imprimir" | "descargar" | "abrir" | null>(null);
  async function accion(cual: "imprimir" | "descargar" | "abrir") {
    setOcupado(cual);
    try {
      const url = URL.createObjectURL(new Blob([(await armar()) as BlobPart], { type: "application/pdf" }));
      if (cual === "descargar") { const a = document.createElement("a"); a.href = url; a.download = nombre; a.click(); }
      else if (cual === "abrir") window.open(url, "_blank");
      else {
        // Se imprime el PDF tal cual (tamaño real) desde un marco oculto, sin salir de la pantalla.
        const marco = document.createElement("iframe");
        marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
        marco.src = url;
        marco.onload = () => { try { marco.contentWindow?.focus(); marco.contentWindow?.print(); } catch { window.open(url, "_blank"); } setTimeout(() => marco.remove(), 10_000); };
        document.body.appendChild(marco);
      }
      setTimeout(() => URL.revokeObjectURL(url), 100_000);
    } catch (e) { avisar(mensajeDe(e), "error"); } finally { setOcupado(null); }
  }
  const icono = (cual: typeof ocupado, I: typeof Printer) => (ocupado === cual ? <Loader2 size={15} className="girando" /> : <I size={15} />);
  return (
    <div className="fila-wrap" style={{ gap: 8 }}>
      <button className="btn btn-primario" disabled={!!ocupado || deshabilitado} onClick={() => accion("imprimir")}>{icono("imprimir", Printer)}Imprimir</button>
      <button className="btn" disabled={!!ocupado || deshabilitado} onClick={() => accion("descargar")}>{icono("descargar", Download)}Descargar PDF</button>
      <button className="btn" disabled={!!ocupado || deshabilitado} onClick={() => accion("abrir")}>{icono("abrir", ExternalLink)}Abrir PDF</button>
    </div>
  );
}

/** Cuántas copias (1 a 50). */
export const MAX_COPIAS = 50;
export const acotarCopias = (n: number) => Math.max(1, Math.min(MAX_COPIAS, Math.round(n) || 1));
export function Copias({ valor, cambiar }: { valor: number; cambiar: (n: number) => void }) {
  return <label>Copias<input className="input" type="number" min={1} max={MAX_COPIAS} value={valor} onChange={(e) => cambiar(Number(e.target.value))} aria-label="Cuántas copias" /></label>;
}

// Los PDF ya leídos (por ruta): abrir y cerrar la vista previa no los vuelve a bajar.
const leidos = new Map<string, Promise<PDFDocument>>();
export function leerPdf(ruta: string): Promise<PDFDocument> {
  if (!leidos.has(ruta)) {
    const p = fetch(ruta).then(async (r) => {
      if (!r.ok) throw new Error("No se pudo abrir el formato.");
      return PDFDocument.load(await r.arrayBuffer(), { ignoreEncryption: true });
    });
    p.catch(() => leidos.delete(ruta));
    leidos.set(ruta, p);
  }
  return leidos.get(ruta)!;
}

/** Las páginas elegidas (índices desde 0), cada copia completa y en orden: frente y respaldo quedan seguidos. */
export async function pdfDePaginas(ruta: string, paginas: number[], copias: number): Promise<Uint8Array> {
  const origen = await leerPdf(ruta);
  const salida = await PDFDocument.create();
  for (let c = 0; c < copias; c++) for (const pg of await salida.copyPages(origen, paginas)) salida.addPage(pg);
  return salida.save();
}

export interface PaginaVista { titulo: string; imagen?: string; horizontal?: boolean; vacia?: boolean }

const nombreCon = (nombre: string, extra: string) => nombre.replace(/\.pdf$/i, "") + extra + ".pdf";
/** Cuántas páginas de un PDF subido se ven en miniatura (las demás solo con su casilla). */
const MINIATURAS = 8;

/**
 * Vista previa y ajustes de un PDF: la miniatura de cada página con su casilla, y las copias. Con `paginas` (los
 * oficiales) se usan sus imágenes; sin ellas (los propios) se leen del PDF y cada página se ve en su propio marco.
 */
export function VistaPdf({ ruta, nombre, paginas, nota }: { ruta: string; nombre: string; paginas?: PaginaVista[]; nota?: string }) {
  const [leidas, setLeidas] = useState<PaginaVista[] | null>(paginas ?? null);
  const [error, setError] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<Set<number>>(() => new Set((paginas ?? []).flatMap((p, i) => (p.vacia ? [] : [i]))));
  const [copias, setCopias] = useState(1);
  const [marcos, setMarcos] = useState<string[]>([]);

  // Los propios: cuántas páginas tiene y cada una en un PDF suelto para verla (las primeras 8).
  useEffect(() => {
    if (paginas) return;
    let vivo = true;
    const urls: string[] = [];
    (async () => {
      try {
        const doc = await leerPdf(ruta);
        const ps = doc.getPages().map((pg, i) => { const { width, height } = pg.getSize(); const rot = pg.getRotation().angle % 180 !== 0; return { titulo: `Página ${i + 1}`, horizontal: rot ? height > width : width > height }; });
        if (!vivo) return;
        setLeidas(ps);
        setElegidas(new Set(ps.map((_, i) => i)));
        for (let i = 0; i < Math.min(ps.length, MINIATURAS); i++) {
          const u = URL.createObjectURL(new Blob([(await pdfDePaginas(ruta, [i], 1)) as BlobPart], { type: "application/pdf" }));
          urls.push(u);
          if (!vivo) break;
          setMarcos([...urls]);
        }
      } catch (e) { if (vivo) setError(`No se pudo leer el PDF (${mensajeDe(e)}). Ábralo o descárguelo.`); }
    })();
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [ruta, paginas]);

  if (error) return <div className="aviso error">{error}</div>;
  if (!leidas) return <span className="peq muted fila" style={{ gap: 6 }}><Loader2 size={14} className="girando" />Leyendo el PDF…</span>;

  const n = acotarCopias(copias);
  const orden = [...elegidas].sort((a, b) => a - b);
  const todas = orden.length === leidas.length;
  const cambiar = (i: number, si: boolean) => setElegidas((s) => { const c = new Set(s); if (si) c.add(i); else c.delete(i); return c; });
  const resumen = orden.length ? `Van ${orden.length * n} página${orden.length * n === 1 ? "" : "s"}${n > 1 ? ` (${n} copias de ${orden.length})` : ""}.` : "Elija al menos una página.";
  const extra = (todas ? "" : `-pag-${orden.map((i) => i + 1).join("-")}`) + (n > 1 ? `-${n}-copias` : "");
  const restantes = leidas.slice(paginas ? leidas.length : MINIATURAS);

  return (
    <>
      <div className="fo-opciones">
        <Copias valor={copias} cambiar={setCopias} />
        {leidas.length > 1 && <span className="peq tenue">Marque en cada página si va o no.</span>}
        {restantes.map((p, k) => { const i = k + MINIATURAS; return <label key={i}><input type="checkbox" checked={elegidas.has(i)} onChange={(e) => cambiar(i, e.target.checked)} />{p.titulo}</label>; })}
      </div>
      <small className="tenue">{resumen}{nota ? ` ${nota}` : ""}</small>
      <AccionesPdf armar={() => pdfDePaginas(ruta, orden, n)} nombre={nombreCon(nombre, extra)} deshabilitado={!orden.length} />
      <div className="fo-vista">
        {leidas.slice(0, paginas ? leidas.length : MINIATURAS).map((p, i) => (
          <label key={i} className={`fo-pagina${p.horizontal ? " horizontal" : ""}${elegidas.has(i) ? "" : " fuera"}`}>
            {p.imagen ? <img src={p.imagen} alt={p.titulo} loading="lazy" />
              : marcos[i] ? <iframe src={`${marcos[i]}#toolbar=0&navpanes=0&view=Fit`} title={p.titulo} />
              : <span className="fo-cargando"><Loader2 size={16} className="girando" /></span>}
            <span className="fo-pagina-tit"><input type="checkbox" checked={elegidas.has(i)} onChange={(e) => cambiar(i, e.target.checked)} />{p.titulo}</span>
          </label>
        ))}
      </div>
    </>
  );
}

// Tamaños de hoja en puntos (1/72 de pulgada): carta 216 x 279 mm, oficio 216 x 330 mm.
const PAPEL = { carta: [612, 792], oficio: [612, 936] } as const;

/** Una imagen subida (un formato escaneado, una foto) en una hoja carta u oficio, tantas copias como se pidan. */
async function pdfDeImagen(ruta: string, papel: keyof typeof PAPEL, copias: number): Promise<Uint8Array> {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error("No se pudo abrir el formato.");
  const blob = await r.blob();
  const salida = await PDFDocument.create();
  let img;
  if (blob.type === "image/jpeg") img = await salida.embedJpg(await blob.arrayBuffer());
  else if (blob.type === "image/png") img = await salida.embedPng(await blob.arrayBuffer());
  else {
    // Otros tipos (webp, gif...): se pasan a PNG con el navegador.
    const bm = await createImageBitmap(blob);
    const lienzo = document.createElement("canvas");
    lienzo.width = bm.width;
    lienzo.height = bm.height;
    lienzo.getContext("2d")!.drawImage(bm, 0, 0);
    const png = await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo leer la imagen."))), "image/png"));
    img = await salida.embedPng(await png.arrayBuffer());
  }
  // La hoja se acuesta si la imagen es más ancha que alta; la imagen va lo más grande posible, centrada, con 6 mm de margen.
  const [a, b] = PAPEL[papel];
  const [ancho, alto] = img.width > img.height ? [b, a] : [a, b];
  const margen = 17;
  const escala = Math.min((ancho - 2 * margen) / img.width, (alto - 2 * margen) / img.height);
  const w = img.width * escala, h = img.height * escala;
  for (let c = 0; c < copias; c++) salida.addPage([ancho, alto]).drawImage(img, { x: (ancho - w) / 2, y: (alto - h) / 2, width: w, height: h });
  return salida.save();
}

/** Vista previa y ajustes de una imagen subida: el papel y las copias. */
export function VistaImagen({ ruta, nombre }: { ruta: string; nombre: string }) {
  const [papel, setPapel] = useState<keyof typeof PAPEL>("carta");
  const [copias, setCopias] = useState(1);
  const [horizontal, setHorizontal] = useState(false);
  const n = acotarCopias(copias);
  return (
    <>
      <div className="fo-opciones">
        <label>Papel
          <select className="input fo-select" value={papel} onChange={(e) => setPapel(e.target.value as keyof typeof PAPEL)} aria-label="Tamaño del papel">
            <option value="carta">Carta</option>
            <option value="oficio">Oficio</option>
          </select>
        </label>
        <Copias valor={copias} cambiar={setCopias} />
      </div>
      <small className="tenue">Va la imagen en {n} hoja{n === 1 ? "" : "s"} {papel}{horizontal ? " horizontal" : ""}, lo más grande que cabe.</small>
      <AccionesPdf armar={() => pdfDeImagen(ruta, papel, n)} nombre={nombreCon(nombre.replace(/\.[^.]+$/, ""), n > 1 ? `-${n}-copias` : "")} />
      <div className="fo-vista">
        <div className={`fo-pagina fo-hoja-imagen ${papel}${horizontal ? " horizontal" : ""}`}>
          <span className="fo-papel"><img src={ruta} alt={nombre} onLoad={(e) => setHorizontal(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)} /></span>
        </div>
      </div>
    </>
  );
}
