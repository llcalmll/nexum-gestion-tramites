/*
 * Trámites. Toda escritura va en un solo lote (transacción) junto con su entrada de bitácora.
 *   POST   /api/tramites                          crear en un paso (varios tipos = un encargo)
 *   PATCH  /api/tramites/:id                      editar datos (o confirmar un borrador)
 *   DELETE /api/tramites/:id                      borrar
 *   POST   /api/tramites/:id/estado               cambiar de estado (respeta precondiciones, fechas y radar de licencias)
 *   POST   /api/tramites/:id/precondiciones       marcar o desmarcar una (o todas)
 *   GET    /api/tramites/:id/costos-sugeridos     costos calculados con la tarifa (no guarda)
 *   POST   /api/tramites/:id/costos               guardar costos
 *   POST   /api/tramites/:id/notas                nota en la bitácora
 *   POST   /api/tramites/:id/pagos                registrar pago
 *   DELETE /api/tramites/:id/pagos/:pagoId        quitar pago
 *   POST   /api/tramites/:id/personas             agregar persona (comprador, vendedor...)
 *   DELETE /api/tramites/:id/personas/:personaId  quitar persona
 */
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  CONCEPTO_PAGO_LABEL, CONCEPTOS_PAGO, ESTADO_TARJETA_LABEL, ESTADO_TRAMITE_LABEL, ESTADOS_EN_USO, ESTADOS_REQUIEREN_PRECONDICIONES, ESTADOS_TARJETA, PRECONDICION_LABEL, PRECONDICIONES, normalizar, ROL_PERSONA_LABEL, ROLES_PERSONA, serieDe, type EstadoTramite, type Precondicion, type PrecondicionEstado,
} from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { AVISO_HONORARIOS_UNA_VEZ, calcularCostos, categoriasDeTexto, honorariosUnaVez, evaluarPrecondiciones, faltantes, hoyColombia, leerTramos, motoSinImpuesto, sumarDiasHabiles, vencimientoLicencia, DOC_COMPROMISO, pideCompromiso } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import { avaluoDe } from "./apoyo";
import { bitacora, enLista, fecha, leerParametros, nuevoId, origen, pesos, texto, textoObligatorio, type Datos, type Db } from "../util";

type Lote = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
const lote = (items: BatchItem<"sqlite">[]) => items as Lote;
const pesosTexto = (n: number) => `$${n.toLocaleString("es-CO")}`;

async function tramite(db: Db, id: string) {
  const t = await db.select().from(E.tramites).where(eq(E.tramites.id, id)).get();
  if (!t) throw new ErrorApi("El trámite no existe.", 404);
  return t;
}

export async function contextoReglas(db: Db) {
  const p = await leerParametros(db);
  return {
    rnmcActivo: p.rnmc_activo === "true",
    honorariosDefecto: Number(p.honorarios_defecto) || 0,
    tramos: leerTramos(p.impuesto_registro_tramos),
    retefuentePct: Number(p.retefuente_pct) || 0,
  };
}

/** Recalcula el estado de pago con la suma de pagos, en la misma transacción. */
const recalcularEstadoPago = (db: Db, id: string) =>
  db.update(E.tramites).set({
    estadoPago: sql`CASE
      WHEN (SELECT COALESCE(SUM(valor), 0) FROM pagos WHERE tramite_id = ${id}) <= 0 THEN 'pendiente'
      WHEN ${E.tramites.total} > 0 AND (SELECT COALESCE(SUM(valor), 0) FROM pagos WHERE tramite_id = ${id}) >= ${E.tramites.total} THEN 'pagado'
      ELSE 'abonado' END`,
  }).where(eq(E.tramites.id, id));

/**
 * El cobro sugerido al crear: los costos de cada trámite (honorarios una sola vez por encargo) y lo que Felipe tiene
 * que mirar, dicho claro. Lo usan crear y la vista previa del formulario de Nuevo trámite (con el vehículo escrito,
 * aunque todavía no esté guardado).
 */
export async function cobroSugerido(
  db: Db, tipoIds: string[], tipos: (typeof E.tiposTramite.$inferSelect)[], tarifas: (typeof E.tarifas.$inferSelect)[], ctx: Awaited<ReturnType<typeof contextoReglas>>,
  organismoId: string | null, organismo: { ciudad: string | null; nombre: string } | undefined,
  vehiculo: Pick<typeof E.vehiculos.$inferSelect, "avaluoOficial" | "avaluoDetalle" | "marca" | "linea" | "modelo" | "cilindraje" | "clase"> | undefined, categorias: string[], conClases: boolean | null,
) {
  // La retención de un traspaso: sobre el avalúo guardado del vehículo o, si no hay, el de la base gravable del año
  // por marca, línea, modelo y cilindraje (como el cotizador; antes quedaba sin retención).
  const traspaso = tipos.some((t) => /traspaso/i.test(t.nombre));
  let avaluo = vehiculo?.avaluoOficial ?? null;
  let origenAvaluo = vehiculo?.avaluoOficial ? vehiculo.avaluoDetalle ?? "avalúo guardado del vehículo" : "";
  let sugerida: { linea: string; valor: number } | null = null;
  if (traspaso && !avaluo && vehiculo?.marca && vehiculo.linea && vehiculo.modelo && !motoSinImpuesto(vehiculo)) {
    const b = await avaluoDe(db, vehiculo.marca, vehiculo.linea, vehiculo.modelo, Number(String(vehiculo.cilindraje ?? "").replace(/\D/g, "")) || null).catch(() => null);
    // Una sugerencia (no estaba la línea) no se cobra sola: se dice en el aviso del cobro.
    if (b?.sugerida) sugerida = { linea: b.linea, valor: b.valor };
    else if (b) { avaluo = b.valor; origenAvaluo = `base gravable ${b.anioFiscal}: ${b.linea}, modelo ${b.anioModeloUsado}${b.dudosas.length ? `; OJO, también encaja ${b.dudosas.map((x) => `${x.linea} (${pesosTexto(x.valor)})`).join(" y ")}: confírmelo en el SIBGA` : ""}`; }
  }
  // Los trámites del mismo encargo pagan los honorarios una sola vez.
  const todosLosCostos = honorariosUnaVez(tipoIds.map((id) => calcularCostos(tipos.find((t) => t.id === id)!, tarifas, organismoId, avaluo, ctx, vehiculo, { categorias, conClases })));
  // Lo que Felipe tiene que mirar del cobro sugerido, dicho claro (sale al registrar y en la bitácora).
  const avisosCobro: string[] = [];
  const donde = organismo?.ciudad ?? organismo?.nombre ?? "ese organismo";
  tipoIds.forEach((id, i) => {
    const tipo = tipos.find((t) => t.id === id)!;
    if (todosLosCostos[i].hayTarifa) return;
    // Una licencia sin precio dice por qué (falta con o sin clases, o esa combinación no tiene precio).
    avisosCobro.push(tipo.categoria === "licencia" && todosLosCostos[i].avisos[0] ? `${tipo.nombre}: ${todosLosCostos[i].avisos[0]}` : `${tipo.nombre}: no hay tarifa en ${donde}, sus derechos quedaron en $0. Póngalos en el cobro.`);
  });
  if (traspaso && ctx.retefuentePct > 0) {
    avisosCobro.push(avaluo
      ? `Retención (${ctx.retefuentePct} %) sobre el avalúo de ${pesosTexto(avaluo)} (${origenAvaluo}). Si es otra versión o el precio de venta es mayor, corríjala en el cobro.`
      : `Falta la retención en la fuente: no se encontró el avalúo${sugerida ? ` (no está la línea en la base gravable; la más parecida es ${sugerida.linea}, ${pesosTexto(sugerida.valor)}: si es esa, la retención es ${pesosTexto(Math.round((sugerida.valor * ctx.retefuentePct) / 100))})` : ""}; va sobre el precio de venta. Póngala en el cobro.`);
  }
  const totalSugerido = todosLosCostos.reduce((s, c) => s + c.costoDerechos + c.honorarios, 0);
  if (tipoIds.length > 1 || avisosCobro.length) avisosCobro.push(`Cobro sugerido: ${pesosTexto(totalSugerido)}${tipoIds.length > 1 ? " por todo el combo (honorarios una sola vez)" : ""}.`);
  return { todosLosCostos, avisosCobro };
}

// ─── Crear ───────────────────────────────────────────────────────────────────

export async function crearTramites(db: Db, d: Datos) {
  const tipoIds = [...new Set((Array.isArray(d.tipoIds) ? d.tipoIds : [d.tipoId]).filter((x): x is string => typeof x === "string" && !!x))];
  if (!tipoIds.length) throw new ErrorApi("Elija el tipo de trámite.");
  if (tipoIds.length > 8) throw new ErrorApi("Demasiados trámites en un mismo encargo.");
  const titularId = textoObligatorio(d.titularId, "el titular", 64);
  const vehiculoId = texto(d.vehiculoId, 64);
  const organismoId = texto(d.organismoId, 64);
  const borrador = d.borrador === true;
  // Preanotación: se anota aunque falten datos esenciales; queda con «Info incompleta» hasta completarlo.
  const preanotacion = d.preanotacion === true;
  const fechaManual = fecha(d.fechaEstimadaEntrega, "entrega");

  const [tipos, titular, vehiculo, tarifas, ctx] = await Promise.all([
    db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, tipoIds)),
    db.select().from(E.clientes).where(eq(E.clientes.id, titularId)).get(),
    vehiculoId ? db.select().from(E.vehiculos).where(eq(E.vehiculos.id, vehiculoId)).get() : Promise.resolve(undefined),
    db.select().from(E.tarifas),
    contextoReglas(db),
  ]);
  if (tipos.length !== tipoIds.length) throw new ErrorApi("Algún tipo de trámite no existe.");
  if (!titular) throw new ErrorApi("El titular no existe.", 404);
  if (vehiculoId && !vehiculo) throw new ErrorApi("El vehículo no existe.", 404);
  const organismo = organismoId ? await db.select({ id: E.organismos.id, ciudad: E.organismos.ciudad, nombre: E.organismos.nombre }).from(E.organismos).where(eq(E.organismos.id, organismoId)).get() : undefined;
  if (organismoId && !organismo) throw new ErrorApi("El organismo no existe.", 404);
  if (!borrador && !preanotacion) {
    const pideVehiculo = tipos.find((t) => t.requiereVehiculo);
    if (pideVehiculo && !vehiculo) throw new ErrorApi(`"${pideVehiculo.nombre}" necesita un vehículo.`);
  }
  const categorias = categoriasDeTexto(texto(d.detalle, 60));
  const deLicencia = tipos.filter((t) => t.categoria === "licencia");
  if (deLicencia.length && !borrador && !preanotacion) {
    if (!categorias.length) throw new ErrorApi("Indique las categorías de la licencia (por ejemplo B1 o A2).");
    if (!titular.fechaNacimiento) throw new ErrorApi("Falta la fecha de nacimiento del titular: con ella se calcula el vencimiento de la licencia.");
  }

  const hoy = hoyColombia();
  const encargoId = tipos.length > 1 ? nuevoId() : null;
  // Cada serie con su consecutivo: las licencias van en la L; los demás (y un combo mixto) en la T.
  const serie = serieDe(tipos.map((t) => t.categoria));
  const siguiente = sql`(SELECT COALESCE(MAX(numero), 0) + 1 FROM tramites WHERE serie = ${serie})`;
  const licenciaId = texto(d.licenciaId, 64);
  const ids: string[] = [];
  const items: BatchItem<"sqlite">[] = [];
  const { todosLosCostos, avisosCobro } = await cobroSugerido(db, tipoIds, tipos, tarifas, ctx, organismoId, organismo, vehiculo, categorias, typeof d.conClases === "boolean" ? d.conClases : null);
  for (const [i, id] of tipoIds.entries()) {
    const tipo = tipos.find((t) => t.id === id)!;
    const tramiteId = nuevoId();
    ids.push(tramiteId);
    const costos = todosLosCostos[i];
    const entrega = fechaManual ?? (tipo.slaDias ? sumarDiasHabiles(hoy, tipo.slaDias) : null);
    items.push(
      db.insert(E.tramites).values({
        id: tramiteId,
        numero: siguiente,
        serie,
        // Un combo lleva un solo código: el número del primero (en el mismo lote, ya insertado).
        codigo: encargoId ? (i === 0 ? siguiente : sql`(SELECT numero FROM tramites WHERE id = ${ids[0]})`) : null,
        tipoId: tipo.id,
        titularId,
        vehiculoId: tipo.requiereVehiculo || vehiculoId ? vehiculoId : null,
        organismoId,
        encargoId,
        borrador,
        detalle: tipo.categoria === "licencia" ? categorias.join(",") || null : texto(d.detalle, 60),
        conClases: tipo.categoria === "licencia" && /expedici/i.test(normalizar(tipo.nombre)) && typeof d.conClases === "boolean" ? d.conClases : null,
        fechaEstimadaEntrega: entrega,
        costoDerechos: costos.costoDerechos,
        honorarios: costos.honorarios,
        total: costos.costoDerechos + costos.honorarios,
        observaciones: texto(d.observaciones, 4000),
      }),
    );
    const resumen = [
      borrador ? "Borrador creado" : preanotacion ? "Trámite preanotado (con info incompleta)" : "Trámite creado",
      encargoId ? `(encargo de ${tipos.length} trámites)` : "",
      entrega ? `· entrega estimada ${entrega}` : "",
      `· costos sugeridos ${pesosTexto(costos.costoDerechos + costos.honorarios)}`,
      costos.avisos.length ? `· ${costos.avisos.filter((a) => !/^No hay tarifa|^La retención en la fuente depende/.test(a)).join(" ")}` : "",
      i === 0 && avisosCobro.length ? `· ${avisosCobro.join(" ")}` : "",
    ].filter(Boolean).join(" ");
    items.push(bitacora(db, tramiteId, "creacion", resumen, { estadoNuevo: "en_preparacion", origen: origen(d.origen), referencia: texto(d.referencia, 200) }));
    // Primera vez (expedición): la carta de compromiso, pendiente hasta que se suba firmada (el trámite lo alerta).
    if (pideCompromiso(tipo)) items.push(db.insert(E.documentos).values({ id: nuevoId(), tramiteId, tipoDocumento: DOC_COMPROMISO, origen: "sistema" }));
  }
  // Renovación creada desde el radar de licencias: la licencia queda agendada y enlazada.
  if (licenciaId) {
    items.push(db.update(E.licencias).set({ gestionEstado: "agendado", gestionFecha: hoy, tramiteId: ids[0] }).where(and(eq(E.licencias.id, licenciaId), eq(E.licencias.clienteId, titularId))));
  }
  await db.batch(lote(items));
  return json({ ids, avisos: avisosCobro });
}

// ─── Editar datos ────────────────────────────────────────────────────────────

const ETIQUETAS: Record<string, string> = {
  organismoId: "organismo", fechaEstimadaEntrega: "entrega estimada", fechaRadicado: "fecha de radicado", detalle: "detalle",
  aliado: "aliado", estadoTarjeta: "tarjeta física", observaciones: "observaciones", vehiculoId: "vehículo", titularId: "titular", conClases: "clases",
};

export async function editarTramite(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  const tiene = (k: string) => k in d;
  const c: Partial<typeof E.tramites.$inferInsert> = {};
  if (tiene("organismoId")) c.organismoId = texto(d.organismoId, 64);
  if (tiene("fechaEstimadaEntrega")) c.fechaEstimadaEntrega = fecha(d.fechaEstimadaEntrega, "entrega");
  if (tiene("fechaRadicado")) c.fechaRadicado = fecha(d.fechaRadicado, "radicado");
  if (tiene("detalle")) c.detalle = texto(d.detalle, 60);
  if (tiene("aliado")) c.aliado = texto(d.aliado, 160);
  if (tiene("observaciones")) c.observaciones = texto(d.observaciones, 4000);
  if (tiene("estadoTarjeta")) c.estadoTarjeta = d.estadoTarjeta ? enLista(d.estadoTarjeta, ESTADOS_TARJETA, "tarjeta física") : null;
  if (tiene("vehiculoId")) c.vehiculoId = texto(d.vehiculoId, 64);
  if (tiene("titularId")) c.titularId = textoObligatorio(d.titularId, "el titular", 64);
  if (tiene("conClases")) c.conClases = typeof d.conClases === "boolean" ? d.conClases : null;

  const tipo = (await db.select().from(E.tiposTramite).where(eq(E.tiposTramite.id, t.tipoId)).get())!;
  if (c.vehiculoId && !(await db.select({ id: E.vehiculos.id }).from(E.vehiculos).where(eq(E.vehiculos.id, c.vehiculoId)).get())) throw new ErrorApi("El vehículo no existe.", 404);
  if (c.titularId && !(await db.select({ id: E.clientes.id }).from(E.clientes).where(eq(E.clientes.id, c.titularId)).get())) throw new ErrorApi("El titular no existe.", 404);
  if (tipo.categoria === "licencia" && tiene("detalle")) {
    const cats = categoriasDeTexto(c.detalle);
    if (!cats.length) throw new ErrorApi("Indique las categorías de la licencia (por ejemplo B1 o A2).");
    c.detalle = cats.join(",");
  }
  const confirmar = d.borrador === false && t.borrador;
  if (confirmar) {
    const vehiculo = tiene("vehiculoId") ? c.vehiculoId : t.vehiculoId;
    if (tipo.requiereVehiculo && !vehiculo) throw new ErrorApi(`"${tipo.nombre}" necesita un vehículo para confirmarse.`);
    c.borrador = false;
  }

  const cambios = Object.entries(c).filter(([k, v]) => k !== "borrador" && (t as Record<string, unknown>)[k] !== v);
  if (!cambios.length && !confirmar) return json({ id });
  const descripcion = [
    confirmar ? "Borrador confirmado" : "",
    ...cambios.map(([k, v]) => {
      const nombre = ETIQUETAS[k] ?? k;
      if (k === "estadoTarjeta") return `${nombre}: ${v ? ESTADO_TARJETA_LABEL[v as keyof typeof ESTADO_TARJETA_LABEL] : "no aplica"}`;
      if (k === "observaciones") return "observaciones actualizadas";
      if (k === "conClases") return v === true ? "con clases" : v === false ? "sin clases" : "clases: sin decir";
      if (k.endsWith("Id")) return `${nombre} cambiado`;
      return `${nombre}: ${v ?? "sin dato"}`;
    }),
  ].filter(Boolean).join(" · ");
  await db.batch([db.update(E.tramites).set(c).where(eq(E.tramites.id, id)), bitacora(db, id, "datos", descripcion, { origen: origen(d.origen), referencia: texto(d.referencia, 200) })]);
  return json({ id });
}

/** "Chicharrón" (un problema raro): se pone o se quita en el trámite y en las demás partes vigentes de su combo. */
export async function marcarProblema(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  if (typeof d.problema !== "boolean") throw new ErrorApi("Diga si se marca o se quita.");
  const partes = t.encargoId ? (await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId))).filter((x) => x.id === t.id || x.estado !== "cancelado") : [t];
  const cambian = partes.filter((x) => x.problema !== d.problema);
  if (!cambian.length) return json({ id });
  await db.batch([
    ...cambian.map((x) => db.update(E.tramites).set({ problema: d.problema as boolean }).where(eq(E.tramites.id, x.id))),
    bitacora(db, id, "nota", d.problema ? "Marcado como chicharrón: tiene un problema." : "Se quitó el chicharrón: el problema se resolvió.", { origen: origen(d.origen) }),
  ] as never);
  return json({ id });
}

export async function borrarTramite(db: Db, id: string) {
  const r = await db.delete(E.tramites).where(eq(E.tramites.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("El trámite no existe.", 404);
  return json({ ok: true });
}

// ─── Estado ──────────────────────────────────────────────────────────────────

/**
 * La misma función la usan la app, el asistente y las notificaciones de WhatsApp.
 * Sin excepciones: pasar a cualquier estado que exige precondiciones (incluido "entregado") las revisa.
 */
export async function cambiarEstado(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  const estado = enLista(d.estado, ESTADOS_EN_USO, "estado") as EstadoTramite;
  // Un combo (traspaso + levantamiento de prenda...) es un solo trámite para la oficina: se mueve junto. Cancelar no:
  // se puede cancelar una sola parte ("al final no levanta la prenda").
  const otras = t.encargoId && estado !== "cancelado" && !t.borrador
    ? (await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId))).filter((x) => x.id !== t.id && !x.borrador && x.estado !== "cancelado" && x.estado !== estado)
    : [];
  if (otras.length && ESTADOS_REQUIEREN_PRECONDICIONES.includes(estado)) {
    // Todas las partes deben estar listas antes de mover cualquiera.
    const [ctx, tipos] = await Promise.all([contextoReglas(db), db.select().from(E.tiposTramite)]);
    const hoy = hoyColombia();
    const faltas: string[] = [], flags = new Set<string>();
    for (const x of [t, ...otras]) {
      const tipo = tipos.find((y) => y.id === x.tipoId)!;
      const vehiculo = x.vehiculoId ? await db.select().from(E.vehiculos).where(eq(E.vehiculos.id, x.vehiculoId)).get() : undefined;
      const falta = faltantes(evaluarPrecondiciones(tipo, x.precondicionesEstado, vehiculo ?? null, hoy, ctx.rnmcActivo));
      if (falta.length) faltas.push(`${tipo.nombre}: ${falta.map((f) => f.nombre).join(", ")}`);
      for (const f of falta) flags.add(f.flag);
    }
    if (faltas.length) return json({ error: `Faltan precondiciones del combo. ${faltas.join(". ")}.`, faltantes: [...flags] }, 409);
  }
  const r = await cambiarEstadoDe(db, t, estado, d);
  if (r.status !== 200) return r;
  for (const x of otras) await cambiarEstadoDe(db, x, estado, d);
  return r;
}

/** Cambia el estado de un solo trámite (de un combo, una parte). */
async function cambiarEstadoDe(db: Db, t: typeof E.tramites.$inferSelect, estado: EstadoTramite, d: Datos) {
  const id = t.id;
  if (t.estado === estado) return json({ id, estado });
  if (t.borrador && estado !== "cancelado") throw new ErrorApi("Es un borrador: complete y confirme el trámite antes de moverlo.", 409);

  const [tipo, vehiculo, titular, ctx] = await Promise.all([
    db.select().from(E.tiposTramite).where(eq(E.tiposTramite.id, t.tipoId)).get(),
    t.vehiculoId ? db.select().from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get() : Promise.resolve(undefined),
    db.select().from(E.clientes).where(eq(E.clientes.id, t.titularId)).get(),
    contextoReglas(db),
  ]);
  const hoy = hoyColombia();
  if (ESTADOS_REQUIEREN_PRECONDICIONES.includes(estado)) {
    const falta = faltantes(evaluarPrecondiciones(tipo!, t.precondicionesEstado, vehiculo ?? null, hoy, ctx.rnmcActivo));
    if (falta.length) {
      return json({ error: `Faltan ${falta.length} precondición(es): ${falta.map((f) => f.nombre).join(", ")}.`, faltantes: falta.map((f) => f.flag) }, 409);
    }
  }

  const c: Partial<typeof E.tramites.$inferInsert> = { estado };
  if (estado === "en_tramite" && !t.fechaRadicado) c.fechaRadicado = hoy;
  if (estado === "entregado") c.fechaEntrega = hoy;
  // Si se reabre un trámite finalizado, deja de tener fecha de entrega (si no, el expediente diría que se entregó).
  else if (t.estado === "entregado") c.fechaEntrega = null;
  const extra = { estadoAnterior: t.estado, estadoNuevo: estado, origen: origen(d.origen), referencia: texto(d.referencia, 200) };
  const items: BatchItem<"sqlite">[] = [
    db.update(E.tramites).set(c).where(eq(E.tramites.id, id)),
    bitacora(db, id, "cambio_estado", `${ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite]} → ${ESTADO_TRAMITE_LABEL[estado]}`, extra),
  ];

  // Radar de licencias: al entregar un trámite de licencia se registra (o renueva) cada categoría.
  const categorias = categoriasDeTexto(t.detalle);
  if (estado === "entregado" && tipo?.categoria === "licencia" && categorias.length) {
    const vencimientos = categorias.map((categoria) => ({ categoria, vence: vencimientoLicencia(hoy, categoria, titular?.fechaNacimiento) }));
    for (const v of vencimientos) {
      const campos = { fechaExpedicion: hoy, fechaVencimiento: v.vence, origen: "tramite", tramiteId: id, gestionEstado: "renovado", gestionFecha: hoy };
      items.push(
        db.insert(E.licencias).values({ id: nuevoId(), clienteId: t.titularId, categoria: v.categoria, ...campos })
          .onConflictDoUpdate({ target: [E.licencias.clienteId, E.licencias.categoria], set: campos }),
      );
    }
    items.push(bitacora(db, id, "nota", `Licencia ${vencimientos.map((v) => `${v.categoria} (vence ${v.vence})`).join(", ")} registrada en el radar${titular?.fechaNacimiento ? "" : " · sin fecha de nacimiento se asumió menor de 60 años"}`, { origen: "sistema" }));
  }
  await db.batch(lote(items));
  return json({ id, estado });
}

// ─── Precondiciones ──────────────────────────────────────────────────────────

/**
 * Marca una precondición (o todas con { todas: true }). Nunca borra las notas de las demás.
 * En un combo las precondiciones son una sola lista: se marca en todas las partes (no canceladas) cuyo tipo la tiene
 * (si ninguna la tiene, en esta), y "todas" marca las de cada parte. `soloEste: true` la marca solo en este trámite
 * (para quien ya recorre las partes).
 */
export async function marcarPrecondicion(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  const hoy = hoyColombia();
  const partes = t.encargoId && d.soloEste !== true
    ? (await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId))).filter((x) => x.id === t.id || x.estado !== "cancelado")
    : [t];
  const tipos = new Map((await db.select().from(E.tiposTramite).where(inArray(E.tiposTramite.id, [...new Set(partes.map((x) => x.tipoId))]))).map((x) => [x.id, x]));
  const aplica = (x: typeof t, flag: string) => !!(tipos.get(x.tipoId)?.precondiciones as Record<string, boolean> | undefined)?.[flag];
  const cambios: { x: typeof t; previo: Partial<Record<Precondicion, PrecondicionEstado>>; descripcion: string }[] = [];
  if (d.todas === true) {
    for (const x of partes) {
      const previo = { ...x.precondicionesEstado } as Partial<Record<Precondicion, PrecondicionEstado>>;
      for (const [flag, si] of Object.entries(tipos.get(x.tipoId)?.precondiciones ?? {})) {
        if (si) previo[flag as Precondicion] = { ...previo[flag as Precondicion], ok: true, fecha: hoy };
      }
      cambios.push({ x, previo, descripcion: partes.length > 1 ? "Todas las precondiciones del combo marcadas" : "Todas las precondiciones marcadas" });
    }
  } else {
    const flag = enLista(d.flag, PRECONDICIONES, "precondición");
    const cuales = partes.filter((x) => aplica(x, flag));
    for (const x of cuales.length ? cuales : [t]) {
      const previo = { ...x.precondicionesEstado } as Partial<Record<Precondicion, PrecondicionEstado>>;
      const anterior = previo[flag] ?? {};
      const ok = "ok" in d ? d.ok === true : !!anterior.ok;
      const nota = "nota" in d ? texto(d.nota, 500) ?? undefined : anterior.nota;
      previo[flag] = { ...anterior, ok, fecha: ok ? anterior.fecha ?? hoy : undefined, nota };
      cambios.push({ x, previo, descripcion: `${PRECONDICION_LABEL[flag]}: ${ok ? "cumplida" : "pendiente"}${"nota" in d && nota ? ` · ${nota}` : ""}` });
    }
  }
  await db.batch(lote(cambios.flatMap(({ x, previo, descripcion }) => [
    db.update(E.tramites).set({ precondicionesEstado: previo }).where(eq(E.tramites.id, x.id)),
    bitacora(db, x.id, "precondicion", descripcion, { origen: origen(d.origen), referencia: texto(d.referencia, 200) }),
  ])));
  return json({ id });
}

// ─── Costos y pagos ──────────────────────────────────────────────────────────

export async function costosSugeridos(db: Db, id: string) {
  const t = await tramite(db, id);
  const [tipo, tarifas, vehiculo, ctx] = await Promise.all([
    db.select().from(E.tiposTramite).where(eq(E.tiposTramite.id, t.tipoId)).get(),
    db.select().from(E.tarifas).where(eq(E.tarifas.tipoTramiteId, t.tipoId)),
    t.vehiculoId ? db.select().from(E.vehiculos).where(eq(E.vehiculos.id, t.vehiculoId)).get() : Promise.resolve(undefined),
    contextoReglas(db),
  ]);
  const c = calcularCostos(tipo!, tarifas, t.organismoId, vehiculo?.avaluoOficial ?? null, ctx, vehiculo, { categorias: categoriasDeTexto(t.detalle), conClases: t.conClases });
  // En un encargo, si otro trámite ya lleva los honorarios, este va sin ellos.
  if (t.encargoId && c.honorarios) {
    const otro = await db.select({ id: E.tramites.id }).from(E.tramites)
      .where(and(eq(E.tramites.encargoId, t.encargoId), ne(E.tramites.id, t.id), gt(E.tramites.honorarios, 0))).get();
    if (otro) return json({ ...c, honorarios: 0, avisos: [...c.avisos, AVISO_HONORARIOS_UNA_VEZ] });
  }
  return json(c);
}

export async function guardarCostos(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  const costoDerechos = pesos(d.costoDerechos, "derechos");
  const honorarios = pesos(d.honorarios, "honorarios");
  const otrosCostos = pesos(d.otrosCostos, "otros costos");
  const total = costoDerechos + honorarios + otrosCostos;
  await db.batch([
    db.update(E.tramites).set({ costoDerechos, honorarios, otrosCostos, total }).where(eq(E.tramites.id, id)),
    recalcularEstadoPago(db, id),
    bitacora(db, id, "costos", `Costos: total ${pesosTexto(t.total)} → ${pesosTexto(total)} (derechos ${pesosTexto(costoDerechos)}, honorarios ${pesosTexto(honorarios)}, otros ${pesosTexto(otrosCostos)})`, { origen: origen(d.origen) }),
  ]);
  return json({ id, total });
}

/**
 * El valor que se le cobra al cliente por todo el encargo ("ese trámite vale 100.000"): va en el trámite que lleva los
 * honorarios (estos se dejan como estaban, hasta el valor; el resto son derechos) y los demás del encargo quedan en cero.
 */
export async function fijarValor(db: Db, id: string, d: Datos) {
  const t = await tramite(db, id);
  const valor = pesos(d.valor, "valor");
  if (valor <= 0) throw new ErrorApi("El valor debe ser mayor a cero.");
  const filas = t.encargoId ? await db.select().from(E.tramites).where(eq(E.tramites.encargoId, t.encargoId)) : [t];
  const principal = [...filas].sort((a, b) => b.honorarios - a.honorarios || b.total - a.total || a.numero - b.numero)[0];
  const honorarios = Math.min(principal.honorarios, valor);
  await guardarCostos(db, principal.id, { costoDerechos: valor - honorarios, honorarios, otrosCostos: 0, origen: d.origen });
  for (const f of filas) if (f.id !== principal.id && f.total) await guardarCostos(db, f.id, { costoDerechos: 0, honorarios: 0, otrosCostos: 0, origen: d.origen });
  return json({ id: principal.id, total: valor });
}

export async function agregarPago(db: Db, id: string, d: Datos) {
  await tramite(db, id);
  const valor = pesos(d.valor, "pago");
  if (valor <= 0) throw new ErrorApi("El valor del pago debe ser mayor a cero.");
  const concepto = d.concepto ? enLista(d.concepto, CONCEPTOS_PAGO, "concepto") : "abono";
  const fechaPago = fecha(d.fecha, "pago") ?? hoyColombia();
  const pagoId = nuevoId();
  await db.batch([
    db.insert(E.pagos).values({ id: pagoId, tramiteId: id, concepto, valor, fecha: fechaPago, metodo: texto(d.metodo, 60) }),
    recalcularEstadoPago(db, id),
    bitacora(db, id, "pago", `Pago de ${pesosTexto(valor)} (${CONCEPTO_PAGO_LABEL[concepto]}${texto(d.metodo, 60) ? `, ${texto(d.metodo, 60)}` : ""}) del ${fechaPago}`, { origen: origen(d.origen), referencia: texto(d.referencia, 200) }),
  ]);
  return json({ id: pagoId });
}

export async function quitarPago(db: Db, id: string, pagoId: string) {
  const p = await db.select().from(E.pagos).where(and(eq(E.pagos.id, pagoId), eq(E.pagos.tramiteId, id))).get();
  if (!p) throw new ErrorApi("El pago no existe.", 404);
  await db.batch([
    db.delete(E.pagos).where(eq(E.pagos.id, pagoId)),
    recalcularEstadoPago(db, id),
    bitacora(db, id, "pago", `Pago de ${pesosTexto(p.valor)} del ${p.fecha} eliminado`),
  ]);
  return json({ ok: true });
}

// ─── Notas y personas ────────────────────────────────────────────────────────

export async function agregarNota(db: Db, id: string, d: Datos) {
  await tramite(db, id);
  const nota = textoObligatorio(d.texto, "el texto de la nota", 2000);
  await bitacora(db, id, "nota", nota, { origen: origen(d.origen), referencia: texto(d.referencia, 200) }).run();
  return json({ ok: true });
}

/** Corrige el texto de una entrada de la bitácora (cualquiera: una nota mal escrita, un cambio mal descrito). */
export async function editarBitacora(db: Db, id: string, entradaId: string, d: Datos) {
  const b = await db.select({ id: E.bitacora.id }).from(E.bitacora).where(and(eq(E.bitacora.id, entradaId), eq(E.bitacora.tramiteId, id))).get();
  if (!b) throw new ErrorApi("Esa entrada de la bitácora no existe.", 404);
  const descripcion = textoObligatorio(d.texto, "el texto", 2000);
  await db.update(E.bitacora).set({ descripcion }).where(eq(E.bitacora.id, entradaId)).run();
  return json({ ok: true });
}

/** Cuántas notas se fijan con la chinche arriba del expediente (más, ya no se leen de un vistazo). */
export const MAX_FIJADAS = 4;

/**
 * La nota destacada del trámite (la estrella): una entrada de su bitácora que sale grande arriba del expediente (por
 * ejemplo, "en Bogotá lo rechazaron por una firma"). Una sola por trámite: al destacar otra, la anterior no se pierde,
 * queda fijada. `{ fijada }`: la chinche, varias pequeñas al lado de la destacada (hasta MAX_FIJADAS); fijar la
 * destacada la pasa a fijada.
 */
export async function destacarBitacora(db: Db, id: string, entradaId: string, d: Datos) {
  const b = await db.select({ id: E.bitacora.id, fijada: E.bitacora.fijada }).from(E.bitacora).where(and(eq(E.bitacora.id, entradaId), eq(E.bitacora.tramiteId, id))).get();
  if (!b) throw new ErrorApi("Esa entrada de la bitácora no existe.", 404);
  if ("fijada" in d) {
    if (d.fijada && !b.fijada) {
      const fijadas = await db.select({ id: E.bitacora.id }).from(E.bitacora).where(and(eq(E.bitacora.tramiteId, id), eq(E.bitacora.fijada, true))).all();
      if (fijadas.length >= MAX_FIJADAS) throw new ErrorApi(`Ya hay ${MAX_FIJADAS} notas fijadas en este trámite: quite una para fijar otra.`, 409);
    }
    await db.update(E.bitacora).set(d.fijada ? { fijada: true, destacada: false } : { fijada: false }).where(eq(E.bitacora.id, entradaId)).run();
  } else if (d.destacada) {
    await db.batch([
      db.update(E.bitacora).set({ destacada: false, fijada: true }).where(and(eq(E.bitacora.tramiteId, id), eq(E.bitacora.destacada, true), ne(E.bitacora.id, entradaId))),
      db.update(E.bitacora).set({ destacada: true, fijada: false }).where(eq(E.bitacora.id, entradaId)),
    ]);
  } else await db.update(E.bitacora).set({ destacada: false }).where(eq(E.bitacora.id, entradaId)).run();
  return json({ ok: true });
}

/** Borra una entrada de la bitácora (una nota equivocada, un registro que sobra). */
export async function borrarBitacora(db: Db, id: string, entradaId: string) {
  // Cualquier entrada (una nota escrita por error, lo que dejó un archivo pegado por accidente): nada de la app depende
  // de ellas; se pregunta antes en la pantalla.
  const b = await db.select({ id: E.bitacora.id }).from(E.bitacora).where(and(eq(E.bitacora.id, entradaId), eq(E.bitacora.tramiteId, id))).get();
  if (!b) throw new ErrorApi("Esa entrada de la bitácora no existe.", 404);
  await db.delete(E.bitacora).where(eq(E.bitacora.id, entradaId)).run();
  return json({ ok: true });
}

export async function agregarPersona(db: Db, id: string, d: Datos) {
  await tramite(db, id);
  const clienteId = textoObligatorio(d.clienteId, "la persona", 64);
  const cliente = await db.select({ nombre: E.clientes.nombre }).from(E.clientes).where(eq(E.clientes.id, clienteId)).get();
  if (!cliente) throw new ErrorApi("La persona no existe.", 404);
  const rol = d.rol ? enLista(d.rol, ROLES_PERSONA, "rol") : "interviniente";
  const personaId = nuevoId();
  try {
    await db.batch([
      db.insert(E.tramitePersonas).values({ id: personaId, tramiteId: id, clienteId, rol }),
      bitacora(db, id, "persona", `${cliente.nombre} agregado como ${ROL_PERSONA_LABEL[rol].toLowerCase()}`, { origen: origen(d.origen) }),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message))) throw new ErrorApi("Esa persona ya está en el trámite con ese rol.", 409);
    throw e;
  }
  return json({ id: personaId });
}

/** Cambia el rol de una persona del trámite (quedó como comprador y era apoderado...), con su nota en la bitácora. */
export async function cambiarRolPersona(db: Db, id: string, personaId: string, d: Datos) {
  const rol = enLista(d.rol, ROLES_PERSONA, "rol");
  if (rol === "titular") throw new ErrorApi("El titular se cambia en los datos del trámite.");
  const p = await db
    .select({ rol: E.tramitePersonas.rol, nombre: E.clientes.nombre })
    .from(E.tramitePersonas)
    .innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId))
    .where(and(eq(E.tramitePersonas.id, personaId), eq(E.tramitePersonas.tramiteId, id)))
    .get();
  if (!p) throw new ErrorApi("La persona no está en el trámite.", 404);
  if (p.rol === rol) return json({ ok: true });
  const etiqueta = (r: string) => ROL_PERSONA_LABEL[r as keyof typeof ROL_PERSONA_LABEL].toLowerCase();
  try {
    await db.batch([
      db.update(E.tramitePersonas).set({ rol }).where(eq(E.tramitePersonas.id, personaId)),
      bitacora(db, id, "persona", `${p.nombre}: de ${etiqueta(p.rol)} a ${etiqueta(rol)}`, { origen: origen(d.origen) }),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message))) throw new ErrorApi("Esa persona ya está en el trámite con ese rol.", 409);
    throw e;
  }
  return json({ ok: true });
}

export async function quitarPersona(db: Db, id: string, personaId: string, d: Datos = {}) {
  const p = await db
    .select({ rol: E.tramitePersonas.rol, nombre: E.clientes.nombre })
    .from(E.tramitePersonas)
    .innerJoin(E.clientes, eq(E.clientes.id, E.tramitePersonas.clienteId))
    .where(and(eq(E.tramitePersonas.id, personaId), eq(E.tramitePersonas.tramiteId, id)))
    .get();
  if (!p) throw new ErrorApi("La persona no está en el trámite.", 404);
  await db.batch([
    db.delete(E.tramitePersonas).where(eq(E.tramitePersonas.id, personaId)),
    bitacora(db, id, "persona", `${p.nombre} quitado (${ROL_PERSONA_LABEL[p.rol as keyof typeof ROL_PERSONA_LABEL].toLowerCase()})`, { origen: origen(d.origen) }),
  ]);
  return json({ ok: true });
}
