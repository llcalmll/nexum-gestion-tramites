import { codigoTramite, ESTADO_TRAMITE_LABEL, type EstadoTramite } from "../../compartido/dominio";
import { escribir, mensajeDe } from "../datos/escribir";
import { moverTramite } from "./Finalizar";
import { type UI, useUI } from "./ui";

export type Luz = "recibido" | "transito" | "correccion" | "salio" | "finalizado" | "cancelado";
/**
 * Las luces de la fila, en el orden del flujo: la encendida es el estado de hoy; un clic en otra lo cambia (con
 * confirmación). "Ya salió" es Finalizado pero falta entregar el documento (la tarjeta de propiedad o la licencia):
 * se lleva con el estado de la tarjeta; tocar "Finalizado" desde ahí lo da por entregado. Aparte, al final, "Cancelado"
 * (vino con una X): no se pudo hacer (lo rechazaron, el cliente desistió...).
 */
export const LUCES: { luz: Luz; estado: EstadoTramite; tono: string; texto: string }[] = [
  { luz: "recibido", estado: "en_preparacion", tono: "gris", texto: "Recibido" },
  { luz: "transito", estado: "en_tramite", tono: "azul", texto: "En tránsito" },
  { luz: "correccion", estado: "requiere_correccion", tono: "rojo", texto: "Requiere corrección" },
  { luz: "salio", estado: "entregado", tono: "indigo", texto: "Ya salió" },
  { luz: "finalizado", estado: "entregado", tono: "verde", texto: "Finalizado" },
  { luz: "cancelado", estado: "cancelado", tono: "vino", texto: "Cancelado" },
];
type Fila = Parameters<typeof moverTramite>[0] & { estadoTarjeta?: string | null };
/** Ya salió pero falta entregarle el documento al cliente. */
export const faltaEntregar = (t: { estado: string; estadoTarjeta?: string | null }) => t.estado === "entregado" && !!t.estadoTarjeta && t.estadoTarjeta !== "entregada";

/** La luz encendida de un trámite (el estado como se ve en la tabla). */
export const luzDe = (t: { estado: string; estadoTarjeta?: string | null }): Luz | null =>
  t.estado === "entregado" ? (faltaEntregar(t) ? "salio" : "finalizado") : LUCES.find((l) => l.estado === t.estado)?.luz ?? null;

/**
 * Pasa un trámite a una luz, con su confirmación; si le faltan precondiciones, pregunta si se dan por cumplidas (no
 * se queda en una alerta). Lo usan las luces de la tabla, el "Cambiar estado" del expediente y el clic derecho.
 * `sinPreguntar`: el paso ya se confirmó (un botón con el nombre del paso, un arrastre en el tablero).
 */
export async function cambiarALuz(t: Fila, luz: Luz, ui: UI, opciones?: { sinPreguntar?: boolean }) {
  const l = LUCES.find((x) => x.luz === luz)!;
  const actual = luzDe(t);
  const codigo = codigoTramite(t);
  const tarjeta = async (estadoTarjeta: string) => { try { await escribir("PATCH", `/api/tramites/${t.id}`, { estadoTarjeta }); return true; } catch (e) { ui.avisar(mensajeDe(e), "error"); return false; } };
  {
    if (l.luz === actual) return;
    if (l.luz === "salio") {
      if (t.estado !== "entregado") {
        if (!(await moverTramite(t, "entregado", ui, { titulo: `${codigo}: ya salió`, texto: "Queda Finalizado, con la tarjeta de propiedad o la licencia en la oficina por entregar al cliente.", boton: "Sí, ya salió" }, opciones))) return;
      } else if (!opciones?.sinPreguntar && !(await ui.confirmar({ titulo: `${codigo}: ya salió`, texto: "Queda con la tarjeta de propiedad o la licencia en la oficina, por entregar al cliente.", boton: "Sí" }))) return;
      if (await tarjeta("en_oficina")) ui.avisar(`${codigo}: ya salió, falta entregar el documento`);
      return;
    }
    if (l.luz === "finalizado" && actual === "salio") {
      if (!opciones?.sinPreguntar && !(await ui.confirmar({ titulo: `${codigo}: documento entregado`, texto: "El cliente ya recibió la tarjeta de propiedad o la licencia: queda Finalizado.", boton: "Sí, ya se entregó" }))) return;
      if (await tarjeta("entregada")) ui.avisar(`${codigo} quedó Finalizado`);
      return;
    }
    if (l.luz === "cancelado") {
      await moverTramite(t, "cancelado", ui, { titulo: `Cancelar ${codigo}`, texto: "No se pudo hacer (lo rechazaron, el cliente desistió...). Queda Cancelado; si es un combo, todas sus partes. Se puede volver a abrir tocando otra luz.", boton: "Sí, cancelarlo" }, opciones);
      return;
    }
    await moverTramite(t, l.estado, ui, null, opciones);
  }
}

export function LucesEstado({ t }: { t: Fila }) {
  const ui = useUI();
  const codigo = codigoTramite(t);
  const actual = luzDe(t);
  const tono = LUCES.find((l) => l.luz === actual)?.tono ?? "gris";
  const texto = LUCES.find((l) => l.luz === actual)?.texto ?? ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite] ?? t.estado;
  const tocar = (l: (typeof LUCES)[number]) => cambiarALuz(t, l.luz, ui);
  return (
    <div className="luces" role="radiogroup" aria-label={`Estado de ${codigo}`} onClick={(e) => e.stopPropagation()}>
      {LUCES.map((l) => (
        <button
          key={l.luz}
          type="button"
          role="radio"
          aria-checked={actual === l.luz}
          aria-label={l.texto}
          className={`luz ${l.tono} ${actual === l.luz ? "on" : ""}`}
          title={actual === l.luz ? `Está: ${l.texto}${l.luz === "cancelado" ? " (no se pudo hacer)" : ""}` : l.luz === "salio" ? "Ya salió: falta entregar la tarjeta de propiedad o la licencia" : l.luz === "cancelado" ? "Cancelar: no se pudo hacer" : `Pasar a ${l.texto}`}
          onClick={() => void tocar(l)}
        />
      ))}
      <span className={`luces-texto ${tono}`}>{texto}</span>
    </div>
  );
}
