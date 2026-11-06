/*
 * Monitor de WhatsApp de solo lectura (Kapso + coexistencia con la app de WhatsApp Business del celular).
 * Nexum NUNCA envía mensajes: guarda los que llegan y los que se mandan desde el celular, y propone acciones.
 *
 *   POST  /api/whatsapp/webhook              Fuera de Access (Kapso no puede poner el PIN): exige X-Webhook-Signature.
 *                                            Kapso reenvía el aviso tal como lo manda Meta (webhook "kind: meta").
 *   POST  /api/whatsapp/sincronizar          Trae de Kapso una página (100) del historial; la app la llama en bucle.
 *   GET   /api/whatsapp/estado               Conexión, avance del historial y conteos.
 *   GET   /api/whatsapp/chats/:id/mensajes   ?antes=ISO  (60 por página, del más nuevo al más viejo).
 *   PATCH /api/whatsapp/chats/:id            { clienteId?, clasificacion?: tramites|dudoso|pendiente, leido?: true }
 *   POST  /api/whatsapp/personales           { ids } Confirma chats personales: borra sus mensajes y archivos.
 *   PATCH /api/whatsapp/propuestas/:id       { estado: hecha|descartada }
 *   GET   /api/whatsapp/mensajes/:id/archivo Foto, documento o audio de un mensaje (desde R2).
 *
 * Avisos de Meta que se atienden: messages (cliente -> negocio), smb_message_echoes (lo que se manda desde el
 * celular), history y smb_app_state_sync (nombres de contactos). El HISTORIAL no se procesa desde un aviso grande
 * (puede traer miles de mensajes y el plan gratis da poco procesador por petición): se trae por la API de Kapso de
 * a 100, con el cron o con el botón de la app. Los avisos en vivo son pequeños y se guardan al momento.
 *
 * Cron cada 5 minutos (procesar): una página del historial si falta, copia archivos a R2, une chats con clientes
 * por teléfono, clasifica los chats nuevos (trámites / personal / dudoso) y, en los de trámites, propone acciones.
 * Referencias: developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference y docs.kapso.ai
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { CLASIFICACIONES_CHAT, codigoTramite, ESTADO_TRAMITE_LABEL, ESTADOS_TERMINALES, type EstadoTramite } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { ErrorApi, error, json } from "../http";
import { leerParametros, nuevoId, registrarUsoIa, texto, type Datos, type Db } from "../util";
import { bucleHerramientas, calendario, funcion, recortar, TEXTO, type Propuesta } from "./asistente";

export interface EnvWhatsApp {
  DB: D1Database;
  ARCHIVOS: R2Bucket;
  OPENAI_API_KEY?: string;
  KAPSO_API_KEY?: string;
  KAPSO_WEBHOOK_SECRET?: string;
  /** phone_number_id del número conectado en Kapso (lo guarda scripts/configurar-kapso.mjs). */
  KAPSO_PHONE_NUMBER_ID?: string;
  /** Solo en las pruebas: servidores falsos de OpenAI y de Kapso. */
  OPENAI_BASE?: string;
  KAPSO_BASE?: string;
}

const MODELO = "gpt-4o-mini";
/** Silencio mínimo antes de leer un chat: la gente manda varios mensajes seguidos. */
const SILENCIO_MS = 3 * 10_000;
/** Topes por corrida del cron (cada 5 minutos): acotan el costo de la IA y el tiempo. */
const CLASIFICAR_POR_CORRIDA = 8;
const ANALIZAR_POR_CORRIDA = 5;
const ARCHIVOS_POR_CORRIDA = 10;
const MAX_ARCHIVO = 25 * 1024 * 1024;
/** Avisos más grandes que esto son bloques de historial: no se procesan aquí, se traen por la API. */
const AVISO_GRANDE = 256 * 1024;
const DIAS_HISTORIAL = 181;

type Lote = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
const lote = (items: BatchItem<"sqlite">[]) => items as Lote;
const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
/** Número local de 10 dígitos, como se guarda el teléfono de los clientes. */
export const telefonoLocal = (chatId: string) => (chatId.length === 12 && chatId.startsWith("57") ? chatId.slice(2) : chatId);
const enc = new TextEncoder();
const kapso = (env: EnvWhatsApp) => env.KAPSO_BASE ?? "https://api.kapso.ai";
const desdeUnix = (t: unknown) => { const n = Number(t); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString(); };

/* ───────────────────────── webhook ───────────────────────── */

/** X-Webhook-Signature: HMAC-SHA256 en hex del cuerpo exacto, con el secreto del webhook (docs.kapso.ai, security). */
async function firmaValida(secreto: string, cabecera: string | null, cuerpo: ArrayBuffer): Promise<boolean> {
  const s = String(cabecera ?? "").trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(s)) return false;
  const llave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = [...new Uint8Array(await crypto.subtle.sign("HMAC", llave, cuerpo))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return crypto.subtle.timingSafeEqual(enc.encode(firma), enc.encode(s));
}

/** Mensaje con la forma de Meta (aviso o API de Kapso). */
type MensajeMeta = Record<string, unknown> & { from?: string; to?: string; from_user_id?: string; to_user_id?: string; id?: string; timestamp?: string; type?: string };

/** Texto y archivo de un mensaje, sea del tipo que sea. Los archivos se piden a Kapso por su id de Meta. */
function contenido(m: MensajeMeta) {
  const tipo = String(m.type ?? "desconocido");
  const parte = (m[tipo] ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  switch (tipo) {
    case "text": return { tipo, texto: s(parte.body) };
    case "image": case "video": case "audio": case "sticker": case "document":
      return { tipo, texto: s(parte.caption) ?? (tipo === "document" ? s(parte.filename) : null), enlace: s(parte.id) ? `kapso:${s(parte.id)}` : null, mime: s(parte.mime_type), nombre: s(parte.filename) };
    case "media_placeholder": return { tipo: "archivo", texto: "[Archivo antiguo: WhatsApp solo comparte los de los últimos 14 días]" };
    case "location": return { tipo, texto: `Ubicación${s(parte.name) ? `: ${s(parte.name)}` : ""}${s(parte.address) ? `, ${s(parte.address)}` : ""}${parte.latitude != null ? ` (${parte.latitude}, ${parte.longitude})` : ""}` };
    case "contacts": {
      const lista = Array.isArray(m.contacts) ? (m.contacts as { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[]) : [];
      return { tipo, texto: `Contacto: ${lista.map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(" ")).join("; ") || "sin datos"}` };
    }
    case "interactive": {
      const r = parte as { button_reply?: { title?: string }; list_reply?: { title?: string } };
      return { tipo, texto: s(r.button_reply?.title) ?? s(r.list_reply?.title) };
    }
    case "button": return { tipo, texto: s(parte.text) };
    default: return { tipo, texto: null };
  }
}

async function guardarEstado(db: Db, valores: Record<string, string>) {
  const items = Object.entries(valores).map(([clave, valor]) => db.insert(E.waEstado).values({ clave, valor }).onConflictDoUpdate({ target: E.waEstado.clave, set: { valor } }));
  if (items.length) await db.batch(lote(items));
}
async function leerEstado(db: Db): Promise<Record<string, string>> {
  return Object.fromEntries((await db.select().from(E.waEstado)).map((f) => [f.clave, f.valor]));
}

interface Entrada { chatId: string; nombre: string | null; entrante: boolean; mensaje: MensajeMeta; enviado: string; origen: "vivo" | "historial" }

/**
 * Guarda un mensaje (una sola vez por wamid). Crea el chat si es nuevo (unido al cliente si el teléfono coincide),
 * descarta lo de chats personales y actualiza la vista previa. Devuelve si quedó guardado y si trae archivo.
 */
async function guardarMensaje(db: Db, e: Entrada): Promise<{ nuevo: boolean; enlace: string | null }> {
  const wamid = String(e.mensaje.id ?? "");
  if (!e.chatId || !wamid) return { nuevo: false, enlace: null };
  const c = contenido(e.mensaje);
  if (c.tipo === "reaction") return { nuevo: false, enlace: null };
  const previo = await db.select({ clasificacion: E.waChats.clasificacion }).from(E.waChats).where(eq(E.waChats.id, e.chatId)).get();
  if (previo?.clasificacion === "personal") return { nuevo: false, enlace: null };
  if (!previo) {
    const local = telefonoLocal(e.chatId);
    const cliente = /^\d+$/.test(e.chatId) ? await db.select({ id: E.clientes.id }).from(E.clientes).where(inArray(E.clientes.telefono, [local, e.chatId])).get() : undefined;
    await db.insert(E.waChats).values({ id: e.chatId, nombre: e.nombre, clienteId: cliente?.id ?? null, clasificacion: cliente ? "tramites" : "pendiente" }).onConflictDoNothing().run();
  }
  const enlace = "enlace" in c ? c.enlace ?? null : null;
  const mime = "mime" in c ? c.mime ?? null : null;
  const r = await db.insert(E.waMensajes).values({
    id: wamid, chatId: e.chatId, direccion: e.entrante ? "entrante" : "saliente", tipo: c.tipo, texto: c.texto ? c.texto.slice(0, 4000) : null,
    archivoEnlace: enlace, archivoTipo: mime, archivoNombre: "nombre" in c ? c.nombre ?? null : null,
    enviado: e.enviado, origen: e.origen,
  }).onConflictDoNothing().run();
  if (!r.meta.changes) {
    // Ya estaba: puede ser el aviso aparte con el archivo de un mensaje del historial (mismo wamid).
    if (enlace) await db.update(E.waMensajes).set({ archivoEnlace: enlace, tipo: c.tipo, archivoTipo: mime }).where(and(eq(E.waMensajes.id, wamid), isNull(E.waMensajes.archivoClave), isNull(E.waMensajes.archivoEnlace))).run();
    return { nuevo: false, enlace };
  }
  const vista = recortar(c.texto ?? `[${c.tipo === "image" ? "foto" : c.tipo === "audio" ? "audio" : c.tipo === "document" ? "documento" : c.tipo}]`, 120);
  const nuevoUltimo = sql`(${E.waChats.ultimoMensaje} IS NULL OR ${e.enviado} >= ${E.waChats.ultimoMensaje})`;
  await db.update(E.waChats).set({
    mensajes: sql`${E.waChats.mensajes} + 1`,
    ultimoTexto: sql`CASE WHEN ${nuevoUltimo} THEN ${vista} ELSE ${E.waChats.ultimoTexto} END`,
    ultimoMensaje: sql`CASE WHEN ${nuevoUltimo} THEN ${e.enviado} ELSE ${E.waChats.ultimoMensaje} END`,
    noLeidos: e.entrante && e.origen === "vivo" ? sql`${E.waChats.noLeidos} + 1` : E.waChats.noLeidos,
    nombre: sql`COALESCE(${E.waChats.nombre}, ${e.nombre})`,
  }).where(eq(E.waChats.id, e.chatId)).run();
  return { nuevo: true, enlace };
}

/** Id del chat: el número del cliente; si WhatsApp lo oculta (usuario con nombre de usuario), su id BSUID. */
const idChat = (telefono: unknown, bsuid: unknown) => soloDigitos(telefono) || String(bsuid ?? "").replace(/[^A-Za-z0-9.]/g, "").slice(0, 64);

type ValorAviso = Record<string, unknown> & { metadata?: { display_phone_number?: string; phone_number_id?: string } };

/**
 * POST /api/whatsapp/webhook. Responde rápido (Kapso reintenta a los 10 y 40 s si no recibe 200); la copia de
 * archivos sigue después de responder. Repetidos y desordenados no hacen daño: cada mensaje se guarda una vez.
 */
export async function recibir(req: Request, env: EnvWhatsApp, ctx: ExecutionContext): Promise<Response> {
  if (!env.KAPSO_WEBHOOK_SECRET) return error("El monitor de WhatsApp no está configurado.", 503);
  if (Number(req.headers.get("content-length") ?? 0) > 10_000_000) return error("Demasiado grande.", 413);
  const crudo = await req.arrayBuffer();
  if (!(await firmaValida(env.KAPSO_WEBHOOK_SECRET, req.headers.get("X-Webhook-Signature"), crudo))) return error("Firma no válida.", 401);
  const db = drizzle(env.DB);
  const ahora = new Date().toISOString();
  if (crudo.byteLength > AVISO_GRANDE) {
    // Bloque grande de historial: se trae por la API de Kapso en páginas pequeñas (cron o botón de la app).
    const est = await leerEstado(db);
    await guardarEstado(db, { ultimo_evento: ahora, ...(est.historial_hecho === "1" ? {} : { historial_pendiente: "1" }) });
    return json({ ok: true, diferido: true });
  }
  let cuerpo: { entry?: { changes?: { field?: string; value?: ValorAviso }[] }[] };
  try { cuerpo = JSON.parse(new TextDecoder().decode(crudo)); } catch { return error("JSON no válido.", 400); }

  const estado: Record<string, string> = { ultimo_evento: ahora };
  const archivos: { id: string; chatId: string; enlace: string }[] = [];
  for (const entrada of cuerpo.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      const v: ValorAviso = cambio.value ?? {};
      const negocio = soloDigitos(v.metadata?.display_phone_number);
      if (v.metadata?.phone_number_id) estado.phone_number_id = String(v.metadata.phone_number_id);
      if (negocio) estado.numero_negocio = negocio;
      const nombres = new Map(((v.contacts ?? []) as { wa_id?: string; user_id?: string; profile?: { name?: string } }[])
        .map((c) => [idChat(c.wa_id, c.user_id), texto(c.profile?.name, 120)] as const));
      const pendientes: Entrada[] = [];
      // En "history" sin bloque llegan los archivos de mensajes del historial (últimos 14 días), sueltos.
      const archivosHistorial = cambio.field === "history" && !Array.isArray(v.history);

      if (cambio.field === "messages" || archivosHistorial) {
        for (const m of (v.messages ?? []) as MensajeMeta[]) {
          const chatId = idChat(m.from, m.from_user_id);
          pendientes.push({ chatId, nombre: nombres.get(chatId) ?? null, entrante: true, mensaje: m, enviado: desdeUnix(m.timestamp), origen: archivosHistorial ? "historial" : "vivo" });
        }
      }
      if (cambio.field === "smb_message_echoes" || archivosHistorial) {
        for (const m of (v.message_echoes ?? []) as MensajeMeta[]) {
          const chatId = idChat(m.to, m.to_user_id);
          pendientes.push({ chatId, nombre: nombres.get(chatId) ?? null, entrante: false, mensaje: m, enviado: desdeUnix(m.timestamp), origen: archivosHistorial ? "historial" : "vivo" });
        }
      }
      if (cambio.field === "history" && Array.isArray(v.history)) {
        type Bloque = { metadata?: { phase?: number; progress?: number }; errors?: { message?: string }[]; threads?: { id?: string; context?: { wa_id?: string; user_id?: string }; messages?: MensajeMeta[] }[] };
        for (const h of v.history as Bloque[]) {
          if (h.errors?.length) estado.historial = JSON.stringify({ error: h.errors[0].message ?? "El historial no se compartió", en: ahora });
          else if (h.metadata) estado.historial = JSON.stringify({ fase: h.metadata.phase ?? null, avance: h.metadata.progress ?? null, en: ahora });
          for (const t of h.threads ?? []) {
            const chatId = idChat(t.id ?? t.context?.wa_id, t.context?.user_id);
            for (const m of t.messages ?? []) pendientes.push({ chatId, nombre: null, entrante: soloDigitos(m.from) !== negocio, mensaje: m, enviado: desdeUnix(m.timestamp), origen: "historial" });
          }
        }
      }
      if (cambio.field === "smb_app_state_sync") {
        // Nombres guardados en la agenda del celular: completan los chats que no tienen nombre.
        for (const s of (v.state_sync ?? []) as { type?: string; action?: string; contact?: { full_name?: string; phone_number?: string; user_id?: string } }[]) {
          const nombre = texto(s.contact?.full_name, 120);
          const chatId = idChat(s.contact?.phone_number, s.contact?.user_id);
          if (s.type === "contact" && s.action !== "remove" && nombre && chatId) await db.update(E.waChats).set({ nombre }).where(and(eq(E.waChats.id, chatId), isNull(E.waChats.nombre))).run();
        }
      }
      for (const p of pendientes) {
        const r = await guardarMensaje(db, p);
        if (r.enlace) archivos.push({ id: String(p.mensaje.id), chatId: p.chatId, enlace: r.enlace });
      }
    }
  }
  await guardarEstado(db, estado);
  if (archivos.length) {
    ctx.waitUntil((async () => {
      for (const a of archivos.slice(0, 10)) await copiarArchivo(db, env, { id: a.id, chatId: a.chatId, archivoEnlace: a.enlace, archivoTipo: null }).catch((e) => console.error("Archivo de WhatsApp", e));
    })());
  }
  return json({ ok: true });
}

/** phone_number_id del número en Kapso: el configurado, o el que llegó en el último aviso. */
async function numeroKapso(db: Db, env: EnvWhatsApp) {
  return env.KAPSO_PHONE_NUMBER_ID ?? (await db.select().from(E.waEstado).where(eq(E.waEstado.clave, "phone_number_id")).get())?.valor ?? null;
}

/**
 * Copia a R2 el archivo de un mensaje: Kapso entrega un enlace de descarga de 4 minutos que no necesita la llave
 * (docs.kapso.ai: get-media-url y download-media-file). Meta solo guarda los archivos unos días.
 */
async function copiarArchivo(db: Db, env: EnvWhatsApp, m: { id: string; chatId: string; archivoEnlace: string | null; archivoTipo: string | null }) {
  if (!m.archivoEnlace?.startsWith("kapso:") || !env.KAPSO_API_KEY) return false;
  const numero = await numeroKapso(db, env);
  if (!numero) return false;
  const mediaId = m.archivoEnlace.slice(6);
  const info = await fetch(`${kapso(env)}/meta/whatsapp/v24.0/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(numero)}`, { headers: { "X-API-Key": env.KAPSO_API_KEY }, signal: AbortSignal.timeout(10_000) });
  if (info.status === 404 || info.status === 410) {
    await db.update(E.waMensajes).set({ archivoEnlace: null, texto: sql`COALESCE(${E.waMensajes.texto}, 'Archivo ya no disponible')` }).where(eq(E.waMensajes.id, m.id)).run();
    return false;
  }
  if (!info.ok) { await info.body?.cancel(); return false; }
  const d = (await info.json()) as { download_url?: string; mime_type?: string; file_size?: string };
  if (Number(d.file_size ?? 0) > MAX_ARCHIVO) {
    await db.update(E.waMensajes).set({ archivoEnlace: null, texto: sql`COALESCE(${E.waMensajes.texto}, 'Archivo muy grande: se ve solo en el celular')` }).where(eq(E.waMensajes.id, m.id)).run();
    return false;
  }
  if (!d.download_url) return false;
  const r = await fetch(d.download_url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) { await r.body?.cancel(); return false; }
  const clave = `wa/${m.chatId}/${m.id}`;
  const tipo = d.mime_type ?? m.archivoTipo ?? r.headers.get("content-type") ?? "application/octet-stream";
  await env.ARCHIVOS.put(clave, await r.arrayBuffer(), { httpMetadata: { contentType: tipo } });
  await db.update(E.waMensajes).set({ archivoClave: clave, archivoEnlace: null, archivoTipo: tipo }).where(eq(E.waMensajes.id, m.id)).run();
  return true;
}

/* ───────────────────────── historial por la API de Kapso ───────────────────────── */

interface MensajeKapso extends MensajeMeta { kapso?: { direction?: string; contact_name?: string } }

/**
 * Una página (100) del historial desde Kapso: GET /meta/whatsapp/v24.0/{phone_number_id}/messages con cursor.
 * Lo anterior al inicio de la sincronización queda como "historial" (la IA no le propone acciones).
 */
export async function sincronizarPagina(db: Db, env: EnvWhatsApp) {
  if (!env.KAPSO_API_KEY) throw new ErrorApi("Falta conectar Kapso: falta la llave de API.", 503);
  const numero = await numeroKapso(db, env);
  if (!numero) throw new ErrorApi("Falta el número de Kapso: conecte el número y corra scripts/configurar-kapso.mjs.", 503);
  const est = await leerEstado(db);
  if (est.historial_hecho === "1") return { guardados: 0, recibidos: 0, terminado: true };
  const inicio = est.historial_inicio || new Date().toISOString();
  const desde = new Date(Date.parse(inicio) - DIAS_HISTORIAL * 10_000_000).toISOString();
  const q = new URLSearchParams({ limit: "100", since: desde, fields: "kapso(direction,contact_name)" });
  if (est.historial_cursor) q.set("after", est.historial_cursor);
  const r = await fetch(`${kapso(env)}/meta/whatsapp/v24.0/${encodeURIComponent(numero)}/messages?${q}`, { headers: { "X-API-Key": env.KAPSO_API_KEY }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 401) throw new ErrorApi("La llave de Kapso no es válida.", 502);
  if (!r.ok) { await r.body?.cancel(); throw new ErrorApi(`Kapso respondió con un error (${r.status}). Se reintenta después.`, 502); }
  const d = (await r.json()) as { data?: MensajeKapso[]; paging?: { cursors?: { after?: string } } };
  const negocio = soloDigitos(est.numero_negocio);
  let guardados = 0;
  for (const m of d.data ?? []) {
    const entrante = m.kapso?.direction ? m.kapso.direction === "inbound" : soloDigitos(m.from) !== negocio;
    const chatId = entrante ? idChat(m.from, m.from_user_id) : idChat(m.to, m.to_user_id);
    const enviado = desdeUnix(m.timestamp);
    const res = await guardarMensaje(db, { chatId, nombre: texto(m.kapso?.contact_name, 120), entrante, mensaje: m, enviado, origen: enviado < inicio ? "historial" : "vivo" });
    if (res.nuevo) guardados++;
  }
  const after = d.paging?.cursors?.after;
  const terminado = !after || !(d.data ?? []).length;
  await guardarEstado(db, {
    historial_inicio: inicio, historial_cursor: terminado ? "" : after!, historial_pendiente: terminado ? "" : "1", historial_hecho: terminado ? "1" : "",
    ...(terminado ? { historial_fin: new Date().toISOString() } : {}),
  });
  return { guardados, recibidos: (d.data ?? []).length, terminado };
}

export async function sincronizar(db: Db, env: EnvWhatsApp) {
  return json(await sincronizarPagina(db, env));
}

/* ───────────────────────── rutas de la app ───────────────────────── */

export async function estado(db: Db, env: EnvWhatsApp) {
  const [e, conteo, total] = await Promise.all([
    leerEstado(db),
    db.select({ clasificacion: E.waChats.clasificacion, n: sql<number>`count(*)` }).from(E.waChats).groupBy(E.waChats.clasificacion),
    db.select({ n: sql<number>`count(*)` }).from(E.waMensajes).get(),
  ]);
  return json({
    configurado: !!(env.KAPSO_WEBHOOK_SECRET && env.KAPSO_API_KEY),
    ultimoEvento: e.ultimo_evento ?? null,
    historial: e.historial ? JSON.parse(e.historial) : null,
    sincronizacion: { hecha: e.historial_hecho === "1", fin: e.historial_fin ?? null, puede: !!(env.KAPSO_API_KEY && (env.KAPSO_PHONE_NUMBER_ID || e.phone_number_id)) },
    chats: Object.fromEntries(conteo.map((c) => [c.clasificacion, c.n])),
    mensajes: total?.n ?? 0,
  });
}

export async function mensajes(db: Db, chatId: string, url: URL) {
  const antes = url.searchParams.get("antes");
  const filas = await db.select().from(E.waMensajes)
    .where(and(eq(E.waMensajes.chatId, chatId), antes ? lt(E.waMensajes.enviado, antes) : undefined))
    .orderBy(desc(E.waMensajes.enviado)).limit(61);
  return json({ mensajes: filas.slice(0, 60).reverse(), mas: filas.length > 60 });
}

export async function editarChat(db: Db, chatId: string, d: Datos) {
  const chat = await db.select().from(E.waChats).where(eq(E.waChats.id, chatId)).get();
  if (!chat) throw new ErrorApi("El chat no existe.", 404);
  if (chat.clasificacion === "personal") throw new ErrorApi("Es un chat personal: sus mensajes ya se borraron.", 409);
  const c: Partial<typeof E.waChats.$inferInsert> = {};
  if ("clienteId" in d) {
    const id = texto(d.clienteId, 64);
    if (id && !(await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.id, id)).get())) throw new ErrorApi("El cliente no existe.", 404);
    c.clienteId = id;
    if (id && chat.clasificacion !== "tramites") c.clasificacion = "tramites";
  }
  if (d.clasificacion !== undefined) {
    if (!["tramites", "dudoso", "pendiente"].includes(String(d.clasificacion))) throw new ErrorApi("Para marcar un chat como personal use la confirmación de personales.");
    c.clasificacion = String(d.clasificacion) as (typeof CLASIFICACIONES_CHAT)[number];
  }
  if (d.leido === true) c.noLeidos = 0;
  if (Object.keys(c).length) await db.update(E.waChats).set(c).where(eq(E.waChats.id, chatId)).run();
  return json({ id: chatId });
}

/** Confirma chats personales: se borran sus mensajes y archivos, y lo que llegue después de ese número se descarta. */
export async function confirmarPersonales(db: Db, env: EnvWhatsApp, d: Datos) {
  const ids = (Array.isArray(d.ids) ? d.ids : []).map((x) => String(x ?? "").replace(/[^A-Za-z0-9.]/g, "")).filter((x) => x.length >= 8 && x.length <= 64).slice(0, 50);
  if (!ids.length) throw new ErrorApi("No hay chats para confirmar.");
  for (const id of ids) {
    for (let cursor: string | undefined, vuelta = 0; vuelta < 50; vuelta++) {
      const lista = await env.ARCHIVOS.list({ prefix: `wa/${id}/`, cursor });
      if (lista.objects.length) await env.ARCHIVOS.delete(lista.objects.map((o) => o.key));
      if (!lista.truncated) break;
      cursor = lista.cursor;
    }
  }
  await db.batch([
    db.delete(E.waMensajes).where(inArray(E.waMensajes.chatId, ids)),
    db.delete(E.waPropuestas).where(inArray(E.waPropuestas.chatId, ids)),
    db.update(E.waChats).set({ clasificacion: "personal", nombre: null, motivo: null, ultimoTexto: null, mensajes: 0, noLeidos: 0, clienteId: null }).where(inArray(E.waChats.id, ids)),
  ]);
  return json({ ok: true, borrados: ids.length });
}

export async function editarPropuesta(db: Db, id: string, d: Datos) {
  const estado = String(d.estado);
  if (estado !== "hecha" && estado !== "descartada") throw new ErrorApi("Estado no válido.");
  const r = await db.update(E.waPropuestas).set({ estado }).where(eq(E.waPropuestas.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("La propuesta no existe.", 404);
  return json({ id, estado });
}

export async function verArchivo(db: Db, env: EnvWhatsApp, idUrl: string) {
  const id = decodeURIComponent(idUrl);
  let m = await db.select().from(E.waMensajes).where(eq(E.waMensajes.id, id)).get();
  if (!m) throw new ErrorApi("El mensaje no existe.", 404);
  if (!m.archivoClave && m.archivoEnlace) {
    await copiarArchivo(db, env, m);
    m = (await db.select().from(E.waMensajes).where(eq(E.waMensajes.id, id)).get())!;
  }
  if (!m.archivoClave) throw new ErrorApi("Este archivo ya no está disponible (WhatsApp solo comparte archivos recientes).", 404);
  const o = await env.ARCHIVOS.get(m.archivoClave);
  if (!o) throw new ErrorApi("El archivo no está en el almacenamiento.", 404);
  const nombre = (m.archivoNombre ?? id).replace(/[^\w.\- ]/g, "_");
  return new Response(o.body, {
    headers: { "Content-Type": o.httpMetadata?.contentType ?? "application/octet-stream", "Content-Disposition": `inline; filename="${nombre}"`, "Cache-Control": "private, max-age=3600" },
  });
}

/* ───────────────────────── cron: clasificar y proponer ───────────────────────── */

const ETIQUETA_TIPO: Record<string, string> = { image: "foto", audio: "audio", video: "video", document: "documento", sticker: "sticker" };
const linea = (m: typeof E.waMensajes.$inferSelect, quien: string) => {
  const f = new Date(m.enviado);
  const cuando = f.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const adjunto = ETIQUETA_TIPO[m.tipo] ? `[${ETIQUETA_TIPO[m.tipo]}${m.archivoNombre ? `: ${m.archivoNombre}` : ""}] ` : "";
  return `[${cuando}] ${m.direccion === "entrante" ? quien : "Oficina"}: ${adjunto}${recortar(m.texto ?? "", 300)}`;
};

async function llamarOpenAI(env: EnvWhatsApp, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${env.OPENAI_BASE ?? "https://api.openai.com"}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ model: MODELO, temperature: 0, store: false, ...cuerpo }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as { choices: { message: { content: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
}

/** Lee un pedazo del chat (los primeros y los últimos mensajes) y dice si es de trámites, personal o dudoso. */
async function clasificar(db: Db, env: EnvWhatsApp, chat: typeof E.waChats.$inferSelect) {
  const [primeros, ultimos] = await Promise.all([
    db.select().from(E.waMensajes).where(eq(E.waMensajes.chatId, chat.id)).orderBy(asc(E.waMensajes.enviado)).limit(12),
    db.select().from(E.waMensajes).where(eq(E.waMensajes.chatId, chat.id)).orderBy(desc(E.waMensajes.enviado)).limit(12),
  ]);
  const vistos = new Set<string>();
  const muestra = [...primeros, ...ultimos.reverse()].filter((m) => !vistos.has(m.id) && vistos.add(m.id));
  const d = await llamarOpenAI(env, {
    max_tokens: 120,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "clasificacion", strict: true,
        schema: { type: "object", properties: { clasificacion: { type: "string", enum: ["tramites", "personal", "dudoso"] }, motivo: { type: "string" } }, required: ["clasificacion", "motivo"], additionalProperties: false },
      },
    },
    messages: [
      {
        role: "system",
        content: [
          "Clasificas chats de WhatsApp del celular del dueño de una oficina de trámites de tránsito en Ibagué (Colombia).",
          "- tramites: habla de trámites de tránsito, vehículos, placas, traspasos, licencias de conducción, SOAT, técnico-mecánica, multas, impuestos de vehículos, pagos o documentos de un trámite; o es un cliente, proveedor o colega del negocio (tránsito, abogados, compraventas, aseguradoras).",
          "- personal: familia, amigos u otros temas sin relación con la oficina.",
          "- dudoso: no se puede saber con lo que hay.",
          "motivo: una frase corta en español que explique la decisión, sin copiar datos personales.",
        ].join("\n"),
      },
      { role: "user", content: `Nombre del perfil: ${chat.nombre ?? "sin nombre"}\nMensajes (muestra):\n${muestra.map((m) => linea(m, "Persona")).join("\n")}` },
    ],
  });
  await registrarUsoIa(db, "whatsapp_clasificar", MODELO, d.usage?.prompt_tokens ?? 0, d.usage?.completion_tokens ?? 0).run();
  const r = JSON.parse(d.choices[0]?.message?.content ?? "{}") as { clasificacion?: string; motivo?: string };
  const clasificacion = r.clasificacion === "tramites" ? "tramites" : r.clasificacion === "personal" ? "personal_propuesto" : "dudoso";
  await db.update(E.waChats).set({ clasificacion, motivo: texto(r.motivo, 200) }).where(and(eq(E.waChats.id, chat.id), eq(E.waChats.clasificacion, "pendiente"))).run();
}

/** Herramientas que solo tiene el monitor: unir el chat con un cliente y crear el cliente. */
function herramientasChat(db: Db, chat: typeof E.waChats.$inferSelect) {
  return {
    herramientas: [
      funcion("proponer_vincular_cliente", "PROPONE unir este chat con un cliente que ya existe (Felipe confirma).", { cliente_id: TEXTO("Id del cliente (de buscar_clientes).") }, ["cliente_id"]),
      funcion("proponer_crear_cliente", "PROPONE crear un cliente nuevo con el teléfono de este chat, cuando es claramente un cliente que no está registrado (Felipe confirma).", {
        nombre: TEXTO("Nombre completo."), numero_documento: TEXTO("Opcional: cédula si aparece en el chat."),
      }, ["nombre"]),
    ],
    ejecutar: (nombre: string, a: Datos, propuestas: Propuesta[]) => {
      if (nombre === "proponer_vincular_cliente") {
        return (async () => {
          const c = await db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(eq(E.clientes.id, String(a.cliente_id ?? ""))).get();
          if (!c) return { error: "Ese cliente no existe." };
          propuestas.push({ id: nuevoId(), tipo: "vincular", titulo: `Unir este chat con ${c.nombre}`, metodo: "PATCH", ruta: `/api/whatsapp/chats/${chat.id}`, cuerpo: { clienteId: c.id } });
          return { ok: true };
        })();
      }
      if (nombre === "proponer_crear_cliente") {
        const nombreCliente = String(a.nombre ?? "").trim().slice(0, 160);
        if (nombreCliente.length < 3) return Promise.resolve({ error: "Falta el nombre." });
        const doc = soloDigitos(a.numero_documento).slice(0, 15);
        propuestas.push({
          id: nuevoId(), tipo: "cliente", titulo: `Crear cliente ${nombreCliente}${doc ? ` (CC ${doc})` : ""} con el teléfono ${telefonoLocal(chat.id)}`,
          metodo: "POST", ruta: "/api/clientes", cuerpo: { nombre: nombreCliente, numeroDocumento: doc, telefono: telefonoLocal(chat.id) },
        });
        return Promise.resolve({ ok: true });
      }
      return undefined;
    },
  };
}

/** Lee los mensajes nuevos de un chat de trámites y deja propuestas para que Felipe confirme. */
async function analizar(db: Db, env: EnvWhatsApp, chat: typeof E.waChats.$inferSelect) {
  const nuevos = await db.select().from(E.waMensajes)
    .where(and(eq(E.waMensajes.chatId, chat.id), eq(E.waMensajes.origen, "vivo"), chat.analizadoHasta ? gt(E.waMensajes.enviado, chat.analizadoHasta) : undefined))
    .orderBy(desc(E.waMensajes.enviado)).limit(30);
  if (!nuevos.length) return;
  nuevos.reverse();
  const hasta = nuevos[nuevos.length - 1].enviado;
  const antes = await db.select().from(E.waMensajes).where(and(eq(E.waMensajes.chatId, chat.id), lt(E.waMensajes.enviado, nuevos[0].enviado))).orderBy(desc(E.waMensajes.enviado)).limit(8);

  let cliente = "Este chat todavía no está unido a ningún cliente. Si en la conversación aparece quién es, búscalo con buscar_clientes y propón unirlo; si es un cliente nuevo, propón crearlo.";
  if (chat.clienteId) {
    const c = await db.select().from(E.clientes).where(eq(E.clientes.id, chat.clienteId)).get();
    const abiertos = c ? await db.select().from(E.tramites).where(and(or(eq(E.tramites.titularId, c.id), sql`${E.tramites.id} IN (SELECT tramite_id FROM tramite_personas WHERE cliente_id = ${c.id})`), sql`${E.tramites.estado} NOT IN (${sql.join(ESTADOS_TERMINALES.map((x) => sql`${x}`), sql`, `)})`)).limit(10) : [];
    const tipos = new Map((await db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre }).from(E.tiposTramite)).map((t) => [t.id, t.nombre]));
    cliente = c
      ? `Cliente unido a este chat: ${c.nombre} (id ${c.id}${c.numeroDocumento ? `, ${c.tipoDocumento} ${c.numeroDocumento}` : ""}).\nTrámites abiertos: ${abiertos.length ? abiertos.map((t) => `${codigoTramite(t)} ${tipos.get(t.tipoId) ?? ""} (${ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite]})`).join("; ") : "ninguno"}.`
      : cliente;
  }
  const p = await leerParametros(db);
  const sistema = [
    `Eres el monitor de WhatsApp de ${p.nombre_negocio || "la oficina"}, una oficina de trámites de tránsito en Ibagué (Colombia). Lees los mensajes nuevos de un chat entre la oficina y una persona, y dejas propuestas para que Felipe las confirme.`,
    "Reglas:",
    "- Propón solo acciones claras que salgan de los mensajes: anotar en la bitácora del trámite lo importante (documentos enviados, pagos anunciados, acuerdos, datos nuevos), cambiar el estado si el mensaje lo dice claramente, registrar un pago confirmado con su valor, crear un recordatorio si se acordó algo con fecha, unir el chat con el cliente o crear el cliente.",
    "- Usa las herramientas de búsqueda para encontrar el cliente y sus trámites. Nunca inventes trámites, valores ni fechas.",
    "- Saludos, agradecimientos y mensajes sin contenido no generan propuestas. Si no hay nada que hacer, no propongas nada.",
    "- Máximo 3 propuestas. Notas cortas, en español, en tercera persona (\"El cliente envió foto de la cédula\").",
    calendario(),
  ].join("\n");
  const usuario = `${cliente}\nNúmero: ${telefonoLocal(chat.id)} · Perfil: ${chat.nombre ?? "sin nombre"}\n\nContexto anterior:\n${antes.reverse().map((m) => linea(m, "Persona")).join("\n") || "(nada)"}\n\nMensajes nuevos:\n${nuevos.map((m) => linea(m, "Persona")).join("\n")}`;

  const r = await bucleHerramientas(db, {
    apiKey: env.OPENAI_API_KEY!, base: env.OPENAI_BASE, funcionUso: "whatsapp_analizar", maxVueltas: 4, extra: herramientasChat(db, chat),
    mensajes: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
  });
  const pendientes = await db.select({ ruta: E.waPropuestas.ruta, cuerpo: E.waPropuestas.cuerpo }).from(E.waPropuestas).where(and(eq(E.waPropuestas.chatId, chat.id), eq(E.waPropuestas.estado, "pendiente")));
  const ya = new Set(pendientes.map((x) => `${x.ruta}|${x.cuerpo}`));
  const filas = r.propuestas.slice(0, 3)
    .map((x) => ({ id: x.id, chatId: chat.id, tipo: x.tipo, titulo: x.titulo, metodo: x.metodo, ruta: x.ruta, cuerpo: JSON.stringify(x.cuerpo), mensajeId: nuevos[nuevos.length - 1].id }))
    .filter((x) => !ya.has(`${x.ruta}|${x.cuerpo}`));
  await db.batch(lote([
    ...filas.map((f) => db.insert(E.waPropuestas).values(f)),
    db.update(E.waChats).set({ analizadoHasta: hasta }).where(eq(E.waChats.id, chat.id)),
  ]));
}

/** Cron cada 5 minutos. Cada paso por separado: si uno falla, los demás siguen. */
export async function procesar(env: EnvWhatsApp) {
  const db = drizzle(env.DB);
  const resumen = { historial: 0, vinculados: 0, archivos: 0, clasificados: 0, analizados: 0, errores: 0 };
  const silencio = new Date(Date.now() - SILENCIO_MS).toISOString();

  // 0) Una página del historial desde Kapso mientras falte (también se puede acelerar con el botón de la app).
  try {
    const est = await leerEstado(db);
    if (env.KAPSO_API_KEY && (env.KAPSO_PHONE_NUMBER_ID || est.phone_number_id) && est.historial_hecho !== "1") resumen.historial = (await sincronizarPagina(db, env)).guardados;
  } catch (e) { resumen.errores++; console.error("WhatsApp: historial", e); }

  // 1) Unir con clientes por teléfono (por ejemplo, si el cliente se creó después de que escribió).
  try {
    const sueltos = await db.select({ id: E.waChats.id, clasificacion: E.waChats.clasificacion }).from(E.waChats)
      .where(and(isNull(E.waChats.clienteId), ne(E.waChats.clasificacion, "personal"))).limit(300);
    for (let i = 0; i < sueltos.length; i += 40) {
      const grupo = sueltos.slice(i, i + 40);
      const locales = grupo.map((c) => telefonoLocal(c.id));
      const clientes = await db.select({ id: E.clientes.id, telefono: E.clientes.telefono }).from(E.clientes).where(inArray(E.clientes.telefono, [...locales, ...grupo.map((c) => c.id)]));
      const porTel = new Map(clientes.map((c) => [c.telefono, c.id]));
      const cambios = grupo.flatMap((c) => {
        const cli = porTel.get(telefonoLocal(c.id)) ?? porTel.get(c.id);
        return cli ? [db.update(E.waChats).set({ clienteId: cli, ...(c.clasificacion === "personal_propuesto" ? {} : { clasificacion: "tramites" as const }) }).where(eq(E.waChats.id, c.id))] : [];
      });
      if (cambios.length) await db.batch(lote(cambios));
      resumen.vinculados += cambios.length;
    }
  } catch (e) { resumen.errores++; console.error("WhatsApp: vincular", e); }

  // 2) Archivos que no se alcanzaron a copiar (Meta los guarda unos días).
  try {
    const pendientes = await db.select().from(E.waMensajes).where(and(isNotNull(E.waMensajes.archivoEnlace), isNull(E.waMensajes.archivoClave))).limit(ARCHIVOS_POR_CORRIDA);
    for (const m of pendientes) if (await copiarArchivo(db, env, m).catch(() => false)) resumen.archivos++;
  } catch (e) { resumen.errores++; console.error("WhatsApp: archivos", e); }

  if (!env.OPENAI_API_KEY) return resumen;

  // 3) Clasificar chats nuevos que ya quedaron quietos.
  const sinClasificar = await db.select().from(E.waChats).where(and(eq(E.waChats.clasificacion, "pendiente"), lt(E.waChats.ultimoMensaje, silencio))).orderBy(desc(E.waChats.ultimoMensaje)).limit(CLASIFICAR_POR_CORRIDA);
  for (const chat of sinClasificar) {
    try { await clasificar(db, env, chat); resumen.clasificados++; } catch (e) { resumen.errores++; console.error("WhatsApp: clasificar", chat.id, e); }
  }

  // 4) Proponer acciones en chats de trámites con mensajes nuevos (en vivo, no del historial).
  const porAnalizar = await db.select().from(E.waChats).where(and(
    eq(E.waChats.clasificacion, "tramites"), lt(E.waChats.ultimoMensaje, silencio),
    sql`EXISTS (SELECT 1 FROM wa_mensajes m WHERE m.chat_id = ${E.waChats.id} AND m.origen = 'vivo' AND m.enviado > COALESCE(${E.waChats.analizadoHasta}, ''))`,
  )).orderBy(asc(E.waChats.ultimoMensaje)).limit(ANALIZAR_POR_CORRIDA);
  for (const chat of porAnalizar) {
    try { await analizar(db, env, chat); resumen.analizados++; } catch (e) { resumen.errores++; console.error("WhatsApp: analizar", chat.id, e); }
  }
  return resumen;
}

