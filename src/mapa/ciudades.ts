import { codigoTramite, type EstadoTramite, normalizar } from "../../compartido/dominio";
import type { Cliente, Organismo, Pago, TipoTramite, Tramite, Vehiculo } from "../../compartido/tipos";
import { abierta, type Academia, ACADEMIAS, academiaDe, type Carpeta, carpetas, type Geo, ubicar } from "./lugares";

/**
 * Las ciudades del mapa: todas en las que se ha hecho algún trámite (por el organismo de tránsito), más las de los
 * tramitadores de Envíos, cada una con sus números. Los trámites sin organismo cuentan en Ibagué (son de la oficina).
 */
export interface Estadistica {
  abiertos: number;
  atrasados: number;
  porVencer: number;
  /** Radicados en el tránsito (esperando). */
  transito: number;
  /** Todos los trámites que ha tenido la ciudad (sin los cancelados). */
  historico: number;
  finalizados: number;
  finMes: number;
  /** Lo que falta por cobrar (valor menos pagos) de sus trámites finalizados (lo de los abiertos se cobra al entregar). */
  porCobrar: number;
  ultimo: string | null;
}
/** Un trámite del histórico de la ciudad (todos: abiertos, finalizados y cancelados). */
export interface TramiteCiudad {
  id: string;
  codigo: string;
  tipo: string;
  estado: EstadoTramite;
  creado: string;
  entrega: string | null;
  cliente: string;
  placa: string;
  aliado: string;
  saldo: number;
}
/** Un tramitador de Envíos para la ciudad: el de la ciudad misma o, si no hay, el que cubre todo su departamento. */
export interface TramitadorZona { nombre: string; telefono: string; direccion: string; ciudad: string; porDepartamento: boolean }
/** Lo que pueden traer los tramitadores de Envíos (param envio_tramitadores). */
export interface TramitadorEnvio { nombre: string; ciudad: string; cubre?: string; telefono?: string; direccion?: string }

export interface CiudadDatos {
  clave: string;
  nombre: string;
  departamento: string;
  lon: number;
  lat: number;
  /** Los trámites activos de esa ciudad (carpetas): los abiertos y los que ya salieron (falta entregar el documento). */
  carpetas: Carpeta[];
  /** Los nombres de sus tramitadores de Envíos (los de `tramitadores`). */
  aliados: string[];
  tramitadores: TramitadorZona[];
  /** Con quién se han hecho sus trámites (el campo "aliado" de cada trámite), del que más al que menos. */
  habituales: { nombre: string; n: number }[];
  tramites: TramiteCiudad[];
  /** Habitantes de la cabecera municipal (DANE, proyección 2026), si se conoce. */
  poblacion?: number;
  /**
   * Los envíos a esta ciudad que se dejaron en el mapa (a un tramitador o directo al cliente): `activo` hasta las 6:30
   * del día siguiente (la vena con pulso); después, gris (constancia de lo que se ha mandado).
   */
  sobres: { id: string; destinatario: string; fechaEnvio: string; activo: boolean }[];
  oficina?: boolean;
  /** Solo en Ibagué: las academias de conducción, con sus trámites en el mapa y sus clientes (de todos sus trámites). */
  academias?: AcademiaMapa[];
  stats: Estadistica;
}
export interface AcademiaMapa {
  clave: Academia;
  nombre: string;
  detalle: string;
  carpetas: Carpeta[];
  /** Los clientes que han venido con ella (el titular de sus trámites), del que más trámites tiene al que menos. */
  clientes: { id: string; nombre: string; n: number }[];
}
export type Capa = "abiertos" | "atrasados" | "historico" | "cobrar" | "aliados";

const vacia = (): Estadistica => ({ abiertos: 0, atrasados: 0, porVencer: 0, transito: 0, historico: 0, finalizados: 0, finMes: 0, porCobrar: 0, ultimo: null });
const nueva = () => ({ sobres: [] as CiudadDatos["sobres"], carpetas: [] as Carpeta[], aliados: [] as string[], tramitadores: [] as TramitadorZona[], habituales: [] as { nombre: string; n: number }[], tramites: [] as TramiteCiudad[], stats: vacia() });
/** Separa una lista escrita a mano: "Funza, Madrid y Mosquera" o "Cundinamarca; Boyacá". */
const partes = (texto: string) => texto.split(/[,;\n]|\s+y\s+/).map((x) => x.trim()).filter(Boolean);
/** El nombre de un aliado para contarlo: sin tildes, sin números ni letras repetidas (JESSICA y JESICA son la misma). */
const claveAliado = (s: string) => normalizar(s).replace(/[^a-z ]/g, "").replace(/(.)\1+/g, "$1").replace(/\s+/g, " ").trim();
const tituloAliado = (s: string) => s.trim().toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());

export function construirCiudades(
  d: { tramites: Tramite[]; tipos: TipoTramite[]; clientes: Cliente[]; vehiculos: Vehiculo[]; organismos: Organismo[]; pagos: Pago[] },
  geo: Geo,
  tramitadores: TramitadorEnvio[],
  hoy: string,
  /** Población urbana (cabecera, DANE 2026) por "Municipio|Departamento", para el tamaño de cada ciudad. */
  poblacion: Record<string, number> = {},
  /** Los envíos dejados en el mapa ("Funza, Cundinamarca"), activos o ya grises. */
  sobres: { id: string; ciudad: string; destinatario: string; fechaEnvio: string; activo: boolean }[] = [],
): { ciudades: CiudadDatos[]; sinUbicar: { ciudad: string; n: number }[]; supuestas: { ciudad: string; departamento: string }[] } {
  const organismo = new Map(d.organismos.map((o) => [o.id, o]));
  const tipo = new Map(d.tipos.map((t) => [t.id, t.nombre]));
  const cliente = new Map(d.clientes.map((c) => [c.id, c.nombre]));
  const placa = new Map(d.vehiculos.map((v) => [v.id, v.placa]));
  const pagado = new Map<string, number>();
  for (const p of d.pagos) pagado.set(p.tramiteId, (pagado.get(p.tramiteId) ?? 0) + p.valor);
  const ib = ubicar(geo.municipios, "Ibagué", "Tolima").municipio;
  const porClave = new Map<string, CiudadDatos>();
  const ibague: CiudadDatos = { clave: "ibague", nombre: "Ibagué", departamento: "Tolima", lon: ib?.[2] ?? -10.000, lat: ib?.[3] ?? 4.438, ...nueva(), oficina: true };
  porClave.set("ibague", ibague);
  const sinUbicar = new Map<string, number>();
  // Ciudades con el nombre repetido en varios departamentos (Florencia, Armenia) y el organismo sin departamento: se
  // ponen en la más poblada y se avisa en el mapa, para que le pongan el departamento al organismo.
  const supuestas = new Map<string, string>();
  const cache = new Map<string, CiudadDatos | null>();
  /** La ciudad de un organismo (o de un texto de ciudad), resuelta en el mapa una sola vez. */
  function ciudadDe(nombre: string | null | undefined, departamento?: string | null): CiudadDatos | null {
    if (!nombre || normalizar(nombre) === "ibague") return ibague;
    const k = `${normalizar(nombre)}|${normalizar(departamento ?? "")}`;
    if (cache.has(k)) return cache.get(k)!;
    const u = ubicar(geo.municipios, nombre, departamento);
    let m = u.municipio;
    if (!m && u.dudosa) {
      const n = normalizar(nombre).replace(/[.,]/g, "");
      const iguales = geo.municipios.filter((x) => normalizar(x[0]).replace(/[.,]/g, "") === n);
      const mayor = iguales.length > 1 ? iguales.reduce((a, b) => ((poblacion[`${b[0]}|${b[1]}`] ?? 0) > (poblacion[`${a[0]}|${a[1]}`] ?? 0) ? b : a)) : null;
      if (mayor && poblacion[`${mayor[0]}|${mayor[1]}`]) { m = mayor; supuestas.set(mayor[0], mayor[1]); }
    }
    let c: CiudadDatos | null = null;
    if (m) {
      const clave = `${normalizar(m[0])}|${normalizar(m[1])}`;
      c = clave.startsWith("ibague|") ? ibague : porClave.get(clave) ?? { clave, nombre: m[0], departamento: m[1], lon: m[2], lat: m[3], ...nueva() };
      porClave.set(c.clave, c);
    }
    cache.set(k, c);
    return c;
  }

  const mes = hoy.slice(0, 7);
  const aliadosDe = new Map<CiudadDatos, Map<string, { nombre: string; n: number }>>();
  for (const t of d.tramites) {
    if (t.borrador) continue;
    const org = t.organismoId ? organismo.get(t.organismoId) : undefined;
    const c = ciudadDe(org?.ciudad, org?.departamento);
    if (!c) { if (t.estado !== "cancelado") { const n = org?.ciudad ?? "sin organismo"; sinUbicar.set(n, (sinUbicar.get(n) ?? 0) + 1); } continue; }
    const saldo = Math.max(0, (t.total ?? 0) - (pagado.get(t.id) ?? 0));
    c.tramites.push({
      id: t.id, codigo: codigoTramite(t), tipo: tipo.get(t.tipoId) ?? "", estado: t.estado as EstadoTramite, creado: t.creado, entrega: t.fechaEntrega ?? null,
      cliente: cliente.get(t.titularId) ?? "", placa: t.vehiculoId ? placa.get(t.vehiculoId) ?? "" : "", aliado: (t.aliado ?? "").trim(), saldo,
    });
    if (t.estado === "cancelado") continue;
    const ka = t.aliado ? claveAliado(t.aliado) : "";
    if (ka) {
      const m = aliadosDe.get(c) ?? new Map<string, { nombre: string; n: number }>();
      const a = m.get(ka) ?? { nombre: tituloAliado(t.aliado!), n: 0 };
      a.n++; m.set(ka, a); aliadosDe.set(c, m);
    }
    const s = c.stats;
    s.historico++;
    if (t.estado === "entregado") { s.finalizados++; if ((t.fechaEntrega ?? "").startsWith(mes)) s.finMes++; }
    if (t.estado === "entregado") s.porCobrar += saldo;
    if (!s.ultimo || t.creado > s.ultimo) s.ultimo = t.creado;
  }
  // Las carpetas (un combo es una sola) van donde está el papel: en la oficina (Ibagué) mientras no se radique; en la
  // ciudad de su organismo cuando está en ese tránsito o en corrección allá (un traspaso de Funza recién recibido sigue
  // en la oficina). Si la ciudad no se ubica (Mosquera sin departamento), Ibagué.
  // Las academias (en Ibagué): sus trámites en el mapa, estén donde estén, y sus clientes de siempre.
  const academias = new Map<Academia, AcademiaMapa>(ACADEMIAS.map((a) => [a.clave, { clave: a.clave, nombre: a.nombre, detalle: a.detalle, carpetas: [], clientes: [] }]));
  const clientesDe = new Map<Academia, Map<string, number>>();
  for (const t of d.tramites) {
    const a = t.borrador ? null : academiaDe(t.aliado);
    if (!a) continue;
    const m = clientesDe.get(a) ?? new Map<string, number>();
    m.set(t.titularId, (m.get(t.titularId) ?? 0) + 1); clientesDe.set(a, m);
  }
  for (const [a, m] of clientesDe) academias.get(a)!.clientes = [...m].map(([id, n]) => ({ id, nombre: cliente.get(id) ?? "", n })).sort((x, y) => y.n - x.n || x.nombre.localeCompare(y.nombre));
  ibague.academias = [...academias.values()];
  for (const cp of carpetas(d, hoy)) {
    if (cp.academia) academias.get(cp.academia)!.carpetas.push(cp);
    const c = (cp.zona === "fuera" && cp.ciudad ? ciudadDe(cp.ciudad, cp.departamento) : null) ?? ibague;
    c.carpetas.push(cp);
    if (!abierta(cp)) continue;
    c.stats.abiertos++;
    if (cp.tono === "rojo") c.stats.atrasados++;
    if (cp.tono === "ambar") c.stats.porVencer++;
    if (cp.zona === "transito" || cp.zona === "fuera") c.stats.transito++;
  }
  for (const [c, m] of aliadosDe) c.habituales = [...m.values()].sort((a, b) => b.n - a.n);
  for (const c of porClave.values()) c.tramites.sort((a, b) => b.creado.localeCompare(a.creado));

  // Los tramitadores de Envíos: cubren lo que dice "Zona que cubre" (municipios o departamentos enteros) o, si no
  // dice nada, la ciudad donde reciben los sobres. El de un departamento vale para sus municipios sin tramitador
  // propio (el de Cundinamarca no tapa al de Bogotá).
  const departamentos = [...new Set(geo.municipios.map((m) => m[1]))];
  /** Un departamento por su nombre exacto o, con `prefijo`, por el comienzo ("Valle" es Valle del Cauca). */
  const departamentoDe = (texto: string, prefijo: boolean) => {
    const n = normalizar(texto).replace(/[.,]/g, "");
    if (n.length < 4) return null;
    return departamentos.find((d) => normalizar(d).replace(/[.,]/g, "") === n) ?? (prefijo ? departamentos.find((d) => normalizar(d).startsWith(`${n} `)) : undefined) ?? null;
  };
  const porDepartamento = new Map<string, TramitadorZona[]>();
  const agregar = (c: CiudadDatos, z: TramitadorZona) => {
    if (c.tramitadores.some((x) => x.nombre === z.nombre)) return;
    c.tramitadores.push(z); c.aliados.push(z.nombre);
  };
  for (const t of tramitadores) {
    if (!t.nombre?.trim() || !t.ciudad) continue;
    const ciudadSobre = t.ciudad.split(",")[0]?.trim() ?? "", depSobre = t.ciudad.split(",")[1]?.trim() || null;
    const z: TramitadorZona = { nombre: t.nombre.trim(), telefono: t.telefono ?? "", direccion: t.direccion ?? "", ciudad: t.ciudad.trim(), porDepartamento: false };
    const cubre = t.cubre?.trim() ?? "";
    // Primero el departamento con el nombre exacto, luego el municipio ("Bogotá" es la ciudad) y al final el
    // departamento por su comienzo.
    for (const parte of cubre ? partes(cubre) : [ciudadSobre]) {
      const exacto = cubre ? departamentoDe(parte, false) : null;
      const c = exacto ? null : ciudadDe(parte, depSobre);
      const dep = exacto ?? (!c && cubre ? departamentoDe(parte, true) : null);
      if (dep) porDepartamento.set(dep, [...(porDepartamento.get(dep) ?? []), { ...z, porDepartamento: true }]);
      else if (c) agregar(c, z);
    }
  }
  for (const c of porClave.values()) {
    if (c.tramitadores.length) continue;
    for (const z of porDepartamento.get(c.departamento) ?? []) agregar(c, z);
  }
  // La ciudad del sobre se escribe a mano: "Funza, Cundinamarca", "BOGOTÁ CUNDINAMARCA" (sin coma) o con un
  // departamento que no es el del municipio (Bogotá no es de Cundinamarca en el DANE): se prueba de esas maneras.
  const ciudadDelSobre = (texto: string) => {
    const [nombre, dep] = [texto.split(",")[0].trim(), texto.split(",")[1]?.trim() || null];
    const conDep = dep ? ciudadDe(nombre, dep) : null;
    if (conDep) return conDep;
    const n = normalizar(nombre);
    const d = dep ? null : departamentos.find((x) => n.endsWith(` ${normalizar(x)}`));
    return (d ? ciudadDe(nombre.slice(0, nombre.length - d.length).trim(), d) ?? ciudadDe(nombre.slice(0, nombre.length - d.length).trim()) : null) ?? ciudadDe(nombre);
  };
  for (const s of sobres) {
    const c = ciudadDelSobre(s.ciudad);
    if (c && !c.oficina) c.sobres.push({ id: s.id, destinatario: s.destinatario, fechaEnvio: s.fechaEnvio, activo: s.activo });
  }
  for (const c of porClave.values()) { c.poblacion = poblacion[`${c.nombre}|${c.departamento}`]; c.sobres.sort((a, b) => Number(b.activo) - Number(a.activo) || b.fechaEnvio.localeCompare(a.fechaEnvio)); }
  const ciudades = [...porClave.values()].filter((c) => c.oficina || c.tramites.length || c.sobres.length || c.tramitadores.some((z) => !z.porDepartamento));
  return { ciudades, sinUbicar: [...sinUbicar].map(([ciudad, n]) => ({ ciudad, n })).sort((a, b) => b.n - a.n), supuestas: [...supuestas].map(([ciudad, departamento]) => ({ ciudad, departamento })) };
}

/** El número de una ciudad según la capa que se está viendo. */
export function valorCapa(c: CiudadDatos, capa: Capa): number {
  return capa === "abiertos" ? c.stats.abiertos : capa === "atrasados" ? c.stats.atrasados : capa === "historico" ? c.stats.historico : capa === "cobrar" ? c.stats.porCobrar : c.aliados.length;
}
