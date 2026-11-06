/*
 * Trámites y licencias en la app del celular ("Fotos · Trámites Pira"), que no descarga la base: lo justo para buscar un
 * trámite, ver lo importante (placa, personas, documentos, notas) y pegarle un documento o una nota desde el celular.
 *   GET /api/movil/tramites?q=&ver=abiertos|todos     hasta 60, los más nuevos primero (un combo, una vez)
 *   GET /api/movil/tramites/:id                       el trámite: vehículo, personas, documentos y bitácora reciente
 *   GET /api/movil/licencias?q=                       licencias por vencerse primero (las categorías de cada persona juntas)
 * Lo demás ya existe y lo usa también el expediente del PC: POST /api/tramites/:id/documentos, PUT
 * /api/documentos/:id/archivo (subir la foto), GET /api/documentos/:id/archivo (verla), POST /api/tramites/:id/notas,
 * DELETE /api/documentos/:id y DELETE /api/tramites/:id/bitacora/:entrada (quitar lo pegado o escrito por error).
 */
import { and, asc, desc, eq, inArray, like, ne, notInArray, or, type SQL } from "drizzle-orm";
import { codigoTramite, ESTADOS_TERMINALES } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { ErrorApi, json } from "../http";
import type { Db } from "../util";

const LIMITE = 60;

/** Lo que se escribió, para buscar: en mayúsculas; la placa sin espacios ni guiones; un código T-2026-00905 da 905. */
function busqueda(q: string) {
  const texto = q.trim().toUpperCase();
  const numero = /^[TL]?-?\d{4}-(\d{1,6})$/.exec(texto.replace(/\s+/g, ""))?.[1] ?? (/^\d{1,6}$/.test(texto) ? texto : null);
  return { texto, placa: texto.replace(/[\s-]+/g, ""), numero: numero ? Number(numero) : null };
}

/**
 * Como la tabla de Trámites del PC: cada sección aparte (los de licencia tienen su propia numeración, L-, y revueltos
 * con los T- quedaban al fondo) y del número más alto al más bajo; un combo va con el número de su primera parte.
 */
export async function listarTramites(db: Db, q: string, ver: string, seccion: string | null = null) {
  const b = busqueda(q);
  const condiciones: SQL[] = [eq(E.tramites.borrador, false)];
  if (ver === "abiertos") condiciones.push(notInArray(E.tramites.estado, [...ESTADOS_TERMINALES]));
  if (seccion === "licencias") condiciones.push(eq(E.tiposTramite.categoria, "licencia"));
  else if (seccion === "tramites") condiciones.push(ne(E.tiposTramite.categoria, "licencia"));
  if (b.texto) {
    const o = [
      like(E.vehiculos.placa, `%${b.placa}%`), like(E.clientes.nombre, `%${b.texto}%`), like(E.clientes.numeroDocumento, `%${b.placa}%`),
      like(E.tiposTramite.nombre, `%${b.texto}%`), like(E.organismos.ciudad, `%${b.texto}%`),
      ...(b.numero ? [eq(E.tramites.numero, b.numero), eq(E.tramites.codigo, b.numero)] : []),
    ];
    condiciones.push(or(...o)!);
  }
  const filas = await db.select({
    id: E.tramites.id, numero: E.tramites.numero, codigo: E.tramites.codigo, serie: E.tramites.serie, creado: E.tramites.creado,
    estado: E.tramites.estado, encargoId: E.tramites.encargoId, detalle: E.tramites.detalle, problema: E.tramites.problema,
    tipo: E.tiposTramite.nombre, categoria: E.tiposTramite.categoria, titular: E.clientes.nombre, placa: E.vehiculos.placa, ciudad: E.organismos.ciudad,
  }).from(E.tramites)
    .innerJoin(E.tiposTramite, eq(E.tiposTramite.id, E.tramites.tipoId))
    .innerJoin(E.clientes, eq(E.clientes.id, E.tramites.titularId))
    .leftJoin(E.vehiculos, eq(E.vehiculos.id, E.tramites.vehiculoId))
    .leftJoin(E.organismos, eq(E.organismos.id, E.tramites.organismoId))
    .where(and(...condiciones))
    .orderBy(desc(E.tramites.numero))
    .limit(LIMITE * 2);
  // Un combo sale una vez, con sus trámites juntos en el nombre.
  const vistos = new Map<string, (typeof filas)[number] & { tipos: string[] }>();
  const lista: ((typeof filas)[number] & { tipos: string[] })[] = [];
  for (const f of filas) {
    const previo = f.encargoId ? vistos.get(f.encargoId) : undefined;
    // Las partes llegan de la más nueva a la más vieja: el combo queda con el número y el código de la primera.
    if (previo) { previo.tipos.unshift(f.tipo); Object.assign(previo, { numero: f.numero, codigo: f.codigo, serie: f.serie }); continue; }
    const x = { ...f, tipos: [f.tipo] };
    if (f.encargoId) vistos.set(f.encargoId, x);
    lista.push(x);
  }
  lista.sort((x, y) => y.numero - x.numero);
  const elegidos = lista.slice(0, LIMITE);
  // La nota destacada de cada uno (la que sale grande arriba del expediente).
  const ids = elegidos.map((t) => t.id);
  const destacadas = ids.length ? await db.select({ tramiteId: E.bitacora.tramiteId, descripcion: E.bitacora.descripcion }).from(E.bitacora).where(and(inArray(E.bitacora.tramiteId, ids), eq(E.bitacora.destacada, true))).all() : [];
  const nota = new Map(destacadas.map((d) => [d.tramiteId, d.descripcion]));
  return json({
    tramites: elegidos.map((t) => ({
      id: t.id, codigo: codigoTramite(t), tipo: t.tipos.join(" + "), categoria: t.categoria, placa: t.placa, titular: t.titular,
      estado: t.estado, ciudad: t.ciudad, detalle: t.detalle, problema: t.problema, creado: t.creado, nota: nota.get(t.id) ?? null,
    })),
    mas: lista.length > LIMITE,
  });
}

export async function detalleTramite(db: Db, id: string) {
  const t = await db.select({
    id: E.tramites.id, numero: E.tramites.numero, codigo: E.tramites.codigo, serie: E.tramites.serie, creado: E.tramites.creado,
    estado: E.tramites.estado, encargoId: E.tramites.encargoId, detalle: E.tramites.detalle, problema: E.tramites.problema,
    fechaEstimadaEntrega: E.tramites.fechaEstimadaEntrega, total: E.tramites.total, observaciones: E.tramites.observaciones, aliado: E.tramites.aliado,
    titularId: E.tramites.titularId, vehiculoId: E.tramites.vehiculoId, tipo: E.tiposTramite.nombre, categoria: E.tiposTramite.categoria,
    organismo: E.organismos.nombre, ciudad: E.organismos.ciudad,
  }).from(E.tramites)
    .innerJoin(E.tiposTramite, eq(E.tiposTramite.id, E.tramites.tipoId))
    .leftJoin(E.organismos, eq(E.organismos.id, E.tramites.organismoId))
    .where(eq(E.tramites.id, id)).get();
  if (!t) throw new ErrorApi("El trámite no existe.", 404);
  // En un combo, lo de todas sus partes (documentos y bitácora) junto.
  const partes = t.encargoId
    ? await db.select({ id: E.tramites.id, tipo: E.tiposTramite.nombre }).from(E.tramites).innerJoin(E.tiposTramite, eq(E.tiposTramite.id, E.tramites.tipoId)).where(eq(E.tramites.encargoId, t.encargoId)).all()
    : [{ id: t.id, tipo: t.tipo }];
  const idsPartes = partes.map((p) => p.id);
  const [vehiculo, titular, personas, documentos, bitacora, arriba] = await Promise.all([
    t.vehiculoId ? db.select({ placa: E.vehiculos.placa, marca: E.vehiculos.marca, linea: E.vehiculos.linea, modelo: E.vehiculos.modelo, clase: E.vehiculos.clase, color: E.vehiculos.color, servicio: E.vehiculos.servicio }).from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get() : null,
    db.select({ id: E.clientes.id, nombre: E.clientes.nombre, tipoDocumento: E.clientes.tipoDocumento, numeroDocumento: E.clientes.numeroDocumento, telefono: E.clientes.telefono, otrosTelefonos: E.clientes.otrosTelefonos }).from(E.clientes).where(eq(E.clientes.id, t.titularId)).get(),
    db.select({ rol: E.tramitePersonas.rol, nombre: E.clientes.nombre, tipoDocumento: E.clientes.tipoDocumento, numeroDocumento: E.clientes.numeroDocumento, telefono: E.clientes.telefono, otrosTelefonos: E.clientes.otrosTelefonos })
      .from(E.tramitePersonas).innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId)).where(inArray(E.tramitePersonas.tramiteId, idsPartes)).all(),
    db.select({ id: E.documentos.id, tramiteId: E.documentos.tramiteId, tipoDocumento: E.documentos.tipoDocumento, estado: E.documentos.estado, archivoClave: E.documentos.archivoClave, archivoTipo: E.documentos.archivoTipo })
      .from(E.documentos).where(inArray(E.documentos.tramiteId, idsPartes)).orderBy(asc(E.documentos.creado)).all(),
    db.select({ id: E.bitacora.id, tramiteId: E.bitacora.tramiteId, fecha: E.bitacora.fecha, tipoEvento: E.bitacora.tipoEvento, descripcion: E.bitacora.descripcion, destacada: E.bitacora.destacada, fijada: E.bitacora.fijada })
      .from(E.bitacora).where(inArray(E.bitacora.tramiteId, idsPartes)).orderBy(desc(E.bitacora.fecha)).limit(12).all(),
    // La destacada y las fijadas, aunque sean viejas (salen arriba del trámite).
    db.select({ id: E.bitacora.id, descripcion: E.bitacora.descripcion, destacada: E.bitacora.destacada, fecha: E.bitacora.fecha })
      .from(E.bitacora).where(and(inArray(E.bitacora.tramiteId, idsPartes), or(eq(E.bitacora.destacada, true), eq(E.bitacora.fijada, true)))).orderBy(asc(E.bitacora.fecha)).all(),
  ]);
  // Las personas sin repetir (en un combo pueden estar en varias partes con el mismo rol).
  const unicas = [...new Map(personas.map((p) => [`${p.rol}|${p.numeroDocumento}|${p.nombre}`, p])).values()];
  return json({
    tramite: { ...t, codigo: codigoTramite(t), tipo: partes.map((p) => p.tipo).join(" + "), partes },
    vehiculo, titular, personas: unicas,
    documentos: documentos.map(({ archivoClave, ...d }) => ({ ...d, tieneArchivo: !!archivoClave })),
    bitacora,
    destacada: arriba.find((b) => b.destacada)?.descripcion ?? null,
    fijadas: arriba.filter((b) => !b.destacada).map((b) => b.descripcion).filter(Boolean),
  });
}

export async function listarLicencias(db: Db, q: string) {
  const b = busqueda(q);
  const filas = await db.select({
    id: E.licencias.id, categoria: E.licencias.categoria, vencimiento: E.licencias.fechaVencimiento, expedicion: E.licencias.fechaExpedicion,
    clienteId: E.clientes.id, nombre: E.clientes.nombre, documento: E.clientes.numeroDocumento, telefono: E.clientes.telefono,
  }).from(E.licencias).innerJoin(E.clientes, eq(E.clientes.id, E.licencias.clienteId))
    .where(b.texto ? or(like(E.clientes.nombre, `%${b.texto}%`), like(E.clientes.numeroDocumento, `%${b.placa}%`), like(E.licencias.categoria, `%${b.texto}%`)) : undefined)
    .orderBy(asc(E.licencias.fechaVencimiento)).limit(LIMITE * 3);
  // Las categorías de una persona con el mismo vencimiento, juntas (B1 y C1 de la misma licencia).
  const grupos = new Map<string, { clienteId: string; nombre: string; documento: string; telefono: string | null; vencimiento: string; expedicion: string | null; categorias: string[] }>();
  for (const f of filas) {
    const k = `${f.clienteId}|${f.vencimiento}`;
    const g = grupos.get(k);
    if (g) g.categorias.push(f.categoria);
    else grupos.set(k, { clienteId: f.clienteId, nombre: f.nombre, documento: f.documento, telefono: f.telefono, vencimiento: f.vencimiento, expedicion: f.expedicion, categorias: [f.categoria] });
  }
  return json({ licencias: [...grupos.values()].slice(0, LIMITE) });
}
