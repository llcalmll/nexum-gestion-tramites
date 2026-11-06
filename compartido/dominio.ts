/*
 * Vocabulario del negocio, compartido por la API (Worker) y la app (navegador).
 * Las listas `as const` alimentan los CHECK de la base, así que agregar un valor aquí
 * exige una migración nueva.
 */

/** "fallido": cancelado, no se pudo hacer (vino oscuro). */
export type Semaforo = "ok" | "warn" | "danger" | "info" | "neutral" | "fallido";

// ─── Trámites ────────────────────────────────────────────────────────────────

/**
 * Valores que acepta la base (CHECK). "listo_para_entrega" ya no se usa: la tarjeta física se sigue con
 * estado_tarjeta. Se conserva en la lista solo para no reconstruir la tabla en D1.
 */
export const ESTADOS_TRAMITE = ["en_preparacion", "en_tramite", "requiere_correccion", "listo_para_entrega", "entregado", "cancelado"] as const;
export type EstadoTramite = (typeof ESTADOS_TRAMITE)[number];
/** El flujo real de la oficina: se recibe, va al tránsito, se finaliza. Corrección y cancelado son la excepción. */
export const ESTADOS_EN_USO: EstadoTramite[] = ["en_preparacion", "en_tramite", "entregado", "requiere_correccion", "cancelado"];
export const ESTADO_TRAMITE_LABEL: Record<EstadoTramite, string> = {
  en_preparacion: "Recibido",
  en_tramite: "En tránsito",
  requiere_correccion: "Requiere corrección",
  listo_para_entrega: "Listo para entrega",
  entregado: "Finalizado",
  cancelado: "Cancelado",
};
export const ESTADO_TRAMITE_COLOR: Record<EstadoTramite, Semaforo> = {
  en_preparacion: "neutral",
  en_tramite: "info",
  requiere_correccion: "danger",
  listo_para_entrega: "ok",
  entregado: "ok",
  cancelado: "fallido",
};
/** Pasar a cualquiera de estos estados exige las precondiciones completas (incluido "Finalizado"). */
export const ESTADOS_REQUIEREN_PRECONDICIONES: EstadoTramite[] = ["en_tramite", "requiere_correccion", "listo_para_entrega", "entregado"];
export const ESTADOS_TERMINALES: EstadoTramite[] = ["entregado", "cancelado"];

export const CATEGORIAS_TRAMITE = ["vehiculo", "licencia", "seguros_multas"] as const;

/** Los colores de las noticas (notas rápidas de la barra de arriba). */
export const COLORES_NOTA = ["amarillo", "rosa", "verde", "azul", "lila"] as const;
export type ColorNota = (typeof COLORES_NOTA)[number];
export type CategoriaTramite = (typeof CATEGORIAS_TRAMITE)[number];
export const CATEGORIA_LABEL: Record<CategoriaTramite, string> = { vehiculo: "Vehículo", licencia: "Licencia", seguros_multas: "Seguros / multas" };

export const PRECONDICIONES = [
  "runt", "identidad", "soat", "rtm", "paz_salvo_simit", "sin_medidas_rnmc",
  "paz_salvo_impuesto", "sin_gravamenes", "sin_embargos", "carta_prenda", "improntas", "contrato",
] as const;
export type Precondicion = (typeof PRECONDICIONES)[number];
export const PRECONDICION_LABEL: Record<Precondicion, string> = {
  runt: "Inscripción en RUNT",
  identidad: "Identidad autenticada",
  soat: "SOAT vigente",
  rtm: "RTM vigente",
  paz_salvo_simit: "Paz y salvo de multas (SIMIT)",
  sin_medidas_rnmc: "Sin medidas correctivas (RNMC)",
  paz_salvo_impuesto: "Paz y salvo de impuesto",
  sin_gravamenes: "Sin gravámenes / limitaciones",
  /** Sin embargos ni otras medidas judiciales o administrativas sobre la propiedad (consulta del RUNT por placa):
   *  se marca a mano. Una prenda se levanta con su carta; un embargo no deja traspasar hasta el oficio de desembargo. */
  sin_embargos: "Sin embargos ni otras limitaciones (RUNT)",
  /** La carta del acreedor (banco o financiera) que autoriza levantar la prenda: original, para el tránsito. */
  carta_prenda: "Carta de levantamiento de prenda",
  improntas: "Improntas",
  contrato: "Contrato de compraventa",
};
/**
 * Precondiciones que salen de los datos del vehículo. Se calculan en vivo al leer el trámite
 * (no se copian al trámite), así que si cambian las fechas del vehículo, el trámite lo refleja.
 */
export const PRECONDICION_DESDE_VEHICULO: Partial<Record<Precondicion, "soatVence" | "rtmVence" | "impuestoAlDiaHasta" | "gravamenes">> = {
  soat: "soatVence",
  rtm: "rtmVence",
  paz_salvo_impuesto: "impuestoAlDiaHasta",
  sin_gravamenes: "gravamenes",
};
/** Estado manual de una precondición dentro del trámite. `nota` nunca se borra al guardar otras. */
export type PrecondicionEstado = { ok?: boolean; fecha?: string; nota?: string };

export const ESTADOS_PAGO = ["pendiente", "abonado", "pagado"] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];
export const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = { pendiente: "Pendiente", abonado: "Abonado", pagado: "Pagado" };

export const ESTADOS_TARJETA = ["no_recibida", "en_oficina", "enviada", "entregada", "rechazada"] as const;
export type EstadoTarjeta = (typeof ESTADOS_TARJETA)[number];
export const ESTADO_TARJETA_LABEL: Record<EstadoTarjeta, string> = {
  no_recibida: "Tarjeta sin recibir",
  en_oficina: "Tarjeta en oficina",
  enviada: "Tarjeta enviada",
  entregada: "Tarjeta entregada",
  rechazada: "Rechazada",
};

export const ESTADOS_DOC = ["pendiente", "recibido", "validado", "rechazado"] as const;
export type EstadoDoc = (typeof ESTADOS_DOC)[number];
export const ESTADO_DOC_LABEL: Record<EstadoDoc, string> = { pendiente: "Pendiente", recibido: "Recibido", validado: "Validado", rechazado: "Rechazado" };

export const CONCEPTOS_PAGO = ["derechos", "honorarios", "abono", "otros"] as const;
export type ConceptoPago = (typeof CONCEPTOS_PAGO)[number];
export const CONCEPTO_PAGO_LABEL: Record<ConceptoPago, string> = { derechos: "Derechos de trámite", honorarios: "Honorarios", abono: "Abono", otros: "Otros" };

/** De dónde salió un registro: a mano, calculado por la app, propuesto por el asistente o llegado por WhatsApp. */
export const ORIGENES = ["manual", "sistema", "asistente", "whatsapp"] as const;
export type Origen = (typeof ORIGENES)[number];

/** Un sobre de Envíos: salió, llegó o lo devolvieron. */
export const ESTADOS_ENVIO = ["enviado", "recibido", "devuelto"] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

export const TIPOS_EVENTO_BITACORA = ["creacion", "cambio_estado", "nota", "datos", "costos", "documento", "pago", "precondicion", "persona"] as const;
export type TipoEventoBitacora = (typeof TIPOS_EVENTO_BITACORA)[number];

// ─── Personas y vehículos ────────────────────────────────────────────────────

export const TIPOS_DOCUMENTO = ["CC", "TI", "CE", "Pasaporte", "PPT", "NIT"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ROLES_PERSONA = ["titular", "copropietario", "comprador", "vendedor", "apoderado", "interviniente"] as const;
export type RolPersona = (typeof ROLES_PERSONA)[number];
export const ROL_PERSONA_LABEL: Record<RolPersona, string> = {
  // "interviniente": un tercero que actúa en el trámite sin ser tramitador (el yerno que representa a la suegra en la venta).
  titular: "Titular", copropietario: "Copropietario", comprador: "Comprador", vendedor: "Vendedor", apoderado: "Apoderado", interviniente: "Persona relacionada (tercero)",
};

export const SERVICIOS_VEHICULO = ["particular", "publico", "oficial", "diplomatico"] as const;
export type ServicioVehiculo = (typeof SERVICIOS_VEHICULO)[number];

export const TIPOS_GRAVAMEN = ["prenda", "embargo", "limitacion_dominio"] as const;
export type TipoGravamen = (typeof TIPOS_GRAVAMEN)[number];
export type Gravamen = { tipo: TipoGravamen; origen?: string; descripcion?: string };

// ─── Licencias ───────────────────────────────────────────────────────────────

export const CATEGORIAS_LICENCIA = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"] as const;
export type CategoriaLicencia = (typeof CATEGORIAS_LICENCIA)[number];

export const ORIGENES_LICENCIA = ["manual", "tramite", "importada", "foto", "consulta"] as const;
export type OrigenLicencia = (typeof ORIGENES_LICENCIA)[number];

/** Seguimiento del radar de renovaciones: cada licencia por vencer es una llamada por hacer. */
export const ESTADOS_GESTION_LICENCIA = ["sin_gestion", "por_llamar", "contactado", "agendado", "renovado", "descartado"] as const;
export type EstadoGestionLicencia = (typeof ESTADOS_GESTION_LICENCIA)[number];
export const ESTADO_GESTION_LICENCIA_LABEL: Record<EstadoGestionLicencia, string> = {
  sin_gestion: "Sin gestión", por_llamar: "Por llamar", contactado: "Contactado", agendado: "Agendado", renovado: "Renovado", descartado: "No interesa",
};

// ─── Recordatorios (citas, llamadas y recordatorios en una sola lista) ──────

export const TIPOS_RECORDATORIO = ["recordatorio", "cita", "llamada"] as const;
export type TipoRecordatorio = (typeof TIPOS_RECORDATORIO)[number];
export const ESTADOS_RECORDATORIO = ["pendiente", "hecho", "cancelado"] as const;
export type EstadoRecordatorio = (typeof ESTADOS_RECORDATORIO)[number];

// ─── Utilidades de texto ─────────────────────────────────────────────────────

/** Texto para buscar: minúsculas, sin tildes y con espacios simples ("Pérez  GÓMEZ" -> "perez gomez"). */
export function normalizar(...partes: (string | null | undefined)[]): string {
  return partes
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Número visible de un trámite: T-2026-00042. */
/** "T-2026-00123" (trámites) o "L-2026-00012" (licencias: su propia serie desde octubre de 2026). */
export const etiquetaTramite = (numero: number, creado: string, serie?: string | null) => `${serie === "L" ? "L" : "T"}-${creado.slice(0, 4)}-${String(numero).padStart(5, "0")}`;
/**
 * El código que se ve de un trámite. Un combo (trámites creados juntos: traspaso + levantamiento de prenda...) lleva un
 * solo código, el de su primer trámite (`codigo`); cada parte conserva su número interno, que también lo encuentra.
 */
export const codigoTramite = (t: { numero: number; codigo?: number | null; creado: string; serie?: string | null }) => etiquetaTramite(t.codigo ?? t.numero, t.creado, t.serie);
/** La serie de un trámite nuevo: "L" si todos sus tipos son de licencia (un combo mixto va en la de trámites). */
export const serieDe = (categorias: (string | null | undefined)[]) => (categorias.length && categorias.every((c) => c === "licencia") ? "L" : "T");

// ─── WhatsApp (monitor de solo lectura) ──────────────────────────────────────

/**
 * Clasificación de cada chat. Los de clientes conocidos entran como "tramites"; los demás los clasifica la IA.
 * "personal_propuesto" espera la confirmación de Felipe; al confirmar pasa a "personal" y se borran sus mensajes.
 */
export const CLASIFICACIONES_CHAT = ["pendiente", "tramites", "dudoso", "personal_propuesto", "personal"] as const;
export type ClasificacionChat = (typeof CLASIFICACIONES_CHAT)[number];
export const CLASIFICACION_CHAT_LABEL: Record<ClasificacionChat, string> = {
  pendiente: "Sin clasificar",
  tramites: "Trámites",
  dudoso: "Dudoso",
  personal_propuesto: "Parece personal",
  personal: "Personal",
};
export const DIRECCIONES_MENSAJE = ["entrante", "saliente"] as const;
export type DireccionMensaje = (typeof DIRECCIONES_MENSAJE)[number];
export const ESTADOS_PROPUESTA = ["pendiente", "hecha", "descartada"] as const;
export type EstadoPropuesta = (typeof ESTADOS_PROPUESTA)[number];
