/**
 * Ingreso con Cloudflare Access (Zero Trust): Cloudflare pide el correo, envía un PIN y solo deja
 * pasar al correo de la política. A cada petición le agrega un JWT firmado con el correo verificado;
 * aquí se valida la firma, la audiencia, el emisor y las fechas, y que el correo sea CORREO_PERMITIDO.
 * Si Access fallara o quedara mal configurado, la API igual se cierra.
 *
 * Adaptado de sintraeducacion/web/api/acceso.ts (sin grupos: aquí hay un solo correo).
 * Documentación: developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface EnvAcceso {
  /** Nombre del equipo de Zero Trust (https://<equipo>.cloudflareaccess.com). */
  ACCESS_EQUIPO?: string;
  /** "Application Audience (AUD) Tag" de la aplicación de Access. */
  ACCESS_AUD?: string;
  /** Único correo con acceso. */
  CORREO_PERMITIDO: string;
  /** Solo en .dev.vars: sin Access en local, acepta a CORREO_PERMITIDO si la petición llega a localhost. */
  ACCESO_LOCAL?: string;
  /** Solo para las pruebas locales: de dónde leer las llaves públicas. */
  ACCESS_CERTS_URL?: string;
}

export type ResultadoAcceso = { ok: true; correo: string } | { ok: false; estado: 401 | 403 | 503; error: string };

const emisor = (env: EnvAcceso) => `https://${env.ACCESS_EQUIPO}.cloudflareaccess.com`;

const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// Llaves públicas de Cloudflare en memoria (Cloudflare las rota cada cierto tiempo).
let llaves: { url: string; hasta: number; porKid: Map<string, CryptoKey> } | null = null;

async function llavePara(env: EnvAcceso, kid: string, forzar = false): Promise<CryptoKey | undefined> {
  const url = env.ACCESS_CERTS_URL || `${emisor(env)}/cdn-cgi/access/certs`;
  if (forzar || !llaves || llaves.url !== url || llaves.hasta < Date.now()) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudieron leer las llaves de Access (${r.status})`);
    const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const porKid = new Map<string, CryptoKey>();
    for (const k of keys ?? []) {
      porKid.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    llaves = { url, hasta: Date.now() + 3_600_000, porKid };
  }
  return llaves.porKid.get(kid);
}

/** Correo verificado por Cloudflare Access, o null si el token falta o no es válido. */
async function correoVerificado(env: EnvAcceso, req: Request): Promise<string | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const cabecera = JSON.parse(new TextDecoder().decode(deB64url(partes[0]))) as { alg: string; kid: string };
    if (cabecera.alg !== "RS256") return null;
    // Si el kid no está, puede ser una llave nueva: se recarga una vez.
    const llave = (await llavePara(env, cabecera.kid)) ?? (await llavePara(env, cabecera.kid, true));
    if (!llave) return null;
    const firmaOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, deB64url(partes[2]), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
    if (!firmaOk) return null;
    const p = JSON.parse(new TextDecoder().decode(deB64url(partes[1]))) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    const ahora = Date.now() / 1000;
    const auds = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!auds.includes(env.ACCESS_AUD)) return null;
    if (p.iss !== emisor(env)) return null;
    if (!p.exp || p.exp < ahora - 30) return null;
    if (p.nbf && p.nbf > ahora + 30) return null;
    return typeof p.email === "string" && p.email.includes("@") ? p.email.trim().toLowerCase() : null;
  } catch (e) {
    console.error("JWT de Access inválido", e);
    return null;
  }
}

const esLocal = (req: Request) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(req.url).hostname);

/** Decide si la petición puede usar la API. */
export async function autorizar(env: EnvAcceso, req: Request): Promise<ResultadoAcceso> {
  const permitido = env.CORREO_PERMITIDO?.trim().toLowerCase();
  if (!permitido) return { ok: false, estado: 503, error: "Falta configurar el correo con acceso." };
  if (env.ACCESS_EQUIPO && env.ACCESS_AUD) {
    const correo = await correoVerificado(env, req);
    if (!correo) return { ok: false, estado: 401, error: "La sesión venció o no es válida." };
    if (correo !== permitido) return { ok: false, estado: 403, error: `El correo ${correo} no tiene acceso a esta app.` };
    return { ok: true, correo };
  }
  if (env.ACCESO_LOCAL === "1" && esLocal(req)) return { ok: true, correo: permitido };
  // Sin Access configurado y fuera de este PC: cerrado.
  return { ok: false, estado: 503, error: "El acceso todavía no está configurado." };
}
