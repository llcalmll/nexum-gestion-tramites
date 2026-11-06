import { textoFaltan } from "../datos/incompletos";

/** La etiqueta "Falta info" de un trámite preanotado (pequeña): al pasar el mouse dice qué falta. Se va sola al completarlo. */
export function InfoIncompleta({ falta, detalle }: { falta: string[] | undefined; detalle?: boolean }) {
  if (!falta?.length) return null;
  return (
    <>
      <span className="falta-info" title={textoFaltan(falta)}>Falta info</span>
      {detalle && <span className="peq info-incompleta-detalle">{textoFaltan(falta)}</span>}
    </>
  );
}
