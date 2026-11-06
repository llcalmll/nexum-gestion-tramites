import { codigoTramite, ESTADOS_TERMINALES, type EstadoTramite, normalizar } from "../../compartido/dominio";
import type { Cliente, Organismo, TipoTramite, Tramite, Vehiculo } from "../../compartido/tipos";

/**
 * Dónde está cada trámite activo, para la pantalla Mapa: en la oficina (recibidos de vehículos o de personas,
 * corrección, ya salió con el documento por entregar), en el tránsito de Ibagué o en el de otra ciudad. Lo finalizado
 * y lo cancelado no sale en el mapa (queda en el histórico).
 */
export type Zona = "vehiculos" | "personas" | "correccion" | "salida" | "transito" | "fuera";
export type Tono = "rojo" | "ambar" | "normal";
/** El estado de un trámite activo como en las luces de la tabla (LucesEstado): los colores de los puntos del mapa. */
export type Luz = "recibido" | "transito" | "correccion" | "salio";
/** En el orden del flujo (el de las luces). */
export const LUCES_MAPA: Luz[] = ["recibido", "transito", "correccion", "salio"];
/** Los mismos colores de las luces (iguales en claro y oscuro). */
export const HEX_LUZ: Record<Luz, string> = { recibido: "#7d8899", transito: "#2f5bea", correccion: "#e5484d", salio: "#4f5bd5" };
export const NOMBRE_LUZ: Record<Luz, string> = { recibido: "Recibido", transito: "En tránsito", correccion: "Requiere corrección", salio: "Ya salió" };
/**
 * Las academias de conducción de Ibagué con las que se trabaja: se reconocen por el aliado del trámite, escrito a mano
 * de varias formas ("JYG", "JGY", "ACADEMIA (DOÑA GLORIA)"; "MOTORLAND", "ACADEMIA MOTORLAN", "ACADEMIA (PROFE ANTONIO)":
 * el profe Antonio es de Motorland, dijo Felipe el 23/10/2026). Las demás academias (Leidy, señor Luis) no van.
 */
export const ACADEMIAS = [
  { clave: "jyg", nombre: "Academia JYG", detalle: "Doña Gloria", patron: /\bj ?y ?g\b|\bjgy\b|gloria/ },
  { clave: "motorland", nombre: "Academia Motorland", detalle: "", patron: /motorlan|profe antonio/ },
] as const;
export type Academia = (typeof ACADEMIAS)[number]["clave"];
export const academiaDe = (aliado: string | null | undefined): Academia | null => {
  const n = normalizar(aliado);
  return n ? ACADEMIAS.find((a) => a.patron.test(n))?.clave ?? null : null;
};
/** Si sigue abierto ("Ya salió" ya está finalizado: falta entregar el documento, y sigue activo en el mapa). */
export const abierta = (c: Carpeta) => c.luz !== "salio";

export interface Carpeta {
  id: string;
  codigo: string;
  tipo: string;
  titular: string;
  placa: string;
  zona: Zona;
  /** Su estado (el color de su punto). */
  luz: Luz;
  tono: Tono;
  entrega: string | null;
  /** La academia de conducción con la que va (por su aliado), si es una de ACADEMIAS. */
  academia?: Academia | null;
  /** La categoría de su tipo (vehiculo, licencia...): las licencias no cuentan en los puntos de Colombia. */
  categoria?: string;
  /** Las categorías, si es de licencia ("B1,C1"). */
  categorias?: string | null;
  /** La ciudad del organismo si no es Ibagué. El mapa la pone allá solo si está en ese tránsito o ya se cerró. */
  ciudad: string | null;
  departamento: string | null;
  /** El color del semáforo del trámite (lo pone la pantalla; si no, se usa el tono por la fecha). */
  semaforo?: "rojo" | "amarillo" | "azul" | "morado" | "verde" | "vino";
  /** Lo demás que pone la pantalla para leer la carpeta de un vistazo: */
  /** el porqué del semáforo; */
  motivo?: string;
  /** los días que le quedan, en texto ("+3 d" atrasado, "hoy", "5 d") y su clase (r rojo, a ámbar, m morado); */
  dias?: { texto: string; clase: "" | "r" | "a" | "m" } | null;
  /** lo consumido del plazo (de la creación a la entrega estimada) y su color, para la tira de tiempo; */
  tiempo?: { frac: number; color: "azul" | "ambar" | "rojo" } | null;
  /** las casillas hechas de las que aplican (solo en Recibido), para la tira de precondiciones; */
  pre?: { hechas: number; total: number; faltan: string[] } | null;
  /** días esperando en el tránsito (desde que se radicó) y lo que falta por cobrar. */
  espera?: number;
  saldo?: number;
  /** La nota destacada del trámite (de la bitácora; en un combo, la de cualquiera de sus partes), si tiene. */
  nota?: { descripcion: string | null; fecha: string } | null;
  /** creado y entrega estimada (para "Día X de Y"). */
  creado?: string;
}

/** Un municipio: [nombre, departamento, longitud, latitud] (public/mapa/colombia.json). */
export type Municipio = [string, string, number, number];
export interface Geo {
  fuentes: string;
  pais: [number, number][][];
  departamentos: { nombre: string; anillos: [number, number][][] }[];
  municipios: Municipio[];
}

const OFICINA = "ibague";
const sumarDias = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00`).getTime() + n * 10_000_000).toISOString().slice(0, 10);

export function carpetas(
  d: { tramites: Tramite[]; tipos: TipoTramite[]; clientes: Cliente[]; vehiculos: Vehiculo[]; organismos: Organismo[] },
  hoy: string,
): Carpeta[] {
  const tipo = new Map(d.tipos.map((t) => [t.id, t]));
  const cliente = new Map(d.clientes.map((c) => [c.id, c]));
  const vehiculo = new Map(d.vehiculos.map((v) => [v.id, v]));
  const organismo = new Map(d.organismos.map((o) => [o.id, o]));
  // Un combo (encargo) es una sola carpeta, con el código y los trámites de todos (los cancelados, aparte).
  const combos = new Map<string, Tramite[]>();
  const claveCombo = (t: Tramite) => `${t.encargoId}|${t.estado === "cancelado" ? "x" : ""}`;
  for (const t of d.tramites) if (t.encargoId) combos.set(claveCombo(t), [...(combos.get(claveCombo(t)) ?? []), t].sort((a, b) => a.numero - b.numero));
  const partesDe = (t: Tramite) => (t.encargoId ? combos.get(claveCombo(t)) ?? [t] : [t]);
  const terminal = (t: Tramite) => ESTADOS_TERMINALES.includes(t.estado as EstadoTramite);
  // El combo lo representa su primera parte abierta (si ya no hay, la primera).
  const representa = (t: Tramite) => { const ps = partesDe(t); return (ps.find((x) => !terminal(x)) ?? ps[0]).id === t.id; };
  const pronto = sumarDias(hoy, 2);
  const luzDe = (t: Tramite): Luz | null =>
    t.estado === "en_preparacion" ? "recibido"
    : t.estado === "en_tramite" ? "transito"
    : t.estado === "requiere_correccion" ? "correccion"
    : t.estado === "listo_para_entrega" ? "salio"
    : t.estado === "entregado" && t.estadoTarjeta && t.estadoTarjeta !== "entregada" ? "salio"
    // Lo finalizado (y entregado) y lo cancelado ya no está activo: no sale.
    : null;
  return d.tramites
    .filter((t) => !t.borrador && luzDe(t) && representa(t))
    .map((t) => {
      const tp = tipo.get(t.tipoId);
      const org = t.organismoId ? organismo.get(t.organismoId) : undefined;
      const local = !org?.ciudad || normalizar(org.ciudad) === OFICINA;
      const luz = luzDe(t)!;
      const zona: Zona =
        // En corrección sigue activo en su tránsito: el de otra ciudad sale allá (como en tránsito); el de Ibagué, en la oficina.
        luz === "correccion" ? (local ? "correccion" : "fuera")
        : luz === "salio" || t.estadoTarjeta === "en_oficina" ? "salida"
        : luz === "transito" ? (local ? "transito" : "fuera")
        : tp?.categoria === "vehiculo" ? "vehiculos" : "personas";
      const entrega = t.fechaEstimadaEntrega ?? null;
      return {
        id: t.id,
        codigo: codigoTramite(t),
        tipo: partesDe(t).map((x) => tipo.get(x.tipoId)?.nombre ?? "").join(" + "),
        titular: cliente.get(t.titularId)?.nombre ?? "",
        placa: t.vehiculoId ? vehiculo.get(t.vehiculoId)?.placa ?? "" : "",
        zona,
        luz,
        academia: academiaDe(t.aliado),
        categoria: tp?.categoria,
        categorias: tp?.categoria === "licencia" ? t.detalle ?? null : null,
        tono: !terminal(t) && entrega && entrega < hoy ? "rojo" : !terminal(t) && entrega && entrega <= pronto ? "ambar" : "normal",
        entrega,
        ciudad: local ? null : org?.ciudad ?? null,
        departamento: local ? null : org?.departamento ?? null,
      } satisfies Carpeta;
    });
}

/**
 * El municipio de una ciudad escrita a mano ("Dos Quebradas", "Mariquita", "Bogotá"): igual sin tildes; si no, igual sin
 * espacios; si no, el único cuyo nombre la contiene como palabra ("San Sebastián de Mariquita"). Con el departamento,
 * solo entre los de ese departamento. Si quedan varios (Mosquera de Cundinamarca y de Nariño), no se adivina: null.
 */
export function ubicar(municipios: Municipio[], ciudad: string, departamento?: string | null): { municipio: Municipio | null; dudosa: boolean } {
  const n = normalizar(ciudad).replace(/[.,]/g, "");
  const dep = departamento ? normalizar(departamento) : null;
  const lista = dep ? municipios.filter((m) => normalizar(m[1]).includes(dep) || dep.includes(normalizar(m[1]))) : municipios;
  const sinEsp = (s: string) => s.replace(/\s+/g, "");
  const nm = (m: Municipio) => normalizar(m[0]).replace(/[.,]/g, "");
  for (const prueba of [(m: Municipio) => nm(m) === n, (m: Municipio) => sinEsp(nm(m)) === sinEsp(n), (m: Municipio) => new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(nm(m))]) {
    const r = lista.filter(prueba);
    if (r.length === 1) return { municipio: r[0], dudosa: false };
    if (r.length > 1) return { municipio: null, dudosa: true };
  }
  return { municipio: null, dudosa: false };
}

/** Grupos de trámites para el resumen de una ciudad (el globo del mapa): por el nombre del trámite. */
export type Grupo = "traspaso" | "licencia" | "prenda" | "duplicado" | "traslado" | "cambio" | "otro";
export const NOMBRE_GRUPO: Record<Grupo, [string, string]> = {
  traspaso: ["Traspaso", "Traspasos"], licencia: ["Licencia de conducción", "Licencias de conducción"], prenda: ["Prenda o embargo", "Prendas y embargos"],
  duplicado: ["Duplicado", "Duplicados"], traslado: ["Traslado o radicación", "Traslados y radicaciones"],
  cambio: ["Cambio (color, motor, servicio...)", "Cambios (color, motor, servicio...)"], otro: ["Otro", "Otros"],
};
export function grupoDe(tipo: string): Grupo {
  const t = normalizar(tipo);
  if (t.includes("traspaso")) return "traspaso";
  if (/licencia|refrendac|recategoriz/.test(t) && !t.includes("licencia de transito")) return "licencia";
  if (/prenda|embargo|cautelar/.test(t)) return "prenda";
  if (t.includes("duplicado")) return "duplicado";
  if (/traslado|radicacion/.test(t)) return "traslado";
  if (/cambio|regrabac|transformac|blindaje/.test(t)) return "cambio";
  return "otro";
}
/** Cuántos trámites de cada grupo hay (de mayor a menor) y cuántos atrasados. */
export function resumen(lista: Carpeta[]): { grupos: { grupo: Grupo; n: number }[]; atrasados: number; porTipo: [string, number][] } {
  const g = new Map<Grupo, number>(), t = new Map<string, number>();
  for (const c of lista) {
    g.set(grupoDe(c.tipo), (g.get(grupoDe(c.tipo)) ?? 0) + 1);
    t.set(c.tipo, (t.get(c.tipo) ?? 0) + 1);
  }
  return {
    grupos: [...g].map(([grupo, n]) => ({ grupo, n })).sort((a, b) => b.n - a.n),
    atrasados: lista.filter((c) => c.tono === "rojo").length,
    porTipo: [...t].sort((a, b) => b[1] - a[1]),
  };
}
