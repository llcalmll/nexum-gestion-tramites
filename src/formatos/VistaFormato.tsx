import { useMemo } from "react";
import { ajusteQueCabe, casillasDe, claveCambio, FORMATOS_LLENABLES, type DatosFormatos, type Formato } from "./llenado";

/*
 * La vista previa de un formato: la hoja original de fondo y cada dato en su sitio. En el PC cada dato se puede
 * corregir encima; en el celular es solo para ver (`soloLectura`).
 */

/** Medida del texto con la misma letra del PDF (Helvetica), para achicarlo igual que al imprimir si no cabe. */
let lienzo: CanvasRenderingContext2D | null = null;
function medir(texto: string, tam: number, negrita?: boolean) {
  lienzo ??= document.createElement("canvas").getContext("2d");
  if (!lienzo) return texto.length * tam * 0.5;
  lienzo.font = `${negrita ? "bold " : ""}${tam}px Helvetica, Arial, sans-serif`;
  return lienzo.measureText(texto).width;
}
const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export function VistaFormato({ formato, d, cambios = {}, corregir, soloLectura, titulo, acciones }: {
  formato: Formato; d: DatosFormatos; cambios?: Record<string, string>; corregir?: (clave: string, valor: string, calculado: string) => void; soloLectura?: boolean; titulo?: string;
  /** Botones junto al título de la hoja (imprimir solo esta hoja). */
  acciones?: React.ReactNode;
}) {
  const def = FORMATOS_LLENABLES.find((f) => f.id === formato)!;
  const casillas = useMemo(() => casillasDe(d, formato), [d, formato]);
  return (
    <div className="pila" style={{ gap: 4 }}>
      <div className="hoja-previa-cab"><span className="peq muted">{titulo ?? def.nombre}</span>{acciones}</div>
      <div className={`hoja-previa${def.ancho > def.alto ? " horizontal" : ""}`} style={{ aspectRatio: `${def.ancho} / ${def.alto}` }}>
        <img src={def.fondo} alt="" draggable={false} />
        {casillas.map((c) => {
          const clave = claveCambio(formato, c.id);
          const valor = cambios[clave] ?? c.texto;
          const { tam, apretar } = ajusteQueCabe(valor, c, (t, s) => medir(t, s, c.negrita));
          const ancho = c.ancho ?? 60;
          return (
            <input key={c.id} className={`casilla${clave in cambios ? " cambiada" : ""}${c.negrita ? " negrita" : ""}${apretar < 100 ? " apretada" : ""}`} value={valor} placeholder=" " spellCheck={false}
              readOnly={soloLectura} tabIndex={soloLectura ? -1 : undefined}
              aria-label={`${def.nombre}: ${c.id.replace(/_/g, " ")}`} title={apretar < 100 ? "No cabe a tamaño normal: en el PDF va con letra angosta. Si quiere, abrévielo." : clave in cambios ? `Corregido a mano (calculado: ${c.texto || "vacío"})` : undefined}
              onChange={(e) => corregir?.(clave, e.target.value, c.texto)}
              style={{ left: pct(c.x, def.ancho), top: pct(c.y - (c.tam ?? 8) * 0.98, def.alto), width: pct(ancho, def.ancho), height: pct((c.tam ?? 8) * 1.3, def.alto), fontSize: `${(tam / def.ancho) * 100}cqw`, textAlign: c.centro ? "center" : "left" }} />
          );
        })}
      </div>
    </div>
  );
}

/** La otra cara de un formato (en el formulario único: instrucciones e improntas), que va tal cual. */
export function VistaReverso({ formato, acciones }: { formato: Formato; acciones?: React.ReactNode }) {
  const def = FORMATOS_LLENABLES.find((f) => f.id === formato)!;
  if (!def.reverso) return null;
  return (
    <div className="pila" style={{ gap: 4 }}>
      <div className="hoja-previa-cab"><span className="peq muted">{def.nombre}: respaldo (instrucciones e improntas del motor y del chasis; se imprime por detrás)</span>{acciones}</div>
      <div className={`hoja-previa${def.ancho > def.alto ? " horizontal" : ""}`} style={{ aspectRatio: `${def.ancho} / ${def.alto}` }}>
        <img src={def.reverso} alt="" draggable={false} />
      </div>
    </div>
  );
}
