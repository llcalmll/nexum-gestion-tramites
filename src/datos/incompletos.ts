import { useLiveQuery } from "dexie-react-hooks";
import { datosQueFaltan } from "../../compartido/reglas";
import { db } from "./db";

/**
 * Lo que le falta a cada trámite abierto (de la copia local): id -> ["el comprador", ...]. Solo trae los que tienen
 * algo pendiente. Un combo se mira en todas sus partes (las personas pueden estar en cualquiera).
 */
export function useFaltantes(): Map<string, string[]> {
  return useLiveQuery(async () => {
    const [tramites, tipos, clientes, vehiculos, personas] = await Promise.all([
      db.tramites.toArray(), db.tipos_tramite.toArray(), db.clientes.toArray(), db.vehiculos.toArray(), db.tramite_personas.toArray(),
    ]);
    const tipo = new Map(tipos.map((t) => [t.id, t]));
    const cliente = new Map(clientes.map((c) => [c.id, c]));
    const placa = new Map(vehiculos.map((v) => [v.id, v.placa]));
    const deTramite = new Map<string, { rol: string; nombre: string; numeroDocumento: string }[]>();
    for (const p of personas) {
      const c = cliente.get(p.clienteId);
      deTramite.set(p.tramiteId, [...(deTramite.get(p.tramiteId) ?? []), { rol: p.rol, nombre: c?.nombre ?? "", numeroDocumento: c?.numeroDocumento ?? "" }]);
    }
    // Las personas de un combo cuentan para todas sus partes.
    const delEncargo = new Map<string, string[]>();
    for (const t of tramites) if (t.encargoId) delEncargo.set(t.encargoId, [...(delEncargo.get(t.encargoId) ?? []), t.id]);
    const salida = new Map<string, string[]>();
    for (const t of tramites) {
      if (t.borrador) continue;
      const ids = t.encargoId ? delEncargo.get(t.encargoId) ?? [t.id] : [t.id];
      const falta = datosQueFaltan(t, tipo.get(t.tipoId), cliente.get(t.titularId), ids.flatMap((id) => deTramite.get(id) ?? []), t.vehiculoId ? placa.get(t.vehiculoId) ?? null : undefined);
      if (falta.length) salida.set(t.id, falta);
    }
    return salida;
  }, []) ?? new Map();
}

/** "Falta el comprador y la fecha de nacimiento". */
export const textoFaltan = (f: string[]) => `Falta ${f.length > 1 ? `${f.slice(0, -1).join(", ")} y ${f.at(-1)}` : f[0]}`;
