/** Respuestas JSON de la API. Nunca se guardan en caché: son datos personales. */
export function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const error = (mensaje: string, estado = 400) => json({ error: mensaje }, estado);

/** Error con mensaje para mostrar; los demás se registran y se responden como 500 genérico. */
export class ErrorApi extends Error {
  constructor(mensaje: string, public estado = 400) {
    super(mensaje);
  }
}
