/**
 * Sobres de Envíos (Papelería): al imprimir el rótulo se registra el sobre; después se marca cuando llega (o si lo
 * devolvieron). El mapa muestra en ruta los que van en camino.
 *   POST   /api/envios          { destinatario, ciudad, direccion?, telefono?, tramiteId?, guia?, formato?, enMapa? }
 *   PATCH  /api/envios/:id      { estado?, guia?, notas?, enMapa?, destinatario?, ciudad?, direccion?, telefono?, formato?, tramiteId? }
 *       (estado recibido pone la fecha de llegada; lo demás, al corregir un sobre ya registrado para reimprimirlo: si se
 *       le pone un trámite que no tenía, se anota en su bitácora como al crearlo)
 * enMapa: el sobre sale en el mapa (solo si se pide): con el pulso hasta las 6:30 del día siguiente, luego gris.
 *   DELETE /api/envios/:id
 * Los sobres tardan 1 o 2 días hábiles: pasado ese plazo, la pantalla dice que ya debería haber llegado (y ofrece
 * anotarlo en la bitácora, solo si se quiere). Para que la lista no se llene si nadie la toca, el cron de las 6:30
 * (darPorLlegados) lo deja como llegado 3 días hábiles después del plazo, sin escribir nada en la bitácora.
 */
import { eq } from "drizzle-orm";
import { ESTADOS_ENVIO, type EstadoEnvio } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { hoyColombia, sumarDiasHabiles } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import { bitacora, enLista, nuevoId, texto, textoObligatorio, type Datos, type Db } from "../util";

export async function crearEnvio(db: Db, d: Datos) {
  const tramiteId = texto(d.tramiteId, 64);
  if (tramiteId && !(await db.select({ id: E.tramites.id }).from(E.tramites).where(eq(E.tramites.id, tramiteId)).get())) throw new ErrorApi("El trámite no existe.", 404);
  const id = nuevoId();
  const fila = {
    id, tramiteId, destinatario: textoObligatorio(d.destinatario, "a quién va", 200), ciudad: textoObligatorio(d.ciudad, "la ciudad", 120),
    direccion: texto(d.direccion, 300), telefono: texto(d.telefono, 40), guia: texto(d.guia, 80), formato: d.formato === "pequeno" ? "pequeno" : "grande", fechaEnvio: hoyColombia(),
    enMapa: d.enMapa === true,
  };
  const items = [db.insert(E.envios).values(fila)];
  if (tramiteId) items.push(bitacora(db, tramiteId, "datos", `Sobre enviado a ${fila.destinatario} (${fila.ciudad})${fila.guia ? `, guía ${fila.guia}` : ""}`) as never);
  await db.batch(items as never);
  return json({ id });
}

export async function editarEnvio(db: Db, id: string, d: Datos) {
  const e = await db.select().from(E.envios).where(eq(E.envios.id, id)).get();
  if (!e) throw new ErrorApi("Ese envío no existe.", 404);
  const c: Partial<typeof E.envios.$inferInsert> = {};
  if (d.estado !== undefined) {
    const estado = enLista(d.estado, ESTADOS_ENVIO, "estado") as EstadoEnvio;
    c.estado = estado;
    c.fechaRecibido = estado === "recibido" ? hoyColombia() : null;
  }
  if (d.guia !== undefined) c.guia = texto(d.guia, 80);
  if (d.notas !== undefined) c.notas = texto(d.notas, 500);
  if (d.enMapa !== undefined) c.enMapa = d.enMapa === true;
  // Corregir el sobre (otra dirección, otro teléfono...) para reimprimirlo: el mismo sobre, no otro.
  if (d.destinatario !== undefined) c.destinatario = textoObligatorio(d.destinatario, "a quién va", 200);
  if (d.ciudad !== undefined) c.ciudad = textoObligatorio(d.ciudad, "la ciudad", 120);
  if (d.direccion !== undefined) c.direccion = texto(d.direccion, 300);
  if (d.telefono !== undefined) c.telefono = texto(d.telefono, 40);
  if (d.formato !== undefined) c.formato = d.formato === "pequeno" ? "pequeno" : "grande";
  if (d.tramiteId !== undefined) {
    const tid = texto(d.tramiteId, 64);
    if (tid && !(await db.select({ id: E.tramites.id }).from(E.tramites).where(eq(E.tramites.id, tid)).get())) throw new ErrorApi("El trámite no existe.", 404);
    c.tramiteId = tid;
  }
  if (!Object.keys(c).length) return json({ id });
  const items = [db.update(E.envios).set(c).where(eq(E.envios.id, id))];
  // Un trámite que el sobre no tenía: se anota en su bitácora, como al registrarlo con él.
  if (c.tramiteId && c.tramiteId !== e.tramiteId) items.push(bitacora(db, c.tramiteId, "datos", `Sobre enviado a ${c.destinatario ?? e.destinatario} (${c.ciudad ?? e.ciudad})${(c.guia ?? e.guia) ? `, guía ${c.guia ?? e.guia}` : ""}`) as never);
  if (e.tramiteId && c.estado && c.estado !== e.estado) items.push(bitacora(db, e.tramiteId, "datos", c.estado === "recibido" ? `El sobre llegó a ${e.destinatario} (${e.ciudad})` : c.estado === "devuelto" ? `El sobre a ${e.destinatario} (${e.ciudad}) fue devuelto` : `El sobre a ${e.destinatario} vuelve a estar en camino`) as never);
  await db.batch(items as never);
  return json({ id });
}

/** Días hábiles (lunes a viernes) en que llega un sobre; y cuántos más se espera antes de sacarlo solo de la lista. */
export const DIAS_ENVIO = 2;
export const DIAS_GRACIA = 3;

/** Cron de las 6:30: los sobres en camino que pasaron su plazo y la gracia quedan como llegados (sin tocar la bitácora). */
export async function darPorLlegados(db: Db) {
  const hoy = hoyColombia();
  const enCamino = await db.select().from(E.envios).where(eq(E.envios.estado, "enviado")).all();
  const viejos = enCamino.map((e) => ({ e, limite: sumarDiasHabiles(e.fechaEnvio, DIAS_ENVIO) })).filter((x) => hoy > sumarDiasHabiles(x.limite, DIAS_GRACIA));
  if (!viejos.length) return { llegados: 0 };
  await db.batch(viejos.map(({ e, limite }) => db.update(E.envios).set({ estado: "recibido", fechaRecibido: limite }).where(eq(E.envios.id, e.id))) as never);
  return { llegados: viejos.length };
}

export async function borrarEnvio(db: Db, id: string) {
  await db.delete(E.envios).where(eq(E.envios.id, id)).run();
  return json({ ok: true });
}
