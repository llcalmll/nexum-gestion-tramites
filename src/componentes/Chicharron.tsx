import { Skull } from "lucide-react";
import { escribir, mensajeDe } from "../datos/escribir";
import { codigoTramite } from "../../compartido/dominio";
import type { ItemMenu } from "./MenuContextual";
import type { useUI } from "./ui";

/**
 * "Chicharrón": un trámite con un problema raro (un embargo que sigue figurando aunque trae el paz y salvo, algo que
 * sale en un sistema y en otro no...). Sale con una calavera junto al código; se pone y se quita con clic derecho (o
 * con su botón en el expediente). En un combo, vale para todas sus partes.
 */
export const TEXTO_CHICHARRON = "Chicharrón: este trámite tiene un problema (un embargo que sigue figurando, algo que no aparece donde debe...)";

export function Chicharron({ t, tam = 14 }: { t: { problema?: boolean | null }; tam?: number }) {
  if (!t.problema) return null;
  return <span className="chicharron" title={TEXTO_CHICHARRON} aria-label="Chicharrón: tiene un problema"><Skull size={tam} strokeWidth={2.2} /></span>;
}

/** Pone o quita la marca (con aviso). */
export async function marcarChicharron(t: { id: string; problema?: boolean | null; numero: number; serie?: string | null; creado: string; codigo?: number | null }, ui: Pick<ReturnType<typeof useUI>, "avisar">) {
  const poner = !t.problema;
  try {
    await escribir("POST", `/api/tramites/${t.id}/problema`, { problema: poner });
    ui.avisar(poner ? `${codigoTramite(t)}: marcado como chicharrón` : `${codigoTramite(t)}: se quitó el chicharrón`);
  } catch (e) { ui.avisar(mensajeDe(e), "error"); }
}

/** La opción del menú del clic derecho. */
export const opcionChicharron = (t: Parameters<typeof marcarChicharron>[0], ui: Parameters<typeof marcarChicharron>[1]): ItemMenu => ({
  texto: t.problema ? "Quitar el chicharrón (ya se resolvió)" : "Marcar como chicharrón (tiene un problema)",
  icono: Skull,
  accion: () => void marcarChicharron(t, ui),
});
