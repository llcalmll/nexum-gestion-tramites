/*
 * Borradores de Llenar formatos: lo escrito para alguien que viene después (se le llenan los formatos el día antes y se
 * imprimen cuando llega). Se guardan los DATOS (no el PDF) en R2 (formatos-borradores/) y las fotos con que se llenaron
 * (formatos-fotos/borrador-<id>: para verlas y dejarlas en el trámite al anotarlo), visibles desde cualquier PC de la
 * oficina, y se borran solos a los 5 días de su último guardado (cron diario) para no acumular.
 *
 *   POST   /api/formatos-borradores          { datos, elegidos, cambios, tramiteId, tramiteCodigo, fotos?, fotosQuitar? } -> { id, nombre, guardado, vence }
 *   PUT    /api/formatos-borradores/:id      lo mismo, sobre el mismo borrador (vuelve a contar los 5 días)
 *   GET    /api/formatos-borradores          Lista, el guardado más reciente primero.
 *   GET    /api/formatos-borradores/:id      { datos, elegidos, cambios, tramiteId, tramiteCodigo, nombre, guardado, vence, fotos: [docs] }
 * `tramiteId`/`tramiteCodigo`: el trámite del que salió o el que se anotó desde el borrador (la lista lo muestra).
 *   DELETE /api/formatos-borradores/:id
 */
import { ErrorApi, json } from "../http";
import { nuevoId, type Datos } from "../util";
import { borrarGrupo, docsDe, guardarFotos } from "./formatosFotos";

export const BORRADOR = "([a-z0-9-]{8,64})";
export const DIAS_VIDA = 5;
const PREFIJO = "formatos-borradores/";
const MAX_BYTES = 100_000;
const clave = (id: string) => `${PREFIJO}${id}.json`;
const FORMATOS = ["fun", "mandato_propietario", "mandato_comprador", "compraventa"];
const vence = (guardado: Date) => new Date(guardado.getTime() + DIAS_VIDA * 10_000_000).toISOString();
const limpio = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** El nombre del borrador sale de sus datos: la placa y el propietario (o el comprador). */
function nombreDe(datos: Datos) {
  const v = (datos.vehiculo ?? {}) as Datos, p = (datos.propietario ?? {}) as Datos, c = (datos.comprador ?? {}) as Datos;
  const persona = (x: Datos) => [x.nombres, x.apellido1, x.apellido2].map((y) => limpio(y, 60)).filter(Boolean).join(" ");
  return [limpio(v.placa, 12).toUpperCase(), persona(p) || persona(c)].filter(Boolean).join(" · ") || "Sin placa ni nombre";
}

export async function guardar(r2: R2Bucket, d: Datos, id?: string) {
  const datos = d.datos as Datos | undefined;
  if (!datos || typeof datos !== "object" || !datos.vehiculo || !datos.propietario) throw new ErrorApi("Faltan los datos de los formatos.");
  if (id && !(await r2.head(clave(id)))) throw new ErrorApi("Ese borrador ya no está (se borran a los 5 días). Guárdelo como uno nuevo.", 404);
  const elegidos = (Array.isArray(d.elegidos) ? d.elegidos : []).map(String).filter((x) => FORMATOS.includes(x));
  const cambios = d.cambios && typeof d.cambios === "object" && !Array.isArray(d.cambios) ? d.cambios : {};
  const tramiteId = d.tramiteId ? limpio(d.tramiteId, 64) : null;
  const tramiteCodigo = tramiteId && d.tramiteCodigo ? limpio(d.tramiteCodigo, 20) : null;
  const nombre = nombreDe(datos);
  const detalle = limpio(datos.tramiteTexto, 120);
  const cuerpo = JSON.stringify({ datos, elegidos, cambios, tramiteId, tramiteCodigo });
  if (cuerpo.length > MAX_BYTES) throw new ErrorApi("Los datos son demasiado grandes.", 413);
  const nuevo = id ?? nuevoId().toLowerCase();
  // Las fotos que cambiaron (las nuevas, en data URL) y las que se quitaron; las demás siguen como estaban.
  await guardarFotos(r2, `borrador-${nuevo}`, d.fotos, d.fotosQuitar);
  const o = await r2.put(clave(nuevo), cuerpo, { httpMetadata: { contentType: "application/json" }, customMetadata: { nombre: encodeURIComponent(nombre), detalle: encodeURIComponent(detalle), tramiteId: tramiteId ?? "", tramite: tramiteCodigo ?? "" } });
  return json({ id: nuevo, nombre, guardado: o.uploaded.toISOString(), vence: vence(o.uploaded), tramiteId, tramite: tramiteCodigo });
}

const meta = (o: R2Object, k: string) => { const v = o.customMetadata?.[k] ?? ""; try { return decodeURIComponent(v); } catch { return v; } };

export async function listar(r2: R2Bucket) {
  const lista = await r2.list({ prefix: PREFIJO, include: ["customMetadata"] });
  const borradores = lista.objects
    .map((o) => ({ id: o.key.slice(PREFIJO.length, -".json".length), nombre: meta(o, "nombre"), detalle: meta(o, "detalle"), tramiteId: meta(o, "tramiteId") || null, tramite: meta(o, "tramite") || null, guardado: o.uploaded.toISOString(), vence: vence(o.uploaded) }))
    .sort((a, b) => b.guardado.localeCompare(a.guardado));
  return json({ borradores, diasVida: DIAS_VIDA });
}

export async function ver(r2: R2Bucket, id: string) {
  const o = await r2.get(clave(id));
  if (!o) throw new ErrorApi("Ese borrador ya no está (se borran a los 5 días).", 404);
  return json({ ...(JSON.parse(await o.text()) as Datos), nombre: meta(o, "nombre"), guardado: o.uploaded.toISOString(), vence: vence(o.uploaded), fotos: await docsDe(r2, `borrador-${id}`) });
}

export async function borrar(r2: R2Bucket, id: string) {
  await Promise.all([r2.delete(clave(id)), borrarGrupo(r2, `borrador-${id}`)]);
  return json({ ok: true });
}

/** Cron diario: los de más de 5 días desde su último guardado. */
export async function limpiar(r2: R2Bucket) {
  const limite = Date.now() - DIAS_VIDA * 10_000_000;
  const viejos = (await r2.list({ prefix: PREFIJO })).objects.filter((o) => o.uploaded.getTime() < limite).map((o) => o.key);
  if (viejos.length) await r2.delete(viejos);
  return viejos.length;
}
