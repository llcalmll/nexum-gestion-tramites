import { COLORES_SEMAFORO } from "../../compartido/reglas";
import type { Semaforo as DatosSemaforo } from "../datos/semaforo";

/** El puntico del semáforo del trámite; al pasar el mouse dice el color y el porqué. */
export function Semaforo({ s, texto }: { s: DatosSemaforo | undefined; texto?: boolean }) {
  if (!s) return null;
  const nombre = COLORES_SEMAFORO.find((c) => c.color === s.color)?.nombre ?? "";
  return (
    <span className={`semaforo ${s.color}`} title={`${nombre}: ${s.motivo}`} aria-label={`Semáforo ${nombre.toLowerCase()}: ${s.motivo}`}>
      <i />{texto && <span>{s.motivo}</span>}
    </span>
  );
}
