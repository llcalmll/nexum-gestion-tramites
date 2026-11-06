/*
 * Utilidades de la API: leer el cuerpo, validar campos y armar entradas de bitácora.
 * Todo error de validación es un ErrorApi con un mensaje para mostrarle a Felipe tal cual.
 */
import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { normalizar, ORIGENES, TIPOS_DOCUMENTO, type Origen, type TipoDocumento, type TipoEventoBitacora } from "../compartido/dominio";
import * as E from "../compartido/esquema";
import { esFecha, soloDigitos } from "../compartido/reglas";
import { ErrorApi } from "./http";

export type Db = DrizzleD1Database;
export type Datos = Record<string, unknown>;

export const nuevoId = () => crypto.randomUUID();
export const ahoraIso = () => new Date().toISOString();

/** Cuerpo JSON de la petición, con tope de tamaño. */
export async function leerJson(req: Request, maxBytes = 10_000): Promise<Datos> {
  const texto = await req.text();
  if (texto.length > maxBytes) throw new ErrorApi("La petición es demasiado grande.", 413);
  try {
    const d = JSON.parse(texto || "{}");
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error();
    return d as Datos;
  } catch {
    throw new ErrorApi("La petición no trae datos válidos.");
  }
}

/** Texto opcional: recorta, vacío -> null, y limita el largo. */
export function texto(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  return t.slice(0, max);
}

export function textoObligatorio(v: unknown, campo: string, max = 500): string {
  const t = texto(v, max);
  if (!t) throw new ErrorApi(`Falta ${campo}.`);
  return t;
}

export function fecha(v: unknown, campo: string): string | null {
  const t = texto(v, 10);
  if (!t) return null;
  if (!esFecha(t)) throw new ErrorApi(`La fecha de ${campo} no es válida (debe ser AAAA-MM-DD).`);
  return t;
}

/** Pesos enteros. Acepta "1.250.000", "$ 1250000" o números. */
export function pesos(v: unknown, campo: string): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d-]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) throw new ErrorApi(`El valor de ${campo} no es válido.`);
  return Math.round(n);
}

export function entero(v: unknown, campo: string, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d-]/g, ""));
  if (!Number.isInteger(n) || n < min || n > max) throw new ErrorApi(`El valor de ${campo} no es válido.`);
  return n;
}

export function enLista<T extends string>(v: unknown, lista: readonly T[], campo: string): T {
  if (typeof v === "string" && (lista as readonly string[]).includes(v)) return v as T;
  throw new ErrorApi(`El valor de ${campo} no es válido.`);
}

export function tipoDocumento(v: unknown): TipoDocumento {
  return v ? enLista(v, TIPOS_DOCUMENTO, "tipo de documento") : "CC";
}

/** Cédulas y similares: solo dígitos. Pasaporte y PPT pueden traer letras. */
export function numeroDocumento(v: unknown, tipo: TipoDocumento): string {
  const t = textoObligatorio(v, "el número de documento", 20);
  const n = tipo === "Pasaporte" || tipo === "PPT" ? t.toUpperCase().replace(/[^A-Z0-9]/g, "") : soloDigitos(t);
  if (n.length < 3) throw new ErrorApi("El número de documento no es válido.");
  return n;
}

export function telefono(v: unknown): string | null {
  const t = texto(v, 40);
  if (!t) return null;
  let d = soloDigitos(t);
  if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  if (d.length < 7 || d.length > 12) throw new ErrorApi("El teléfono no es válido.");
  return d;
}

export const origen = (v: unknown): Origen => (typeof v === "string" && (ORIGENES as readonly string[]).includes(v) ? (v as Origen) : "manual");

/** Entrada de bitácora para incluir en el mismo lote (batch) que el cambio que registra. */
export function bitacora(
  db: Db,
  tramiteId: string,
  tipoEvento: TipoEventoBitacora,
  descripcion: string,
  extra: { estadoAnterior?: string; estadoNuevo?: string; origen?: Origen; referencia?: string | null } = {},
) {
  return db.insert(E.bitacora).values({
    id: nuevoId(),
    tramiteId,
    tipoEvento,
    descripcion: descripcion.slice(0, 2000),
    estadoAnterior: extra.estadoAnterior ?? null,
    estadoNuevo: extra.estadoNuevo ?? null,
    origen: extra.origen ?? "manual",
    referencia: extra.referencia ?? null,
  });
}

export const busquedaCliente = (c: { nombre: string; numeroDocumento: string; telefono?: string | null; otrosTelefonos?: string[] | null }) => normalizar(c.nombre, c.numeroDocumento, c.telefono, ...(c.otrosTelefonos ?? []));
/** Los otros teléfonos de una persona: válidos, sin repetir ni repetir el principal; hasta 5. Vacío = null. */
export function otrosTelefonos(v: unknown, principal: string | null | undefined): string[] | null {
  const lista = (Array.isArray(v) ? v : []).map(telefono).filter((t): t is string => !!t && t !== principal);
  const unicos = [...new Set(lista)].slice(0, 5);
  return unicos.length ? unicos : null;
}
export const busquedaVehiculo = (v: { placa: string; marca?: string | null; linea?: string | null }) => normalizar(v.placa, v.marca, v.linea);

/** Error de llave única de SQLite -> mensaje claro. */
export function esDuplicado(e: unknown): boolean {
  const m = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : String(e);
  return /UNIQUE constraint failed/i.test(m);
}
export function esReferenciada(e: unknown): boolean {
  const m = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : String(e);
  return /FOREIGN KEY constraint failed/i.test(m);
}

/** Lee parámetros como mapa clave -> valor. */
export async function leerParametros(db: Db): Promise<Record<string, string>> {
  const filas = await db.select({ clave: E.parametros.clave, valor: E.parametros.valor }).from(E.parametros);
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}

/** Suma uso de IA del día (no se copia al navegador; sirve para saber el costo). */
export function registrarUsoIa(db: Db, funcion: string, modelo: string, entrada: number, salida: number) {
  const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  return db
    .insert(E.usoIa)
    .values({ fecha, funcion, modelo, llamadas: 1, tokensEntrada: entrada, tokensSalida: salida })
    .onConflictDoUpdate({
      target: [E.usoIa.fecha, E.usoIa.funcion, E.usoIa.modelo],
      set: { llamadas: sql`${E.usoIa.llamadas} + 1`, tokensEntrada: sql`${E.usoIa.tokensEntrada} + ${entrada}`, tokensSalida: sql`${E.usoIa.tokensSalida} + ${salida}` },
    });
}
