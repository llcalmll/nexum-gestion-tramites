/*
 * Aumento de resolución de documentos por IA (Escáner): una imagen borrosa no se "agranda" (ampliarla con IA inventa
 * letras y números), se TRANSCRIBE: el lector dice qué texto hay y dónde, y la app arma la hoja otra vez con letra real.
 *
 *   POST /api/aumento/leer  { imagen, derecha? } -> { girar, datos: {} } | { datos: { pagina, segunda } }
 *     pagina: lo que hay en la hoja. segunda: el texto leído aparte por otro modelo, solo para comparar; lo que no
 *     coincida se marca para revisar. null si esa segunda lectura falló (la app lo trata como no comprobado).
 *     derecha: true si la app ya comparó los cuatro giros y esta es la derecha (ver leerDerecha).
 *
 * Modelos, medidos con scripts/estres-aumento.mjs sobre un documento ficticio de números difíciles: gpt-5.6-terra con
 * detail "original" ubica los textos casi exacto (0,1 % de error en la altura; gpt-5 y gpt-5.5 fallan del 5 al 10 %), y
 * con eso se recortan bien las firmas y los renglones para revisar. En una captura normal acertó 40 de 42 datos, y lo
 * que no acertó lo marcó; en una imagen muy borrosa ningún modelo lee bien los dígitos (28-31 de 42): por eso se revisa.
 *
 * Ana Gómez: la persona compara con el original y confirma lo dudoso antes de que exista el documento. Nada se guarda aquí.
 */
import { ErrorApi, json } from "../http";
import { registrarUsoIa, type Datos, type Db } from "../util";

const LECTOR = "gpt-5.6-terra";
const COMPARADOR = "gpt-5.5";
const IMAGEN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const COORD = (d: string) => ({ type: "number", description: `${d} De 0 a 1000 sobre la imagen.` });
const ALINEACION = { type: "string", enum: ["izquierda", "centro", "derecha", "justificado"] };
const DUDOSO = { type: "boolean", description: "true si algún carácter no se distingue con seguridad (un 6 que puede ser 8...). Pon tu mejor lectura y márcalo." };

const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["giro", "elementos", "tablas", "lineas", "recortes"],
  properties: {
    giro: { type: "string", enum: ["0", "90", "180", "270"], description: "Grados a girar la imagen en el sentido del reloj para que el texto quede derecho; 0 si ya lo está." },
    elementos: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["texto", "x", "y", "ancho", "alineacion", "estilo", "negrilla", "subrayado", "dudoso"],
        properties: {
          texto: { type: "string", description: "El texto exacto. Una etiqueta y su valor son DOS elementos." },
          x: COORD("Según la alineación: borde izquierdo (izquierda, justificado), centro (centro) o borde derecho (derecha)."),
          y: COORD("Centro vertical (de la primera línea, si es un párrafo)."),
          ancho: { type: ["number", "null"], description: "Solo en párrafos de varias líneas: el ancho del bloque (0 a 1000). null en una sola línea." },
          alineacion: ALINEACION,
          estilo: { type: "string", enum: ["titulo", "subtitulo", "normal", "pequeno"] },
          negrilla: { type: "boolean" }, subrayado: { type: "boolean" }, dudoso: DUDOSO,
        },
      },
    },
    tablas: {
      type: "array",
      description: "Solo cuadros con líneas de verdad. Su texto va aquí, no en elementos.",
      items: {
        type: "object", additionalProperties: false,
        required: ["x0", "y0", "x1", "y1", "columnas", "filas"],
        properties: {
          x0: COORD("Borde izquierdo."), y0: COORD("Borde de arriba."), x1: COORD("Borde derecho."), y1: COORD("Borde de abajo."),
          columnas: { type: "array", items: { type: "number" }, description: "Las líneas verticales de adentro, de 0 a 1000 (sin los bordes)." },
          filas: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["y1", "sombreada", "celdas"],
              properties: {
                y1: COORD("Borde de abajo de la fila."),
                sombreada: { type: "boolean", description: "Fondo gris." },
                celdas: {
                  type: "array", description: "Una por columna, también las vacías (texto vacío).",
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["texto", "alineacion", "negrilla", "dudoso"],
                    properties: { texto: { type: "string" }, alineacion: ALINEACION, negrilla: { type: "boolean" }, dudoso: DUDOSO },
                  },
                },
              },
            },
          },
        },
      },
    },
    lineas: {
      type: "array", description: "Líneas sueltas: la de una firma, un separador. NO la de un texto subrayado ni las de una tabla.",
      items: { type: "object", additionalProperties: false, required: ["x0", "y0", "x1", "y1"], properties: { x0: COORD("Inicio."), y0: COORD("Inicio."), x1: COORD("Fin."), y1: COORD("Fin.") } },
    },
    recortes: {
      type: "array", description: "Lo que NO es texto y se debe conservar tal cual de la foto: firma a mano, sello, logo, foto de una persona, huella, código QR o de barras.",
      items: {
        type: "object", additionalProperties: false, required: ["tipo", "x0", "y0", "x1", "y1"],
        properties: { tipo: { type: "string", enum: ["firma", "sello", "logo", "foto", "huella", "codigo"] }, x0: COORD("Izquierda."), y0: COORD("Arriba."), x1: COORD("Derecha."), y1: COORD("Abajo.") },
      },
    },
  },
};

const INSTRUCCION =
  "Transcribes un documento colombiano de mala resolución para volver a escribirlo con letra nítida, en su mismo orden y lugar. Puede ser un trámite, una orden médica o cualquier papel. " +
  "Las coordenadas van de 0 a 1000 sobre la imagen: x de izquierda a derecha, y de arriba abajo (1000 es el borde de abajo, aunque la imagen sea alta).\n" +
  "REGLAS:\n" +
  "- Copia EXACTO, carácter por carácter: no corrijas ortografía ni agregues tildes que no están, no completes, no cambies formatos ni el orden de los datos. Conserva los campos vacíos: si una etiqueta no tiene valor, va la etiqueta sola.\n" +
  "- Números, fechas, documentos, placas, códigos, correos y direcciones: lee dígito por dígito y compáralo con los demás dígitos de la hoja (el 6, el 8, el 9, el 3 y el 0 se confunden al estar borrosos). Si no estás seguro, pon tu mejor lectura y dudoso: true. NUNCA inventes.\n" +
  "- Si algo no se lee en absoluto, escribe [ilegible] con dudoso: true.\n" +
  "- Escrito a mano: transcríbelo con dudoso: true. Una FIRMA no se transcribe: va en recortes.\n" +
  "- Un elemento por cada dato: etiqueta y valor separados, con las posiciones que tienen en la hoja. Un párrafo de varias líneas va en UN solo elemento, con su ancho, y el texto seguido.\n" +
  "- Ignora lo que no es del documento: barras del celular, botones de WhatsApp, el fondo, la mesa.\n" +
  "- Si la hoja está girada, solo di el giro: lo demás vacío.";

const INSTRUCCION_COMPARAR =
  "Transcribe TODO el texto del documento de esta imagen, carácter por carácter, tal como está, sin corregir nada. " +
  "Un renglón por cada dato (si se repite en la hoja, una sola vez basta). Lee los números dígito por dígito. Ignora lo que no es del documento (barras del celular, botones).";
const ESQUEMA_COMPARAR = { type: "object", additionalProperties: false, required: ["textos"], properties: { textos: { type: "array", items: { type: "string" } } } };

async function preguntar(db: Db, apiKey: string, modelo: string, sistema: string, esquema: unknown, nombre: string, imagen: string) {
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(100_000),
      body: JSON.stringify({
        model: modelo,
        max_completion_tokens: 32000, reasoning_effort: "low",
        store: false,
        response_format: { type: "json_schema", json_schema: { name: nombre, strict: true, schema: esquema } },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: [{ type: "text", text: "Este es el documento." }, { type: "image_url", image_url: { url: imagen, detail: "original" } }] },
        ],
      }),
    });
  } catch (e) {
    console.error("OpenAI no respondió", e);
    throw new ErrorApi("No se pudo leer el documento (OpenAI no respondió). Intente de nuevo.", 502);
  }
  if (!r.ok) {
    console.error("OpenAI respondió", r.status, (await r.text()).slice(0, 500));
    throw new ErrorApi(r.status === 401 ? "La clave de OpenAI no es válida." : "No se pudo leer el documento. Intente de nuevo.", 502);
  }
  const res = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  await registrarUsoIa(db, "aumento_leer", modelo, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0).run();
  try { return JSON.parse(res.choices?.[0]?.message?.content ?? "") as Record<string, unknown>; }
  catch { throw new ErrorApi("No se pudo leer el documento: pruebe con otra imagen.", 422); }
}

export async function leerDocumento(db: Db, apiKey: string | undefined, cuerpo: Datos): Promise<Response> {
  if (!apiKey) throw new ErrorApi("Falta configurar la clave de OpenAI.", 503);
  const imagen = typeof cuerpo.imagen === "string" ? cuerpo.imagen : "";
  if (!IMAGEN.test(imagen)) throw new ErrorApi("La imagen debe ser JPG, PNG o WEBP.");
  const [primera, segunda] = await Promise.allSettled([
    preguntar(db, apiKey, LECTOR, INSTRUCCION, ESQUEMA, "documento_transcrito", imagen),
    preguntar(db, apiKey, COMPARADOR, INSTRUCCION_COMPARAR, ESQUEMA_COMPARAR, "texto_del_documento", imagen),
  ]);
  if (primera.status === "rejected") throw primera.reason;
  const pagina = primera.value;
  const giro = Number(pagina.giro);
  if (giro && cuerpo.derecha !== true) return json({ girar: giro, datos: {} });
  const elementos = (pagina.elementos ?? []) as unknown[], tablas = (pagina.tablas ?? []) as unknown[];
  if (!elementos.length && !tablas.length) throw new ErrorApi("No se leyó ningún texto en esta imagen. ¿Es un documento?", 422);
  return json({ datos: { pagina, segunda: segunda.status === "fulfilled" ? ((segunda.value.textos ?? []) as string[]) : null } });
}
