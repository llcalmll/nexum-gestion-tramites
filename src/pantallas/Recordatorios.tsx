import { useLiveQuery } from "dexie-react-hooks";
import { CalendarClock, CalendarPlus, Phone } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { codigoTramite } from "../../compartido/dominio";
import { PanelRecordatorio } from "../componentes/PanelRecordatorio";
import { TablaDatos } from "../componentes/TablaDatos";
import { Badge, Cabecera, useUI, Vacio, type Tono } from "../componentes/ui";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { fecha, hoyISO } from "../logica/formato";

const TIPO: Record<string, [string, Tono]> = { recordatorio: ["Recordatorio", "gris"], cita: ["Cita", "morado"], llamada: ["Llamada", "azul"] };
type Filtro = "atrasados" | "hoy" | "proximos" | "pendientes" | "hechos";

export default function Recordatorios() {
  const nav = useNavigate();
  const { avisar } = useUI();
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [panel, setPanel] = useState<{ id: string | null } | null>(null);
  const datos = useLiveQuery(async () => ({
    recordatorios: await db.recordatorios.toArray(),
    clientes: await db.clientes.toArray(),
    tramites: await db.tramites.toArray(),
  }), []);
  const hoy = hoyISO();
  const filas = useMemo(() => {
    if (!datos) return [];
    const cliente = new Map(datos.clientes.map((c) => [c.id, c]));
    const tramite = new Map(datos.tramites.map((t) => [t.id, t]));
    return datos.recordatorios.map((r) => ({ r, cliente: r.clienteId ? cliente.get(r.clienteId) : undefined, tramite: r.tramiteId ? tramite.get(r.tramiteId) : undefined }));
  }, [datos]);
  const pendientes = filas.filter((f) => f.r.estado === "pendiente");
  const cuenta = {
    atrasados: pendientes.filter((f) => f.r.fecha < hoy).length,
    hoy: pendientes.filter((f) => f.r.fecha === hoy).length,
    proximos: pendientes.filter((f) => f.r.fecha > hoy).length,
    pendientes: pendientes.length,
    hechos: filas.filter((f) => f.r.estado !== "pendiente").length,
  };
  const visibles = filas.filter((f) => {
    if (filtro === "hechos") return f.r.estado !== "pendiente";
    if (f.r.estado !== "pendiente") return false;
    if (filtro === "atrasados") return f.r.fecha < hoy;
    if (filtro === "hoy") return f.r.fecha === hoy;
    if (filtro === "proximos") return f.r.fecha > hoy;
    return true;
  });

  async function completar(id: string, hecho: boolean) {
    try { await escribir("PATCH", `/api/recordatorios/${id}`, { estado: hecho ? "hecho" : "pendiente" }); } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  return (
    <>
      <Cabecera titulo="Recordatorios" sub="Citas, llamadas y recordatorios">
        <button className="btn btn-primario" onClick={() => setPanel({ id: null })}><CalendarPlus size={15} />Nuevo recordatorio</button>
      </Cabecera>
      <div className="contenido">
        <TablaDatos
          idGuardado="recordatorios-v2"
          filas={visibles}
          clave={(f) => f.r.id}
          onFila={(f) => setPanel({ id: f.r.id })}
          ordenInicial={{ id: "fecha", dir: filtro === "hechos" ? -1 : 1 }}
          marca={(f) => (f.r.estado === "pendiente" && f.r.fecha < hoy ? "rojo" : f.r.estado === "pendiente" && f.r.fecha === hoy ? "ambar" : undefined)}
          barra={
            <div className="seg">
              {([["pendientes", "Pendientes"], ["atrasados", "Atrasados"], ["hoy", "Hoy"], ["proximos", "Próximos"], ["hechos", "Hechos"]] as [Filtro, string][]).map(([k, t]) => (
                <button key={k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{t} <span className="cuenta">{cuenta[k]}</span></button>
              ))}
            </div>
          }
          vacio={<Vacio icono={CalendarClock} titulo={filtro === "hechos" ? "Nada hecho todavía" : "Nada pendiente aquí"} />}
          columnas={[
            {
              id: "hecho", titulo: "", ancho: 44,
              celda: (f) => <input type="checkbox" title={f.r.estado === "pendiente" ? "Marcar como hecho" : "Volver a pendiente"} checked={f.r.estado !== "pendiente"} onClick={(e) => e.stopPropagation()} onChange={(e) => completar(f.r.id, e.target.checked)} />,
            },
            { id: "fecha", titulo: "Fecha", valor: (f) => `${f.r.fecha} ${f.r.hora ?? ""}`, celda: (f) => <b>{f.r.fecha === hoy ? "Hoy" : fecha(f.r.fecha)}{f.r.hora ? ` · ${f.r.hora}` : ""}</b> },
            { id: "tipo", titulo: "Tipo", valor: (f) => f.r.tipo, celda: (f) => <Badge tono={TIPO[f.r.tipo]?.[1] ?? "gris"}>{TIPO[f.r.tipo]?.[0] ?? f.r.tipo}</Badge> },
            { id: "titulo", titulo: "Qué", valor: (f) => f.r.titulo, celda: (f) => <span style={{ whiteSpace: "normal" }}>{f.r.titulo}{f.r.origen === "sistema" ? <span className="peq tenue"> · automático</span> : null}</span> },
            {
              id: "cliente", titulo: "Cliente", valor: (f) => f.cliente?.nombre,
              celda: (f) => f.cliente ? (
                <span className="fila" style={{ gap: 6 }}>
                  {f.cliente.nombre}
                  {f.cliente.telefono && <a href={`tel:${f.cliente.telefono}`} onClick={(e) => e.stopPropagation()} title={f.cliente.telefono}><Phone size={13} /></a>}
                </span>
              ) : "",
            },
            {
              id: "tramite", titulo: "Trámite", valor: (f) => f.tramite?.numero,
              celda: (f) => f.tramite ? <a href={`/tramites/${f.tramite.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav(`/tramites/${f.tramite!.id}`); }}>{codigoTramite(f.tramite)}</a> : "",
            },
          ]}
        />
      </div>
      <PanelRecordatorio abierto={!!panel} onCerrar={() => setPanel(null)} id={panel?.id} />
    </>
  );
}
