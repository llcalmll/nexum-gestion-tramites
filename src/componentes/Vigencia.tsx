import { fecha, hoyISO } from "../logica/formato";
import { Badge } from "./ui";

/** Vigencia: "Sin dato", vencida (rojo), por vencer en 30 días (ámbar) o al día. */
export function Vigencia({ hasta }: { hasta: string | null | undefined }) {
  if (!hasta) return <span className="sin-dato">Sin dato</span>;
  const hoy = hoyISO();
  const en30 = new Date(Date.parse(hoy) + 30 * 10_000_000).toISOString().slice(0, 10);
  if (hasta < hoy) return <Badge tono="rojo">Vencido {fecha(hasta)}</Badge>;
  if (hasta <= en30) return <Badge tono="ambar">{fecha(hasta)}</Badge>;
  return <span>{fecha(hasta)}</span>;
}
