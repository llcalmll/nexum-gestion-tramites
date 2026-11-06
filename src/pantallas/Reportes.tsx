import { useLiveQuery } from "dexie-react-hooks";
import { Download, FileCheck2, FileText, Wallet, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { codigoTramite, ESTADO_TRAMITE_LABEL, type EstadoTramite } from "../../compartido/dominio";
import { Cabecera, Kpi, useUI } from "../componentes/ui";
import { db } from "../datos/db";
import { hoyISO, pesos } from "../logica/formato";

type Periodo = "mes" | "anterior" | "anio" | "12" | "todo";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function rango(p: Periodo, hoy: string): [string, string] {
  const [a, m] = hoy.split("-").map(Number);
  const mes = (y: number, mm: number) => `${y}-${String(mm).padStart(2, "0")}`;
  if (p === "mes") return [`${mes(a, m)}-01`, `${mes(a, m)}-31`];
  if (p === "anterior") { const y = m === 1 ? a - 1 : a; const mm = m === 1 ? 12 : m - 1; return [`${mes(y, mm)}-01`, `${mes(y, mm)}-31`]; }
  if (p === "anio") return [`${a}-01-01`, `${a}-12-31`];
  if (p === "12") { const y = m === 12 ? a : a - 1; const mm = m === 12 ? 1 : m + 1; return [`${mes(y, mm)}-01`, `${mes(a, m)}-31`]; }
  return ["0000-01-01", "9999-12-31"];
}

/** Tabla de desglose: nombre, cantidad y valor, ordenada de mayor a menor valor. */
function Desglose({ titulo, filas, columnaValor = "Facturado" }: { titulo: string; filas: { nombre: string; cantidad: number; valor: number }[]; columnaValor?: string }) {
  const total = filas.reduce((s, f) => s + f.valor, 0);
  return (
    <div className="card">
      <div className="card-cab"><b>{titulo}</b></div>
      <div className="tabla-scroll">
        <table className="tbl">
          <thead><tr><th>Nombre</th><th style={{ textAlign: "right" }}>Cantidad</th><th style={{ textAlign: "right" }}>{columnaValor}</th><th style={{ textAlign: "right" }}>%</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nombre}><td>{f.nombre}</td><td className="num" style={{ textAlign: "right" }}>{f.cantidad}</td><td className="num" style={{ textAlign: "right" }}>{pesos(f.valor)}</td><td className="num tenue" style={{ textAlign: "right" }}>{total ? Math.round((f.valor / total) * 100) : 0}%</td></tr>
            ))}
            {!filas.length && <tr><td colSpan={4} className="tenue">Sin datos en este periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Barras de cobrado por mes (una sola serie: un color, sin leyenda; valor al pasar el mouse). */
function CobradoPorMes({ meses }: { meses: { mes: string; valor: number }[] }) {
  const [sobre, setSobre] = useState<number | null>(null);
  // Se dibuja con el ancho real (no se escala): así el texto conserva su tamaño en cualquier pantalla.
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(640);
  useEffect(() => {
    if (!caja.current) return;
    const o = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.floor(e.contentRect.width))));
    o.observe(caja.current);
    return () => o.disconnect();
  }, []);
  const max = Math.max(1, ...meses.map((m) => m.valor));
  const alto = 200, base = alto - 24, barra = ancho / meses.length;
  return (
    <div className="card">
      <div className="card-cab"><b>Cobrado por mes</b><span className="peq tenue">últimos 12 meses</span></div>
      <div className="card-cuerpo" ref={caja}>
        <svg width={ancho} height={alto} role="img" aria-label="Cobrado por mes, últimos 12 meses" onMouseLeave={() => setSobre(null)}>
          <line x1="0" x2={ancho} y1={base} y2={base} stroke="var(--linea)" />
          {meses.map((m, i) => {
            const h = (m.valor / max) * (base - 24);
            const w = Math.min(44, barra * 0.56);
            const x = i * barra + (barra - w) / 2;
            return (
              <g key={m.mes} onMouseEnter={() => setSobre(i)}>
                <rect x={i * barra} y={0} width={barra} height={alto} fill="transparent" />
                {h > 0 && <path d={`M${x},${base} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill="var(--primario)" opacity={sobre === null || sobre === i ? 1 : 0.45} />}
                <text x={i * barra + barra / 2} y={alto - 6} textAnchor="middle" fontSize="11" fill="var(--texto-3)">{MESES[Number(m.mes.slice(5, 7)) - 1]}</text>
                {sobre === i && <text x={i * barra + barra / 2} y={Math.max(12, base - h - 8)} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--texto)">{pesos(m.valor)}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function Reportes() {
  const { avisar } = useUI();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const datos = useLiveQuery(async () => ({
    tramites: await db.tramites.toArray(), pagos: await db.pagos.toArray(), tipos: await db.tipos_tramite.toArray(),
    organismos: await db.organismos.toArray(), clientes: await db.clientes.toArray(), vehiculos: await db.vehiculos.toArray(),
  }), []);
  const hoy = hoyISO();
  const [desde, hasta] = rango(periodo, hoy);

  const r = useMemo(() => {
    if (!datos) return null;
    const enRango = (f: string | null | undefined) => !!f && f.slice(0, 10) >= desde && f.slice(0, 10) <= hasta;
    const tipo = new Map(datos.tipos.map((t) => [t.id, t.nombre]));
    const org = new Map(datos.organismos.map((o) => [o.id, o.ciudad ?? o.nombre]));
    const pagadoPor = new Map<string, number>();
    for (const p of datos.pagos) pagadoPor.set(p.tramiteId, (pagadoPor.get(p.tramiteId) ?? 0) + p.valor);
    const recibidos = datos.tramites.filter((t) => enRango(t.creado));
    const validos = recibidos.filter((t) => t.estado !== "cancelado");
    const finalizados = datos.tramites.filter((t) => t.estado === "entregado" && enRango(t.fechaEntrega ?? t.creado));
    const cancelados = recibidos.filter((t) => t.estado === "cancelado");
    const pagos = datos.pagos.filter((p) => enRango(p.fecha));
    const agrupar = (lista: typeof validos, clave: (t: (typeof validos)[number]) => string) => {
      const m = new Map<string, { nombre: string; cantidad: number; valor: number }>();
      for (const t of lista) { const k = clave(t) || "Sin dato"; const x = m.get(k) ?? { nombre: k, cantidad: 0, valor: 0 }; x.cantidad++; x.valor += t.total; m.set(k, x); }
      return [...m.values()].sort((a, b) => b.valor - a.valor || b.cantidad - a.cantidad);
    };
    const metodos = new Map<string, { nombre: string; cantidad: number; valor: number }>();
    for (const p of pagos) { const k = p.metodo || "Sin dato"; const x = metodos.get(k) ?? { nombre: k, cantidad: 0, valor: 0 }; x.cantidad++; x.valor += p.valor; metodos.set(k, x); }
    const [a, m] = hoy.split("-").map(Number);
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(a, m - 12 + i, 1));
      const k = d.toISOString().slice(0, 7);
      return { mes: k, valor: datos.pagos.filter((p) => p.fecha.startsWith(k)).reduce((s, p) => s + p.valor, 0) };
    });
    const porCobrar = datos.tramites.filter((t) => t.estado !== "cancelado").reduce((s, t) => s + Math.max(0, t.total - (pagadoPor.get(t.id) ?? 0)), 0);
    return {
      recibidos, validos, finalizados, cancelados, pagos, meses, porCobrar, pagadoPor, tipo, org,
      facturado: validos.reduce((s, t) => s + t.total, 0),
      cobrado: pagos.reduce((s, p) => s + p.valor, 0),
      porTipo: agrupar(validos, (t) => tipo.get(t.tipoId) ?? ""),
      porOrganismo: agrupar(validos, (t) => (t.organismoId ? org.get(t.organismoId) ?? "" : "")),
      porAliado: agrupar(validos, (t) => t.aliado ?? ""),
      porMetodo: [...metodos.values()].sort((x, y) => y.valor - x.valor),
    };
  }, [datos, desde, hasta, hoy]);

  async function exportar() {
    if (!r || !datos) return;
    try {
      const XLSX = await import("xlsx");
      const cliente = new Map(datos.clientes.map((c) => [c.id, c]));
      const placa = new Map(datos.vehiculos.map((v) => [v.id, v.placa]));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.recibidos.map((t) => ({
        Número: codigoTramite(t), Fecha: t.creado.slice(0, 10), Trámite: r.tipo.get(t.tipoId), Estado: ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite],
        Titular: cliente.get(t.titularId)?.nombre, Documento: cliente.get(t.titularId)?.numeroDocumento || "", Celular: cliente.get(t.titularId)?.telefono || "",
        Placa: t.vehiculoId ? placa.get(t.vehiculoId) : "", Organismo: t.organismoId ? r.org.get(t.organismoId) : "", Aliado: t.aliado ?? "",
        Total: t.total, Pagado: r.pagadoPor.get(t.id) ?? 0, Saldo: Math.max(0, t.total - (r.pagadoPor.get(t.id) ?? 0)),
      }))), "Trámites");
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.pagos.map((p) => {
        const t = datos.tramites.find((x) => x.id === p.tramiteId);
        return { Fecha: p.fecha, Valor: p.valor, Método: p.metodo ?? "", Trámite: t ? codigoTramite(t) : "", Cliente: t ? cliente.get(t.titularId)?.nombre : "" };
      })), "Pagos");
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.porTipo.map((f) => ({ Trámite: f.nombre, Cantidad: f.cantidad, Facturado: f.valor }))), "Por tipo");
      XLSX.writeFile(libro, `Nexum reporte ${desde === "0000-01-01" ? "completo" : `${desde} a ${hasta.replace(/-31$/, "")}`}.xlsx`);
    } catch (e) {
      avisar(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  return (
    <>
      <Cabecera titulo="Reportes">
        <div className="seg">
          {([["mes", "Este mes"], ["anterior", "Mes anterior"], ["anio", "Este año"], ["12", "12 meses"], ["todo", "Todo"]] as [Periodo, string][]).map(([k, t]) => (
            <button key={k} className={periodo === k ? "on" : ""} onClick={() => setPeriodo(k)}>{t}</button>
          ))}
        </div>
        <button className="btn" onClick={exportar}><Download size={15} />Exportar a Excel</button>
      </Cabecera>
      <div className="contenido">
        {r && (
          <>
            <div className="kpis">
              <Kpi icono={FileText} tono="azul" valor={r.recibidos.length} etiqueta="Trámites recibidos" />
              <Kpi icono={FileCheck2} tono="verde" valor={r.finalizados.length} etiqueta="Finalizados" />
              <Kpi icono={XCircle} tono="vino" valor={r.cancelados.length} etiqueta="Cancelados" />
              <Kpi icono={Wallet} tono="verde" valor={pesos(r.cobrado)} etiqueta={`Cobrado · facturado ${pesos(r.facturado)}`} />
              <Kpi icono={Wallet} tono="rojo" valor={pesos(r.porCobrar)} etiqueta="Por cobrar (todos los periodos)" />
            </div>
            <CobradoPorMes meses={r.meses} />
            <div className="dos">
              <Desglose titulo="Por tipo de trámite" filas={r.porTipo} />
              <Desglose titulo="Por organismo" filas={r.porOrganismo} />
              <Desglose titulo="Por tramitador o academia" filas={r.porAliado} />
              <Desglose titulo="Pagos por método" filas={r.porMetodo} columnaValor="Cobrado" />
            </div>
          </>
        )}
      </div>
    </>
  );
}
