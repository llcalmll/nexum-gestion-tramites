/*
 * POST /api/datos-leidos  { persona?: {...}, vehiculo?: {...}, titular?: {...}, aplicar?: string[] }
 *
 * Guarda lo que se leyó de una cédula, licencia o tarjeta de propiedad escaneada (Escáner), después de que Felipe lo
 * revisó y lo corrigió en pantalla.
 * - Persona: si no hay cliente con ese documento, se crea. Si ya existe, NO se cambia nada todavía: se devuelven las
 *   diferencias (lo guardado frente a lo leído) y solo se aplican las que Felipe marque en `aplicar`.
 * - Vehículo: igual, por placa. Si es nuevo, su titular es el propietario de la tarjeta (se crea si no es cliente; si
 *   ya lo es, no se le toca nada).
 * Respuesta: { estado: "creado" | "existe" | "actualizado" | "igual", id, nombre, diferencias: [{ campo, etiqueta, antes, nuevo }] }
 */
import { eq } from "drizzle-orm";
import { normalizar } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { organismoDeTexto } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import type { Datos, Db } from "../util";
import { leerRespuesta } from "./movil";
import { crearCliente, crearVehiculo, editarCliente, editarVehiculo } from "./personas";

const PERSONA: Record<string, string> = {
  nombre: "Nombre", tipoDocumento: "Tipo de documento", numeroDocumento: "Documento", fechaNacimiento: "Nacimiento",
  fechaExpedicionDocumento: "Expedición del documento", telefono: "Teléfono", direccion: "Dirección", ciudad: "Ciudad",
};
const VEHICULO: Record<string, string> = {
  placa: "Placa", marca: "Marca", linea: "Línea", modelo: "Modelo", clase: "Clase", color: "Color", cilindraje: "Cilindraje", servicio: "Servicio",
  numeroMotor: "Motor", numeroChasis: "Chasis", numeroSerie: "Serie", vin: "VIN", combustible: "Combustible", carroceria: "Carrocería", capacidad: "Capacidad",
  potencia: "Potencia", licenciaTransito: "Licencia de tránsito", fechaMatricula: "Fecha de matrícula", organismoMatriculaId: "Matriculado en",
};
export interface Diferencia { campo: string; etiqueta: string; antes: string; nuevo: string }

/** Lo que llegó con algo escrito (un campo vacío no borra nada de lo guardado). */
function dichos(x: unknown, campos: string[]) {
  const d: Datos = {};
  for (const k of campos) {
    const v = (x as Datos | undefined)?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") d[k] = String(v).trim();
  }
  return d;
}
const igual = (k: string, a: unknown, b: unknown) => {
  const s = (v: unknown) => normalizar(String(v ?? "")).replace(/[^a-z0-9]/g, "");
  return ["numeroDocumento", "telefono", "cilindraje", "modelo", "licenciaTransito"].includes(k) ? String(a ?? "").replace(/\D/g, "") === String(b ?? "").replace(/\D/g, "") : s(a) === s(b);
};
function diferencias(guardado: Datos, nuevo: Datos, etiquetas: Record<string, string>, nombres: Record<string, string> = {}): Diferencia[] {
  return Object.keys(nuevo).filter((k) => !igual(k, guardado[k], nuevo[k])).map((k) => ({
    campo: k, etiqueta: etiquetas[k] ?? k, antes: guardado[k] == null || guardado[k] === "" ? "" : nombres[String(guardado[k])] ?? String(guardado[k]), nuevo: nombres[String(nuevo[k])] ?? String(nuevo[k]),
  }));
}
const elegidos = (d: Datos, aplicar: string[]) => Object.fromEntries(Object.entries(d).filter(([k]) => aplicar.includes(k)));

async function guardarPersona(db: Db, x: unknown, aplicar: string[] | null) {
  const d = dichos(x, Object.keys(PERSONA));
  if (d.numeroDocumento) d.numeroDocumento = String(d.numeroDocumento).replace(/\D/g, "");
  if (d.telefono) d.telefono = String(d.telefono).replace(/\D/g, "");
  if (d.nombre) d.nombre = String(d.nombre).toUpperCase().replace(/\s+/g, " ");
  if (!d.nombre) throw new ErrorApi("Falta el nombre de la persona.");
  const ya = d.numeroDocumento ? await db.select().from(E.clientes).where(eq(E.clientes.numeroDocumento, String(d.numeroDocumento))).get() : undefined;
  if (!ya) {
    const r = await leerRespuesta(await crearCliente(db, { tipoDocumento: "CC", ...d }));
    return { estado: "creado" as const, id: String(r.d.id), nombre: String(d.nombre), diferencias: [] };
  }
  const dif = diferencias(ya as unknown as Datos, d, PERSONA);
  if (!dif.length) return { estado: "igual" as const, id: ya.id, nombre: ya.nombre, diferencias: [] };
  if (!aplicar) return { estado: "existe" as const, id: ya.id, nombre: ya.nombre, diferencias: dif };
  const cambios = elegidos(d, aplicar.filter((k) => dif.some((x) => x.campo === k)));
  if (Object.keys(cambios).length) await leerRespuesta(await editarCliente(db, ya.id, cambios));
  return { estado: "actualizado" as const, id: ya.id, nombre: String(cambios.nombre ?? ya.nombre), diferencias: dif.filter((x) => x.campo in cambios) };
}

async function guardarVehiculo(db: Db, x: unknown, titular: unknown, aplicar: string[] | null) {
  const v = (x ?? {}) as Datos;
  const d = dichos(v, Object.keys(VEHICULO).filter((k) => k !== "organismoMatriculaId"));
  if (d.placa) d.placa = String(d.placa).toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const k of ["modelo", "cilindraje"]) if (d[k]) d[k] = String(d[k]).replace(/\D/g, "");
  if (!d.placa) throw new ErrorApi("Falta la placa.");
  const orgs = await db.select({ id: E.organismos.id, nombre: E.organismos.nombre, ciudad: E.organismos.ciudad }).from(E.organismos);
  const org = v.organismo ? organismoDeTexto(orgs, String(v.organismo)) : null;
  if (org) d.organismoMatriculaId = org.id;
  const nombresOrg = Object.fromEntries(orgs.map((o) => [o.id, o.ciudad ?? o.nombre]));
  const ya = await db.select().from(E.vehiculos).where(eq(E.vehiculos.placa, String(d.placa))).get();
  if (!ya) {
    // El propietario de la tarjeta: el cliente con ese documento, o uno nuevo (sin tocar al que ya existe).
    const t = dichos(titular, ["nombre", "numeroDocumento", "tipoDocumento"]);
    let titularId: string | null = null;
    if (t.nombre || t.numeroDocumento) {
      const doc = String(t.numeroDocumento ?? "").replace(/\D/g, "");
      const existe = doc ? await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.numeroDocumento, doc)).get() : undefined;
      titularId = existe?.id ?? (t.nombre ? (await guardarPersona(db, { ...t, numeroDocumento: doc }, null)).id : null);
    }
    const r = await leerRespuesta(await crearVehiculo(db, { ...d, ...(titularId ? { titular: { id: titularId } } : {}) }));
    return { estado: "creado" as const, id: String(r.d.id), nombre: String(d.placa), diferencias: [] };
  }
  const dif = diferencias(ya as unknown as Datos, d, VEHICULO, nombresOrg);
  if (!dif.length) return { estado: "igual" as const, id: ya.id, nombre: ya.placa, diferencias: [] };
  if (!aplicar) return { estado: "existe" as const, id: ya.id, nombre: ya.placa, diferencias: dif };
  const cambios = elegidos(d, aplicar.filter((k) => dif.some((x) => x.campo === k)));
  if (Object.keys(cambios).length) await leerRespuesta(await editarVehiculo(db, ya.id, cambios));
  return { estado: "actualizado" as const, id: ya.id, nombre: ya.placa, diferencias: dif.filter((x) => x.campo in cambios) };
}

export async function guardarDatosLeidos(db: Db, d: Datos) {
  const aplicar = Array.isArray(d.aplicar) ? d.aplicar.map(String) : null;
  if (d.vehiculo) return json(await guardarVehiculo(db, d.vehiculo, d.titular, aplicar));
  if (d.persona) return json(await guardarPersona(db, d.persona, aplicar));
  throw new ErrorApi("No llegó ni una persona ni un vehículo.");
}
