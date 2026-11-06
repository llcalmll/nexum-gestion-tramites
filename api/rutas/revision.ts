/*
 * Revisión previa con PlacApi: todo lo que pueda frenar o entorpecer el trámite, de una vez.
 *
 *   POST /api/consultas/revision/:tramiteId             Revisa un trámite (cuesta créditos) y la guarda.
 *   GET  /api/consultas/revision/:tramiteId             La última revisión guardada (sin costo).
 *   POST /api/consultas/revision/:tramiteId/reintentar  Pide de nuevo SOLO lo que no llegó en la última revisión.
 *   POST /api/registrar/verificar                       Revisa un trámite que se está registrando (o la consulta rápida),
 *                                                       ANTES de guardarlo (registrar.ts la aplica al guardarlo, sin volver
 *                                                       a consultar).
 *   POST /api/registrar/verificar/:id/reintentar        Lo mismo que el anterior, solo lo que no llegó.
 *   POST /api/registrar/verificar/:id/agregar           Le agrega lo que no se pidió (el SIMIT a una consulta solo del
 *                                                       RUNT, o al revés).
 *
 * La consulta rápida elige qué consultar (`alcance`): "runt" = la consulta básica del vehículo (1: registro, SOAT,
 * técnico-mecánica, prendas); "simit" = el paz y salvo de cada persona (1 por cédula); "todo" = lo de abajo.
 *
 * Qué consulta (lo que Felipe decidió: nada de hurto ni medidas correctivas):
 * - Trámite de vehículo: consulta completa (3 créditos) con la placa y la cédula del dueño: estado del registro,
 *   SOAT, técnico-mecánica, prendas y embargos, comparendos del dueño (SIMIT) e impuesto. En un traspaso, además, el
 *   paz y salvo SIMIT del comprador (1). Total: 4 en un traspaso, 3 en otro trámite.
 * - Trámite de licencia: la licencia del titular (1 con el apellido) y su paz y salvo SIMIT (1). Total: 2.
 * Cada parte llega o no por su lado (PlacApi solo cobra lo que llega): lo que no llegó queda marcado (`faltan`), la
 * revisión queda "incompleta" y se puede pedir de nuevo solo eso, con la consulta más barata que lo traiga
 * (compartido/revision.ts). Los créditos se cuentan con el saldo de PlacApi antes y después (gratis); si el saldo no
 * responde, con lo que cuesta cada consulta.
 * Todo lo que llega queda en la base: el vehículo se completa con el RUNT (motor, chasis, fechas...), las licencias del
 * dueño entran al radar y cada respuesta se guarda completa. Lo limpio marca su precondición (si aplica al tipo de
 * trámite) y todo queda en la bitácora. Las precondiciones nunca se desmarcan solas.
 */
import { and, eq, inArray } from "drizzle-orm";
import { PRECONDICION_LABEL, type Precondicion } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { hoyColombia } from "../../compartido/reglas";
import { listaPartes, planReintento, type ParteRevision } from "../../compartido/revision";
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos, type Db } from "../util";
import { absorberLicencias, completarDelRunt, consultarLicenciasDe, creditosDisponibles, placapi, registrar, ultimaVigencia, type DatosRunt, type EnvConsultas, type RespuestaPlacApi } from "./consultas";
import { agregarNota, marcarPrecondicion } from "./tramites";

export interface Hallazgo {
  tema: string; quien?: string; estado: "ok" | "alerta" | "bloquea" | "sin_dato"; detalle: string;
  /** De qué parte de la revisión sale. */
  parte?: ParteRevision;
  /** Las partes que NO llegaron (la fuente no respondió): se pueden pedir de nuevo. */
  faltan?: ParteRevision[];
}
export interface Revision { fecha: string; creditos: number; hallazgos: Hallazgo[]; aprobadas: string[]; faltaron?: ParteRevision[] }
/** Qué se consulta: todo (consulta completa + SIMIT del comprador), solo el RUNT del vehículo o solo el SIMIT de las personas. */
export type Alcance = "todo" | "runt" | "simit";
const ALCANCES: Alcance[] = ["todo", "runt", "simit"];
/** Lo del RUNT y lo del SIMIT, para decir qué se consultó. */
const DEL_RUNT: ParteRevision[] = ["registro", "gravamenes", "soat", "rtm"];
const DEL_SIMIT: ParteRevision[] = ["simit_dueno", "simit_comprador", "simit_titular"];

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
/** "19/09/2026" o "2026-09-19" -> "2026-09-19". */
const fechaIso = (f: unknown) => {
  const s = String(f ?? "");
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/** Errores que detienen todo (llave mala, sin créditos, demasiadas consultas): no tiene sentido seguir gastando. */
const fatal = (r: RespuestaPlacApi) => [401, 402, 429].includes(r.estado);
/** El RUNT no tiene esa placa con esa cédula: no es que no haya respondido, es que algún dato está mal. */
const noEncontro = (r: RespuestaPlacApi) => r.estado === 404 || r.codigo === "propietario_no_coincide";
const NO_LLEGO = "No llegó: la fuente no respondió esta parte (no se cobró).";
/** Lo que trae la consulta completa del vehículo (sin los comparendos del comprador). */
const DE_LA_COMPLETA: ParteRevision[] = ["registro", "gravamenes", "soat", "rtm", "simit_dueno", "impuesto"];
const DE_LA_BASICA: ParteRevision[] = ["registro", "gravamenes", "soat", "rtm"];
/** Orden en que se muestran los hallazgos. */
const ORDEN: ParteRevision[] = ["licencia", "simit_titular", "registro", "gravamenes", "soat", "rtm", "simit_dueno", "impuesto", "simit_comprador"];

/** Una persona para revisar: con id si ya está en la base (lo que se sepa de ella queda guardado). */
interface Persona { id?: string; nombre: string; tipoDocumento: string; numeroDocumento: string }
/** Lo que se revisa: el vehículo (si está en la base) o solo la placa, y las personas. */
export interface Sujeto {
  categoria: string; esTraspaso: boolean; nombresEncargo: string[];
  placa?: string; vehiculo?: typeof E.vehiculos.$inferSelect;
  vendedor?: Persona; comprador?: Persona; titular?: Persona;
}
/** Lo que trajo la revisión, antes de aplicarla a un trámite. */
export interface Resultado {
  creditos: number; hallazgos: Hallazgo[]; limpias: Precondicion[];
  /** Lo que el RUNT dice del vehículo (para completar el vehículo al guardarlo, si aún no existía). */
  runt: { datos: DatosRunt; soat: string | null; rtm: string | null } | null;
  /** Las partes que no llegaron. */
  faltaron: ParteRevision[];
  /** Solo al pedir de nuevo lo que faltó: lo que se trajo esta vez. */
  nuevos?: Hallazgo[];
  /** Qué se consultó: el RUNT, el SIMIT o los dos (para ofrecer agregar el otro). */
  consultado: ("runt" | "simit")[];
}
type Fuente<T> = { status?: string; data?: T } | undefined;
type Runt = NonNullable<Resultado["runt"]>;

export const faltaronDe = (hs: Hallazgo[]) => [...new Set(hs.flatMap((h) => h.faltan ?? []))];

/** Las precondiciones que quedaron limpias, según los hallazgos (sirve igual al revisar y al completar lo que faltó). */
function limpiasDe(hs: Hallazgo[]): Precondicion[] {
  const de = (p: ParteRevision) => hs.filter((h) => h.parte === p);
  const ok = (p: ParteRevision) => de(p).length > 0 && de(p).every((h) => h.estado === "ok");
  const l: Precondicion[] = [];
  if (ok("gravamenes") && !de("registro").some((h) => h.estado === "bloquea")) l.push("sin_gravamenes");
  if ((ok("simit_dueno") || ok("simit_titular")) && de("simit_comprador").every((h) => h.estado === "ok")) l.push("paz_salvo_simit");
  if (ok("impuesto")) l.push("paz_salvo_impuesto");
  return l;
}
const ordenar = (hs: Hallazgo[]) => [...hs].sort((a, b) => (a.parte ? ORDEN.indexOf(a.parte) : -1) - (b.parte ? ORDEN.indexOf(b.parte) : -1));

/** Vehículo, dueño (vendedor) y comprador del trámite, y los trámites de su encargo: las mismas reglas que al llenar los formatos. */
async function partes(db: Db, tramiteId: string) {
  const t = await db.select().from(E.tramites).where(eq(E.tramites.id, tramiteId)).get();
  if (!t) throw new ErrorApi("El trámite no existe.", 404);
  const tipo = (await db.select().from(E.tiposTramite).where(eq(E.tiposTramite.id, t.tipoId)).get())!;
  const hermanos = t.encargoId ? await db.select({ tipoId: E.tramites.tipoId }).from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId)) : [{ tipoId: t.tipoId }];
  const nombresEncargo = (await db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre }).from(E.tiposTramite).where(inArray(E.tiposTramite.id, hermanos.map((h) => h.tipoId)))).map((x) => x.nombre);
  const v = t.vehiculoId ? await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get() : undefined;
  const personas = await db.select().from(E.tramitePersonas).where(eq(E.tramitePersonas.tramiteId, t.id));
  const vendedorId = personas.find((p) => p.rol === "vendedor")?.clienteId ?? v?.titularId ?? t.titularId;
  const esTraspaso = /traspaso/i.test(tipo.nombre);
  const compradorId = personas.find((p) => p.rol === "comprador")?.clienteId ?? (esTraspaso && t.titularId !== vendedorId ? t.titularId : null);
  const ids = [vendedorId, compradorId, t.titularId].filter((x): x is string => !!x);
  const clientes = ids.length ? await db.select().from(E.clientes).where(inArray(E.clientes.id, ids)) : [];
  const buscar = (id: string | null | undefined) => clientes.find((c) => c.id === id);
  const sujeto: Sujeto = { categoria: tipo.categoria, esTraspaso, nombresEncargo, placa: v?.placa, vehiculo: v, vendedor: buscar(vendedorId), comprador: buscar(compradorId), titular: buscar(t.titularId) };
  return { t, tipo, sujeto };
}

const doc = (c?: Persona) => (c?.numeroDocumento ? { docType: c.tipoDocumento === "Pasaporte" ? "PA" : c.tipoDocumento || "CC", docNumber: c.numeroDocumento } : null);

/**
 * Las consultas de una revisión: cada una queda registrada con sus créditos. Si algo falla de fondo (llave, sin
 * créditos, demasiadas consultas) se corta todo; si no, la respuesta vuelve y quien la pidió decide qué faltó.
 */
function sesion(db: Db, env: EnvConsultas) {
  let creditos = 0;
  return {
    get creditos() { return creditos; },
    sumar(n: number) { creditos += n; },
    async consultar(tipoReg: string, referencia: string, ruta: string, cuerpo: Record<string, unknown>, costo: number) {
      const r = await placapi(env, ruta, cuerpo);
      if (fatal(r)) { await registrar(db, tipoReg, referencia, 0, "error", `${r.codigo ?? r.estado}: ${r.mensaje}`).run(); throw new ErrorApi(r.mensaje, r.estado === 401 ? 502 : r.estado); }
      if (!r.ok) { await registrar(db, tipoReg, referencia, 0, r.estado === 404 ? "sin_datos" : "error", `${r.codigo ?? r.estado}: ${r.mensaje}`).run(); return r; }
      creditos += costo;
      await registrar(db, tipoReg, referencia, costo, "ok", `${ruta.slice(1)}: respondió`, r.datos).run();
      return r;
    },
  };
}
type Sesion = ReturnType<typeof sesion>;

/** Paz y salvo SIMIT de una persona (1 crédito). */
async function pazSalvo(ses: Sesion, parte: ParteRevision, quien: string, c: Persona): Promise<Hallazgo> {
  const base = { tema: "Comparendos (SIMIT)", quien: `${quien}: ${c.nombre}`, parte };
  const dc = doc(c);
  if (!dc) return { ...base, estado: "sin_dato", detalle: "Falta su cédula." };
  const r = await ses.consultar("simit", c.id ?? `doc:${dc.docNumber}`, "/paz-salvo", dc, 1);
  const ds = r.ok ? (r.datos as { pazSalvo?: boolean; totalDeuda?: number; totalComparendos?: number } | null) : null;
  if (!ds) return r.estado === 404 ? { ...base, estado: "sin_dato", detalle: "El SIMIT no encontró esta cédula: revísela (no se cobró)." } : { ...base, estado: "sin_dato", detalle: NO_LLEGO, faltan: [parte] };
  if (ds.pazSalvo) return { ...base, estado: "ok", detalle: "A paz y salvo." };
  return { ...base, estado: "bloquea", detalle: `Debe ${pesos(ds.totalDeuda ?? 0)} en ${ds.totalComparendos ?? "?"} comparendo(s): debe pagarlos o hacer acuerdo de pago antes del trámite.` };
}

/** La licencia del titular (queda en el radar). */
async function licencia(db: Db, env: EnvConsultas, ses: Sesion, c: Persona): Promise<Hallazgo> {
  const l = await consultarLicenciasDe(db, env, c.id!);
  ses.sumar(l.creditos);
  if (l.resultado === "error") return { tema: "Licencia", quien: c.nombre, parte: "licencia", estado: "sin_dato", detalle: `${l.mensaje} No llegó esta parte.`, faltan: ["licencia"] };
  const mal = l.categorias.some((x) => x.estado && !/activa/i.test(x.estado));
  return { tema: "Licencia", quien: c.nombre, parte: "licencia", estado: mal ? "alerta" : "ok", detalle: l.categorias.length ? `${l.categorias.map((x) => `${x.categoria} ${String(x.estado || "").toLowerCase()}${x.vence ? ` (vence ${fechaCorta(x.vence)})` : ""}`).join(", ")}.` : "Sin licencias en el RUNT (normal si es primera vez)." };
}

/** SOAT o técnico-mecánica, con la fecha de vencimiento. */
function vigencia(tema: string, parte: ParteRevision, llego: boolean, fecha: string | null, hoy: string, { exento = false, sinRegistro = "No tiene vigente." } = {}): Hallazgo {
  if (!llego) return { tema, parte, estado: "sin_dato", detalle: NO_LLEGO, faltan: [parte] };
  if (exento) return { tema, parte, estado: "ok", detalle: "Exento (vehículo nuevo)." };
  if (!fecha) return { tema, parte, estado: sinRegistro === "No tiene vigente." ? "bloquea" : "alerta", detalle: sinRegistro };
  return fecha >= hoy ? { tema, parte, estado: "ok", detalle: `Vigente hasta el ${fechaCorta(fecha)}.` } : { tema, parte, estado: "bloquea", detalle: `Vencido desde el ${fechaCorta(fecha)}.` };
}
const registro = (llego: boolean, estado: unknown): Hallazgo => {
  const e = String(estado ?? "").trim();
  if (!llego) return { tema: "Registro del vehículo", parte: "registro", estado: "sin_dato", detalle: NO_LLEGO, faltan: ["registro"] };
  if (e && !/activo/i.test(e)) return { tema: "Registro del vehículo", parte: "registro", estado: "bloquea", detalle: `El registro está ${e.toLowerCase()}.` };
  return { tema: "Registro del vehículo", parte: "registro", estado: "ok", detalle: e ? "Activo en el RUNT." : "Registrado en el RUNT." };
};
/** El RUNT no encontró la placa con esa cédula (no es falla de la fuente: algún dato está mal). */
const noEncontrado = (s: Sujeto, cedula: string): Hallazgo => ({ tema: "Vehículo", estado: "sin_dato", detalle: `El RUNT no encontró la placa ${s.placa} con la cédula ${cedula} (no se cobró). Revise la placa y que sea la cédula del dueño actual.` });
/** Toda la consulta se cayó: lo que debía traer queda por pedir. */
const sinRespuesta = (r: RespuestaPlacApi, faltan: ParteRevision[]): Hallazgo => ({ tema: "Vehículo", estado: "sin_dato", detalle: `${r.mensaje} No llegó: ${listaPartes(faltan)}.`, faltan });

/** La consulta completa del vehículo (3 créditos): registro, prendas y embargos, SOAT, técnico-mecánica, comparendos del dueño e impuesto. */
async function consultaCompleta(db: Db, ses: Sesion, s: Sujeto, hoy: string): Promise<{ hallazgos: Hallazgo[]; runt: Runt | null }> {
  const dd = doc(s.vendedor)!;
  const r = await ses.consultar("consulta_full", s.vehiculo?.id ?? `placa:${s.placa}`, "/consulta-full", { placa: s.placa, ...dd }, 3);
  if (!r.ok) return { hallazgos: [noEncontro(r) ? noEncontrado(s, dd.docNumber) : sinRespuesta(r, DE_LA_COMPLETA)], runt: null };
  const d = (r.datos ?? {}) as {
    vehicle?: Fuente<{ estado?: string; marca?: string; linea?: string; modelo?: number; color?: string; cilindraje?: number; clase?: string; servicio?: string; motor?: string; chasis?: string; vin?: string; numeroSerie?: string; organismoTransito?: string; fechaMatricula?: string }>;
    soat?: Fuente<{ vigente?: boolean; fechaVencimiento?: string }>; rtm?: Fuente<{ vigente?: boolean; exento?: boolean; fechaVencimiento?: string }>;
    antecedentes?: Fuente<{ prendas?: { acreedor?: string }[]; embargos?: { entidad?: string; descripcion?: string }[] }>;
    simit?: Fuente<{ pazSalvo?: boolean; totalDeuda?: number; totalMultas?: number }>;
    impuestos?: Fuente<{ totalPendiente?: number; departamento?: string; anios?: { anio: number; pagado: boolean }[] }>;
    licencia?: { data?: { licenses?: unknown[] } };
  };
  const ok = (f: Fuente<unknown>) => !!f?.data && f.status !== "error";
  const hallazgos: Hallazgo[] = [];
  const veh = ok(d.vehicle) ? d.vehicle!.data! : undefined;
  hallazgos.push(registro(!!veh, veh?.estado));
  // Prendas y embargos.
  if (!ok(d.antecedentes)) hallazgos.push({ tema: "Prendas y embargos", parte: "gravamenes", estado: "sin_dato", detalle: NO_LLEGO, faltan: ["gravamenes"] });
  else {
    const ant = d.antecedentes!.data!;
    const prendas = ant.prendas ?? [], embargos = ant.embargos ?? [];
    const acreedores = prendas.map((p) => p.acreedor ?? "").filter((x) => x && !/sin detalle/i.test(x));
    hallazgos.push(...gravamenes(s, { prenda: prendas.length > 0, acreedores, embargos: embargos.length, entidad: embargos[0]?.entidad }));
  }
  // SOAT y técnico-mecánica: las fechas quedan en el vehículo (las precondiciones se evalúan solas con ellas).
  const soat = fechaIso(d.soat?.data?.fechaVencimiento), rtm = fechaIso(d.rtm?.data?.fechaVencimiento);
  hallazgos.push(vigencia("SOAT", "soat", ok(d.soat), soat, hoy), vigencia("Técnico-mecánica", "rtm", ok(d.rtm), rtm, hoy, { exento: !!d.rtm?.data?.exento }));
  const runt: Runt = { datos: veh ? { ...veh, serie: veh.numeroSerie } : {}, soat: ok(d.soat) ? soat : null, rtm: ok(d.rtm) ? rtm : null };
  // Lo que trae queda en la base: el vehículo (si ya existe) y las licencias del dueño (si es cliente).
  if (s.vehiculo) await absorberVehiculo(db, s.vehiculo, runt);
  if (s.vendedor?.id && d.licencia?.data?.licenses) await absorberLicencias(db, s.vendedor.id, d.licencia.data.licenses);
  // Comparendos del dueño.
  const quien = `Dueño: ${s.vendedor!.nombre}`;
  const sm = d.simit?.data;
  if (!ok(d.simit)) hallazgos.push({ tema: "Comparendos (SIMIT)", quien, parte: "simit_dueno", estado: "sin_dato", detalle: NO_LLEGO, faltan: ["simit_dueno"] });
  else if (sm?.pazSalvo) hallazgos.push({ tema: "Comparendos (SIMIT)", quien, parte: "simit_dueno", estado: "ok", detalle: "A paz y salvo." });
  else hallazgos.push({ tema: "Comparendos (SIMIT)", quien, parte: "simit_dueno", estado: "bloquea", detalle: `Debe ${pesos(sm?.totalDeuda ?? 0)} en ${sm?.totalMultas ?? "?"} multa(s): debe pagarlas o hacer acuerdo de pago antes del trámite.` });
  // Impuesto vehicular.
  const im = d.impuestos?.data;
  if (!ok(d.impuestos) || !im) hallazgos.push({ tema: "Impuesto vehicular", parte: "impuesto", estado: "sin_dato", detalle: "No llegó: la fuente del departamento no respondió por esta placa (no se cobró).", faltan: ["impuesto"] });
  else if ((im.totalPendiente ?? 0) > 0) {
    const debe = (im.anios ?? []).filter((a) => !a.pagado).map((a) => a.anio);
    hallazgos.push({ tema: "Impuesto vehicular", parte: "impuesto", estado: "alerta", detalle: `Debe ${pesos(im.totalPendiente!)}${debe.length ? ` · vigencias ${debe.join(", ")}` : ""}${im.departamento ? ` · ${im.departamento}` : ""}.` });
  } else hallazgos.push({ tema: "Impuesto vehicular", parte: "impuesto", estado: "ok", detalle: `Al día${im.departamento ? ` (${im.departamento})` : ""}.` });
  return { hallazgos, runt };
}

/** Prendas y embargos (de la consulta completa o de la básica). */
function gravamenes(s: Sujeto, g: { prenda: boolean; acreedores: string[]; embargos: number; entidad?: string; limitacion?: boolean }): Hallazgo[] {
  const base = { tema: "Prendas y embargos", parte: "gravamenes" as const };
  const levanta = s.nombresEncargo.some((n) => /levantamiento de prenda/i.test(n));
  const h: Hallazgo[] = [];
  if (g.embargos) h.push({ ...base, estado: "bloquea", detalle: `Tiene ${g.embargos} embargo(s)${g.entidad ? ` (${g.entidad})` : ""}.` });
  if (g.limitacion) h.push({ ...base, estado: "bloquea", detalle: "El RUNT reporta gravámenes o limitaciones a la propiedad." });
  if (g.prenda) h.push({ ...base, estado: levanta ? "alerta" : "bloquea", detalle: `Tiene prenda vigente${g.acreedores.length ? ` a favor de ${g.acreedores.join(", ")}` : " (el RUNT no dice a favor de quién)"}${levanta ? ": se levanta en este mismo encargo" : ": hay que levantarla antes del traspaso"}.` });
  if (!h.length) h.push({ ...base, estado: "ok", detalle: "Sin prendas ni embargos." });
  return h;
}

/** La consulta básica del vehículo (1 crédito): registro, prendas, SOAT y técnico-mecánica. Para pedir de nuevo solo eso. */
async function consultaBasica(db: Db, ses: Sesion, s: Sujeto, hoy: string): Promise<{ hallazgos: Hallazgo[]; runt: Runt | null }> {
  const dd = doc(s.vendedor)!;
  const r = await ses.consultar("vehiculo", s.vehiculo?.id ?? `placa:${s.placa}`, "/consulta", { placa: s.placa, ...dd }, 1);
  if (!r.ok) return { hallazgos: [noEncontro(r) ? noEncontrado(s, dd.docNumber) : sinRespuesta(r, DE_LA_BASICA)], runt: null };
  const datos = r.datos ?? {};
  const g = (datos.informacionGeneral ?? null) as Record<string, string | null> | null;
  const lista = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  const hallazgos: Hallazgo[] = [registro(!!g, g?.estadoDelVehiculo)];
  if (!g) hallazgos.push({ tema: "Prendas y embargos", parte: "gravamenes", estado: "sin_dato", detalle: NO_LLEGO, faltan: ["gravamenes"] });
  else {
    const prenda = g.prendas === "SI" || lista(datos.garantiasMobiliarias) > 0 || lista(datos.prendasGarantiaMobiliaria) > 0;
    hallazgos.push(...gravamenes(s, { prenda, acreedores: [], embargos: 0, limitacion: (g.tieneGravamenes === "SI" && g.prendas !== "SI") || lista(datos.limitacionPropiedad) > 0 }));
  }
  const soat = ultimaVigencia(datos.soat), rtm = ultimaVigencia(datos.tecnoMecanica);
  hallazgos.push(
    vigencia("SOAT", "soat", Array.isArray(datos.soat), soat, hoy),
    vigencia("Técnico-mecánica", "rtm", Array.isArray(datos.tecnoMecanica), rtm, hoy, { sinRegistro: "El RUNT no muestra revisión técnico-mecánica (si el vehículo es nuevo puede estar exento)." }),
  );
  const runt: Runt = {
    datos: g ? { marca: g.marca, linea: g.linea, modelo: g.modelo, color: g.color, cilindraje: g.cilindraje, clase: g.claseVehiculo, servicio: g.tipoServicio, motor: g.noMotor, chasis: g.noChasis, serie: g.noSerie, vin: g.noVin, organismoTransito: g.organismoTransito, fechaMatricula: g.fechaMatricula,
      tipoCombustible: g.tipoCombustible, tipoCarroceria: g.tipoCarroceria, pasajerosSentados: g.pasajerosSentados, capacidadCarga: g.capacidadCarga, noLicenciaTransito: g.noLicenciaTransito } : {},
    soat: Array.isArray(datos.soat) ? soat : null, rtm: Array.isArray(datos.tecnoMecanica) ? rtm : null,
  };
  if (s.vehiculo) await absorberVehiculo(db, s.vehiculo, runt);
  return { hallazgos, runt };
}

/** Cierra la revisión: los créditos de verdad (saldo antes y después) si PlacApi los dice; si no, lo que cuesta cada consulta. */
async function terminar(env: EnvConsultas, antes: number | null, ses: Sesion, hallazgos: Hallazgo[], runt: Runt | null): Promise<Resultado> {
  const despues = antes !== null && ses.creditos > 0 ? await creditosDisponibles(env) : null;
  const creditos = antes !== null && despues !== null && antes >= despues ? antes - despues : ses.creditos;
  const hs = ordenar(hallazgos);
  const de = (ps: ParteRevision[]) => hs.some((h) => (h.parte && ps.includes(h.parte)) || (h.faltan ?? []).some((p) => ps.includes(p)) || (!h.parte && h.tema === "Vehículo" && ps === DEL_RUNT));
  const consultado = [...(de(DEL_RUNT) ? (["runt"] as const) : []), ...(de(DEL_SIMIT) ? (["simit"] as const) : [])];
  return { creditos, hallazgos: hs, limpias: limpiasDe(hs), runt, faltaron: faltaronDe(hs), consultado };
}

/** Hace las consultas y arma los hallazgos. Lo que llega queda en la base (vehículo, licencias, respuestas). */
export async function consultarRevision(db: Db, env: EnvConsultas, s: Sujeto, alcance: Alcance = "todo"): Promise<Resultado> {
  if (!env.PLACAPI_KEY) throw new ErrorApi("Falta conectar PlacApi: falta la llave de API.", 503);
  if (s.categoria !== "licencia" && !s.placa && alcance !== "simit") throw new ErrorApi("Falta la placa.", 409);
  const hoy = hoyColombia();
  const antes = await creditosDisponibles(env);
  const ses = sesion(db, env);
  const hallazgos: Hallazgo[] = [];
  let runt: Runt | null = null;

  if (s.categoria === "licencia") {
    // ── Licencia: la licencia del titular (queda en el radar) y su SIMIT ──
    const c = s.titular;
    if (!c?.id || !doc(c)) hallazgos.push({ tema: "Licencia", estado: "sin_dato", detalle: "Falta la cédula del titular." });
    else hallazgos.push(await licencia(db, env, ses, c), await pazSalvo(ses, "simit_titular", "Titular", c));
  } else if (alcance === "simit") {
    // ── Solo el SIMIT: el paz y salvo de cada persona ──
    if (s.vendedor) hallazgos.push(await pazSalvo(ses, "simit_dueno", "Dueño", s.vendedor));
    if (s.comprador) hallazgos.push(await pazSalvo(ses, "simit_comprador", "Comprador", s.comprador));
  } else {
    // ── Vehículo: la consulta completa (o solo la básica del RUNT) con la cédula del dueño ──
    if (!doc(s.vendedor)) hallazgos.push({ tema: "Vehículo", estado: "sin_dato", detalle: "Falta la cédula del dueño: el RUNT la pide para consultar por placa." });
    else { const c = alcance === "runt" ? await consultaBasica(db, ses, s, hoy) : await consultaCompleta(db, ses, s, hoy); hallazgos.push(...c.hallazgos); runt = c.runt; }
    // En un traspaso, el comprador también debe estar a paz y salvo.
    if (alcance === "todo" && s.esTraspaso && s.comprador) hallazgos.push(await pazSalvo(ses, "simit_comprador", "Comprador", s.comprador));
  }
  return terminar(env, antes, ses, hallazgos, runt);
}

/**
 * Pide de nuevo SOLO lo que no llegó en una revisión, con lo más barato que lo traiga (compartido/revision.ts), y lo
 * junta con lo que ya había llegado. Lo que vuelva a fallar sigue marcado.
 */
export async function pedirLoQueFalto(db: Db, env: EnvConsultas, s: Sujeto, previo: { hallazgos: Hallazgo[] }, pedir?: ParteRevision[]): Promise<Resultado> {
  if (!env.PLACAPI_KEY) throw new ErrorApi("Falta conectar PlacApi: falta la llave de API.", 503);
  // `pedir`: partes que no se habían consultado (agregar el SIMIT o el RUNT); si no, lo que no llegó.
  const faltaron = pedir ?? faltaronDe(previo.hallazgos);
  if (!faltaron.length) throw new ErrorApi(pedir ? "Ya estaba consultado." : "La revisión ya está completa: no faltó nada.", 409);
  const plan = planReintento(faltaron);
  const hoy = hoyColombia();
  const antes = await creditosDisponibles(env);
  const ses = sesion(db, env);
  const nuevos: Hallazgo[] = [];
  const pedidas = new Set<ParteRevision>();
  let runt: Runt | null = null;
  if ((plan.completa || plan.basica) && !doc(s.vendedor)) throw new ErrorApi("Falta la cédula del dueño: el RUNT la pide para consultar por placa.", 409);
  if (plan.completa) { const c = await consultaCompleta(db, ses, s, hoy); nuevos.push(...c.hallazgos); runt = c.runt; DE_LA_COMPLETA.forEach((p) => pedidas.add(p)); }
  else if (plan.basica) { const c = await consultaBasica(db, ses, s, hoy); nuevos.push(...c.hallazgos); runt = c.runt; DE_LA_BASICA.forEach((p) => pedidas.add(p)); }
  for (const p of plan.pazSalvo) {
    const c = p === "simit_dueno" ? s.vendedor : p === "simit_comprador" ? s.comprador : s.titular;
    if (!c) continue;
    nuevos.push(await pazSalvo(ses, p, p === "simit_dueno" ? "Dueño" : p === "simit_comprador" ? "Comprador" : "Titular", c));
    pedidas.add(p);
  }
  if (plan.licencia && s.titular?.id) { nuevos.push(await licencia(db, env, ses, s.titular)); pedidas.add("licencia"); }
  // Lo de antes que no se volvió a pedir se queda; lo pedido se reemplaza por lo nuevo.
  const quedan = previo.hallazgos.filter((h) => !(h.parte && pedidas.has(h.parte)) && !(h.faltan ?? []).some((p) => pedidas.has(p)));
  const r = await terminar(env, antes, ses, [...quedan, ...nuevos], runt);
  return { ...r, nuevos: ordenar(nuevos) };
}

/** Lo que el RUNT dice del vehículo queda en el vehículo: lo que le falte, y siempre las fechas de SOAT y técnico-mecánica. */
export async function absorberVehiculo(db: Db, v: typeof E.vehiculos.$inferSelect, runt: Runt) {
  const cambios = await completarDelRunt(db, v, runt.datos);
  if (runt.soat) cambios.soatVence = runt.soat;
  if (runt.rtm) cambios.rtmVence = runt.rtm;
  if (Object.keys(cambios).length) await db.update(E.vehiculos).set(cambios).where(eq(E.vehiculos.id, v.id)).run();
}

/**
 * Aplica una revisión a un trámite: marca lo limpio (si aplica y no estaba; no, si Felipe las dejó pendientes), nota en
 * la bitácora y la guarda. Con `previa` es lo que faltó de esa revisión: la nota dice solo lo nuevo y la revisión
 * guardada suma los créditos de las dos.
 */
export async function aplicarRevision(db: Db, tramiteId: string, r: Resultado, { marcar = true, previa }: { marcar?: boolean; previa?: Revision } = {}): Promise<Revision> {
  const t = (await db.select().from(E.tramites).where(eq(E.tramites.id, tramiteId)).get())!;
  const tipo = (await db.select().from(E.tiposTramite).where(eq(E.tiposTramite.id, t.tipoId)).get())!;
  const aprobadas: string[] = [];
  for (const flag of marcar ? limpiasDe(r.hallazgos) : []) {
    if (!tipo.precondiciones[flag] || t.precondicionesEstado[flag]?.ok) continue;
    await marcarPrecondicion(db, t.id, { flag, ok: true, nota: `Revisión previa PlacApi ${fechaCorta(hoyColombia())}`, origen: "sistema", referencia: "PlacApi" });
    aprobadas.push(PRECONDICION_LABEL[flag]);
  }
  const faltaron = faltaronDe(r.hallazgos);
  const marca = { ok: "OK", alerta: "OJO", bloquea: "FRENA", sin_dato: "SIN DATO" } as const;
  const nota = [
    previa ? `Revisión previa: se pidió de nuevo lo que faltó (PlacApi, ${r.creditos} créditos):` : `Revisión previa (PlacApi, ${r.creditos} créditos):`,
    ...(previa ? r.nuevos ?? r.hallazgos : r.hallazgos).map((h) => `${marca[h.estado]} · ${h.tema}${h.quien ? ` (${h.quien})` : ""}: ${h.detalle}`),
    aprobadas.length ? `Precondiciones marcadas: ${aprobadas.join(", ")}.` : "",
    faltaron.length ? `INCOMPLETA: no llegó ${listaPartes(faltaron)}. Se puede pedir de nuevo solo eso desde la revisión previa del trámite.` : previa ? "Ya llegó todo." : "",
  ].filter(Boolean).join("\n");
  await agregarNota(db, t.id, { texto: nota.slice(0, 2000), origen: "sistema", referencia: "PlacApi" });
  const revision: Revision = { fecha: new Date().toISOString(), creditos: (previa?.creditos ?? 0) + r.creditos, hallazgos: r.hallazgos, aprobadas: [...(previa?.aprobadas ?? []), ...aprobadas], faltaron };
  // La revisión completa se guarda aparte (sin créditos: cada consulta ya quedó registrada con los suyos).
  await db.insert(E.consultasExternas).values({ id: nuevoId(), tipo: "revision", referencia: t.id, creditos: 0, resultado: "ok", detalle: JSON.stringify(revision) }).run();
  return revision;
}

export async function revisarTramite(db: Db, env: EnvConsultas, tramiteId: string): Promise<Revision> {
  const { t, sujeto } = await partes(db, tramiteId);
  if (sujeto.categoria !== "licencia" && !sujeto.vehiculo) throw new ErrorApi("Este trámite no tiene vehículo.", 409);
  return aplicarRevision(db, t.id, await consultarRevision(db, env, sujeto));
}

/** La última revisión guardada de un trámite. */
async function revisionGuardada(db: Db, tramiteId: string): Promise<Revision | null> {
  const fila = await db.select().from(E.consultasExternas).where(and(eq(E.consultasExternas.referencia, tramiteId), eq(E.consultasExternas.tipo, "revision"))).all()
    .then((f) => f.sort((a, b) => b.creado.localeCompare(a.creado))[0]);
  try {
    const r = fila?.detalle ? (JSON.parse(fila.detalle) as Revision) : null;
    return r ? { ...r, faltaron: faltaronDe(r.hallazgos) } : null;
  } catch { return null; }
}

/** Pide de nuevo lo que no llegó en la última revisión del trámite. */
export async function reintentarRevision(db: Db, env: EnvConsultas, tramiteId: string) {
  const previa = await revisionGuardada(db, tramiteId);
  if (!previa) throw new ErrorApi("Este trámite no tiene revisión previa.", 404);
  const { t, sujeto } = await partes(db, tramiteId);
  return json(await aplicarRevision(db, t.id, await pedirLoQueFalto(db, env, sujeto, previa), { previa }));
}

/** El trámite que se está registrando (o la consulta rápida), con lo que se sabe de las personas. */
async function sujetoDeBorrador(db: Db, d: Datos, alcance: Alcance = "todo"): Promise<Sujeto & { placa: string }> {
  const tipoIds = (Array.isArray(d.tipoIds) ? d.tipoIds : []).filter((x): x is string => typeof x === "string");
  const tipos = tipoIds.length ? await db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, tipoIds)) : [];
  const placa = String(d.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!placa && alcance !== "simit") throw new ErrorApi("Falta la placa.");
  const persona = (p: unknown): Persona | undefined => {
    const x = (p ?? {}) as Datos;
    const nombre = String(x.nombre ?? "").trim(), numeroDocumento = String(x.numeroDocumento ?? "").replace(/\D/g, "");
    return nombre || numeroDocumento ? { nombre: nombre || numeroDocumento, numeroDocumento, tipoDocumento: String(x.tipoDocumento || "CC") } : undefined;
  };
  const vendedor = persona(d.vendedor), comprador = persona(d.comprador);
  if (alcance === "simit") { if (!vendedor?.numeroDocumento && !comprador?.numeroDocumento) throw new ErrorApi("Para consultar el SIMIT hace falta al menos una cédula."); }
  else if (!vendedor?.numeroDocumento) throw new ErrorApi("Para verificar con el RUNT hace falta la cédula del vendedor (el dueño actual).");
  // Si las personas ya son clientes, lo que se sepa de ellas (licencias) queda guardado.
  for (const p of [vendedor, comprador]) if (p?.numeroDocumento) p.id = (await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.numeroDocumento, p.numeroDocumento)).get())?.id;
  const vehiculo = await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get();
  return { categoria: "vehiculo", esTraspaso: tipos.some((t) => /traspaso/i.test(t.nombre)) || !!comprador, nombresEncargo: tipos.map((t) => t.nombre), placa, vehiculo, vendedor, comprador };
}

/**
 * POST /api/registrar/verificar  { tipoIds, placa, vendedor: { nombre, tipoDocumento?, numeroDocumento }, comprador? }
 * Revisa el trámite que se está registrando, antes de guardarlo: lo que el RUNT diga del vehículo vuelve para
 * corregir lo leído a mano, y la revisión queda guardada (id) para aplicarla al guardar, sin pagar otra vez.
 */
export async function verificarBorrador(db: Db, env: EnvConsultas, d: Datos) {
  const alcance: Alcance = ALCANCES.includes(d.alcance as Alcance) ? (d.alcance as Alcance) : "todo";
  const sujeto = await sujetoDeBorrador(db, d, alcance);
  const r = await consultarRevision(db, env, sujeto, alcance);
  const id = nuevoId();
  await db.insert(E.consultasExternas).values({ id, tipo: "verificacion", referencia: `placa:${sujeto.placa}`, creditos: 0, resultado: "ok", detalle: `Verificación de ${sujeto.placa} antes de registrar`, respuesta: r }).run();
  return json({ id, ...r });
}

/**
 * POST /api/registrar/verificar/:id/reintentar  (el mismo cuerpo de verificar)
 * Pide de nuevo lo que no llegó en esa verificación y la deja completa (con los créditos de las dos) para aplicarla al guardar.
 */
export async function reintentarVerificacion(db: Db, env: EnvConsultas, id: string, d: Datos) {
  const fila = await db.select().from(E.consultasExternas).where(and(eq(E.consultasExternas.id, id), eq(E.consultasExternas.tipo, "verificacion"))).get();
  const previo = fila?.respuesta as Resultado | undefined;
  if (!fila || !previo) throw new ErrorApi("Esa verificación no existe.", 404);
  const sujeto = await sujetoDeBorrador(db, d, (previo.consultado ?? ["runt"]).includes("runt") ? "todo" : "simit");
  if (fila.referencia !== `placa:${sujeto.placa}`) throw new ErrorApi("La verificación era de otra placa: verifique de nuevo.", 409);
  const nuevo = await pedirLoQueFalto(db, env, sujeto, previo);
  const r: Resultado = { ...nuevo, creditos: previo.creditos + nuevo.creditos, runt: nuevo.runt ?? previo.runt };
  await db.update(E.consultasExternas).set({ respuesta: { ...r, nuevos: undefined } }).where(eq(E.consultasExternas.id, id)).run();
  return json({ id, ...r });
}

/**
 * POST /api/registrar/verificar/:id/agregar  (el mismo cuerpo de verificar, con alcance "runt" o "simit")
 * Le agrega a una verificación lo que no se había pedido: el SIMIT de las personas (1 por cédula) o el RUNT del
 * vehículo (la consulta básica, 1). Queda una sola verificación, con los créditos de las dos, para aplicarla al guardar.
 */
export async function agregarAVerificacion(db: Db, env: EnvConsultas, id: string, d: Datos) {
  const fila = await db.select().from(E.consultasExternas).where(and(eq(E.consultasExternas.id, id), eq(E.consultasExternas.tipo, "verificacion"))).get();
  const previo = fila?.respuesta as Resultado | undefined;
  if (!fila || !previo) throw new ErrorApi("Esa verificación no existe.", 404);
  const alcance = d.alcance === "runt" ? "runt" : d.alcance === "simit" ? "simit" : null;
  if (!alcance) throw new ErrorApi("Diga qué agregar: el RUNT o el SIMIT.");
  const sujeto = await sujetoDeBorrador(db, d, alcance === "runt" ? "todo" : "simit");
  if (fila.referencia !== `placa:${sujeto.placa}`) throw new ErrorApi("La verificación era de otra placa: verifique de nuevo.", 409);
  const ya = new Set(previo.hallazgos.map((h) => h.parte).filter(Boolean));
  const pedir: ParteRevision[] = alcance === "runt" ? DEL_RUNT.filter((p) => !ya.has(p))
    : [...(sujeto.vendedor && !ya.has("simit_dueno") ? (["simit_dueno"] as const) : []), ...(sujeto.comprador && !ya.has("simit_comprador") ? (["simit_comprador"] as const) : [])];
  const nuevo = await pedirLoQueFalto(db, env, sujeto, previo, pedir);
  const r: Resultado = { ...nuevo, creditos: previo.creditos + nuevo.creditos, runt: nuevo.runt ?? previo.runt };
  await db.update(E.consultasExternas).set({ respuesta: { ...r, nuevos: undefined } }).where(eq(E.consultasExternas.id, id)).run();
  return json({ id, ...r });
}

export async function revisar(db: Db, env: EnvConsultas, tramiteId: string) {
  return json(await revisarTramite(db, env, tramiteId));
}

export async function ultimaRevision(db: Db, env: EnvConsultas, tramiteId: string) {
  return json({ conectado: !!env.PLACAPI_KEY, revision: await revisionGuardada(db, tramiteId) });
}

/** Los trámites (de la lista) cuya última revisión quedó incompleta, con lo que faltó. Para el resumen de la mañana. */
export async function revisionesIncompletas(db: Db, tramiteIds: string[]) {
  const fuera = new Map<string, ParteRevision[]>();
  for (let i = 0; i < tramiteIds.length; i += 90) {
    const filas = await db.select({ referencia: E.consultasExternas.referencia, detalle: E.consultasExternas.detalle, creado: E.consultasExternas.creado }).from(E.consultasExternas)
      .where(and(eq(E.consultasExternas.tipo, "revision"), inArray(E.consultasExternas.referencia, tramiteIds.slice(i, i + 90))));
    const ultima = new Map<string, (typeof filas)[number]>();
    for (const f of filas) if (!ultima.has(f.referencia) || ultima.get(f.referencia)!.creado < f.creado) ultima.set(f.referencia, f);
    for (const [ref, f] of ultima) {
      try { const faltan = faltaronDe((JSON.parse(f.detalle ?? "{}") as Revision).hallazgos ?? []); if (faltan.length) fuera.set(ref, faltan); } catch { /* revisión ilegible */ }
    }
  }
  return fuera;
}
