import { AlertTriangle, CalendarClock, Car, CreditCard, FileText, IdCard, MessageCircle, RefreshCw, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { codigoTramite } from "../../compartido/dominio";
import { BotonFinalizar } from "../componentes/Finalizar";
import { InfoIncompleta } from "../componentes/InfoIncompleta";
import { Cabecera, Kpi, useUI } from "../componentes/ui";
import { useFaltantes } from "../datos/incompletos";
import { Vigencia } from "../componentes/Vigencia";
import { escribir, mensajeDe } from "../datos/escribir";
import { fecha, pesos } from "../logica/formato";
import { useResumen } from "../datos/resumen";

const MAX = 6;

/** Tarjeta de alerta con su lista corta y el enlace a la lista completa. */
function Alerta({ icono: I, titulo, total, a, vacio, children }: { icono: typeof FileText; titulo: string; total: number; a?: string; vacio: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="card-cab">
        <I size={16} className="tenue" />
        <b>{titulo}</b>
        <span className="peq tenue">{total}</span>
        {a && total > MAX && <Link className="peq accion" to={a}>Ver todos</Link>}
      </div>
      <div className="card-cuerpo lista-filas" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {total ? children : <div className="peq tenue" style={{ padding: "8px 0" }}>{vacio}</div>}
      </div>
    </div>
  );
}

export default function Inicio() {
  const nav = useNavigate();
  const { avisar } = useUI();
  const [revisando, setRevisando] = useState(false);
  const { resumen: a, hoy } = useResumen();

  const ir = (id: string) => nav(`/tramites/${id}`);
  const faltan = useFaltantes();
  const filaTramite = (t: { id: string; numero: number; codigo?: number | null; creado: string; estado: string; borrador?: boolean; tipoId: string; titularId: string; vehiculoId: string | null; encargoId: string | null }, derecha: ReactNode) => (
    <a key={t.id} className="item" href={`/tramites/${t.id}`} onClick={(e) => { e.preventDefault(); ir(t.id); }}>
      <div className="principal">
        <b>{(t.encargoId && a!.combos.get(t.encargoId)) || a!.tipo.get(t.tipoId)}{t.vehiculoId ? ` · ${a!.placa.get(t.vehiculoId)}` : ""}</b>
        <small>{codigoTramite(t)} · {a!.cliente.get(t.titularId)?.nombre}</small>
      </div>
      <InfoIncompleta falta={faltan.get(t.id)} />
      {derecha}
      <BotonFinalizar t={t} etiqueta={false} tamano="xs" />
    </a>
  );

  return (
    <>
      <Cabecera titulo="Resumen" sub="Lo que necesita atención hoy (en el mapa sale resumido arriba)">
        <button className="btn" disabled={revisando} title="Crear ya los recordatorios de vencimientos (se hace solo cada mañana)" onClick={async () => {
          setRevisando(true);
          try { const r = await escribir<{ propuestos: number }>("POST", "/api/vencimientos/revisar"); avisar(r.propuestos ? "Vencimientos revisados: recordatorios al día" : "No hay vencimientos próximos"); } catch (e) { avisar(mensajeDe(e), "error"); } finally { setRevisando(false); }
        }}><RefreshCw size={14} className={revisando ? "girando" : ""} />Revisar vencimientos</button>
      </Cabecera>
      <div className="contenido">
        <div className="kpis">
          <Kpi icono={FileText} tono="azul" valor={a?.abiertos.length ?? "…"} etiqueta="Trámites abiertos" a="/tramites" />
          <Kpi icono={AlertTriangle} tono="rojo" valor={a?.atrasados.length ?? "…"} etiqueta="Trámites atrasados" a="/tramites" />
          <Kpi icono={CalendarClock} tono="ambar" valor={a?.recordatorios.length ?? "…"} etiqueta="Recordatorios para hoy o atrasados" a="/recordatorios" />
          <Kpi icono={Wallet} tono="verde" valor={a ? pesos(a.saldo) : "…"} etiqueta={`Por cobrar en ${a?.cobros.length ?? 0} trámites finalizados`} />
        </div>
        {a && (
          <div className="dos">
            <Alerta icono={CalendarClock} titulo="Para hoy" total={a.recordatorios.length} a="/recordatorios" vacio="Nada pendiente para hoy.">
              {a.recordatorios.slice(0, MAX).map((r) => (
                <Link key={r.id} className="item" to="/recordatorios">
                  <div className="principal"><b>{r.titulo}</b><small>{r.fecha < hoy ? `Atrasado desde ${fecha(r.fecha)}` : r.hora ? `Hoy · ${r.hora}` : "Hoy"}{r.clienteId ? ` · ${a.cliente.get(r.clienteId)?.nombre ?? ""}` : ""}</small></div>
                </Link>
              ))}
            </Alerta>
            <Alerta icono={AlertTriangle} titulo="Trámites atrasados" total={a.atrasados.length} a="/tramites" vacio="Ningún trámite atrasado frente a su entrega estimada.">
              {a.atrasados.slice(0, MAX).map((t) => filaTramite(t, <span className="peq" style={{ color: "var(--rojo)" }}>desde {fecha(t.fechaEstimadaEntrega)}</span>))}
            </Alerta>
            <Alerta icono={Car} titulo="SOAT, técnico-mecánica e impuesto" total={a.vencimientos.length} a="/vehiculos" vacio="Ningún vencimiento en los próximos 30 días (solo cuentan los vehículos con esas fechas cargadas).">
              {a.vencimientos.slice(0, MAX).map((x) => (
                <Link key={`${x.v.id}${x.que}`} className="item" to={`/vehiculos?ficha=${x.v.id}`}>
                  <div className="principal"><b>{x.v.placa} · {x.que}</b><small>{x.v.titularId ? a.cliente.get(x.v.titularId)?.nombre : "Sin titular"}</small></div>
                  <Vigencia hasta={x.f} />
                </Link>
              ))}
            </Alerta>
            <Alerta icono={IdCard} titulo="Licencias por vencer (60 días)" total={a.licencias.length} a="/licencias" vacio="Ninguna licencia vence en los próximos 60 días.">
              {a.licencias.slice(0, MAX).map((l) => (
                <Link key={l.id} className="item" to="/licencias">
                  <div className="principal"><b>{a.cliente.get(l.clienteId)?.nombre}</b><small>Categoría {l.categoria}{a.cliente.get(l.clienteId)?.telefono ? ` · ${a.cliente.get(l.clienteId)?.telefono}` : ""}</small></div>
                  <Vigencia hasta={l.fechaVencimiento} />
                </Link>
              ))}
            </Alerta>
            <Alerta icono={Wallet} titulo="Cobros pendientes" total={a.cobros.length} vacio="Ningún trámite finalizado con saldo pendiente.">
              {a.cobros.slice(0, MAX).map(({ t, saldo }) => filaTramite(t, <b className="peq" style={{ color: "var(--rojo)" }}>{pesos(saldo)}</b>))}
            </Alerta>
            {a.whatsapp && (
              <Alerta icono={MessageCircle} titulo="WhatsApp por confirmar" total={a.whatsapp.propuestas.length + (a.whatsapp.revisar ? 1 : 0)} a="/whatsapp" vacio="Nada nuevo de WhatsApp por confirmar.">
                {a.whatsapp.revisar > 0 && (
                  <Link className="item" to="/whatsapp?vista=revisar">
                    <div className="principal"><b>{a.whatsapp.revisar} chat{a.whatsapp.revisar === 1 ? "" : "s"} por revisar</b><small>La IA no está segura o cree que son personales</small></div>
                  </Link>
                )}
                {a.whatsapp.propuestas.slice(0, MAX).map((p) => {
                  const c = a.chat.get(p.chatId);
                  return (
                    <Link key={p.id} className="item" to={`/whatsapp?chat=${p.chatId}`}>
                      <div className="principal"><b>{p.titulo}</b><small>{(c?.clienteId && a.cliente.get(c.clienteId)?.nombre) || c?.nombre || p.chatId}</small></div>
                    </Link>
                  );
                })}
              </Alerta>
            )}
            <Alerta icono={CreditCard} titulo="Tarjetas en la oficina" total={a.tarjetas.length} vacio="No hay tarjetas esperando entrega.">
              {a.tarjetas.slice(0, MAX).map((t) => filaTramite(t, <span className="peq tenue">finalizado {fecha(t.fechaEntrega ?? t.creado)}</span>))}
            </Alerta>
          </div>
        )}
      </div>
    </>
  );
}
