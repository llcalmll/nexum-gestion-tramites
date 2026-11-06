/*
 * POST /api/asistente       { mensajes: [{ rol: "yo" | "ia", texto }] } -> { respuesta, propuestas, acciones }
 * POST /api/asistente/voz   El cuerpo es el audio (webm u mp4) -> { texto }. Whisper en Workers AI (Cloudflare).
 *
 * Asistente interno de Felipe (gpt-4o-mini con herramientas). Consulta la base y, cuando Felipe se lo pide, HACE
 * cambios sencillos él mismo: anotar en un trámite, cambiar su estado (aprobando las precondiciones si se lo pide),
 * marcar precondiciones, crear recordatorios y corregir datos de clientes, vehículos y trámites (diciendo antes → después).
 * Usa las mismas funciones de las rutas (mismas reglas) y todo queda en la bitácora marcado "asistente"; la app muestra
 * cada acción hecha. La plata (pagos, valor cobrado, costos) sigue saliendo como propuesta que Felipe confirma.
 * El monitor de WhatsApp usa el mismo bucle, pero sin estas acciones: él solo propone.
 * Topes: 6 vueltas de herramientas en el asistente (5 en WhatsApp), 700 tokens por respuesta, 16 mensajes.
 */
import { and, desc, eq, inArray, like, notInArray, or, sql } from "drizzle-orm";
import { CATEGORIA_LABEL, type CategoriaTramite, CATEGORIAS_LICENCIA, codigoTramite, ESTADO_GESTION_LICENCIA_LABEL, ESTADO_TARJETA_LABEL, ESTADO_TRAMITE_LABEL, ESTADOS_EN_USO, ESTADOS_GESTION_LICENCIA, ESTADOS_TARJETA, ESTADOS_TERMINALES, type EstadoGestionLicencia, type EstadoTarjeta, type EstadoTramite, normalizar, PRECONDICION_LABEL, PRECONDICIONES, type Precondicion, ROL_PERSONA_LABEL, ROLES_PERSONA, type RolPersona } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { AVISO_HONORARIOS_UNA_VEZ, avisosEdadLicencia, calcularCostos, categoriasDeTexto, datosQueFaltan, esFecha, sinDato, honorariosUnaVez, motoSinImpuesto, organismoDeTexto, tiposDelTexto, abreviaturasAmbiguas, evaluarPrecondiciones, hoyColombia, leerTramos, sumarDias } from "../../compartido/reglas";
import { avaluoDe, crearRecordatorio, seguimientoLicencia } from "./apoyo";
import { agregarNota, agregarPersona, cambiarEstado, destacarBitacora, editarTramite, marcarPrecondicion, quitarPersona } from "./tramites";
import { crearCliente, editarCliente, editarVehiculo, registrarLicencias } from "./personas";
import { ErrorApi, json } from "../http";
import { bitacora, leerParametros, nuevoId, registrarUsoIa, type Datos, type Db } from "../util";
import { comparendosDe, consultarPlaca, saldoPlacApi, type EnvConsultas } from "./consultas";
import { revisarTramite } from "./revision";
import { listaPartes, planReintento } from "../../compartido/revision";
import { conSinonimosLicencia } from "../../compartido/registro";
import { HORAS_POR_DIA, precioLicencia, REQUISITOS_LICENCIA, tablaPreciosLicencia } from "../../compartido/preciosLicencia";
import { datosDelTexto, fechasDeTexto, letrasACifras } from "../../compartido/textoFelipe";

const MODELO = "gpt-4o-mini";
const MAX_VUELTAS = 5;
/** El asistente puede buscar, actuar y anotar en la misma respuesta (Felipe pide varios cambios en un solo mensaje). */
const MAX_VUELTAS_ASISTENTE = 10;
const MAX_TOKENS = 900;
const MAX_MENSAJES = 16;
/**
 * Un mensaje con fotos adjuntas es un tema nuevo: le llega solo al modelo (con la conversación anterior mezclaba temas:
 * pegó una renovación de licencia como nota del traspaso del que se hablaba antes). Sin fotos va la conversación
 * (las correcciones de una cotización necesitan los datos del carro dichos al principio).
 */
const FOTOS = "Fotos adjuntas (leídas)";
/** Cédulas y placas leídas en las fotos de un mensaje (null si no trae fotos). */
export function datosDeFotos(texto: string): { documentos: string[]; placas: string[] } | null {
  const i = texto.indexOf(FOTOS);
  if (i < 0) return null;
  const f = texto.slice(i).replace(/(\d)\.(?=\d{3}\b)/g, "$1").toUpperCase();
  return {
    documentos: [...new Set([...f.matchAll(/\b\d{5,11}\b/g)].map((m) => m[0]))],
    placas: [...new Set([...f.matchAll(/\b([A-Z]{3}\d{2}[A-Z0-9]|\d{3}[A-Z]{3})\b/g)].map((m) => m[1]))],
  };
}

export interface Propuesta { id: string; tipo: "nota" | "estado" | "recordatorio" | "pago" | "precondicion" | "cliente" | "vincular" | "costos" | "tramite"; titulo: string; metodo: "POST" | "PATCH"; ruta: string; cuerpo: Record<string, unknown> }

export const funcion = (name: string, description: string, propiedades: Record<string, unknown> = {}, requeridos: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties: propiedades, required: requeridos, additionalProperties: false } },
});
export const TEXTO = (d: string) => ({ type: "string", description: d });
const TRAMITE = TEXTO("Código del trámite tal cual (el que salió de una búsqueda o dijo Felipe: T-año-número para trámites, L-año-número para licencias; cada serie tiene su número: usa el código completo con su letra; nunca un código que no hayas visto), su id, la placa del vehículo, o el nombre o la cédula del cliente (si tiene un solo trámite o encargo abierto).");

const PERSONA_ARG = { type: "object", properties: { nombre: { type: "string" }, cedula: { type: "string" }, telefono: { type: "string" } }, required: ["nombre"] };
const HERRAMIENTAS = [
  funcion("buscar_clientes", "Busca clientes por nombre, documento o teléfono.", { texto: TEXTO("Lo que se busca.") }, ["texto"]),
  funcion("buscar_vehiculos", "Busca vehículos por placa, marca o línea. Trae vigencias y titular.", { texto: TEXTO("Placa o texto.") }, ["texto"]),
  funcion("buscar_tramites", "Lista trámites. Filtra por texto (cliente, placa, tipo) y/o estado. Por defecto solo los abiertos.", {
    texto: TEXTO("Opcional: cliente, documento, placa o tipo de trámite."),
    estado: { type: "string", enum: [...ESTADOS_EN_USO, "todos"], description: "Opcional." },
    incluir_cerrados: { type: "boolean", description: "Incluir finalizados y cancelados." },
  }),
  funcion("resumen_tramite", "Todo sobre un trámite: datos, precondiciones, documentos, cobros y bitácora reciente.", { tramite: TRAMITE }, ["tramite"]),
  funcion("resumen_operativo", "Resumen del día: abiertos por estado, atrasados, recordatorios de hoy, cobros pendientes y licencias por vencer."),
  funcion("requisitos_y_costos", "COTIZA uno o varios trámites del mismo vehículo, o un trámite de licencia de conducción (con sus categorías y, en la primera vez, con o sin clases: sale el precio de la oficina, las horas, el tiempo y los requisitos): requisitos, precondiciones y costos en una ciudad (tarifas de las cotizaciones de la oficina). Si son varios al tiempo (traspaso + levantamiento de prenda...), llama UNA vez con tipo y otros_tipos: los honorarios se cobran una sola vez y ya vienen así. En traspasos manda SIEMPRE marca, línea completa, modelo y cilindraje cuando los tengas (la placa NO hace falta; solo si Felipe la dijo): con eso se busca el avalúo de la base gravable del año y sale la retención en la fuente (1 %). Manda también la clase y el cilindraje: las motos de 125 cc o menos no pagan impuesto y van sin paz y salvo.", {
    tipo: TEXTO("Nombre del tipo de trámite."), otros_tipos: { type: "array", items: { type: "string" }, description: "Opcional: los demás trámites que se hacen al tiempo para el mismo vehículo." },
    categorias: TEXTO("Solo licencias: las categorías ('A2', 'B1 y A2', 'C2'). Con ellas sale el precio de la oficina."),
    con_clases: { type: "boolean", description: "Solo licencia por primera vez: true con clases, false sin clases, si Felipe lo dijo. Si no lo dijo, NO lo pongas: la cotización trae los dos precios." },
    organismo: TEXTO("Ciudad del organismo de tránsito donde está matriculado el vehículo (o donde se hace el trámite). Si Felipe no la dijo, pregúntale '¿Es en Ibagué?' antes de cotizar: no la supongas."),
    precio_venta: TEXTO("Opcional, en traspasos: precio de la venta, SOLO si Felipe ya lo dijo (nunca lo pidas antes de cotizar). La retención va sobre el mayor entre el precio y el avalúo."),
    placa: TEXTO("Opcional: placa del vehículo (si está en la base, se usa su avalúo y sus datos)."),
    marca: TEXTO("Opcional: marca del vehículo."), linea: TEXTO("Opcional: línea EXACTA, copiada letra por letra como la imprime la tarjeta o como la dijo Felipe: todas sus palabras, en el mismo orden y con sus siglas (UG, ABS, FI, PRO, 4X2, AT...). No la acortes, no la reordenes ni la 'corrijas': cada sigla es otra versión con otro avalúo."), modelo: TEXTO("Opcional: año del modelo."),
    cilindraje: TEXTO("Opcional: cilindraje en cc (distingue versiones con avalúo distinto)."),
    clase: TEXTO("Opcional: clase del vehículo (AUTOMOVIL, MOTOCICLETA...)."),
    avaluo: { type: "number", description: "Opcional: el avalúo que Felipe dijo ('el avalúo es 10.000.000'), en pesos. Reemplaza el de la tabla. NO es el precio de venta." },
    honorarios: { type: "number", description: "Opcional: SOLO si Felipe dijo la palabra 'honorarios' ('cóbrale 300 mil de honorarios'), en pesos; van una sola vez por todos los trámites. El valor de un trámite ('cobra 10.000 de traslado') NO es honorarios: va en tarifas_dichas." },
    tarifas_dichas: { type: "array", description: "Opcional: el valor de un trámite que Felipe dijo ('el traslado de cuenta cuesta 10.000'), en pesos; reemplaza la tarifa de la tabla de ese trámite (o la pone si no hay).", items: { type: "object", properties: { tramite: { type: "string" }, valor: { type: "number" } }, required: ["tramite", "valor"], additionalProperties: false } },
  }, ["tipo", "organismo"]),
  funcion("buscar_faq", "Busca en las preguntas frecuentes de la oficina.", { texto: TEXTO("Tema.") }, ["texto"]),
  funcion("calcular", "Calculadora exacta. Úsala para CUALQUIER cuenta (también antes de proponer un pago o un cobro que sale de una cuenta, como 'la mitad') que no te haya dado otra herramienta (sumar dos cotizaciones, la mitad de un pago, una diferencia, un porcentaje, un redondeo): nunca hagas cuentas de cabeza.", {
    expresion: TEXTO("La operación con números y + - * / ( ) %, por ejemplo '10.000.000 * 1%' o '(261000 + 30000) / 2'."),
  }, ["expresion"]),
  funcion("proponer_nota", "PROPONE anotar algo en la bitácora de un trámite (Felipe confirma).", { tramite: TRAMITE, texto: TEXTO("La nota.") }, ["tramite", "texto"]),
  funcion("proponer_cambio_estado", "PROPONE cambiar el estado de un trámite (Felipe confirma; las precondiciones se revisan al confirmar).", {
    tramite: TRAMITE, estado: { type: "string", enum: ESTADOS_EN_USO, description: "en_preparacion=Recibido, en_tramite=En tránsito, entregado=Finalizado." },
  }, ["tramite", "estado"]),
  funcion("proponer_recordatorio", "PROPONE crear un recordatorio, llamada o cita (Felipe confirma).", {
    titulo: TEXTO("Qué hay que hacer."), fecha: TEXTO("AAAA-MM-DD."), hora: TEXTO("Opcional, HH:MM."),
    tipo: { type: "string", enum: ["recordatorio", "llamada", "cita"] }, cliente_id: TEXTO("Opcional: id del cliente."), tramite: TEXTO("Opcional: número o id del trámite."),
  }, ["titulo", "fecha"]),
  funcion("proponer_pago", "PROPONE registrar un pago en un trámite (Felipe confirma).", {
    tramite: TRAMITE, valor: { type: "number", description: "Pesos." }, metodo: TEXTO("Opcional: Efectivo, Transferencia, Nequi..."),
  }, ["tramite", "valor"]),
  funcion("proponer_tramite", "PROPONE anotar (registrar) un trámite NUEVO; Felipe lo confirma en una tarjeta y queda anotado, en Recibido, en el mapa en la ciudad de su organismo. Antes de llamarla ten TODO lo necesario, dicho por Felipe (no inventes nada): el trámite, la ciudad del organismo (si no la dijo, pregunta '¿Es en Ibagué?'), y: de vehículo, la placa y el propietario actual (nombre; la cédula si la dijo); si es traspaso, también el comprador; de licencia, el titular con su cédula, las categorías y su fecha de nacimiento. Si falta algo, pregúntalo primero. Pasa TODO lo demás que dijo en el mismo mensaje: el teléfono (en la persona), lo que se cobra (valor), lo que ya pagó (abono), con quién se hace (aliado) y cualquier otra cosa (observaciones).", {
    tipo: TEXTO("Nombre del tipo de trámite (de la lista)."), otros_tipos: { type: "array", items: { type: "string" }, description: "Opcional: los demás trámites del mismo encargo (traspaso + levantamiento de prenda)." },
    ciudad: TEXTO("Ciudad del organismo de tránsito, tal como la dijo o confirmó Felipe."),
    placa: TEXTO("Placa del vehículo (no en licencias)."),
    propietario: { ...PERSONA_ARG, description: "Propietario actual (en traspaso, el vendedor). En licencias, el titular." },
    comprador: { ...PERSONA_ARG, description: "Solo en traspasos: el comprador." },
    cliente: { type: "string", enum: ["propietario", "comprador"], description: "Quién es el cliente (el titular del trámite). Por defecto el propietario." },
    categorias: TEXTO("Solo licencias: categorías (A2, B1...)."), fecha_nacimiento: TEXTO("Solo licencias: fecha de nacimiento del titular, AAAA-MM-DD."),
    valor: { type: "number", description: "Opcional: lo que se cobra en total, en pesos, si Felipe lo dijo ('le cobro 350' = 350000)." },
    abono: { type: "number", description: "Opcional: lo que el cliente ya pagó, en pesos ('abonó 100', 'dejó 200 mil', 'pagó la mitad' NO: solo una cifra dicha)." },
    metodo_abono: TEXTO("Opcional: por dónde pagó el abono (Nequi, efectivo, transferencia...)."),
    con_clases: { type: "boolean", description: "Solo en Expedición de licencia (1ª vez): true si es CON clases, false si es SIN clases, tal como lo dijo Felipe. Si no lo dijo, NO lo pongas: pregúntaselo." },
    aliado: TEXTO("Opcional: con quién se hace (tramitador)."),
    observaciones: TEXTO("Opcional: lo demás que Felipe dijo del trámite, en sus palabras ('aún no viene la persona', 'el examen es el lunes', 'la licencia actual vence en marzo')."),
  }, ["tipo", "ciudad", "propietario"]),
  funcion("proponer_precondicion", "PROPONE marcar o desmarcar una precondición de un trámite (Felipe confirma).", {
    tramite: TRAMITE, precondicion: { type: "string", enum: [...PRECONDICIONES] }, cumplida: { type: "boolean" },
  }, ["tramite", "precondicion", "cumplida"]),
];

/* ───────────────────────── herramientas ───────────────────────── */

export const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
export const recortar = (s: string | null | undefined, n = 300) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

/**
 * El trámite por número, id o placa. Un combo (trámites creados juntos: traspaso + levantamiento de prenda) es UN
 * trámite con un solo código: por la placa se toma el combo (su primera parte), sin preguntar. Solo si la placa tiene
 * trámites abiertos distintos se dice cuáles, para que pregunte.
 */
async function tramitePorRef(db: Db, ref: unknown) {
  const r = String(ref ?? "").trim();
  const placa = r.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^([A-Z]{3}\d{2}[A-Z0-9]|\d{3}[A-Z]{3})$/.test(placa)) {
    const v = await db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get();
    const abiertos = v ? await db.select().from(E.tramites).where(and(eq(E.tramites.vehiculoId, v.id), notInArray(E.tramites.estado, ESTADOS_TERMINALES))).orderBy(E.tramites.numero) : [];
    const distintos = abiertos.filter((t, i) => !t.encargoId || abiertos.findIndex((x) => x.encargoId === t.encargoId) === i);
    if (distintos.length === 1) return distintos[0];
    if (distintos.length > 1) {
      const lista = await describirTramites(db, distintos);
      throw new Error(`La placa ${placa} tiene ${distintos.length} trámites abiertos distintos: ${lista.map((x) => `${x.numero} (${x.tipo})`).join(", ")}. Pregunte cuál.`);
    }
    // Recién finalizado ("ya salió, apruébale todo, y la tarjeta quedó en la oficina"): el que se cerró en las últimas
    // 48 horas sigue siendo "el de la placa" (la tarjeta, el cobro y las notas de después van ahí).
    if (v) {
      const reciente = await db.select().from(E.tramites).where(and(eq(E.tramites.vehiculoId, v.id), eq(E.tramites.estado, "entregado"), sql`${E.tramites.actualizado} >= ${new Date(Date.now() - 48 * 3600_000).toISOString()}`))
        .orderBy(desc(E.tramites.actualizado)).get();
      if (reciente) return reciente;
      throw new Error(`La placa ${placa} no tiene trámites abiertos.`);
    }
    // Con forma de placa y sin vehículo: NO se toman sus números como número de trámite (la ABC123 no es el T-…506).
    if (!/^\d+$/.test(placa)) throw new Error(`La placa ${placa} no está registrada en la base: no tiene trámites. Si es una cotización, no hay trámite que cambiar.`);
  }
  // Número de trámite: solo "506", "#506", "T-2026-00506" o "L-2026-00012" (licencias); nada de sacar números de otro texto.
  const limpio = normalizar(r).replace(/^((el|la|tramite|licencia|numero|no\.?|#)\s*)+/, "").trim();
  const conSerie = limpio.match(/^([tl])-?\d{4}-?(\d{1,6})$/);
  const m = conSerie ? [conSerie[0], conSerie[2]] : limpio.match(/^(\d{1,6})$/);
  const numero = Number(m?.[1]);
  const porId = await db.select().from(E.tramites).where(eq(E.tramites.id, r)).get();
  if (porId) return porId;
  if (Number.isFinite(numero) && numero > 0) {
    const serie = conSerie ? conSerie[1].toUpperCase() : null;
    const hallados = await db.select().from(E.tramites).where(serie ? and(eq(E.tramites.numero, numero), eq(E.tramites.serie, serie)) : eq(E.tramites.numero, numero));
    if (hallados.length === 1) return hallados[0];
    if (hallados.length > 1) throw new Error(`El ${numero} está en las dos series: ${hallados.map((x) => codigoTramite(x)).join(" (trámite) y ")} (licencia). Pregunte cuál.`);
  }
  // Por el cliente ("la renovación de Ana Gómez", "el de la cédula 10000000"): su único trámite abierto.
  if (/[a-z]{3}/i.test(r) || r.replace(/\D/g, "").length >= 5) {
    const c = await clientePor(db, r).catch((e: Error) => { if (/No encontr/.test(e.message)) return null; throw e; });
    if (c) {
      const suyos = await db.select().from(E.tramites).where(and(notInArray(E.tramites.estado, ESTADOS_TERMINALES),
        or(eq(E.tramites.titularId, c.id), sql`${E.tramites.id} IN (SELECT tramite_id FROM tramite_personas WHERE cliente_id = ${c.id})`))).orderBy(E.tramites.numero);
      const distintos = suyos.filter((x, i) => !x.encargoId || suyos.findIndex((y) => y.encargoId === x.encargoId) === i);
      if (distintos.length === 1) return distintos[0];
      if (distintos.length > 1) {
        const lista = await describirTramites(db, distintos);
        throw new Error(`${c.nombre} tiene ${distintos.length} trámites abiertos: ${lista.map((x) => `${x.numero} (${x.tipo}${x.placa ? `, ${x.placa}` : ""})`).join(", ")}. Pregunte cuál.`);
      }
      throw new Error(`${c.nombre} no tiene trámites abiertos.`);
    }
  }
  throw new Error(`No encontré el trámite "${r}".`);
}

const tramitePor = tramitePorRef;

export async function pagadoDe(db: Db, ids: string[]) {
  const total = new Map<string, number>();
  // En lotes: D1 limita la cantidad de valores por consulta.
  for (let i = 0; i < ids.length; i += 90) {
    const filas = await db.select({ id: E.pagos.tramiteId, total: sql<number>`sum(${E.pagos.valor})` }).from(E.pagos).where(inArray(E.pagos.tramiteId, ids.slice(i, i + 90))).groupBy(E.pagos.tramiteId);
    for (const f of filas) total.set(f.id, f.total);
  }
  return total;
}

/** Las partes de un combo (las vigentes, en orden); un trámite solo es su única parte. */
async function partesDelCombo(db: Db, t: typeof E.tramites.$inferSelect) {
  if (!t.encargoId) return [t];
  const todas = await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId)).orderBy(E.tramites.numero);
  return todas.filter((x) => x.estado !== "cancelado" || x.id === t.id);
}

/** En un combo, TODAS las partes a las que les aplica esa precondición (o la primera, si no le aplica a ninguna). */
async function partesConPrecondicion(db: Db, t: typeof E.tramites.$inferSelect, flag: string) {
  const ps = await partesDelCombo(db, t);
  if (ps.length < 2) return [t];
  const tipos = await db.select({ id: E.tiposTramite.id, precondiciones: E.tiposTramite.precondiciones }).from(E.tiposTramite).where(inArray(E.tiposTramite.id, ps.map((x) => x.tipoId)));
  const aplica = (x: typeof t) => !!(tipos.find((y) => y.id === x.tipoId)?.precondiciones as Record<string, boolean> | undefined)?.[flag];
  const cuales = ps.filter(aplica);
  return cuales.length ? cuales : [t];
}

/** En un combo, la parte a la que le aplica esa precondición (la primera si es de varias o de ninguna). */
async function parteConPrecondicion(db: Db, t: typeof E.tramites.$inferSelect, flag: string) {
  const ps = await partesDelCombo(db, t);
  if (ps.length < 2) return t;
  const tipos = await db.select({ id: E.tiposTramite.id, precondiciones: E.tiposTramite.precondiciones }).from(E.tiposTramite).where(inArray(E.tiposTramite.id, ps.map((x) => x.tipoId)));
  const aplica = (x: typeof t) => !!(tipos.find((y) => y.id === x.tipoId)?.precondiciones as Record<string, boolean> | undefined)?.[flag];
  return aplica(t) ? t : ps.find(aplica) ?? t;
}

/** Trámites para el modelo. Un combo va como UNO: su código, "Traspaso de propiedad + Levantamiento de prenda", el total y el saldo de todo. */
/**
 * Lo que le falta a cada trámite (preanotado: "Info incompleta"), mirando todas las partes de un combo: id -> ["el
 * comprador", ...]. Solo los que tienen algo pendiente.
 */
export async function faltanDe(db: Db, lista: (typeof E.tramites.$inferSelect)[]): Promise<Map<string, string[]>> {
  const salida = new Map<string, string[]>();
  if (!lista.length) return salida;
  const encargos = [...new Set(lista.map((t) => t.encargoId).filter((x): x is string => !!x))];
  const hermanos = encargos.length ? await db.select({ id: E.tramites.id, encargoId: E.tramites.encargoId }).from(E.tramites).where(inArray(E.tramites.encargoId, encargos)) : [];
  const ids = [...new Set([...lista.map((t) => t.id), ...hermanos.map((h) => h.id)])];
  const [tipos, personas, titulares, vehiculos] = await Promise.all([
    db.select().from(E.tiposTramite),
    db.select({ tramiteId: E.tramitePersonas.tramiteId, rol: E.tramitePersonas.rol, nombre: E.clientes.nombre, numeroDocumento: E.clientes.numeroDocumento })
      .from(E.tramitePersonas).innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId)).where(inArray(E.tramitePersonas.tramiteId, ids)),
    db.select().from(E.clientes).where(inArray(E.clientes.id, [...new Set(lista.map((t) => t.titularId))])),
    db.select({ id: E.vehiculos.id, placa: E.vehiculos.placa }).from(E.vehiculos).where(inArray(E.vehiculos.id, [...new Set(lista.map((t) => t.vehiculoId).filter((x): x is string => !!x))].concat([""]))),
  ]);
  const tipo = new Map(tipos.map((t) => [t.id, t])), titular = new Map(titulares.map((c) => [c.id, c])), placa = new Map(vehiculos.map((v) => [v.id, v.placa]));
  for (const t of lista) {
    if (t.borrador) continue;
    const delCombo = t.encargoId ? hermanos.filter((h) => h.encargoId === t.encargoId).map((h) => h.id) : [t.id];
    const falta = datosQueFaltan(t, tipo.get(t.tipoId), titular.get(t.titularId), personas.filter((p) => delCombo.includes(p.tramiteId)), t.vehiculoId ? placa.get(t.vehiculoId) ?? null : undefined);
    if (falta.length) salida.set(t.id, falta);
  }
  return salida;
}
const textoFalta = (f: string[]) => `Falta ${f.length > 1 ? `${f.slice(0, -1).join(", ")} y ${f.at(-1)}` : f[0]}`;

async function describirTramites(db: Db, entrada: (typeof E.tramites.$inferSelect)[]) {
  if (!entrada.length) return [];
  const encargos = [...new Set(entrada.map((t) => t.encargoId).filter((x): x is string => !!x))];
  const deEncargos = encargos.length ? await db.select().from(E.tramites).where(inArray(E.tramites.encargoId, encargos)).orderBy(E.tramites.numero) : [];
  const partes = (t: typeof E.tramites.$inferSelect) => (t.encargoId ? deEncargos.filter((x) => x.encargoId === t.encargoId && (x.estado !== "cancelado" || x.id === t.id)) : [t]);
  const lista = entrada.filter((t, i) => !t.encargoId || entrada.findIndex((x) => x.encargoId === t.encargoId) === i);
  const todos = [...new Map([...entrada, ...deEncargos].map((t) => [t.id, t])).values()];
  const [tipos, clientes, vehiculos, pagado, faltan] = await Promise.all([
    db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre }).from(E.tiposTramite),
    db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(inArray(E.clientes.id, [...new Set(lista.map((t) => t.titularId))])),
    db.select({ id: E.vehiculos.id, placa: E.vehiculos.placa }).from(E.vehiculos).where(inArray(E.vehiculos.id, [...new Set(lista.map((t) => t.vehiculoId).filter((x): x is string => !!x))].concat([""]))),
    pagadoDe(db, todos.map((t) => t.id)),
    faltanDe(db, lista),
  ]);
  const tipo = new Map(tipos.map((x) => [x.id, x.nombre]));
  const cli = new Map(clientes.map((x) => [x.id, x.nombre]));
  const pla = new Map(vehiculos.map((x) => [x.id, x.placa]));
  return lista.map((t) => {
    const ps = partes(t);
    const p0 = ps[0] ?? t;
    const total = ps.reduce((s, x) => s + x.total, 0), pagadoTodo = ps.reduce((s, x) => s + (pagado.get(x.id) ?? 0), 0);
    return {
      id: p0.id, numero: codigoTramite(p0), tipo: ps.map((x) => tipo.get(x.tipoId)).join(" + "), titular: cli.get(p0.titularId), placa: p0.vehiculoId ? pla.get(p0.vehiculoId) : null,
      estado: ESTADO_TRAMITE_LABEL[p0.estado as EstadoTramite], recibido: p0.creado.slice(0, 10), entrega_estimada: p0.fechaEstimadaEntrega,
      total, saldo: Math.max(0, total - pagadoTodo), categorias: p0.detalle,
      ...(faltan.get(t.id) ? { info_incompleta: `${textoFalta(faltan.get(t.id)!)} (preanotado: díselo a Felipe)` } : {}),
      ...(ps.length > 1 ? { combo: `Un solo trámite (combo) con ${ps.length} partes: ${ps.map((x) => `${tipo.get(x.tipoId)} (${ESTADO_TRAMITE_LABEL[x.estado as EstadoTramite].toLowerCase()})`).join(" y ")}.` } : {}),
    };
  });
}

async function ejecutar(db: Db, nombre: string, a: Datos, propuestas: Propuesta[]): Promise<unknown> {
  const hoy = hoyColombia();
  const palabras = (s: unknown) => normalizar(String(s ?? "")).split(" ").filter((p) => p.length >= 2).slice(0, 5);
  switch (nombre) {
    case "buscar_clientes": {
      const p = palabras(a.texto);
      if (!p.length) return { error: "Escriba qué buscar." };
      const filas = await db.select().from(E.clientes).where(and(...p.map((w) => like(E.clientes.busqueda, `%${w}%`)))).limit(8);
      return filas.map((c) => ({ id: c.id, nombre: c.nombre, documento: c.numeroDocumento || "sin documento", telefono: c.telefono, ciudad: c.ciudad }));
    }
    case "buscar_vehiculos": {
      const p = palabras(a.texto);
      if (!p.length) return { error: "Escriba qué buscar." };
      const filas = await db.select().from(E.vehiculos).where(and(...p.map((w) => like(E.vehiculos.busqueda, `%${w}%`)))).limit(8);
      const titulares = new Map((await db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(inArray(E.clientes.id, filas.map((v) => v.titularId ?? "").concat([""])))).map((c) => [c.id, c.nombre]));
      return filas.map((v) => ({ id: v.id, placa: v.placa, vehiculo: [v.marca, v.linea, v.modelo].filter(Boolean).join(" "), titular: v.titularId ? titulares.get(v.titularId) : null, soat_vence: v.soatVence, rtm_vence: v.rtmVence, impuesto_hasta: v.impuestoAlDiaHasta, avaluo: v.avaluoOficial }));
    }
    case "buscar_tramites": {
      const cond = [];
      const estado = typeof a.estado === "string" && a.estado !== "todos" ? a.estado : null;
      if (estado) cond.push(eq(E.tramites.estado, estado));
      else if (a.incluir_cerrados !== true) cond.push(notInArray(E.tramites.estado, ESTADOS_TERMINALES));
      const p = palabras(a.texto);
      let soloClientes = false;
      if (p.length) {
        const cli = await db.select({ id: E.clientes.id }).from(E.clientes).where(and(...p.map((w) => like(E.clientes.busqueda, `%${w}%`)))).limit(30);
        const veh = await db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(and(...p.map((w) => like(E.vehiculos.busqueda, `%${w}%`)))).limit(30);
        const tip = (await db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre }).from(E.tiposTramite)).filter((t) => p.every((w) => normalizar(t.nombre).includes(w)));
        const ors = [
          cli.length ? inArray(E.tramites.titularId, cli.map((c) => c.id)) : undefined,
          veh.length ? inArray(E.tramites.vehiculoId, veh.map((v) => v.id)) : undefined,
          tip.length ? inArray(E.tramites.tipoId, tip.map((t) => t.id)) : undefined,
        ].filter(Boolean);
        if (!ors.length) return [];
        soloClientes = cli.length > 1 && !veh.length && !tip.length;
        cond.push(or(...ors)!);
      }
      const filas = await db.select().from(E.tramites).where(cond.length ? and(...cond) : undefined).orderBy(desc(E.tramites.numero)).limit(15);
      const lista = await describirTramites(db, filas);
      // Solo por nombre de cliente (sin placa ni tipo) y con trámites de dos o más clientes distintos: hay que preguntar.
      const titulares = [...new Set(filas.map((t) => t.titularId))];
      if (soloClientes && titulares.length > 1) {
        const nombres = await db.select({ nombre: E.clientes.nombre, doc: E.clientes.numeroDocumento }).from(E.clientes).where(inArray(E.clientes.id, titulares));
        return { tramites: lista, aviso: `OJO: con «${a.texto}» encajan ${nombres.length} clientes distintos: ${nombres.map((c) => `${c.nombre}${c.doc ? ` (CC ${c.doc})` : ""}`).join("; ")}. Si Felipe YA dio la placa, el número del trámite o el nombre completo de uno de ellos, ese es: sigue sin preguntar. Si no, PREGÚNTALE de cuál antes de tocar nada.` };
      }
      return lista;
    }
    case "resumen_tramite": {
      // Un combo se resume entero: las precondiciones, documentos y pagos de todas sus partes.
      const t0 = await tramitePor(db, a.tramite);
      const ps = await partesDelCombo(db, t0);
      const t = ps[0] ?? t0;
      const ids = ps.map((x) => x.id);
      const [base] = await describirTramites(db, [t]);
      const [tipos, vehiculo, organismo, docs, pagos, bitacora, personas, params] = await Promise.all([
        db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, ps.map((x) => x.tipoId))),
        t.vehiculoId ? db.select().from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get() : Promise.resolve(undefined),
        t.organismoId ? db.select().from(E.organismos).where(eq(E.organismos.id, t.organismoId)).get() : Promise.resolve(undefined),
        db.select().from(E.documentos).where(inArray(E.documentos.tramiteId, ids)),
        db.select().from(E.pagos).where(inArray(E.pagos.tramiteId, ids)),
        db.select().from(E.bitacora).where(inArray(E.bitacora.tramiteId, ids)).orderBy(desc(E.bitacora.fecha)).limit(10),
        db.select({ rol: E.tramitePersonas.rol, nombre: E.clientes.nombre, telefono: E.clientes.telefono }).from(E.tramitePersonas).innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId)).where(eq(E.tramitePersonas.tramiteId, t.id)),
        leerParametros(db),
      ]);
      const combo = ps.length > 1;
      const titular = await db.select({ telefono: E.clientes.telefono, documento: E.clientes.numeroDocumento }).from(E.clientes).where(eq(E.clientes.id, t.titularId)).get();
      return {
        ...base, titular_telefono: titular?.telefono, titular_documento: titular?.documento || null, organismo: organismo?.nombre, aliado: t.aliado, tarjeta: t.estadoTarjeta,
        observaciones: recortar(t.observaciones), borrador: t.borrador,
        precondiciones: ps.flatMap((x) => {
          const tipo = tipos.find((y) => y.id === x.tipoId);
          return tipo ? evaluarPrecondiciones(tipo, x.precondicionesEstado, vehiculo ?? null, hoy, params.rnmc_activo === "true").map((p) => ({ ...(combo ? { parte: tipo.nombre } : {}), precondicion: p.flag, nombre: p.nombre, cumplida: p.ok, detalle: p.detalle })) : [];
        }),
        documentos: docs.map((d) => ({ nombre: d.tipoDocumento, estado: d.estado, tiene_archivo: !!d.archivoClave })),
        pagos: pagos.map((p) => ({ fecha: p.fecha, valor: p.valor, metodo: p.metodo })),
        personas, bitacora: bitacora.map((b) => ({ fecha: b.fecha.slice(0, 10), texto: recortar(b.descripcion, 200), origen: b.origen })),
      };
    }
    case "resumen_operativo": {
      const abiertos = await db.select({ estado: E.tramites.estado, n: sql<number>`count(*)` }).from(E.tramites).where(notInArray(E.tramites.estado, ESTADOS_TERMINALES)).groupBy(E.tramites.estado);
      const atrasados = await db.select().from(E.tramites).where(and(notInArray(E.tramites.estado, ESTADOS_TERMINALES), sql`${E.tramites.fechaEstimadaEntrega} < ${hoy}`)).limit(10);
      const recordatorios = await db.select({ titulo: E.recordatorios.titulo, fecha: E.recordatorios.fecha, hora: E.recordatorios.hora }).from(E.recordatorios).where(and(eq(E.recordatorios.estado, "pendiente"), sql`${E.recordatorios.fecha} <= ${hoy}`)).limit(10);
      // Saldos: total de cada trámite menos la suma de sus pagos (en JS, simple y verificable). Por cobrar es lo de los
      // finalizados; lo de los abiertos se cobra al entregar (va aparte, como "en curso").
      const conTotal = await db.select({ id: E.tramites.id, total: E.tramites.total, estado: E.tramites.estado }).from(E.tramites).where(and(sql`${E.tramites.estado} <> 'cancelado'`, sql`${E.tramites.total} > 0`));
      const pagado = await pagadoDe(db, conTotal.map((t) => t.id));
      const todos = conTotal.map((t) => ({ id: t.id, estado: t.estado, saldo: t.total - (pagado.get(t.id) ?? 0) })).filter((t) => t.saldo > 0);
      const saldos = todos.filter((t) => t.estado === "entregado");
      const enCurso = todos.filter((t) => t.estado !== "entregado");
      const licencias = await db.select({ n: sql<number>`count(*)` }).from(E.licencias).where(sql`${E.licencias.fechaVencimiento} BETWEEN ${hoy} AND ${sumarDias(hoy, 60)}`).get();
      const topSaldos = saldos.sort((x, y) => y.saldo - x.saldo).slice(0, 5);
      const tramitesSaldo = (await describirTramites(db, topSaldos.length ? await db.select().from(E.tramites).where(inArray(E.tramites.id, topSaldos.map((s) => s.id))) : [])).sort((x, y) => y.saldo - x.saldo);
      return {
        hoy, abiertos_por_estado: Object.fromEntries(abiertos.map((x) => [ESTADO_TRAMITE_LABEL[x.estado as EstadoTramite], x.n])),
        atrasados: await describirTramites(db, atrasados), recordatorios_hoy_o_atrasados: recordatorios,
        por_cobrar_total: pesos(saldos.reduce((s, x) => s + x.saldo, 0)), tramites_con_saldo: saldos.length, mayores_saldos: tramitesSaldo,
        en_curso_por_cobrar_al_entregar: { total: pesos(enCurso.reduce((s, x) => s + x.saldo, 0)), tramites: enCurso.length },
        licencias_por_vencer_60_dias: licencias?.n ?? 0,
        info_incompleta: await (async () => {
          const abiertosTodos = await db.select().from(E.tramites).where(and(notInArray(E.tramites.estado, ESTADOS_TERMINALES), eq(E.tramites.borrador, false)));
          const f = await faltanDe(db, abiertosTodos);
          const lista = await describirTramites(db, abiertosTodos.filter((t) => f.has(t.id)).slice(0, 10));
          return { cuantos: f.size, algunos: lista.map((x) => ({ numero: x.numero, tipo: x.tipo, titular: x.titular, placa: x.placa, falta: x.info_incompleta })) };
        })(),
      };
    }
    case "requisitos_y_costos": {
      // La cotización ya armada (con los valores exactos): el modelo la copia tal cual, no reescribe cifras.
      const r = await cotizar(db, a);
      return "costos" in r ? { ...r, texto_listo: textoCotizacion(0, r) } : r;
    }
    case "calcular": {
      try {
        const v = calcularExpresion(String(a.expresion ?? ""));
        return { resultado: v, en_pesos: pesos(v) };
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    }
    case "buscar_faq": {
      const faq = (await db.select({ v: E.parametros.valor }).from(E.parametros).where(eq(E.parametros.clave, "faq")).get())?.v ?? "";
      const p = palabras(a.texto);
      const bloques = faq.split(/\n(?=P:)/).filter((b) => p.some((w) => normalizar(b).includes(w)));
      return bloques.slice(0, 4).map((b) => recortar(b, 600));
    }
    case "proponer_nota": {
      const t = await tramitePor(db, a.tramite);
      const texto = String(a.texto ?? "").trim().slice(0, 2000);
      if (!texto) return { error: "La nota está vacía." };
      propuestas.push({ id: nuevoId(), tipo: "nota", titulo: `Anotar en ${codigoTramite(t)}: "${recortar(texto, 160)}"`, metodo: "POST", ruta: `/api/tramites/${t.id}/notas`, cuerpo: { texto } });
      return { ok: true, aviso: "Propuesta lista para que Felipe la confirme en la tarjeta." };
    }
    case "proponer_cambio_estado": {
      const t = await tramitePor(db, a.tramite);
      const estado = String(a.estado) as EstadoTramite;
      if (!ESTADOS_EN_USO.includes(estado)) return { error: "Estado no válido." };
      propuestas.push({ id: nuevoId(), tipo: "estado", titulo: `${codigoTramite(t)}: ${ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite]} → ${ESTADO_TRAMITE_LABEL[estado]}`, metodo: "POST", ruta: `/api/tramites/${t.id}/estado`, cuerpo: { estado } });
      return { ok: true, aviso: "Propuesta lista. Al confirmar se revisan las precondiciones." };
    }
    case "proponer_recordatorio": {
      const fecha = String(a.fecha ?? "");
      if (!esFecha(fecha)) return { error: "La fecha debe ser AAAA-MM-DD." };
      const t = a.tramite ? await tramitePor(db, a.tramite).catch(() => null) : null;
      const titulo = String(a.titulo ?? "").trim().slice(0, 300);
      if (!titulo) return { error: "Falta qué hay que hacer." };
      const tipo = ["recordatorio", "llamada", "cita"].includes(String(a.tipo)) ? String(a.tipo) : "recordatorio";
      propuestas.push({
        id: nuevoId(), tipo: "recordatorio", titulo: `${tipo === "llamada" ? "Llamada" : tipo === "cita" ? "Cita" : "Recordatorio"} el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}${a.hora ? ` a las ${a.hora}` : ""}: ${titulo}`,
        metodo: "POST", ruta: "/api/recordatorios", cuerpo: { titulo, fecha, hora: a.hora || null, tipo, clienteId: a.cliente_id || t?.titularId || null, tramiteId: t?.id ?? null },
      });
      return { ok: true, aviso: "Propuesta lista. Felipe debe confirmarla." };
    }
    case "proponer_pago": {
      const t = await tramitePor(db, a.tramite);
      const valor = Math.round(Number(a.valor));
      if (!(valor > 0)) return { error: "El valor debe ser mayor a cero." };
      propuestas.push({ id: nuevoId(), tipo: "pago", titulo: `Registrar pago de ${pesos(valor)}${a.metodo ? ` (${a.metodo})` : ""} en ${codigoTramite(t)}`, metodo: "POST", ruta: `/api/tramites/${t.id}/pagos`, cuerpo: { valor, metodo: a.metodo || null } });
      return { ok: true, aviso: "Propuesta lista. Felipe debe confirmarla." };
    }
    case "proponer_tramite": {
      const tipos = await db.select().from(E.tiposTramite).where(eq(E.tiposTramite.activo, true));
      const elegidos: (typeof tipos)[number][] = [];
      for (const pedido of [a.tipo, ...(Array.isArray(a.otros_tipos) ? a.otros_tipos : [])].map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 6)) {
        // Como se dice en la oficina ("refrendación", "migración a mayor de edad", "primera vez") -> como se llama en la lista.
        const hallado = tipoPedido(tipos, pedido)
          ?? (() => { const l = tiposDelTexto(tipos, conSinonimosLicencia(normalizar(pedido)), "licencia"); return l.length === 1 ? l[0] : undefined; })();
        const tipo = hallado && conduccionOTransito(tipos, hallado, pedido, a);
        if (!tipo) return { error: `No encontré el tipo de trámite "${pedido}".`, tipos: tipos.map((t) => t.nombre) };
        if (!elegidos.includes(tipo)) elegidos.push(tipo);
      }
      if (!elegidos.length) return { error: "Falta el trámite: pregúntale cuál." };
      const licencia = elegidos.some((t) => t.categoria === "licencia");
      if (licencia && elegidos.some((t) => t.categoria !== "licencia")) return { error: "Un trámite de licencia no va junto con uno de vehículo: anótalos aparte." };
      if (!licencia && elegidos.some((t) => t.categoria !== "vehiculo")) return { error: `${elegidos.map((t) => t.nombre).join(" + ")} no se anota desde aquí: que lo cree en Trámites, Nuevo trámite.` };
      const ciudad = String(a.ciudad ?? "").trim();
      if (!ciudad) return { error: "Falta la ciudad del organismo: pregúntale '¿Es en Ibagué?'." };
      const o = organismoDeTexto(await db.select().from(E.organismos).where(eq(E.organismos.activo, true)), ciudad);
      if (!o) return { error: `No tengo el organismo de tránsito de ${ciudad} en la lista: dile que lo agregue en Configuración o que diga otra ciudad.` };
      const persona = (x: unknown) => {
        const p = (x && typeof x === "object" ? x : {}) as Datos;
        const nombre = String(p.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase();
        return nombre ? { nombre, numeroDocumento: String(p.cedula ?? "").replace(/\D/g, "") || null, telefono: String(p.telefono ?? "").replace(/\D/g, "") || null } : null;
      };
      const propietario = persona(a.propietario), comprador = persona(a.comprador);
      if (!propietario) return { error: licencia ? "Falta el titular de la licencia: pregúntale su nombre y cédula." : "Falta el propietario actual del vehículo: pregúntale su nombre." };
      // "Cobro 320", "abonó 100": en pesos son miles (nada se cobra en menos de $5.000).
      const enPesos = (v: unknown) => { const n = Math.max(0, Math.round(Number(v) || 0)); return n > 0 && n < 5000 ? n * 1000 : n; };
      const valor = enPesos(a.valor);
      const abono = enPesos(a.abono);
      if (abono && valor && abono > valor) return { error: `El abono (${pesos(abono)}) es mayor que lo que se cobra (${pesos(valor)}): pregúntale cuál está bien.` };
      const cuerpo: Datos = { tipoIds: elegidos.map((t) => t.id), organismoId: o.id, precondiciones: "pendientes", desde: "asistente", valor: valor || null, abono: abono || null, metodoAbono: a.metodo_abono || null, aliado: a.aliado || null, observaciones: a.observaciones || null };
      let titulo: string;
      if (licencia) {
        if (!propietario.numeroDocumento) return { error: "Falta la cédula del titular: pregúntasela." };
        const categorias = categoriasDeTexto(String(a.categorias ?? ""));
        if (!categorias.length) return { error: "Faltan las categorías de la licencia (A2, B1...): pregúntalas." };
        // Todo trámite de licencia queda con la fecha de nacimiento del titular (el radar de renovación la usa).
        const nacimiento = esFecha(a.fecha_nacimiento) ? String(a.fecha_nacimiento) : null;
        const ya = await db.select({ f: E.clientes.fechaNacimiento }).from(E.clientes).where(eq(E.clientes.numeroDocumento, propietario.numeroDocumento)).get();
        if (!nacimiento && !ya?.f) return { error: "Falta la fecha de nacimiento del titular (queda en el radar de renovación): pregúntasela." };
        // La edad que exige la norma: 16 o 18 para sacarla o subir de categoría; la migración (de menor a mayor), con 18.
        const edad = avisosEdadLicencia(elegidos.some((t) => /expedicion|recategorizacion/.test(normalizar(t.nombre))), categorias, nacimiento ?? ya?.f, hoyColombia(), elegidos.some((t) => /migracion/.test(normalizar(t.nombre))));
        if (edad.bloqueos.length) return { error: `${edad.bloqueos.join(" ")} Díselo a Felipe y no lo anotes.` };
        const abierto = ya ? await db.select({ numero: E.tramites.numero, codigo: E.tramites.codigo, creado: E.tramites.creado, serie: E.tramites.serie }).from(E.tramites).innerJoin(E.clientes, eq(E.clientes.id, E.tramites.titularId))
          .where(and(eq(E.clientes.numeroDocumento, propietario.numeroDocumento), inArray(E.tramites.tipoId, elegidos.map((t) => t.id)), notInArray(E.tramites.estado, ESTADOS_TERMINALES))).get() : undefined;
        if (abierto) return { error: `${propietario.nombre} ya tiene abierto ${codigoTramite(abierto)} (${elegidos.map((t) => t.nombre).join(" + ")}): no se anota otro igual. Díselo a Felipe.` };
        // Primera vez: con clases o sin clases (en los dos casos firma la carta de compromiso; el trámite lo alerta).
        const expedicion = elegidos.some((t) => /expedici/.test(normalizar(t.nombre)));
        if (expedicion && typeof a.con_clases !== "boolean") return { error: "Es una expedición de licencia (primera vez): pregúntale si es CON clases o SIN clases (junto con lo demás que falte)." };
        Object.assign(cuerpo, { vendedor: { ...propietario, fechaNacimiento: nacimiento }, categorias: categorias.join(","), ...(expedicion ? { conClases: a.con_clases } : {}) });
        titulo = `Anotar ${elegidos.map((t) => t.nombre).join(" + ")} ${categorias.join(" ")}${expedicion ? (a.con_clases ? " con clases" : " sin clases") : ""} · ${propietario.nombre} (CC ${propietario.numeroDocumento}) · ${o.ciudad}`;
      } else {
        const placa = String(a.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!placa) return { error: "Falta la placa del vehículo: pregúntasela." };
        const traspaso = elegidos.some((t) => /traspaso/i.test(t.nombre)) && !elegidos.some((t) => /indeterminad/i.test(t.nombre));
        if (traspaso && !comprador) return { error: "Es un traspaso: falta el comprador (nombre; la cédula si la tiene). Pregúntalo." };
        Object.assign(cuerpo, { vehiculo: { placa }, vendedor: propietario, comprador, cliente: a.cliente === "comprador" && comprador ? "comprador" : "vendedor" });
        titulo = `Anotar ${elegidos.map((t) => t.nombre).join(" + ")} · ${placa} · ${propietario.nombre}${comprador ? ` → ${comprador.nombre}` : ""} · ${o.ciudad}`;
      }
      const extras = [propietario.telefono && `tel. ${propietario.telefono}`, valor && pesos(valor), abono && `abonó ${pesos(abono)}${a.metodo_abono ? ` (${a.metodo_abono})` : ""}`, a.aliado && `con ${a.aliado}`].filter(Boolean);
      propuestas.push({ id: nuevoId(), tipo: "tramite", titulo: `${titulo}${extras.length ? ` · ${extras.join(" · ")}` : ""}${a.observaciones ? ` · «${String(a.observaciones).slice(0, 120)}»` : ""}`, metodo: "POST", ruta: "/api/registrar", cuerpo });
      return { ok: true, aviso: "Propuesta lista: Felipe la confirma en la tarjeta y queda anotado en Recibido; el mapa lo muestra en su ciudad. No digas que ya quedó anotado." };
    }
    case "proponer_precondicion": {
      const flag = String(a.precondicion);
      if (!(PRECONDICIONES as readonly string[]).includes(flag)) return { error: "Precondición no válida." };
      const t = await parteConPrecondicion(db, await tramitePor(db, a.tramite), flag);
      propuestas.push({ id: nuevoId(), tipo: "precondicion", titulo: `${codigoTramite(t)}: marcar "${flag.replace(/_/g, " ")}" como ${a.cumplida ? "cumplida" : "pendiente"}`, metodo: "POST", ruta: `/api/tramites/${t.id}/precondiciones`, cuerpo: { flag, ok: a.cumplida === true } });
      return { ok: true, aviso: "Propuesta lista. Felipe debe confirmarla." };
    }
    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

/**
 * Cotización como la hace un tramitador, de uno o varios trámites del mismo vehículo (la usan el asistente y el
 * cotizador de tarjetas). Nada se supone:
 * - Sin el organismo de tránsito (donde está matriculado) no cotiza: lo pide.
 * - Si ese organismo no tiene tarifa de un trámite, lo dice y el total queda como parcial.
 * - En traspasos, la retención (1 %) va sobre el mayor entre el precio de venta y el avalúo de la base gravable; si
 *   no hay ninguno de los dos (las motos de 125 cc o menos no están en la base), pide el precio.
 * Varios trámites juntos pagan los honorarios una sola vez; las motos de 125 cc o menos van sin paz y salvo.
 */
/**
 * El tipo de trámite que pidió el asistente: el de ese nombre o, si no, el que tiene todas las palabras dichas; entre
 * varios, el de nombre más corto ("traspaso" es "Traspaso de propiedad", no "Traspaso a persona interesada"). "Persona
 * interesada" o "indeterminada" sin la palabra traspaso, también.
 */
export function tipoPedido<T extends { nombre: string }>(tipos: T[], pedido: string): T | undefined {
  const exacto = tipos.find((t) => normalizar(t.nombre) === normalizar(pedido));
  if (exacto) return exacto;
  // Sin las palabras de relleno ("traspaso POR persona interesada" es "Traspaso A persona interesada") ni "de
  // conducción" (los de licencia de conducción se llaman sin eso: "Duplicado de licencia").
  const p = normalizar(pedido).split(" ").filter((w) => w.length >= 2 && !/^(de|del|la|el|los|las|por|para|en|un|una|al|conduccion)$/.test(w)).slice(0, 5);
  return tipos.filter((t) => p.every((w) => normalizar(t.nombre).includes(w))).sort((a, b) => a.nombre.length - b.nombre.length)[0];
}

/**
 * La licencia de CONDUCCIÓN (el pase de la persona) no es la licencia de TRÁNSITO (la tarjeta del vehículo). Un
 * "duplicado de licencia" a secas con placa o vehículo es el de tránsito (el nombre más corto de la lista es el de
 * conducción y se lo llevaba).
 */
export function conduccionOTransito<T extends { nombre: string; categoria: string }>(tipos: T[], tipo: T, pedido: string, a: Datos): T {
  if (tipo.categoria !== "licencia" || !/duplicad/.test(normalizar(tipo.nombre)) || /conducc|pase/.test(normalizar(pedido))) return tipo;
  const delVehiculo = [a.placa, a.marca, a.linea].some((x) => String(x ?? "").trim());
  return (delVehiculo && tipos.find((t) => t.categoria === "vehiculo" && /^duplicado de licencia de transito/.test(normalizar(t.nombre)))) || tipo;
}

export async function cotizar(db: Db, a: Datos) {
  const palabras = (s: unknown) => normalizar(String(s ?? "")).split(" ").filter((p) => p.length >= 2).slice(0, 5);
  const tipos = await db.select().from(E.tiposTramite).where(eq(E.tiposTramite.activo, true));
  const elegidos: (typeof tipos)[number][] = [];
  for (const id of Array.isArray(a.tipo_ids) ? a.tipo_ids : []) {
    const tipo = tipos.find((t) => t.id === id);
    if (!tipo) return { error: "Algún trámite elegido ya no existe." };
    if (!elegidos.includes(tipo)) elegidos.push(tipo);
  }
  for (const pedido of [a.tipo, ...(Array.isArray(a.otros_tipos) ? a.otros_tipos : [])].map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 6)) {
    const hallado = tipoPedido(tipos, pedido)
      ?? (() => { const l = tiposDelTexto(tipos, conSinonimosLicencia(normalizar(pedido)), "licencia"); return l.length === 1 ? l[0] : undefined; })();
    const tipo = hallado && conduccionOTransito(tipos, hallado, pedido, a);
    if (!tipo) return { error: `No encontré el tipo de trámite "${pedido}".`, tipos: tipos.map((t) => t.nombre) };
    if (!elegidos.includes(tipo)) elegidos.push(tipo);
  }
  if (!elegidos.length) return { error: "Falta el trámite a cotizar: pregúntelo.", falta: ["trámite"], tipos: tipos.map((t) => t.nombre) };

  const orgs = await db.select().from(E.organismos);
  const o = a.organismo_id ? orgs.find((x) => x.id === a.organismo_id) ?? null : organismoDeTexto(orgs, String(a.organismo ?? ""));
  if (!o) {
    return a.organismo || a.organismo_id
      ? { error: `"${a.organismo ?? a.organismo_id}" no está en la lista de organismos de tránsito: pregunte en cuál está matriculado el vehículo.`, falta: ["organismo"] }
      : { error: "Falta el organismo de tránsito donde está matriculado el vehículo: pregúntelo, no lo suponga.", falta: ["organismo"] };
  }
  const [tarifas, params] = await Promise.all([db.select().from(E.tarifas).where(inArray(E.tarifas.tipoTramiteId, elegidos.map((t) => t.id))), leerParametros(db)]);

  // El vehículo: lo que llegue, completado con lo guardado de esa placa.
  const placa = String(a.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const veh = placa ? await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get() : undefined;
  const marca = String(a.marca || veh?.marca || ""), linea = String(a.linea || veh?.linea || ""), modelo = Number(a.modelo || veh?.modelo) || null;
  const cilindraje = Number(String(a.cilindraje || veh?.cilindraje || "").replace(/\D/g, "")) || null;
  const clase = String(a.clase || veh?.clase || "") || null;
  const traspaso = elegidos.some((t) => /traspaso/i.test(t.nombre));
  // Avalúo: el guardado del vehículo o el de la base gravable por marca, línea, modelo y cilindraje. Las motos de
  // 125 cc o menos no pagan impuesto y no están en la base.
  const motoExenta = motoSinImpuesto({ clase, cilindraje });
  const avaluoDicho = Math.round(Number(String(a.avaluo ?? "").replace(/[^\d.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "")) || 0);
  type Linea = { linea: string; valor: number };
  let avaluo: { valor: number; origen: string; linea?: string; perfecta?: boolean; alternativas?: Linea[]; dudosas?: Linea[] } | null = avaluoDicho > 0 ? { valor: avaluoDicho, origen: "el que dijo Felipe", perfecta: true }
    : veh?.avaluoOficial ? { valor: veh.avaluoOficial, origen: veh.avaluoDetalle ?? "avalúo guardado del vehículo", perfecta: true } : null;
  // Si la línea de la tarjeta no está en la tabla, la más parecida se sugiere (no se cobra hasta que Felipe diga que sí).
  let sugerencia: (Linea & { otras: Linea[] }) | null = null;
  if (traspaso && !avaluo && marca && linea && modelo && !motoExenta) {
    const b = await avaluoDe(db, marca, linea, modelo, cilindraje);
    if (b?.sugerida) sugerencia = { linea: b.linea, valor: b.valor, otras: b.alternativas };
    else if (b) avaluo = { valor: b.valor, origen: `base gravable ${b.anioFiscal}: ${b.linea}, modelo ${b.anioModeloUsado}`, linea: b.linea, perfecta: b.perfecta, alternativas: b.alternativas, dudosas: b.dudosas };
  }
  const precio = Number(String(a.precio_venta ?? "").replace(/\D/g, "")) || null;
  const base = traspaso ? Math.max(precio ?? 0, avaluo?.valor ?? 0) || null : null;

  const ctx = { honorariosDefecto: Number(params.honorarios_defecto) || 0, tramos: leerTramos(params.impuesto_registro_tramos), retefuentePct: Number(params.retefuente_pct) || 0 };
  // La tarifa que dijo Felipe de un trámite reemplaza la de la tabla (o la pone, si ese organismo no la tiene).
  const dichas = (Array.isArray(a.tarifas_dichas) ? a.tarifas_dichas : []) as Datos[];
  const dichaDe = (t: (typeof elegidos)[number]) => {
    const d = dichas.find((x) => { const p = palabras(x.tramite); return p.length > 0 && (normalizar(String(x.tramite)) === normalizar(t.nombre) || p.every((w) => normalizar(t.nombre).includes(w))); });
    const v = Math.round(Number(d?.valor) || 0);
    return v > 0 ? v : null;
  };
  // Licencias: el precio de la oficina por categorías (y con o sin clases en la primera vez).
  const categorias = categoriasDeTexto(String(a.categorias ?? "").replace(/[+/-]/g, ","));
  const conClases = typeof a.con_clases === "boolean" ? a.con_clases : null;
  const conPrecioOficina = (t: (typeof elegidos)[number]) => t.categoria === "licencia" && precioLicencia(t.nombre, categorias, conClases) !== undefined;
  const deLicencia = elegidos.every((t) => t.categoria === "licencia");
  const cs = honorariosUnaVez(elegidos.map((t) => calcularCostos(t, tarifas, o.id, base, ctx, { clase, cilindraje }, { categorias, conClases }))).map((c, i) => {
    const v = dichaDe(elegidos[i]);
    if (v === null) return c;
    // Se conservan la retención (va sobre el avalúo o el precio) y el paz y salvo ($10.000 siempre); el resto del
    // trámite es lo que dijo Felipe.
    const quedan = c.lineas.filter((l) => /retenci|^paz y salvo/i.test(l.concepto));
    const lineas = [{ concepto: "Tarifa (la que dijo Felipe)", valor: v }, ...quedan];
    return { ...c, lineas, costoDerechos: lineas.reduce((s, l) => s + l.valor, 0), hayTarifa: true };
  });
  // Los honorarios que dijo Felipe reemplazan los de la tabla (una sola vez: en el trámite que los llevaba).
  const honorariosDichos = Math.round(Number(a.honorarios) || 0);
  if (honorariosDichos > 0) {
    const k = Math.max(0, cs.findIndex((c) => c.honorarios > 0));
    cs.forEach((c, i) => { c.honorarios = i === k ? honorariosDichos : 0; });
  }
  const varios = elegidos.length > 1;
  const honorarios = cs.reduce((s, c) => s + c.honorarios, 0);
  const total = cs.reduce((s, c) => s + c.costoDerechos + c.honorarios, 0);

  // Lo que falta para que el total sea completo, dicho con nombre propio.
  const falta: string[] = [];
  // Una licencia sin precio ya dice en sus avisos qué falta (con o sin clases, las categorías, o que no hay precio).
  elegidos.forEach((t, i) => { if (!cs[i].hayTarifa && !conPrecioOficina(t)) falta.push(`la tarifa de ${t.nombre.toLowerCase()} en ${o.ciudad ?? o.nombre}`); });
  if (traspaso && !base && ctx.retefuentePct > 0) falta.push("el precio de venta (para la retención)");
  const avisos = [...new Set(cs.flatMap((c) => c.avisos))].filter((x) => x !== AVISO_HONORARIOS_UNA_VEZ && !/^Paz y salvo: se cobra una sola vez/.test(x) && !/^No hay tarifa para este/.test(x) && !/^La retención en la fuente depende/.test(x) && !/^Se usó la tarifa general/.test(x));
  if (cs.some((c, i) => c.hayTarifa && !conPrecioOficina(elegidos[i]) && tarifas.find((t) => t.tipoTramiteId === elegidos[i].id && t.organismoId === o.id) === undefined)) avisos.push(`Se usó la tarifa general: no hay una propia de ${o.ciudad ?? o.nombre}.`);
  if (motoExenta && traspaso && !avaluo) avisos.push("Las motos de 125 cc o menos no están en la base gravable del Ministerio: la retención va sobre el precio de venta.");
  const retencion = traspaso && base
    ? precio && avaluo ? `Retención sobre ${pesos(base)}: el mayor entre el precio de venta (${pesos(precio)}) y el avalúo (${pesos(avaluo.valor)}).`
      : precio ? `Retención sobre el precio de venta (${pesos(precio)}).` : `Retención sobre el avalúo (${pesos(base)}); si el precio de venta es mayor, va sobre el precio.`
    : null;

  return {
    tipo: elegidos.map((t) => t.nombre).join(" + "), tipo_ids: elegidos.map((t) => t.id), categoria: CATEGORIA_LABEL[elegidos[0].categoria as CategoriaTramite],
    organismo: o.nombre, organismo_id: o.id, ciudad: o.ciudad, dias_habiles_entrega: Math.max(0, ...elegidos.map((t) => t.slaDias ?? 0)) || null,
    requisitos: varios ? Object.fromEntries(elegidos.map((t) => [t.nombre, t.requisitos])) : elegidos[0].requisitos,
    precondiciones: [...new Set(elegidos.flatMap((t) => Object.keys(t.precondiciones).filter((k) => t.precondiciones[k as keyof typeof t.precondiciones])))],
    vehiculo: placa || marca ? { placa: placa || null, marca, linea, modelo, cilindraje, clase, encontrado_en_la_base: !!veh } : null,
    avaluo: avaluo ? {
      valor: pesos(avaluo.valor), origen: avaluo.origen, otras_lineas_parecidas: avaluo.alternativas?.map((x) => `${x.linea}: ${pesos(x.valor)}`),
      // Otra línea encaja igual de bien con otro valor: dígaselo a Felipe con su valor, para que lo confirme en el SIBGA.
      ...(avaluo.dudosas?.length ? { confirmar: `OJO: también encaja ${avaluo.dudosas.map((x) => `${x.linea} (${pesos(x.valor)})`).join(" y ")}. Confírmelo en el SIBGA; si es esa, dígamelo y recalculo.` } : {}),
    } : null,
    ...(sugerencia ? { avaluo_sugerido: {
      linea: sugerencia.linea, valor: pesos(sugerencia.valor), retencion_si_es_esa: pesos(Math.round((sugerencia.valor * ctx.retefuentePct) / 100)),
      nota: `No está la línea "${linea}" en la base gravable. La más parecida es ${sugerencia.linea} (${pesos(sugerencia.valor)}). NO se cobró: Felipe confirma en la cotización si es esa.`,
    } } : {}),
    // Para la cotización en pantalla: el avalúo que se puede escribir (la retención sale sola) y las líneas para elegir.
    ...(traspaso && ctx.retefuentePct > 0 ? { avaluo_editable: {
      pct: ctx.retefuentePct, valor: avaluo?.valor ?? null, linea: avaluo?.linea ?? null, origen: avaluo?.origen ?? null,
      // Hay que confirmarla: no es idéntica a la de la tarjeta, o es solo una sugerencia.
      confirmar: !!sugerencia || (!!avaluo && avaluo.perfecta === false),
      sugerida: !!sugerencia,
      opciones: sugerencia ? [{ linea: sugerencia.linea, valor: sugerencia.valor }, ...sugerencia.otras] : [...(avaluo?.dudosas ?? []), ...(avaluo?.alternativas ?? []).filter((x) => !avaluo?.dudosas?.some((d) => d.linea === x.linea))].slice(0, 4),
    } } : {}),
    ...(retencion ? { retencion } : {}),
    ...(deLicencia ? { licencia: {
      categorias: categorias.join(", ") || null, con_clases: conClases, sin_precio: cs.some((c) => !c.hayTarifa),
      requisitos_oficina: REQUISITOS_LICENCIA, horas_por_dia: HORAS_POR_DIA, horas_obligatorias: true,
    } } : {}),
    ...(falta.length ? { falta, incompleta: true } : {}),
    costos: {
      // Con varios trámites, cada línea dice de cuál es; los honorarios van una sola vez.
      lineas: cs.flatMap((c, i) => c.lineas.map((l) => ({ ...(varios ? { tramite: elegidos[i].nombre } : {}), concepto: l.concepto, valor: pesos(l.valor), valor_numero: l.valor }))),
      honorarios: pesos(honorarios), honorarios_numero: honorarios, ...(varios ? { honorarios_nota: "una sola vez por todos los trámites" } : {}),
      total: pesos(total), total_numero: total, avisos,
    },
  };
}

type Cotizado = Awaited<ReturnType<typeof cotizar>>;

/** La cotización de un vehículo en texto, como la entrega la oficina. */
function textoCotizacion(n: number, r: Extract<Cotizado, { costos: object }>) {
  if (r.licencia) {
    // Licencias: el precio de la oficina (sin vehículo ni honorarios aparte), las horas y los requisitos.
    return [
      `**${n ? `${n}. ` : ""}${r.tipo}${r.licencia.categorias ? ` ${r.licencia.categorias}` : ""}**`,
      ...(r.costos.lineas as { concepto: string; valor: string }[]).map((l) => `${l.concepto}: ${l.valor}`),
      r.costos.honorarios_numero ? `Honorarios: ${r.costos.honorarios}` : "",
      r.costos.total_numero ? `**Total: ${r.costos.total}**` : "",
      ...r.costos.avisos,
      `Requisitos: ${REQUISITOS_LICENCIA.join(" ")}`,
    ].filter(Boolean).join("\n");
  }
  const veh = r.vehiculo;
  const cab = `**${n ? `${n}. ` : ""}${[veh?.placa || "Sin placa", [veh?.marca, veh?.linea].filter(Boolean).join(" "), veh?.modelo && `modelo ${veh.modelo}`, [veh?.clase, veh?.cilindraje && `${veh.cilindraje} cc`].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}**`;
  const lineas: string[] = [];
  let actual: string | undefined;
  for (const l of r.costos.lineas as { tramite?: string; concepto: string; valor: string }[]) {
    if (l.tramite && l.tramite !== actual) { actual = l.tramite; lineas.push(`${l.tramite}:`); }
    lineas.push(`${l.tramite ? "  " : ""}${l.concepto}: ${l.valor}`);
  }
  return [
    cab, `Organismo: ${r.organismo}`, ...lineas,
    `Honorarios${"honorarios_nota" in r.costos ? ` (${r.costos.honorarios_nota})` : ""}: ${r.costos.honorarios}`,
    r.incompleta ? `**Total parcial: ${r.costos.total}** (falta ${r.falta!.join(" y ")})` : `**Total: ${r.costos.total}**`,
    r.retencion ?? "",
    r.avaluo ? `Avalúo ${r.avaluo.valor} (${r.avaluo.origen})` : "",
    r.avaluo?.confirmar ? r.avaluo.confirmar : r.avaluo?.otras_lineas_parecidas?.length ? `Otras versiones en la tabla: ${r.avaluo.otras_lineas_parecidas.join("; ")}. Si es otra, dígamelo y recalculo.` : "",
    r.avaluo_sugerido ? `No está esa línea en la base gravable. La más parecida: ${r.avaluo_sugerido.linea} (${r.avaluo_sugerido.valor}); si es esa, la retención es ${r.avaluo_sugerido.retencion_si_es_esa}. Confírmelo en la cotización.` : "",
    ...r.costos.avisos,
  ].filter(Boolean).join("\n");
}

/**
 * La cotización como datos, para que la pantalla la muestre editable (cada valor y los honorarios se cambian y el total
 * se recalcula): el encabezado del vehículo, sus líneas en número, lo que falta y las notas (retención, avalúo, avisos).
 */
export function cotizacionEditable(r: Extract<Cotizado, { costos: object }>) {
  const veh = r.vehiculo;
  const lineas = r.costos.lineas as { tramite?: string; concepto: string; valor_numero?: number; valor: string }[];
  return {
    titulo: r.licencia ? `${r.tipo}${r.licencia.categorias ? ` ${r.licencia.categorias}` : ""}` : [veh?.placa || "Sin placa", [veh?.marca, veh?.linea].filter(Boolean).join(" "), veh?.modelo && `modelo ${veh.modelo}`, [veh?.clase, veh?.cilindraje && `${veh.cilindraje} cc`].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    organismo: r.organismo,
    // Por separado, para la copia al cliente y la tabla (sin el organismo largo ni el cilindraje).
    ciudad: r.ciudad ?? null, placa: veh?.placa ?? null, vehiculo: [veh?.marca, veh?.linea].filter(Boolean).join(" ") || null, modelo: veh?.modelo ?? null,
    tramite: r.tipo,
    lineas: lineas.map((l) => ({ tramite: l.tramite ?? null, concepto: l.concepto, valor: l.valor_numero ?? (Number(String(l.valor).replace(/\D/g, "")) || 0) })),
    honorarios: (r.costos as { honorarios_numero?: number }).honorarios_numero ?? (Number(String(r.costos.honorarios).replace(/\D/g, "")) || 0),
    honorariosNota: "honorarios_nota" in r.costos ? String(r.costos.honorarios_nota) : null,
    falta: r.falta ?? [],
    // Con el avalúo editable en pantalla, de dónde salió y el "OJO" van ahí (con botones para elegir), no en las notas.
    notas: [...(r.avaluo_editable ? [] : [r.retencion ?? "", r.avaluo ? `Avalúo ${r.avaluo.valor} (${r.avaluo.origen})` : "", r.avaluo?.confirmar ?? ""]), ...r.costos.avisos, r.licencia ? `Requisitos: ${REQUISITOS_LICENCIA.join(" ")}` : ""].filter(Boolean),
    ...(r.avaluo_editable ? { avaluo: r.avaluo_editable } : {}),
    texto: textoCotizacion(0, r),
  };
}

/**
 * POST /api/cotizar  { tipo_ids: [...], vehiculos: [{ placa, marca, linea, modelo, cilindraje, clase, organismo_id,
 * precio_venta? }] } -> una cotización por vehículo, con todos los trámites (honorarios una vez por vehículo). Lo
 * llama el cotizador de tarjetas después de que Felipe confirma los datos; sin IA: exacta y al instante. Se guarda en
 * la pestaña Cotizaciones.
 */
export async function cotizarVarios(db: Db, d: Datos) {
  const vehiculos = (Array.isArray(d.vehiculos) ? d.vehiculos : []).slice(0, 20) as Datos[];
  if (!vehiculos.length) throw new ErrorApi("No hay vehículos para cotizar.");
  const tipoIds = (Array.isArray(d.tipo_ids) ? d.tipo_ids : []).filter((x): x is string => typeof x === "string" && !!x);
  if (!tipoIds.length) throw new ErrorApi("Elija el trámite a cotizar.");
  const sinOrganismo = vehiculos.filter((v) => !v.organismo_id).map((v) => String(v.placa || "sin placa").toUpperCase());
  if (sinOrganismo.length) throw new ErrorApi(`Falta el organismo de tránsito de ${sinOrganismo.join(", ")}.`);
  const cotizaciones: (Cotizado & { entrada: Datos })[] = [];
  for (const v of vehiculos) {
    const c = await cotizar(db, { tipo_ids: tipoIds, organismo_id: v.organismo_id, placa: v.placa, marca: v.marca, linea: v.linea, modelo: v.modelo, cilindraje: v.cilindraje, clase: v.clase, precio_venta: v.precio_venta });
    if ("error" in c && c.error) throw new ErrorApi(`${String(v.placa || "Sin placa").toUpperCase()}: ${c.error}`);
    cotizaciones.push({ entrada: v, ...c });
  }
  const conCostos = cotizaciones as (Extract<Cotizado, { costos: object }> & { entrada: Datos })[];
  const nombreTramites = conCostos[0].tipo;
  const bloques = conCostos.map((c, i) => textoCotizacion(i + 1, c));
  const total = conCostos.reduce((s, c) => s + c.costos.total_numero, 0);
  const incompleta = conCostos.some((c) => c.incompleta);
  const textoCot = `**Cotización: ${nombreTramites}**\n\n${bloques.join("\n\n")}${conCostos.length > 1 ? `\n\n**Total de todo${incompleta ? " (parcial)" : ""}: ${pesos(total)}**` : ""}`;
  const corto = (n: string) => n.replace(/ de propiedad$/, "");
  const titulo = `${nombreTramites.split(" + ").map(corto).join(" + ")} · ${conCostos.map((c) => c.vehiculo?.placa || "sin placa").join(", ")}`.slice(0, 160);
  const id = nuevoId();
  await db.insert(E.cotizaciones).values({ id, titulo, tramite: nombreTramites, total, texto: textoCot, origen: "fotos", datos: cotizaciones }).run();
  return json({ id, tipo: nombreTramites, titulo, total, incompleta, texto: textoCot, cotizaciones, editables: conCostos.map(cotizacionEditable) });
}

/* ───────────────────────── acciones (solo el asistente) ───────────────────────── */

/** Lo que el asistente hizo en esta respuesta (la app lo muestra como "Hecho"). */
export interface Accion { titulo: string; tramiteId?: string }

/** Las casillas (precondiciones) como las dice Felipe: va en la descripción de marcar_precondiciones. */
const PRECONDICIONES_DICHAS = "runt=inscripción en el RUNT (persona o vehículo inscrito); identidad=identidad autenticada (cédulas, huellas, firmas autenticadas); soat=SOAT vigente; rtm=revisión técnico-mecánica vigente; paz_salvo_simit=paz y salvo de multas en el SIMIT (ya pagó los comparendos o las multas, no debe comparendos); sin_medidas_rnmc=sin medidas correctivas del Código de Policía (RNMC); paz_salvo_impuesto=impuesto vehicular al día (paz y salvo de impuesto, ya pagó el impuesto o el rodamiento); sin_gravamenes=sin prenda, embargo ni limitación (ya levantaron la prenda, no tiene gravámenes); sin_embargos=sin embargos ni otras limitaciones a la propiedad en el RUNT (no tiene embargo ni medida cautelar); carta_prenda=carta de levantamiento de prenda (la carta del banco o la financiera que autoriza levantar la prenda; 'llegó la carta de prenda', 'ya tenemos la carta del banco'); improntas=improntas tomadas; contrato=contrato de compraventa firmado.";
const ACCIONES = [
  funcion("anotar", "ANOTA de una vez una nota en la bitácora de un trámite (por ejemplo, lo que Felipe cuenta que pasó). Si Felipe dice que es importante, que la destaque, que la ponga como nota destacada, que se vea arriba o que no se le olvide, usa destacada=true.", {
    tramite: TRAMITE, texto: TEXTO("La nota, clara y completa."),
    destacada: { type: "boolean", description: "Que quede como la NOTA DESTACADA del trámite (sale grande arriba del expediente; la que hubiera no se pierde: queda fijada al lado)." },
  }, ["tramite", "texto"]),
  funcion("destacar_nota", "DESTACA (o quita) una nota que YA está en la bitácora del trámite: queda como su nota destacada, arriba del expediente. Para algo nuevo usa anotar con destacada=true.", {
    tramite: TRAMITE, texto: TEXTO("Opcional: unas palabras de la nota para encontrarla ('la del rechazo en Bogotá'); vacío = la última nota."),
    quitar: { type: "boolean", description: "Quitar la nota destacada que tenga el trámite." },
  }, ["tramite"]),
  funcion("cambiar_estado", "CAMBIA de una vez el estado de un trámite. Para pasar a En tránsito o Finalizado las precondiciones deben estar cumplidas: si Felipe dice que ya salió, que está terminado o que se aprueben, usa aprobar_precondiciones=true.", {
    tramite: TRAMITE,
    estado: { type: "string", enum: ESTADOS_EN_USO, description: "en_preparacion=Recibido, en_tramite=En tránsito, entregado=Finalizado (ya salió / terminado)." },
    aprobar_precondiciones: { type: "boolean", description: "Marcar antes todas las precondiciones como cumplidas." },
  }, ["tramite", "estado"]),
  funcion("marcar_precondiciones", `MARCA de una vez precondiciones (las casillas) de un trámite: todas, o las que Felipe nombre (una o varias en la misma llamada). Qué es cada una: ${PRECONDICIONES_DICHAS}`, {
    tramite: TRAMITE, todas: { type: "boolean", description: "Todas las que aplican, como cumplidas." },
    precondiciones: { type: "array", items: { type: "string", enum: [...PRECONDICIONES] }, description: "Las que se marcan (una o varias)." },
    precondicion: { type: "string", enum: [...PRECONDICIONES], description: "Si es una sola (o usa precondiciones)." },
    cumplida: { type: "boolean", description: "false para desmarcarlas (quedan pendientes). Por defecto, cumplidas." },
    nota: TEXTO("Opcional: el porqué en pocas palabras, si Felipe lo dijo ('pagó los comparendos', 'ya levantaron la prenda')."),
  }, ["tramite"]),
  funcion("crear_recordatorio", "CREA de una vez un recordatorio, llamada o cita.", {
    titulo: TEXTO("Qué hay que hacer."), fecha: TEXTO("AAAA-MM-DD."), hora: TEXTO("Opcional, HH:MM."),
    tipo: { type: "string", enum: ["recordatorio", "llamada", "cita"] }, cliente_id: TEXTO("Opcional: id del cliente."), tramite: TEXTO("Opcional: número o id del trámite."),
  }, ["titulo", "fecha"]),
];
/** Correcciones: se hacen de una vez (dato por dato, lo que Felipe dijo) y se dice antes → después. */
const CORRECCIONES = [
  funcion("corregir_cliente", "CORRIGE de una vez datos de un cliente: solo los que Felipe dijo. Responde antes → después.", {
    cliente: TEXTO("A quién: nombre, cédula, teléfono o id (de buscar_clientes)."),
    nombre: TEXTO("Opcional: nombre completo nuevo."), tipo_documento: TEXTO("Opcional: CC, CE, TI, PA, NIT."), numero_documento: TEXTO("Opcional: cédula nueva, solo dígitos."),
    telefono: TEXTO("Opcional."), direccion: TEXTO("Opcional."), ciudad: TEXTO("Opcional."), fecha_nacimiento: TEXTO("Opcional, AAAA-MM-DD."), fecha_expedicion_documento: TEXTO("Opcional, AAAA-MM-DD."),
  }, ["cliente"]),
  funcion("corregir_vehiculo", "CORRIGE de una vez datos de un vehículo: solo los que Felipe dijo. Responde antes → después.", {
    placa: TEXTO("Placa actual del vehículo."), placa_nueva: TEXTO("Opcional: si la placa quedó mal escrita, la correcta."),
    marca: TEXTO("Opcional."), linea: TEXTO("Opcional."), modelo: TEXTO("Opcional: año."), clase: TEXTO("Opcional."), color: TEXTO("Opcional."), cilindraje: TEXTO("Opcional, cc."),
    servicio: TEXTO("Opcional: particular, publico, oficial, diplomatico."), motor: TEXTO("Opcional: número de motor."), chasis: TEXTO("Opcional: número de chasis."), serie: TEXTO("Opcional."), vin: TEXTO("Opcional."),
    combustible: TEXTO("Opcional."), carroceria: TEXTO("Opcional."), capacidad: TEXTO("Opcional."), potencia: TEXTO("Opcional, HP."), licencia_transito: TEXTO("Opcional: número de la licencia de tránsito."),
    fecha_matricula: TEXTO("Opcional, AAAA-MM-DD."), organismo_matricula: TEXTO("Opcional: ciudad del organismo donde está matriculado."),
    soat_vence: TEXTO("Opcional, AAAA-MM-DD."), rtm_vence: TEXTO("Opcional, AAAA-MM-DD."), impuesto_al_dia_hasta: TEXTO("Opcional, AAAA-MM-DD."),
  }, ["placa"]),
  funcion("corregir_tramite", "CORRIGE de una vez datos de un trámite (no la plata): organismo, aliado, observaciones, fechas, categorías de una licencia, la tarjeta física, el vehículo (otra placa) o el titular. Responde antes → después.", {
    tramite: TRAMITE, organismo: TEXTO("Opcional: ciudad del organismo de tránsito."), aliado: TEXTO("Opcional: tramitador o aliado; 'ninguno' para quitarlo."),
    observaciones: TEXTO("Opcional: las observaciones completas nuevas (reemplazan las de antes)."), agregar_observacion: TEXTO("Opcional: texto que se agrega al final de las observaciones."),
    entrega_estimada: TEXTO("Opcional, AAAA-MM-DD."), fecha_radicado: TEXTO("Opcional, AAAA-MM-DD."),
    categorias: TEXTO("Opcional, en trámites de licencia: las categorías ('B1', 'A2 y B1')."),
    tarjeta: { type: "string", enum: [...ESTADOS_TARJETA], description: "Opcional: la tarjeta física (licencia de tránsito o licencia de conducción). no_recibida=aún no llega, en_oficina=llegó a la oficina, enviada=se le mandó al cliente o al tramitador, entregada=ya la tiene el cliente, rechazada." },
    placa: TEXTO("Opcional: la placa correcta del vehículo del trámite (debe estar registrada)."),
    titular: TEXTO("Opcional: el titular correcto (cédula, nombre o id de un cliente registrado)."),
  }, ["tramite"]),
  funcion("poner_persona", "PONE de una vez una persona en un trámite con su papel: comprador, vendedor, copropietario, apoderado... ('el comprador es Juan Pérez, cédula 123'). La busca por cédula o nombre; si no existe y Felipe dio el nombre, la crea (con la cédula y el teléfono si los dijo). Si en ese papel había alguien sin datos (NA) u otra persona, la reemplaza. Responde antes → después.", {
    tramite: TRAMITE, rol: { type: "string", enum: ROLES_PERSONA.filter((r) => r !== "titular"), description: "El papel en el trámite. interviniente = persona relacionada: un tercero que actúa en el trámite sin ser tramitador (el yerno que representa a la suegra en la venta, el hijo que hace las vueltas). (El titular se cambia con corregir_tramite.)" },
    cliente: TEXTO("Opcional: cédula, nombre o id de un cliente que ya está en la base."),
    nombre: TEXTO("Opcional: nombre completo, tal como lo dijo Felipe (para crearla si no está)."), numero_documento: TEXTO("Opcional: cédula, solo dígitos."),
    tipo_documento: TEXTO("Opcional: CC (por defecto), CE, TI, PA, NIT."), telefono: TEXTO("Opcional."),
  }, ["tramite", "rol"]),
  funcion("quitar_persona", "QUITA de una vez a una persona de un trámite (el comprador, el vendedor...).", {
    tramite: TRAMITE, rol: { type: "string", enum: ROLES_PERSONA.filter((r) => r !== "titular") }, cliente: TEXTO("Opcional: cuál, si en ese papel hay varias."),
  }, ["tramite", "rol"]),
  funcion("buscar_licencias", "Las licencias de conducción de un cliente (categorías, expedición, vencimiento y el seguimiento de la renovación), o las que vencen pronto.", {
    cliente: TEXTO("Opcional: cédula, nombre o id del cliente."), vencen_en_dias: { type: "number", description: "Opcional: las que vencen en los próximos N días (sin cliente)." },
  }),
  funcion("corregir_licencia", "CORRIGE o REGISTRA de una vez la licencia de conducción de un cliente: sus categorías y fechas, y el seguimiento de la renovación (por llamar, contactado, agendado, renovado, no interesa) con su nota. Solo lo que Felipe dijo. Responde antes → después.", {
    cliente: TEXTO("Cédula, nombre o id del cliente."),
    categorias: { type: "array", items: { type: "string", enum: [...CATEGORIAS_LICENCIA] }, description: "Opcional: las categorías a las que aplica (o que se registran). Vacío = todas las que tiene." },
    fecha_vencimiento: TEXTO("Opcional, AAAA-MM-DD."), fecha_expedicion: TEXTO("Opcional, AAAA-MM-DD."),
    seguimiento: { type: "string", enum: [...ESTADOS_GESTION_LICENCIA], description: "Opcional: por_llamar, contactado, agendado, renovado, descartado (no le interesa), sin_gestion." },
    nota_seguimiento: TEXTO("Opcional: nota del seguimiento ('dice que vuelve en diciembre')."),
  }, ["cliente"]),
  funcion("proponer_cobro", "PROPONE cambiar lo que se cobra en un trámite (Felipe confirma en una tarjeta que muestra antes → después). valor_total: lo que paga el cliente por todo el encargo ('ese trámite vale 100.000'). O el desglose: derechos, honorarios, otros.", {
    tramite: TRAMITE, valor_total: { type: "number", description: "Opcional: total cobrado al cliente, en pesos." },
    derechos: { type: "number", description: "Opcional: derechos de tránsito y demás costos de terceros, en pesos." }, honorarios: { type: "number", description: "Opcional." }, otros: { type: "number", description: "Opcional." },
  }, ["tramite"]),
];

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre: "nombre", tipoDocumento: "tipo de documento", numeroDocumento: "documento", telefono: "teléfono", direccion: "dirección", ciudad: "ciudad",
  fechaNacimiento: "nacimiento", fechaExpedicionDocumento: "expedición del documento", placa: "placa", marca: "marca", linea: "línea", modelo: "modelo", clase: "clase",
  color: "color", cilindraje: "cilindraje", servicio: "servicio", numeroMotor: "motor", numeroChasis: "chasis", numeroSerie: "serie", vin: "VIN", combustible: "combustible",
  carroceria: "carrocería", capacidad: "capacidad", potencia: "potencia", licenciaTransito: "licencia de tránsito", fechaMatricula: "matrícula", organismoMatriculaId: "matriculado en",
  soatVence: "SOAT vence", rtmVence: "técnico-mecánica vence", impuestoAlDiaHasta: "impuesto al día hasta", organismoId: "organismo", aliado: "aliado",
  observaciones: "observaciones", fechaEstimadaEntrega: "entrega estimada", fechaRadicado: "radicado",
  detalle: "categorías", estadoTarjeta: "tarjeta física", vehiculoId: "vehículo", titularId: "titular",
};
/** "teléfono: 1000000000 → 1000000000" por cada campo que cambió. */
function antesDespues(antes: Record<string, unknown>, despues: Record<string, unknown>, campos: string[], nombres: Record<string, string> = {}) {
  const v = (k: string, x: unknown) => { const s = x == null || x === "" ? "" : String(x); return s && nombres[s] ? nombres[s] : s; };
  return campos.filter((k) => v(k, antes[k]) !== v(k, despues[k])).map((k) => k === "observaciones"
    ? `observaciones: «${recortar(v(k, despues[k]), 160) || "vacías"}»`
    : `${ETIQUETA_CAMPO[k] ?? k}: ${v(k, antes[k]) || "vacío"} → ${v(k, despues[k]) || "vacío"}`);
}
/** Solo lo que llegó (el modelo manda vacíos de más: un vacío no borra nada). */
function soloDichos(a: Datos, mapa: Record<string, string>) {
  const d: Datos = {};
  for (const [de, a2] of Object.entries(mapa)) if (a[de] !== undefined && a[de] !== null && String(a[de]).trim() !== "") d[a2] = String(a[de]).trim();
  return d;
}
async function clientePor(db: Db, ref: unknown) {
  const r = String(ref ?? "").trim();
  if (!r) throw new Error("Diga de qué cliente: nombre, cédula o teléfono.");
  const porId = await db.select().from(E.clientes).where(eq(E.clientes.id, r)).get();
  if (porId) return porId;
  const cc = r.match(/\b(?:CC|C\.C\.|CE|TI|NIT|PA|c[eé]dula)\s*:?\s*([\d.]{5,15})/i)?.[1]?.replace(/\D/g, "");
  if (cc) {
    const c = await db.select().from(E.clientes).where(eq(E.clientes.numeroDocumento, cc)).get();
    if (c) return c;
  }
  const digitos = r.replace(/\D/g, "");
  if (digitos.length >= 5 && digitos.length === r.replace(/[\s.,-]/g, "").length) {
    const c = await db.select().from(E.clientes).where(or(eq(E.clientes.numeroDocumento, digitos), eq(E.clientes.telefono, digitos))).limit(3);
    if (c.length === 1) return c[0];
  }
  const p = normalizar(r).split(" ").filter((w) => w.length >= 2).slice(0, 5);
  const filas = p.length ? await db.select().from(E.clientes).where(and(...p.map((w) => like(E.clientes.busqueda, `%${w}%`)))).limit(6) : [];
  if (filas.length === 1) return filas[0];
  if (!filas.length) throw new Error(`No encontré al cliente "${r}".`);
  throw new Error(`Hay ${filas.length} clientes que encajan con "${r}": ${filas.map((c) => `${c.nombre} (${c.numeroDocumento || "sin cédula"}, id ${c.id})`).join("; ")}. Pregúntele a Felipe cuál.`);
}
/** La corrección queda en la bitácora de los trámites abiertos de ese cliente o vehículo (o del último, si no hay abiertos). */
async function anotarCorreccion(db: Db, de: { clienteId?: string; vehiculoId?: string }, texto: string) {
  const cond = de.vehiculoId ? eq(E.tramites.vehiculoId, de.vehiculoId)
    : or(eq(E.tramites.titularId, de.clienteId!), sql`${E.tramites.id} IN (SELECT tramite_id FROM tramite_personas WHERE cliente_id = ${de.clienteId})`);
  const filas = await db.select({ id: E.tramites.id, estado: E.tramites.estado }).from(E.tramites).where(cond).orderBy(desc(E.tramites.numero)).limit(20);
  const abiertos = filas.filter((t) => !(ESTADOS_TERMINALES as readonly string[]).includes(t.estado)).slice(0, 5);
  for (const t of abiertos.length ? abiertos : filas.slice(0, 1)) await bitacora(db, t.id, "datos", texto, { origen: "asistente" }).run();
}

/** Consultas a PlacApi (cuestan créditos; las de hoy se reutilizan gratis). Solo el asistente. */
const CONSULTAS_PLACAPI = [
  funcion("consultar_comparendos_persona", "CONSULTA en el SIMIT si una persona debe comparendos o multas, por su cédula (1 crédito de PlacApi, unos $349; si ya se consultó hoy, gratis). Úsala SOLO cuando Felipe pregunte por comparendos, multas, SIMIT o paz y salvo de una persona.", {
    cedula: TEXTO("Número de documento, solo dígitos."), tipo_documento: TEXTO("Opcional: CC (por defecto), CE, TI, PA, NIT."),
    actualizar: { type: "boolean", description: "Volver a consultar aunque ya haya una consulta de hoy (cuesta otra vez)." },
  }, ["cedula"]),
  funcion("consultar_placa", "CONSULTA una placa en el RUNT con PlacApi. que='comparendos': multas del SIMIT de esa placa (1 crédito). que='gravamenes': si tiene prenda, embargos o limitaciones a la propiedad, estado del registro, SOAT y técnico-mecánica (1 crédito; NO dice a favor de quién está la prenda). que='todo': consulta completa (3 créditos): lo anterior con a favor de quién está la prenda y quién embargó, multas del dueño e impuesto. Para '¿tiene gravámenes / prenda / embargo?' usa 'gravamenes'; si pregunta a favor de quién, o también comparendos o impuesto, 'todo'. Responde con el resumen 'gravamenes' que devuelve; si dice que NO LLEGÓ, dilo así: nunca digas que no tiene. El RUNT exige la cédula del dueño ACTUAL: si la placa está en la base se toma sola; si no, pídesela a Felipe. Lo que trae queda guardado en el vehículo. Úsala SOLO cuando Felipe pida consultar o verificar una placa.", {
    placa: TEXTO("Placa."), que: { type: "string", enum: ["comparendos", "gravamenes", "todo"], description: "comparendos (1 crédito), gravamenes (1 crédito) o todo (3 créditos)." },
    cedula_dueno: TEXTO("Opcional: cédula del dueño actual (si la placa no está en la base o Felipe la dice)."), actualizar: { type: "boolean", description: "Volver a consultar aunque ya haya una de hoy." },
  }, ["placa", "que"]),
  funcion("revisar_tramite", "HACE la revisión previa de un trámite con PlacApi (4 créditos en traspaso, 3 en otro de vehículo, 2 en licencia): todo lo que lo puede frenar (SOAT, técnico-mecánica, prendas, embargos, comparendos, impuesto), marca solas las precondiciones limpias y lo anota en la bitácora. Úsala cuando Felipe pida revisar o verificar un trámite.", { tramite: TRAMITE }, ["tramite"]),
  funcion("saldo_placapi", "Cuántos créditos de PlacApi quedan y cuánto se ha gastado este mes (gratis)."),
];

/** Las propuestas que estas acciones reemplazan (el asistente no las ve; el monitor de WhatsApp sí). */
const PROPUESTAS_REEMPLAZADAS = ["proponer_nota", "proponer_cambio_estado", "proponer_precondicion", "proponer_recordatorio"];

/** Las funciones de las rutas responden con Response: si no salió bien, el error va al modelo para que se lo diga a Felipe. */
async function resultado(r: Response) {
  const d = (await r.json().catch(() => ({}))) as Datos;
  if (!r.ok) throw new Error(String(d.error ?? `No se pudo (${r.status}).`));
  return d;
}

/**
 * El modelo a veces manda las claves raras ("tramite:" con dos puntos, "Tramite") o una casilla suelta
 * ("paz_salvo_simit": true en vez de precondiciones=[...]): se limpian antes de usarlas.
 */
export function arreglarArgs(a: Datos | undefined): Datos {
  const b: Datos = {};
  for (const [k, v] of Object.entries(a ?? {})) b[k.toLowerCase().replace(/[^a-z_]/g, "")] = v;
  const sueltas = PRECONDICIONES.filter((f) => b[f] === true || b[f] === "true");
  if (sueltas.length) b.precondiciones = [...new Set([...(Array.isArray(b.precondiciones) ? b.precondiciones : []), ...sueltas])];
  return b;
}
/** Palabras con las que Felipe pide mover un trámite de estado (sin ellas, el asistente no lo mueve). Sobre el texto sin tildes. */
export const PIDE_ESTADO = /transito|radic|salio|finaliz|termin|entreg|correcci|devol|devuel|cancel|recibid|estado|pasal|pasel|muevel|cierr|listo/;
/** Palabras con las que pide un recordatorio (sin ellas, no se crea uno por su cuenta). Sobre el texto sin tildes. */
export const PIDE_RECORDATORIO = /recuerd|agend|llam|cita|avis|alarma|record/;

function accionesAsistente(db: Db, hechas: Accion[], env: EnvConsultas = {}, pedidoTexto = ""): Extra {
  const pedido = normalizar(pedidoTexto);
  const origen = { origen: "asistente" };
  // Si en esta misma respuesta se le cambió la placa a un trámite, la placa vieja sigue llevando a él.
  const alias = new Map<string, string>();
  const placaDe = (r: unknown) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tramitePor = async (db2: Db, ref: unknown) => {
    const id = alias.get(placaDe(ref));
    if (id) { const t = await db2.select().from(E.tramites).where(eq(E.tramites.id, id)).get(); if (t) return t; }
    return tramitePorRef(db2, ref);
  };
  return {
    herramientas: [...ACCIONES, ...CORRECCIONES, ...(env.PLACAPI_KEY ? CONSULTAS_PLACAPI : [])],
    ejecutar: (nombre, a0, propuestas) => {
      // Si Felipe nombró UNA placa en su mensaje, se busca por ella (no por el apellido: "la del señor Parra, la ABC123").
      if (nombre === "buscar_tramites") {
        const placas = [...new Set((pedidoTexto.toUpperCase().match(/\b[A-Z]{3}\s?\d{2}[A-Z0-9]\b/g) ?? []).map((x) => x.replace(/\s/g, "")))];
        if (placas.length === 1 && !placaDe(a0.texto).includes(placas[0])) a0.texto = placas[0];
        return undefined;
      }
      const a = arreglarArgs(a0);
      // "Ya salió" es Finalizado (como el botón "Sí, ya salió"), salvo que hable del tránsito o del radicado.
      if (nombre === "cambiar_estado" && a.estado === "en_tramite" && /\bya sali|\bsalio\b/.test(pedido) && !/transito|radic/.test(pedido)) a.estado = "entregado";
      if (nombre === "cambiar_estado" && pedido && !PIDE_ESTADO.test(pedido)) return Promise.resolve({ error: "Felipe NO pidió cambiar el estado: no lo cambies. Haz solo lo que pidió." });
      if (nombre === "crear_recordatorio" && pedido && !PIDE_RECORDATORIO.test(pedido)) return Promise.resolve({ error: "Felipe NO pidió un recordatorio: no lo crees. Si dijo una fecha de entrega, va en corregir_tramite (entrega_estimada)." });
      // El titular no es un papel de poner_persona: se cambia en el trámite.
      if (nombre === "poner_persona" && String(a.rol) === "titular") { nombre = "corregir_tramite"; a.titular = a.cliente || a.numero_documento || a.nombre; }
      switch (nombre) {
        case "corregir_cliente": return (async () => {
          const c = await clientePor(db, a.cliente);
          const d = soloDichos(a, { nombre: "nombre", tipo_documento: "tipoDocumento", numero_documento: "numeroDocumento", telefono: "telefono", direccion: "direccion", ciudad: "ciudad", fecha_nacimiento: "fechaNacimiento", fecha_expedicion_documento: "fechaExpedicionDocumento" });
          if (d.nombre) d.nombre = String(d.nombre).toUpperCase();
          if (!Object.keys(d).length) return { error: "No dijo qué dato corregir." };
          await resultado(await editarCliente(db, c.id, d));
          const nuevo = (await db.select().from(E.clientes).where(eq(E.clientes.id, c.id)).get())!;
          const cambios = antesDespues(c, nuevo, Object.keys(d));
          if (!cambios.length) return { ok: true, hecho: "Ya estaba así; no cambió nada.", cliente: nuevo.nombre };
          await anotarCorreccion(db, { clienteId: c.id }, `Corregido ${nuevo.nombre}: ${cambios.join("; ")}`);
          hechas.push({ titulo: `${nuevo.nombre}: ${cambios.join("; ")}` });
          return { ok: true, hecho: `Corregido ${nuevo.nombre}: ${cambios.join("; ")}`, decir: "Dile a Felipe esta frase de 'hecho', con el antes → después." };
        })();
        case "corregir_vehiculo": return (async () => {
          const placa = String(a.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const v = placa ? await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get() : undefined;
          if (!v) return { error: `No encontré el vehículo de placa "${a.placa ?? ""}".` };
          const d = soloDichos(a, { placa_nueva: "placa", marca: "marca", linea: "linea", modelo: "modelo", clase: "clase", color: "color", cilindraje: "cilindraje", servicio: "servicio",
            motor: "numeroMotor", chasis: "numeroChasis", serie: "numeroSerie", vin: "vin", combustible: "combustible", carroceria: "carroceria", capacidad: "capacidad", potencia: "potencia",
            licencia_transito: "licenciaTransito", fecha_matricula: "fechaMatricula", soat_vence: "soatVence", rtm_vence: "rtmVence", impuesto_al_dia_hasta: "impuestoAlDiaHasta" });
          for (const k of ["modelo", "cilindraje"]) if (d[k]) d[k] = String(d[k]).replace(/\D/g, "");
          const orgs = await db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos);
          if (a.organismo_matricula && String(a.organismo_matricula).trim()) {
            const o = organismoDeTexto(orgs, String(a.organismo_matricula));
            if (!o) return { error: `"${a.organismo_matricula}" no está en la lista de organismos de tránsito.` };
            d.organismoMatriculaId = o.id;
          }
          if (!Object.keys(d).length) return { error: "No dijo qué dato corregir." };
          await resultado(await editarVehiculo(db, v.id, d));
          const nuevo = (await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, v.id)).get())!;
          const cambios = antesDespues(v, nuevo, Object.keys(d), Object.fromEntries(orgs.map((o) => [o.id, o.ciudad ?? o.nombre])));
          if (!cambios.length) return { ok: true, hecho: "Ya estaba así; no cambió nada.", placa: nuevo.placa };
          await anotarCorreccion(db, { vehiculoId: v.id }, `Corregido el vehículo ${nuevo.placa}: ${cambios.join("; ")}`);
          hechas.push({ titulo: `${nuevo.placa}: ${cambios.join("; ")}` });
          return { ok: true, hecho: `Corregido el vehículo ${nuevo.placa}: ${cambios.join("; ")}`, decir: "Dile a Felipe esta frase de 'hecho', con el antes → después." };
        })();
        case "corregir_tramite": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const numero = codigoTramite(t);
          const d: Datos = soloDichos(a, { aliado: "aliado", observaciones: "observaciones", entrega_estimada: "fechaEstimadaEntrega", fecha_radicado: "fechaRadicado" });
          if (d.aliado) d.aliado = /^(ninguno|ninguna|nadie|quitar|sin aliado)$/i.test(String(d.aliado)) ? null : String(d.aliado).toUpperCase();
          if (a.agregar_observacion && String(a.agregar_observacion).trim()) d.observaciones = [d.observaciones ?? t.observaciones ?? "", String(a.agregar_observacion).trim()].filter(Boolean).join(" ");
          const orgs = await db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos);
          if (a.organismo && String(a.organismo).trim()) {
            const o = organismoDeTexto(orgs, String(a.organismo));
            if (!o) return { error: `"${a.organismo}" no está en la lista de organismos de tránsito.` };
            d.organismoId = o.id;
          }
          if (a.categorias && String(a.categorias).trim()) {
            const cats = categoriasDeTexto(String(a.categorias));
            if (!cats.length) return { error: `"${a.categorias}" no son categorías de licencia (${CATEGORIAS_LICENCIA.join(", ")}).` };
            d.detalle = cats.join(",");
          }
          if (a.tarjeta && String(a.tarjeta).trim()) {
            if (!ESTADOS_TARJETA.includes(a.tarjeta as EstadoTarjeta)) return { error: "Estado de la tarjeta no válido." };
            d.estadoTarjeta = String(a.tarjeta);
          }
          const nombres: Record<string, string> = Object.fromEntries(orgs.map((o) => [o.id, o.ciudad ?? o.nombre]));
          for (const k of ESTADOS_TARJETA) nombres[k] = ESTADO_TARJETA_LABEL[k];
          if (a.placa && String(a.placa).trim()) {
            const placa = String(a.placa).toUpperCase().replace(/[^A-Z0-9]/g, "");
            const v = await db.select({ id: E.vehiculos.id, placa: E.vehiculos.placa }).from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get();
            if (!v) return { error: `La placa ${placa} no está registrada: regístrala primero (o corrige la placa del vehículo con corregir_vehiculo si quedó mal escrita).` };
            d.vehiculoId = v.id;
            nombres[v.id] = v.placa;
            alias.set(placaDe(a.tramite), t.id);
            if (t.vehiculoId) nombres[t.vehiculoId] = (await db.select({ placa: E.vehiculos.placa }).from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get())?.placa ?? "";
          }
          if (a.titular && String(a.titular).trim()) {
            const c = await clientePor(db, a.titular);
            d.titularId = c.id;
            nombres[c.id] = c.nombre;
            nombres[t.titularId] = (await db.select({ nombre: E.clientes.nombre }).from(E.clientes).where(eq(E.clientes.id, t.titularId)).get())?.nombre ?? "";
          }
          if (!Object.keys(d).length) return { error: "No dijo qué corregir. (La plata se cambia con proponer_cobro.)" };
          await resultado(await editarTramite(db, t.id, { ...d, origen: "asistente" }));
          const nuevo = (await db.select().from(E.tramites).where(eq(E.tramites.id, t.id)).get())!;
          const cambios = antesDespues(t, nuevo, Object.keys(d), nombres);
          if (!cambios.length) return { ok: true, hecho: "Ya estaba así; no cambió nada.", tramite: numero };
          hechas.push({ titulo: `${numero}: ${cambios.join("; ")}`, tramiteId: t.id });
          return { ok: true, hecho: `Corregido ${numero}: ${cambios.join("; ")}`, decir: "Dile a Felipe esta frase de 'hecho', con el antes → después." };
        })();
        case "proponer_cobro": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const numero = codigoTramite(t);
          const n = (x: unknown) => (x === undefined || x === null || x === "" ? null : Math.round(Number(String(x).replace(/[^\d.]/g, ""))));
          const total = n(a.valor_total), derechos = n(a.derechos), honorarios = n(a.honorarios), otros = n(a.otros);
          if ([total, derechos, honorarios, otros].some((x) => x !== null && !(Number.isFinite(x) && x >= 0))) return { error: "Algún valor no es válido." };
          // Lo de antes: el total de todo el encargo (es lo que Felipe tiene en la cabeza).
          const encargo = t.encargoId ? await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId)) : [t];
          const antes = encargo.reduce((s, x) => s + x.total, 0);
          if (derechos !== null || honorarios !== null || otros !== null) {
            const nd = derechos ?? t.costoDerechos, nh = honorarios ?? t.honorarios, no = otros ?? t.otrosCostos;
            propuestas.push({ id: nuevoId(), tipo: "costos", metodo: "POST", ruta: `/api/tramites/${t.id}/costos`, cuerpo: { costoDerechos: nd, honorarios: nh, otrosCostos: no },
              titulo: `${numero}: total ${pesos(t.total)} → ${pesos(nd + nh + no)} (derechos ${pesos(nd)}, honorarios ${pesos(nh)}, otros ${pesos(no)})` });
            return { ok: true, aviso: "Propuesta lista para que Felipe la confirme en la tarjeta.", antes: pesos(t.total), despues: pesos(nd + nh + no) };
          }
          if (!(total && total > 0)) return { error: "Diga el valor nuevo." };
          if (total === antes) return { ok: true, aviso: `Ya está en ${pesos(antes)}; no hay nada que cambiar.` };
          propuestas.push({ id: nuevoId(), tipo: "costos", metodo: "POST", ruta: `/api/tramites/${t.id}/valor`, cuerpo: { valor: total },
            titulo: `${numero}${encargo.length > 1 ? ` (combo de ${encargo.length} trámites)` : ""}: valor cobrado ${pesos(antes)} → ${pesos(total)}` });
          return { ok: true, aviso: "Propuesta lista para que Felipe la confirme en la tarjeta.", antes: pesos(antes), despues: pesos(total) };
        })();
        case "consultar_comparendos_persona": return comparendosDe(db, env, { numeroDocumento: a.cedula, tipoDocumento: a.tipo_documento, actualizar: a.actualizar === true });
        case "consultar_placa": return consultarPlaca(db, env, { placa: a.placa, que: a.que, numeroDocumento: a.cedula_dueno, actualizar: a.actualizar === true });
        case "saldo_placapi": return saldoPlacApi(env);
        case "revisar_tramite": return (async () => {
          // Una placa sin trámite registrado no tiene revisión previa: se consulta la placa en el RUNT.
          const t = await tramitePor(db, a.tramite).catch((e: Error) => { throw new Error(/no est[aá] registrada|no tiene tr[aá]mites/i.test(e.message) ? `${e.message} Para revisarla en el RUNT llama YA consultar_placa con que='todo' y cedula_dueno = la cédula que Felipe dijo en la conversación, SIN volver a preguntarla; solo si no la dijo, pídesela.` : e.message); });
          const r = await revisarTramite(db, env, t.id);
          const numero = codigoTramite(t);
          const frenan = r.hallazgos.filter((h) => h.estado === "bloquea").length;
          hechas.push({ titulo: `${numero}: revisión previa (${r.creditos} créditos)${frenan ? ` · ${frenan} cosa(s) frenan` : " · nada frena"}`, tramiteId: t.id });
          const faltaron = r.faltaron ?? [];
          return { creditos_gastados: r.creditos, hallazgos: r.hallazgos.map(({ parte: _p, faltan: _f, ...h }) => h), precondiciones_marcadas: r.aprobadas,
            ...(faltaron.length ? { incompleta: `No llegó: ${listaPartes(faltaron)} (la fuente no respondió; no se cobró). Díselo a Felipe: puede pedir de nuevo solo eso en el trámite, Revisión previa → "Pedir de nuevo lo que faltó" (unos ${planReintento(faltaron).creditos} créditos).` } : {}) };
        })();
        case "anotar": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const texto = String(a.texto ?? "").trim().slice(0, 2000);
          if (!texto) return { error: "La nota está vacía." };
          await resultado(await agregarNota(db, t.id, { texto, ...origen }));
          if (a.destacada === true) {
            const nueva = await db.select({ id: E.bitacora.id }).from(E.bitacora).where(and(eq(E.bitacora.tramiteId, t.id), eq(E.bitacora.tipoEvento, "nota"), eq(E.bitacora.descripcion, texto))).orderBy(desc(E.bitacora.fecha)).get();
            if (nueva) await resultado(await destacarBitacora(db, t.id, nueva.id, { destacada: true }));
            hechas.push({ titulo: `Nota destacada en ${codigoTramite(t)}: "${recortar(texto, 160)}"`, tramiteId: t.id });
            return { ok: true, hecho: "Nota guardada y puesta como nota destacada (sale arriba del trámite)." };
          }
          hechas.push({ titulo: `Anotado en ${codigoTramite(t)}: "${recortar(texto, 160)}"`, tramiteId: t.id });
          return { ok: true, hecho: "Nota guardada." };
        })();
        case "destacar_nota": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const numero = codigoTramite(t);
          const ids = (await partesDelCombo(db, t)).map((x) => x.id);
          const entradas = await db.select().from(E.bitacora).where(inArray(E.bitacora.tramiteId, ids)).orderBy(desc(E.bitacora.fecha));
          if (a.quitar === true) {
            const d = entradas.find((b) => b.destacada);
            if (!d) return { ok: true, hecho: `${numero} no tenía nota destacada.` };
            await resultado(await destacarBitacora(db, d.tramiteId, d.id, { destacada: false }));
            hechas.push({ titulo: `${numero}: se quitó la nota destacada`, tramiteId: t.id });
            return { ok: true, hecho: "Se quitó la nota destacada." };
          }
          const busca = normalizar(String(a.texto ?? "")).split(" ").filter((w) => w.length >= 3);
          const notas = entradas.filter((b) => b.tipoEvento === "nota");
          const elegida = busca.length
            ? notas.map((b) => ({ b, n: busca.filter((w) => normalizar(b.descripcion ?? "").includes(w)).length })).filter((x) => x.n).sort((x, y) => y.n - x.n)[0]?.b
            : notas[0];
          if (!elegida) return { error: busca.length ? `No encontré en la bitácora de ${numero} una nota con «${a.texto}». Si es nueva, anótala con destacada=true.` : `${numero} no tiene notas en la bitácora.` };
          await resultado(await destacarBitacora(db, elegida.tramiteId, elegida.id, { destacada: true }));
          hechas.push({ titulo: `Nota destacada en ${numero}: "${recortar(elegida.descripcion, 160)}"`, tramiteId: t.id });
          return { ok: true, hecho: `Quedó como nota destacada: «${recortar(elegida.descripcion, 200)}».` };
        })();
        case "poner_persona": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const numero = codigoTramite(t);
          const rol = String(a.rol) as RolPersona;
          if (!ROLES_PERSONA.includes(rol) || rol === "titular") return { error: "Papel no válido (el titular se cambia con corregir_tramite)." };
          const doc = String(a.numero_documento ?? "").replace(/\D/g, "");
          let cliente = doc ? await db.select().from(E.clientes).where(eq(E.clientes.numeroDocumento, doc)).get() : undefined;
          if (!cliente && a.cliente && String(a.cliente).trim()) cliente = await clientePor(db, a.cliente).catch((e: Error) => { if (/No encontr/.test(e.message)) return undefined; throw e; });
          if (!cliente && !doc && a.nombre && String(a.nombre).trim()) cliente = await clientePor(db, a.nombre).catch((e: Error) => { if (/No encontr/.test(e.message)) return undefined; throw e; });
          let creado = false;
          if (!cliente) {
            const nombre = String(a.nombre ?? a.cliente ?? "").trim();
            if (!nombre || /^\d+$/.test(nombre)) return { error: `No encontré a esa persona en la base. Para crearla dime su nombre completo${doc ? "" : " (y la cédula si la tienes)"}.` };
            const r = await resultado(await crearCliente(db, { nombre: nombre.toUpperCase(), numeroDocumento: doc || null, tipoDocumento: a.tipo_documento || "CC", telefono: a.telefono ? String(a.telefono).replace(/\D/g, "") : null }));
            cliente = (await db.select().from(E.clientes).where(eq(E.clientes.id, String(r.id))).get())!;
            creado = true;
          }
          const ya = await db.select({ id: E.tramitePersonas.id, clienteId: E.tramitePersonas.clienteId, nombre: E.clientes.nombre }).from(E.tramitePersonas)
            .innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId)).where(and(eq(E.tramitePersonas.tramiteId, t.id), eq(E.tramitePersonas.rol, rol)));
          if (ya.some((p) => p.clienteId === cliente!.id)) return { ok: true, hecho: `${cliente.nombre} ya era el ${ROL_PERSONA_LABEL[rol].toLowerCase()} de ${numero}.` };
          for (const p of ya) await resultado(await quitarPersona(db, t.id, p.id, { origen: "asistente" }));
          await resultado(await agregarPersona(db, t.id, { clienteId: cliente.id, rol, origen: "asistente" }));
          const antes = ya.map((p) => (sinDato(p.nombre) ? "sin datos" : p.nombre)).join(", ") || "nadie";
          const frase = `${numero}: ${ROL_PERSONA_LABEL[rol].toLowerCase()} ${antes} → ${cliente.nombre}${cliente.numeroDocumento ? ` (CC ${cliente.numeroDocumento})` : " (sin cédula)"}${creado ? " · creado como cliente nuevo" : ""}`;
          hechas.push({ titulo: frase, tramiteId: t.id });
          return { ok: true, hecho: frase, decir: "Dile a Felipe esta frase de 'hecho'." };
        })();
        case "quitar_persona": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const rol = String(a.rol) as RolPersona;
          const ya = await db.select({ id: E.tramitePersonas.id, nombre: E.clientes.nombre, doc: E.clientes.numeroDocumento }).from(E.tramitePersonas)
            .innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId)).where(and(eq(E.tramitePersonas.tramiteId, t.id), eq(E.tramitePersonas.rol, rol)));
          const ref = normalizar(String(a.cliente ?? ""));
          const cuales = ref ? ya.filter((p) => normalizar(`${p.nombre} ${p.doc ?? ""}`).includes(ref)) : ya;
          if (!cuales.length) return { error: `${codigoTramite(t)} no tiene ${ROL_PERSONA_LABEL[rol]?.toLowerCase() ?? rol}${ref ? ` que encaje con «${a.cliente}»` : ""}.` };
          const reales = cuales.filter((p) => !sinDato(p.nombre));
          if (reales.length > 1) return { error: `Hay ${reales.length}: ${reales.map((p) => p.nombre).join(", ")}. Pregunta cuál.` };
          for (const p of cuales) await resultado(await quitarPersona(db, t.id, p.id, { origen: "asistente" }));
          const quien = reales[0]?.nombre ?? "el que estaba sin datos (NA)";
          hechas.push({ titulo: `${codigoTramite(t)}: se quitó a ${quien} (${ROL_PERSONA_LABEL[rol].toLowerCase()})`, tramiteId: t.id });
          return { ok: true, hecho: `Quitado ${quien}.` };
        })();
        case "buscar_licencias": return (async () => {
          const hoy = hoyColombia();
          const filas = a.cliente && String(a.cliente).trim()
            ? await db.select().from(E.licencias).where(eq(E.licencias.clienteId, (await clientePor(db, a.cliente)).id))
            : await db.select().from(E.licencias).where(sql`${E.licencias.fechaVencimiento} BETWEEN ${hoy} AND ${sumarDias(hoy, Math.min(365, Math.max(1, Number(a.vencen_en_dias) || 60)))}`).orderBy(E.licencias.fechaVencimiento).limit(30);
          const nombres = new Map((await db.select({ id: E.clientes.id, nombre: E.clientes.nombre, doc: E.clientes.numeroDocumento }).from(E.clientes).where(inArray(E.clientes.id, [...new Set(filas.map((l) => l.clienteId))].slice(0, 90)))).map((c) => [c.id, `${c.nombre}${c.doc ? ` (CC ${c.doc})` : ""}`]));
          if (!filas.length) return { licencias: [], aviso: a.cliente ? "Ese cliente no tiene licencias registradas." : "Ninguna vence en esos días." };
          return { licencias: filas.map((l) => ({ cliente: nombres.get(l.clienteId), categoria: l.categoria, expedicion: l.fechaExpedicion, vence: l.fechaVencimiento, vencida: l.fechaVencimiento < hoy, seguimiento: ESTADO_GESTION_LICENCIA_LABEL[l.gestionEstado as EstadoGestionLicencia], nota: l.gestionNota })) };
        })();
        case "corregir_licencia": return (async () => {
          const c = await clientePor(db, a.cliente);
          const antes = await db.select().from(E.licencias).where(eq(E.licencias.clienteId, c.id));
          const pedidas = categoriasDeTexto(Array.isArray(a.categorias) ? a.categorias.join(",") : String(a.categorias ?? ""));
          const cats = pedidas.length ? pedidas : antes.map((l) => l.categoria);
          if (!cats.length) return { error: `${c.nombre} no tiene licencias registradas: dime las categorías y la fecha de vencimiento para registrarlas.` };
          const vence = a.fecha_vencimiento && String(a.fecha_vencimiento).trim() ? String(a.fecha_vencimiento).trim() : null;
          const expide = a.fecha_expedicion && String(a.fecha_expedicion).trim() ? String(a.fecha_expedicion).trim() : null;
          if (pedidas.length && !vence && !expide && !a.seguimiento && !a.nota_seguimiento) {
            // "La renovación de X es B1 y C1": las categorías del TRÁMITE de licencia que tiene abierto.
            const tl = await db.select({ t: E.tramites }).from(E.tramites).innerJoin(E.tiposTramite, eq(E.tiposTramite.id, E.tramites.tipoId))
              .where(and(eq(E.tramites.titularId, c.id), eq(E.tiposTramite.categoria, "licencia"), notInArray(E.tramites.estado, ESTADOS_TERMINALES))).get();
            if (tl) {
              await resultado(await editarTramite(db, tl.t.id, { detalle: pedidas.join(","), origen: "asistente" }));
              const frase = `${codigoTramite(tl.t)}: categorías ${tl.t.detalle ?? "vacías"} → ${pedidas.join(",")}`;
              hechas.push({ titulo: frase, tramiteId: tl.t.id });
              return { ok: true, hecho: frase, decir: "Son las categorías del trámite de licencia que tiene abierto: dile a Felipe esta frase." };
            }
          }
          for (const f of [vence, expide]) if (f && !esFecha(f)) return { error: "Las fechas van como AAAA-MM-DD." };
          const cambios: string[] = [];
          if (vence || expide || cats.some((k) => !antes.some((l) => l.categoria === k))) {
            for (const k of cats) {
              const l = antes.find((x) => x.categoria === k);
              const v = vence ?? l?.fechaVencimiento;
              if (!v) return { error: `Para registrar la ${k} falta la fecha de vencimiento.` };
              const ex = expide ?? l?.fechaExpedicion ?? null;
              if (l && l.fechaVencimiento === v && (l.fechaExpedicion ?? null) === ex) continue;
              await resultado(await registrarLicencias(db, c.id, { categorias: [k], fechaVencimiento: v, fechaExpedicion: ex }));
              cambios.push(l ? `${k}: ${[l.fechaVencimiento !== v ? `vence ${l.fechaVencimiento} → ${v}` : "", (l.fechaExpedicion ?? null) !== ex ? `expedición ${l.fechaExpedicion ?? "vacía"} → ${ex ?? "vacía"}` : ""].filter(Boolean).join(", ")}` : `${k} registrada (vence ${v}${ex ? `, expedida ${ex}` : ""})`);
            }
          }
          const seg = a.seguimiento && ESTADOS_GESTION_LICENCIA.includes(a.seguimiento as EstadoGestionLicencia) ? (a.seguimiento as EstadoGestionLicencia) : null;
          const nota = a.nota_seguimiento && String(a.nota_seguimiento).trim() ? String(a.nota_seguimiento).trim() : null;
          if (seg || nota) {
            const ahora = await db.select().from(E.licencias).where(eq(E.licencias.clienteId, c.id));
            for (const l of ahora.filter((x) => cats.includes(x.categoria))) {
              await resultado(await seguimientoLicencia(db, l.id, { ...(seg ? { gestionEstado: seg } : {}), ...(nota ? { gestionNota: nota } : {}) }));
              if (seg && seg !== l.gestionEstado) cambios.push(`${l.categoria}: seguimiento ${ESTADO_GESTION_LICENCIA_LABEL[l.gestionEstado as EstadoGestionLicencia]} → ${ESTADO_GESTION_LICENCIA_LABEL[seg]}`);
            }
            if (nota) cambios.push(`nota del seguimiento: «${recortar(nota, 120)}»`);
          }
          if (!cambios.length) return { ok: true, hecho: "Ya estaba así; no cambió nada." };
          await anotarCorreccion(db, { clienteId: c.id }, `Licencia de ${c.nombre}: ${cambios.join("; ")}`);
          hechas.push({ titulo: `Licencia de ${c.nombre}: ${cambios.join("; ")}` });
          return { ok: true, hecho: `Licencia de ${c.nombre}: ${cambios.join("; ")}`, decir: "Dile a Felipe esta frase de 'hecho'." };
        })();
        case "cambiar_estado": return (async () => {
          const t = await tramitePor(db, a.tramite);
          const estado = String(a.estado) as EstadoTramite;
          if (!ESTADOS_EN_USO.includes(estado)) return { error: "Estado no válido." };
          const numero = codigoTramite(t);
          if (a.aprobar_precondiciones === true) {
            // Un combo: las de todas sus partes (si no, la otra parte no deja moverlo).
            for (const x of await partesDelCombo(db, t)) await resultado(await marcarPrecondicion(db, x.id, { todas: true, soloEste: true, ...origen }));
            hechas.push({ titulo: `${numero}: todas las precondiciones aprobadas`, tramiteId: t.id });
          }
          await resultado(await cambiarEstado(db, t.id, { estado, ...origen }));
          hechas.push({ titulo: `${numero}: ${ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite]} → ${ESTADO_TRAMITE_LABEL[estado]}`, tramiteId: t.id });
          return { ok: true, hecho: `Quedó en ${ESTADO_TRAMITE_LABEL[estado]}.` };
        })();
        case "marcar_precondiciones": return (async () => {
          const t0 = await tramitePor(db, a.tramite);
          const numero = codigoTramite(t0);
          if (a.todas === true) {
            // Un combo: las de todas sus partes.
            for (const x of await partesDelCombo(db, t0)) await resultado(await marcarPrecondicion(db, x.id, { todas: true, soloEste: true, ...origen }));
            hechas.push({ titulo: `${numero}: todas las precondiciones aprobadas`, tramiteId: t0.id });
            return { ok: true, hecho: "Todas marcadas como cumplidas." };
          }
          const flags = [...new Set([...(Array.isArray(a.precondiciones) ? a.precondiciones : []), a.precondicion].map((x) => String(x ?? "")).filter(Boolean))];
          const malas = flags.filter((f) => !(PRECONDICIONES as readonly string[]).includes(f));
          if (!flags.length || malas.length) return { error: malas.length ? `No conozco estas precondiciones: ${malas.join(", ")}.` : "Diga cuáles precondiciones, o todas=true." };
          const ok = a.cumplida !== false;
          const nota = a.nota && String(a.nota).trim() ? String(a.nota).trim().slice(0, 500) : undefined;
          for (const flag of flags) for (const t of await partesConPrecondicion(db, t0, flag)) await resultado(await marcarPrecondicion(db, t.id, { flag, ok, soloEste: true, ...(nota ? { nota } : {}), ...origen }));
          const lista = flags.map((f) => PRECONDICION_LABEL[f as Precondicion]).join(", ");
          hechas.push({ titulo: `${numero}: ${lista} ${ok ? (flags.length > 1 ? "cumplidas" : "cumplida") : (flags.length > 1 ? "pendientes" : "pendiente")}${nota ? ` (${recortar(nota, 80)})` : ""}`, tramiteId: t0.id });
          return { ok: true, hecho: `${ok ? "Marcadas como cumplidas" : "Desmarcadas"}: ${lista}.` };
        })();
        case "crear_recordatorio": return (async () => {
          const fecha = String(a.fecha ?? "");
          if (!esFecha(fecha)) return { error: "La fecha debe ser AAAA-MM-DD." };
          const t = a.tramite ? await tramitePor(db, a.tramite).catch(() => null) : null;
          const tipo = ["recordatorio", "llamada", "cita"].includes(String(a.tipo)) ? String(a.tipo) : "recordatorio";
          await resultado(await crearRecordatorio(db, { titulo: a.titulo, fecha, hora: a.hora || null, tipo, clienteId: a.cliente_id || t?.titularId || null, tramiteId: t?.id ?? null }));
          hechas.push({ titulo: `${tipo === "llamada" ? "Llamada" : tipo === "cita" ? "Cita" : "Recordatorio"} el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}${a.hora ? ` a las ${a.hora}` : ""}: ${String(a.titulo ?? "").slice(0, 160)}`, tramiteId: t?.id });
          return { ok: true, hecho: "Recordatorio creado." };
        })();
        default: return undefined;
      }
    },
  };
}

/* ───────────────────────── conversación ───────────────────────── */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Hoy con su día de la semana y los próximos 7 días: el modelo calcula mal "el próximo lunes" por su cuenta. */
export function calendario() {
  const hoy = hoyColombia();
  const dia = (f: string) => DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()];
  const proximos = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i + 1)).map((f) => `${dia(f)} ${f}`).join(", ");
  return `Hoy es ${dia(hoy)} ${hoy}. Próximos días: ${proximos}. Para fechas relativas ("mañana", "el lunes") usa esta lista.`;
}

async function instrucciones(db: Db) {
  const [p, tipos, orgs] = await Promise.all([
    leerParametros(db),
    db.select({ nombre: E.tiposTramite.nombre }).from(E.tiposTramite).where(eq(E.tiposTramite.activo, true)),
    db.select({ ciudad: E.organismos.ciudad }).from(E.organismos).where(eq(E.organismos.activo, true)),
  ]);
  return [
    `Eres el asistente interno de ${p.nombre_negocio || "la oficina"}, una gestoría de trámites de tránsito en Ibagué (Colombia). Hablas solo con Felipe, el dueño.`,
    "Reglas:",
    "- Respondes con datos reales de la base usando las herramientas. Nunca inventes clientes, placas, cifras ni fechas. Si no encuentras algo, dilo.",
    "- Le hablas directamente a Felipe, de tú (nunca 'Felipe debe...').",
    "- Cuando Felipe te pide anotar, cambiar un estado, aprobar precondiciones o crear un recordatorio, lo HACES tú con anotar, cambiar_estado, marcar_precondiciones y crear_recordatorio, y le confirmas en una línea qué hiciste. Ejemplo: 'el de la placa ABC123 ya salió, apruébale todo' = cambiar_estado a entregado con aprobar_precondiciones=true. Pero si SOLO pide aprobar las precondiciones ('apruébale todas las precondiciones'), usa solo marcar_precondiciones y NO cambies el estado.",
    "- Antes de cambiar algo, identifica el trámite con buscar_tramites (por placa, nombre o número). Si hay más de un trámite abierto que encaja y no es claro cuál, pregunta antes de tocar nada. Si la búsqueda trae un 'aviso' de que encajan varios clientes distintos (dos Ana Gómez), NO cambies nada: pregunta de cuál. Nunca cambies un trámite que no hayas encontrado.",
    "- Corregir una COTIZACIÓN (Felipe da el avalúo verdadero, el valor de un trámite, 'cobra 10.000 de traslado', 'saca el 1 % de 10.000.000'): vuelve a llamar requisitos_y_costos con los MISMOS datos del vehículo y trámites, y con avaluo y/o tarifas_dichas; y responde con la cotización nueva que devuelve (con sus números, sin calcular tú). Un avalúo que Felipe dice va en avaluo, NUNCA en precio_venta. Los honorarios que diga para una cotización ('cóbrale 300 mil de honorarios') van en honorarios. Pero si nombra una placa o un trámite REGISTRADO ('los honorarios del traspaso de la ABC123 son 100.000', 'el trámite de la ABC123 vale 700'), es plata de ese trámite: proponer_cobro sobre él, no una cotización. Nunca digas que actualizaste algo que no cambiaste: lo que cambia plata queda como propuesta para que Felipe la confirme. Corregir una cotización NO toca trámites registrados: no uses proponer_cobro, salvo que Felipe nombre un trámite registrado (T-...) o diga 'el trámite de la placa ...'.",
    "- Un COMBO (varios trámites hechos de una vez: traspaso + levantamiento de prenda...) es UN SOLO trámite con un solo código: háblalo como uno ('A ABC123 se le está haciendo traspaso y levantamiento de prenda, T-2026-00684'). NUNCA preguntes cuál de sus partes ni lo muestres como dos trámites. Estado, precondiciones, valor y pagos son del combo entero.",
    "- Si una acción falla (por ejemplo, faltan precondiciones), dile exactamente qué falta; no digas que quedó hecho.",
    "- VARIOS CAMBIOS EN UN MENSAJE: Felipe suele pedir muchas cosas juntas ('del de la Pitágoras anota que lo rechazaron por la firma y déjalo como nota destacada, márcale el SIMIT que ya pagó los comparendos, el comprador es Luis Rojas CC 123 y pásalo a corrección'). Hazlas TODAS: llama varias herramientas a la vez y no te detengas en la primera. Al terminar, responde con una lista corta: cada cosa hecha (las correcciones con antes → después) y, aparte, lo que no se pudo (con el porqué) o quedó como propuesta. Si una de ellas no es clara (de quién, de cuál trámite), haz las demás y pregunta solo por esa. Nunca digas que hiciste algo que ninguna herramienta confirmó.",
    "- Antes de responder, repasa el mensaje de Felipe frase por frase: cada cosa que pidió debe tener su herramienta (si dijo el organismo, la fecha, el aliado y una casilla, son cuatro cambios; los datos de un mismo trámite van juntos en UNA llamada a corregir_tramite). No hagas lo que no pidió: 'sale el 25' o 'se entrega el 25' es la entrega_estimada del trámite, NO un recordatorio; crea recordatorios solo si dice recuérdame, agéndame, llámalo, cita.",
    "- Un trámite se puede nombrar por el cliente ('la renovación de Ana Gómez', 'el de Marta Díaz'): pasa su nombre o cédula en tramite. 'La renovación de X', 'el trámite de licencia de X' es un TRÁMITE (sus categorías con corregir_tramite); 'la licencia de X' (la que ya tiene, su vencimiento, el seguimiento de la renovación) es corregir_licencia.",
    "- En un mensaje con varios cambios, un pago que cuenta Felipe ('pagó 200 mil por Nequi', 'abonó', 'consignó', 'ya canceló') va SIEMPRE con proponer_pago (además de lo demás), no en una nota ni en una casilla. 'Ya salió', 'ya está terminado', 'ya lo entregué' = cambiar_estado a entregado (Finalizado), nunca a en_tramite. Cambia el estado SOLO si Felipe lo pide ('pásalo a...', 'ya lo radiqué', 'ya salió'): marcar casillas o corregir datos no mueve el estado.",
    "- Frases que se confunden: 'los honorarios del trámite de la ABC123 son 100.000' = proponer_cobro con honorarios=200000 (NO valor_total); 'vale 100.000' o 'cóbrale 700 mil' = valor_total. 'Llegó la tarjeta', 'la tarjeta quedó en la oficina' = corregir_tramite con tarjeta=en_oficina ('se la entregué' = entregada; 'se la mandé' = enviada), nunca una nota. 'El titular es X' = corregir_tramite con titular (NO es vendedor ni comprador).",
    "- NOTA DESTACADA: es la nota más importante del trámite (un rechazo, un problema); sale grande arriba del expediente. 'ponlo como nota destacada', 'destácalo', 'que se vea arriba' = anotar con destacada=true si es algo nuevo, o destacar_nota si ya está anotado. 'quítale la nota destacada' = destacar_nota con quitar=true.",
    "- CASILLAS (precondiciones): marcar_precondiciones con TODAS las que Felipe nombre en una sola llamada (precondiciones=[...]). 'ya pagó los comparendos' = paz_salvo_simit; 'pagó el impuesto' = paz_salvo_impuesto; 'ya levantaron la prenda' = sin_gravamenes; 'llegó la carta de prenda' o 'ya está la carta del banco' = carta_prenda; 'no tiene embargos' o 'revisé el RUNT y no tiene medidas' = sin_embargos; 'firmó el contrato' = contrato; 'ya tomamos improntas' = improntas; 'autenticaron' = identidad. Si dice el porqué, va en nota. 'desmárcale' = cumplida=false. Marcar casillas NO cambia el estado.",
    "- PERSONAS de un trámite: 'el comprador es ...', 'el vendedor es ...' = poner_persona (reemplaza al que estaba, también si estaba NA o sin datos). Usa el nombre y la cédula TAL CUAL los dijo Felipe; no inventes la cédula ni el teléfono. El titular se cambia con corregir_tramite.",
    "- LICENCIAS de conducción de un cliente (categorías, vencimiento, expedición, seguimiento de la renovación: 'ya lo llamé', 'quedó agendado', 'ya renovó', 'no le interesa'): buscar_licencias y corregir_licencia. Las categorías de un TRÁMITE de licencia se corrigen con corregir_tramite.",
    "- Los pagos NO los registras tú: usa proponer_pago y él lo confirma en una tarjeta.",
    "- ANOTAR UN TRÁMITE NUEVO ('anótame un traspaso de la ABC123 de Pedro Ruiz a Clara Mora en Funza', 'anota una renovación de licencia B1 de...'): usa proponer_tramite y Felipe lo confirma en la tarjeta. Primero busca si ya existe (buscar_tramites por la placa o el cliente): si ya está abierto ese trámite, díselo y no lo propongas. Si falta un dato necesario (la ciudad: '¿Es en Ibagué?'; el comprador de un traspaso; la cédula, categorías y fecha de nacimiento en licencias), pregúntalo antes, TODO lo que falte en UNA sola pregunta. Anotar en un trámite que ya existe es anotar (una nota), no esto.",
    "- LICENCIAS NUEVAS: los trámites de licencia son Expedición (1ª vez: 'primera vez', 'primer vez', 'sacar la licencia', 'licencia nueva'), Renovación ('refrendación', 'refrendar', 'renovar', 'se le venció'), Recategorización ('subir de categoría', 'agregar otra categoría'), Duplicado ('se le perdió', 'se la robaron') y Migración (la licencia vigente de un MENOR de edad pasa a ser de mayor: 'pasarla a mayor de edad', 'ya cumplió 18'). Felipe suele decir todo en un mensaje (la orden, el trámite, las categorías, el nombre y la cédula, la fecha de nacimiento, el teléfono, lo que cobra, lo que abonó y la ciudad): TOMA CADA DATO de ese mensaje de una vez y no vuelvas a preguntar nada que ya dijo; y NUNCA pongas un dato que él no dijo (ni de estos ejemplos). Categorías: 'b1 y c1', 'B1C1', 'categoría C 2' = B1, C1, C2; 'moto' o 'carro' NO son categorías (pregunta A1/A2 o B1/C1). Fechas habladas a AAAA-MM-DD (un año de dos cifras como '83' es 1983); si solo dice la edad, pide la fecha. Plata: 'le cobro 350' o '350 mil' = 350000; 'abonó 100' = abono 100000. El teléfono va en la persona. Lo demás que diga del trámite va en observaciones, en sus palabras. La edad la revisa proponer_tramite (no la calcules tú): si responde que no cumple la edad, díselo a Felipe con ese mensaje. EXPEDICIÓN (primera vez, de cualquier categoría): pregunta si es CON clases o SIN clases (si no lo dijo), en la misma pregunta con lo demás que falte, y pásalo en con_clases; con clases o sin clases (y también en Migración), al anotarlo queda la alerta de que la persona debe firmar la carta de compromiso de terminar las clases (queda pendiente en Archivos para subirla firmada): díselo a Felipe. Una orden de anotar ('anótame', 'agrégame', 'regístrame', 'pásame a mayor de edad la licencia de X') es proponer_tramite: NO es una consulta (no busques sus licencias) ni una cotización (no llames requisitos_y_costos aunque diga 'le cobro' o 'cobra': eso es el valor). La persona no tiene que existir en la base: proponer_tramite la crea; no le preguntes si quiere registrarla como cliente. Pero solo es un trámite NUEVO si pide anotarlo: 'la renovación de X no es B1, es B1 y C1' corrige el trámite que ya tiene (corregir_tramite), y 'X tiene licencia B1 que vence el...' o 'X ya renovó' es la licencia que ya tiene (corregir_licencia).",
    "- LICENCIA DE CONDUCCIÓN no es LICENCIA DE TRÁNSITO: la de conducción es el pase de la PERSONA (categorías A2, B1, C1...; sus trámites son los de licencia y sus precios los de la tabla de licencias); la de tránsito es la tarjeta de propiedad del VEHÍCULO (con placa; su duplicado es 'Duplicado de licencia de tránsito', con su tarifa). 'Duplicado de licencia' con placa o hablando del carro o la moto = Duplicado de licencia de tránsito; de una persona, con categorías o 'el pase' = Duplicado de licencia (de conducción). Si no se sabe cuál, pregunta '¿De la licencia de conducción o de la de tránsito?'. Nunca uses los precios de licencias de conducción para la de tránsito ni al revés.",
    "- PRECIOS DE LICENCIAS DE CONDUCCIÓN ('cuánto vale la licencia B1', 'la A2 con clases', 'cuánto la refrendación', 'B1 más A2', 'el duplicado'): cotiza con requisitos_y_costos (tipo = Expedición de licencia (1ª vez), Renovación, Recategorización o Duplicado; categorias; con_clases solo si lo dijo) y copia su texto_listo: trae el precio, las horas, el tiempo aproximado en días hábiles y los requisitos. En la primera vez, si no dijo con o sin clases, da los dos precios (ya vienen en el aviso). Si una combinación no tiene precio, dilo así y pregúntale a Felipe cuánto cobra: NO lo inventes ni sumes precios. Al anotar un trámite de licencia sin valor dicho, el cobro sugerido ya sale con el precio de la oficina (no con los 100.000 de honorarios): no le pongas valor. Los mensajes listos para el cliente están en el menú Más > Plantillas de mensajes.",
    "- EL MAPA (la pantalla principal): Colombia con cada ciudad donde hay trámites; cada trámite abierto queda en la ciudad de su organismo de tránsito desde que se recibe, con su punto de semáforo: rojo atrasado o en corrección, amarillo le falta algo (un dato o una casilla), azul al día, morado ya salió y falta entregar la tarjeta o cobrar. Con pocos trámites en una ciudad se ve la placa junto al punto. Dentro de Ibagué (la oficina) las carpetas están en los archivadores (recibidos), corrección, tránsito y la bandeja de salida. Por cobrar es solo lo de los trámites finalizados. Si Felipe pregunta por algo del mapa ('¿qué es el punto rojo de Funza?', '¿qué hay en Medellín?'), búscalo con buscar_tramites y explícalo así.",
    "- Corregir datos (nombre, cédula, teléfono, dirección, fecha de nacimiento de un cliente; datos de un vehículo como SOAT, técnico-mecánica, impuesto, motor, color; organismo, aliado, observaciones, fechas, categorías, tarjeta física, placa o titular de un trámite): lo HACES tú con corregir_cliente, corregir_vehiculo o corregir_tramite, y le dices en una línea qué cambió (antes → después, como lo devuelve la herramienta). Cambia SOLO lo que Felipe dijo: no completes ni 'arregles' otros campos por tu cuenta. Si no es claro de quién o de cuál se trata, pregunta antes.",
    "- La plata (lo que se cobra, el valor de un trámite, derechos, honorarios) NO la cambias tú: usa proponer_cobro y él confirma en la tarjeta. 'El ABC123 vale 100.000' o 'cóbrale 700 mil' = proponer_cobro(tramite='ABC123', valor_total=700000) DE UNA VEZ: la placa sirve, y si tiene varios trámites del mismo encargo (traspaso + levantamiento de prenda) el valor es de todo el encargo, así que NO preguntes a cuál. Solo si la herramienta dice que no son del mismo encargo, pregunta. Los pagos que hizo el cliente van con proponer_pago, no con proponer_cobro.",
    "- Cotizar (cuánto vale, cuánto cuesta, derechos, tarifa, precio de un trámite): usa SIEMPRE requisitos_y_costos; buscar_tramites es solo para trámites ya registrados, no para precios.",
    "- CIFRAS: toda cifra en pesos que escribas sale de una herramienta o la dijo Felipe. Al cotizar, copia el campo texto_listo TAL CUAL (es la cotización exacta) y agrega a lo sumo una o dos líneas tuyas (requisitos, qué falta); no reescribas ni recalcules sus valores. Cualquier otra cuenta (sumar, restar, la mitad, un porcentaje, redondear) la haces con calcular. Un 'párrafo resumido' nombra cada valor de la cotización (cada concepto con su valor, y el total), con los mismos números.",
    "- Para cotizar solo hacen falta DOS datos: el trámite y la ciudad del organismo de tránsito. Si falta el trámite, pregúntalo. Si falta la ciudad, pregunta exactamente '¿Es en Ibagué?' (casi todo es en Ibagué): si Felipe dice que sí, cotiza en Ibagué; si dice que no, pregúntale en qué ciudad. Nunca uses una ciudad que Felipe no dijo ni confirmó. Si ya tienes los dos, llama a requisitos_y_costos DE UNA VEZ con lo que haya: NO pidas antes la placa, el precio, el modelo, la línea ni ningún otro dato (lo que falte lo dice la herramienta y lo pides después). Si Felipe solo da una placa, pregúntale qué trámite y si es en Ibagué.",
    "- Ejemplos. 'Cotiza un traspaso en Ibagué de un Renault Logan 2018 de 1598 cc' → llamas YA requisitos_y_costos(tipo='Traspaso de propiedad', organismo='Ibagué', marca='RENAULT', linea='LOGAN', modelo='2018', cilindraje='1598'), sin preguntar el precio. 'Traspaso y levantamiento de prenda en Espinal de un Spark 2016' → una llamada con tipo='Traspaso de propiedad', otros_tipos=['Levantamiento de prenda'], organismo='Espinal'. 'Cuánto vale un traspaso' → preguntas '¿Es en Ibagué?'. Si Felipe YA dijo la ciudad ('en Ibagué', 'en Neiva'), NUNCA preguntes '¿Es en Ibagué?': úsala. '¿Cuánto me cobras en Ibagué?' → preguntas solo qué trámite. '¿Cuánto vale renovar la licencia B1 en Ibagué?' → llamas YA requisitos_y_costos(tipo='Renovación de licencia', organismo='Ibagué'). 'Cuánto cobras en Neiva' → preguntas solo el trámite.",
    "- Traspasos que NO son el normal: 'Traspaso a persona interesada' ('persona interesada', 'por persona interesada') es cuando JUAN PEREZ el vehículo (hace más de 3 años) firmó los papeles del traspaso pero perdió contacto con el dueño y quiere ponerlo a su nombre: el interesado es el comprador. 'Traspaso a persona indeterminada' es al revés: el DUEÑO vendió, no sabe a quién y quiere desligarse del vehículo. Si Felipe dice 'traspaso' a secas, es 'Traspaso de propiedad'; si cuenta la historia del que tiene el carro o la moto hace años y no encuentra al dueño, es a persona interesada (si no está claro, pregúntale cuál de los dos).",
    "- A requisitos_y_costos pásale lo que Felipe dijo, tal cual: marca, línea completa (por ejemplo 'PICANTO ION 1.25 MT'), modelo, cilindraje, clase y precio de venta; la placa solo si la dijo. Varios trámites del mismo vehículo: UNA llamada con tipo y otros_tipos. Varios vehículos: una llamada por vehículo y al final el total de todo.",
    "- Si la herramienta responde 'falta' (precio de venta para la retención, tarifa de esa ciudad), da el TOTAL PARCIAL que trae y di qué falta, preguntando por el precio si es eso. Si responde un error (una ciudad o un trámite que no están en la lista), dilo así ('no tengo X en la lista') y no des valores. Si piden un trámite que no está en la lista de tipos de trámite (por ejemplo blindaje), llama igual a requisitos_y_costos para confirmarlo y dile que no lo manejas.",
    "- Presenta la cotización como la oficina: cada concepto con su valor (derechos, retención, paz y salvo, honorarios) y el TOTAL con la cifra exacta; con varios trámites, los conceptos de cada uno y los honorarios UNA sola vez, como vienen; di de qué línea y modelo salió el avalúo y sobre qué valor va la retención.",
    "- PlacApi (comparendos, multas, SIMIT, RUNT, SOAT, técnico-mecánica, prendas, impuesto de un vehículo o persona REAL): usa consultar_comparendos_persona, consultar_placa o revisar_tramite SOLO cuando Felipe lo pida; cuestan créditos. Di siempre cuántos créditos gastó (creditos_gastados) o que fue gratis porque ya se había consultado hoy. Para una placa el RUNT pide la cédula del dueño actual: si la herramienta dice que falta, pídela. 'Debe comparendos esta placa' = consultar_placa con que='comparendos'; 'revísame todo de la placa' = que='todo'; si es de un trámite, mejor revisar_tramite.",
    "- Si el mensaje trae 'Fotos adjuntas (leídas)', usa esos datos (cédula, placa, dueño) para lo que Felipe pida; no le vuelvas a pedir lo que ya está en las fotos. Si con esas fotos pide 'anótame' o 'regístrame' un trámite (una renovación de licencia, un traspaso...), es un trámite NUEVO de esa persona: no lo anotes como nota en otro trámite; dile que lo registre adjuntando las fotos y escribiendo 'regístrame' con lo que es.",
    "- Las cifras salen tal cual de las herramientas; no sumes ni ordenes por tu cuenta si la herramienta ya lo trae.",
    "- Estados: Recibido (en_preparacion), En tránsito (en_tramite), Finalizado (entregado), Requiere corrección, Cancelado.",
    "- Un trámite con info_incompleta está preanotado (le falta un dato esencial: el comprador, el vehículo...). Cuando hables de él, dile a Felipe qué le falta; si pide el resumen, menciona cuántos hay con info incompleta. Que le falte información NO impide nada: si Felipe pide moverlo, finalizarlo, aprobarle casillas o cualquier cambio, HAZLO y al final solo menciona lo que le falta.",
    "- Nombra los trámites por su número (T-AÑO-#####), los clientes por su nombre y los vehículos por su placa.",
    "- Fechas en formato DD/MM/AAAA al escribirle a Felipe. Plata en pesos con puntos ($1.250.000).",
    "- Español colombiano, directo y breve. Sin tablas ni encabezados; listas cortas solo si ayudan.",
    p.asistente_estilo === "detallado" ? "- Estilo detallado: explica el porqué y los pasos." : "- Estilo breve: ve al grano.",
    p.asistente_instrucciones ? `- Instrucciones de Felipe: ${p.asistente_instrucciones}` : "",
    calendario(),
    `Tipos de trámite: ${tipos.map((t) => t.nombre).join("; ")}.`,
    tablaPreciosLicencia(),
    `Organismos: ${orgs.map((o) => o.ciudad).filter(Boolean).join(", ")}.`,
  ].filter(Boolean).join("\n");
}

export type MensajeIA = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };

/** Herramientas propias de quien llama (por ejemplo, el monitor de WhatsApp), además de las del asistente. */
export interface Extra {
  herramientas: unknown[];
  /** Devuelve undefined si la herramienta no es suya. */
  ejecutar: (nombre: string, a: Datos, propuestas: Propuesta[]) => Promise<unknown> | undefined;
}

/**
 * Bucle de herramientas con gpt-4o-mini: consulta la base y junta propuestas. Solo escribe si quien llama le pasa
 * herramientas que escriben en `extra` (el asistente). Lo usan el asistente (conversar) y el monitor de WhatsApp.
 * `base` solo cambia en las pruebas.
 */
export async function bucleHerramientas(db: Db, o: { apiKey: string; base?: string; mensajes: MensajeIA[]; funcionUso: string; extra?: Extra; maxVueltas?: number; quitar?: string[]; primera?: string }) {
  const { mensajes } = o;
  const maxVueltas = o.maxVueltas ?? MAX_VUELTAS;
  const herramientas = [...HERRAMIENTAS, ...(o.extra?.herramientas ?? [])].filter((h) => !o.quitar?.includes((h as { function: { name: string } }).function.name));
  const propuestas: Propuesta[] = [];
  /** Lo que respondieron las herramientas (las cifras de la respuesta tienen que salir de aquí o de lo que dijo Felipe). */
  const salidas: string[] = [];
  let entradaTokens = 0, salidaTokens = 0;
  try {
    for (let vuelta = 0; vuelta <= maxVueltas; vuelta++) {
      const cuerpo = JSON.stringify({ model: MODELO, max_tokens: MAX_TOKENS, temperature: 0.2, store: false, messages: mensajes, tools: herramientas, tool_choice: vuelta === maxVueltas ? "none" : vuelta === 0 && o.primera ? { type: "function", function: { name: o.primera } } : "auto" });
      // Un tropiezo de OpenAI (se demoró, se cayó la conexión, 429 o 5xx) se reintenta una vez antes de rendirse.
      type RespuestaIA = { choices: { message: MensajeIA }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      let d = null as RespuestaIA | null;
      for (let intento = 1; intento <= 2 && !d; intento++) {
        let r: Response;
        try {
          r = await fetch(`${o.base ?? "https://api.openai.com"}/v1/chat/completions`, {
            method: "POST", headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000), body: cuerpo,
          });
        } catch (e) {
          console.error("OpenAI no respondió", e);
          if (intento === 2) throw new ErrorApi("El asistente no respondió a tiempo. Intente de nuevo.", 502);
          continue;
        }
        if (!r.ok) {
          console.error("OpenAI respondió", r.status, (await r.text()).slice(0, 400));
          if (r.status === 401) throw new ErrorApi("La clave de OpenAI no es válida.", 502);
          if (intento === 2 || !(r.status === 429 || r.status >= 500)) throw new ErrorApi("El asistente no respondió. Intente de nuevo.", 502);
          continue;
        }
        d = (await r.json().catch(() => null)) as RespuestaIA | null;
        if (!d && intento === 2) throw new ErrorApi("El asistente no respondió. Intente de nuevo.", 502);
      }
      if (!d) throw new ErrorApi("El asistente no respondió. Intente de nuevo.", 502);
      entradaTokens += d.usage?.prompt_tokens ?? 0;
      salidaTokens += d.usage?.completion_tokens ?? 0;
      const m = d.choices[0]?.message;
      if (!m) throw new ErrorApi("El asistente no respondió. Intente de nuevo.", 502);
      if (!m.tool_calls?.length) return { respuesta: m.content ?? "", propuestas, salidas };
      mensajes.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
      for (const llamada of m.tool_calls) {
        let resultado: unknown;
        try {
          const a = JSON.parse(llamada.function.arguments || "{}") as Datos;
          resultado = (await o.extra?.ejecutar(llamada.function.name, a, propuestas)) ?? (await ejecutar(db, llamada.function.name, a, propuestas));
        } catch (e) {
          resultado = { error: e instanceof Error ? e.message : String(e) };
        }
        const contenido = JSON.stringify(resultado).slice(0, 10_000);
        salidas.push(contenido);
        mensajes.push({ role: "tool", tool_call_id: llamada.id, content: contenido });
      }
    }
    return { respuesta: "No alcancé a terminar la consulta. Intente preguntarlo de forma más concreta.", propuestas, salidas };
  } finally {
    await registrarUsoIa(db, o.funcionUso, MODELO, entradaTokens, salidaTokens).run();
  }
}

/**
 * ¿Felipe pide un precio y ya dijo el trámite y la ciudad? Entonces lo primero es cotizar (el modelo a veces pregunta
 * de más: la placa, el precio). Mira su último mensaje y, si el asistente le acababa de preguntar algo, también el
 * anterior ("Cotiza el traspaso del Logan" + "En Ibagué"). La ciudad cuenta solo dicha como "en Ibagué" o
 * "matriculado en Ibagué" (Honda también es una marca).
 */
async function pideCotizacionCompleta(db: Db, historial: MensajeIA[]): Promise<{ tramites: string[]; ciudad: string } | null> {
  const ultimo = historial.length - 1;
  const preguntoAntes = ultimo >= 2 && historial[ultimo - 1].role === "assistant" && /\?|necesito|dime|ind[ií]came/i.test(String(historial[ultimo - 1].content));
  const texto = [preguntoAntes ? historial[ultimo - 2].content : "", historial[ultimo].content].join(" ");
  const limpio = normalizar(String(texto));
  if (!/cotiz|cuanto|vale|cuesta|cobr|precio|derechos|tarifa|en que queda/.test(limpio) && !preguntoAntes) return null;
  const [tipos, orgs] = await Promise.all([
    db.select({ nombre: E.tiposTramite.nombre, categoria: E.tiposTramite.categoria }).from(E.tiposTramite).where(eq(E.tiposTramite.activo, true)),
    db.select({ ciudad: E.organismos.ciudad }).from(E.organismos).where(eq(E.organismos.activo, true)),
  ]);
  const tramites = tiposDelTexto(tipos, limpio, null).map((t) => t.nombre);
  // Con una abreviatura que puede ser de dos trámites ("tras"), mejor que el modelo lo entienda por el contexto.
  if (!tramites.length || abreviaturasAmbiguas(tipos, limpio).length) return null;
  let ciudad = orgs.find((o) => o.ciudad && new RegExp(`(^|[^a-z])(en|matriculad[oa] en) ${normalizar(o.ciudad).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(limpio))?.ciudad;
  // Le preguntó "¿Es en Ibagué?" y Felipe dijo que sí.
  const confirmoIbague = preguntoAntes && /ibague\s*\?/.test(normalizar(String(historial[ultimo - 1].content)))
    && /^(si|sii|claro|correcto|exacto|asi es|de una|en ibague|si señor|si,|si\.|afirmativo|ok|okay|dale)\b/.test(normalizar(String(historial[ultimo].content)).trim());
  if (!ciudad && confirmoIbague) ciudad = orgs.find((o) => o.ciudad && normalizar(o.ciudad) === "ibague")?.ciudad;
  return ciudad ? { tramites, ciudad } : null;
}

/**
 * Varios trámites del mismo vehículo van en UNA cotización (los honorarios se cobran una vez). El modelo a veces la
 * partía en dos y cobraba honorarios dos veces:
 * - si deja por fuera de la primera cotización alguno de los trámites que Felipe nombró, se le agrega ahí;
 * - si después pide aparte trámites que ya van en una cotización del MISMO vehículo, no se cotizan otra vez.
 */
function conTodosLosTramites(extra: Extra, tramites: string[]): Extra {
  const hechas: { vehiculo: string; tipos: string[] }[] = [];
  const vehiculoDe = (a: Datos) => normalizar([a.placa, a.marca, a.linea, a.modelo].map((x) => String(x ?? "")).join(" ")).replace(/[^a-z0-9]/g, "");
  return {
    ...extra,
    ejecutar: (nombre, a, propuestas) => {
      if (nombre === "requisitos_y_costos" && !Array.isArray(a.tipo_ids)) {
        let pedidos = [a.tipo, ...(Array.isArray(a.otros_tipos) ? a.otros_tipos : [])].map((x) => normalizar(String(x ?? "")));
        if (!hechas.length && tramites.length > 1) {
          const faltan = tramites.filter((t) => !pedidos.includes(normalizar(t)));
          if (faltan.length) { a.otros_tipos = [...(Array.isArray(a.otros_tipos) ? a.otros_tipos : []), ...faltan]; pedidos = [...pedidos, ...faltan.map((t) => normalizar(t))]; }
        }
        const vehiculo = vehiculoDe(a);
        if (hechas.some((h) => h.vehiculo === vehiculo && h.tipos.length > 1 && pedidos.every((x) => h.tipos.includes(x)))) {
          return Promise.resolve({ aviso: "Estos trámites ya van en la cotización anterior de este vehículo, junto con los demás (los honorarios una sola vez): no se cotizan aparte. Da solo esa cotización." });
        }
        hechas.push({ vehiculo, tipos: pedidos });
      }
      return extra.ejecutar(nombre, a, propuestas);
    },
  };
}

/** `base` solo cambia en las pruebas (OpenAI falso). */
export async function conversar(db: Db, apiKey: string | undefined, cuerpo: Datos, base?: string, env: EnvConsultas = {}) {
  if (!apiKey) throw new ErrorApi("Falta configurar la clave de OpenAI.", 503);
  const entrada = Array.isArray(cuerpo.mensajes) ? cuerpo.mensajes.slice(-MAX_MENSAJES) : [];
  const todos: MensajeIA[] = entrada
    .map((m) => m as Datos)
    .filter((m) => typeof m.texto === "string" && m.texto.trim())
    .map((m) => ({ role: m.rol === "ia" ? "assistant" : "user", content: String(m.texto).slice(0, 4000) }));
  if (!todos.length || todos[todos.length - 1].role !== "user") throw new ErrorApi("Escriba un mensaje.");
  const fotos = datosDeFotos(String(todos.at(-1)!.content));
  const historial = fotos ? todos.slice(-1) : todos;
  // Fotos con "anótame / regístrame / guárdame" sin nombrar un trámite ni una placa: es un trámite NUEVO. Se responde
  // aquí, claro y sin IA (el modelo a veces repetía la orden o la pegaba como nota del trámite del que se hablaba).
  if (fotos) {
    const pedido = String(todos.at(-1)!.content).split(FOTOS)[0];
    const nombraUno = /\bt-?\d{4}-?\d{1,6}\b|\b[a-z]{3}\s?\d{2}[a-z0-9]\b|\b\d{3}[a-z]{3}\b|\b\d{1,6}\b/i.test(pedido);
    if (/(guard|re[gj][ií]?s?tr|a[nñ]?[oó]t[aá]|ingres|crea|mete|sube)/i.test(pedido) && !nombraUno) {
      const quien = String(todos.at(-1)!.content).split(FOTOS)[1]?.match(/-[^:\n]+:\s*([^,\n]+),/)?.[1]?.trim();
      return json({
        respuesta: `Eso es un trámite nuevo${quien ? ` de ${quien}` : ""}: no lo anoté en ningún otro. Para registrarlo, adjunte las fotos y escriba «regístrame» con lo que es (por ejemplo, «regístrame esta renovación de licencia»): se abre el registro con los documentos leídos.`,
        propuestas: [], acciones: [],
      });
    }
  }
  const acciones: Accion[] = [];
  // Si pide un precio y ya dijo trámite y ciudad: lo primero es cotizar, con los nombres exactos de la lista (el modelo
  // confunde nombres parecidos: "traslado de cuenta" no es "Traslado + radicación de cuenta").
  // "Anótame una refrendación B1 de X CC 123...": una orden clara de anotar una licencia nueva, con la cédula. Va
  // directo a proponerla (el modelo se ponía a buscar sus licencias, o a cotizar por el "le cobro").
  const ultimoPedido = normalizar(String(historial.at(-1)!.content).split(FOTOS)[0]);
  const anotaLicencia = !fotos && /\b(anot|agreg|registr|pasa(r|me)? a mayor|pasarle)\w*/.test(ultimoPedido)
    && /\b(refrend|renov|reno[bv]|migr|recateg|duplicad|primera vez|primer vez|expedic|mayor de edad|tramite de licencia)\w*/.test(ultimoPedido) && !/\bvenc(e|imiento)\b/.test(ultimoPedido)
    && /\d{6,}/.test(ultimoPedido.replace(/[.\s]/g, ""));
  const cotizacion = anotaLicencia ? null : await pideCotizacionCompleta(db, historial);
  const pista: MensajeIA[] = cotizacion ? [{ role: "system", content: `Para esta cotización usa exactamente: tipo='${cotizacion.tramites[0]}'${cotizacion.tramites.length > 1 ? `, otros_tipos=[${cotizacion.tramites.slice(1).map((t) => `'${t}'`).join(", ")}]` : ""}, organismo='${cotizacion.ciudad}'.` }] : [];
  const pedidoFelipe = todos.filter((m) => m.role === "user").slice(-2).map((m) => String(m.content).split(FOTOS)[0]).join(" \n ");
  const extra = conTodosLosTramites(accionesAsistente(db, acciones, env, pedidoFelipe), cotizacion?.tramites ?? []);
  // Justo después de una cotización, lo que Felipe corrige es la cotización ("cobra 10.000 de traslado"): no se ofrece
  // cambiar lo que se cobra en un trámite registrado, salvo que lo nombre. (Antes cambió un trámite que no era.)
  const anterior = [...historial].reverse().find((m) => m.role === "assistant");
  const ultimoUsuario = normalizar(String(historial.at(-1)!.content));
  const corrigeCotizacion = !!anterior && /cotizaci[oó]n|total( parcial)?:/i.test(String(anterior.content)) && !/\btramite\b|\bt-?\d{4}|registrad/.test(ultimoUsuario);
  const quitar = corrigeCotizacion ? [...PROPUESTAS_REEMPLAZADAS, "proponer_cobro"] : PROPUESTAS_REEMPLAZADAS;
  // La ciudad no se supone: solo se cotiza en una que Felipe dijo (o "sí" a "¿Es en Ibagué?", o la del vehículo
  // registrado con esa placa). Si el modelo la pone por su cuenta, se le rechaza y pregunta.
  {
    const ejecutarBase = extra.ejecutar;
    const orgs = await db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos);
    const dicho = normalizar(historial.filter((m) => m.role === "user").map((m) => String(m.content ?? "")).join(" "));
    const siAIbague = historial.some((m, i) => m.role === "assistant" && /ibagu[eé]\s*\?/i.test(String(m.content ?? "")) && historial[i + 1]?.role === "user"
      && /^(si|sii|claro|correcto|exacto|asi es|de una|en ibague|si señor|afirmativo|ok|okay|dale)\b/.test(normalizar(String(historial[i + 1].content ?? "")).trim()));
    const delUsuario = historial.filter((m) => m.role === "user").map((m) => String(m.content ?? ""));
    extra.ejecutar = async (nombre, args, propuestas) => {
      if (nombre === "requisitos_y_costos" && args.honorarios && !/honorario/.test(dicho)) delete args.honorarios;
      // "Anótame una renovación... cobra 300 mil" es anotar, no cotizar (el modelo veía "cobra" y cotizaba).
      // Solo con la orden en el ÚLTIMO mensaje: "agrégale el duplicado de placa" a una cotización sigue siendo cotizar.
      if (nombre === "requisitos_y_costos" && (anotaLicencia || /\b(an[oó]t|reg[ií]str)\w*/.test(ultimoPedido)) && !/(cotiz|cuanto|precio|valdr)/.test(ultimoPedido)) {
        return { error: "Felipe pidió ANOTAR un trámite nuevo, no cotizarlo: usa proponer_tramite con los datos que dio (lo que cobra va en valor)." };
      }
      if (nombre === "proponer_tramite") {
        // Un trámite NUEVO solo si lo pide: corregir uno que ya existe o hablar de la licencia que ya tiene no lo es.
        const pedido = normalizar(pedidoFelipe);
        const pideNuevo = /\b(an[oó]t|agr[eé]g|reg[ií]str|crea|ingres|mete|abr[ae]|hazme|pasa(r|me)? a mayor)\w*/.test(pedido);
        if (!pideNuevo && /\b(no es|corrig\w*|correg\w*|cambi\w*|en vez de|en lugar de)\b/.test(pedido)) {
          return { error: "Felipe está CORRIGIENDO un trámite que ya existe, no pidiendo uno nuevo: búscalo (buscar_tramites por el nombre o la cédula) y corrígelo con corregir_tramite (las categorías, el titular...). No propongas un trámite." };
        }
        if (/\b(vence|vencimiento|le vence|ya renov\w*|tiene (la |una )?licencia)\b/.test(pedido) && !/\b(refrend|renovacion de licencia|migr|primera vez|primer vez|duplicad|recateg)\w*/.test(pedido.replace(/\bya renov\w*/g, ""))) {
          return { error: "NO es un trámite nuevo: Felipe habla de la licencia que la persona YA TIENE. Llama AHORA corregir_licencia con el cliente (nombre o cédula), las categorías y la fecha de vencimiento (y el seguimiento si dijo que ya renovó) que él dijo; eso la registra o la corrige. No vuelvas a llamar proponer_tramite ni le preguntes nada." };
        }
        // Lo que dijo Felipe de ESTA persona (desde el mensaje con su cédula, o los dos últimos): lo que el modelo no
        // pasó (el nacimiento dicho en el primer mensaje, el teléfono, el cobro, el abono) se toma de ahí, exacto.
        const cc = String((args.propietario as Datos | undefined)?.cedula ?? "").replace(/\D/g, "");
        const desde = cc ? delUsuario.findLastIndex((t) => t.replace(/[.\s]/g, "").includes(cc)) : -1;
        const suyo = datosDelTexto((desde >= 0 ? delUsuario.slice(desde) : delUsuario.slice(-2)).join(" \n ").split(FOTOS)[0], orgs);
        const p = (args.propietario && typeof args.propietario === "object" ? args.propietario : null) as Datos | null;
        if (p && !p.telefono && suyo.telefono) p.telefono = suyo.telefono;
        if (args.categorias && !args.fecha_nacimiento && suyo.nacimiento) args.fecha_nacimiento = suyo.nacimiento;
        if (!args.valor && suyo.valor) args.valor = Number(suyo.valor);
        if (!args.abono && suyo.abono) { args.abono = Number(suyo.abono); if (!args.metodo_abono && suyo.metodoAbono) args.metodo_abono = suyo.metodoAbono; }
        if (!args.ciudad && suyo.organismo) args.ciudad = suyo.organismo.dicho;
        // Con o sin clases: lo que dijo (y si el modelo lo puso sin que lo dijera, se le pide que lo pregunte).
        const clasesDichas = datosDelTexto(delUsuario.join(" \n ")).clases;
        if (clasesDichas) args.con_clases = clasesDichas === "con";
        else if (typeof args.con_clases === "boolean") delete args.con_clases;
        // La fecha de nacimiento es una que dijo (o la que ya tiene en la base): no una inventada.
        if (args.fecha_nacimiento && !fechasDeTexto(delUsuario.join(" \n ")).includes(String(args.fecha_nacimiento))) {
          const enBase = cc ? (await db.select({ f: E.clientes.fechaNacimiento }).from(E.clientes).where(eq(E.clientes.numeroDocumento, cc)).get())?.f : null;
          if (enBase !== args.fecha_nacimiento) return { error: `Felipe no dijo la fecha de nacimiento ${args.fecha_nacimiento}: no la inventes. Pregúntasela.` };
        }
        // Las categorías son las que dijo (o las de las fotos): "moto" no es A1 ni A2.
        const dichas = new Set(datosDelTexto(delUsuario.join(" \n ")).categorias);
        const inventadas = categoriasDeTexto(String(args.categorias ?? "")).filter((c) => !dichas.has(c));
        if (inventadas.length) return { error: `Felipe no dijo la categoría ${inventadas.join(", ")}: no la supongas ("moto" no es A1 ni A2; "carro" no es B1 ni C1). Pregúntale cuál es, junto con lo demás que falte.` };
        const o = organismoDeTexto(orgs, String(args.ciudad ?? ""));
        const ciudad = normalizar(o?.ciudad ?? "");
        if (o && ciudad && !dicho.includes(ciudad) && !(ciudad === "ibague" && siAIbague)) return { error: `Felipe no ha dicho la ciudad (no dijo ${o.ciudad}): no la supongas. Pregúntale "¿Es en Ibagué?".` };
        const digitos = dicho.replace(/[.\s]/g, "");
        for (const p of [args.propietario, args.comprador]) {
          const cc = String((p as Datos | undefined)?.cedula ?? "").replace(/\D/g, "");
          if (cc && !digitos.includes(cc)) return { error: `La cédula ${cc} no la dijo Felipe: no la inventes. Anótalo sin cédula o pregúntasela.` };
        }
      }
      if (nombre === "requisitos_y_costos" && !args.organismo_id) {
        const o = organismoDeTexto(orgs, String(args.organismo ?? ""));
        const ciudad = normalizar(o?.ciudad ?? "");
        const delVehiculo = o && args.placa ? !!(await db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(and(eq(E.vehiculos.placa, String(args.placa).toUpperCase().replace(/[^A-Z0-9]/g, "")), eq(E.vehiculos.organismoMatriculaId, o.id))).get()) : false;
        if (o && ciudad && !dicho.includes(ciudad) && !(ciudad === "ibague" && siAIbague) && !delVehiculo) {
          return { error: `Felipe no ha dicho la ciudad (no dijo ${o.ciudad}): no la supongas. Pregúntale "¿Es en Ibagué?" y cotiza cuando responda.` };
        }
      }
      return ejecutarBase(nombre, args, propuestas);
    };
  }
  // Con fotos de una persona o un vehículo, no se anota en un trámite que no es de ellos (es un trámite nuevo: se
  // registra con las fotos).
  if (fotos && (fotos.documentos.length || fotos.placas.length)) {
    const ejecutar = extra.ejecutar;
    extra.ejecutar = async (nombre, args, propuestas) => {
      if (nombre !== "anotar" && nombre !== "proponer_nota") return ejecutar(nombre, args, propuestas);
      const t = await tramitePor(db, args.tramite).catch(() => null);
      if (!t) return ejecutar(nombre, args, propuestas);
      const partes = await partesDelCombo(db, t);
      const ids = partes.map((x) => x.id);
      const personas = await db.select({ doc: E.clientes.numeroDocumento }).from(E.clientes).where(or(inArray(E.clientes.id, partes.map((x) => x.titularId)), inArray(E.clientes.id, db.select({ id: E.tramitePersonas.clienteId }).from(E.tramitePersonas).where(inArray(E.tramitePersonas.tramiteId, ids)))));
      const vehiculos = await db.select({ placa: E.vehiculos.placa }).from(E.vehiculos).where(inArray(E.vehiculos.id, partes.map((x) => x.vehiculoId).filter((v): v is string => !!v)));
      const docs = new Set(personas.map((x) => x.doc.replace(/\D/g, "")).filter(Boolean)), placas = new Set(vehiculos.map((x) => x.placa));
      if (fotos.documentos.some((d) => docs.has(d)) || fotos.placas.some((x) => placas.has(x))) return ejecutar(nombre, args, propuestas);
      return { error: `Las fotos son de otra persona o vehículo (${[...fotos.documentos, ...fotos.placas].join(", ")}), no de ${codigoTramite(t)}: NO lo anotes ahí. Si Felipe pide anotar o registrar un trámite (una renovación, un traspaso...), es un trámite NUEVO: dile que lo registre adjuntando las fotos y escribiendo "regístrame" (o "anótame") con lo que es.` };
    };
  }
  // Y si aun así lo intenta, no se hace: es una cotización, se recotiza.
  if (corrigeCotizacion) {
    const ejecutar = extra.ejecutar;
    extra.ejecutar = (nombre, args, propuestas) => nombre === "proponer_cobro"
      ? Promise.resolve({ error: "Felipe está corrigiendo la COTIZACIÓN, no un trámite registrado: no se cambia ningún trámite. Vuelve a llamar requisitos_y_costos con los mismos datos y con avaluo / tarifas_dichas, y responde con esa cotización." })
      : ejecutar(nombre, args, propuestas);
  }
  // Corrige la cotización anterior: se le dice al modelo (si no, "bájale los honorarios a 250" lo pone a buscar un trámite).
  const pistaCotizacion: MensajeIA[] = corrigeCotizacion ? [{ role: "system", content: "Felipe está corrigiendo o comentando la COTIZACIÓN anterior (no un trámite registrado). Si cambia algo (avalúo, precio, honorarios, el valor de un trámite, agregar o quitar trámites, la ciudad), vuelve a llamar requisitos_y_costos con los mismos datos del vehículo y con lo que cambió (avaluo, precio_venta, honorarios, tarifas_dichas) y copia su texto_listo. No busques trámites ni pidas la placa." }] : [];
  // Lo que Felipe tiene en pantalla (el mapa, y en qué ciudad), para entender "este", "aquí", "el punto rojo".
  const ctx = (cuerpo.contexto && typeof cuerpo.contexto === "object" ? cuerpo.contexto : {}) as Datos;
  const enPantalla: MensajeIA[] = ctx.pantalla === "mapa" ? [{ role: "system", content: `Felipe está viendo el mapa${ctx.ciudad ? `, dentro de ${String(ctx.ciudad).slice(0, 60)}` : " de Colombia"}. Si dice "aquí" o "esta ciudad", es esa. Lo que anote con proponer_tramite aparece en el mapa al confirmarlo.` }] : [];
  const mensajes: MensajeIA[] = [{ role: "system", content: await instrucciones(db) }, ...enPantalla, ...historial, ...pista, ...pistaCotizacion];
  let r = await bucleHerramientas(db, { apiKey, base, mensajes: [...mensajes], funcionUso: "asistente", extra, quitar, maxVueltas: MAX_VUELTAS_ASISTENTE, primera: anotaLicencia ? "proponer_tramite" : cotizacion ? "requisitos_y_costos" : undefined });
  // Preguntó "¿Es en Ibagué?" cuando Felipe ya lo había dicho: se le recuerda y responde de nuevo.
  if (/^\s*¿?\s*es en ibagu[eé]\s*\?\s*$/i.test(r.respuesta) && /\bibague\b/.test(normalizar(String(historial.at(-1)!.content)))) {
    r = await bucleHerramientas(db, { apiKey, base, mensajes: [...mensajes, { role: "system", content: "Felipe YA dijo que es en Ibagué: no lo preguntes. Responde lo que pidió (si es un precio, cotízalo en Ibagué; si falta el trámite, pregunta cuál)." }], funcionUso: "asistente", extra, quitar, maxVueltas: MAX_VUELTAS_ASISTENTE });
  }
  // Verificador de cifras: cada valor en pesos de la respuesta tiene que venir de una herramienta, de lo que dijo
  // Felipe o de una respuesta anterior. Si no, se responde de nuevo (si no se hizo ningún cambio: si ya se cambió algo,
  // repetir lo duplicaría); si aun así no cuadra, se le avisa con las cifras que no se pudieron comprobar.
  const conocidas = () => cifrasConocidas([...historial.map((m) => String(m.content ?? "")), ...r.salidas]);
  let sueltas = cifrasSueltas(r.respuesta, conocidas());
  if (sueltas.length && !acciones.length) {
    const nota = `Estas cifras de tu respuesta no salieron de ninguna herramienta ni las dijo Felipe: ${sueltas.map(pesos).join(", ")}. No hagas cuentas de cabeza: cotiza con requisitos_y_costos (copia su texto_listo) y cualquier otra cuenta hazla con calcular. Responde de nuevo.`;
    r = await bucleHerramientas(db, { apiKey, base, mensajes: [...mensajes, { role: "system", content: nota }], funcionUso: "asistente", extra, quitar, maxVueltas: MAX_VUELTAS_ASISTENTE });
    sueltas = cifrasSueltas(r.respuesta, conocidas());
  }
  // La cotización tal cual: si en este mensaje se cotizó y la respuesta no trae todos sus valores (o cambió alguno:
  // una vez puso el 1 % de la retención en vez de la retención), se muestra la cotización exacta de la herramienta.
  const porVehiculo = new Map<string, string>();
  const editables = new Map<string, ReturnType<typeof cotizacionEditable>>();
  for (const x of r.salidas) {
    try {
      const c = JSON.parse(x) as { texto_listo?: string; vehiculo?: { placa?: string | null; marca?: string; linea?: string; modelo?: number | null } | null };
      if (!c.texto_listo) continue;
      const k = JSON.stringify([c.vehiculo?.placa ?? "", c.vehiculo?.marca ?? "", c.vehiculo?.linea ?? "", c.vehiculo?.modelo ?? ""]);
      porVehiculo.delete(k);
      porVehiculo.set(k, c.texto_listo);
      editables.delete(k);
      editables.set(k, cotizacionEditable(c as unknown as Extract<Cotizado, { costos: object }>));
    } catch { /* no es JSON */ }
  }
  const lista = porVehiculo.size ? [...porVehiculo.values()].map((t, i, l) => (l.length > 1 ? t.replace(/^\*\*/, `**${i + 1}. `) : t)).join("\n\n") : "";
  if (lista) {
    const enRespuesta = new Set(cifrasDeRespuesta(r.respuesta));
    if (cifrasDeRespuesta(lista).some((v) => !enRespuesta.has(v))) { r = { ...r, respuesta: lista }; sueltas = []; }
  }
  if (sueltas.length) r = { ...r, respuesta: `${r.respuesta}\n\nOjo: no pude comprobar ${sueltas.length === 1 ? "esta cifra" : "estas cifras"}: ${sueltas.map(pesos).join(", ")}. Antes de usarla${sueltas.length === 1 ? "" : "s"}, pídame que la${sueltas.length === 1 ? "" : "s"} calcule de nuevo.` };
  const { salidas: _s, ...fuera } = r;
  return json({ ...fuera, acciones, ...(editables.size ? { cotizaciones: [...editables.values()] } : {}), ...(sueltas.length ? { cifrasSinComprobar: sueltas } : {}) });
}

/* ───────────────────────── voz ───────────────────────── */

const MAX_AUDIO = 4 * 1024 * 1024; // ~4 minutos de voz en webm/opus
/** Palabras del oficio, para que Whisper las escriba bien. */
const VOCABULARIO = "Trámites de tránsito en Ibagué. Placa, traspaso, RUNT, SOAT, técnico-mecánica, SIMIT, levantamiento de prenda, licencia de conducción, tarjeta de propiedad, cédula, precondiciones, radicado, finalizado, recordatorio.";

/** Pasa a texto una nota de voz (Whisper large v3 turbo en Workers AI: ~US$0,0005 el minuto; el plan gratis cubre ~200 min al día). */
export async function transcribir(ai: Ai | undefined, req: Request) {
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim();
  // Si se rechaza sin leer el cuerpo, la conexión queda rota para la siguiente petición: se descarta.
  if (!tipo.startsWith("audio/")) {
    if (Number(req.headers.get("Content-Length")) <= 1_000_000) await req.arrayBuffer().catch(() => {});
    else await req.body?.cancel().catch(() => {});
    throw new ErrorApi("Se esperaba un audio.", 415);
  }
  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length < 1000) throw new ErrorApi("No se oyó nada: mantenga el micrófono un poco más.");
  if (audio.length > MAX_AUDIO) throw new ErrorApi("La nota de voz es muy larga (máximo unos 4 minutos).", 413);
  if (!ai) throw new ErrorApi("La voz no está configurada en este servidor.", 503);
  let binario = "";
  for (let i = 0; i < audio.length; i += 0x8000) binario += String.fromCharCode(...audio.subarray(i, i + 0x8000));
  const r = (await ai.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(binario), language: "es", task: "transcribe", vad_filter: true, initial_prompt: VOCABULARIO })) as { text?: string; transcription_info?: { text?: string } };
  const texto = (r.text ?? r.transcription_info?.text ?? "").trim();
  if (!texto) throw new ErrorApi("No entendí el audio. Intente de nuevo, más cerca del micrófono.");
  return json({ texto });
}


/* ───────────────────────── cifras ───────────────────────── */

/**
 * Calculadora exacta para el asistente (los Workers no permiten eval): números ("10.000.000", "10000000", "1,5"),
 * + - * / ( ) y % ("1%" es 0,01). Redondea a 2 decimales.
 */
export function calcularExpresion(texto: string): number {
  const s = texto.replace(/\$/g, "").replace(/\s+/g, "").replace(/(\d)\.(?=\d{3}(\D|$))/g, "$1").replace(/,/g, ".");
  if (!s || !/^[\d.+\-*/()%]+$/.test(s)) throw new Error("Escriba la cuenta solo con números y + - * / ( ) %.");
  let i = 0;
  const numero = () => {
    const m = s.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new Error("La cuenta no está bien escrita.");
    i += m[0].length;
    let v = Number(m[0]);
    if (s[i] === "%") { i++; v /= 100; }
    return v;
  };
  const factor = (): number => {
    if (s[i] === "-") { i++; return -factor(); }
    if (s[i] === "(") { i++; const v = suma(); if (s[i++] !== ")") throw new Error("Falta cerrar un paréntesis."); return v; }
    return numero();
  };
  const producto = () => {
    let v = factor();
    while (s[i] === "*" || s[i] === "/") { const op = s[i++]; const w = factor(); if (op === "/" && w === 0) throw new Error("No se puede dividir por cero."); v = op === "*" ? v * w : v / w; }
    return v;
  };
  const suma = (): number => {
    let v = producto();
    while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const w = producto(); v = op === "+" ? v + w : v - w; }
    return v;
  };
  const v = suma();
  if (i !== s.length) throw new Error("La cuenta no está bien escrita.");
  return Math.round(v * 100) / 100;
}

/** Valores en pesos de una respuesta (de 1.000 para arriba): "$100.000", "$ 100.000", "10.000.000". */
function cifrasDeRespuesta(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(/\$\s?\d{1,3}(?:[.,]\d{3})+(?:,\d{1,2})?|\$\s?\d{4,}|\b\d{1,3}(?:\.\d{3})+\b/g)) {
    const v = Number(m[0].replace(/,\d{1,2}$/, "").replace(/\D/g, ""));
    if (v >= 1000) out.push(v);
  }
  return [...new Set(out)];
}

/** Todos los números que aparecen en unos textos (lo que dijo Felipe, lo que respondieron las herramientas), con "700 mil" y "4,5 millones". */
function cifrasConocidas(textos: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of textos) {
    for (const m of t.matchAll(/\d[\d.,]*/g)) {
      const crudo = m[0].replace(/[.,]$/, "");
      out.add(Number(crudo.replace(/[.,]/g, "")));
      if (/^\d+[.,]\d{1,2}$/.test(crudo)) out.add(Math.round(Number(crudo.replace(",", "."))));
    }
    // Lo dicho en letras ("trescientos mil") y la plata dicha corta ("le cobro 350" = $100.000).
    for (const m of letrasACifras(normalizar(t)).matchAll(/\d+/g)) { const n = Number(m[0]); out.add(n); if (n > 0 && n < 5000) out.add(n * 1000); }
    for (const m of normalizar(t).matchAll(/(\d+(?:[.,]\d+)?)\s*(mil|millon(?:es)?|palos?|lucas?)\b/g)) {
      const n = Number(m[1].replace(",", "."));
      out.add(Math.round(n * (/^mil|^luca/.test(m[2]) ? 1000 : 1_000_000)));
    }
  }
  return out;
}

/**
 * ¿Se puede comprobar una cifra con las conocidas? Igual a una, o una cuenta simple de ellas: suma o resta de dos, la
 * mitad, un tercio o un cuarto, o un porcentaje entero (hasta ±1 peso por redondeo). Así una cuenta bien hecha pasa
 * ("la mitad de 100.000 = 100.000") y un número inventado no.
 */
export function comprobable(v: number, conocidas: Set<number>): boolean {
  if (conocidas.has(v)) return true;
  const base = [...conocidas].filter((x) => x >= 100 && x <= 1e11).slice(0, 200);
  const cerca = (x: number) => Math.abs(x - v) <= 1;
  for (const a of base) {
    if (cerca(a / 2) || cerca(a / 3) || cerca(a / 4)) return true;
    for (let k = 1; k <= 100; k++) if (cerca((a * k) / 100)) return true;
  }
  for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) if (cerca(base[i] + base[j]) || cerca(Math.abs(base[i] - base[j]))) return true;
  return false;
}

/** Las cifras de la respuesta que no se pueden comprobar (posibles inventos). */
export function cifrasSueltas(respuesta: string, conocidas: Set<number>): number[] {
  return cifrasDeRespuesta(respuesta).filter((v) => !comprobable(v, conocidas));
}
