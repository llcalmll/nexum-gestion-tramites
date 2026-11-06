// Tipos de cada fila, tal como los entrega la API y los guarda la copia local del navegador.
import type * as E from "./esquema";

export type Cliente = typeof E.clientes.$inferSelect;
export type Organismo = typeof E.organismos.$inferSelect;
export type TipoTramite = typeof E.tiposTramite.$inferSelect;
export type Tarifa = typeof E.tarifas.$inferSelect;
export type Parametro = typeof E.parametros.$inferSelect;
export type Vehiculo = typeof E.vehiculos.$inferSelect;
export type VehiculoPersona = typeof E.vehiculoPersonas.$inferSelect;
export type Tramite = typeof E.tramites.$inferSelect;
export type TramitePersona = typeof E.tramitePersonas.$inferSelect;
export type Documento = typeof E.documentos.$inferSelect;
export type Pago = typeof E.pagos.$inferSelect;
export type EntradaBitacora = typeof E.bitacora.$inferSelect;
export type Licencia = typeof E.licencias.$inferSelect;
export type Recordatorio = typeof E.recordatorios.$inferSelect;
export type Envio = typeof E.envios.$inferSelect;
export type Nota = typeof E.notas.$inferSelect;
export type ChatWhatsApp = typeof E.waChats.$inferSelect;
export type MensajeWhatsApp = typeof E.waMensajes.$inferSelect;
export type PropuestaWhatsApp = typeof E.waPropuestas.$inferSelect;

/** Respuesta de GET /api/cambios. `cambios` va por nombre de tabla en la base (snake_case). */
export interface RespuestaCambios {
  /** Hasta qué versión llega esta respuesta. */
  version: number;
  /** Versión actual del servidor (para el avance de la primera descarga). */
  ultima: number;
  cambios: Record<string, Record<string, unknown>[]>;
  eliminados: { tabla: string; registroId: string }[];
  mas: boolean;
}

export interface RespuestaEstado {
  app: "nexum";
  correo: string;
  version: number;
}
