/*
 * Clientes y vehículos.
 *   POST   /api/clientes                     crear (solo el nombre es obligatorio; el documento se puede completar después)
 *   PATCH  /api/clientes/:id                 editar (solo los campos que llegan)
 *   DELETE /api/clientes/:id                 borrar (si no tiene trámites)
 *   POST   /api/clientes/:id/licencias       registrar licencias leídas de la foto o escritas
 *   POST   /api/vehiculos                    crear (solo la placa es obligatoria); el titular se enlaza o se crea
 *   PATCH  /api/vehiculos/:id                editar
 *   DELETE /api/vehiculos/:id                borrar (si no tiene trámites)
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { CATEGORIAS_LICENCIA, SERVICIOS_VEHICULO, TIPOS_GRAVAMEN, type Gravamen } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { categoriasDeTexto, claseMasParecida, normalizarPlaca, vencimientoLicencia } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import {
  busquedaCliente, busquedaVehiculo, entero, esDuplicado, esReferenciada, fecha, nuevoId, numeroDocumento, otrosTelefonos, telefono, texto,
  textoObligatorio, tipoDocumento, type Datos, type Db,
} from "../util";

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Campos editables de un cliente y cómo se valida cada uno. */
function camposCliente(d: Datos, previo?: typeof E.clientes.$inferSelect) {
  const tiene = (k: string) => k in d;
  const tipo = tiene("tipoDocumento") ? tipoDocumento(d.tipoDocumento) : (previo?.tipoDocumento as ReturnType<typeof tipoDocumento>) ?? "CC";
  const c: Partial<typeof E.clientes.$inferInsert> = {};
  if (tiene("tipoDocumento")) c.tipoDocumento = tipo;
  // El documento es opcional: vacío = sin documento todavía (se completa después).
  if (tiene("numeroDocumento") || !previo) c.numeroDocumento = texto(d.numeroDocumento, 20) ? numeroDocumento(d.numeroDocumento, tipo) : "";
  if (tiene("nombre") || !previo) c.nombre = textoObligatorio(d.nombre, "el nombre", 160).replace(/\s+/g, " ");
  if (tiene("telefono")) c.telefono = telefono(d.telefono);
  // Los demás números (el principal es telefono); sin principal, el primero de la lista pasa a serlo.
  if (tiene("otrosTelefonos")) {
    let principal = "telefono" in c ? c.telefono : previo?.telefono ?? null;
    let otros = otrosTelefonos(d.otrosTelefonos, principal);
    if (!principal && otros?.length) { principal = otros[0]; c.telefono = principal; otros = otros.slice(1).length ? otros.slice(1) : null; }
    c.otrosTelefonos = otros;
  }
  if (tiene("ciudad")) c.ciudad = texto(d.ciudad, 80);
  if (tiene("direccion")) c.direccion = texto(d.direccion, 160);
  if (tiene("fechaNacimiento")) c.fechaNacimiento = fecha(d.fechaNacimiento, "nacimiento");
  if (tiene("fechaExpedicionDocumento")) c.fechaExpedicionDocumento = fecha(d.fechaExpedicionDocumento, "expedición del documento");
  if (tiene("notas")) c.notas = texto(d.notas, 4000);
  const final = { ...previo, ...c } as typeof E.clientes.$inferSelect;
  c.busqueda = busquedaCliente(final);
  return c;
}

async function clienteExistente(db: Db, numero: string) {
  return db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(eq(E.clientes.numeroDocumento, numero)).get();
}

export async function crearCliente(db: Db, d: Datos) {
  const c = camposCliente(d);
  const ya = c.numeroDocumento ? await clienteExistente(db, c.numeroDocumento) : undefined;
  if (ya) return json({ error: `Ya existe un cliente con el documento ${c.numeroDocumento}: ${ya.nombre}.`, existenteId: ya.id }, 409);
  const id = nuevoId();
  await db.insert(E.clientes).values({ ...(c as typeof E.clientes.$inferInsert), id }).run();
  return json({ id });
}

export async function editarCliente(db: Db, id: string, d: Datos) {
  const previo = await db.select().from(E.clientes).where(eq(E.clientes.id, id)).get();
  if (!previo) throw new ErrorApi("El cliente no existe.", 404);
  const c = camposCliente(d, previo);
  if (c.numeroDocumento && c.numeroDocumento !== previo.numeroDocumento) {
    const ya = await clienteExistente(db, c.numeroDocumento);
    if (ya) return json({ error: `Ya existe otro cliente con el documento ${c.numeroDocumento}: ${ya.nombre}.`, existenteId: ya.id }, 409);
  }
  const items: BatchItem<"sqlite">[] = [db.update(E.clientes).set(c).where(eq(E.clientes.id, id))];
  // Con la fecha de nacimiento nueva, el radar recalcula las licencias que se estimaron (importadas o de trámites):
  // la vigencia depende de la edad al expedirse (art. 197, Decreto 019 de 2012). Las leídas de la licencia no se tocan.
  const nacimiento = "fechaNacimiento" in c ? c.fechaNacimiento : previo.fechaNacimiento;
  let recalculadas = 0;
  if (nacimiento && nacimiento !== previo.fechaNacimiento) {
    const estimadas = await db.select().from(E.licencias)
      .where(and(eq(E.licencias.clienteId, id), inArray(E.licencias.origen, ["importada", "tramite"]), isNotNull(E.licencias.fechaExpedicion)));
    for (const l of estimadas) {
      const vence = vencimientoLicencia(l.fechaExpedicion!, l.categoria, nacimiento);
      if (vence !== l.fechaVencimiento) { items.push(db.update(E.licencias).set({ fechaVencimiento: vence }).where(eq(E.licencias.id, l.id))); recalculadas++; }
    }
  }
  await db.batch(items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return json({ id, licenciasRecalculadas: recalculadas });
}

export async function borrarCliente(db: Db, id: string) {
  try {
    const r = await db.delete(E.clientes).where(eq(E.clientes.id, id)).run();
    if (!r.meta.changes) throw new ErrorApi("El cliente no existe.", 404);
  } catch (e) {
    if (esReferenciada(e)) throw new ErrorApi("No se puede borrar: el cliente tiene trámites. Bórrelos o cámbieles el titular primero.", 409);
    throw e;
  }
  return json({ ok: true });
}

/** Licencias del cliente (por ejemplo, leídas de la foto de la licencia). Una fila por categoría. */
export async function registrarLicencias(db: Db, clienteId: string, d: Datos) {
  const cliente = await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.id, clienteId)).get();
  if (!cliente) throw new ErrorApi("El cliente no existe.", 404);
  const categorias = categoriasDeTexto(Array.isArray(d.categorias) ? d.categorias.join(",") : String(d.categorias ?? ""));
  if (!categorias.length) throw new ErrorApi(`Indique al menos una categoría válida (${CATEGORIAS_LICENCIA.join(", ")}).`);
  const vence = fecha(d.fechaVencimiento, "vencimiento");
  if (!vence) throw new ErrorApi("Falta la fecha de vencimiento de la licencia.");
  const expedicion = fecha(d.fechaExpedicion, "expedición");
  const origen = d.origen === "foto" ? "foto" : "manual";
  await db.batch(
    categorias.map((categoria) =>
      db
        .insert(E.licencias)
        .values({ id: nuevoId(), clienteId, categoria, fechaVencimiento: vence, fechaExpedicion: expedicion, origen })
        .onConflictDoUpdate({ target: [E.licencias.clienteId, E.licencias.categoria], set: { fechaVencimiento: vence, fechaExpedicion: expedicion, origen } }),
    ) as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  );
  return json({ categorias });
}

// ─── Vehículos ───────────────────────────────────────────────────────────────

function gravamenes(v: unknown): Gravamen[] {
  if (!Array.isArray(v)) throw new ErrorApi("Los gravámenes no son válidos.");
  return v.slice(0, 20).map((g) => {
    const x = (g ?? {}) as Datos;
    if (!(TIPOS_GRAVAMEN as readonly string[]).includes(String(x.tipo))) throw new ErrorApi("Tipo de gravamen no válido.");
    return { tipo: x.tipo as Gravamen["tipo"], origen: texto(x.origen, 160) ?? undefined, descripcion: texto(x.descripcion, 500) ?? undefined };
  });
}

function camposVehiculo(d: Datos, previo?: typeof E.vehiculos.$inferSelect) {
  const tiene = (k: string) => k in d;
  const v: Partial<typeof E.vehiculos.$inferInsert> = {};
  if (tiene("placa") || !previo) {
    const placa = normalizarPlaca(textoObligatorio(d.placa, "la placa", 12));
    if (placa.length < 5 || placa.length > 7) throw new ErrorApi("La placa no es válida.");
    v.placa = placa;
  }
  if (tiene("clase")) v.clase = claseMasParecida(texto(d.clase, 40)) ?? texto(d.clase, 40);
  if (tiene("marca")) v.marca = texto(d.marca, 60)?.toUpperCase() ?? null;
  if (tiene("linea")) v.linea = texto(d.linea, 80)?.toUpperCase() ?? null;
  if (tiene("modelo")) v.modelo = entero(d.modelo, "modelo", 1900, new Date().getFullYear() + 2);
  if (tiene("cilindraje")) v.cilindraje = entero(d.cilindraje, "cilindraje", 1, 100_000);
  if (tiene("servicio")) {
    const s = texto(d.servicio, 20)?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") ?? null;
    v.servicio = s && (SERVICIOS_VEHICULO as readonly string[]).includes(s) ? s : null;
  }
  for (const k of ["color", "numeroMotor", "numeroChasis", "numeroSerie", "vin", "combustible", "carroceria", "capacidad", "potencia", "licenciaTransito"] as const) {
    if (tiene(k)) v[k] = texto(d[k], 60)?.toUpperCase() ?? null;
  }
  if (tiene("fechaMatricula")) v.fechaMatricula = fecha(d.fechaMatricula, "matrícula");
  if (tiene("soatVence")) v.soatVence = fecha(d.soatVence, "vencimiento del SOAT");
  if (tiene("rtmVence")) v.rtmVence = fecha(d.rtmVence, "vencimiento de la revisión técnico-mecánica");
  if (tiene("impuestoAlDiaHasta")) v.impuestoAlDiaHasta = fecha(d.impuestoAlDiaHasta, "impuesto al día");
  if (tiene("gravamenes")) v.gravamenes = gravamenes(d.gravamenes);
  if (tiene("avaluoOficial")) v.avaluoOficial = entero(d.avaluoOficial, "avalúo", 0, 10_000_000_000);
  if (tiene("avaluoDetalle")) v.avaluoDetalle = texto(d.avaluoDetalle, 300);
  if (tiene("organismoMatriculaId")) v.organismoMatriculaId = texto(d.organismoMatriculaId, 64);
  if (tiene("notas")) v.notas = texto(d.notas, 4000);
  const final = { ...previo, ...v } as typeof E.vehiculos.$inferSelect;
  v.busqueda = busquedaVehiculo(final);
  return v;
}

/**
 * Titular del vehículo: { id } de un cliente existente, o { tipoDocumento, numeroDocumento, nombre }
 * leído de la tarjeta: si ese documento ya es cliente se enlaza; si no, se crea con nombre y documento.
 */
async function resolverTitular(db: Db, t: unknown): Promise<{ id: string | null; creado: Datos | null }> {
  if (t === null || t === undefined) return { id: null, creado: null };
  const x = t as Datos;
  if (typeof x.id === "string" && x.id) {
    const c = await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.id, x.id)).get();
    if (!c) throw new ErrorApi("El titular elegido no existe.", 404);
    return { id: c.id, creado: null };
  }
  const tipo = tipoDocumento(x.tipoDocumento);
  const numero = numeroDocumento(x.numeroDocumento, tipo);
  const ya = await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.numeroDocumento, numero)).get();
  if (ya) return { id: ya.id, creado: null };
  const nombre = textoObligatorio(x.nombre, "el nombre del titular", 160).replace(/\s+/g, " ");
  return { id: nuevoId(), creado: { tipoDocumento: tipo, numeroDocumento: numero, nombre } };
}

async function placaExistente(db: Db, placa: string) {
  return db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(eq(E.vehiculos.placa, placa)).get();
}

export async function crearVehiculo(db: Db, d: Datos) {
  const v = camposVehiculo(d);
  const ya = await placaExistente(db, v.placa!);
  if (ya) return json({ error: `Ya existe un vehículo con la placa ${v.placa}.`, existenteId: ya.id }, 409);
  const titular = await resolverTitular(db, d.titular);
  const id = nuevoId();
  const filaVehiculo = db.insert(E.vehiculos).values({ ...(v as typeof E.vehiculos.$inferInsert), id, titularId: titular.id });
  if (titular.creado) {
    const c = titular.creado as { tipoDocumento: string; numeroDocumento: string; nombre: string };
    await db.batch([db.insert(E.clientes).values({ id: titular.id!, ...c, busqueda: busquedaCliente(c) }), filaVehiculo]);
  } else {
    await filaVehiculo.run();
  }
  return json({ id, titularId: titular.id, titularCreado: !!titular.creado });
}

export async function editarVehiculo(db: Db, id: string, d: Datos) {
  const previo = await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, id)).get();
  if (!previo) throw new ErrorApi("El vehículo no existe.", 404);
  const v = camposVehiculo(d, previo);
  if (v.placa && v.placa !== previo.placa && (await placaExistente(db, v.placa))) throw new ErrorApi(`Ya existe otro vehículo con la placa ${v.placa}.`, 409);
  let creado: Datos | null = null;
  if ("titular" in d) {
    const t = await resolverTitular(db, d.titular);
    v.titularId = t.id;
    creado = t.creado;
  }
  const cambio = db.update(E.vehiculos).set(v).where(eq(E.vehiculos.id, id));
  try {
    if (creado) {
      const c = creado as { tipoDocumento: string; numeroDocumento: string; nombre: string };
      await db.batch([db.insert(E.clientes).values({ id: v.titularId!, ...c, busqueda: busquedaCliente(c) }), cambio]);
    } else {
      await cambio.run();
    }
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorApi("Ya existe otro vehículo con esa placa.", 409);
    throw e;
  }
  return json({ id, titularId: v.titularId ?? previo.titularId });
}

export async function borrarVehiculo(db: Db, id: string) {
  try {
    const r = await db.delete(E.vehiculos).where(eq(E.vehiculos.id, id)).run();
    if (!r.meta.changes) throw new ErrorApi("El vehículo no existe.", 404);
  } catch (e) {
    if (esReferenciada(e)) throw new ErrorApi("No se puede borrar: el vehículo tiene trámites.", 409);
    throw e;
  }
  return json({ ok: true });
}
