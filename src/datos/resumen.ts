import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { ESTADOS_TERMINALES, type EstadoTramite } from "../../compartido/dominio";
import { nombresDeCombos, unoPorCombo } from "../logica/combos";
import { hoyISO } from "../logica/formato";
import { db } from "./db";

const masDias = (base: string, dias: number) => new Date(Date.parse(base) + dias * 10_000_000).toISOString().slice(0, 10);

/**
 * Lo que necesita atención hoy (de la copia local): trámites abiertos y atrasados, recordatorios, vencimientos de
 * vehículos, licencias por vencer, cobros, tarjetas en la oficina y WhatsApp por confirmar. Lo usan el mapa (arriba,
 * resumido) y la pantalla Resumen. Por cobrar es lo que quedó debiendo un trámite ya finalizado: lo de los abiertos se
 * cobra al entregar.
 */
export function useResumen() {
  const datos = useLiveQuery(async () => ({
    tramites: await db.tramites.toArray(),
    pagos: await db.pagos.toArray(),
    tipos: await db.tipos_tramite.toArray(),
    clientes: await db.clientes.toArray(),
    vehiculos: await db.vehiculos.toArray(),
    recordatorios: await db.recordatorios.where("estado").equals("pendiente").toArray(),
    licencias: await db.licencias.toArray(),
    waChats: await db.wa_chats.toArray(),
    waPropuestas: await db.wa_propuestas.where("estado").equals("pendiente").toArray(),
  }), []);
  const hoy = hoyISO();

  const resumen = useMemo(() => {
    if (!datos) return null;
    const tipo = new Map(datos.tipos.map((t) => [t.id, t.nombre]));
    const cliente = new Map(datos.clientes.map((c) => [c.id, c]));
    const placa = new Map(datos.vehiculos.map((v) => [v.id, v.placa]));
    const pagado = new Map<string, number>();
    for (const p of datos.pagos) pagado.set(p.tramiteId, (pagado.get(p.tramiteId) ?? 0) + p.valor);
    // Un combo cuenta y se muestra una vez, con sus trámites juntos.
    const combos = nombresDeCombos(datos.tramites, tipo);
    const abiertos = unoPorCombo(datos.tramites.filter((t) => !ESTADOS_TERMINALES.includes(t.estado as EstadoTramite)).sort((x, y) => x.numero - y.numero));
    const atrasados = abiertos.filter((t) => t.fechaEstimadaEntrega && t.fechaEstimadaEntrega < hoy).sort((x, y) => x.fechaEstimadaEntrega!.localeCompare(y.fechaEstimadaEntrega!));
    const recordatorios = datos.recordatorios.filter((r) => r.fecha <= hoy).sort((x, y) => x.fecha.localeCompare(y.fecha) || (x.hora ?? "").localeCompare(y.hora ?? ""));
    const en30 = masDias(hoy, 30);
    const vencimientos = datos.vehiculos.flatMap((v) => ([["SOAT", v.soatVence], ["Técnico-mecánica", v.rtmVence], ["Impuesto", v.impuestoAlDiaHasta]] as const)
      .filter(([, f]) => f && f <= en30 && f >= masDias(hoy, -60))
      .map(([que, f]) => ({ v, que, f: f! })))
      .sort((x, y) => x.f.localeCompare(y.f));
    const licencias = datos.licencias.filter((l) => l.fechaVencimiento >= hoy && l.fechaVencimiento <= masDias(hoy, 60) && l.gestionEstado !== "descartado").sort((x, y) => x.fechaVencimiento.localeCompare(y.fechaVencimiento));
    const cobros = datos.tramites
      .filter((t) => t.estado === "entregado" && t.total > (pagado.get(t.id) ?? 0))
      .map((t) => ({ t, saldo: t.total - (pagado.get(t.id) ?? 0) }))
      .sort((x, y) => y.saldo - x.saldo);
    const tarjetas = unoPorCombo(datos.tramites.filter((t) => t.estado === "entregado" && t.estadoTarjeta === "en_oficina")).sort((x, y) => (y.fechaEntrega ?? y.creado).localeCompare(x.fechaEntrega ?? x.creado));
    const chat = new Map(datos.waChats.map((c) => [c.id, c]));
    const whatsapp = datos.waChats.length ? {
      propuestas: [...datos.waPropuestas].sort((x, y) => y.creado.localeCompare(x.creado)),
      revisar: datos.waChats.filter((c) => c.clasificacion === "dudoso" || c.clasificacion === "personal_propuesto").length,
    } : null;
    return { chat, whatsapp, tipo, combos, cliente, placa, abiertos, atrasados, recordatorios, vencimientos, licencias, cobros, tarjetas, saldo: cobros.reduce((s, c) => s + c.saldo, 0) };
  }, [datos, hoy]);
  return { resumen, hoy };
}
export type Resumen = NonNullable<ReturnType<typeof useResumen>["resumen"]>;
