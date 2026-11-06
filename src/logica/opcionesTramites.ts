import { useLiveQuery } from "dexie-react-hooks";
import { codigoTramite, ESTADOS_TERMINALES, type EstadoTramite, normalizar } from "../../compartido/dominio";
import type { OpcionBuscador } from "../componentes/formulario";
import { db } from "../datos/db";
import { nombresDeCombos, unoPorCombo } from "./combos";

/*
 * Un solo buscador para elegir un trámite o una licencia (Envíos, el Escáner...): lo que se reconoce primero va en
 * negrilla. En los de vehículo, la placa; en los de licencia (no tienen placa), el nombre de la persona. Debajo, el
 * código, el trámite (con las categorías, en licencias) y el cliente o la cédula. Se busca por cualquiera de esas cosas
 * (y "licencia" trae solo las licencias). Un combo sale una sola vez, con sus trámites juntos.
 */
export function useOpcionesTramites({ soloAbiertos = false, limite = 600 }: { soloAbiertos?: boolean; limite?: number } = {}): OpcionBuscador[] | undefined {
  return useLiveQuery(async () => {
    const [tramites, clientes, vehiculos, tipos] = await Promise.all([db.tramites.toArray(), db.clientes.toArray(), db.vehiculos.toArray(), db.tipos_tramite.toArray()]);
    const cli = new Map(clientes.map((c) => [c.id, c])), placa = new Map(vehiculos.map((v) => [v.id, v.placa])), tipo = new Map(tipos.map((t) => [t.id, t]));
    const combos = nombresDeCombos(tramites, new Map(tipos.map((t) => [t.id, t.nombre])));
    const cerrado = (t: { estado: string }) => ESTADOS_TERMINALES.includes(t.estado as EstadoTramite);
    const lista = unoPorCombo(tramites
      .filter((t) => !t.borrador && (!soloAbiertos || !cerrado(t)))
      // Los abiertos primero; después, los más nuevos.
      .sort((a, b) => Number(cerrado(a)) - Number(cerrado(b)) || b.creado.localeCompare(a.creado)))
      .slice(0, limite);
    return lista.map((t) => {
      const tp = tipo.get(t.tipoId), c = cli.get(t.titularId);
      const nombreTramite = (t.encargoId && combos.get(t.encargoId)) || tp?.nombre || "";
      const codigo = codigoTramite(t), cliente = c?.nombre ?? "";
      if (tp?.categoria === "licencia") {
        const cats = (t.detalle ?? "").split(",").filter(Boolean).join(", ");
        return {
          id: t.id, titulo: cliente || codigo,
          detalle: [codigo, `${nombreTramite}${cats ? ` ${cats}` : ""}`, c?.numeroDocumento && `CC ${c.numeroDocumento}`, cerrado(t) && "cerrado"].filter(Boolean).join(" · "),
          busqueda: normalizar(`${codigo} ${t.numero} ${cliente} ${c?.numeroDocumento ?? ""} ${nombreTramite} ${cats} licencia`),
        };
      }
      const p = t.vehiculoId ? placa.get(t.vehiculoId) ?? "" : "";
      return {
        id: t.id, titulo: p || codigo,
        detalle: [p && codigo, nombreTramite, cliente, cerrado(t) && "cerrado"].filter(Boolean).join(" · "),
        busqueda: normalizar(`${codigo} ${t.numero} ${p} ${cliente} ${c?.numeroDocumento ?? ""} ${nombreTramite}`),
      };
    });
  }, [soloAbiertos, limite]);
}
