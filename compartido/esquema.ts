/*
 * Esquema de la base (Cloudflare D1 = SQLite). Lo usan la API y la app (tipos). Fuente de verdad para `npm run esquema`,
 * que genera el SQL en migraciones/. Reglas:
 * - Sin organizaciones ni usuarios: la app es de una sola persona.
 * - Plata en pesos enteros (INTEGER). Fechas como texto: "AAAA-MM-DD" para días y ISO 8601 UTC para momentos.
 * - Listas cerradas como TEXT + CHECK (los valores viven en compartido/dominio.ts).
 * - JSON como TEXT. Nada de archivos dentro de la base: van a R2 y aquí solo queda la clave.
 * - Las tablas que se copian al navegador tienen `version`: la llenan los triggers de
 *   migraciones/0001_sincronizacion.sql en cada cambio, y la descarga incremental pide "lo que cambió desde N".
 */
import { sql, type SQL } from "drizzle-orm";
import type { Composicion } from "./composicion";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import * as D from "./dominio";

const ahora = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** Columnas de toda tabla que se sincroniza. */
const comunes = () => ({
  creado: text("creado").notNull().default(ahora),
  actualizado: text("actualizado").notNull().default(ahora),
  version: integer("version").notNull().default(0),
});
const id = () => text("id").primaryKey();

function enLista(nombre: string, col: AnySQLiteColumn, lista: readonly string[], opcional = false): ReturnType<typeof check> {
  const valores = sql.join(lista.map((v) => sql.raw(`'${v}'`)), sql`, `);
  const cond: SQL = opcional ? sql`${col} IS NULL OR ${col} IN (${valores})` : sql`${col} IN (${valores})`;
  return check(nombre, cond);
}
const booleano = (nombre: string, col: AnySQLiteColumn) => check(nombre, sql`${col} IN (0, 1)`);

// ─── Personas ────────────────────────────────────────────────────────────────

export const clientes = sqliteTable("clientes", {
  id: id(),
  tipoDocumento: text("tipo_documento").notNull().default("CC"),
  /** Vacío = sin documento todavía (por ejemplo, vendedores y compradores importados de Airtable). Único cuando existe. */
  numeroDocumento: text("numero_documento").notNull(),
  nombre: text("nombre").notNull(),
  /** Opcional: el monitor de WhatsApp puede completarlo. Se guarda solo con dígitos. */
  telefono: text("telefono"),
  /** Los otros números de la persona (el principal es `telefono`), solo dígitos. */
  otrosTelefonos: text("otros_telefonos", { mode: "json" }).$type<string[]>(),
  ciudad: text("ciudad"),
  /** Dirección (la pide el formulario único: datos del propietario y del comprador). */
  direccion: text("direccion"),
  /** La trae la foto de la cédula. Solo se exige en trámites de licencia (calcula el vencimiento, art. 197). */
  fechaNacimiento: text("fecha_nacimiento"),
  /** Si viene en la foto. Solo la usa la consulta RNMC. */
  fechaExpedicionDocumento: text("fecha_expedicion_documento"),
  notas: text("notas"),
  busqueda: text("busqueda").notNull().default(""),
  ...comunes(),
}, (t) => [
  uniqueIndex("clientes_documento_unq").on(t.numeroDocumento).where(sql`numero_documento <> ''`),
  index("clientes_telefono_idx").on(t.telefono),
  index("clientes_version_idx").on(t.version),
  enLista("clientes_tipo_documento_chk", t.tipoDocumento, D.TIPOS_DOCUMENTO),
]);

// ─── Catálogo ────────────────────────────────────────────────────────────────

export const organismos = sqliteTable("organismos", {
  id: id(),
  nombre: text("nombre").notNull(),
  ciudad: text("ciudad"),
  departamento: text("departamento"),
  notas: text("notas"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ...comunes(),
}, (t) => [
  index("organismos_version_idx").on(t.version),
  booleano("organismos_activo_chk", t.activo),
]);

export const tiposTramite = sqliteTable("tipos_tramite", {
  id: id(),
  nombre: text("nombre").notNull(),
  categoria: text("categoria").notNull(),
  descripcion: text("descripcion"),
  requiereVehiculo: integer("requiere_vehiculo", { mode: "boolean" }).notNull().default(true),
  /** El impuesto de registro (sobre el avalúo) aplica en matrículas y traspasos. */
  aplicaImpuestoRegistro: integer("aplica_impuesto_registro", { mode: "boolean" }).notNull().default(false),
  /** Días hábiles típicos: con ellos se propone la fecha de entrega al crear el trámite. */
  slaDias: integer("sla_dias"),
  /** [{ documento, obligatorio }] */
  requisitos: text("requisitos", { mode: "json" }).$type<{ documento: string; obligatorio: boolean }[]>().notNull().default(sql`'[]'`),
  /** { soat: true, runt: true, ... } */
  precondiciones: text("precondiciones", { mode: "json" }).$type<Partial<Record<D.Precondicion, boolean>>>().notNull().default(sql`'{}'`),
  orden: integer("orden").notNull().default(0),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ...comunes(),
}, (t) => [
  uniqueIndex("tipos_tramite_nombre_unq").on(t.nombre),
  index("tipos_tramite_version_idx").on(t.version),
  enLista("tipos_tramite_categoria_chk", t.categoria, D.CATEGORIAS_TRAMITE),
  booleano("tipos_tramite_vehiculo_chk", t.requiereVehiculo),
  booleano("tipos_tramite_registro_chk", t.aplicaImpuestoRegistro),
  booleano("tipos_tramite_activo_chk", t.activo),
]);

/** Costo por tipo de trámite y organismo (organismo vacío = aplica a todos). */
export const tarifas = sqliteTable("tarifas", {
  id: id(),
  tipoTramiteId: text("tipo_tramite_id").notNull().references(() => tiposTramite.id, { onDelete: "cascade" }),
  organismoId: text("organismo_id").references(() => organismos.id, { onDelete: "cascade" }),
  derechosTransito: integer("derechos_transito").notNull().default(0),
  componenteRunt: integer("componente_runt").notNull().default(0),
  estampillas: integer("estampillas").notNull().default(0),
  pazSalvo: integer("paz_salvo").notNull().default(0),
  /** 0 = usar el parámetro honorarios_defecto. */
  honorarios: integer("honorarios").notNull().default(0),
  vigenteDesde: text("vigente_desde"),
  ...comunes(),
}, (t) => [
  uniqueIndex("tarifas_tipo_organismo_unq").on(t.tipoTramiteId, t.organismoId),
  index("tarifas_version_idx").on(t.version),
]);

/** Parámetros del negocio (clave -> texto). */
export const parametros = sqliteTable("parametros", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
  descripcion: text("descripcion"),
  ...comunes(),
}, (t) => [index("parametros_version_idx").on(t.version)]);

/**
 * Avalúos oficiales (base gravable del Ministerio de Transporte), ~10.000 filas por año.
 * No se copia al navegador: se consulta por la API.
 */
export const avaluos = sqliteTable("avaluos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  anioFiscal: integer("anio_fiscal").notNull(),
  tipo: text("tipo").notNull(),
  clase: text("clase"),
  marca: text("marca").notNull(),
  linea: text("linea").notNull(),
  cilindraje: text("cilindraje"),
  /** Valores en miles de pesos por año modelo: { "2001": 5470, ... } ("2001" = "y anteriores"). */
  valoresMiles: text("valores_miles", { mode: "json" }).$type<Record<string, number>>().notNull(),
  busqueda: text("busqueda").notNull().default(""),
}, (t) => [index("avaluos_busqueda_idx").on(t.anioFiscal, t.marca, t.linea)]);

// ─── Vehículos ───────────────────────────────────────────────────────────────

export const vehiculos = sqliteTable("vehiculos", {
  id: id(),
  /** Lo único obligatorio. Mayúsculas, sin espacios ni guiones. */
  placa: text("placa").notNull(),
  titularId: text("titular_id").references(() => clientes.id, { onDelete: "set null" }),
  clase: text("clase"),
  marca: text("marca"),
  linea: text("linea"),
  modelo: integer("modelo"),
  cilindraje: integer("cilindraje"),
  servicio: text("servicio"),
  // Datos de la tarjeta de propiedad que se guardan sin pedirlos (sirven para formularios de traspaso).
  color: text("color"),
  numeroMotor: text("numero_motor"),
  numeroChasis: text("numero_chasis"),
  numeroSerie: text("numero_serie"),
  vin: text("vin"),
  fechaMatricula: text("fecha_matricula"),
  combustible: text("combustible"),
  carroceria: text("carroceria"),
  /** Pasajeros o kilos, como figura en la tarjeta. */
  capacidad: text("capacidad"),
  potencia: text("potencia"),
  /** Número de la licencia de tránsito (la tarjeta de propiedad). */
  licenciaTransito: text("licencia_transito"),
  organismoMatriculaId: text("organismo_matricula_id").references(() => organismos.id, { onDelete: "set null" }),
  // Vigencias: opcionales. Sin dato se muestran como "Sin dato" y las alertas las piden.
  soatVence: text("soat_vence"),
  rtmVence: text("rtm_vence"),
  impuestoAlDiaHasta: text("impuesto_al_dia_hasta"),
  /** [{ tipo, origen, descripcion }]: alimenta la precondición sin_gravamenes. */
  gravamenes: text("gravamenes", { mode: "json" }).$type<D.Gravamen[]>().notNull().default(sql`'[]'`),
  /** Avalúo oficial resuelto (pesos), para el impuesto de registro y el radar. */
  avaluoOficial: integer("avaluo_oficial"),
  avaluoDetalle: text("avaluo_detalle"),
  notas: text("notas"),
  busqueda: text("busqueda").notNull().default(""),
  ...comunes(),
}, (t) => [
  uniqueIndex("vehiculos_placa_unq").on(t.placa),
  index("vehiculos_titular_idx").on(t.titularId),
  index("vehiculos_version_idx").on(t.version),
  enLista("vehiculos_servicio_chk", t.servicio, D.SERVICIOS_VEHICULO, true),
]);

/** Personas adicionales del vehículo (copropietarios). El titular va en vehiculos.titular_id. */
export const vehiculoPersonas = sqliteTable("vehiculo_personas", {
  id: id(),
  vehiculoId: text("vehiculo_id").notNull().references(() => vehiculos.id, { onDelete: "cascade" }),
  clienteId: text("cliente_id").notNull().references(() => clientes.id, { onDelete: "cascade" }),
  rol: text("rol").notNull().default("copropietario"),
  ...comunes(),
}, (t) => [
  uniqueIndex("vehiculo_personas_unq").on(t.vehiculoId, t.clienteId),
  index("vehiculo_personas_version_idx").on(t.version),
  enLista("vehiculo_personas_rol_chk", t.rol, D.ROLES_PERSONA),
]);

// ─── Trámites ────────────────────────────────────────────────────────────────

export const tramites = sqliteTable("tramites", {
  id: id(),
  /** Consecutivo único (también para borradores). Se muestra como T-AÑO-#####. */
  numero: integer("numero").notNull(),
  /** La serie del número: "T" trámites (vehículos y los demás), "L" licencias; cada una con su consecutivo. */
  serie: text("serie").notNull().default("T"),
  tipoId: text("tipo_id").notNull().references(() => tiposTramite.id),
  titularId: text("titular_id").notNull().references(() => clientes.id),
  vehiculoId: text("vehiculo_id").references(() => vehiculos.id),
  organismoId: text("organismo_id").references(() => organismos.id),
  /** Trámites creados juntos para el mismo cliente (un encargo con varios trámites). */
  encargoId: text("encargo_id"),
  /** Combo (encargo): el número del primer trámite, que es el código de todos (codigoTramite). Vacío si va solo. */
  codigo: integer("codigo"),
  estado: text("estado").notNull().default("en_preparacion"),
  /** Borrador: visible en el tablero pero no avanza hasta confirmarlo. */
  borrador: integer("borrador", { mode: "boolean" }).notNull().default(false),
  /** Detalle corto, por ejemplo las categorías de licencia "B1,A2". */
  detalle: text("detalle"),
  fechaRadicado: text("fecha_radicado"),
  fechaEstimadaEntrega: text("fecha_estimada_entrega"),
  fechaEntrega: text("fecha_entrega"),
  /** Solo las precondiciones manuales; las del vehículo se calculan en vivo. */
  precondicionesEstado: text("precondiciones_estado", { mode: "json" }).$type<Partial<Record<D.Precondicion, D.PrecondicionEstado>>>().notNull().default(sql`'{}'`),
  costoDerechos: integer("costo_derechos").notNull().default(0),
  honorarios: integer("honorarios").notNull().default(0),
  otrosCostos: integer("otros_costos").notNull().default(0),
  total: integer("total").notNull().default(0),
  estadoPago: text("estado_pago").notNull().default("pendiente"),
  /** "Chicharrón": tiene un problema raro (se marca a mano; en un combo, todas sus partes). */
  problema: integer("problema", { mode: "boolean" }).notNull().default(false),
  /** Expedición de licencia (1ª vez): con clases (firma la carta de compromiso de terminarlas) o sin clases; null: sin decir. */
  conClases: integer("con_clases", { mode: "boolean" }),
  estadoTarjeta: text("estado_tarjeta"),
  /** Tramitador externo, academia o centro médico que apoya el trámite. */
  aliado: text("aliado"),
  observaciones: text("observaciones"),
  ...comunes(),
}, (t) => [
  uniqueIndex("tramites_serie_numero_unq").on(t.serie, t.numero),
  index("tramites_estado_idx").on(t.estado),
  index("tramites_titular_idx").on(t.titularId),
  index("tramites_vehiculo_idx").on(t.vehiculoId),
  index("tramites_encargo_idx").on(t.encargoId),
  index("tramites_version_idx").on(t.version),
  enLista("tramites_estado_chk", t.estado, D.ESTADOS_TRAMITE),
  enLista("tramites_estado_pago_chk", t.estadoPago, D.ESTADOS_PAGO),
  enLista("tramites_estado_tarjeta_chk", t.estadoTarjeta, D.ESTADOS_TARJETA, true),
  booleano("tramites_borrador_chk", t.borrador),
]);

/** Personas del trámite además del titular (comprador, vendedor, apoderado...). */
export const tramitePersonas = sqliteTable("tramite_personas", {
  id: id(),
  tramiteId: text("tramite_id").notNull().references(() => tramites.id, { onDelete: "cascade" }),
  clienteId: text("cliente_id").notNull().references(() => clientes.id, { onDelete: "cascade" }),
  rol: text("rol").notNull().default("interviniente"),
  ...comunes(),
}, (t) => [
  uniqueIndex("tramite_personas_unq").on(t.tramiteId, t.clienteId, t.rol),
  index("tramite_personas_version_idx").on(t.version),
  enLista("tramite_personas_rol_chk", t.rol, D.ROLES_PERSONA),
]);

export const documentos = sqliteTable("documentos", {
  id: id(),
  tramiteId: text("tramite_id").notNull().references(() => tramites.id, { onDelete: "cascade" }),
  /** Etiqueta del requisito ("FUN", "Contrato de compraventa"...). */
  tipoDocumento: text("tipo_documento").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  /** Clave del archivo en R2; vacío si todavía no se ha subido. */
  archivoClave: text("archivo_clave"),
  archivoNombre: text("archivo_nombre"),
  archivoTipo: text("archivo_tipo"),
  archivoBytes: integer("archivo_bytes"),
  origen: text("origen").notNull().default("manual"),
  notas: text("notas"),
  /** Consolidado (varios documentos juntos en un PDF): su receta, para editarlo desde los originales (composicion.ts). */
  composicion: text("composicion", { mode: "json" }).$type<Composicion>(),
  ...comunes(),
}, (t) => [
  index("documentos_tramite_idx").on(t.tramiteId),
  index("documentos_version_idx").on(t.version),
  enLista("documentos_estado_chk", t.estado, D.ESTADOS_DOC),
  enLista("documentos_origen_chk", t.origen, D.ORIGENES),
]);

export const pagos = sqliteTable("pagos", {
  id: id(),
  tramiteId: text("tramite_id").notNull().references(() => tramites.id, { onDelete: "cascade" }),
  concepto: text("concepto").notNull(),
  valor: integer("valor").notNull(),
  fecha: text("fecha").notNull(),
  metodo: text("metodo"),
  comprobanteClave: text("comprobante_clave"),
  ...comunes(),
}, (t) => [
  index("pagos_tramite_idx").on(t.tramiteId),
  index("pagos_version_idx").on(t.version),
  enLista("pagos_concepto_chk", t.concepto, D.CONCEPTOS_PAGO),
]);

/** Historial del trámite. Toda edición deja una entrada aquí. */
export const bitacora = sqliteTable("bitacora", {
  id: id(),
  tramiteId: text("tramite_id").notNull().references(() => tramites.id, { onDelete: "cascade" }),
  tipoEvento: text("tipo_evento").notNull(),
  descripcion: text("descripcion"),
  estadoAnterior: text("estado_anterior"),
  estadoNuevo: text("estado_nuevo"),
  origen: text("origen").notNull().default("manual"),
  /** Enlace al origen: id del mensaje de WhatsApp, de la notificación o del hilo del asistente. */
  referencia: text("referencia"),
  /** La nota destacada del trámite: sale grande arriba del expediente (una sola por trámite). */
  destacada: integer("destacada", { mode: "boolean" }).notNull().default(false),
  /** Fijada con la chinche: sale pequeña arriba del expediente, al lado de la destacada (varias por trámite). */
  fijada: integer("fijada", { mode: "boolean" }).notNull().default(false),
  fecha: text("fecha").notNull().default(ahora),
  ...comunes(),
}, (t) => [
  index("bitacora_tramite_idx").on(t.tramiteId, t.fecha),
  index("bitacora_version_idx").on(t.version),
  enLista("bitacora_tipo_chk", t.tipoEvento, D.TIPOS_EVENTO_BITACORA),
  enLista("bitacora_origen_chk", t.origen, D.ORIGENES),
]);

// ─── Licencias y recordatorios ───────────────────────────────────────────────

/** Una fila por cliente y categoría con su vencimiento vigente (radar de renovaciones). */
export const licencias = sqliteTable("licencias", {
  id: id(),
  clienteId: text("cliente_id").notNull().references(() => clientes.id, { onDelete: "cascade" }),
  categoria: text("categoria").notNull(),
  fechaExpedicion: text("fecha_expedicion"),
  fechaVencimiento: text("fecha_vencimiento").notNull(),
  origen: text("origen").notNull().default("manual"),
  tramiteId: text("tramite_id").references(() => tramites.id, { onDelete: "set null" }),
  gestionEstado: text("gestion_estado").notNull().default("sin_gestion"),
  gestionNota: text("gestion_nota"),
  gestionFecha: text("gestion_fecha"),
  ...comunes(),
}, (t) => [
  uniqueIndex("licencias_cliente_categoria_unq").on(t.clienteId, t.categoria),
  index("licencias_vencimiento_idx").on(t.fechaVencimiento),
  index("licencias_version_idx").on(t.version),
  enLista("licencias_categoria_chk", t.categoria, D.CATEGORIAS_LICENCIA),
  enLista("licencias_origen_chk", t.origen, D.ORIGENES_LICENCIA),
  enLista("licencias_gestion_chk", t.gestionEstado, D.ESTADOS_GESTION_LICENCIA),
]);

export const recordatorios = sqliteTable("recordatorios", {
  id: id(),
  tipo: text("tipo").notNull().default("recordatorio"),
  titulo: text("titulo").notNull(),
  fecha: text("fecha").notNull(),
  /** "HH:MM" o vacío si es para todo el día. */
  hora: text("hora"),
  estado: text("estado").notNull().default("pendiente"),
  clienteId: text("cliente_id").references(() => clientes.id, { onDelete: "set null" }),
  tramiteId: text("tramite_id").references(() => tramites.id, { onDelete: "set null" }),
  origen: text("origen").notNull().default("manual"),
  notas: text("notas"),
  ...comunes(),
}, (t) => [
  index("recordatorios_fecha_idx").on(t.estado, t.fecha),
  index("recordatorios_version_idx").on(t.version),
  enLista("recordatorios_tipo_chk", t.tipo, D.TIPOS_RECORDATORIO),
  enLista("recordatorios_estado_chk", t.estado, D.ESTADOS_RECORDATORIO),
  enLista("recordatorios_origen_chk", t.origen, D.ORIGENES),
]);

// ─── Formatos propios ────────────────────────────────────────────────────────

/** Formatos que sube Felipe (los oficiales van fijos en la app, en public/formatos). Archivo en R2. */
export const formatos = sqliteTable("formatos", {
  id: id(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  archivoClave: text("archivo_clave").notNull(),
  archivoNombre: text("archivo_nombre").notNull(),
  archivoTipo: text("archivo_tipo").notNull(),
  archivoBytes: integer("archivo_bytes").notNull(),
  creado: text("creado").notNull().default(ahora),
});

/**
 * Noticas: notas rápidas y tareas del día (barra de arriba, en cualquier pantalla). `fijada`: importante (va primero);
 * `hecha`: tachada (se borra a los 7 días de hecha).
 */
export const notas = sqliteTable("notas", {
  id: id(),
  texto: text("texto").notNull(),
  color: text("color").notNull().default("amarillo"),
  fijada: integer("fijada", { mode: "boolean" }).notNull().default(false),
  /** Va de primera, con un brillo que late alrededor de los bordes. */
  destacada: integer("destacada", { mode: "boolean" }).notNull().default(false),
  hecha: integer("hecha", { mode: "boolean" }).notNull().default(false),
  hechaEn: text("hecha_en"),
  ...comunes(),
}, (t) => [
  index("notas_version_idx").on(t.version),
  enLista("notas_color_chk", t.color, D.COLORES_NOTA),
]);

/**
 * Formatos en vivo: lo que el celular lee en Formatos llega solo a Llenar formatos abierto en el PC. `doc`: tarjeta,
 * propietario (cédula del vendedor) o comprador; `datos`: lo leído (JSON); `tomado`: cuándo lo tomó un PC.
 */
export const formatosVivo = sqliteTable("formatos_vivo", {
  id: id(),
  doc: text("doc").notNull(),
  datos: text("datos", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  creado: text("creado").notNull().default(ahora),
  tomado: text("tomado"),
}, (t) => [index("formatos_vivo_creado_idx").on(t.creado)]);

// ─── Bandeja del asistente: resumen diario de pendientes ─────────────────────

export interface ItemResumen { texto: string; detalle?: string; tramiteId?: string; recordatorioId?: string; referencia?: string }
export interface SeccionResumen { clave: string; titulo: string; items: ItemResumen[] }
export interface ContenidoResumen { saludo: string; secciones: SeccionResumen[] }

/** Cotizaciones guardadas del asistente (las de fotos de tarjetas se guardan solas; las de texto, con un botón). */
export const cotizaciones = sqliteTable("cotizaciones", {
  id: id(),
  titulo: text("titulo").notNull(),
  /** Tipo de trámite cotizado ("Traspaso de propiedad"...). */
  tramite: text("tramite"),
  /** Total de todo, en pesos. */
  total: integer("total").notNull().default(0),
  /** La cotización como se mostró (texto con **negritas**). */
  texto: text("texto").notNull(),
  /** "fotos" (tarjetas de propiedad) o "asistente" (guardada desde la conversación). */
  origen: text("origen").notNull().default("fotos"),
  datos: text("datos", { mode: "json" }).$type<unknown>(),
  creado: text("creado").notNull().default(ahora),
}, (t) => [index("cotizaciones_creado_idx").on(t.creado)]);

/** Conversaciones del asistente (para volver a ellas). Hasta 120 mensajes; se borran a los 30 días sin usar. No se copian al navegador. */
export const conversaciones = sqliteTable("conversaciones", {
  id: id(),
  /** La primera pregunta, recortada. */
  titulo: text("titulo").notNull(),
  mensajes: text("mensajes", { mode: "json" }).$type<unknown[]>().notNull(),
  cantidad: integer("cantidad").notNull().default(0),
  creado: text("creado").notNull().default(ahora),
  actualizado: text("actualizado").notNull().default(ahora),
}, (t) => [index("conversaciones_actualizado_idx").on(t.actualizado)]);

/** Un resumen por día (lo arma el cron de las 6:30 a. m.). Es una foto de esa hora: no se recalcula. */
export const resumenesDiarios = sqliteTable("resumenes_diarios", {
  fecha: text("fecha").primaryKey(),
  contenido: text("contenido", { mode: "json" }).$type<ContenidoResumen>().notNull(),
  leido: integer("leido", { mode: "boolean" }).notNull().default(false),
  creado: text("creado").notNull().default(ahora),
}, (t) => [booleano("resumenes_diarios_leido", t.leido)]);

// ─── Consultas externas (PlacApi: RUNT) ──────────────────────────────────────

/** Cada consulta pagada o intentada, con los créditos que costó. No se copia al navegador. */
export const consultasExternas = sqliteTable("consultas_externas", {
  id: id(),
  servicio: text("servicio").notNull().default("placapi"),
  /** "licencia" (por cédula) o "vehiculo" (por placa). */
  tipo: text("tipo").notNull(),
  /** Id del cliente o del vehículo consultado. */
  referencia: text("referencia").notNull(),
  creditos: integer("creditos").notNull().default(0),
  /** "ok", "sin_datos" o "error". */
  resultado: text("resultado").notNull(),
  detalle: text("detalle"),
  /** Lo que respondió PlacApi, completo (se reutiliza el mismo día sin volver a pagar). */
  respuesta: text("respuesta", { mode: "json" }).$type<unknown>(),
  creado: text("creado").notNull().default(ahora),
}, (t) => [
  index("consultas_externas_ref_idx").on(t.tipo, t.referencia, t.creado),
  index("consultas_externas_creado_idx").on(t.creado),
  check("consultas_externas_resultado_chk", sql`${t.resultado} IN ('ok', 'sin_datos', 'error')`),
]);

// ─── WhatsApp (monitor de solo lectura, vía Kapso) ───────────────────────────

/** Un chat por número de WhatsApp (id = número con indicativo, solo dígitos). Se copia al navegador. */
export const waChats = sqliteTable("wa_chats", {
  id: id(),
  /** Nombre del perfil de WhatsApp de la persona. */
  nombre: text("nombre"),
  clienteId: text("cliente_id").references(() => clientes.id, { onDelete: "set null" }),
  clasificacion: text("clasificacion").notNull().default("pendiente"),
  /** Por qué la IA lo clasificó así. */
  motivo: text("motivo"),
  ultimoMensaje: text("ultimo_mensaje"),
  /** Vista previa del último mensaje (recortada). */
  ultimoTexto: text("ultimo_texto"),
  mensajes: integer("mensajes").notNull().default(0),
  noLeidos: integer("no_leidos").notNull().default(0),
  /** Hasta qué momento (enviado) la IA ya revisó los mensajes en vivo para proponer acciones. */
  analizadoHasta: text("analizado_hasta"),
  ...comunes(),
}, (t) => [
  index("wa_chats_cliente_idx").on(t.clienteId),
  index("wa_chats_version_idx").on(t.version),
  enLista("wa_chats_clasificacion_chk", t.clasificacion, D.CLASIFICACIONES_CHAT),
]);

/** Mensajes (id = wamid). NO se copian al navegador: la app los pide por chat. Los archivos van a R2. */
export const waMensajes = sqliteTable("wa_mensajes", {
  id: id(),
  chatId: text("chat_id").notNull().references(() => waChats.id, { onDelete: "cascade" }),
  direccion: text("direccion").notNull(),
  /** text, image, document, audio, video, sticker, location, contacts, reaction... (lo que mande WhatsApp). */
  tipo: text("tipo").notNull(),
  texto: text("texto"),
  archivoClave: text("archivo_clave"),
  archivoTipo: text("archivo_tipo"),
  archivoNombre: text("archivo_nombre"),
  /** Enlace de YCloud mientras el archivo no se ha copiado a R2 (sirve 30 días con la llave de API). */
  archivoEnlace: text("archivo_enlace"),
  enviado: text("enviado").notNull(),
  /** "vivo" o "historial" (los 6 meses que llegan al conectar; la IA no les propone acciones). */
  origen: text("origen").notNull().default("vivo"),
  creado: text("creado").notNull().default(ahora),
}, (t) => [
  index("wa_mensajes_chat_idx").on(t.chatId, t.enviado),
  enLista("wa_mensajes_direccion_chk", t.direccion, D.DIRECCIONES_MENSAJE),
  check("wa_mensajes_origen_chk", sql`${t.origen} IN ('vivo', 'historial')`),
]);

/** Acciones que la IA propone al leer un chat; Felipe las confirma o descarta. Se copian al navegador. */
export const waPropuestas = sqliteTable("wa_propuestas", {
  id: id(),
  chatId: text("chat_id").notNull().references(() => waChats.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull(),
  titulo: text("titulo").notNull(),
  metodo: text("metodo").notNull(),
  ruta: text("ruta").notNull(),
  /** JSON con el cuerpo de la petición. */
  cuerpo: text("cuerpo").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  /** wamid del mensaje que la originó (queda en la bitácora como referencia). */
  mensajeId: text("mensaje_id"),
  ...comunes(),
}, (t) => [
  index("wa_propuestas_chat_idx").on(t.chatId),
  index("wa_propuestas_version_idx").on(t.version),
  enLista("wa_propuestas_estado_chk", t.estado, D.ESTADOS_PROPUESTA),
]);

/** Estado de la conexión (último evento, avance del historial). Clave/valor; no se copia al navegador. */
export const waEstado = sqliteTable("wa_estado", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
});

// ─── Uso de la IA ────────────────────────────────────────────────────────────

/** Tokens de OpenAI por día, función y modelo, para saber cuánto cuesta. No se copia al navegador. */
export const usoIa = sqliteTable("uso_ia", {
  fecha: text("fecha").notNull(),
  funcion: text("funcion").notNull(),
  modelo: text("modelo").notNull(),
  llamadas: integer("llamadas").notNull().default(0),
  tokensEntrada: integer("tokens_entrada").notNull().default(0),
  tokensSalida: integer("tokens_salida").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.fecha, t.funcion, t.modelo] })]);

// ─── Sincronización ──────────────────────────────────────────────────────────

/** Contador global de cambios (una sola fila, id = 1). Lo suben los triggers. */
export const contador = sqliteTable("contador", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull().default(0),
});

/** Borrados, para que el navegador también los quite de su copia. */
export const eliminados = sqliteTable("eliminados", {
  tabla: text("tabla").notNull(),
  registroId: text("registro_id").notNull(),
  version: integer("version").notNull(),
}, (t) => [index("eliminados_version_idx").on(t.version)]);

/** Sobres enviados desde Envíos (para seguirlos hasta que llegan; el mapa los muestra en ruta). */
export const envios = sqliteTable("envios", {
  id: id(),
  tramiteId: text("tramite_id").references(() => tramites.id, { onDelete: "set null" }),
  destinatario: text("destinatario").notNull(),
  ciudad: text("ciudad").notNull(),
  direccion: text("direccion"),
  telefono: text("telefono"),
  guia: text("guia"),
  formato: text("formato").notNull().default("grande"),
  estado: text("estado").notNull().default("enviado"),
  fechaEnvio: text("fecha_envio").notNull(),
  fechaRecibido: text("fecha_recibido"),
  notas: text("notas"),
  /** Si sale en el mapa (solo si se pidió): activo hasta las 6:30 del día siguiente, luego gris (histórico). */
  enMapa: integer("en_mapa", { mode: "boolean" }).notNull().default(false),
  ...comunes(),
}, (t) => [
  index("envios_estado_idx").on(t.estado, t.fechaEnvio),
  index("envios_tramite_idx").on(t.tramiteId),
  index("envios_version_idx").on(t.version),
  enLista("envios_estado_chk", t.estado, D.ESTADOS_ENVIO),
  enLista("envios_formato_chk", t.formato, ["grande", "pequeno"]),
]);

/** Tablas que se copian al navegador, con el nombre de su llave. */
export const TABLAS_SINCRONIZADAS = {
  clientes: "id",
  organismos: "id",
  tipos_tramite: "id",
  tarifas: "id",
  parametros: "clave",
  vehiculos: "id",
  vehiculo_personas: "id",
  tramites: "id",
  tramite_personas: "id",
  documentos: "id",
  pagos: "id",
  bitacora: "id",
  licencias: "id",
  recordatorios: "id",
  wa_chats: "id",
  wa_propuestas: "id",
  envios: "id",
  notas: "id",
} as const;
export type TablaSincronizada = keyof typeof TABLAS_SINCRONIZADAS;
