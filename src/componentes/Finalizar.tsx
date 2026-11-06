import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { codigoTramite, ESTADO_TRAMITE_LABEL, type EstadoTramite } from "../../compartido/dominio";
import { db } from "../datos/db";
import { escribir, ErrorEscritura, mensajeDe } from "../datos/escribir";
import { useUI } from "./ui";

type TramiteMovible = { id: string; numero: number; codigo?: number | null; creado: string; estado: string; encargoId?: string | null; borrador?: boolean };
type UI = ReturnType<typeof useUI>;

/**
 * Cambia el estado de un trámite preguntando antes. Si le faltan precondiciones, lo dice y pregunta si se dan por
 * cumplidas (las de todas las partes de un combo); un combo se mueve entero. Devuelve si quedó hecho.
 */
/** `sinPreguntar`: ya se confirmó de otra forma (en el mapa, con el segundo toque de la burbuja). */
export async function moverTramite(t: TramiteMovible, estado: EstadoTramite, { confirmar, avisar }: UI, pregunta?: { titulo: string; texto: string; boton: string } | null, opciones?: { sinPreguntar?: boolean }): Promise<boolean> {
  const codigo = codigoTramite(t);
  if (!opciones?.sinPreguntar && !(await confirmar(pregunta ?? { titulo: `${codigo} → ${ESTADO_TRAMITE_LABEL[estado]}`, texto: "Si es un combo, se mueven todas sus partes.", boton: "Sí, cambiarlo" }))) return false;
  try {
    try {
      await escribir("POST", `/api/tramites/${t.id}/estado`, { estado });
    } catch (err) {
      const faltan = err instanceof ErrorEscritura ? (err.datos as { faltantes?: string[] } | undefined)?.faltantes : undefined;
      if (!faltan?.length) throw err;
      if (!(await confirmar({ titulo: "Le faltan precondiciones", texto: `${mensajeDe(err)} ¿Las doy por cumplidas y lo muevo?`, boton: "Sí, darlas por cumplidas" }))) return false;
      const partes = t.encargoId ? (await db.tramites.where("encargoId").equals(t.encargoId).toArray()).filter((x) => x.estado !== "cancelado") : [t];
      for (const p of partes) await escribir("POST", `/api/tramites/${p.id}/precondiciones`, { todas: true });
      await escribir("POST", `/api/tramites/${t.id}/estado`, { estado });
    }
    avisar(`${codigo} quedó ${ESTADO_TRAMITE_LABEL[estado]}`);
    return true;
  } catch (err) {
    avisar(mensajeDe(err), "error");
    return false;
  }
}

/**
 * "Ya salió": el botón para dejar un trámite Finalizado desde donde aparezca (tabla, tablero, mapa, expediente,
 * fichas, inicio), siempre con confirmación.
 */
export function BotonFinalizar({ t, etiqueta = true, tamano = "sm" }: { t: TramiteMovible; etiqueta?: boolean; tamano?: "sm" | "xs" }) {
  const ui = useUI();
  const [ocupado, setOcupado] = useState(false);
  if (t.estado === "entregado" || t.estado === "cancelado" || t.borrador) return null;
  const codigo = codigoTramite(t);
  async function finalizar(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setOcupado(true);
    try {
      await moverTramite(t, "entregado", ui, { titulo: `Finalizar ${codigo}`, texto: "Queda Finalizado con la fecha de hoy (si es un combo, todas sus partes).", boton: "Sí, ya salió" });
    } finally { setOcupado(false); }
  }
  return (
    <button type="button" className={`btn btn-${tamano} btn-finalizar`} disabled={ocupado} onClick={finalizar} title={`Finalizar ${codigo} (ya salió)`} aria-label={`Finalizar ${codigo}`}>
      <CheckCircle2 size={tamano === "xs" ? 12 : 14} />{etiqueta && (ocupado ? "Finalizando…" : "Finalizar")}
    </button>
  );
}
