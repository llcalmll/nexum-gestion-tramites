import { RefreshCw, ScanSearch, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listaPartes, planReintento, type ParteRevision } from "../../compartido/revision";
import type { Cliente, Vehiculo } from "../../compartido/tipos";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { escribir, mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { fecha, pesos } from "../logica/formato";
import { useUI } from "./ui";

/*
 * Consultas al RUNT por PlacApi. Cada una cuesta créditos prepagados, así que siempre se confirma antes y se
 * muestra lo que cuesta. El servidor guarda el resultado (radar de licencias, SOAT y técnico-mecánica) y lo registra.
 */

/** Precio del crédito en el paquete mínimo (placapi.com/comprar). Con paquetes grandes baja. */
const PRECIO_CREDITO = 349;
export const costo = (min: number, max = min) => (min === max ? `${min} crédito${min === 1 ? "" : "s"} (unos ${pesos(min * PRECIO_CREDITO)})` : `${min} a ${max} créditos (unos ${pesos(min * PRECIO_CREDITO)} a ${pesos(max * PRECIO_CREDITO)})`);

interface ResultadoLicencias { nombre: string; resultado: "ok" | "sin_datos" | "error"; mensaje: string; creditos: number }

/** Botón de la ficha del cliente: trae sus licencias reales del RUNT al radar. */
export function BotonRuntCliente({ cliente }: { cliente: Cliente }) {
  const { confirmar, avisar } = useUI();
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const sinCedula = !cliente.numeroDocumento;
  async function consultar() {
    if (!(await confirmar({ titulo: "Consultar licencias en el RUNT", texto: `Trae las licencias de ${cliente.nombre} con sus fechas reales de vencimiento y actualiza el radar. Cuesta ${costo(1, 2)}; si el RUNT no tiene datos no se cobra.`, boton: "Consultar" }))) return;
    setOcupado(true);
    setResultado(null);
    try {
      const r = await escribir<ResultadoLicencias>("POST", `/api/consultas/licencias/${cliente.id}`);
      setResultado(`${r.mensaje}${r.creditos ? ` · ${r.creditos} crédito${r.creditos === 1 ? "" : "s"}` : ""}`);
      avisar(r.resultado === "ok" ? "Licencias actualizadas desde el RUNT" : r.mensaje, r.resultado === "error" ? "error" : "ok");
    } catch (e) {
      avisar(mensajeDe(e), "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <span className="pila" style={{ gap: 4, alignItems: "flex-end" }}>
      <button className="btn btn-sm" disabled={ocupado || sinCedula} title={sinCedula ? "Falta la cédula del cliente: el RUNT consulta por documento" : "Licencias reales desde el RUNT (PlacApi)"} onClick={consultar}>
        <ScanSearch size={14} className={ocupado ? "girando" : ""} />{ocupado ? "Consultando…" : "Consultar RUNT"}
      </button>
      {resultado && <span className="peq muted" style={{ maxWidth: 320, textAlign: "right" }}>{resultado}</span>}
    </span>
  );
}

/** Botón de la ficha del vehículo: SOAT, técnico-mecánica y prendas desde el RUNT. */
export function BotonRuntVehiculo({ vehiculo, titular }: { vehiculo: Vehiculo; titular: Cliente | undefined }) {
  const { confirmar, avisar } = useUI();
  const [ocupado, setOcupado] = useState(false);
  const sinCedula = !titular?.numeroDocumento;
  async function consultar() {
    if (!(await confirmar({ titulo: `Consultar ${vehiculo.placa} en el RUNT`, texto: `Trae el SOAT, la técnico-mecánica y si tiene prenda o gravámenes, y los guarda en el vehículo. Cuesta ${costo(1)}.`, boton: "Consultar" }))) return;
    setOcupado(true);
    try {
      const r = await escribir<{ mensaje: string }>("POST", `/api/consultas/vehiculo/${vehiculo.id}`);
      avisar(`RUNT: ${r.mensaje}`);
    } catch (e) {
      avisar(mensajeDe(e), "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <button className="btn btn-sm" disabled={ocupado || sinCedula} title={sinCedula ? "El dueño no tiene cédula registrada: el RUNT la exige para consultar por placa" : "SOAT, técnico-mecánica y prendas desde el RUNT (PlacApi)"} onClick={consultar}>
      <ScanSearch size={14} className={ocupado ? "girando" : ""} />{ocupado ? "Consultando…" : "Consultar RUNT"}
    </button>
  );
}

interface Lote { resultados: ResultadoLicencias[]; siguiente: string | null; restantes: number | null; detenido: string | null }

/** Radar de licencias: actualiza por lotes a todos los clientes con cédula, con avance y opción de detener. */
export function ActualizarRadarRunt() {
  const { confirmar, avisar } = useUI();
  const [estado, setEstado] = useState<{ hechos: number; total: number; ok: number; sinDatos: number; errores: number; creditos: number; fin?: string } | null>(null);
  const detener = useRef(false);
  const corriendo = estado != null && !estado.fin;

  async function empezar() {
    let estimado: { clientes: number; creditosMin: number; creditosMax: number };
    try { estimado = await api("/api/consultas/licencias-lote"); } catch (e) { return avisar(mensajeDe(e), "error"); }
    if (!estimado.clientes) return avisar("No hay licencias por actualizar: todas se consultaron en los últimos 30 días o les falta la cédula.");
    if (!(await confirmar({
      titulo: "Actualizar el radar desde el RUNT",
      texto: `Consulta ${estimado.clientes} cliente${estimado.clientes === 1 ? "" : "s"} con cédula que no se han consultado en 30 días y pone en el radar sus fechas reales de vencimiento. Cuesta ${costo(estimado.creditosMin, estimado.creditosMax)}; las consultas sin datos no se cobran. Se puede detener en cualquier momento.`,
      boton: "Actualizar",
    }))) return;
    detener.current = false;
    const e = { hechos: 0, total: estimado.clientes, ok: 0, sinDatos: 0, errores: 0, creditos: 0 } as NonNullable<typeof estado>;
    setEstado({ ...e });
    let cursor: string | null = "";
    try {
      while (cursor !== null && !detener.current) {
        const r: Lote = await escribir<Lote>("POST", "/api/consultas/licencias-lote", { cursor });
        for (const x of r.resultados) {
          e.hechos++;
          e.creditos += x.creditos;
          if (x.resultado === "ok") e.ok++; else if (x.resultado === "sin_datos") e.sinDatos++; else e.errores++;
        }
        setEstado({ ...e });
        if (r.detenido) { e.fin = r.detenido; break; }
        cursor = r.siguiente;
      }
      e.fin ??= detener.current ? "Detenido." : "Terminado.";
    } catch (err) {
      e.fin = mensajeDe(err);
    }
    setEstado({ ...e });
  }

  return (
    <>
      {corriendo
        ? <button className="btn" onClick={() => { detener.current = true; }}><Square size={13} />Detener</button>
        : <button className="btn" onClick={empezar} title="Fechas reales de vencimiento desde el RUNT (PlacApi)"><RefreshCw size={14} />Actualizar desde el RUNT</button>}
      {estado && (
        <div className="aviso info" style={{ position: "fixed", right: 24, bottom: 84, zIndex: 50, maxWidth: 380, boxShadow: "var(--sombra-2, 0 4px 16px rgba(0,0,0,.15))", flexDirection: "column", gap: 6 }}>
          <b>{corriendo ? "Consultando el RUNT…" : estado.fin}</b>
          <div className="avance" style={{ width: "100%" }}><i style={{ width: `${Math.max(4, Math.round((estado.hechos / Math.max(1, estado.total)) * 100))}%` }} /></div>
          <span className="peq">{estado.hechos} de {estado.total} · {estado.ok} actualizadas · {estado.sinDatos} sin datos · {estado.errores} con error · {estado.creditos} créditos</span>
          {!corriendo && <button className="btn btn-sm" style={{ alignSelf: "flex-end" }} onClick={() => setEstado(null)}>Cerrar</button>}
        </div>
      )}
    </>
  );
}

interface Resumen { conectado: boolean; mes: { creditos: number; consultas: number }; ultimas: { id: string; tipo: string; creditos: number; resultado: string; detalle: string | null; creado: string }[] }

/** Configuración: estado de PlacApi y gasto del mes. */
export function SeccionConsultas() {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Resumen>("/api/consultas/resumen").then(setR, (e) => {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: el resumen se ve con internet." : mensajeDe(e));
    });
  }, []);
  return (
    <div className="pila" style={{ gap: 16, maxWidth: 760 }}>
      <div className="card">
        <div className="card-cab"><b>PlacApi (consultas al RUNT)</b></div>
        <div className="card-cuerpo pila" style={{ gap: 8 }}>
          {error && <div className="aviso error">{error}</div>}
          {r && (r.conectado
            ? <div><span className="punto-estado" style={{ "--c": "var(--verde)" } as React.CSSProperties} /> Conectado. Este mes: <b>{r.mes.creditos} créditos</b> en {r.mes.consultas} consulta{r.mes.consultas === 1 ? "" : "s"} (unos {pesos(r.mes.creditos * PRECIO_CREDITO)}).</div>
            : <div><span className="punto-estado" style={{ "--c": "var(--texto-3)" } as React.CSSProperties} /> Sin conectar: falta la llave de API de PlacApi.</div>)}
          <div className="peq muted">Licencias por cédula: 1 crédito si el nombre deja claro el primer apellido, 2 si no. Vehículo por placa: 1 crédito y exige la cédula del dueño. Las consultas sin datos no se cobran. Saldo y recargas en placapi.com.</div>
        </div>
      </div>
      {r && r.ultimas.length > 0 && (
        <div className="card">
          <div className="card-cab"><b>Últimas consultas</b></div>
          <div className="card-cuerpo lista-filas">
            {r.ultimas.map((q) => (
              <div key={q.id} className="item">
                <div className="principal"><b>{q.tipo === "licencia" ? "Licencias" : "Vehículo"} · {q.resultado === "ok" ? "con datos" : q.resultado === "sin_datos" ? "sin datos" : "error"}</b><small>{q.detalle}</small></div>
                <span className="peq tenue">{fecha(q.creado)} · {q.creditos} cr.</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Hallazgo { tema: string; quien?: string; estado: "ok" | "alerta" | "bloquea" | "sin_dato"; detalle: string }
interface Revision { fecha: string; creditos: number; hallazgos: Hallazgo[]; aprobadas: string[]; faltaron?: ParteRevision[] }
const ESTADO_REVISION = {
  ok: { texto: "OK", clase: "rev-ok" },
  alerta: { texto: "Ojo", clase: "rev-alerta" },
  bloquea: { texto: "Frena el trámite", clase: "rev-bloquea" },
  sin_dato: { texto: "Sin dato", clase: "rev-sin" },
} as const;

/**
 * Revisión previa del trámite (PlacApi). Vehículo: consulta completa (registro, SOAT, técnico-mecánica, prendas y
 * embargos, SIMIT del dueño, impuesto) y, en traspaso, el SIMIT del comprador. Licencia: la licencia y el SIMIT del
 * titular. Lo limpio marca sus precondiciones solo. Si alguna parte no llegó (PlacApi no la cobra), la revisión queda
 * "Incompleta" y se pide de nuevo solo eso.
 */
const QUE_REVISA = {
  traspaso: { creditos: 4, texto: "Consulta del vehículo completa (registro, SOAT, técnico-mecánica, prendas y embargos, comparendos del vendedor e impuesto) y comparendos del comprador." },
  vehiculo: { creditos: 3, texto: "Consulta del vehículo completa: registro, SOAT, técnico-mecánica, prendas y embargos, comparendos del dueño e impuesto." },
  licencia: { creditos: 2, texto: "La licencia de conducción del titular y sus comparendos (SIMIT). Si de su nombre no se sabe cuál es el primer apellido (tres palabras), cuesta un crédito más." },
} as const;
export function RevisionPrevia({ tramiteId, tipo }: { tramiteId: string; tipo: keyof typeof QUE_REVISA }) {
  const { confirmar, avisar } = useUI();
  const [estado, setEstado] = useState<{ conectado: boolean; revision: Revision | null } | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  useEffect(() => {
    let vigente = true;
    api<{ conectado: boolean; revision: Revision | null }>(`/api/consultas/revision/${tramiteId}`).then((r) => { if (vigente) setEstado(r); }, () => { if (vigente) setEstado({ conectado: false, revision: null }); });
    return () => { vigente = false; };
  }, [tramiteId]);

  async function revisar() {
    const q = QUE_REVISA[tipo];
    if (!(await confirmar({ titulo: "Revisión previa del trámite", texto: `${q.texto} Cuesta ${costo(q.creditos)}; si una fuente no responde, no se cobra.`, boton: "Revisar" }))) return;
    setCorriendo(true);
    try {
      const revision = await escribir<Revision>("POST", `/api/consultas/revision/${tramiteId}`);
      setEstado((e) => ({ conectado: e?.conectado ?? true, revision }));
      const frenan = revision.hallazgos.filter((h) => h.estado === "bloquea").length;
      avisar(frenan ? `Revisión lista: ${frenan} cosa(s) frenan el trámite.` : "Revisión lista: nada frena el trámite.", frenan ? "error" : "ok");
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      avisar(e instanceof SinConexion ? "Sin conexión." : mensajeDe(e), "error");
    } finally { setCorriendo(false); }
  }

  async function pedirLoQueFalto(faltaron: ParteRevision[]) {
    if (!(await confirmar({ titulo: "Pedir de nuevo lo que faltó", texto: `Solo ${listaPartes(faltaron)}. Cuesta hasta ${costo(planReintento(faltaron).creditos)}; lo que no llegue otra vez no se cobra.`, boton: "Pedir" }))) return;
    setCorriendo(true);
    try {
      const revision = await escribir<Revision>("POST", `/api/consultas/revision/${tramiteId}/reintentar`);
      setEstado((e) => ({ conectado: e?.conectado ?? true, revision }));
      const siguen = revision.faltaron ?? [];
      avisar(siguen.length ? `Todavía no llegó: ${listaPartes(siguen)}.` : "Ya llegó todo.", siguen.length ? "error" : "ok");
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      avisar(e instanceof SinConexion ? "Sin conexión." : mensajeDe(e), "error");
    } finally { setCorriendo(false); }
  }

  if (!estado) return null;
  const r = estado.revision;
  const faltaron = r?.faltaron ?? [];
  const frenan = r?.hallazgos.filter((h) => h.estado === "bloquea").length ?? 0;
  const ojo = r?.hallazgos.filter((h) => h.estado === "alerta").length ?? 0;
  return (
    <div className="card">
      <div className="card-cab">
        <b>Revisión previa</b>
        <span className="peq tenue">{r ? `${fecha(r.fecha)} · ${frenan ? `${frenan} frena${frenan === 1 ? "" : "n"}` : "nada frena"}${ojo ? ` · ${ojo} para revisar` : ""}${faltaron.length ? " · incompleta" : ""}` : tipo === "licencia" ? "Licencia y SIMIT" : "RUNT, SIMIT e impuesto"}</span>
        {estado.conectado && <button className="btn btn-sm accion" disabled={corriendo} onClick={revisar}>{corriendo ? <RefreshCw size={13} className="girando" /> : <ScanSearch size={13} />}{r ? "Revisar de nuevo" : "Revisar todo"}</button>}
      </div>
      <div className="card-cuerpo">
        {!estado.conectado ? <div className="peq tenue">Se activa al conectar PlacApi: revisa de una gravámenes, SOAT, técnico-mecánica, impuesto y comparendos de vendedor y comprador.</div>
          : !r ? <div className="peq tenue">Aún no se ha revisado. Los trámites que llegan del celular se revisan solos.</div>
          : (
            <div className="lista-filas revision">
              {r.hallazgos.map((h, i) => (
                <div key={i} className="item revision-item">
                  <span className={`rev-estado ${ESTADO_REVISION[h.estado].clase}`}>{ESTADO_REVISION[h.estado].texto}</span>
                  <div className="principal"><b>{h.tema}</b>{h.quien && <span className="peq tenue"> · {h.quien}</span>}<small>{h.detalle}</small></div>
                </div>
              ))}
              {r.aprobadas.length > 0 && <div className="peq muted" style={{ paddingTop: 6 }}>Precondiciones marcadas solas: {r.aprobadas.join(", ")}.</div>}
              {faltaron.length > 0 && <FaltoAlgo faltaron={faltaron} ocupado={corriendo} pedir={estado.conectado ? () => pedirLoQueFalto(faltaron) : undefined} />}
            </div>
          )}
      </div>
    </div>
  );
}

/** "Incompleta": lo que no llegó de PlacApi y el botón para pedir solo eso. También lo usa la verificación al registrar. */
export function FaltoAlgo({ faltaron, ocupado, pedir }: { faltaron: ParteRevision[]; ocupado?: boolean; pedir?: () => void }) {
  return (
    <div className="rev-incompleta" role="group" aria-label="Revisión incompleta">
      <span className="rev-estado rev-sin">Incompleta</span>
      <span className="peq">No llegó: {listaPartes(faltaron)} (la fuente no respondió; no se cobró).</span>
      {pedir && <button type="button" className="btn btn-sm" disabled={ocupado} onClick={pedir}>{ocupado ? <RefreshCw size={13} className="girando" /> : <RefreshCw size={13} />}Pedir de nuevo lo que faltó ({planReintento(faltaron).creditos} crédito{planReintento(faltaron).creditos === 1 ? "" : "s"})</button>}
    </div>
  );
}
