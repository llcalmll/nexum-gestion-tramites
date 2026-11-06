/*
 * Reglas del negocio, puras (sin base ni red). Las usan la API para hacerlas cumplir
 * y la app para mostrarlas, así nunca dicen cosas distintas.
 */
import {
  CATEGORIAS_LICENCIA, normalizar, PRECONDICION_DESDE_VEHICULO, PRECONDICION_LABEL, PRECONDICIONES,
  type EstadoPago, type Gravamen, type Precondicion, type PrecondicionEstado,
} from "./dominio";
import { precioLicencia } from "./preciosLicencia";

// ─── Fechas ──────────────────────────────────────────────────────────────────

/** Hoy en Colombia, "AAAA-MM-DD". */
export const hoyColombia = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

const aFecha = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`);
const deFecha = (d: Date) => d.toISOString().slice(0, 10);

export const esFecha = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(aFecha(s).getTime());

/** Suma días hábiles (lunes a viernes). Los festivos no se descuentan: la fecha es una propuesta editable. */
export function sumarDiasHabiles(desde: string, dias: number): string {
  const d = aFecha(desde);
  let quedan = dias;
  while (quedan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) quedan--;
  }
  return deFecha(d);
}

export function sumarDias(desde: string, dias: number): string {
  const d = aFecha(desde);
  d.setUTCDate(d.getUTCDate() + dias);
  return deFecha(d);
}

// ─── Precondiciones ──────────────────────────────────────────────────────────

export interface VehiculoParaReglas {
  soatVence: string | null;
  rtmVence: string | null;
  impuestoAlDiaHasta: string | null;
  gravamenes: Gravamen[];
}

export interface EstadoPrecondicion {
  flag: Precondicion;
  nombre: string;
  ok: boolean;
  /** "vehiculo": sale de los datos del vehículo; "manual": la marca Felipe. */
  fuente: "vehiculo" | "manual";
  /** Explicación corta: "SOAT vence 2026-12-01", "Sin dato en el vehículo", "Marcada a mano"... */
  detalle: string;
  /** Marcada a mano aunque el dato del vehículo no la cumpla (por ejemplo, vehículo nuevo exento de RTM). */
  forzada: boolean;
  nota?: string;
}

/** Precondiciones que aplican a un tipo de trámite. La RNMC solo si el parámetro rnmc_activo está en "true". */
export function precondicionesAplicables(tipo: { precondiciones: Partial<Record<Precondicion, boolean>> }, rnmcActivo: boolean): Precondicion[] {
  return PRECONDICIONES.filter((p) => tipo.precondiciones[p] && (p !== "sin_medidas_rnmc" || rnmcActivo));
}

/**
 * Estado de cada precondición del trámite. Las que dependen del vehículo se calculan con sus datos
 * de HOY (no con una copia del momento de crear el trámite); una marca manual las puede forzar.
 */
export function evaluarPrecondiciones(
  tipo: { precondiciones: Partial<Record<Precondicion, boolean>> },
  manuales: Partial<Record<Precondicion, PrecondicionEstado>>,
  vehiculo: VehiculoParaReglas | null,
  hoy: string,
  rnmcActivo: boolean,
): EstadoPrecondicion[] {
  return precondicionesAplicables(tipo, rnmcActivo).map((flag) => {
    const manual = manuales[flag] ?? {};
    const campo = PRECONDICION_DESDE_VEHICULO[flag];
    const base = { flag, nombre: PRECONDICION_LABEL[flag], nota: manual.nota };
    if (!campo) {
      return { ...base, ok: !!manual.ok, fuente: "manual" as const, forzada: false, detalle: manual.ok ? `Marcada${manual.fecha ? ` el ${manual.fecha}` : ""}` : "Pendiente" };
    }
    let okVehiculo = false;
    let detalle = "Sin vehículo";
    if (vehiculo) {
      if (campo === "gravamenes") {
        okVehiculo = vehiculo.gravamenes.length === 0;
        detalle = okVehiculo ? "Sin gravámenes registrados" : `Tiene ${vehiculo.gravamenes.length} gravamen(es)`;
      } else {
        const fecha = vehiculo[campo];
        okVehiculo = !!fecha && fecha >= hoy;
        detalle = !fecha ? "Sin dato en el vehículo" : okVehiculo ? `Vigente hasta ${fecha}` : `Vencido el ${fecha}`;
      }
    }
    const forzada = !okVehiculo && !!manual.ok;
    return { ...base, ok: okVehiculo || !!manual.ok, fuente: "vehiculo" as const, forzada, detalle: forzada ? `${detalle} (marcada a mano)` : detalle };
  });
}

export const faltantes = (estados: EstadoPrecondicion[]) => estados.filter((e) => !e.ok);

// ─── Costos (cálculo interno al crear el trámite) ───────────────────────────

export interface TarifaParaReglas {
  tipoTramiteId: string;
  organismoId: string | null;
  derechosTransito: number;
  componenteRunt: number;
  estampillas: number;
  pazSalvo: number;
  honorarios: number;
  vigenteDesde: string | null;
}
export type TramoImpuesto = { hasta?: number; pct: number };

export function leerTramos(texto: string | null | undefined): TramoImpuesto[] {
  try {
    const t = JSON.parse(texto ?? "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x?.pct === "number") : [];
  } catch {
    return [];
  }
}

export interface CostosSugeridos {
  costoDerechos: number;
  honorarios: number;
  /** Líneas para mostrar de dónde sale cada valor. */
  lineas: { concepto: string; valor: number }[];
  /** Lo que falta para que el cálculo sea completo (por ejemplo, el avalúo). */
  avisos: string[];
  hayTarifa: boolean;
}

export interface VehiculoParaCostos { clase?: string | null; cilindraje?: number | string | null }

/**
 * Las motos de 125 cc o menos no pagan impuesto vehicular (Ley 488 de 1998, art. 141), así que no llevan paz y
 * salvo de impuesto. Sin clase, el cilindraje basta (ningún carro tiene 125 cc o menos).
 */
export function motoSinImpuesto(v: VehiculoParaCostos | null | undefined) {
  const cc = Number(String(v?.cilindraje ?? "").replace(/\D/g, "")) || 0;
  const clase = String(v?.clase ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  return cc > 0 && cc <= 125 && (!clase || /MOTOCICLETA|CICLOMOTOR|^MOTO$/.test(clase));
}

/**
 * El paz y salvo de impuestos se cobra SIEMPRE a $10.000 (Felipe: "nunca cotice menos"), aunque la tarifa de una
 * ciudad diga otra cosa o no tenga; una sola vez por combo. Lo llevan los trámites que piden estar a paz y salvo con
 * el impuesto (traspasos, traslados y radicaciones de cuenta, cancelación, rematrícula) y la revocatoria y el
 * levantamiento de prenda (así se cotizan en la oficina). Las motos de 125 cc o menos no pagan impuesto: sin paz y salvo.
 */
export const PAZ_Y_SALVO = 30000;
const LLEVAN_PAZ_Y_SALVO = /traspaso|traslado|radicaci[oó]n de cuenta|cancelaci[oó]n de matr|rematr[ií]cula|revocatoria|levantamiento de prenda/i;
export const AVISO_PAZ_Y_SALVO_UNA_VEZ = "Paz y salvo: se cobra una sola vez cuando los trámites van juntos.";

/**
 * Costos sugeridos de un trámite: la tarifa del organismo (o la general), los honorarios
 * (los de la tarifa o el parámetro honorarios_defecto), y si aplica, el impuesto de registro
 * y la retención en la fuente sobre el avalúo. Es una sugerencia: todo se edita en el expediente.
 * Con el vehículo, las motos de 125 cc o menos van sin paz y salvo de impuesto.
 */
export function calcularCostos(
  tipo: { id: string; nombre: string; aplicaImpuestoRegistro: boolean; categoria?: string },
  tarifas: TarifaParaReglas[],
  organismoId: string | null,
  avaluo: number | null,
  parametros: { honorariosDefecto: number; tramos: TramoImpuesto[]; retefuentePct: number },
  vehiculo?: VehiculoParaCostos | null,
  licencia?: { categorias: string[]; conClases?: boolean | null } | null,
): CostosSugeridos {
  // Las licencias tienen su precio de la oficina (todo en una línea, sin honorarios aparte: así no se los quita un
  // combo). Sin precio (falta con o sin clases, o esa combinación no está), en cero y con el aviso: nada de los 100.000.
  if (tipo.categoria === "licencia") {
    const p = precioLicencia(tipo.nombre, licencia?.categorias ?? [], licencia?.conClases);
    if (p) {
      const avisos = [p.aviso, p.detalle].filter((x): x is string => !!x);
      if (p.valor === null) return { costoDerechos: 0, honorarios: 0, lineas: [], avisos, hayTarifa: false };
      return { costoDerechos: p.valor, honorarios: 0, lineas: [{ concepto: p.concepto, valor: p.valor }], avisos, hayTarifa: true };
    }
  }
  const candidatas = tarifas
    .filter((t) => t.tipoTramiteId === tipo.id && (t.organismoId === null || t.organismoId === organismoId))
    .sort((a, b) => Number(b.organismoId !== null) - Number(a.organismoId !== null) || (b.vigenteDesde ?? "").localeCompare(a.vigenteDesde ?? ""));
  const tarifa = candidatas[0];
  const lineas: { concepto: string; valor: number }[] = [];
  const avisos: string[] = [];
  if (tarifa) {
    if (tarifa.derechosTransito) lineas.push({ concepto: "Derechos de tránsito", valor: tarifa.derechosTransito });
    if (tarifa.componenteRunt) lineas.push({ concepto: "Componente RUNT", valor: tarifa.componenteRunt });
    if (tarifa.estampillas) lineas.push({ concepto: "Estampillas", valor: tarifa.estampillas });
    if (organismoId && tarifa.organismoId === null) avisos.push("Se usó la tarifa general: no hay una para este organismo.");
  } else {
    avisos.push("No hay tarifa para este trámite y organismo: los derechos quedan en cero.");
  }
  if (tarifa?.pazSalvo || LLEVAN_PAZ_Y_SALVO.test(tipo.nombre)) {
    if (motoSinImpuesto(vehiculo)) avisos.push("Moto de 125 cc o menos: no paga impuesto vehicular, así que no lleva paz y salvo.");
    else lineas.push({ concepto: "Paz y salvo", valor: PAZ_Y_SALVO });
  }
  const honorarios = tarifa?.honorarios || parametros.honorariosDefecto;

  if (tipo.aplicaImpuestoRegistro && parametros.tramos.length) {
    if (avaluo && avaluo > 0) {
      const tramo = parametros.tramos.find((t) => t.hasta == null || avaluo <= t.hasta);
      if (tramo) lineas.push({ concepto: `Impuesto de registro (${tramo.pct}%)`, valor: Math.round((avaluo * tramo.pct) / 100) });
    } else {
      avisos.push("El impuesto de registro depende del avalúo del vehículo, que no está cargado.");
    }
  }
  if (parametros.retefuentePct > 0 && /traspaso/i.test(tipo.nombre)) {
    if (avaluo && avaluo > 0) lineas.push({ concepto: `Retención en la fuente (${parametros.retefuentePct}%)`, valor: Math.round((avaluo * parametros.retefuentePct) / 100) });
    else avisos.push("La retención en la fuente depende del valor de la venta.");
  }
  return { costoDerechos: lineas.reduce((s, l) => s + l.valor, 0), honorarios, lineas, avisos, hayTarifa: !!tarifa };
}

// ─── Cotizador ───────────────────────────────────────────────────────────────

const palabrasDe = (s: string) => normalizar(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Los trámites de vehículo que nombra un texto libre ("traspaso más lev de prenda"). Una palabra cuenta entera o
 * abreviada desde 3 letras. Lo nombra del todo si están todas sus palabras; a medias, si está la primera: si varios
 * empiezan igual, el más general (el de nombre más corto: "traspaso" es "Traspaso de propiedad", no "Traspaso a
 * persona indeterminada"); si empatan ("cambio de..."), ninguno. Los de a medias no cuentan si esa palabra es de otro
 * nombrado del todo ("cancelación de matrícula" no es también "matrícula inicial"). Es una propuesta: Felipe confirma.
 */
export function tiposDelTexto<T extends { nombre: string; categoria: string }>(tipos: T[], texto: string, categoria: string | null = "vehiculo"): T[] {
  const candidatos = tipos.filter((t) => !categoria || t.categoria === categoria).map((t) => ({ t, ws: palabrasDe(t.nombre).filter((w) => w.length > 3) })).filter((x) => x.ws.length);
  // "Persona interesada" o "persona indeterminada" a secas son esos traspasos (así se dicen en la oficina).
  const dichas = palabrasDe(normalizar(texto).replace(/\b(?<!traspaso (?:a |por )?)persona (interesada|indeterminada)\b/g, "traspaso a persona $1"));
  // Una abreviatura cuenta solo si es de una sola palabra de los trámites: "lev" es levantamiento; "tras" puede ser
  // traspaso o traslado, y no se adivina.
  const todas = [...new Set(candidatos.flatMap((x) => x.ws))];
  const clara = (t: string) => todas.filter((w) => w.startsWith(t)).length === 1;
  const dicha = (w: string) => dichas.some((t) => t === w || (t.length >= 3 && w.startsWith(t) && clara(t)));
  // Nombrado del todo; si sus palabras están dentro de otro nombrado del todo, gana el más completo ("traslado y
  // radicación de cuenta" es "Traslado + radicación de cuenta", no también "Radicación de cuenta").
  const completos = candidatos.filter((x) => x.ws.every(dicha));
  const todo = completos.filter((x) => !completos.some((y) => y !== x && y.ws.length > x.ws.length && x.ws.every((w) => y.ws.includes(w))));
  const medias = candidatos.filter((x) => {
    if (todo.includes(x) || !dicha(x.ws[0]) || todo.some((y) => y.ws.includes(x.ws[0]))) return false;
    const mismos = candidatos.filter((y) => y.ws[0] === x.ws[0]);
    const menor = Math.min(...mismos.map((y) => y.ws.length));
    return x.ws.length === menor && mismos.filter((y) => y.ws.length === menor).length === 1;
  });
  return candidatos.filter((x) => todo.includes(x) || medias.includes(x)).map((x) => x.t);
}

/**
 * El organismo de la lista que corresponde a un texto ("CÚCUTA", "STRIA TTE MCPAL IBAGUE/TOLIMA"): igual a la
 * ciudad, o uno contiene al otro como palabras completas. Si no hay uno claro, ninguno: no se adivina.
 */
export function organismoDeTexto<T extends { nombre: string; ciudad: string | null }>(organismos: T[], texto: string | null | undefined): T | null {
  const limpio = (...t: (string | null | undefined)[]) => palabrasDe(t.filter(Boolean).join(" ")).join(" ");
  const pedido = limpio(texto);
  if (!pedido) return null;
  const exacto = organismos.find((o) => limpio(o.ciudad) === pedido || limpio(o.nombre) === pedido);
  if (exacto) return exacto;
  const contiene = (a: string, b: string) => !!b && ` ${a} `.includes(` ${b} `);
  const posibles = organismos.filter((o) => contiene(pedido, limpio(o.ciudad)) || contiene(limpio(o.ciudad, o.nombre), pedido))
    .sort((a, b) => (b.ciudad ?? "").length - (a.ciudad ?? "").length);
  // "Puerto Boyacá" contiene "Boyacá": gana la ciudad más larga; dos del mismo largo es ambiguo.
  if (posibles.length > 1 && (posibles[0].ciudad ?? "").length === (posibles[1].ciudad ?? "").length) return null;
  return posibles[0] ?? null;
}

export const AVISO_HONORARIOS_UNA_VEZ ="Honorarios: se cobran una sola vez cuando los trámites van juntos.";

/**
 * Varios trámites al tiempo (un encargo, o una cotización de varios trámites): los honorarios se cobran una sola
 * vez. Quedan en el de honorarios más altos entre los que tienen tarifa (los honorarios por defecto de un trámite sin
 * tarifa no le ganan a los de una tarifa: un cambio de color sin tarifa se llevaba los del traspaso); los demás van
 * en cero, con el aviso.
 */
export function honorariosUnaVez<T extends { honorarios: number; avisos: string[]; hayTarifa?: boolean; costoDerechos?: number; lineas?: { concepto: string; valor: number }[] }>(costos: T[]): T[] {
  if (costos.length < 2) return costos;
  const cuenta = costos.some((c) => c.hayTarifa) ? (c: T) => c.hayTarifa !== false : () => true;
  const mayor = costos.reduce((m, c, i) => (cuenta(c) && (!cuenta(costos[m]) || c.honorarios > costos[m].honorarios) ? i : m), 0);
  // El paz y salvo, también una sola vez: queda en el primero que lo lleva.
  let conPaz = false;
  return costos
    .map((c, i) => (i === mayor || !c.honorarios ? c : { ...c, honorarios: 0, avisos: [...c.avisos, AVISO_HONORARIOS_UNA_VEZ] }))
    .map((c) => {
      const k = c.lineas?.findIndex((l) => l.concepto === "Paz y salvo") ?? -1;
      if (k < 0) return c;
      if (!conPaz) { conPaz = true; return c; }
      return { ...c, lineas: c.lineas!.filter((_, j) => j !== k), costoDerechos: (c.costoDerechos ?? 0) - c.lineas![k].valor, avisos: [...c.avisos, AVISO_PAZ_Y_SALVO_UNA_VEZ] };
    });
}

export function estadoPago(total: number, pagado: number): EstadoPago {
  if (pagado <= 0) return "pendiente";
  return total > 0 && pagado >= total ? "pagado" : "abonado";
}

// ─── Licencias (art. 197 del Código Nacional de Tránsito) ───────────────────
// particular (A*, B*): 10 años si es menor de 60 · 5 años de 60 a 80 · 1 año mayor de 80
// público (C*):         3 años si es menor de 60 · 1 año desde los 60

export function edadEn(fechaNacimiento: string | null | undefined, en: string): number | null {
  if (!fechaNacimiento || !esFecha(fechaNacimiento.slice(0, 10))) return null;
  const [an, mn, dn] = fechaNacimiento.slice(0, 10).split("-").map(Number);
  const [ae, me, de] = en.slice(0, 10).split("-").map(Number);
  return ae - an - (me < mn || (me === mn && de < dn) ? 1 : 0);
}

export function vigenciaLicenciaAnios(categoria: string, edad: number | null): number {
  const e = edad ?? 0;
  if (categoria.toUpperCase().startsWith("C")) return e < 60 ? 3 : 1;
  return e < 60 ? 10 : e <= 80 ? 5 : 1;
}

/** Edad mínima para sacar por primera vez una categoría (art. 19, Ley 769 de 2002): 18 para servicio público (C), 16 para particular. */
export const edadMinimaLicencia = (categoria: string) => (categoria.toUpperCase().startsWith("C") ? 18 : 16);

/**
 * Lo que la edad implica en un trámite de licencia, según la norma:
 * - `bloqueos`: expedición o recategorización sin la edad mínima (art. 19, Ley 769 de 2002); migración (la licencia de
 *   menor de edad que pasa a ser de mayor) antes de los 18.
 * - `avisos`: cuánto queda vigente cada categoría con esa edad (art. 197, Decreto 019 de 2012), y si la vigencia
 *   se acorta pronto por cumplir 60 u 80 años.
 */
export function avisosEdadLicencia(primeraVez: boolean, categorias: string[], fechaNacimiento: string | null | undefined, hoy: string, migracion = false) {
  const edad = edadEn(fechaNacimiento, hoy);
  const bloqueos: string[] = [];
  const avisos: string[] = [];
  if (migracion && edad != null && edad < 18) bloqueos.push(`La migración pasa la licencia de menor a mayor de edad: se hace con 18 años cumplidos; tiene ${edad}.`);
  if (edad == null || !categorias.length) return { edad, bloqueos, avisos };
  if (primeraVez) {
    for (const c of categorias) {
      const min = edadMinimaLicencia(c);
      if (edad < min) bloqueos.push(`${c}: la ley exige ${min} años cumplidos${min === 18 ? " para servicio público" : ""} (art. 19, Ley 769 de 2002); tiene ${edad}.`);
    }
  }
  const vigencias = categorias.map((c) => `${c} ${vigenciaLicenciaAnios(c, edad)} año${vigenciaLicenciaAnios(c, edad) === 1 ? "" : "s"}`);
  avisos.push(`Con ${edad} años la licencia queda vigente: ${vigencias.join(", ")} (art. 197, Decreto 019 de 2012).`);
  // La vigencia se fija con la edad del día de la expedición: si el próximo cumpleaños la acorta, conviene hacerlo antes.
  const siguiente = categorias.filter((c) => vigenciaLicenciaAnios(c, edad + 1) < vigenciaLicenciaAnios(c, edad));
  if (siguiente.length && fechaNacimiento) {
    const [, m, d] = fechaNacimiento.slice(0, 10).split("-").map(Number);
    const anio = Number(hoy.slice(0, 4));
    let cumple = `${anio}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (cumple <= hoy) cumple = `${anio + 1}${cumple.slice(4)}`;
    const dma = `${cumple.slice(8, 10)}/${cumple.slice(5, 7)}/${cumple.slice(0, 4)}`;
    avisos.push(`Cumple ${edad + 1} años el ${dma}: si el trámite sale antes, ${siguiente.map((c) => `${c} queda por ${vigenciaLicenciaAnios(c, edad)} años`).join(", ")}; después, ${siguiente.map((c) => `${c} por ${vigenciaLicenciaAnios(c, edad + 1)}`).join(", ")}.`);
  }
  return { edad, bloqueos, avisos };
}

export function vencimientoLicencia(expedicion: string, categoria: string, fechaNacimiento: string | null | undefined): string {
  const anios = vigenciaLicenciaAnios(categoria, edadEn(fechaNacimiento, expedicion));
  const [a, m, d] = expedicion.slice(0, 10).split("-").map(Number);
  // 29 de febrero + años que no son bisiestos -> 28 de febrero.
  const fin = new Date(Date.UTC(a + anios, m - 1, d));
  if (fin.getUTCMonth() !== m - 1) fin.setUTCDate(0);
  return deFecha(fin);
}

/** "B1, a2,B1" -> ["B1", "A2"]: solo categorías válidas, sin repetir. */
export function categoriasDeTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return [...new Set(texto.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => (CATEGORIAS_LICENCIA as readonly string[]).includes(c)))];
}

// ─── Datos leídos de fotos ───────────────────────────────────────────────────

export const CLASES_VEHICULO = [
  "Automóvil", "Camioneta", "Campero", "Motocicleta", "Cuatrimoto", "Motocarro", "Camión", "Bus", "Buseta",
  "Microbús", "Tractocamión", "Volqueta", "Remolque", "Semirremolque", "Maquinaria",
] as const;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** La clase de la lista más parecida a lo leído; null si no se parece a ninguna. Nunca falla por no coincidir exacto. */
export function claseMasParecida(leida: string | null | undefined): string | null {
  if (!leida) return null;
  const l = sinTildes(leida);
  const exacta = CLASES_VEHICULO.find((c) => sinTildes(c) === l);
  if (exacta) return exacta;
  const contiene = CLASES_VEHICULO.find((c) => l.includes(sinTildes(c)) || sinTildes(c).includes(l));
  if (contiene) return contiene;
  if (/^moto/.test(l)) return "Motocicleta";
  if (/^auto/.test(l)) return "Automóvil";
  return null;
}

/** "abc 12-3" -> "ABC123". */
export const normalizarPlaca = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Solo dígitos (cédulas, teléfonos). */
export const soloDigitos = (s: string) => s.replace(/\D/g, "");

/** Palabras del texto que podrían ser la abreviatura de más de un trámite ("tras": traspaso o traslado). */
export function abreviaturasAmbiguas<T extends { nombre: string }>(tipos: T[], texto: string): string[] {
  const todas = [...new Set(tipos.flatMap((t) => palabrasDe(t.nombre).filter((w) => w.length > 3)))];
  return palabrasDe(texto).filter((t) => t.length >= 3 && !todas.includes(t) && new Set(todas.filter((w) => w.startsWith(t))).size > 1);
}

// ─── Info incompleta (trámites preanotados) ─────────────────────────────────

/** "NA", "N/A", "-", "?" o vacío: un dato que no se tiene (Felipe pone "NA" cuando falta). */
export function sinDato(v: string | null | undefined): boolean {
  return !v || /^\s*(n\.?\s?\/?\s?a\.?|-+|\?+|x+|pendiente|sin dato)\s*$/i.test(v);
}

/**
 * Lo esencial que le falta a un trámite abierto para poderse hacer. Un trámite se puede preanotar sin esos datos ("hay
 * chicharrones": se anota para no olvidarlo) y queda con la etiqueta "Info incompleta" hasta que se completan; la
 * etiqueta se va sola. Una persona puesta como "NA" cuenta como que falta.
 */
export function datosQueFaltan(
  t: { estado: string; vehiculoId?: string | null; organismoId?: string | null; detalle?: string | null },
  tipo: { nombre: string; categoria: string; requiereVehiculo: boolean } | undefined,
  titular: { nombre?: string | null; numeroDocumento?: string | null; fechaNacimiento?: string | null } | undefined,
  personas: { rol: string; nombre?: string | null; numeroDocumento?: string | null }[],
  placa?: string | null,
): string[] {
  if (!tipo || t.estado === "entregado" || t.estado === "cancelado") return [];
  const falta: string[] = [];
  const real = (x: { nombre?: string | null }) => !sinDato(x.nombre);
  if (tipo.requiereVehiculo && (!t.vehiculoId || (placa !== undefined && sinDato(placa)))) falta.push("el vehículo");
  if (/traspaso/i.test(tipo.nombre)) {
    // El titular es una de las dos partes; la otra tiene que estar, y no como "NA".
    const comprador = personas.find((p) => p.rol === "comprador"), vendedor = personas.find((p) => p.rol === "vendedor");
    if ((!comprador && !vendedor) || (comprador && !real(comprador))) falta.push("el comprador");
    if (vendedor && !real(vendedor)) falta.push("el vendedor");
  }
  if (tipo.categoria === "licencia") {
    if (sinDato(t.detalle)) falta.push("las categorías");
    if (!titular?.fechaNacimiento) falta.push("la fecha de nacimiento");
  }
  if (!t.organismoId) falta.push("el organismo");
  if (titular && (sinDato(titular.nombre) || sinDato(titular.numeroDocumento))) falta.push(sinDato(titular.nombre) ? "el titular" : "la cédula del titular");
  return falta;
}

// ─── Semáforo del trámite ───────────────────────────────────────────────────

export type ColorSemaforo = "amarillo" | "azul" | "rojo" | "morado" | "verde" | "vino";
/** Orden para ordenar y filtrar (lo que más necesita atención primero). */
export const COLORES_SEMAFORO: { color: ColorSemaforo; nombre: string; que: string }[] = [
  { color: "rojo", nombre: "Rojo", que: "Atrasado o requiere corrección" },
  { color: "amarillo", nombre: "Amarillo", que: "Le falta algo para avanzar" },
  { color: "azul", nombre: "Azul", que: "En curso y al día" },
  { color: "morado", nombre: "Morado", que: "Ya salió: falta entregar la tarjeta o cobrar" },
  { color: "verde", nombre: "Verde", que: "Cerrado del todo" },
  { color: "vino", nombre: "Vino", que: "Cancelado: no se pudo hacer" },
];

/**
 * El color del trámite, calculado solo con lo que ya está registrado (nadie lo escoge): el verde llega una sola vez,
 * al final. En orden: gris cancelado; ya salió (finalizado o listo para entregar) → morado si falta entregar la
 * tarjeta o cobrar, verde si no; rojo si requiere corrección o está atrasado; amarillo si le falta un dato esencial o
 * (antes de radicar) alguna precondición; azul si va al día. `motivo` es el porqué (al pasar el mouse).
 */
export function semaforo(
  t: { estado: string; fechaEstimadaEntrega?: string | null; estadoTarjeta?: string | null },
  o: { hoy: string; saldo: number; faltanDatos: string[]; faltanPrecondiciones: string[] },
): { color: ColorSemaforo; motivo: string } {
  const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  const fechaCorta = (f: string) => f.split("-").reverse().join("/");
  const lista = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} y ${l.at(-1)}` : l[0]);
  if (t.estado === "cancelado") return { color: "vino", motivo: "Cancelado: no se pudo hacer" };
  if (t.estado === "entregado" || t.estado === "listo_para_entrega") {
    const pendiente: string[] = [];
    if (t.estadoTarjeta && t.estadoTarjeta !== "entregada") pendiente.push(t.estadoTarjeta === "enviada" ? "que el cliente reciba la tarjeta (va en camino)" : "entregar la tarjeta");
    if (o.saldo > 0) pendiente.push(`cobrar ${pesos(o.saldo)}`);
    if (t.estado === "listo_para_entrega" && !pendiente.length) pendiente.push("entregarlo al cliente");
    return pendiente.length ? { color: "morado", motivo: `Ya salió; falta ${lista(pendiente)}` } : { color: "verde", motivo: "Cerrado: finalizado, tarjeta entregada y pagado" };
  }
  if (t.estado === "requiere_correccion") return { color: "rojo", motivo: "Requiere corrección" };
  if (t.fechaEstimadaEntrega && t.fechaEstimadaEntrega < o.hoy) return { color: "rojo", motivo: `Atrasado: debía salir el ${fechaCorta(t.fechaEstimadaEntrega)}` };
  const falta = [...o.faltanDatos, ...(t.estado === "en_preparacion" ? o.faltanPrecondiciones.map((p) => p.charAt(0).toLowerCase() + p.slice(1)) : [])];
  if (falta.length) return { color: "amarillo", motivo: `Falta ${lista(falta)}` };
  return { color: "azul", motivo: `En curso, al día${t.fechaEstimadaEntrega ? `: sale el ${fechaCorta(t.fechaEstimadaEntrega)}` : ""}` };
}

// ─── Lo importante de un trámite ─────────────────────────────────────────────

/**
 * Lo que hay que tener en cuenta para que no devuelvan el trámite. Sale arriba del expediente ("Importante") y en los
 * avisos al registrarlo (también desde el asistente):
 * - Levantamiento de prenda (solo o en combo): la carta del acreedor tiene que ir en físico.
 * - De vehículo en otra ciudad (no Ibagué): revisar los requisitos de ese tránsito; muchas piden el contrato de mandato
 *   autenticado por el comprador y el vendedor.
 * - Traspaso a un menor de edad (tarjeta de identidad, o menos de 18 años por su fecha de nacimiento): carta autenticada
 *   en notaría en la que ambos padres responden por cualquier asunto legal, civil o penal.
 */
/** El documento que se sube firmado (queda pendiente al crear el trámite). */
export const DOC_COMPROMISO = "Carta de compromiso firmada";
/**
 * La carta sigue faltando: sin archivo y sin que la oficina haya dicho que todo bien (estado "validado": ya se firmó,
 * o el cliente ya terminó las clases y solo trae la otra mitad del trámite).
 */
export const cartaFalta = (d: { tipoDocumento: string; archivoClave?: string | null; estado: string }) => d.tipoDocumento === DOC_COMPROMISO && !d.archivoClave && d.estado !== "validado";
/**
 * Solo la licencia por primera vez (expedición): la persona firma la carta de compromiso de terminar las clases. La
 * migración, la renovación y las demás no llevan clases ni carta.
 */
export const pideCompromiso = (t: { nombre: string; categoria: string }) => t.categoria === "licencia" && /expedici/.test(normalizar(t.nombre));

export function alertasTramite(o: {
  tipos: { nombre: string; categoria: string; precondiciones?: unknown }[];
  /** La ciudad del organismo de tránsito. */
  ciudad: string | null | undefined;
  compradores: { nombre?: string | null; tipoDocumento?: string | null; fechaNacimiento?: string | null }[];
  hoy: string;
  /** Expedición de licencia: con clases (true), sin clases (false) o sin decir. */
  conClases?: boolean | null;
  /** La carta de compromiso firmada sigue faltando en el trámite (ver cartaFalta). */
  compromisoPendiente?: boolean;
}): { clave: "carta_prenda" | "otra_ciudad" | "menor" | "compromiso_clases"; texto: string }[] {
  const alertas: { clave: "carta_prenda" | "otra_ciudad" | "menor" | "compromiso_clases"; texto: string }[] = [];
  // Primera vez (solo la expedición): la carta de compromiso firmada de terminar las clases, con clases o sin clases (que no
  // las requiera no quiere decir que no las vaya a recibir). Hasta que se suba o la oficina diga que todo bien.
  if (o.compromisoPendiente && o.tipos.some((t) => pideCompromiso(t))) {
    alertas.push({ clave: "compromiso_clases", texto: "Falta la carta de compromiso firmada: con clases o sin clases, la persona debe firmar la carta de compromiso de terminar las clases. Imprímala (Formatos) y súbala firmada en Archivos." });
  }
  if (o.tipos.some((t) => (t.precondiciones as Record<string, unknown> | null | undefined)?.carta_prenda)) {
    alertas.push({ clave: "carta_prenda", texto: "Para que no devuelvan el trámite, la carta de levantamiento de prenda (original, del banco o la financiera) debe ir en los documentos físicos." });
  }
  const ciudad = (o.ciudad ?? "").trim();
  if (ciudad && normalizar(ciudad) !== "ibague" && o.tipos.some((t) => t.categoria === "vehiculo")) {
    alertas.push({ clave: "otra_ciudad", texto: `Trámite en ${ciudad}: revise los requisitos de ese tránsito antes de enviarlo. Muchas ciudades piden el contrato de mandato autenticado por el comprador y el vendedor.` });
  }
  if (o.tipos.some((t) => /traspaso/i.test(t.nombre))) {
    const menores = o.compradores.filter((c) => (c.tipoDocumento ?? "").toUpperCase() === "TI" || (edadEn(c.fechaNacimiento, o.hoy) ?? 99) < 18);
    for (const c of menores) {
      alertas.push({ clave: "menor", texto: `${c.nombre ? `${c.nombre} (comprador)` : "El comprador"} es menor de edad: para que quede como propietario hace falta una carta autenticada en notaría en la que ambos padres se hacen responsables de cualquier asunto legal, civil o penal con el vehículo.` });
    }
  }
  return alertas;
}
