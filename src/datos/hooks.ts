import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { normalizar } from "../../compartido/dominio";
import type { OpcionBuscador } from "../componentes/formulario";
import { db } from "./db";

/** Clientes como opciones del buscador (nombre, documento y teléfono). */
export function useOpcionesClientes(): OpcionBuscador[] {
  const clientes = useLiveQuery(() => db.clientes.toArray(), []);
  return useMemo(
    () => (clientes ?? [])
      .map((c) => ({ id: c.id, titulo: c.nombre, detalle: [c.numeroDocumento ? `${c.tipoDocumento} ${c.numeroDocumento}` : "Sin documento", c.telefono].filter(Boolean).join(" · "), busqueda: c.busqueda || normalizar(c.nombre, c.numeroDocumento, c.telefono) }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "es")),
    [clientes],
  );
}

/** Vehículos como opciones del buscador; los del titular indicado van primero. */
export function useOpcionesVehiculos(titularId?: string | null): OpcionBuscador[] {
  const vehiculos = useLiveQuery(() => db.vehiculos.toArray(), []);
  return useMemo(
    () => (vehiculos ?? [])
      .map((v) => ({ id: v.id, titulo: v.placa, detalle: [v.marca, v.linea, v.modelo].filter(Boolean).join(" ") || undefined, busqueda: v.busqueda || normalizar(v.placa, v.marca, v.linea), propio: v.titularId === titularId }))
      .sort((a, b) => Number(b.propio) - Number(a.propio) || a.titulo.localeCompare(b.titulo)),
    [vehiculos, titularId],
  );
}

export const useParametros = () => {
  const filas = useLiveQuery(() => db.parametros.toArray(), []);
  return useMemo(() => Object.fromEntries((filas ?? []).map((p) => [p.clave, p.valor])) as Record<string, string>, [filas]);
};

export const useOrganismos = () => useLiveQuery(() => db.organismos.orderBy("id").toArray().then((o) => o.filter((x) => x.activo).sort((a, b) => (a.ciudad ?? a.nombre).localeCompare(b.ciudad ?? b.nombre, "es"))), []) ?? [];
export const useTipos = () => useLiveQuery(() => db.tipos_tramite.toArray().then((t) => t.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"))), []) ?? [];
