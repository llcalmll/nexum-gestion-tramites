import { useLiveQuery } from "dexie-react-hooks";
import { useMenuCliente } from "../componentes/accionesMenu";
import { FichaCliente } from "../componentes/Fichas";
import type { ItemMenu } from "../componentes/MenuContextual";
import { PanelCliente } from "../componentes/PanelCliente";
import { FilePlus2, IdCard, MessageCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ESTADO_GESTION_LICENCIA_LABEL, ESTADOS_GESTION_LICENCIA, normalizar, type EstadoGestionLicencia } from "../../compartido/dominio";
import { ActualizarRadarRunt } from "../componentes/ConsultasRunt";
import { TablaDatos } from "../componentes/TablaDatos";
import { Cabecera, useUI, Vacio } from "../componentes/ui";
import { Vigencia } from "../componentes/Vigencia";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { useParametros } from "../datos/hooks";
import { fecha, hoyISO } from "../logica/formato";

type Filtro = "vencidas" | "30" | "60" | "90" | "todas";
const RENOVACION = "Renovación de licencia";

/** Enlace para abrir el WhatsApp propio con el mensaje escrito (lo envía Felipe; la app no manda nada). */
function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string) {
  if (!telefono) return null;
  let d = telefono.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
  if (d.length < 11) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensaje)}`;
}

export default function Licencias() {
  const nav = useNavigate();
  const { avisar } = useUI();
  const parametros = useParametros();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [q, setQ] = useState("");
  const [nota, setNota] = useState<{ id: string; texto: string } | null>(null);
  const datos = useLiveQuery(async () => ({ licencias: await db.licencias.toArray(), clientes: await db.clientes.toArray() }), []);
  const hoy = hoyISO();
  const limite = (dias: number) => new Date(Date.parse(hoy) + dias * 10_000_000).toISOString().slice(0, 10);

  const todas = useMemo(() => {
    if (!datos) return [];
    const cliente = new Map(datos.clientes.map((c) => [c.id, c]));
    return datos.licencias.map((l) => ({ l, cliente: cliente.get(l.clienteId) }));
  }, [datos]);
  const enFiltro = (f: (typeof todas)[number], k: Filtro) => {
    const v = f.l.fechaVencimiento;
    if (k === "todas") return true;
    if (k === "vencidas") return v < hoy;
    return v >= hoy && v <= limite(Number(k));
  };
  const n = normalizar(q);
  const filas = todas.filter((f) => enFiltro(f, filtro) && (!n || normalizar(f.cliente?.nombre, f.cliente?.numeroDocumento, f.cliente?.telefono, f.l.categoria).includes(n)));
  const cuenta = Object.fromEntries((["vencidas", "30", "60", "90", "todas"] as Filtro[]).map((k) => [k, todas.filter((f) => enFiltro(f, k)).length])) as Record<Filtro, number>;
  const negocio = parametros.nombre_negocio || "Nexum Tránsito";
  /** Vencimiento calculado sin la edad real: la vigencia depende de la edad al expedirse (art. 197, Decreto 019 de 2012). */
  const estimada = (f: (typeof todas)[number]) => !f.cliente?.fechaNacimiento && (f.l.origen === "importada" || f.l.origen === "tramite");
  const sinNacimiento = todas.filter(estimada).length;

  async function seguimiento(id: string, cambios: Record<string, unknown>) {
    try { await escribir("PATCH", `/api/licencias/${id}`, cambios); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  const [fichaCliente, setFichaCliente] = useState<string | null>(null);
  const [editarCliente, setEditarCliente] = useState<string | null>(null);
  const menuCliente = useMenuCliente(setFichaCliente, setEditarCliente);
  const menuLicencia = (f: (typeof todas)[number]): ItemMenu[] => [
    { texto: "Crear la renovación", icono: FilePlus2, accion: () => nav(`/tramites?seccion=licencias&nuevo=1&titular=${f.l.clienteId}&tipo=${encodeURIComponent(RENOVACION)}&categoria=${f.l.categoria}&licencia=${f.l.id}`) },
    { texto: "Seguimiento", hijos: ESTADOS_GESTION_LICENCIA.filter((e) => e !== f.l.gestionEstado).map((e) => ({ texto: ESTADO_GESTION_LICENCIA_LABEL[e], accion: () => void seguimiento(f.l.id, { gestionEstado: e }) })) },
    "-",
    ...(f.cliente ? menuCliente(f.cliente).filter((x) => x === "-" || !/^Eliminar/.test(x.texto)) : []),
  ];

  return (
    <>
      <Cabecera titulo="Licencias" sub="Radar de renovaciones"><ActualizarRadarRunt /></Cabecera>
      <div className="contenido">
        <TablaDatos
          idGuardado="licencias-v2"
          menuFila={menuLicencia}
          reinicio={[q, filtro]}
          filas={filas}
          clave={(f) => f.l.id}
          ordenInicial={{ id: "vence", dir: filtro === "vencidas" ? -1 : 1 }}
          marca={(f) => (f.l.fechaVencimiento < hoy ? "rojo" : f.l.fechaVencimiento <= limite(30) ? "ambar" : undefined)}
          barra={
            <div className="fila-wrap">
              <div className="seg">
                {([["vencidas", "Vencidas"], ["30", "30 días"], ["60", "60 días"], ["90", "90 días"], ["todas", "Todas"]] as [Filtro, string][]).map(([k, t]) => (
                  <button key={k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{t} <span className="cuenta">{cuenta[k]}</span></button>
                ))}
              </div>
              <div className="buscar" style={{ width: 260 }}><Search size={15} /><input className="input" placeholder="Buscar cliente o categoría" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </div>
          }
          vacio={<Vacio icono={IdCard} titulo={filtro === "vencidas" ? "No hay licencias vencidas" : "No hay licencias por vencer en este rango"}>{filtro !== "todas" && <button className="btn btn-sm" onClick={() => setFiltro("todas")}>Ver todas ({cuenta.todas})</button>}</Vacio>}
          columnas={[
            { id: "cliente", titulo: "Cliente", fija: true, valor: (f) => f.cliente?.nombre, celda: (f) => <div className="principal-celda"><div><b>{f.cliente?.nombre}</b><small>{f.cliente?.telefono ?? "Sin teléfono"}</small></div></div> },
            { id: "categoria", titulo: "Categoría", valor: (f) => f.l.categoria, celda: (f) => <b>{f.l.categoria}</b> },
            {
              id: "vence", titulo: "Vence", valor: (f) => f.l.fechaVencimiento,
              celda: (f) => (
                <span className="fila" style={{ gap: 6 }}>
                  <Vigencia hasta={f.l.fechaVencimiento} />
                  {estimada(f) && <span className="peq tenue" title="Falta la fecha de nacimiento del cliente: se supuso menor de 60 años. Al registrarla (por ejemplo, leyendo su cédula) o al consultar el RUNT, queda la fecha real.">estimada</span>}
                  {f.l.origen === "consulta" && <span className="peq tenue" title="Fecha real consultada en el RUNT">RUNT</span>}
                </span>
              ),
            },
            { id: "origen", titulo: "Origen", oculta: true, valor: (f) => f.l.origen, celda: (f) => (f.l.origen === "importada" ? "Importada (estimada)" : f.l.origen) },
            {
              id: "gestion", titulo: "Seguimiento", valor: (f) => f.l.gestionEstado,
              celda: (f) => (
                <select className="select" style={{ height: 30, width: 140 }} value={f.l.gestionEstado} onClick={(e) => e.stopPropagation()} onChange={(e) => seguimiento(f.l.id, { gestionEstado: e.target.value })}>
                  {ESTADOS_GESTION_LICENCIA.map((s) => <option key={s} value={s}>{ESTADO_GESTION_LICENCIA_LABEL[s as EstadoGestionLicencia]}</option>)}
                </select>
              ),
            },
            {
              id: "nota", titulo: "Nota", valor: (f) => f.l.gestionNota,
              celda: (f) => nota?.id === f.l.id ? (
                <input className="input" style={{ height: 30, minWidth: 200 }} autoFocus value={nota.texto} onClick={(e) => e.stopPropagation()} onChange={(e) => setNota({ id: f.l.id, texto: e.target.value })}
                  onBlur={() => { if (nota.texto !== (f.l.gestionNota ?? "")) seguimiento(f.l.id, { gestionNota: nota.texto }); setNota(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNota(null); }} />
              ) : (
                <span className={f.l.gestionNota ? "" : "sin-dato"} style={{ cursor: "text", whiteSpace: "normal" }} onClick={(e) => { e.stopPropagation(); setNota({ id: f.l.id, texto: f.l.gestionNota ?? "" }); }}>
                  {f.l.gestionNota || "Agregar nota"}{f.l.gestionFecha ? <span className="peq tenue"> · {fecha(f.l.gestionFecha)}</span> : null}
                </span>
              ),
            },
            {
              id: "acciones", titulo: "",
              celda: (f) => {
                const wa = enlaceWhatsApp(f.cliente?.telefono, `Hola ${f.cliente?.nombre?.split(" ")[0] ?? ""}, le escribimos de ${negocio}. Su licencia de conducción ${f.l.categoria} vence el ${fecha(f.l.fechaVencimiento)}. ¿Le ayudamos con la renovación?`);
                return (
                  <span className="fila" style={{ gap: 4 }}>
                    {wa && <a className="btn btn-sm btn-wa" href={wa} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); seguimiento(f.l.id, { gestionEstado: f.l.gestionEstado === "sin_gestion" || f.l.gestionEstado === "por_llamar" ? "contactado" : f.l.gestionEstado }); }} title="Abrir mi WhatsApp con el mensaje escrito"><MessageCircle size={13} />WhatsApp</a>}
                    <button className="btn btn-sm" title="Crear el trámite de renovación" onClick={(e) => { e.stopPropagation(); nav(`/tramites?seccion=licencias&nuevo=1&titular=${f.l.clienteId}&tipo=${encodeURIComponent(RENOVACION)}&categoria=${f.l.categoria}&licencia=${f.l.id}`); }}><FilePlus2 size={13} />Renovación</button>
                  </span>
                );
              },
            },
          ]}
        />
        <p className="peq muted">
          {sinNacimiento > 0 && <>{sinNacimiento} licencia{sinNacimiento === 1 ? " tiene" : "s tienen"} el vencimiento estimado: falta la fecha de nacimiento del cliente y se supuso menor de 60 años. La vigencia depende de la edad al expedirse (particular: 10 años antes de los 60, 5 entre 60 y 80, 1 después de los 80; servicio público: 3 años antes de los 60, 1 desde los 60). Al registrar la fecha de nacimiento, por ejemplo leyendo su cédula, el vencimiento se recalcula solo. </>}
          El aviso diario crea una llamada por cada licencia que vence en los próximos 45 días.
        </p>
      </div>
      <FichaCliente clienteId={fichaCliente} onCerrar={() => setFichaCliente(null)} />
      <PanelCliente abierto={!!editarCliente} clienteId={editarCliente} onCerrar={() => setEditarCliente(null)} />
    </>
  );
}
