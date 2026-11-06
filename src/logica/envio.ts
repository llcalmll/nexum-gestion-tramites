import { normalizar } from "../../compartido/dominio";

/**
 * "Enviar a otra ciudad" desde un trámite (su menú, su expediente): la ciudad de su organismo, si no es Ibagué (donde
 * está la oficina: ahí no hay nada que enviar). Null si no aplica.
 */
export const ciudadDeEnvio = (org?: { ciudad?: string | null } | null) => (org?.ciudad && normalizar(org.ciudad) !== "ibague" ? org.ciudad : null);
/** Envíos con este trámite ya elegido (y su ciudad y tramitador, si los hay). */
export const rutaEnvio = (tramiteId: string) => `/envios?tramite=${encodeURIComponent(tramiteId)}`;
