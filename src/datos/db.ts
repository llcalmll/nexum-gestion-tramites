import Dexie, { type Table } from "dexie";
import type * as T from "../../compartido/tipos";

/**
 * Copia local de los datos (IndexedDB). La app lee siempre de aquí, así responde rápido y
 * funciona sin internet. Las escrituras van por la API; los cambios vuelven por la descarga incremental.
 * Los nombres de las tablas son los mismos de la base (D1).
 */
export class BaseLocal extends Dexie {
  clientes!: Table<T.Cliente, string>;
  organismos!: Table<T.Organismo, string>;
  tipos_tramite!: Table<T.TipoTramite, string>;
  tarifas!: Table<T.Tarifa, string>;
  parametros!: Table<T.Parametro, string>;
  vehiculos!: Table<T.Vehiculo, string>;
  vehiculo_personas!: Table<T.VehiculoPersona, string>;
  tramites!: Table<T.Tramite, string>;
  tramite_personas!: Table<T.TramitePersona, string>;
  documentos!: Table<T.Documento, string>;
  pagos!: Table<T.Pago, string>;
  bitacora!: Table<T.EntradaBitacora, string>;
  licencias!: Table<T.Licencia, string>;
  recordatorios!: Table<T.Recordatorio, string>;
  wa_chats!: Table<T.ChatWhatsApp, string>;
  wa_propuestas!: Table<T.PropuestaWhatsApp, string>;
  envios!: Table<T.Envio, string>;
  notas!: Table<T.Nota, string>;
  /** Datos de la sincronización (la versión hasta la que se descargó). */
  meta!: Table<{ clave: string; valor: unknown }, string>;

  constructor() {
    super("nexum");
    this.version(1).stores({
      clientes: "id, numeroDocumento, telefono",
      organismos: "id",
      tipos_tramite: "id, categoria",
      tarifas: "id, tipoTramiteId, organismoId",
      parametros: "clave",
      vehiculos: "id, placa, titularId",
      vehiculo_personas: "id, vehiculoId, clienteId",
      tramites: "id, numero, estado, titularId, vehiculoId, encargoId",
      tramite_personas: "id, tramiteId, clienteId",
      documentos: "id, tramiteId",
      pagos: "id, tramiteId",
      bitacora: "id, tramiteId, fecha",
      licencias: "id, clienteId, fechaVencimiento",
      recordatorios: "id, fecha, estado",
      meta: "clave",
    });
    // Fase 5: chats y propuestas de WhatsApp (los mensajes se piden por chat, no se copian).
    this.version(2).stores({
      wa_chats: "id, clienteId, clasificacion, ultimoMensaje",
      wa_propuestas: "id, chatId, estado",
    });
    // Sobres de Envíos (el mapa los muestra en ruta hasta que llegan).
    this.version(3).stores({ envios: "id, estado, tramiteId" });
    // Noticas (notas rápidas de la barra de arriba).
    this.version(4).stores({ notas: "id, hecha" });
  }
}

export const db = new BaseLocal();

export const TABLAS_LOCALES = [
  "clientes", "organismos", "tipos_tramite", "tarifas", "parametros", "vehiculos", "vehiculo_personas",
  "tramites", "tramite_personas", "documentos", "pagos", "bitacora", "licencias", "recordatorios", "wa_chats", "wa_propuestas", "envios", "notas",
] as const;
export type TablaLocal = (typeof TABLAS_LOCALES)[number];
