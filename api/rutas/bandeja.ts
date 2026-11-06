/*
 * Bandeja del asistente: un resumen al día con todo lo pendiente, a las 6:30 a. m. (Colombia). Nada de avisos sueltos
 * durante el día: lo que quedó abierto de días anteriores, recordatorios y cobros llegan juntos en un solo resumen.
 *
 *   GET   /api/bandeja           Los últimos 7 resúmenes (el de hoy primero). Si ya pasaron las 6:30 y el de hoy no
 *                                existe (el cron falló o aún no corre), se arma en ese momento.
 *   PATCH /api/bandeja/:fecha    { leido: true } al abrirlo.
 */
import { and, desc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { codigoTramite, ESTADO_TRAMITE_LABEL, ESTADOS_TERMINALES, type EstadoTramite } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { hoyColombia } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import type { Datos, Db } from "../util";
import { faltanDe, pagadoDe, pesos } from "./asistente";
import { revisionesIncompletas } from "./revision";
import { listaPartes } from "../../compartido/revision";

/** Hora (Colombia) desde la que existe el resumen del día. La misma del cron "30 11 * * *" (UTC). */
const HORA_RESUMEN = "06:30";
const DIAS_GUARDADOS = 7;

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta.slice(0, 10)}T12:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T12:00:00Z`)) / 10_000_000);
const hace = (n: number) => (n <= 0 ? "hoy" : n === 1 ? "hace 1 día" : `hace ${n} días`);
const horaColombia = () => new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false });

/** Arma el resumen de hoy y lo guarda. Si ya existe no lo toca (es la foto de las 6:30). */
export async function generarResumen(db: Db) {
  const hoy = hoyColombia();
  const existente = await db.select({ fecha: E.resumenesDiarios.fecha }).from(E.resumenesDiarios).where(eq(E.resumenesDiarios.fecha, hoy)).get();
  if (existente) return { fecha: hoy, nuevo: false };

  // Trámites abiertos que vienen de días anteriores (los de hoy todavía no son pendientes).
  const abiertos = await db.select().from(E.tramites)
    .where(and(notInArray(E.tramites.estado, ESTADOS_TERMINALES), sql`substr(${E.tramites.creado}, 1, 10) < ${hoy}`))
    .orderBy(E.tramites.numero);
  const [tipos, clientes, vehiculos] = await Promise.all([
    db.select({ id: E.tiposTramite.id, nombre: E.tiposTramite.nombre }).from(E.tiposTramite),
    abiertos.length ? db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(inArray(E.clientes.id, [...new Set(abiertos.map((t) => t.titularId))])) : Promise.resolve([]),
    abiertos.some((t) => t.vehiculoId) ? db.select({ id: E.vehiculos.id, placa: E.vehiculos.placa }).from(E.vehiculos).where(inArray(E.vehiculos.id, [...new Set(abiertos.flatMap((t) => (t.vehiculoId ? [t.vehiculoId] : [])))])) : Promise.resolve([]),
  ]);
  const tipo = new Map(tipos.map((x) => [x.id, x.nombre]));
  const cli = new Map(clientes.map((x) => [x.id, x.nombre]));
  const pla = new Map(vehiculos.map((x) => [x.id, x.placa]));

  // Un combo (traspaso + levantamiento de prenda...) sale una sola vez, con sus trámites juntos.
  const combo = new Map<string, string>();
  for (const t of abiertos) if (t.encargoId) combo.set(t.encargoId, [combo.get(t.encargoId), tipo.get(t.tipoId)].filter(Boolean).join(" + "));
  const item = (t: (typeof abiertos)[number], detalle: string): E.ItemResumen => {
    const numero = codigoTramite(t);
    const placa = t.vehiculoId ? pla.get(t.vehiculoId) : null;
    const titular = cli.get(t.titularId);
    return {
      texto: [numero, t.encargoId ? combo.get(t.encargoId) : tipo.get(t.tipoId), placa, titular].filter(Boolean).join(" · "),
      detalle, tramiteId: t.id,
      referencia: `${numero}${placa || titular ? ` (${[placa, titular].filter(Boolean).join(", ")})` : ""}: `,
    };
  };
  const correccion: E.ItemResumen[] = [], atrasados: E.ItemResumen[] = [], enTransito: E.ItemResumen[] = [], recibidos: E.ItemResumen[] = [], borradores: E.ItemResumen[] = [];
  for (const t of abiertos.filter((x, i) => !x.encargoId || abiertos.findIndex((y) => y.encargoId === x.encargoId) === i)) {
    const recibido = diasEntre(t.creado, hoy);
    if (t.borrador) { borradores.push(item(t, `Creado ${hace(recibido)} y sin confirmar`)); continue; }
    const estado = ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite];
    const desde = t.estado === "en_tramite" && t.fechaRadicado ? `${estado} ${hace(diasEntre(t.fechaRadicado, hoy))}` : `${estado} ${hace(recibido)}`;
    const atraso = t.fechaEstimadaEntrega && t.fechaEstimadaEntrega < hoy ? diasEntre(t.fechaEstimadaEntrega, hoy) : 0;
    if (t.estado === "requiere_correccion") correccion.push(item(t, `${desde}${atraso ? ` · atrasado ${atraso} día${atraso === 1 ? "" : "s"}` : ""}`));
    else if (atraso) atrasados.push(item(t, `${desde} · debía salir el ${fechaCorta(t.fechaEstimadaEntrega!)} (${atraso} día${atraso === 1 ? "" : "s"} de atraso)`));
    else if (t.estado === "en_tramite") enTransito.push(item(t, `${desde}${t.fechaEstimadaEntrega ? ` · sale el ${fechaCorta(t.fechaEstimadaEntrega)}` : ""}`));
    else recibidos.push(item(t, `${desde}, sin radicar`));
  }

  // Revisiones previas a las que algo no les llegó de PlacApi: se puede pedir de nuevo solo eso.
  const incompletas = await revisionesIncompletas(db, abiertos.filter((t) => !t.borrador).map((t) => t.id));
  const revisiones = abiertos.filter((t) => incompletas.has(t.id)).filter((t, i, l) => !t.encargoId || l.findIndex((y) => y.encargoId === t.encargoId) === i).map((t) => item(t, `No llegó: ${listaPartes(incompletas.get(t.id)!)}. En el trámite: Revisión previa → Pedir de nuevo lo que faltó.`));

  // Preanotados: trámites abiertos a los que les falta un dato esencial (Info incompleta).
  const faltan = await faltanDe(db, abiertos.filter((t) => !t.borrador));
  const infoIncompleta = abiertos.filter((t) => faltan.has(t.id)).filter((t, i, l) => !t.encargoId || l.findIndex((y) => y.encargoId === t.encargoId) === i)
    .map((t) => { const f = faltan.get(t.id)!; return item(t, `Falta ${f.length > 1 ? `${f.slice(0, -1).join(", ")} y ${f.at(-1)}` : f[0]}`); });

  // Recordatorios, llamadas y citas de hoy o atrasados (incluye los vencimientos de SOAT, técnico-mecánica y licencias).
  const recordatorios = await db.select().from(E.recordatorios)
    .where(and(eq(E.recordatorios.estado, "pendiente"), lte(E.recordatorios.fecha, hoy)))
    .orderBy(E.recordatorios.fecha, E.recordatorios.hora).limit(40);
  const tipoRec = { recordatorio: "Recordatorio", llamada: "Llamada", cita: "Cita" } as Record<string, string>;
  const pendientesRec: E.ItemResumen[] = recordatorios.map((r) => ({
    texto: r.titulo,
    detalle: `${tipoRec[r.tipo] ?? "Recordatorio"} · ${r.fecha === hoy ? `hoy${r.hora ? ` a las ${r.hora}` : ""}` : `desde el ${fechaCorta(r.fecha)}`}`,
    recordatorioId: r.id, tramiteId: r.tramiteId ?? undefined,
  }));

  // Por cobrar: trámites finalizados que todavía tienen saldo.
  const finalizados = await db.select().from(E.tramites).where(and(eq(E.tramites.estado, "entregado"), sql`${E.tramites.total} > 0`));
  const pagado = await pagadoDe(db, finalizados.map((t) => t.id));
  const conSaldo = finalizados.map((t) => ({ t, saldo: t.total - (pagado.get(t.id) ?? 0) })).filter((x) => x.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const porCobrarTotal = conSaldo.reduce((s, x) => s + x.saldo, 0);
  const clientesCobro = conSaldo.length ? new Map((await db.select({ id: E.clientes.id, nombre: E.clientes.nombre }).from(E.clientes).where(inArray(E.clientes.id, [...new Set(conSaldo.slice(0, 10).map((x) => x.t.titularId))]))).map((c) => [c.id, c.nombre])) : new Map<string, string>();
  const cobros: E.ItemResumen[] = conSaldo.slice(0, 10).map(({ t, saldo }) => {
    const numero = codigoTramite(t);
    const titular = clientesCobro.get(t.titularId);
    return { texto: [numero, titular].filter(Boolean).join(" · "), detalle: `Debe ${pesos(saldo)}${t.fechaEntrega ? ` · finalizado el ${fechaCorta(t.fechaEntrega)}` : ""}`, tramiteId: t.id, referencia: `${numero}${titular ? ` (${titular})` : ""}: ` };
  });

  const secciones: E.SeccionResumen[] = [
    { clave: "correccion", titulo: "Requieren corrección", items: correccion },
    { clave: "atrasados", titulo: "Atrasados", items: atrasados },
    { clave: "en_transito", titulo: "En tránsito, todavía sin salir", items: enTransito },
    { clave: "recibidos", titulo: "Recibidos sin radicar", items: recibidos },
    { clave: "revisiones", titulo: "Revisiones previas incompletas", items: revisiones },
    { clave: "info_incompleta", titulo: "Info incompleta (preanotados)", items: infoIncompleta },
    { clave: "recordatorios", titulo: "Recordatorios y llamadas", items: pendientesRec },
    { clave: "cobros", titulo: `Por cobrar (${pesos(porCobrarTotal)}${conSaldo.length > 10 ? `, ${conSaldo.length} trámites; aquí los 10 mayores` : ""})`, items: cobros },
    { clave: "borradores", titulo: "Borradores sin confirmar", items: borradores },
  ].filter((s) => s.items.length);

  const tramitesPendientes = correccion.length + atrasados.length + enTransito.length + recibidos.length;
  const partes = [
    tramitesPendientes ? `${tramitesPendientes} trámite${tramitesPendientes === 1 ? "" : "s"} de días anteriores siguen abiertos` : "no quedan trámites abiertos de días anteriores",
    correccion.length ? `${correccion.length} requiere${correccion.length === 1 ? "" : "n"} corrección` : "",
    atrasados.length ? `${atrasados.length} atrasado${atrasados.length === 1 ? "" : "s"}` : "",
    pendientesRec.length ? `${pendientesRec.length} recordatorio${pendientesRec.length === 1 ? "" : "s"} para hoy` : "",
    porCobrarTotal ? `${pesos(porCobrarTotal)} por cobrar` : "",
  ].filter(Boolean);
  const saludo = `Buenos días. Hoy ${partes[0]}${partes.length > 1 ? `: ${partes.slice(1).join(", ")}` : ""}.`;

  await db.insert(E.resumenesDiarios).values({ fecha: hoy, contenido: { saludo, secciones } }).onConflictDoNothing().run();
  // Se guardan solo los últimos días.
  await db.delete(E.resumenesDiarios).where(sql`${E.resumenesDiarios.fecha} < date(${hoy}, '-${sql.raw(String(DIAS_GUARDADOS * 2))} days')`).run();
  return { fecha: hoy, nuevo: true };
}

export async function listar(db: Db) {
  if (horaColombia() >= HORA_RESUMEN) await generarResumen(db);
  const filas = await db.select().from(E.resumenesDiarios).orderBy(desc(E.resumenesDiarios.fecha)).limit(DIAS_GUARDADOS);
  return json({ hoy: hoyColombia(), resumenes: filas });
}

export async function marcar(db: Db, fecha: string, d: Datos) {
  if (typeof d.leido !== "boolean") throw new ErrorApi("Falta { leido: true | false }.");
  await db.update(E.resumenesDiarios).set({ leido: d.leido }).where(eq(E.resumenesDiarios.fecha, fecha)).run();
  return json({ ok: true });
}
