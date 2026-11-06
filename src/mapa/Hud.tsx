import { AlertTriangle, CalendarClock, Car, CreditCard, FileInput, FileText, IdCard, MessageCircle, Users, Wallet, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { codigoTramite } from "../../compartido/dominio";
import type { Tramite } from "../../compartido/tipos";
import { Vigencia } from "../componentes/Vigencia";
import { useResumen } from "../datos/resumen";
import { fecha, pesos } from "../logica/formato";

/**
 * Lo de arriba del mapa: lo que importa a diario a la vista (abiertos, atrasados, recordatorios para hoy, por cobrar);
 * lo de vez en cuando en botones redondos con su número (vencimientos de SOAT, técnico-mecánica e impuesto, licencias
 * por vencer, tarjetas en la oficina, WhatsApp por confirmar), que despliegan su lista corta; y los accesos a clientes,
 * vehículos y registrar un trámite sin salir del mapa.
 */
const MAX = 6;
type Pop = "abiertos" | "atrasados" | "recordatorios" | "cobrar" | "vencimientos" | "licencias" | "tarjetas" | "whatsapp";
export type Ventana = "clientes" | "vehiculos" | "registrar";

export function HudMapa({ capa, verTramite, fichaVehiculo, abrir }: {
  /** Pone la capa del mapa (los abiertos o los atrasados). */
  capa: (c: "abiertos" | "atrasados") => void;
  /** Muestra un trámite: en el mapa si está abierto; si no, su expediente. */
  verTramite: (id: string) => void;
  fichaVehiculo: (id: string) => void;
  abrir: (v: Ventana) => void;
}) {
  const { resumen: a, hoy } = useResumen();
  const [pop, setPop] = useState<Pop | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  // Se cierra al tocar fuera o con Esc.
  useEffect(() => {
    if (!pop) return;
    const fuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPop(null); } };
    document.addEventListener("pointerdown", fuera);
    window.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fuera); window.removeEventListener("keydown", esc, true); };
  }, [pop]);
  const alternar = (p: Pop) => setPop((x) => (x === p ? null : p));
  const ver = (id: string) => { setPop(null); verTramite(id); };

  const fila = (t: Tramite, derecha: ReactNode) => (
    <button key={t.id} type="button" className="hud-item" onClick={() => ver(t.id)}>
      <span className="principal">
        <b>{(t.encargoId && a!.combos.get(t.encargoId)) || a!.tipo.get(t.tipoId)}{t.vehiculoId ? ` · ${a!.placa.get(t.vehiculoId) ?? ""}` : ""}</b>
        <small>{codigoTramite(t)} · {a!.cliente.get(t.titularId)?.nombre}</small>
      </span>
      {derecha}
    </button>
  );
  const whatsapp = a?.whatsapp ? a.whatsapp.propuestas.length + (a.whatsapp.revisar ? 1 : 0) : 0;

  return (
    <div className="mapa-hud" ref={caja}>
      <div className="hud-kpis" role="group" aria-label="Lo de hoy">
        <Kpi icono={FileText} tono="azul" valor={a?.abiertos.length} texto="abiertos" activo={pop === "abiertos"} onClick={() => { capa("abiertos"); setPop(null); }} titulo="Trámites abiertos (en el mapa, la capa Abiertos)" />
        <Kpi icono={AlertTriangle} tono="rojo" valor={a?.atrasados.length} texto="atrasados" activo={pop === "atrasados"} onClick={() => { if (pop !== "atrasados") capa("atrasados"); alternar("atrasados"); }} titulo="Trámites atrasados frente a su entrega estimada" />
        <Kpi icono={CalendarClock} tono="ambar" valor={a?.recordatorios.length} texto="para hoy" activo={pop === "recordatorios"} onClick={() => alternar("recordatorios")} titulo="Recordatorios para hoy o atrasados" />
        <Kpi icono={Wallet} tono="verde" valor={a ? pesos(a.saldo) : undefined} texto="por cobrar" activo={pop === "cobrar"} onClick={() => alternar("cobrar")} titulo={`Por cobrar: lo que quedó debiendo un trámite ya finalizado${a ? ` (${a.cobros.length})` : ""}`} />
      </div>
      <div className="hud-fila">
        <div className="hud-orbes" role="group" aria-label="Más avisos">
          <Orbe icono={Car} color="#0e7490" n={a?.vencimientos.length ?? 0} titulo="SOAT, técnico-mecánica e impuesto (próximos 30 días)" activo={pop === "vencimientos"} onClick={() => alternar("vencimientos")} />
          <Orbe icono={IdCard} color="#7c3aed" n={a?.licencias.length ?? 0} titulo="Licencias por vencer (60 días)" activo={pop === "licencias"} onClick={() => alternar("licencias")} />
          <Orbe icono={CreditCard} color="#b45309" n={a?.tarjetas.length ?? 0} titulo="Tarjetas en la oficina, esperando entrega" activo={pop === "tarjetas"} onClick={() => alternar("tarjetas")} />
          {a?.whatsapp && <Orbe icono={MessageCircle} color="#16a34a" n={whatsapp} titulo="WhatsApp por confirmar" activo={pop === "whatsapp"} onClick={() => alternar("whatsapp")} />}
        </div>
        <span className="hud-sep" />
        <div className="hud-acc" role="group" aria-label="Abrir sin salir del mapa">
          <button type="button" className="btn btn-sm" onClick={() => abrir("clientes")} title="Clientes (sin salir del mapa)"><Users size={14} /><span>Clientes</span></button>
          <button type="button" className="btn btn-sm" onClick={() => abrir("vehiculos")} title="Vehículos (sin salir del mapa)"><Car size={14} /><span>Vehículos</span></button>
          <button type="button" className="btn btn-sm btn-primario" onClick={() => abrir("registrar")} title="Registrar un trámite desde sus documentos: al guardarlo se ve en el mapa"><FileInput size={14} /><span>Registrar trámite</span></button>
        </div>
      </div>

      {a && pop && pop !== "abiertos" && (
        <div className="hud-pop" role="dialog">
          {pop === "atrasados" && <Lista titulo="Trámites atrasados" total={a.atrasados.length} vacio="Ningún trámite atrasado frente a su entrega estimada." todos="/tramites">
            {a.atrasados.slice(0, MAX).map((t) => fila(t, <span className="peq" style={{ color: "var(--rojo)" }}>desde {fecha(t.fechaEstimadaEntrega)}</span>))}
          </Lista>}
          {pop === "recordatorios" && <Lista titulo="Para hoy" total={a.recordatorios.length} vacio="Nada pendiente para hoy." todos="/recordatorios">
            {a.recordatorios.slice(0, MAX).map((r) => (
              <Link key={r.id} className="hud-item" to="/recordatorios">
                <span className="principal"><b>{r.titulo}</b><small>{r.fecha < hoy ? `Atrasado desde ${fecha(r.fecha)}` : r.hora ? `Hoy · ${r.hora}` : "Hoy"}{r.clienteId ? ` · ${a.cliente.get(r.clienteId)?.nombre ?? ""}` : ""}</small></span>
              </Link>
            ))}
          </Lista>}
          {pop === "cobrar" && <Lista titulo="Por cobrar (finalizados)" total={a.cobros.length} vacio="Ningún trámite finalizado con saldo pendiente.">
            {a.cobros.slice(0, MAX).map(({ t, saldo }) => fila(t, <b className="peq" style={{ color: "var(--rojo)" }}>{pesos(saldo)}</b>))}
          </Lista>}
          {pop === "vencimientos" && <Lista titulo="SOAT, técnico-mecánica e impuesto" total={a.vencimientos.length} vacio="Ningún vencimiento en los próximos 30 días (solo cuentan los vehículos con esas fechas cargadas)." todos="/vehiculos">
            {a.vencimientos.slice(0, MAX).map((x) => (
              <button key={`${x.v.id}${x.que}`} type="button" className="hud-item" onClick={() => { setPop(null); fichaVehiculo(x.v.id); }}>
                <span className="principal"><b>{x.v.placa} · {x.que}</b><small>{x.v.titularId ? a.cliente.get(x.v.titularId)?.nombre : "Sin titular"}</small></span>
                <Vigencia hasta={x.f} />
              </button>
            ))}
          </Lista>}
          {pop === "licencias" && <Lista titulo="Licencias por vencer (60 días)" total={a.licencias.length} vacio="Ninguna licencia vence en los próximos 60 días." todos="/licencias">
            {a.licencias.slice(0, MAX).map((l) => (
              <Link key={l.id} className="hud-item" to="/licencias">
                <span className="principal"><b>{a.cliente.get(l.clienteId)?.nombre}</b><small>Categoría {l.categoria}{a.cliente.get(l.clienteId)?.telefono ? ` · ${a.cliente.get(l.clienteId)?.telefono}` : ""}</small></span>
                <Vigencia hasta={l.fechaVencimiento} />
              </Link>
            ))}
          </Lista>}
          {pop === "tarjetas" && <Lista titulo="Tarjetas en la oficina" total={a.tarjetas.length} vacio="No hay tarjetas esperando entrega.">
            {a.tarjetas.slice(0, MAX).map((t) => fila(t, <span className="peq tenue">finalizado {fecha(t.fechaEntrega ?? t.creado)}</span>))}
          </Lista>}
          {pop === "whatsapp" && a.whatsapp && <Lista titulo="WhatsApp por confirmar" total={whatsapp} vacio="Nada nuevo de WhatsApp por confirmar." todos="/whatsapp">
            {a.whatsapp.revisar > 0 && (
              <Link className="hud-item" to="/whatsapp?vista=revisar">
                <span className="principal"><b>{a.whatsapp.revisar} chat{a.whatsapp.revisar === 1 ? "" : "s"} por revisar</b><small>La IA no está segura o cree que son personales</small></span>
              </Link>
            )}
            {a.whatsapp.propuestas.slice(0, MAX).map((p) => {
              const c = a.chat.get(p.chatId);
              return (
                <Link key={p.id} className="hud-item" to={`/whatsapp?chat=${p.chatId}`}>
                  <span className="principal"><b>{p.titulo}</b><small>{(c?.clienteId && a.cliente.get(c.clienteId)?.nombre) || c?.nombre || p.chatId}</small></span>
                </Link>
              );
            })}
          </Lista>}
          <Link className="hud-resumen peq" to="/inicio">Ver el resumen completo</Link>
        </div>
      )}
    </div>
  );
}

function Kpi({ icono: I, tono, valor, texto, titulo, activo, onClick }: { icono: LucideIcon; tono: string; valor: number | string | undefined; texto: string; titulo: string; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`hud-kpi ${tono}`} aria-pressed={activo} title={titulo} onClick={onClick}>
      <I size={15} /><b>{valor ?? "…"}</b><span>{texto}</span>
    </button>
  );
}

/** Botón redondo, de juego: su ícono, su número arriba a la derecha y, si no hay nada, apagado. */
function Orbe({ icono: I, color, n, titulo, activo, onClick }: { icono: LucideIcon; color: string; n: number; titulo: string; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`hud-orbe${n ? "" : " cero"}`} style={{ "--c": color } as React.CSSProperties} aria-pressed={activo} aria-label={`${titulo}: ${n}`} title={`${titulo}: ${n}`} onClick={onClick}>
      <I size={17} />{n > 0 && <i className="hud-insignia">{n > 99 ? "99+" : n}</i>}
    </button>
  );
}

function Lista({ titulo, total, vacio, todos, children }: { titulo: string; total: number; vacio: string; todos?: string; children: ReactNode }) {
  return (
    <>
      <div className="hud-pop-cab"><b>{titulo}</b><span className="peq tenue">{total}</span>{todos && total > MAX && <Link className="peq accion" to={todos}>Ver todos</Link>}</div>
      <div className="hud-pop-lista">{total ? children : <span className="peq tenue" style={{ padding: "6px 2px" }}>{vacio}</span>}</div>
    </>
  );
}

