import { useLiveQuery } from "dexie-react-hooks";
import { codigoTramite, ESTADO_TRAMITE_LABEL, type EstadoTramite, etiquetaTramite, normalizar, ROL_PERSONA_LABEL, type RolPersona } from "../../compartido/dominio";
import type { Cliente, Organismo, TipoTramite, Tramite, Vehiculo } from "../../compartido/tipos";
import { db } from "./db";

/**
 * Buscar un trámite por cualquier dato: su código, el tipo, el titular y todas sus personas (con cédula y teléfono),
 * la placa y los datos del vehículo (VIN, motor, chasis, serie, licencia de tránsito...), la ciudad, el aliado, las
 * observaciones y la bitácora. Cada palabra puede estar en cualquier parte ("maria ruiz"), y los puntos, espacios y
 * guiones no cuentan ("1.110.456.789", "abc-123"). Dice en qué dato lo encontró cuando no se ve en la fila.
 */

/** Un dato del trámite: `visible` si ya se ve en la fila (no hace falta decir que se encontró ahí). */
export interface Campo { etiqueta: string; valor: string; visible?: boolean }
export interface Indice { texto: string; compacto: string; campos: (Campo & { norm: string; compacto: string })[] }
export interface Pista { etiqueta: string; texto: string }

const compactar = (s: string) => s.replace(/[^a-z0-9]/g, "");

/** Las palabras de lo que se busca (sin tildes ni mayúsculas). */
export const palabras = (q: string) => normalizar(q).split(/\s+/).filter(Boolean);

export function indexar(campos: Campo[]): Indice {
  const cs = campos.filter((c) => c.valor && String(c.valor).trim()).map((c) => { const norm = normalizar(c.valor); return { ...c, valor: String(c.valor), norm, compacto: compactar(norm) }; });
  const texto = cs.map((c) => c.norm).join(" | ");
  return { texto, compacto: cs.map((c) => c.compacto).join("|"), campos: cs };
}

const esta = (en: { norm?: string; texto?: string; compacto: string }, p: string) => {
  const t = en.norm ?? en.texto ?? "";
  const cp = compactar(p);
  return t.includes(p) || (cp.length >= 3 && en.compacto.includes(cp));
};

/** ¿Están todas las palabras? Y si alguna solo está en un dato que no se ve en la fila, cuál (con un pedazo del texto). */
export function coincide(ind: Indice, ps: string[]): { ok: boolean; pista: Pista | null } {
  if (!ps.length) return { ok: true, pista: null };
  if (!ps.every((p) => esta(ind, p))) return { ok: false, pista: null };
  const ocultas = ps.filter((p) => !ind.campos.some((c) => c.visible && esta(c, p)));
  const campo = ocultas.length ? ind.campos.find((c) => !c.visible && ocultas.some((p) => esta(c, p))) : undefined;
  if (!campo) return { ok: true, pista: null };
  // Un pedazo alrededor de lo encontrado (para las notas largas).
  const p = ocultas.find((x) => campo.norm.includes(x)) ?? "";
  const i = p ? campo.norm.indexOf(p) : 0;
  const texto = campo.valor.length <= 60 ? campo.valor : `${i > 25 ? "…" : ""}${campo.valor.slice(Math.max(0, i - 25), i + 35)}${i + 35 < campo.valor.length ? "…" : ""}`;
  return { ok: true, pista: { etiqueta: campo.etiqueta, texto } };
}

/** Lo que la búsqueda necesita además de trámites, clientes y vehículos: las personas de cada trámite y su bitácora. */
export function useDatosBusqueda() {
  return useLiveQuery(async () => {
    const [personas, bitacora] = await Promise.all([db.tramite_personas.toArray(), db.bitacora.toArray()]);
    const porTramite = new Map<string, { clienteId: string; rol: string }[]>();
    for (const p of personas) porTramite.set(p.tramiteId, [...(porTramite.get(p.tramiteId) ?? []), { clienteId: p.clienteId, rol: p.rol }]);
    const notas = new Map<string, string[]>();
    for (const b of bitacora) if (b.descripcion) notas.set(b.tramiteId, [...(notas.get(b.tramiteId) ?? []), b.descripcion]);
    return { personas: porTramite, notas };
  }, []);
}

interface Contexto {
  cliente: Map<string, Cliente>;
  vehiculo: Map<string, Vehiculo>;
  tipo: Map<string, TipoTramite>;
  ciudad: Map<string, Organismo["ciudad"]>;
  extra?: { personas: Map<string, { clienteId: string; rol: string }[]>; notas: Map<string, string[]> };
  faltaInfo?: (id: string) => boolean;
}

/** Todos los datos de un trámite (o de todas las partes de un combo) para buscarlo. */
export function camposDeTramite(partes: Tramite[], cx: Contexto): Campo[] {
  const t = partes[0];
  const titular = cx.cliente.get(t.titularId);
  const v = t.vehiculoId ? cx.vehiculo.get(t.vehiculoId) : undefined;
  const campos: Campo[] = [
    { etiqueta: "Número", valor: [codigoTramite(t), ...partes.map((x) => `${etiquetaTramite(x.numero, x.creado, x.serie)} ${x.numero}`)].join(" "), visible: true },
    { etiqueta: "Trámite", valor: partes.map((x) => cx.tipo.get(x.tipoId)?.nombre ?? "").join(" "), visible: true },
    { etiqueta: "Titular", valor: titular?.nombre ?? "", visible: true },
    { etiqueta: "Placa", valor: v?.placa ?? "", visible: true },
    { etiqueta: "Ciudad", valor: (t.organismoId ? cx.ciudad.get(t.organismoId) : "") ?? "", visible: true },
    { etiqueta: "Cédula del titular", valor: titular?.numeroDocumento ?? "" },
    { etiqueta: "Teléfono del titular", valor: titular?.telefono ?? "" },
    { etiqueta: "Dirección", valor: titular?.direccion ?? "" },
    { etiqueta: "Estado", valor: partes.map((x) => ESTADO_TRAMITE_LABEL[x.estado as EstadoTramite] ?? x.estado).join(" ") },
    { etiqueta: "Categorías", valor: partes.map((x) => x.detalle ?? "").join(" ") },
    { etiqueta: "Aliado", valor: partes.map((x) => x.aliado ?? "").join(" ") },
    { etiqueta: "Observaciones", valor: partes.map((x) => x.observaciones ?? "").join(" ") },
  ];
  if (v) campos.push(
    { etiqueta: "VIN", valor: v.vin ?? "" }, { etiqueta: "Motor", valor: v.numeroMotor ?? "" }, { etiqueta: "Chasis", valor: v.numeroChasis ?? "" },
    { etiqueta: "Serie", valor: v.numeroSerie ?? "" }, { etiqueta: "Licencia de tránsito", valor: v.licenciaTransito ?? "" },
    { etiqueta: "Vehículo", valor: [v.marca, v.linea, v.modelo, v.color, v.clase].filter(Boolean).join(" ") },
  );
  for (const x of partes) {
    for (const p of cx.extra?.personas.get(x.id) ?? []) {
      const c = cx.cliente.get(p.clienteId);
      if (!c) continue;
      const rol = ROL_PERSONA_LABEL[p.rol as RolPersona] ?? p.rol;
      campos.push({ etiqueta: rol, valor: [c.nombre, c.numeroDocumento ? `CC ${c.numeroDocumento}` : "", c.telefono ? `tel. ${c.telefono}` : ""].filter(Boolean).join(" · ") });
    }
    for (const n of cx.extra?.notas.get(x.id) ?? []) campos.push({ etiqueta: "Bitácora", valor: n });
  }
  if (partes.some((x) => cx.faltaInfo?.(x.id))) campos.push({ etiqueta: "Etiqueta", valor: "falta info incompleta", visible: true });
  return campos;
}
