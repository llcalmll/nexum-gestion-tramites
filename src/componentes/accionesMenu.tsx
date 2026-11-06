import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, ClipboardCopy, ExternalLink, FilePlus2, FileText, MessageCircle, Pencil, RefreshCw, Send, Trash2, UserRound } from "lucide-react";
import { ciudadDeEnvio, rutaEnvio } from "../logica/envio";
import { opcionChicharron } from "./Chicharron";
import { useNavigate } from "react-router-dom";
import { codigoTramite, ESTADOS_TERMINALES, type EstadoTramite } from "../../compartido/dominio";
import type { Cliente, Tramite, Vehiculo } from "../../compartido/tipos";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { moverTramite } from "./Finalizar";
import { cambiarALuz, LUCES, luzDe } from "./LucesEstado";
import type { ItemMenu } from "./MenuContextual";
import { useUI } from "./ui";

/** Las opciones del clic derecho que se repiten en varias vistas: trámites, clientes y vehículos. */

const copiar = (texto: string, avisar: (t: string) => void, que: string) => {
  void navigator.clipboard?.writeText(texto).then(() => avisar(`${que} copiado: ${texto}`), () => avisar("No se pudo copiar"));
};
/** El enlace de WhatsApp de un teléfono colombiano. */
export const enlaceWhatsapp = (tel: string | null | undefined) => { const d = (tel ?? "").replace(/\D/g, ""); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? `57${d}` : d}` : null; };

/** Un trámite (o su combo): abrir, editar, cambiar el estado, finalizar, copiar y eliminar (todo lo que cambia, con confirmación). */
export function useMenuTramite() {
  const nav = useNavigate();
  const ui = useUI();
  // Para "Enviar a [ciudad]": la ciudad del organismo de cada trámite.
  const organismos = useLiveQuery(() => db.organismos.toArray(), []);
  return (t: Tramite, extra: { placa?: string | null } = {}): ItemMenu[] => {
    const codigo = codigoTramite(t);
    const ciudadEnvio = ciudadDeEnvio(organismos?.find((o) => o.id === t.organismoId));
    const terminal = ESTADOS_TERMINALES.includes(t.estado as EstadoTramite);
    async function eliminar() {
      const partes = t.encargoId ? (await db.tramites.where("encargoId").equals(t.encargoId).toArray()) : [t];
      const combo = partes.length > 1;
      if (!(await ui.confirmar({ titulo: combo ? `Eliminar el combo ${codigo}` : `Eliminar ${codigo}`, texto: `${combo ? `Se borran sus ${partes.length} partes` : "Se borra"} con sus documentos, pagos y bitácora. No se puede deshacer. Si solo no se va a hacer, mejor cámbielo a Cancelado.`, boton: "Eliminar", peligro: true }))) return;
      try {
        for (const p of partes) await escribir("DELETE", `/api/tramites/${p.id}`);
        ui.avisar(`${codigo} eliminado`);
      } catch (e) { ui.avisar(mensajeDe(e), "error"); }
    }
    return [
      { texto: "Abrir expediente", icono: FileText, accion: () => nav(`/tramites/${t.id}`) },
      { texto: "Abrir en otra pestaña", icono: ExternalLink, accion: () => window.open(`/tramites/${t.id}`, "_blank") },
      { texto: "Editar datos", icono: Pencil, accion: () => nav(`/tramites/${t.id}?editar=1`) },
      "-",
      // Las mismas 6 opciones de las luces de la tabla (y si faltan precondiciones, pregunta si se dan por cumplidas).
      { texto: "Cambiar estado", icono: RefreshCw, hijos: LUCES.filter((l) => l.luz !== luzDe(t)).map((l) => ({ texto: l.texto, accion: () => void cambiarALuz(t, l.luz, ui) })) },
      opcionChicharron(t, ui),
      { texto: "Finalizar (ya salió)", icono: CheckCircle2, deshabilitado: terminal || t.borrador, accion: () => void moverTramite(t, "entregado", ui, { titulo: `Finalizar ${codigo}`, texto: "Queda Finalizado con la fecha de hoy (si es un combo, todas sus partes).", boton: "Sí, ya salió" }) },
      // Mandarlo a su ciudad: Envíos con el trámite, la ciudad y el tramitador ya puestos.
      ...(ciudadEnvio && !terminal ? [{ texto: `Enviar a ${ciudadEnvio}`, icono: Send, accion: () => nav(rutaEnvio(t.id)) }] : []),
      "-",
      { texto: "Copiar código", icono: ClipboardCopy, accion: () => copiar(codigo, ui.avisar, "Código") },
      ...(extra.placa ? [{ texto: "Copiar placa", icono: ClipboardCopy, accion: () => copiar(extra.placa!, ui.avisar, "Placa") }] : []),
      "-",
      { texto: t.encargoId ? "Eliminar el combo" : "Eliminar trámite", icono: Trash2, peligro: true, accion: () => void eliminar() },
    ];
  };
}

/** Un cliente: su ficha, editarlo, un trámite nuevo, copiar sus datos, WhatsApp y eliminarlo. */
export function useMenuCliente(abrirFicha: (id: string) => void, editar: (id: string) => void) {
  const nav = useNavigate();
  const ui = useUI();
  return (c: Cliente): ItemMenu[] => {
    const wa = enlaceWhatsapp(c.telefono);
    async function eliminar() {
      if (!(await ui.confirmar({ titulo: `Eliminar a ${c.nombre}`, texto: "Se borra el cliente. Si tiene trámites o vehículos, no se deja borrar.", boton: "Eliminar", peligro: true }))) return;
      try { await escribir("DELETE", `/api/clientes/${c.id}`); ui.avisar("Cliente eliminado"); } catch (e) { ui.avisar(mensajeDe(e), "error"); }
    }
    return [
      { texto: "Ver ficha", icono: UserRound, accion: () => abrirFicha(c.id) },
      { texto: "Editar", icono: Pencil, accion: () => editar(c.id) },
      { texto: "Nuevo trámite", icono: FilePlus2, accion: () => nav(`/tramites?nuevo=1&titular=${c.id}`) },
      "-",
      ...(c.numeroDocumento ? [{ texto: "Copiar cédula", icono: ClipboardCopy, accion: () => copiar(c.numeroDocumento, ui.avisar, "Cédula") }] : []),
      ...(c.telefono ? [{ texto: "Copiar teléfono", icono: ClipboardCopy, accion: () => copiar(c.telefono!, ui.avisar, "Teléfono") }] : []),
      ...(wa ? [{ texto: "Escribir por WhatsApp", icono: MessageCircle, accion: () => window.open(wa, "_blank") }] : []),
      "-",
      { texto: "Eliminar cliente", icono: Trash2, peligro: true, accion: () => void eliminar() },
    ];
  };
}

/** Un vehículo: su ficha, editarlo, un trámite nuevo, copiar la placa y eliminarlo. */
export function useMenuVehiculo(abrirFicha: (id: string) => void, editar: (id: string) => void) {
  const nav = useNavigate();
  const ui = useUI();
  return (v: Vehiculo): ItemMenu[] => {
    async function eliminar() {
      if (!(await ui.confirmar({ titulo: `Eliminar el vehículo ${v.placa}`, texto: "Se borra el vehículo. Si tiene trámites, no se deja borrar.", boton: "Eliminar", peligro: true }))) return;
      try { await escribir("DELETE", `/api/vehiculos/${v.id}`); ui.avisar("Vehículo eliminado"); } catch (e) { ui.avisar(mensajeDe(e), "error"); }
    }
    return [
      { texto: "Ver ficha", icono: FileText, accion: () => abrirFicha(v.id) },
      { texto: "Editar", icono: Pencil, accion: () => editar(v.id) },
      ...(v.titularId ? [{ texto: "Nuevo trámite", icono: FilePlus2, accion: () => nav(`/tramites?nuevo=1&titular=${v.titularId}`) }] : []),
      "-",
      { texto: "Copiar placa", icono: ClipboardCopy, accion: () => copiar(v.placa, ui.avisar, "Placa") },
      "-",
      { texto: "Eliminar vehículo", icono: Trash2, peligro: true, accion: () => void eliminar() },
    ];
  };
}
