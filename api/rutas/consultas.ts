/*
 * Consultas al RUNT por medio de PlacApi (placapi.com). Cada consulta con datos cuesta créditos prepagados
 * ($349 COP o menos cada uno), así que solo se consulta cuando Felipe lo pide y todo queda registrado.
 *
 *   POST /api/consultas/licencias/:clienteId   Licencias por cédula -> radar con fechas reales (origen "consulta").
 *   POST /api/consultas/vehiculo/:vehiculoId   Ficha del RUNT por placa (+ cédula del dueño) -> SOAT, técnico-mecánica, prendas.
 *   POST /api/consultas/licencias-lote         { cursor? } Radar por lotes: los clientes con cédula y licencias
 *                                              que no se consultaron en 30 días. Devuelve el cursor para seguir.
 *   GET  /api/consultas/resumen                Créditos del mes y últimas consultas.
 *
 * Licencias: 1 crédito si se manda el primer apellido, 2 si PlacApi lo averigua (el RUNT lo exige desde el
 * 6-ago-2026). Se manda solo cuando el nombre no deja dudas; si con ese apellido no hay resultado, se repite sin él.
 * Documentación: https://placapi.com/docs y https://github.com/placapi/placapi-openapi
 */
import { and, desc, eq, gt, gte, like, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { CATEGORIAS_LICENCIA, SERVICIOS_VEHICULO, type Gravamen } from "../../compartido/dominio";
import { claseMasParecida, hoyColombia, organismoDeTexto } from "../../compartido/reglas";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos, type Db } from "../util";

export interface EnvConsultas {
  PLACAPI_KEY?: string;
  /** Solo en las pruebas: servidor falso de PlacApi. */
  PLACAPI_BASE?: string;
}

const POR_LOTE = 4;
const DIAS_VIGENTE = 30;
const PARTICULAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "DA", "DI", "SAN", "SANTA", "MC", "VAN", "VON"]);

/** Primer apellido solo cuando el nombre no deja dudas: "NOMBRE APELLIDO" o "NOMBRE NOMBRE APELLIDO APELLIDO". */
export function primerApellido(nombre: string): string | null {
  // Tal como está escrito (con tildes y eñes): el RUNT compara el apellido exacto.
  const t = nombre.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (t.some((x) => /[^A-ZÁÉÍÓÚÜÑ]/.test(x) || PARTICULAS.has(x))) return null;
  if (t.length === 4) return t[2];
  if (t.length === 2) return t[1];
  return null;
}

/** "23/04/2035" -> "2035-04-23". */
export const fechaRunt = (s: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export interface RespuestaPlacApi { ok: boolean; estado: number; codigo: string | null; datos: Record<string, unknown> | null; mensaje: string }

export async function placapi(env: EnvConsultas, ruta: string, cuerpo: Record<string, unknown>): Promise<RespuestaPlacApi> {
  if (!env.PLACAPI_KEY) throw new ErrorApi("Falta conectar PlacApi: falta la llave de API.", 503);
  let r: Response;
  try {
    r = await fetch(`${env.PLACAPI_BASE ?? "https://placapi.com/api"}${ruta}`, {
      method: "POST",
      headers: { "x-api-key": env.PLACAPI_KEY, "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, estado: 502, codigo: "sin_respuesta", datos: null, mensaje: "PlacApi no respondió. Intente más tarde (no se cobró)." };
  }
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const codigo = typeof d.code === "string" ? d.code : typeof (d.error as Record<string, unknown>)?.code === "string" ? String((d.error as Record<string, unknown>).code) : null;
  if (r.ok) return { ok: true, estado: r.status, codigo, datos: (d.data as Record<string, unknown>) ?? d, mensaje: "" };
  const mensajes: Record<number, string> = {
    401: "La llave de PlacApi no es válida.",
    402: "Se acabaron los créditos de PlacApi. Recargue en placapi.com/comprar.",
    404: "El RUNT no tiene datos para esta consulta.",
    429: "Demasiadas consultas seguidas. Espere un momento.",
    502: "El RUNT no respondió a tiempo. Intente más tarde (no se cobró).",
    503: "El RUNT no está disponible en este momento. Intente más tarde (no se cobró).",
  };
  const mensaje = codigo === "apellido_requerido" ? "PlacApi no pudo averiguar el primer apellido de esta persona (no se cobró)."
    : codigo === "propietario_no_coincide" ? "El documento no corresponde al dueño actual del vehículo en el RUNT."
    : mensajes[r.status] ?? `PlacApi respondió con un error (${r.status}).`;
  return { ok: false, estado: r.status, codigo, datos: null, mensaje };
}

/** Anota una consulta (con sus créditos) y, si respondió, lo que trajo completo. */
export function registrar(db: Db, tipo: string, referencia: string, creditos: number, resultado: "ok" | "sin_datos" | "error", detalle: string, respuesta?: unknown) {
  return db.insert(E.consultasExternas).values({ id: nuevoId(), tipo, referencia, creditos, resultado, detalle: detalle.slice(0, 500), respuesta: respuesta ?? null });
}

/* ───────────────────────── licencias por cédula ───────────────────────── */

interface LicenciaRunt { category?: string; status?: string; expeditionDate?: string; dueDate?: string; startDateSuspension?: string | null; endDateSuspension?: string | null }

export async function consultarLicenciasDe(db: Db, env: EnvConsultas, clienteId: string) {
  const c = await db.select().from(E.clientes).where(eq(E.clientes.id, clienteId)).get();
  if (!c) throw new ErrorApi("El cliente no existe.", 404);
  if (!c.numeroDocumento) throw new ErrorApi("El cliente no tiene cédula registrada: el RUNT consulta por documento.", 409);

  const apellido = primerApellido(c.nombre);
  let r = await placapi(env, "/licencia", { docType: c.tipoDocumento, docNumber: c.numeroDocumento, ...(apellido ? { primerApellido: apellido } : {}) });
  let creditos = r.ok ? (apellido ? 1 : 2) : 0;
  // Con un apellido mal deducido el RUNT no encuentra a la persona: se repite y PlacApi lo averigua.
  if (!r.ok && apellido && r.estado === 404) {
    r = await placapi(env, "/licencia", { docType: c.tipoDocumento, docNumber: c.numeroDocumento });
    creditos = r.ok ? 2 : 0;
  }
  if (!r.ok) {
    const resultado = r.estado === 404 ? "sin_datos" : "error";
    await registrar(db, "licencia", clienteId, 0, resultado, `${r.codigo ?? r.estado}: ${r.mensaje}`).run();
    if ([401, 402, 429, 503].includes(r.estado)) throw new ErrorApi(r.mensaje, r.estado === 401 ? 502 : r.estado);
    return { clienteId, nombre: c.nombre, resultado, mensaje: r.mensaje, creditos: 0, categorias: [] as { categoria: string; vence: string | null; estado: string }[] };
  }

  const lista = (Array.isArray(r.datos?.licenses) ? r.datos!.licenses : []) as LicenciaRunt[];
  const validas = lista
    .map((l) => ({ categoria: String(l.category ?? "").toUpperCase().trim(), vence: fechaRunt(l.dueDate), expedida: fechaRunt(l.expeditionDate), estado: String(l.status ?? "") }))
    .filter((l) => (CATEGORIAS_LICENCIA as readonly string[]).includes(l.categoria) && l.vence);
  const items = validas.map((l) =>
    db.insert(E.licencias)
      .values({ id: nuevoId(), clienteId, categoria: l.categoria, fechaExpedicion: l.expedida, fechaVencimiento: l.vence!, origen: "consulta" })
      .onConflictDoUpdate({ target: [E.licencias.clienteId, E.licencias.categoria], set: { fechaExpedicion: l.expedida, fechaVencimiento: l.vence!, origen: "consulta" } }));
  const multas = (r.datos?.infractions as { tieneMultas?: string } | null)?.tieneMultas;
  const resumen = validas.length
    ? `${validas.map((l) => `${l.categoria} vence ${l.vence}${l.estado && l.estado !== "ACTIVA" ? ` (${l.estado.toLowerCase()})` : ""}`).join(", ")}${multas === "SI" ? " · tiene multas" : ""}`
    : "Sin licencias en el RUNT";
  await db.batch([...items, registrar(db, "licencia", clienteId, creditos, validas.length ? "ok" : "sin_datos", resumen, r.datos)] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { clienteId, nombre: c.nombre, resultado: validas.length ? "ok" : "sin_datos", mensaje: resumen, creditos, multas: multas === "SI", categorias: validas.map((l) => ({ categoria: l.categoria, vence: l.vence, estado: l.estado })) };
}

export async function consultarLicencias(db: Db, env: EnvConsultas, clienteId: string) {
  return json(await consultarLicenciasDe(db, env, clienteId));
}

/** Los clientes del radar con cédula que no se consultaron en los últimos 30 días, por lotes y en orden de id. */
export async function consultarLicenciasLote(db: Db, env: EnvConsultas, d: Datos) {
  const cursor = typeof d.cursor === "string" ? d.cursor : "";
  const desde = new Date(Date.now() - DIAS_VIGENTE * 10_000_000).toISOString();
  const pendientes = sql`${E.clientes.numeroDocumento} <> '' AND EXISTS (SELECT 1 FROM licencias l WHERE l.cliente_id = ${E.clientes.id})
    AND NOT EXISTS (SELECT 1 FROM consultas_externas q WHERE q.tipo = 'licencia' AND q.referencia = ${E.clientes.id} AND q.resultado <> 'error' AND q.creado >= ${desde})`;
  const lote = await db.select({ id: E.clientes.id }).from(E.clientes).where(and(sql`${pendientes}`, gt(E.clientes.id, cursor))).orderBy(E.clientes.id).limit(POR_LOTE);
  const resultados = [];
  for (const c of lote) {
    try {
      resultados.push(await consultarLicenciasDe(db, env, c.id));
    } catch (e) {
      // Sin créditos, llave mala o límite: se detiene el lote y se avisa.
      if (e instanceof ErrorApi) return json({ resultados, siguiente: null, restantes: null, detenido: e.message });
      throw e;
    }
  }
  const restantes = (await db.select({ n: sql<number>`count(*)` }).from(E.clientes).where(sql`${pendientes}`).get())?.n ?? 0;
  return json({ resultados, siguiente: lote.length === POR_LOTE && restantes > 0 ? lote[lote.length - 1].id : null, restantes, detenido: null });
}

/** Cuántos faltan por consultar y cuánto costaría, antes de empezar el lote. */
export async function estimarLote(db: Db) {
  const desde = new Date(Date.now() - DIAS_VIGENTE * 10_000_000).toISOString();
  const filas = await db.select({ nombre: E.clientes.nombre }).from(E.clientes).where(sql`${E.clientes.numeroDocumento} <> '' AND EXISTS (SELECT 1 FROM licencias l WHERE l.cliente_id = ${E.clientes.id})
    AND NOT EXISTS (SELECT 1 FROM consultas_externas q WHERE q.tipo = 'licencia' AND q.referencia = ${E.clientes.id} AND q.resultado <> 'error' AND q.creado >= ${desde})`);
  const conApellido = filas.filter((f) => primerApellido(f.nombre)).length;
  return json({ clientes: filas.length, creditosMin: conApellido + (filas.length - conApellido) * 2, creditosMax: filas.length * 2 });
}

/* ───────────────────────── vehículo por placa ───────────────────────── */

/** Lo que trae el RUNT del vehículo, con nombres de la app (sirve para /consulta y para /consulta-full). */
export interface DatosRunt {
  marca?: unknown; linea?: unknown; modelo?: unknown; color?: unknown; cilindraje?: unknown; clase?: unknown; servicio?: unknown; motor?: unknown; chasis?: unknown; serie?: unknown; vin?: unknown;
  organismoTransito?: unknown; fechaMatricula?: unknown;
  // /consulta los llama tipoCombustible, tipoCarroceria, pasajerosSentados, capacidadCarga, noLicenciaTransito; se aceptan ambos nombres.
  combustible?: unknown; tipoCombustible?: unknown; carroceria?: unknown; tipoCarroceria?: unknown; capacidad?: unknown; pasajerosSentados?: unknown; capacidadCarga?: unknown;
  potencia?: unknown; licenciaTransito?: unknown; noLicenciaTransito?: unknown;
}
/**
 * Completa el vehículo con lo que trae el RUNT: solo lo que le falte (lo que ya tiene no se toca). Motor, chasis, VIN,
 * clase, servicio y el organismo donde está matriculado son los que pide el formulario único.
 */
export async function completarDelRunt(db: Db, v: typeof E.vehiculos.$inferSelect, r: DatosRunt): Promise<Partial<typeof E.vehiculos.$inferInsert>> {
  const t = (x: unknown) => { const s = String(x ?? "").trim(); return s && s.toLowerCase() !== "null" ? s : null; };
  const entero = (x: unknown) => (t(x) && Number.isFinite(Number(t(x))) ? Number(t(x)) : null);
  const servicio = t(r.servicio)?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") ?? null;
  const c: Partial<typeof E.vehiculos.$inferInsert> = {};
  if (!v.marca && t(r.marca)) c.marca = t(r.marca);
  if (!v.linea && t(r.linea)) c.linea = t(r.linea);
  if (!v.modelo && entero(r.modelo)) c.modelo = entero(r.modelo);
  if (!v.color && t(r.color)) c.color = t(r.color);
  if (!v.cilindraje && entero(r.cilindraje)) c.cilindraje = entero(r.cilindraje);
  if (!v.clase && t(r.clase)) c.clase = claseMasParecida(t(r.clase)) ?? t(r.clase);
  if (!v.servicio && servicio && (SERVICIOS_VEHICULO as readonly string[]).includes(servicio)) c.servicio = servicio;
  if (!v.numeroMotor && t(r.motor)) c.numeroMotor = t(r.motor);
  if (!v.numeroChasis && t(r.chasis)) c.numeroChasis = t(r.chasis);
  if (!v.numeroSerie && t(r.serie)) c.numeroSerie = t(r.serie);
  if (!v.vin && t(r.vin)) c.vin = t(r.vin);
  if (!v.fechaMatricula && fechaRunt(r.fechaMatricula)) c.fechaMatricula = fechaRunt(r.fechaMatricula);
  const combustible = t(r.combustible) ?? t(r.tipoCombustible), carroceria = t(r.carroceria) ?? t(r.tipoCarroceria);
  const capacidad = t(r.capacidad) ?? t(r.pasajerosSentados) ?? t(r.capacidadCarga), licencia = t(r.licenciaTransito) ?? t(r.noLicenciaTransito);
  if (!v.combustible && combustible) c.combustible = combustible.toUpperCase();
  if (!v.carroceria && carroceria) c.carroceria = carroceria.toUpperCase();
  if (!v.capacidad && capacidad) c.capacidad = capacidad;
  if (!v.potencia && t(r.potencia)) c.potencia = t(r.potencia);
  if (!v.licenciaTransito && licencia) c.licenciaTransito = licencia;
  if (!v.organismoMatriculaId && t(r.organismoTransito)) {
    const o = organismoDeTexto(await db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos), t(r.organismoTransito));
    if (o) c.organismoMatriculaId = o.id;
  }
  return c;
}

interface Vigencia { fechaVencimiento?: string; estado?: string }
export const ultimaVigencia = (l: unknown) => {
  const fechas = (Array.isArray(l) ? (l as Vigencia[]) : []).map((x) => fechaRunt(x.fechaVencimiento)).filter((f): f is string => !!f).sort();
  return fechas.at(-1) ?? null;
};

export async function consultarVehiculo(db: Db, env: EnvConsultas, vehiculoId: string) {
  const v = await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, vehiculoId)).get();
  if (!v) throw new ErrorApi("El vehículo no existe.", 404);
  const dueno = v.titularId ? await db.select().from(E.clientes).where(eq(E.clientes.id, v.titularId)).get() : undefined;
  if (!dueno?.numeroDocumento) throw new ErrorApi("El dueño del vehículo no tiene cédula registrada: el RUNT la exige para consultar por placa.", 409);

  const r = await placapi(env, "/consulta", { placa: v.placa, docType: dueno.tipoDocumento, docNumber: dueno.numeroDocumento });
  if (!r.ok) {
    await registrar(db, "vehiculo", vehiculoId, 0, r.estado === 404 ? "sin_datos" : "error", `${r.codigo ?? r.estado}: ${r.mensaje}`).run();
    throw new ErrorApi(r.mensaje, r.estado === 404 ? 404 : r.estado === 401 ? 502 : r.estado >= 500 ? 502 : r.estado);
  }
  const g = (r.datos?.informacionGeneral ?? {}) as Record<string, string | null>;
  const soat = ultimaVigencia(r.datos?.soat);
  const rtm = ultimaVigencia(r.datos?.tecnoMecanica);
  const runt: Gravamen[] = [];
  if (g.prendas === "SI") runt.push({ tipo: "prenda", origen: "RUNT", descripcion: "El RUNT reporta prenda" });
  if (g.tieneGravamenes === "SI" && g.prendas !== "SI") runt.push({ tipo: "limitacion_dominio", origen: "RUNT", descripcion: "El RUNT reporta gravámenes o limitaciones" });
  const lista = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  if (lista(r.datos?.limitacionPropiedad)) runt.push({ tipo: "limitacion_dominio", origen: "RUNT", descripcion: `El RUNT reporta ${lista(r.datos?.limitacionPropiedad)} limitación(es) a la propiedad` });
  if (g.prendas !== "SI" && (lista(r.datos?.garantiasMobiliarias) || lista(r.datos?.prendasGarantiaMobiliaria))) runt.push({ tipo: "prenda", origen: "RUNT", descripcion: "El RUNT reporta garantía mobiliaria" });
  const gravamenes = [...v.gravamenes.filter((x) => x.origen !== "RUNT"), ...runt];
  const cambios: Partial<typeof E.vehiculos.$inferInsert> = {
    soatVence: soat ?? v.soatVence, rtmVence: rtm ?? v.rtmVence, gravamenes,
    ...(await completarDelRunt(db, v, { marca: g.marca, linea: g.linea, modelo: g.modelo, color: g.color, cilindraje: g.cilindraje, clase: g.claseVehiculo, servicio: g.tipoServicio, motor: g.noMotor, chasis: g.noChasis, serie: g.noSerie, vin: g.noVin, organismoTransito: g.organismoTransito, fechaMatricula: g.fechaMatricula,
      tipoCombustible: g.tipoCombustible, tipoCarroceria: g.tipoCarroceria, pasajerosSentados: g.pasajerosSentados, capacidadCarga: g.capacidadCarga, noLicenciaTransito: g.noLicenciaTransito })),
  };
  const resumen = `SOAT ${soat ?? "sin dato"} · técnico-mecánica ${rtm ?? "sin dato"}${runt.length ? ` · ${runt.map((x) => x.descripcion).join(", ")}` : ""}`;
  await db.batch([db.update(E.vehiculos).set(cambios).where(eq(E.vehiculos.id, vehiculoId)), registrar(db, "vehiculo", vehiculoId, 1, "ok", resumen, r.datos)]);
  return json({ vehiculoId, placa: v.placa, soat, rtm, gravamenes: runt, mensaje: resumen, creditos: 1 });
}

/* ───────────────────────── resumen ───────────────────────── */

export async function resumen(db: Db, env: EnvConsultas) {
  const mes = `${new Date().toISOString().slice(0, 7)}-01`;
  const [total, ultimas] = await Promise.all([
    db.select({ creditos: sql<number>`coalesce(sum(${E.consultasExternas.creditos}), 0)`, consultas: sql<number>`count(*)` }).from(E.consultasExternas).where(gte(E.consultasExternas.creado, mes)).get(),
    db.select({ id: E.consultasExternas.id, tipo: E.consultasExternas.tipo, referencia: E.consultasExternas.referencia, creditos: E.consultasExternas.creditos, resultado: E.consultasExternas.resultado, detalle: E.consultasExternas.detalle, creado: E.consultasExternas.creado })
      .from(E.consultasExternas).orderBy(desc(E.consultasExternas.creado)).limit(20),
  ]);
  return json({ conectado: !!env.PLACAPI_KEY, mes: { creditos: total?.creditos ?? 0, consultas: total?.consultas ?? 0 }, ultimas });
}


/* ───────────────────────── consultas para el asistente ───────────────────────── */
// Cada consulta queda guardada completa (consultas_externas.respuesta): si se pide lo mismo el mismo día, se responde
// con lo guardado, gratis, salvo que Felipe pida actualizar. Todo lo que traen queda en la base: el vehículo (si existe)
// se completa con el RUNT y las licencias del dueño entran al radar.

const desdeHoy = () => `${hoyColombia()}T05:00:10.000Z`;
/** La última consulta de hoy de ese tipo y referencia, si respondió. */
async function deHoy(db: Db, tipo: string, referencia: string, cedula?: string) {
  // Una placa se reutiliza solo con la MISMA cédula: con otra, el RUNT puede decir que no es el dueño (antes se
  // devolvía lo de la cédula correcta a una equivocada).
  return db.select({ respuesta: E.consultasExternas.respuesta, creado: E.consultasExternas.creado }).from(E.consultasExternas)
    .where(and(eq(E.consultasExternas.tipo, tipo), eq(E.consultasExternas.referencia, referencia), eq(E.consultasExternas.resultado, "ok"), gte(E.consultasExternas.creado, desdeHoy()),
      cedula ? like(E.consultasExternas.detalle, `%cédula ${cedula}:%`) : undefined))
    .orderBy(desc(E.consultasExternas.creado)).get();
}
/** Una consulta que falla por algo de fondo (llave, créditos, límite) se dice tal cual. */
function errorDe(r: RespuestaPlacApi) {
  return { error: r.mensaje, sin_costo: true };
}
const tipoDoc = (t: unknown) => { const s = String(t ?? "CC").toUpperCase(); return s === "PASAPORTE" ? "PA" : ["CC", "CE", "TI", "PA", "NIT", "PPT"].includes(s) ? s : "CC"; };

/** Las licencias que trae el RUNT de una persona, al radar (por categoría: la más nueva reemplaza). */
export async function absorberLicencias(db: Db, clienteId: string, licencias: unknown) {
  const validas = (Array.isArray(licencias) ? (licencias as LicenciaRunt[]) : [])
    .map((l) => ({ categoria: String(l.category ?? "").toUpperCase().trim(), vence: fechaRunt(l.dueDate), expedida: fechaRunt(l.expeditionDate) }))
    .filter((l) => (CATEGORIAS_LICENCIA as readonly string[]).includes(l.categoria) && l.vence);
  for (const l of validas) {
    await db.insert(E.licencias).values({ id: nuevoId(), clienteId, categoria: l.categoria, fechaExpedicion: l.expedida, fechaVencimiento: l.vence!, origen: "consulta" })
      .onConflictDoUpdate({ target: [E.licencias.clienteId, E.licencias.categoria], set: { fechaExpedicion: l.expedida, fechaVencimiento: l.vence!, origen: "consulta" } }).run();
  }
  return validas.length;
}

/** ¿Debe comparendos esta persona? SIMIT por cédula (1 crédito), con el detalle de cada uno. */
export async function comparendosDe(db: Db, env: EnvConsultas, a: { numeroDocumento: unknown; tipoDocumento?: unknown; actualizar?: unknown }) {
  const doc = String(a.numeroDocumento ?? "").replace(/\D/g, "");
  if (!doc) return { error: "Falta el número de documento: pregúntalo." };
  const cliente = await db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(eq(E.clientes.numeroDocumento, doc)).get();
  const ref = cliente?.id ?? `doc:${doc}`;
  const previa = a.actualizar ? undefined : await deHoy(db, "comparendos", ref);
  let datos = previa?.respuesta as Record<string, unknown> | undefined;
  let creditos = 0;
  if (!datos) {
    const r = await placapi(env, "/comparendos", { docType: tipoDoc(a.tipoDocumento), docNumber: doc });
    if (!r.ok) { await registrar(db, "comparendos", ref, 0, r.estado === 404 ? "sin_datos" : "error", `${r.codigo ?? r.estado}: ${r.mensaje}`).run(); return r.estado === 404 ? { documento: doc, paz_y_salvo: true, total_deuda: 0, comparendos: [], nota: "El SIMIT no tiene comparendos con ese documento." } : errorDe(r); }
    datos = r.datos ?? {};
    creditos = 1;
    await registrar(db, "comparendos", ref, 1, "ok", `Comparendos: ${datos.totalComparendos ?? 0} · debe $${Number(datos.totalDeuda ?? 0).toLocaleString("es-CO")}`, datos).run();
  }
  const lista = (Array.isArray(datos.comparendos) ? datos.comparendos : []) as Record<string, unknown>[];
  return {
    documento: doc, persona: cliente?.nombre ?? null, total_deuda: Number(datos.totalDeuda ?? 0), cantidad: Number(datos.totalComparendos ?? lista.length), paz_y_salvo: !Number(datos.totalDeuda ?? 0),
    comparendos: lista.slice(0, 15).map((c) => ({ fecha: c.fecha, infraccion: c.infraccion, codigo: c.codigo, valor: c.valor, estado: c.estado, organismo: c.organismo, tipo: c.tipo })),
    creditos_gastados: creditos, ...(previa ? { de_hoy: `consultado hoy a las ${new Date(previa.creado).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" })}; sin costo` } : {}),
  };
}

/**
 * Una placa en el RUNT: "comparendos" = multas del SIMIT por placa (1 crédito); "gravamenes" = la consulta básica (1):
 * estado del registro, prenda, gravámenes o limitaciones a la propiedad (sin decir a favor de quién), SOAT y
 * técnico-mecánica; "todo" = la consulta completa (3): lo anterior con a favor de quién está la prenda y quién embargó,
 * multas del dueño e impuesto. Pide la cédula del dueño actual (el RUNT la exige): si la placa está en la base, la toma
 * de ahí. Lo que trae queda en el vehículo. Los gravámenes van resumidos (`gravamenes`): lo que no llegó lo dice así,
 * nunca como "no tiene".
 */
export async function consultarPlaca(db: Db, env: EnvConsultas, a: { placa: unknown; numeroDocumento?: unknown; tipoDocumento?: unknown; que?: unknown; actualizar?: unknown }) {
  const placa = String(a.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!placa) return { error: "Falta la placa." };
  const v = await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get();
  const dueno = v?.titularId ? await db.select().from(E.clientes).where(eq(E.clientes.id, v.titularId)).get() : undefined;
  const doc = String(a.numeroDocumento ?? "").replace(/\D/g, "") || dueno?.numeroDocumento || "";
  if (!doc) return { error: `El RUNT pide la cédula del dueño actual de ${placa}${v ? "" : " (no está en la base)"}: pregúntala.` };
  const todo = a.que === "todo", basica = a.que === "gravamenes";
  const tipoReg = todo ? "consulta_full" : basica ? "vehiculo" : "multas";
  const ref = v?.id ?? `placa:${placa}`;
  const previa = a.actualizar ? undefined : await deHoy(db, tipoReg, ref, doc);
  let datos = previa?.respuesta as Record<string, unknown> | undefined;
  let creditos = 0;
  if (!datos) {
    const r = await placapi(env, todo ? "/consulta-full" : basica ? "/consulta" : "/multas", { placa, docType: tipoDoc(a.tipoDocumento ?? dueno?.tipoDocumento), docNumber: doc });
    if (!r.ok) { await registrar(db, tipoReg, ref, 0, r.estado === 404 ? "sin_datos" : "error", `${r.codigo ?? r.estado}: ${r.mensaje}`).run(); return r.estado === 404 ? { error: `El RUNT no tiene ${placa} con la cédula ${doc}: revisa la placa y que sea la cédula del dueño actual. (No se cobró.)` } : errorDe(r); }
    datos = r.datos ?? {};
    creditos = todo ? 3 : 1;
    await registrar(db, tipoReg, ref, creditos, "ok", `${placa} con cédula ${doc}: respondió`, datos).run();
  }
  const fuera = { placa, cedula_dueno: doc, creditos_gastados: creditos, ...(previa ? { de_hoy: "consultado hoy; sin costo" } : {}) };
  if (basica) {
    // La consulta básica: el resumen de los gravámenes (y lo que trae queda en el vehículo, si está en la base).
    const g = (datos.informacionGeneral ?? null) as Record<string, string | null> | null;
    const lista = (x: unknown) => (Array.isArray(x) ? x.length : 0);
    if (!g) return { ...fuera, no_llego: ["registro y gravámenes"], gravamenes: null, aviso: "No llegó lo del registro (la fuente no respondió): NO digas si tiene o no gravámenes. Se puede pedir de nuevo con actualizar=true." };
    const prenda = g.prendas === "SI" || lista(datos.garantiasMobiliarias) > 0 || lista(datos.prendasGarantiaMobiliaria) > 0;
    const limitaciones = (g.tieneGravamenes === "SI" && g.prendas !== "SI") || lista(datos.limitacionPropiedad) > 0;
    const soat = ultimaVigencia(datos.soat), rtm = ultimaVigencia(datos.tecnoMecanica);
    if (v && !previa) {
      const cambios = await completarDelRunt(db, v, { marca: g.marca, linea: g.linea, modelo: g.modelo, color: g.color, cilindraje: g.cilindraje, clase: g.claseVehiculo, servicio: g.tipoServicio, motor: g.noMotor, chasis: g.noChasis, serie: g.noSerie, vin: g.noVin, organismoTransito: g.organismoTransito, fechaMatricula: g.fechaMatricula });
      if (soat) cambios.soatVence = soat;
      if (rtm) cambios.rtmVence = rtm;
      if (Object.keys(cambios).length) await db.update(E.vehiculos).set(cambios).where(eq(E.vehiculos.id, v.id)).run();
    }
    return {
      ...fuera,
      vehiculo: { marca: g.marca, linea: g.linea, modelo: g.modelo, clase: g.claseVehiculo, organismo: g.organismoTransito },
      estado_registro: g.estadoDelVehiculo ?? null,
      gravamenes: {
        tiene_alguno: prenda || limitaciones,
        prenda: prenda ? "SÍ tiene prenda o garantía mobiliaria (esta consulta no dice a favor de quién; para saberlo, la consulta completa: 3 créditos)" : "no tiene prenda",
        embargos_o_limitaciones: limitaciones ? "SÍ tiene gravámenes o limitaciones a la propiedad (embargo u otra; el detalle sale en la consulta completa)" : "no tiene embargos ni limitaciones",
      },
      soat_vence: soat, tecnomecanica_vence: rtm,
    };
  }
  if (!todo) {
    const multas = (Array.isArray(datos.multas) ? datos.multas : []) as Record<string, unknown>[];
    return { ...fuera, total_deuda: Number(datos.totalDeuda ?? 0), cantidad: Number(datos.totalMultas ?? multas.length), acuerdos_de_pago: datos.acuerdosPago ?? 0,
      multas: multas.slice(0, 15).map((m) => ({ fecha: m.fecha, infraccion: m.infraccion, valor: m.valor, estado: m.estado, organismo: m.organismo, de_la_placa: m.asociadaPlaca, del_dueno: m.asociadaDocumento })) };
  }
  // La consulta completa: se resume y lo que trae queda en el vehículo (si está en la base) y en el radar de licencias del dueño.
  type F<T> = { status?: string; data?: T } | undefined;
  const d = datos as { vehicle?: F<Record<string, unknown>>; soat?: F<{ vigente?: boolean; fechaVencimiento?: string }>; rtm?: F<{ vigente?: boolean; exento?: boolean; fechaVencimiento?: string }>;
    antecedentes?: F<{ prendas?: { acreedor?: string }[]; embargos?: unknown[] }>; simit?: F<{ pazSalvo?: boolean; totalDeuda?: number; totalMultas?: number }>;
    impuestos?: F<{ totalPendiente?: number; departamento?: string; anios?: { anio: number; pagado: boolean }[] }>; licencia?: { data?: { licenses?: unknown[] } } };
  const veh = d.vehicle?.data ?? {};
  const noLlego = ([["registro del vehículo", d.vehicle], ["SOAT", d.soat], ["técnico-mecánica", d.rtm], ["prendas y embargos", d.antecedentes], ["multas del dueño", d.simit], ["impuesto", d.impuestos]] as const)
    .filter(([, f]) => !f?.data || f.status === "error").map(([n]) => n);
  if (v && !previa) {
    const cambios = await completarDelRunt(db, v, { ...veh, serie: veh.numeroSerie });
    const soat = fechaRunt(d.soat?.data?.fechaVencimiento), rtm = fechaRunt(d.rtm?.data?.fechaVencimiento);
    if (soat) cambios.soatVence = soat;
    if (rtm) cambios.rtmVence = rtm;
    if (Object.keys(cambios).length) await db.update(E.vehiculos).set(cambios).where(eq(E.vehiculos.id, v.id)).run();
    if (dueno && dueno.numeroDocumento === doc && d.licencia?.data?.licenses) await absorberLicencias(db, dueno.id, d.licencia.data.licenses);
  }
  return {
    ...fuera,
    vehiculo: { marca: veh.marca, linea: veh.linea, modelo: veh.modelo, clase: veh.clase, color: veh.color, cilindraje: veh.cilindraje, servicio: veh.servicio, estado: veh.estado, organismo: veh.organismoTransito },
    soat: d.soat?.data ?? null, tecnomecanica: d.rtm?.data ?? null,
    prendas: d.antecedentes?.data?.prendas ?? null, embargos: d.antecedentes?.data?.embargos ?? null,
    // El resumen de los gravámenes, para no interpretar listas: si no llegó, lo dice (nunca "no tiene").
    gravamenes: d.antecedentes?.data && d.antecedentes.status !== "error" ? (() => {
      const prendas = d.antecedentes!.data!.prendas ?? [], embargos = (d.antecedentes!.data!.embargos ?? []) as { entidad?: string }[];
      const acreedores = prendas.map((p) => p.acreedor ?? "").filter((x) => x && !/sin detalle/i.test(x));
      return {
        tiene_alguno: prendas.length > 0 || embargos.length > 0,
        prenda: prendas.length ? `SÍ tiene ${prendas.length === 1 ? "una prenda" : `${prendas.length} prendas`}${acreedores.length ? ` a favor de ${acreedores.join(", ")}` : " (el RUNT no dice a favor de quién)"}` : "no tiene prenda",
        embargos: embargos.length ? `SÍ tiene ${embargos.length === 1 ? "un embargo" : `${embargos.length} embargos`}${embargos[0]?.entidad ? ` (${embargos.map((e) => e.entidad).filter(Boolean).join(", ")})` : ""}` : "no tiene embargos",
      };
    })() : "NO LLEGÓ (la fuente no respondió): no se sabe si tiene prendas o embargos; no digas que no tiene",
    multas_del_dueno: d.simit?.data ? { paz_y_salvo: d.simit.data.pazSalvo, total_deuda: d.simit.data.totalDeuda, cantidad: d.simit.data.totalMultas } : null,
    impuesto: d.impuestos?.data ? { pendiente: d.impuestos.data.totalPendiente, departamento: d.impuestos.data.departamento, anios_sin_pagar: (d.impuestos.data.anios ?? []).filter((x) => !x.pagado).map((x) => x.anio) } : null,
    guardado_en_la_base: !!v,
    ...(noLlego.length ? { no_llego: noLlego, aviso: "Estas partes no llegaron (la fuente no respondió; PlacApi no las cobra): díselo a Felipe. Se pueden pedir de nuevo con actualizar=true." } : {}),
  };
}

/** Los créditos que quedan en PlacApi (gratis), o null si no respondió: para contar lo que de verdad se cobró. */
export async function creditosDisponibles(env: EnvConsultas): Promise<number | null> {
  if (!env.PLACAPI_KEY) return null;
  try {
    const r = await fetch(`${env.PLACAPI_BASE ?? "https://placapi.com/api"}/me`, { headers: { "x-api-key": env.PLACAPI_KEY }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const n = ((await r.json()) as { cuenta?: { creditos?: unknown } }).cuenta?.creditos;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Saldo de PlacApi (gratis). */
export async function saldoPlacApi(env: EnvConsultas) {
  if (!env.PLACAPI_KEY) return { error: "PlacApi no está conectado." };
  try {
    const r = await fetch(`${env.PLACAPI_BASE ?? "https://placapi.com/api"}/me`, { headers: { "x-api-key": env.PLACAPI_KEY }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { error: `PlacApi respondió ${r.status}.` };
    const d = (await r.json()) as { cuenta?: { creditos?: number }; consumo?: { mes?: { creditos?: number; consultas?: number; costoCop?: number } } };
    return { creditos_disponibles: d.cuenta?.creditos ?? null, este_mes: d.consumo?.mes ?? null, precio_por_credito: "unos $349" };
  } catch { return { error: "PlacApi no respondió." }; }
}
