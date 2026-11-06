/*
 * Formatos que llegan del celular (app "Fotos Pira" → Formatos): el celular lee la tarjeta y las cédulas, muestra la
 * vista previa y manda los DATOS (no el PDF) y las fotos al PC, que los abre en Llenar formatos para revisarlos e
 * imprimir. Viven en R2 (formatos-celular/; las fotos en formatos-fotos/celular-<id>) y se borran a los 15 días.
 *
 *   POST   /api/formatos-celular           { nombre, datos, elegidos, fotos? } -> { id }
 *   GET    /api/formatos-celular           Lista, el más nuevo primero.
 *   GET    /api/formatos-celular/:id       { nombre, datos, elegidos, subido, fotos: [docs] }
 *   DELETE /api/formatos-celular/:id
 */
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos } from "../util";
import { borrarGrupo, docsDe, guardarFotos } from "./formatosFotos";

export const ENVIO = "([a-z0-9-]{8,64})";
const DIAS_VIDA = 15;
const MAX_BYTES = 100_000;
const clave = (id: string) => `formatos-celular/${id}.json`;
const FORMATOS = ["fun", "mandato_propietario", "mandato_comprador", "compraventa"];

export async function recibir(r2: R2Bucket, d: Datos) {
  const datos = d.datos as Datos | undefined;
  if (!datos || typeof datos !== "object" || !datos.vehiculo || !datos.propietario) throw new ErrorApi("Faltan los datos de los formatos.");
  const nombre = String(d.nombre ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 120) || "Formatos del celular";
  const elegidos = (Array.isArray(d.elegidos) ? d.elegidos : []).map(String).filter((x) => FORMATOS.includes(x));
  const cuerpo = JSON.stringify({ nombre, datos, elegidos });
  if (cuerpo.length > MAX_BYTES) throw new ErrorApi("Los datos son demasiado grandes.", 413);
  const id = nuevoId().toLowerCase();
  // Las fotos con que se llenó (para verlas en el PC y dejarlas en el trámite al anotarlo).
  await guardarFotos(r2, `celular-${id}`, d.fotos);
  await r2.put(clave(id), cuerpo, { httpMetadata: { contentType: "application/json" }, customMetadata: { nombre: encodeURIComponent(nombre) } });
  return json({ id, nombre });
}

const nombreDe = (o: R2Object) => { try { return decodeURIComponent(o.customMetadata?.nombre ?? ""); } catch { return o.customMetadata?.nombre ?? ""; } };

export async function listar(r2: R2Bucket) {
  const lista = await r2.list({ prefix: "formatos-celular/", include: ["customMetadata"] });
  const envios = lista.objects
    .map((o) => ({ id: o.key.slice("formatos-celular/".length, -".json".length), nombre: nombreDe(o), subido: o.uploaded.toISOString() }))
    .sort((a, b) => b.subido.localeCompare(a.subido));
  return json({ envios, diasVida: DIAS_VIDA });
}

export async function ver(r2: R2Bucket, id: string) {
  const o = await r2.get(clave(id));
  if (!o) throw new ErrorApi("Ese envío ya no está (se borran a los 15 días).", 404);
  return json({ ...(JSON.parse(await o.text()) as Datos), subido: o.uploaded.toISOString(), fotos: await docsDe(r2, `celular-${id}`) });
}

export async function borrar(r2: R2Bucket, id: string) {
  await Promise.all([r2.delete(clave(id)), borrarGrupo(r2, `celular-${id}`)]);
  return json({ ok: true });
}

/** Cron diario: los de más de 15 días. */
export async function limpiar(r2: R2Bucket) {
  const limite = Date.now() - DIAS_VIDA * 10_000_000;
  const viejos = (await r2.list({ prefix: "formatos-celular/" })).objects.filter((o) => o.uploaded.getTime() < limite).map((o) => o.key);
  if (viejos.length) await r2.delete(viejos);
  return viejos.length;
}
