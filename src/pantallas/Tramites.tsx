import { useLiveQuery } from "dexie-react-hooks";
import { Chicharron } from "../componentes/Chicharron";
import { Copiar } from "../componentes/Copiar";
import { useMenuTramite } from "../componentes/accionesMenu";
import { abrirMenu } from "../componentes/MenuContextual";
import { AlertTriangle, FilePlus2, FileText, MapPin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { codigoTramite, ESTADO_PAGO_LABEL, ESTADO_TARJETA_LABEL, ESTADO_TRAMITE_LABEL, type EstadoPago, ESTADOS_TERMINALES, type EstadoTarjeta, type EstadoTramite } from "../../compartido/dominio";
import type { Tramite } from "../../compartido/tipos";
import { BotonFinalizar, moverTramite } from "../componentes/Finalizar";
import { InfoIncompleta } from "../componentes/InfoIncompleta";
import { LucesEstado } from "../componentes/LucesEstado";
import { NotaVistazo } from "../componentes/NotaVistazo";
import { Semaforo } from "../componentes/Semaforo";
import { camposDeTramite, coincide, indexar, palabras, type Pista, useDatosBusqueda } from "../datos/busqueda";
import { useSemaforos } from "../datos/semaforo";
import { cartaFalta, COLORES_SEMAFORO, type ColorSemaforo } from "../../compartido/reglas";
import { PanelNuevoTramite } from "../componentes/PanelNuevoTramite";
import { useFaltantes } from "../datos/incompletos";
import { Placa, SimboloLicencia } from "../componentes/Placa";
import { TablaDatos } from "../componentes/TablaDatos";
import { Badge, Cabecera, useUI, Vacio, type Tono } from "../componentes/ui";
import { db } from "../datos/db";
import { fecha, hoyISO, pesos } from "../logica/formato";

/** El flujo de la oficina: se recibe, va al tránsito, se finaliza. "Requiere corrección" va aparte, después. */
const FLUJO: EstadoTramite[] = ["en_preparacion", "en_tramite", "entregado"];
const TONO_PAGO: Record<EstadoPago, Tono> = { pendiente: "rojo", abonado: "ambar", pagado: "verde" };
const COLOR_COLUMNA: Record<string, string> = { en_preparacion: "var(--borde-fuerte)", en_tramite: "var(--azul)", entregado: "var(--verde)", requiere_correccion: "var(--rojo)", cancelado: "var(--vino)" };
const DIAS_FINALIZADOS = 30;

/** Dos secciones, cada una con su tablero y su tabla: los trámites (de vehículos y los demás) y los de licencia. */
type Seccion = "tramites" | "licencias";
const NOMBRE_SECCION: Record<Seccion, string> = { tramites: "Trámites", licencias: "Licencias" };

/** Una fila por trámite; un combo (encargo) es una sola fila con todos sus trámites ("Traspaso + Levantamiento de prenda"). */
type Fila = { t: Tramite; tipo: string; licencia: boolean; titular: string; placa: string; ciudad: string | null; ciudadTramite: string; servicio: string | null; combo: boolean; total: number; ids: string[]; atrasado: boolean; cierre: string; llego: string; pista: Pista | null };

/** El día en que llegó el trámite (en Colombia), de su fecha de creación. */
const diaDe = (iso: string) => (iso.length <= 10 ? iso : new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }));
const ayerDe = (hoy: string) => new Date(Date.parse(`${hoy}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
/**
 * La fecha en que llegó: "Hoy" resaltado, "Ayer" más suave; las demás, el día. Al pasar el mouse por una, se resaltan
 * todas las del mismo día (para encontrar los que llegaron juntos).
 */
function Llegada({ dia, hoy, sobre, alSobre }: { dia: string; hoy: string; sobre: string | null; alSobre: (d: string | null) => void }) {
  const cual = dia === hoy ? " hoy" : dia === ayerDe(hoy) ? " ayer" : "";
  // La que está bajo el mouse, fuerte; las demás del mismo día, más suaves.
  const [esta, setEsta] = useState(false);
  return (
    <span className={`llegada${cual}${sobre === dia ? " mismo-dia" : ""}${esta ? " esta" : ""}`} title={`Llegó el ${fecha(dia)} (pase el mouse para ver los del mismo día)`}
      onMouseEnter={() => { setEsta(true); alSobre(dia); }} onMouseLeave={() => { setEsta(false); alSobre(null); }}>
      {dia === hoy ? "Hoy" : dia === ayerDe(hoy) ? "Ayer" : fecha(dia).replace(/ \d{4}$/, (a) => (dia.slice(0, 4) === hoy.slice(0, 4) ? "" : a))}
    </span>
  );
}

function leer(clave: string, defecto: string) {
  try { return localStorage.getItem(clave) ?? defecto; } catch { return defecto; }
}
function guardar(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* nada */ }
}

export default function Tramites() {
  const nav = useNavigate();
  const ui = useUI();
  const [params, setParams] = useSearchParams();
  const [vista, setVista] = useState<"tablero" | "tabla">(() => (leer("tramites-vista", "tablero") === "tabla" ? "tabla" : "tablero"));
  // La sección va en la dirección (?seccion=licencias) para que "atrás" vuelva a la misma; si no dice, la última usada.
  const seccion: Seccion = params.get("seccion") === "licencias" || (!params.get("seccion") && leer("tramites-seccion", "tramites") === "licencias") ? "licencias" : "tramites";
  const [q, setQ] = useState("");
  const [todosFinalizados, setTodosFinalizados] = useState(false);
  const [cancelados, setCancelados] = useState(false);
  const [correccionAbierta, setCorreccionAbierta] = useState(() => leer("tablero-correccion", "1") === "1");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const datos = useLiveQuery(async () => {
    const [tramites, tipos, clientes, vehiculos, organismos] = await Promise.all([db.tramites.toArray(), db.tipos_tramite.toArray(), db.clientes.toArray(), db.vehiculos.toArray(), db.organismos.toArray()]);
    return { tramites, tipos, clientes, vehiculos, organismos };
  }, []);

  const faltan = useFaltantes();
  const menuTramite = useMenuTramite();
  const semaforos = useSemaforos();
  // Para buscar por cualquier dato: las personas de cada trámite y su bitácora.
  const extra = useDatosBusqueda();
  // La nota destacada de cada trámite (en un combo, la de cualquiera de sus partes): el simbolito de nota.
  const destacadas = useLiveQuery(() => db.bitacora.filter((b) => !!b.destacada).toArray(), []) ?? [];
  // Filtro por color del semáforo (en la tabla y el tablero), guardado en la dirección: ?color=rojo
  const color = (params.get("color") as ColorSemaforo | null) ?? null;
  const todas = useMemo<Fila[]>(() => {
    if (!datos) return [];
    const tipo = new Map(datos.tipos.map((t) => [t.id, t]));
    const cliente = new Map(datos.clientes.map((c) => [c.id, c]));
    const vehiculo = new Map(datos.vehiculos.map((v) => [v.id, v]));
    const ciudad = new Map(datos.organismos.map((o) => [o.id, o.ciudad]));
    // Combos: los trámites vigentes de cada encargo (el cancelado de un combo queda aparte, en su columna).
    const combos = new Map<string, Tramite[]>();
    for (const t of datos.tramites) if (t.encargoId && t.estado !== "cancelado") combos.set(t.encargoId, [...(combos.get(t.encargoId) ?? []), t].sort((a, b) => a.numero - b.numero));
    const partesDe = (t: Tramite) => (t.encargoId && t.estado !== "cancelado" ? combos.get(t.encargoId) ?? [t] : [t]);
    const hoy = hoyISO();
    const ps = palabras(q);
    const cx = { cliente, vehiculo, tipo, ciudad, extra, faltaInfo: (id: string) => faltan.has(id) };
    return datos.tramites
      // Del combo se muestra solo el primero (con el código y los trámites de todos).
      .filter((t) => partesDe(t)[0].id === t.id)
      .map((t) => {
        const c = cliente.get(t.titularId);
        const v = t.vehiculoId ? vehiculo.get(t.vehiculoId) : undefined;
        const tp = tipo.get(t.tipoId);
        const partes = partesDe(t);
        const nombres = partes.map((x) => tipo.get(x.tipoId)?.nombre ?? "");
        return {
          t, tipo: nombres.join(" + "), licencia: tp?.categoria === "licencia", titular: c?.nombre ?? "", placa: v?.placa ?? "",
          ciudad: v?.organismoMatriculaId ? ciudad.get(v.organismoMatriculaId) ?? null : null, servicio: v?.servicio ?? null,
          // Dónde se hace el trámite (su organismo de tránsito).
          ciudadTramite: (t.organismoId ? ciudad.get(t.organismoId) : null) ?? "",
          combo: partes.length > 1, total: partes.reduce((s, x) => s + x.total, 0), ids: partes.map((x) => x.id),
          atrasado: !!t.fechaEstimadaEntrega && t.fechaEstimadaEntrega < hoy && !ESTADOS_TERMINALES.includes(t.estado as EstadoTramite),
          // Fecha de cierre: la de entrega; los importados no la tienen y se usa la de recepción.
          cierre: (t.fechaEntrega ?? t.creado).slice(0, 10),
          llego: diaDe(t.creado),
          // Se encuentra por cualquier dato de cualquiera de sus partes; la pista dice dónde, si no se ve en la fila.
          ...(() => { const r = ps.length ? coincide(indexar(camposDeTramite(partes, cx)), ps) : { ok: true, pista: null }; return { ok: r.ok, pista: r.pista }; })(),
        };
      })
      .filter((f) => f.ok);
  }, [datos, q, faltan, extra]);
  // La fecha de llegada que tiene el mouse encima: se resaltan todas las del mismo día.
  const [diaSobre, setDiaSobre] = useState<string | null>(null);
  // Los trámites con la carta de compromiso pendiente (primera vez): el símbolo de peligro.
  const sinCarta = useLiveQuery(async () => new Set((await db.documentos.filter(cartaFalta).toArray()).map((d) => d.tramiteId)), []) ?? new Set<string>();
  const peligro = (f: Fila) => (f.ids.some((id) => sinCarta.has(id)) ? <span className="peligro-tramite" title="Falta la carta de compromiso firmada" aria-label="Falta la carta de compromiso firmada" role="img"><AlertTriangle size={14} /></span> : null);
  const hoyDia = hoyISO();
  const llegada = (f: Fila) => <Llegada dia={f.llego} hoy={hoyDia} sobre={diaSobre} alSobre={setDiaSobre} />;
  const notaDe = useMemo(() => { const m = new Map(destacadas.map((b) => [b.tramiteId, b])); return (ids: string[]) => ids.map((i) => m.get(i)).find(Boolean); }, [destacadas]);
  const deLaSeccion = useMemo(() => todas.filter((f) => f.licencia === (seccion === "licencias")), [todas, seccion]);
  const filas = useMemo(() => deLaSeccion.filter((f) => !color || semaforos.get(f.t.id)?.color === color), [deLaSeccion, color, semaforos]);
  // Lo que hay en cada sección: los abiertos y, buscando, cuántos coinciden (para saber si está en la otra).
  const resumenSeccion = (sec: Seccion) => {
    const l = todas.filter((f) => f.licencia === (sec === "licencias"));
    return { abiertos: l.filter((f) => !ESTADOS_TERMINALES.includes(f.t.estado as EstadoTramite)).length, total: l.length };
  };

  // Los colores del semáforo con cuántos hay de cada uno (de la sección, sin el filtro de color).
  const cuantosColor = useMemo(() => {
    const c = new Map<ColorSemaforo, number>();
    for (const f of deLaSeccion) { const s = semaforos.get(f.t.id); if (s) c.set(s.color, (c.get(s.color) ?? 0) + 1); }
    return c;
  }, [semaforos, deLaSeccion]);
  const filtroColor = (
    <div className="filtro-semaforo" role="group" aria-label="Filtrar por color del semáforo">
      {COLORES_SEMAFORO.filter((c) => cuantosColor.get(c.color)).map((c) => (
        <button key={c.color} type="button" className={`chip-semaforo ${c.color}${color === c.color ? " on" : ""}`} aria-pressed={color === c.color} title={`${c.nombre}: ${c.que}`}
          onClick={() => poner("color", color === c.color ? null : c.color)}>
          <i />{cuantosColor.get(c.color)}
        </button>
      ))}
      {color && <button type="button" className="btn btn-sm btn-fantasma" onClick={() => poner("color", null)}>Quitar filtro</button>}
    </div>
  );

  const cambiarVista = (v: "tablero" | "tabla") => { setVista(v); guardar("tramites-vista", v); };
  const cambiarSeccion = (sec: Seccion) => { guardar("tramites-seccion", sec); setParams((p) => { const x = new URLSearchParams(p); x.set("seccion", sec); x.delete("color"); return x; }, { replace: true }); };
  const poner = (k: string, v: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });

  /** Arrastrar una tarjeta a otra columna: si le faltan precondiciones, pregunta si se dan por cumplidas (como las luces). */
  async function mover(id: string, estado: EstadoTramite) {
    const f = filas.find((x) => x.t.id === id);
    if (!f || f.t.estado === estado) return;
    await moverTramite(f.t, estado, ui, null, { sinPreguntar: true });
  }

  const desde = new Date(Date.now() - DIAS_FINALIZADOS * 10_000_000).toISOString().slice(0, 10);
  const enColumna = (estado: EstadoTramite) => {
    const lista = filas.filter((f) => f.t.estado === estado);
    const visibles = estado === "entregado" && !todosFinalizados && !q ? lista.filter((f) => f.cierre >= desde) : lista;
    const orden = estado === "entregado" || estado === "cancelado"
      ? (a: Fila, b: Fila) => b.cierre.localeCompare(a.cierre)
      : (a: Fila, b: Fila) => Number(b.atrasado) - Number(a.atrasado) || (a.t.fechaEstimadaEntrega ?? "9").localeCompare(b.t.fechaEstimadaEntrega ?? "9");
    return { total: lista.length, visibles: visibles.sort(orden) };
  };
  const correcciones = filas.filter((f) => f.t.estado === "requiere_correccion").length;
  // La columna solo existe si hay correcciones. Sin correcciones, al arrastrar aparece una zona flotante:
  // agregar una columna en pleno arrastre correría las demás y la tarjeta caería en otra.
  const columnas: EstadoTramite[] = [...FLUJO, ...(correcciones > 0 ? (["requiere_correccion"] as EstadoTramite[]) : []), ...(cancelados ? (["cancelado"] as EstadoTramite[]) : [])];
  const abiertos = filas.filter((f) => !ESTADOS_TERMINALES.includes(f.t.estado as EstadoTramite)).length;

  const soltar = (estado: EstadoTramite) => ({
    onDragOver: (e: React.DragEvent) => { if (arrastrando) { e.preventDefault(); setSobre(estado); } },
    onDragLeave: () => setSobre(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(null); if (arrastrando) mover(arrastrando, estado); setArrastrando(null); },
  });

  return (
    <>
      <Cabecera titulo={NOMBRE_SECCION[seccion]} sub={seccion === "licencias" ? "Trámites de licencias de conducción" : "Trámites de vehículos"}>
        <div className="seg">
          <button className={vista === "tablero" ? "on" : ""} onClick={() => cambiarVista("tablero")}>Tablero</button>
          <button className={vista === "tabla" ? "on" : ""} onClick={() => cambiarVista("tabla")}>Tabla</button>
        </div>
        <button className="btn btn-primario" onClick={() => poner("nuevo", "1")}><FilePlus2 size={15} />Nuevo trámite</button>
      </Cabecera>
      <div className="contenido">
        {vista === "tablero" ? (
          <>
            <div className="fila-wrap">
              <div className="buscar" style={{ width: 320 }}><Search size={15} /><input className="input" placeholder="Buscar por número, nombre, cédula, placa, VIN, motor, teléfono, nota…" title="Busca en todos los datos del trámite: personas, cédulas, teléfonos, placa, VIN, motor, chasis, aliado, observaciones y bitácora" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              {filtroColor}
              <div className="espacio" />
              <label className="fila peq muted" style={{ gap: 6 }}><input type="checkbox" checked={todosFinalizados} onChange={(e) => setTodosFinalizados(e.target.checked)} />Todos los finalizados</label>
              <label className="fila peq muted" style={{ gap: 6 }}><input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} />Cancelados</label>
            </div>
            {!abiertos && !q && !filas.length ? (
              <Vacio icono={FileText} titulo={seccion === "licencias" ? "No hay trámites de licencia" : "No hay trámites"}><button className="btn btn-primario" onClick={() => poner("nuevo", "1")}>Crear el primero</button></Vacio>
            ) : (
              <div className="tablero-flex">
                {columnas.map((estado) => {
                  const { total, visibles } = enColumna(estado);
                  const plegada = estado === "requiere_correccion" && !correccionAbierta;
                  if (plegada) {
                    return (
                      <div key={estado} className="columna plegada" title="Mostrar los que requieren corrección" onClick={() => { setCorreccionAbierta(true); guardar("tablero-correccion", "1"); }} {...soltar(estado)}>
                        <div className="columna-cab" style={{ borderTopColor: COLOR_COLUMNA[estado] }}><b>{total}</b></div>
                        <span className="vertical">{ESTADO_TRAMITE_LABEL[estado]}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={estado} className={`columna ${sobre === estado ? "soltar" : ""}`} {...soltar(estado)}>
                      <div className="columna-cab" style={{ borderTopColor: COLOR_COLUMNA[estado] }}>
                        <div className="fila">
                          <h3>{ESTADO_TRAMITE_LABEL[estado]}</h3>
                          <span className="fila" style={{ gap: 6 }}>
                            <small>{estado === "entregado" && visibles.length < total ? `${visibles.length} de ${total}` : total}</small>
                            {estado === "requiere_correccion" && (
                              <button className="btn btn-fantasma btn-sm" style={{ height: 22, padding: "0 6px" }} title="Plegar" onClick={() => { setCorreccionAbierta(false); guardar("tablero-correccion", "0"); }}>Plegar</button>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="columna-lista">
                        {visibles.map((f) => (
                          <div
                            key={f.t.id}
                            className={`tarjeta-k ${f.atrasado ? "atrasada" : ""} ${arrastrando === f.t.id ? "arrastrando" : ""}`}
                            draggable
                            // Se marca un instante después: si el tablero cambia en el mismo momento en que empieza
                            // el arrastre (aparece "Requiere corrección"), Chrome lo cancela.
                            onDragStart={() => { const id = f.t.id; setTimeout(() => setArrastrando(id), 0); }}
                            onDragEnd={() => setTimeout(() => { setArrastrando(null); setSobre(null); }, 0)}
                            onClick={() => nav(`/tramites/${f.t.id}`)}
                            onContextMenu={(e) => abrirMenu(e, menuTramite(f.t, { placa: f.placa }))}
                          >
                            <div className="cabeza">
                              <div style={{ minWidth: 0 }}>
                                <small className="fila" style={{ gap: 6 }}><Semaforo s={semaforos.get(f.t.id)} />{codigoTramite(f.t)}<Chicharron t={f.t} tam={13} />{peligro(f)}<NotaVistazo b={notaDe(f.ids)} chica />{llegada(f)}</small>
                                <b style={{ display: "block", marginTop: 2 }}>{f.tipo}</b>
                              </div>
                              {f.licencia ? <SimboloLicencia categorias={f.t.detalle} /> : f.placa ? <span className="con-copiar"><Placa placa={f.placa} ciudad={f.ciudad} servicio={f.servicio} /><Copiar valor={f.placa} que="la placa" /></span> : null}
                            </div>
                            <span className="peq muted con-copiar">{f.titular}<Copiar valor={f.titular} que="el nombre" /></span>
                            {f.pista && <span className="pista-busqueda" title={`${f.pista.etiqueta}: ${f.pista.texto}`}><b>{f.pista.etiqueta}:</b> {f.pista.texto}</span>}
                            {f.ciudadTramite && <span className="peq tarjeta-ciudad"><MapPin size={12} />{f.ciudadTramite}</span>}
                            <div className="fila-wrap" style={{ gap: 4 }}>
                              {f.t.borrador && <Badge tono="morado">Borrador</Badge>}
                              <InfoIncompleta falta={faltan.get(f.t.id)} />
                              {f.combo && <Badge tono="cian">Combo</Badge>}
                              <Badge tono={TONO_PAGO[f.t.estadoPago as EstadoPago]}>{ESTADO_PAGO_LABEL[f.t.estadoPago as EstadoPago]}</Badge>
                              {estado === "entregado" && f.t.estadoTarjeta && f.t.estadoTarjeta !== "entregada" && <Badge tono="ambar">{ESTADO_TARJETA_LABEL[f.t.estadoTarjeta as EstadoTarjeta]}</Badge>}
                              {f.atrasado && <Badge tono="rojo">Atrasado {fecha(f.t.fechaEstimadaEntrega)}</Badge>}
                            </div>
                            {!ESTADOS_TERMINALES.includes(estado) && <div className="tarjeta-acciones"><BotonFinalizar t={f.t} tamano="xs" /></div>}
                          </div>
                        ))}
                        {estado === "entregado" && visibles.length < total && (
                          <div className="mas-info">Se muestran los de los últimos {DIAS_FINALIZADOS} días. <a href="#" onClick={(e) => { e.preventDefault(); setTodosFinalizados(true); }}>Ver todos</a></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {arrastrando && correcciones === 0 && (
              <div className={`zona-correccion ${sobre === "requiere_correccion" ? "encima" : ""}`} {...soltar("requiere_correccion")}>
                Soltar aquí: requiere corrección
              </div>
            )}
          </>
        ) : (
          <TablaDatos
            key={seccion}
            idGuardado={seccion === "licencias" ? "tramites-licencias" : "tramites"}
            filas={filas}
            clave={(f) => f.t.id}
            onFila={(f) => nav(`/tramites/${f.t.id}`)}
            menuFila={(f) => menuTramite(f.t, { placa: f.placa })}
            reinicio={[q, color]}
            ordenInicial={{ id: "numero", dir: -1 }}
            marca={(f) => (f.atrasado ? "rojo" : undefined)}
            barra={<div className="fila-wrap" style={{ gap: 10 }}><div className="buscar" style={{ width: 320 }}><Search size={15} /><input className="input" placeholder="Buscar por número, nombre, cédula, placa, VIN, motor, teléfono, nota…" title="Busca en todos los datos del trámite: personas, cédulas, teléfonos, placa, VIN, motor, chasis, aliado, observaciones y bitácora" value={q} onChange={(e) => setQ(e.target.value)} /></div>{color && <span className="filtro-mapa">Solo en {COLORES_SEMAFORO.find((c) => c.color === color)?.nombre.toLowerCase() ?? color} (desde el mapa)<button type="button" className="btn btn-sm btn-fantasma" onClick={() => poner("color", null)}>Quitar</button></span>}</div>}
            vacio={<Vacio icono={FileText} titulo={q ? "Ningún trámite coincide" : seccion === "licencias" ? "Todavía no hay trámites de licencia" : "Todavía no hay trámites"} />}
            columnas={[
              // Junto al número (la columna fija, siempre a la vista): el chicharrón y la nota destacada.
              { id: "numero", titulo: "Número", fija: true, valor: (f) => f.t.numero, celda: (f) => <div className="numero-celda"><b className="fila" style={{ gap: 6 }}>{codigoTramite(f.t)}<Chicharron t={f.t} />{peligro(f)}<NotaVistazo b={notaDe(f.ids)} chica /></b>{llegada(f)}</div> },
              { id: "tipo", titulo: "Trámite", valor: (f) => f.tipo, celda: (f) => <>{f.tipo}{f.combo && <> <Badge tono="cian">Combo</Badge></>}{faltan.has(f.t.id) && <> <InfoIncompleta falta={faltan.get(f.t.id)} /></>}{f.pista && <span className="pista-busqueda" title={`${f.pista.etiqueta}: ${f.pista.texto}`}><b>{f.pista.etiqueta}:</b> {f.pista.texto}</span>}</> },
              { id: "titular", titulo: "Titular", valor: (f) => f.titular, celda: (f) => <span className="con-copiar">{f.titular}<Copiar valor={f.titular} que="el nombre" /></span> },
              // Como en el tablero: la placa como placa y la licencia con sus categorías.
              seccion === "licencias"
                ? { id: "categorias", titulo: "Categorías", valor: (f) => f.t.detalle ?? "", celda: (f) => <SimboloLicencia categorias={f.t.detalle} /> }
                : { id: "placa", titulo: "Placa", valor: (f) => f.placa, celda: (f) => (f.placa ? <span className="con-copiar"><Placa placa={f.placa} ciudad={f.ciudad} servicio={f.servicio} /><Copiar valor={f.placa} que="la placa" /></span> : <span className="sin-dato">Sin placa</span>) },
              { id: "ciudad", titulo: "Ciudad", valor: (f) => f.ciudadTramite, celda: (f) => f.ciudadTramite || <span className="sin-dato">Sin dato</span> },
              { id: "estado", titulo: "Estado", valor: (f) => f.t.estado, celda: (f) => <LucesEstado t={f.t} /> },
              { id: "pago", titulo: "Pago", valor: (f) => f.t.estadoPago, celda: (f) => <Badge tono={TONO_PAGO[f.t.estadoPago as EstadoPago]}>{ESTADO_PAGO_LABEL[f.t.estadoPago as EstadoPago]}</Badge> },
              { id: "tarjeta", titulo: "Tarjeta", valor: (f) => f.t.estadoTarjeta, celda: (f) => (f.t.estadoTarjeta ? ESTADO_TARJETA_LABEL[f.t.estadoTarjeta as EstadoTarjeta] : "") },
              { id: "entrega_estimada", titulo: "Entrega estimada", oculta: true, valor: (f) => f.t.fechaEstimadaEntrega, celda: (f) => fecha(f.t.fechaEstimadaEntrega) },
              { id: "total", titulo: "Total", alinear: "der", valor: (f) => f.total, celda: (f) => pesos(f.total) },
              { id: "creado", titulo: "Llegó", oculta: true, valor: (f) => f.llego, celda: (f) => fecha(f.llego) },
              { id: "finalizar", titulo: "", valor: () => 0, celda: (f) => <BotonFinalizar t={f.t} etiqueta={false} /> },
            ]}
          />
        )}
      </div>
      <nav className="hojas-seccion" aria-label="Sección">
        {(["tramites", "licencias"] as const).map((sec) => {
          const r = resumenSeccion(sec);
          return (
            <button key={sec} type="button" className={seccion === sec ? "on" : ""} aria-pressed={seccion === sec} onClick={() => cambiarSeccion(sec)}
              title={q ? `${r.total} con «${q}»` : `${r.abiertos} abiertos`}>
              {NOMBRE_SECCION[sec]}<small>{q ? r.total : r.abiertos}</small>
            </button>
          );
        })}
        {q && !filas.length && resumenSeccion(seccion === "licencias" ? "tramites" : "licencias").total > 0 && (
          <span className="peq muted">«{q}» está en {NOMBRE_SECCION[seccion === "licencias" ? "tramites" : "licencias"]}</span>
        )}
      </nav>
      <PanelNuevoTramite abierto={params.get("nuevo") === "1"} onCerrar={() => poner("nuevo", null)} titularInicial={params.get("titular")} tipoInicial={params.get("tipo")} categoriaInicial={params.get("categoria")} licenciaId={params.get("licencia")} alCrear={(ids) => nav(`/tramites/${ids[0]}`)} />
    </>
  );
}
