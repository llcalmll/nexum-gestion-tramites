import { useLiveQuery } from "dexie-react-hooks";
import { Chicharron, marcarChicharron, TEXTO_CHICHARRON } from "../componentes/Chicharron";
import { Skull } from "lucide-react";
import { PanelCliente, type PersonaDelTramite } from "../componentes/PanelCliente";
import { AlertTriangle, CalendarPlus, Check, CheckCircle2, Send, ChevronDown, Circle, Clipboard, Combine, Copy, Download, Eye, Layers, ExternalLink, FileText, FileUp, Info, List as ListIcon, Loader2, MessageSquarePlus, Paperclip, Pencil, Pin, PinOff, Plus, RotateCcw, ScanLine, SlidersHorizontal, Sparkles, Star, StarOff, Trash2, UserPlus, X } from "lucide-react";
import { EscanearFotos, type DestinoEscaneo, type Entrada, type FuenteParte, type Modo } from "../componentes/EscanearFotos";
import { PDFDocument } from "pdf-lib";
import { type Composicion, resumenComposicion } from "../../compartido/composicion";
import { imagenesDelPdf } from "../escaner/pdfImagenes";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { BotonPegar, usePegarImagenes } from "../componentes/Pegar";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CATEGORIAS_LICENCIA, codigoTramite, ESTADOS_TERMINALES, PRECONDICIONES, CONCEPTO_PAGO_LABEL, type ConceptoPago, CONCEPTOS_PAGO, ESTADO_PAGO_LABEL, ESTADO_TARJETA_LABEL, ESTADO_TRAMITE_COLOR, ESTADO_TRAMITE_LABEL, type EstadoPago, ESTADOS_TARJETA, type EstadoTarjeta, type EstadoTramite, normalizar, ROL_PERSONA_LABEL, ROLES_PERSONA, type RolPersona } from "../../compartido/dominio";
import { precioLicencia } from "../../compartido/preciosLicencia";
import { categoriasDeTexto, type EstadoPrecondicion, evaluarPrecondiciones, faltantes, type CostosSugeridos, alertasTramite, cartaFalta, DOC_COMPROMISO, pideCompromiso } from "../../compartido/reglas";
import type { Documento, EntradaBitacora, Tramite } from "../../compartido/tipos";
import { Buscador, BuscadorOrganismo, Campo, ErrorFormulario, Fecha, Opciones, Pesos, Texto } from "../componentes/formulario";
import { FichaCliente, FichaVehiculo } from "../componentes/Fichas";
import { PanelRecordatorio } from "../componentes/PanelRecordatorio";
import { ciudadDeEnvio, rutaEnvio } from "../logica/envio";
import { PanelVehiculo } from "../componentes/PanelVehiculo";
import { VisorArchivos } from "../componentes/VisorArchivos";
import { abrirMenu, type ItemMenu } from "../componentes/MenuContextual";
import { copiarArchivo } from "../logica/copiarArchivo";
import { copiarTexto } from "../componentes/Copiar";
import { RevisionPrevia } from "../componentes/ConsultasRunt";
import { Copiar } from "../componentes/Copiar";
import { BotonFinalizar } from "../componentes/Finalizar";
import { InfoIncompleta } from "../componentes/InfoIncompleta";
import { Semaforo } from "../componentes/Semaforo";
import { useSemaforos } from "../datos/semaforo";
import { useFaltantes } from "../datos/incompletos";
import { Badge, Cabecera, Menu, Panel, useUI, Vacio, type Tono } from "../componentes/ui";
import { cambiarALuz, LUCES, type Luz, luzDe } from "../componentes/LucesEstado";
import { api } from "../datos/api";
import { db } from "../datos/db";
import { formatoOficial, type FormatoOficial } from "../datos/formatos";
import { escribir, mensajeDe, subirArchivo } from "../datos/escribir";
import { useOpcionesClientes, useOrganismos, useParametros } from "../datos/hooks";
import { fecha, hoyISO, pesos, TONO_SEMAFORO } from "../logica/formato";

/** El paso siguiente del flujo (el botón principal), como luz de la tabla. */
const SIGUIENTE: Partial<Record<EstadoTramite, { estado: EstadoTramite; luz: Luz; texto: string }>> = {
  en_preparacion: { estado: "en_tramite", luz: "transito", texto: "Pasar a En tránsito" },
  en_tramite: { estado: "entregado", luz: "finalizado", texto: "Finalizar" },
  requiere_correccion: { estado: "en_tramite", luz: "transito", texto: "Volver a En tránsito" },
  listo_para_entrega: { estado: "entregado", luz: "finalizado", texto: "Finalizar" },
};
const TONO_PAGO: Record<EstadoPago, Tono> = { pendiente: "rojo", abonado: "ambar", pagado: "verde" };
const ORIGEN_LABEL: Record<string, string> = { sistema: "automático", asistente: "asistente", whatsapp: "vía WhatsApp" };

/**
 * Trámites de licencia: lo que siempre va (la fotocopia de la cédula adjunta, la foto 3x4 fondo blanco si no la trae,
 * sin comparendos) y, en la primera vez, las horas y el tiempo. La fotocopia se marca sola al adjuntarla.
 */
function RecomendacionesLicencia({ t, nombreTipo }: { t: Tramite; nombreTipo: string }) {
  const conCedula = useLiveQuery(async () => (await db.documentos.where("tramiteId").equals(t.id).toArray()).some((d) => !!d.archivoClave && /c[eé]dula/i.test(d.tipoDocumento)), [t.id]);
  const precio = precioLicencia(nombreTipo, categoriasDeTexto(t.detalle), t.conClases);
  return (
    <div className="aviso info recomendaciones-licencia">
      <Info size={15} />
      <div>
        <b>Recomendaciones:</b>
        <ul>
          <li className={conCedula ? "hecha" : ""}>{conCedula ? <Check size={13} /> : null}Adjunte la fotocopia de la cédula: va en todos los trámites de licencia.</li>
          <li>Si la persona no trae foto 3x4 fondo blanco, tómesela en <Link to="/fotos">Fotos 3x4</Link>.</li>
          <li>Debe estar sin comparendos, y traer la cédula original.</li>
          {precio?.detalle && <li>{precio.detalle}</li>}
        </ul>
      </div>
    </div>
  );
}

export default function Expediente() {
  const { id } = useParams();
  const nav = useNavigate();
  const ui = useUI();
  const { avisar, confirmar } = ui;
  const t = useLiveQuery(() => (id ? db.tramites.get(id) : undefined), [id]);
  const tipo = useLiveQuery(() => (t ? db.tipos_tramite.get(t.tipoId) : undefined), [t?.tipoId]);
  const titular = useLiveQuery(() => (t ? db.clientes.get(t.titularId) : undefined), [t?.titularId]);
  const vehiculo = useLiveQuery(() => (t?.vehiculoId ? db.vehiculos.get(t.vehiculoId) : undefined), [t?.vehiculoId]);
  const organismo = useLiveQuery(() => (t?.organismoId ? db.organismos.get(t.organismoId) : undefined), [t?.organismoId]);
  const encargo = useLiveQuery(async () => {
    if (!t?.encargoId) return [];
    // Las partes del combo (todas, esta incluida), en orden, con su tipo y su vehículo (para sus precondiciones).
    const hermanos = await db.tramites.where("encargoId").equals(t.encargoId).toArray();
    const tipos = new Map((await db.tipos_tramite.toArray()).map((x) => [x.id, x]));
    const vehiculos = new Map((await db.vehiculos.bulkGet([...new Set(hermanos.map((h) => h.vehiculoId).filter((v): v is string => !!v))])).filter((v) => !!v).map((v) => [v!.id, v!]));
    return hermanos.sort((a, b) => a.numero - b.numero).map((h) => ({ h, tipo: tipos.get(h.tipoId)?.nombre ?? "", tp: tipos.get(h.tipoId), vehiculo: h.vehiculoId ? vehiculos.get(h.vehiculoId) : undefined }));
  }, [t]);
  const parametros = useParametros();
  const [moviendo, setMoviendo] = useState(false);
  const faltan = useFaltantes();
  const semaforos = useSemaforos();
  // La nota destacada (la estrella, grande) y las fijadas (la chinche, pequeñas al lado): arriba a la derecha.
  const arriba = useLiveQuery(async () => {
    const todas = id ? await db.bitacora.where("tramiteId").equals(id).filter((b) => !!b.destacada || !!b.fijada).toArray() : [];
    return { destacada: todas.find((b) => b.destacada), fijadas: todas.filter((b) => b.fijada && !b.destacada).sort((a, c) => a.fecha.localeCompare(c.fecha)) };
  }, [id]);
  // La ficha de una persona; si es una persona del trámite (no el titular), con su rol para cambiarlo en "Editar".
  const [fichaCliente, setFichaCliente] = useState<string | null>(null);
  const [personaFicha, setPersonaFicha] = useState<PersonaDelTramite | null>(null);
  const [fichaVehiculo, setFichaVehiculo] = useState<string | null>(null);
  const [editarVehiculo, setEditarVehiculo] = useState(false);
  const [recordatorio, setRecordatorio] = useState(false);

  // En un combo las precondiciones son una sola lista: las de todas sus partes juntas (una que se repite cuenta
  // cumplida solo si lo está en todas). Marcarla la marca en todas las partes que la tienen.
  const partesCombo = useMemo(() => ((encargo?.length ?? 0) > 1 ? encargo!.filter(({ h }) => h.id === t?.id || h.estado !== "cancelado") : null), [encargo, t?.id]);
  const precondiciones = useMemo(() => {
    if (!t || !tipo) return [];
    const hoy = hoyISO(), rnmc = parametros.rnmc_activo === "true";
    const partes = partesCombo ? partesCombo.map((x) => ({ h: x.h, tp: x.tp, vehiculo: x.vehiculo })) : [{ h: t, tp: tipo, vehiculo }];
    const porFlag = new Map<string, EstadoPrecondicion>();
    for (const p of partes) {
      if (!p.tp) continue;
      for (const e of evaluarPrecondiciones(p.tp, p.h.precondicionesEstado, p.vehiculo ?? null, hoy, rnmc)) {
        const antes = porFlag.get(e.flag);
        porFlag.set(e.flag, !antes ? e : { ...antes, ok: antes.ok && e.ok, forzada: antes.forzada || e.forzada, detalle: antes.ok && !e.ok ? e.detalle : antes.detalle, nota: antes.nota ?? e.nota });
      }
    }
    return PRECONDICIONES.filter((f) => porFlag.has(f)).map((f) => porFlag.get(f)!);
  }, [t, tipo, vehiculo, parametros.rnmc_activo, partesCombo]);
  // Los compradores (en un traspaso): las personas con ese rol o, si el cliente es el comprador (hay un vendedor), el titular.
  const compradores = useLiveQuery(async () => {
    if (!t) return [];
    const ps = await db.tramite_personas.where("tramiteId").anyOf(partesCombo ? partesCombo.map((x) => x.h.id) : [t.id]).toArray();
    let ids = ps.filter((p) => p.rol === "comprador").map((p) => p.clienteId);
    if (!ids.length && ps.some((p) => p.rol === "vendedor")) ids = [t.titularId];
    return (await db.clientes.bulkGet([...new Set(ids)])).filter((c): c is NonNullable<typeof c> => !!c);
  }, [t?.id, t?.titularId, partesCombo]);
  // La carta de compromiso (primera vez): pendiente hasta que se suba firmada o la oficina diga que todo bien.
  const cartasFaltan = useLiveQuery(async () => (t ? (await db.documentos.where("tramiteId").anyOf(partesCombo ? partesCombo.map((x) => x.h.id) : [t.id]).toArray()).filter(cartaFalta) : []), [t?.id, partesCombo]) ?? [];
  const compromisoPendiente = cartasFaltan.length > 0;
  // Lo importante para que no lo devuelvan: la carta de prenda en físico, otra ciudad, un comprador menor de edad, la
  // carta de compromiso de la licencia.
  const alertas = alertasTramite({
    tipos: (partesCombo ? partesCombo.map((x) => x.tp) : [tipo]).filter((x): x is NonNullable<typeof x> => !!x),
    ciudad: organismo?.ciudad, compradores: compradores ?? [], hoy: hoyISO(), conClases: t?.conClases ?? null, compromisoPendiente,
  });

  if (t === undefined && id) return <div className="contenido muted">Cargando…</div>;
  if (!t || !tipo) return <div className="contenido"><Vacio titulo="Este trámite no existe o fue borrado"><Link to="/tramites">Volver a trámites</Link></Vacio></div>;

  const estado = t.estado as EstadoTramite;
  const combo = (encargo?.length ?? 0) > 1;
  const siguiente = SIGUIENTE[estado];
  const falta = faltantes(precondiciones);

  /**
   * Cambia el estado igual que las luces de la tabla (las mismas 6 opciones): si le faltan precondiciones, pregunta si
   * se dan por cumplidas. `confirmado`: el botón ya dice el paso (no se vuelve a preguntar).
   */
  async function mover(luz: Luz, confirmado = false) {
    if (!t) return;
    setMoviendo(true);
    try { await cambiarALuz(t, luz, ui, { sinPreguntar: confirmado }); } finally { setMoviendo(false); }
  }
  const actual = luzDe(t);

  return (
    <>
      <Cabecera
        migas={[tipo.categoria === "licencia" ? { t: "Licencias", a: "/tramites?seccion=licencias" } : { t: "Trámites", a: "/tramites?seccion=tramites" }, { t: codigoTramite(t) }]}
        titulo={<span className="fila" style={{ gap: 10 }}>{combo ? encargo!.filter(({ h }) => h.estado !== "cancelado" || h.id === t.id).map((x) => x.tipo).join(" + ") : tipo.nombre}{combo && <Badge tono="cian">Combo</Badge>}{t.problema && <span className="chicharron-titulo" title={TEXTO_CHICHARRON}><Chicharron t={t} tam={16} />Chicharrón</span>}<Badge tono={TONO_SEMAFORO[ESTADO_TRAMITE_COLOR[estado]]} punto>{ESTADO_TRAMITE_LABEL[estado]}</Badge><Semaforo s={semaforos.get(t.id)} texto /></span>}
        sub={[titular?.nombre, vehiculo?.placa, organismo?.ciudad ?? organismo?.nombre, t.detalle && tipo.categoria === "licencia" ? `Categorías ${t.detalle}` : null].filter(Boolean).join(" · ")}
        lado={arriba && (arriba.destacada || arriba.fijadas.length) ? <NotasArriba destacada={arriba.destacada} fijadas={arriba.fijadas} /> : undefined}
      >
        {siguiente?.estado !== "entregado" && <BotonFinalizar t={t} />}
        {siguiente && !t.borrador && (
          <button className="btn btn-primario" disabled={moviendo} onClick={() => mover(siguiente.luz, true)} title={falta.length && siguiente.estado !== "cancelado" ? `Faltan: ${falta.map((f) => f.nombre).join(", ")}` : undefined}>
            {siguiente.texto}
          </button>
        )}
        <button className={`btn btn-icono chicharron-boton${t.problema ? " on" : ""}`} aria-pressed={!!t.problema} onClick={() => void marcarChicharron(t, { avisar })} title={t.problema ? "Quitar el chicharrón (ya se resolvió)" : "Marcar como chicharrón: tiene un problema raro"} aria-label={t.problema ? "Quitar el chicharrón" : "Marcar como chicharrón"}><Skull size={15} /></button>
        {ciudadDeEnvio(organismo) && !ESTADOS_TERMINALES.includes(t.estado as EstadoTramite) && (
          <button className="btn" onClick={() => nav(rutaEnvio(t.id))} title={`Envíos con este trámite, la ciudad y el tramitador de ${organismo?.ciudad} ya puestos`}><Send size={15} />Enviar a {ciudadDeEnvio(organismo)}</button>
        )}
        <button className="btn" onClick={() => setRecordatorio(true)} title="Crear un recordatorio de este trámite"><CalendarPlus size={15} />Recordatorio</button>
        <Menu derecha boton={(abrir) => <button className="btn" onClick={abrir}>Cambiar estado<ChevronDown size={14} /></button>}>
          {(cerrar) => (
            <>
              {LUCES.map((l) => (
                <button key={l.luz} className="menu-item" disabled={l.luz === actual || moviendo} onClick={() => { cerrar(); void mover(l.luz); }}>
                  <i className={`luz-punto ${l.tono}`} />{l.texto}{l.luz === actual && <small className="tenue" style={{ marginLeft: "auto" }}>actual</small>}
                </button>
              ))}
              <hr />
              <button className="menu-item" style={{ color: "var(--rojo)" }} onClick={async () => {
                cerrar();
                if (!(await confirmar({ titulo: "Borrar trámite", texto: "Se borran también sus documentos, pagos y bitácora. Si solo no se va a hacer, mejor márquelo como cancelado.", boton: "Borrar", peligro: true }))) return;
                try { await escribir("DELETE", `/api/tramites/${t.id}`); avisar("Trámite borrado"); nav("/tramites"); } catch (err) { avisar(mensajeDe(err), "error"); }
              }}><Trash2 size={15} />Borrar trámite</button>
            </>
          )}
        </Menu>
      </Cabecera>

      <div className="contenido">
        {t.borrador && <BorradorAviso t={t} pideVehiculo={tipo.requiereVehiculo} />}
        {faltan.get(t.id) && <div className="aviso" style={{ alignItems: "center", gap: 8 }}><InfoIncompleta falta={faltan.get(t.id)} detalle /><span className="peq muted">Se quita sola cuando se completa.</span></div>}
        {!ESTADOS_TERMINALES.includes(estado) && alertas.filter((a) => a.clave === "compromiso_clases").map((a) => (
          // La carta de compromiso: bien a la vista (rojo, con el símbolo de peligro grande).
          <div key={a.clave} className="aviso importante peligro" role="alert"><AlertTriangle size={26} /><span><b>Atención:</b> {a.texto}</span>
            <button className="btn btn-sm aviso-todo-bien" title="Si ya la firmó, o si ya terminó las clases y solo viene por la otra mitad del trámite. Queda anotado en la bitácora y se deshace en Archivos." onClick={async () => {
              try {
                await Promise.all(cartasFaltan.map((d) => escribir("PATCH", `/api/documentos/${d.id}`, { estado: "validado" })));
                ui.avisar("Listo: ya no se alerta. Si hace falta, se vuelve a pedir en Archivos.");
              } catch (e) { ui.avisar(mensajeDe(e), "error"); }
            }}><Check size={14} />Todo bien, quitar la alerta</button>
          </div>
        ))}
        {!ESTADOS_TERMINALES.includes(estado) && <AvisosTramite tramiteId={t.id} avisos={alertas.filter((a) => a.clave !== "compromiso_clases").map((a) => a.texto)} />}
        {tipo.descripcion && <div className="aviso info" style={{ whiteSpace: "pre-wrap" }}><Info size={15} /><span><b>Notas de la oficina:</b> {tipo.descripcion}</span></div>}
        {tipo.categoria === "licencia" && !ESTADOS_TERMINALES.includes(estado) && <RecomendacionesLicencia t={t} nombreTipo={tipo.nombre} />}
        <FormatosDelTramite categoria={tipo.categoria} nombre={tipo.nombre} tramiteId={t.id} />
        {combo && (
          <div className="partes-combo" role="tablist" aria-label="Partes del combo">
            <span className="peq muted">Combo {codigoTramite(t)}: un solo código y una sola lista de precondiciones (las de todas las partes); cada parte con sus documentos y cobros. El estado se mueve junto.</span>
            <div className="seg">
              {encargo!.map(({ h, tipo: n }) => (
                <Link key={h.id} role="tab" aria-selected={h.id === t.id} className={h.id === t.id ? "on" : ""} to={`/tramites/${h.id}`}>
                  {n}{h.estado === "cancelado" ? " (cancelado)" : ""}
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="expediente">
          {/* A la izquierda, primero lo que más se usa (archivos y cobro); debajo, las precondiciones y la revisión previa. */}
          <div className="col">
            <Documentos tramiteId={t.id} />
            <Cobros t={t} />
            <Precondiciones tramiteId={t.id} combo={combo} lista={precondiciones} faltan={falta.length} alEditarVehiculo={vehiculo ? () => setEditarVehiculo(true) : undefined} />
            {((t.vehiculoId && tipo.categoria === "vehiculo") || tipo.categoria === "licencia") && <RevisionPrevia tramiteId={t.id} tipo={tipo.categoria === "licencia" ? "licencia" : /traspaso/i.test(tipo.nombre) ? "traspaso" : "vehiculo"} />}
          </div>
          <div className="col">
            <Datos t={t} esLicencia={tipo.categoria === "licencia"} expedicion={tipo.categoria === "licencia" && /expedici/.test(normalizar(tipo.nombre))} />
            <Personas t={t} titular={titular?.nombre} placa={vehiculo?.placa} abrirCliente={(id, persona) => { setFichaCliente(id); setPersonaFicha(persona ?? null); }} abrirVehiculo={setFichaVehiculo} />
            <Bitacora tramiteId={t.id} />
          </div>
        </div>
      </div>
      <FichaCliente clienteId={fichaCliente} persona={personaFicha} onCerrar={() => { setFichaCliente(null); setPersonaFicha(null); }} />
      <FichaVehiculo vehiculoId={fichaVehiculo} onCerrar={() => setFichaVehiculo(null)} />
      <PanelVehiculo abierto={editarVehiculo} onCerrar={() => setEditarVehiculo(false)} vehiculoId={t.vehiculoId} />
      <PanelRecordatorio abierto={recordatorio} onCerrar={() => setRecordatorio(false)} clienteInicial={t.titularId} tramiteInicial={t.id} />
    </>
  );
}

/* ───────────────────────── Borrador ───────────────────────── */

function BorradorAviso({ t, pideVehiculo }: { t: Tramite; pideVehiculo: boolean }) {
  const { avisar } = useUI();
  return (
    <div className="aviso" style={{ background: "var(--morado-s)", color: "var(--morado)", alignItems: "center" }}>
      <span style={{ flex: 1 }}>Es un borrador: no avanza hasta confirmarlo.{pideVehiculo && !t.vehiculoId ? " Antes, agréguele el vehículo en Personas y vehículo." : ""}</span>
      <button className="btn btn-sm" onClick={async () => { try { await escribir("PATCH", `/api/tramites/${t.id}`, { borrador: false }); avisar("Trámite confirmado"); } catch (e) { avisar(mensajeDe(e), "error"); } }}>Confirmar trámite</button>
    </div>
  );
}

/* ───────────────────────── Avisos ───────────────────────── */

/**
 * Los avisos para que no devuelvan el trámite (la carta de prenda en físico, otra ciudad, un comprador menor...), juntos
 * en un solo recuadro de otro tono (el amarillo queda para las notas). Con «Entendido» se encoge a una línea en ese
 * trámite (se recuerda en este equipo); si aparece un aviso nuevo, vuelve a salir entero.
 */
function AvisosTramite({ tramiteId, avisos }: { tramiteId: string; avisos: string[] }) {
  const clave = `avisos-vistos:${tramiteId}`;
  const firma = avisos.join("|");
  const [vistos, setVistos] = useState(() => { try { return localStorage.getItem(clave); } catch { return null; } });
  const [abierto, setAbierto] = useState(false);
  if (!avisos.length) return null;
  const encogido = vistos === firma && !abierto;
  const entendido = () => { try { localStorage.setItem(clave, firma); } catch { /* sin almacenamiento: solo esta vez */ } setVistos(firma); setAbierto(false); };
  if (encogido) return (
    <button type="button" className="avisos-tramite encogido" onClick={() => setAbierto(true)} aria-expanded={false}>
      <AlertTriangle size={14} /><b>Importante:</b> {avisos.length === 1 ? "1 aviso" : `${avisos.length} avisos`} para que no lo devuelvan<span className="tenue">· Ver</span>
    </button>
  );
  return (
    <div className="avisos-tramite" role="note" aria-label="Avisos importantes">
      <AlertTriangle size={16} />
      <div className="avisos-tramite-cuerpo">
        <b>Importante</b>
        <ul>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>
      <button type="button" className="btn btn-sm" onClick={entendido} title="Lo encoge a una línea en este trámite (vuelve a salir si aparece otro aviso)"><Check size={13} />Entendido</button>
    </div>
  );
}

/* ───────────────────────── Precondiciones ───────────────────────── */

/**
 * Las precondiciones: si faltan, solo las que faltan a la vista (las cumplidas, plegadas debajo); si están todas, una
 * sola línea "10 de 10 cumplidas" que se abre con un clic.
 */
function Precondiciones({ tramiteId, combo, lista, faltan, alEditarVehiculo }: { tramiteId: string; combo: boolean; lista: EstadoPrecondicion[]; faltan: number; alEditarVehiculo?: () => void }) {
  const { avisar } = useUI();
  const [verCumplidas, setVerCumplidas] = useState(false);
  const pendientes = lista.filter((p) => !p.ok), cumplidas = lista.filter((p) => p.ok);
  const fila = (p: EstadoPrecondicion) => <Precondicion key={p.flag} tramiteId={tramiteId} p={p} alEditarVehiculo={alEditarVehiculo} />;
  return (
    <div className="card">
      <div className="card-cab">
        <b>{combo ? "Precondiciones del combo" : "Precondiciones"}</b>
        <span className="peq tenue">{lista.length ? (faltan ? `Faltan ${faltan} de ${lista.length}` : `${lista.length} de ${lista.length} cumplidas`) : "Este trámite no tiene"}</span>
        {faltan > 0 && (
          <button className="btn btn-sm accion" onClick={async () => { try { await escribir("POST", `/api/tramites/${tramiteId}/precondiciones`, { todas: true }); avisar("Precondiciones marcadas"); } catch (e) { avisar(mensajeDe(e), "error"); } }}>Marcar todas</button>
        )}
        {cumplidas.length > 0 && (
          <button type="button" className="btn btn-sm btn-fantasma precond-plegar" aria-expanded={verCumplidas} onClick={() => setVerCumplidas((v) => !v)}>
            {verCumplidas ? "Ocultar" : faltan ? `Ver las ${cumplidas.length} cumplidas` : "Ver"}<ChevronDown size={13} style={{ transform: verCumplidas ? "rotate(180deg)" : undefined }} />
          </button>
        )}
      </div>
      {(pendientes.length > 0 || verCumplidas) && (
        <div className="card-cuerpo lista-filas" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {pendientes.map(fila)}
          {verCumplidas && cumplidas.map(fila)}
        </div>
      )}
    </div>
  );
}

function Precondicion({ tramiteId, p, alEditarVehiculo }: { tramiteId: string; p: ReturnType<typeof evaluarPrecondiciones>[number]; alEditarVehiculo?: () => void }) {
  const { avisar } = useUI();
  const [nota, setNota] = useState<string | null>(null);
  const marcar = async (cuerpo: Record<string, unknown>) => {
    try { await escribir("POST", `/api/tramites/${tramiteId}/precondiciones`, { flag: p.flag, ...cuerpo }); } catch (e) { avisar(mensajeDe(e), "error"); }
  };
  const manualOk = p.fuente === "manual" ? p.ok : p.forzada;
  return (
    <div className="item" style={{ alignItems: "flex-start" }}>
      <span style={{ marginTop: 2, color: p.ok ? "var(--verde)" : "var(--texto-3)" }}>{p.ok ? <CheckCircle2 size={18} /> : <Circle size={18} />}</span>
      <div className="principal">
        <b>{p.nombre}</b>
        <small>{p.detalle}{p.nota ? ` · ${p.nota}` : ""}</small>
        {nota !== null && (
          <div className="fila" style={{ marginTop: 6 }}>
            <input className="input" autoFocus value={nota} placeholder="Nota (por ejemplo, dónde se verificó)" onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { marcar({ nota }); setNota(null); } }} />
            <button className="btn btn-sm" onClick={() => { marcar({ nota }); setNota(null); }}>Guardar</button>
            <button className="btn btn-sm btn-fantasma btn-icono" onClick={() => setNota(null)}><X size={14} /></button>
          </div>
        )}
      </div>
      <div className="fila" style={{ gap: 4 }}>
        {p.fuente === "vehiculo" && alEditarVehiculo && !p.ok && <button className="btn btn-sm" onClick={alEditarVehiculo}>Editar vehículo</button>}
        <button className="btn btn-sm btn-fantasma btn-icono" title="Nota" onClick={() => setNota(p.nota ?? "")}><Pencil size={13} /></button>
        {(p.fuente === "manual" || !p.ok || p.forzada) && (
          <label className="fila peq muted" style={{ gap: 5 }} title={p.fuente === "vehiculo" ? "Marcar como cumplida aunque el dato del vehículo no lo diga (por ejemplo, vehículo nuevo exento)" : undefined}>
            <input type="checkbox" checked={manualOk} onChange={(e) => marcar({ ok: e.target.checked })} />
            {p.fuente === "vehiculo" ? "A mano" : "Cumplida"}
          </label>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Documentos ───────────────────────── */

/**
 * Los archivos del trámite: fotos, escaneos y PDF. Ya no se arma una lista de requisitos vacía al crear el trámite
 * (nadie la llenaba: de 441, uno tenía archivo); aquí solo está lo que de verdad se adjuntó.
 * Con el escáner: "Editar en el escáner" (recortar, enderezar, girar, filtro) reemplaza el archivo de ese documento;
 * marcando varios, "Juntar en PDF" los deja escaneados en un solo PDF para imprimir, descargar, compartir (WhatsApp,
 * correo...) o guardar en el trámite. Las fotos se acomodan solas; los escaneos (PDF con fotos) entran tal cual; los
 * PDF sin fotos van al final tal cual.
 */
type AbiertoEnEscaner = { titulo: string; nombre: string; modo: Modo; escala?: number; ordenadas: Entrada[]; extras: { nombre: string; bytes: ArrayBuffer; doc: string | null }[]; destino: DestinoEscaneo };
/** Un consolidado (varios documentos juntos desde el escáner): tiene receta; los de antes, por su nombre ("Documentos ..."). */
const esConsolidado = (d: Documento) => !!d.composicion || (d.archivoTipo === "application/pdf" && /^documentos\b/i.test(d.tipoDocumento));
/** "Cédula", "licencia", "tarjeta de propiedad": se escanean como tarjeta (las caras de a dos en la hoja). */
const esTarjeta = (d: Documento) => /c[eé]dula|licencia|tarjeta|pase\b/i.test(d.tipoDocumento);
function Documentos({ tramiteId }: { tramiteId: string }) {
  const nav = useNavigate();
  const { avisar, confirmar } = useUI();
  const docs = useLiveQuery(() => db.documentos.where("tramiteId").equals(tramiteId).toArray().then((d) => d.sort((a, b) => a.creado.localeCompare(b.creado))), [tramiteId]) ?? [];
  const [subiendo, setSubiendo] = useState(false);
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  /** Si se reemplaza el archivo de uno que ya está; si no, cada archivo entra como uno nuevo, con su nombre. */
  const destino = useRef<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [escaner, setEscaner] = useState<AbiertoEnEscaner | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const tramite = useLiveQuery(() => db.tramites.get(tramiteId), [tramiteId]);
  const placa = useLiveQuery(async () => (tramite?.vehiculoId ? (await db.vehiculos.get(tramite.vehiculoId))?.placa ?? "" : ""), [tramite?.vehiculoId]) ?? "";
  const conArchivo = docs.filter((d) => d.archivoClave);
  /** La vista previa abierta: cuál de los que tienen archivo se está viendo. */
  const [viendo, setViendo] = useState<number | null>(null);
  /** El documento al que se le está cambiando el nombre (en su fila). */
  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null);
  async function renombrar(d: Documento, nombre: string) {
    setRenombrando(null);
    const n = nombre.trim();
    if (!n || n === d.tipoDocumento) return;
    try { await escribir("PATCH", `/api/documentos/${d.id}`, { nombre: n }); avisar("Nombre cambiado.", "ok"); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function quitar(d: Documento) {
    if (!(await confirmar({ titulo: "Quitar archivo", texto: `Se quita «${d.tipoDocumento}» del trámite${d.archivoClave ? " con su archivo" : ""}, y lo que dejó en la bitácora.`, boton: "Quitar", peligro: true }))) return;
    try { await escribir("DELETE", `/api/documentos/${d.id}`); avisar(`«${d.tipoDocumento}» quitado del trámite`, "ok"); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  /** Lo que se puede hacer con un archivo: el clic derecho en su fila y la flechita muestran lo mismo. */
  const opcionesDe = (d: Documento): ItemMenu[] => {
    const ruta = `/api/documentos/${d.id}/archivo`;
    const imagen = !!d.archivoClave && /^image\//.test(d.archivoTipo ?? "");
    const cartaPendiente = d.tipoDocumento === DOC_COMPROMISO && !d.archivoClave;
    const estadoCarta = (estado: "validado" | "pendiente") => void escribir("PATCH", `/api/documentos/${d.id}`, { estado }).catch((e) => avisar(mensajeDe(e), "error"));
    return [
      ...(d.archivoClave ? [
        { texto: "Vista previa", icono: Eye, accion: () => setViendo(conArchivo.findIndex((x) => x.id === d.id)) },
        { texto: "Abrir en otra pestaña", icono: ExternalLink, accion: () => window.open(ruta, "_blank", "noopener") },
        imagen
          ? { texto: "Copiar imagen", icono: Copy, accion: () => void copiarArchivo(ruta).then((r) => avisar(r === "copiada" ? "Imagen copiada: péguela donde la necesite." : "Este navegador no deja copiar imágenes: descárguela.", r === "copiada" ? "ok" : "error")) }
          : { texto: "Copiar (solo fotos)", icono: Copy, deshabilitado: true },
        { texto: "Descargar", icono: Download, accion: () => { const a = document.createElement("a"); a.href = `${ruta}?descargar`; a.click(); } },
      ] satisfies ItemMenu[] : []),
      { texto: "Cambiar nombre", icono: Pencil, deshabilitado: cartaPendiente, accion: () => setRenombrando({ id: d.id, nombre: d.tipoDocumento }) },
      { texto: "Copiar el nombre", icono: Clipboard, accion: () => void copiarTexto(d.tipoDocumento).then(() => avisar("Nombre copiado.", "ok")) },
      "-",
      ...(d.archivoClave ? [
        { texto: "Editar en el escáner", icono: SlidersHorizontal, accion: () => void abrirEnEscaner([d], "editar") },
        { texto: "Aumentar resolución con IA", icono: Sparkles, accion: () => nav(`/escaneos?aumentar=${d.id}`) },
        { texto: marcados.has(d.id) ? "Desmarcar" : "Marcar para juntar", icono: Combine, accion: () => marcar(d.id, !marcados.has(d.id)) },
      ] satisfies ItemMenu[] : []),
      { texto: d.archivoClave ? "Reemplazar archivo" : "Subir archivo", icono: FileUp, accion: () => { destino.current = d.id; entrada.current?.click(); } },
      ...(cartaPendiente ? [cartaFalta(d)
        ? { texto: "Todo bien, quitar la alerta", icono: Check, accion: () => estadoCarta("validado") }
        : { texto: "Volver a pedirla", icono: RotateCcw, accion: () => estadoCarta("pendiente") }] satisfies ItemMenu[] : []),
      "-",
      { texto: "Quitar", icono: Trash2, peligro: true, accion: () => void quitar(d) },
    ];
  };

  /** Abre los documentos en el escáner: sus archivos, como fotos (las de un PDF escaneado, tal cual). */
  /** El archivo de un documento (con la sesión vencida, lo dice). */
  async function bajar(d: Documento): Promise<Blob> {
    const r = await fetch(`/api/documentos/${d.id}/archivo`, { credentials: "same-origin", redirect: "manual" });
    if (r.type === "opaqueredirect" || r.status === 401) throw new Error("La sesión venció: recargue la página.");
    if (!r.ok) throw new Error(`No se pudo abrir «${d.tipoDocumento}» (${r.status}).`);
    return r.blob();
  }
  const fuenteDe = (d: Documento, pagina: number | null): FuenteParte => ({ doc: d.id, clave: d.archivoClave ?? "", nombre: d.tipoDocumento, pagina });
  /** Un documento: las páginas de un PDF escaneado, tal cual; una foto, para acomodarla; un PDF sin fotos, al final. */
  async function entradasDe(d: Documento, ordenadas: Entrada[], extras: AbiertoEnEscaner["extras"]): Promise<Modo | null> {
    const blob = await bajar(d);
    const tipo = blob.type || d.archivoTipo || "";
    if (/pdf/.test(tipo)) {
      const bytes = await blob.arrayBuffer();
      try { const x = await imagenesDelPdf(bytes.slice(0)); ordenadas.push(...x.fotos.map((foto, k) => ({ foto, tal: true, fuente: fuenteDe(d, k) }))); return x.modo; }
      catch { extras.push({ nombre: d.tipoDocumento, bytes, doc: d.id }); return null; }
    }
    if (/^image\//.test(tipo)) { ordenadas.push({ foto: new File([blob], d.archivoNombre ?? `${d.tipoDocumento}.jpg`, { type: tipo }), tal: false, fuente: fuenteDe(d, null) }); return null; }
    extras.push({ nombre: d.tipoDocumento, bytes: await blob.arrayBuffer(), doc: d.id });
    return null;
  }
  /**
   * Un consolidado: cada página desde su documento original, con el ajuste que tenía (se reencuadra de verdad); si el
   * original ya no está o le cambiaron el archivo, la página sale tal cual del consolidado. Los PDF sin fotos que llevaba
   * al final, igual al final.
   */
  async function entradasDeConsolidado(d: Documento, ordenadas: Entrada[], extras: AbiertoEnEscaner["extras"]) {
    const bytes = await (await bajar(d)).arrayBuffer();
    let paginas: File[] = [], modoPdf: Modo = "hoja";
    try { const x = await imagenesDelPdf(bytes.slice(0)); paginas = x.fotos; modoPdf = x.modo; } catch { /* solo trae PDF sin fotos */ }
    const c = d.composicion ?? null;
    const fuentes = new Map<string, Promise<{ blob: Blob; fotos: File[] | null }>>();
    const fuente = (x: Documento) => {
      if (!fuentes.has(x.id)) fuentes.set(x.id, bajar(x).then(async (blob) => ({ blob, fotos: /pdf/.test(blob.type || x.archivoTipo || "") ? (await imagenesDelPdf(await blob.arrayBuffer()).catch(() => null))?.fotos ?? null : null })));
      return fuentes.get(x.id)!;
    };
    if (c && c.partes.length === paginas.length) {
      for (const [i, p] of c.partes.entries()) {
        const original = p.doc ? docs.find((x) => x.id === p.doc && x.archivoClave === p.clave) : undefined;
        if (original) {
          const f = await fuente(original).catch(() => null);
          const foto = !f ? null : p.pagina === null ? new File([f.blob], original.archivoNombre ?? `${original.tipoDocumento}.jpg`, { type: f.blob.type || "image/jpeg" }) : f.fotos?.[p.pagina] ?? null;
          if (foto) { ordenadas.push({ foto, tal: false, fuente: fuenteDe(original, p.pagina), ajuste: { esquinas: p.esquinas, filtro: p.filtro, giros: p.giros, ancho: p.ancho, alto: p.alto } }); continue; }
        }
        ordenadas.push({ foto: paginas[i], tal: true });
      }
    } else ordenadas.push(...paginas.map((foto) => ({ foto, tal: true })));
    // Las hojas del final que no son fotos (los PDF que iban tal cual): siguen al final.
    const modo = c?.modo ?? modoPdf;
    const conFotos = modo === "tarjeta" ? Math.ceil(paginas.length / 2) : paginas.length;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (pdf.getPageCount() > conFotos) {
      const resto = await PDFDocument.create();
      for (const pg of await resto.copyPages(pdf, pdf.getPageIndices().slice(conFotos))) resto.addPage(pg);
      extras.push({ nombre: c?.extras.map((e) => e.nombre).join(", ") || "Hojas sin fotos del consolidado", bytes: (await resto.save()).slice().buffer as ArrayBuffer, doc: null });
    }
    return { modo, escala: c?.escala };
  }
  /** Guarda el consolidado: el PDF y su receta (para volver a editarlo desde los originales). */
  async function guardarConsolidado(id: string, pdf: File, composicion: Composicion) {
    await subirArchivo(`/api/documentos/${id}/archivo`, pdf);
    await escribir("PATCH", `/api/documentos/${id}`, { composicion });
  }

  /**
   * Abre documentos en el escáner. "editar": uno (un consolidado se abre desde sus originales); "juntar": varios en un
   * consolidado nuevo; "agregar": el consolidado marcado más los otros marcados, y se guarda encima de él.
   */
  async function abrirEnEscaner(elegidos: Documento[], como: "editar" | "juntar" | "agregar") {
    setAbriendo(true);
    try {
      const ordenadas: Entrada[] = [], extras: AbiertoEnEscaner["extras"] = [];
      let modoPdf: Modo | null = null, escala: number | undefined;
      const cons = como === "juntar" ? undefined : elegidos.find(esConsolidado);
      // El consolidado primero (con sus páginas en su orden) y después lo que se le agrega.
      const lista = cons ? [cons, ...elegidos.filter((d) => d !== cons)] : elegidos;
      for (const d of lista) {
        if (esConsolidado(d)) { const r = await entradasDeConsolidado(d, ordenadas, extras); modoPdf = modoPdf === "hoja" ? "hoja" : r.modo; escala ??= r.escala; }
        else { const m = await entradasDe(d, ordenadas, extras); if (m) modoPdf = modoPdf === "hoja" ? "hoja" : m; }
      }
      if (como === "editar" && !cons && extras.length) throw new Error("Este PDF no trae fotos para ajustar: no se puede editar en el escáner (sí se puede juntar con otros).");
      const modo: Modo = modoPdf ?? (lista.every(esTarjeta) ? "tarjeta" : "hoja");
      const ref = placa || (tramite ? codigoTramite(tramite) : "");
      const d0 = lista[0];
      const base = { modo, escala, ordenadas, extras };
      if (cons) {
        setEscaner({ ...base, titulo: como === "agregar" ? `Agregar ${lista.length - 1} al consolidado «${cons.tipoDocumento}»` : `Editar el consolidado «${cons.tipoDocumento}»`, nombre: cons.tipoDocumento,
          destino: { boton: "Guardar cambios", guardar: async (pdf, comp) => { await guardarConsolidado(cons.id, pdf, comp); avisar(`El consolidado «${cons.tipoDocumento}» quedó actualizado`); setEscaner(null); setMarcados(new Set()); } } });
      } else if (como === "editar") {
        setEscaner({ ...base, titulo: `Editar «${d0.tipoDocumento}»`, nombre: d0.tipoDocumento,
          destino: { boton: "Guardar cambios", guardar: async (pdf) => { await subirArchivo(`/api/documentos/${d0.id}/archivo`, pdf); avisar(`«${d0.tipoDocumento}» quedó escaneado`); setEscaner(null); setMarcados(new Set()); } } });
      } else {
        setEscaner({ ...base, titulo: `Juntar ${lista.length} documentos`, nombre: `Documentos ${ref}`.trim(),
          destino: { boton: "Guardar en el trámite", guardar: async (pdf, comp) => {
            const { id } = await escribir<{ id: string }>("POST", `/api/tramites/${tramiteId}/documentos`, { tipoDocumento: pdf.name.replace(/\.pdf$/i, "").slice(0, 200) || "Documentos" });
            await guardarConsolidado(id, pdf, comp);
            avisar("El consolidado quedó en los archivos del trámite"); setEscaner(null); setMarcados(new Set());
          } } });
      }
    } catch (e) { avisar(mensajeDe(e), "error"); } finally { setAbriendo(false); }
  }
  const marcar = (id: string, si: boolean) => setMarcados((m) => { const n = new Set(m); if (si) n.add(id); else n.delete(id); return n; });
  const elegidos = conArchivo.filter((d) => marcados.has(d.id));

  async function adjuntar(archivos: File[]) {
    if (!archivos.length) return;
    setSubiendo(true);
    try {
      for (const a of archivos) {
        const id = destino.current ?? (await escribir<{ id: string }>("POST", `/api/tramites/${tramiteId}/documentos`, { tipoDocumento: a.name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Archivo" })).id;
        await subirArchivo(`/api/documentos/${id}/archivo`, a);
      }
      avisar(archivos.length > 1 ? `${archivos.length} archivos adjuntos` : "Archivo adjunto");
    } catch (e) { avisar(mensajeDe(e), "error"); } finally { setSubiendo(false); destino.current = null; }
  }

  // Ctrl+V: la imagen copiada (de WhatsApp...) se adjunta sin descargarla.
  const zonaArchivos = useRef<HTMLDivElement>(null);
  usePegarImagenes(zonaArchivos, (f) => { destino.current = null; adjuntar(f); });

  return (
    <div ref={zonaArchivos} className={`card${encima ? " soltar" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); destino.current = null; adjuntar([...e.dataTransfer.files]); }}>
      <div className="card-cab">
        <b>Archivos</b>
        <span className="peq tenue">{subiendo ? "Subiendo…" : docs.length ? `${docs.length}` : ""}</span>
        {elegidos.length === 1 && <button className="btn btn-sm btn-primario" disabled={abriendo} title={esConsolidado(elegidos[0]) ? "Abrirlo en el escáner desde sus originales: reencuadrar, girar, filtro, quitar o agregar páginas" : "Abrirlo en el escáner: recortar, enderezar, girar, filtro"} onClick={() => abrirEnEscaner(elegidos, "editar")}>{abriendo ? <Loader2 size={14} className="girando" /> : <SlidersHorizontal size={14} />}Editar en el escáner</button>}
        {elegidos.length > 1 && elegidos.filter(esConsolidado).length === 1 && <button className="btn btn-sm btn-primario" disabled={abriendo} title="Abrir el consolidado con los otros marcados agregados al final, y guardarlo encima" onClick={() => abrirEnEscaner(elegidos, "agregar")}>{abriendo ? <Loader2 size={14} className="girando" /> : <Layers size={14} />}Agregar al consolidado</button>}
        {elegidos.length > 1 && <button className={`btn btn-sm${elegidos.filter(esConsolidado).length === 1 ? "" : " btn-primario"}`} disabled={abriendo} title="Dejarlos escaneados en un solo PDF (un consolidado nuevo) para imprimir, descargar, compartir o guardar en el trámite" onClick={() => abrirEnEscaner(elegidos, "juntar")}>{abriendo && elegidos.filter(esConsolidado).length !== 1 ? <Loader2 size={14} className="girando" /> : <Combine size={14} />}Juntar en PDF ({elegidos.length})</button>}
        <button className="btn btn-sm accion" disabled={subiendo} onClick={() => { destino.current = null; entrada.current?.click(); }}><FileUp size={14} />Adjuntar</button>
        <BotonPegar disabled={subiendo} texto="Pegar" recibir={(f) => { destino.current = null; adjuntar(f); }} alError={(m) => avisar(m, "error")} />
      </div>
      {viendo !== null && conArchivo.length > 0 && <VisorArchivos archivos={conArchivo.map((x) => ({ id: x.id, titulo: x.tipoDocumento, nombre: x.archivoNombre ?? null, tipo: x.archivoTipo ?? null }))} inicial={viendo} cerrar={() => setViendo(null)} />}
      <input ref={entrada} type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }} aria-label="Archivos del trámite" onChange={(e) => { adjuntar([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <div className="card-cuerpo lista-filas" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {docs.map((d: Documento) => (
          <div key={d.id} className={`item${cartaFalta(d) ? " doc-falta" : ""}`} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("input")) abrirMenu(e, opcionesDe(d)); }}>
            {conArchivo.length > 0 && (d.archivoClave
              ? <input type="checkbox" className="doc-marcar" checked={marcados.has(d.id)} onChange={(e) => marcar(d.id, e.target.checked)} aria-label={`Marcar ${d.tipoDocumento} para juntar`} title="Marcar para editarlo en el escáner o juntarlo con otros en un PDF" />
              : <span className="doc-marcar" />)}
            <div className="principal">
              {renombrando?.id === d.id
                ? <input className="input doc-renombrar" autoFocus aria-label={`Nombre nuevo de ${d.tipoDocumento}`} value={renombrando.nombre} maxLength={120}
                    onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRenombrando({ id: d.id, nombre: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") void renombrar(d, renombrando.nombre); if (e.key === "Escape") setRenombrando(null); }}
                    onBlur={() => void renombrar(d, renombrando.nombre)} />
                : <b className="fila" style={{ gap: 6, display: "flex", flexWrap: "wrap", alignItems: "center" }} onDoubleClick={() => { if (!(d.tipoDocumento === DOC_COMPROMISO && !d.archivoClave)) setRenombrando({ id: d.id, nombre: d.tipoDocumento }); }}>{d.tipoDocumento}{esConsolidado(d) && <span className="doc-consolidado" title="Varios documentos juntos en un PDF, desde el escáner: márquelo para editarlo o agregarle documentos"><Layers size={12} />Consolidado{d.composicion ? ` · ${d.composicion.partes.length} página${d.composicion.partes.length === 1 ? "" : "s"}${d.composicion.extras.length ? ` + ${d.composicion.extras.length} PDF` : ""}` : ""}</span>}</b>}
              {d.composicion && <small className="tenue">Junta: {resumenComposicion(d.composicion)}</small>}
              <small>{d.archivoNombre ? <a href={`/api/documentos/${d.id}/archivo`} target="_blank" rel="noreferrer" className="fila" style={{ gap: 4, display: "inline-flex" }}><Paperclip size={12} />{d.archivoNombre}<ExternalLink size={11} /></a> : cartaFalta(d) ? "Falta: imprímala, que la firme y súbala aquí (foto o PDF)" : d.tipoDocumento === DOC_COMPROMISO ? "Marcada como todo bien, sin archivo: no se alerta" : "Sin archivo"}</small>
            </div>
            {d.tipoDocumento === DOC_COMPROMISO && !d.archivoClave && !cartaFalta(d) && (
              <button className="btn btn-sm" title="Vuelve a salir la alerta" onClick={() => void escribir("PATCH", `/api/documentos/${d.id}`, { estado: "pendiente" }).catch((e) => avisar(mensajeDe(e), "error"))}><RotateCcw size={13} />Volver a pedirla</button>
            )}
            {cartaFalta(d) && (
              <span className="fila" style={{ gap: 6, flexShrink: 0 }}>
                <a className="btn btn-sm" href={RUTA_CARTA} target="_blank" rel="noreferrer"><FileText size={13} />Imprimir la carta</a>
                <button className="btn btn-sm btn-primario" disabled={subiendo} onClick={() => { destino.current = d.id; entrada.current?.click(); }}><FileUp size={13} />Subir la carta firmada</button>
              </span>
            )}
            {d.archivoClave && <button className="btn btn-sm btn-fantasma btn-icono" title="Vista previa" aria-label={`Vista previa de ${d.tipoDocumento}`} onClick={() => setViendo(conArchivo.findIndex((x) => x.id === d.id))}><Eye size={15} /></button>}
            <button className="btn btn-sm btn-fantasma btn-icono doc-quitar" title="Quitar del trámite" aria-label={`Quitar ${d.tipoDocumento}`} onClick={() => void quitar(d)}><Trash2 size={14} /></button>
            <button className="btn btn-sm btn-fantasma btn-icono" title="Más (también con clic derecho)" aria-label={`Opciones de ${d.tipoDocumento}`}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); abrirMenu({ clientX: r.right - 200, clientY: r.bottom + 4, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() }, opcionesDe(d)); }}><ChevronDown size={14} /></button>
          </div>
        ))}
        {!docs.length && <div className="peq tenue" style={{ padding: "8px 0" }}>Sin archivos. Arrástrelos aquí (fotos o PDF) o use Adjuntar; lo escaneado se adjunta desde el Escáner.</div>}
        {conArchivo.length > 0 && !elegidos.length && <div className="peq tenue" style={{ padding: "6px 0 2px" }}>Marque uno para editarlo en el escáner, o varios para juntarlos en un solo PDF (para mandarlo o imprimirlo). Un consolidado marcado con otros: «Agregar al consolidado».</div>}
      </div>
      <Panel abierto={!!escaner} onCerrar={() => setEscaner(null)} ancho={1180} cabecera={<b>{escaner?.titulo}</b>}>
        {escaner && <EscanearFotos key={escaner.titulo} titulo={escaner.titulo} modoInicial={escaner.modo} escalaInicial={escaner.escala} ordenadas={escaner.ordenadas} pdfsExtra={escaner.extras}
          nombreInicial={escaner.nombre} destino={escaner.destino} cerrar={() => setEscaner(null)} alGuardar={() => {}} />}
      </Panel>
    </div>
  );
}

/* ───────────────────────── Cobros y pagos ───────────────────────── */

/**
 * Lo que se le cobra al cliente, como lo piensa la oficina: el valor de todo el encargo ("el traspaso con la prenda
 * vale 100.000"), sus pagos y el saldo. El desglose (derechos, honorarios, otros) queda a un clic.
 * En un encargo, el valor va en el trámite que lleva los honorarios (los demás en cero) y los pagos nuevos también.
 */
function Cobros({ t }: { t: Tramite }) {
  const { avisar, confirmar } = useUI();
  const encargo = useLiveQuery(async () => (t.encargoId ? db.tramites.where("encargoId").equals(t.encargoId).toArray() : [t]), [t.encargoId, t.id, t.total]) ?? [t];
  const ids = encargo.map((x) => x.id).join(",");
  const pagos = useLiveQuery(() => db.pagos.where("tramiteId").anyOf(ids.split(",")).toArray().then((p) => p.sort((a, b) => a.fecha.localeCompare(b.fecha))), [ids]) ?? [];
  const principal = [...encargo].sort((a, b) => b.total - a.total || b.honorarios - a.honorarios || a.numero - b.numero)[0] ?? t;
  const suma = (k: "total" | "costoDerechos" | "honorarios" | "otrosCostos") => encargo.reduce((s, x) => s + x[k], 0);
  const valor = suma("total");
  const pagado = pagos.reduce((s, p) => s + p.valor, 0);
  const estado: EstadoPago = valor > 0 && pagado >= valor ? "pagado" : pagado > 0 ? "abonado" : "pendiente";
  const varios = encargo.length > 1;
  const tipos = useLiveQuery(() => db.tipos_tramite.toArray(), []) ?? [];
  /** La parte del combo: "Levantamiento de prenda". */
  const tipoNombre = (id: string) => { const x = encargo.find((e) => e.id === id); return tipos.find((y) => y.id === x?.tipoId)?.nombre ?? ""; };

  const [editando, setEditando] = useState<"valor" | "desglose" | null>(null);
  const [nuevoValor, setNuevoValor] = useState(valor);
  const [costos, setCostos] = useState({ costoDerechos: t.costoDerechos, honorarios: t.honorarios, otrosCostos: t.otrosCostos });
  const [sugerencia, setSugerencia] = useState<CostosSugeridos | null>(null);
  const [pago, setPago] = useState<{ valor: number; concepto: ConceptoPago; metodo: string; fecha: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editando) { setNuevoValor(valor); setCostos({ costoDerechos: t.costoDerechos, honorarios: t.honorarios, otrosCostos: t.otrosCostos }); } }, [valor, t.costoDerechos, t.honorarios, t.otrosCostos, editando]);
  const cerrar = () => { setEditando(null); setSugerencia(null); };

  /** La tarifa de todo el encargo (cada trámite con su tarifa; los honorarios una sola vez, como al crearlo). */
  async function tarifa() {
    try {
      const s = await Promise.all(encargo.map((x) => api<CostosSugeridos>(`/api/tramites/${x.id}/costos-sugeridos`)));
      setNuevoValor(s.reduce((a, x) => a + x.costoDerechos + x.honorarios, 0));
      setSugerencia(s.find((_, i) => encargo[i].id === t.id) ?? s[0]);
      setCostos((c) => ({ ...c, costoDerechos: s[encargo.findIndex((x) => x.id === t.id)]?.costoDerechos ?? c.costoDerechos, honorarios: s[encargo.findIndex((x) => x.id === t.id)]?.honorarios ?? c.honorarios }));
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  return (
    <div className="card">
      <div className="card-cab">
        <b>Cobro</b>
        <Badge tono={TONO_PAGO[estado]}>{ESTADO_PAGO_LABEL[estado]}</Badge>
        {!editando && <button className="btn btn-sm accion" onClick={() => setEditando("valor")}><Pencil size={13} />Cambiar valor</button>}
      </div>
      <div className="card-cuerpo pila" style={{ gap: 12 }}>
        {editando === "valor" ? (
          <div className="pila" style={{ gap: 10 }}>
            <Campo etiqueta={varios ? `Valor cobrado (todo el combo ${codigoTramite(t)})` : "Valor cobrado"}><Pesos valor={nuevoValor} cambiar={setNuevoValor} /></Campo>
            {sugerencia?.avisos.map((a) => <div key={a} className="peq muted">{a}</div>)}
            <div className="fila">
              <button className="btn btn-sm" onClick={tarifa}>Usar la tarifa</button>
              <button className="btn btn-sm btn-fantasma" onClick={() => setEditando("desglose")}>Desglose</button>
              <div className="espacio" />
              <button className="btn btn-sm" onClick={cerrar}>Cancelar</button>
              <button className="btn btn-sm btn-primario" disabled={!(nuevoValor > 0)} onClick={async () => {
                try { await escribir("POST", `/api/tramites/${t.id}/valor`, { valor: nuevoValor }); cerrar(); avisar("Valor guardado"); } catch (e) { avisar(mensajeDe(e), "error"); }
              }}>Guardar</button>
            </div>
          </div>
        ) : editando === "desglose" ? (
          <div className="pila" style={{ gap: 10 }}>
            {varios && <span className="peq muted">Desglose de {tipoNombre(t.id)} (esta parte del combo).</span>}
            <div className="campos" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <Campo etiqueta="Derechos y terceros"><Pesos valor={costos.costoDerechos} cambiar={(v) => setCostos({ ...costos, costoDerechos: v })} /></Campo>
              <Campo etiqueta="Honorarios"><Pesos valor={costos.honorarios} cambiar={(v) => setCostos({ ...costos, honorarios: v })} /></Campo>
              <Campo etiqueta="Otros"><Pesos valor={costos.otrosCostos} cambiar={(v) => setCostos({ ...costos, otrosCostos: v })} /></Campo>
            </div>
            {sugerencia && <div className="peq muted">Tarifa: {sugerencia.lineas.map((l) => `${l.concepto} ${pesos(l.valor)}`).join(" · ") || "sin líneas"} · Honorarios {pesos(sugerencia.honorarios)}</div>}
            <div className="fila">
              <button className="btn btn-sm" onClick={tarifa}>Usar la tarifa</button>
              <div className="espacio" />
              <button className="btn btn-sm" onClick={cerrar}>Cancelar</button>
              <button className="btn btn-sm btn-primario" onClick={async () => {
                try { await escribir("POST", `/api/tramites/${t.id}/costos`, costos); cerrar(); avisar("Desglose guardado"); } catch (e) { avisar(mensajeDe(e), "error"); }
              }}>Guardar desglose</button>
            </div>
          </div>
        ) : (
          <div className="pila" style={{ gap: 4 }}>
            <div className="fila" style={{ alignItems: "baseline", gap: 8 }}>
              <span className="cobro-valor">{pesos(valor)}</span>
              <span className="peq tenue">{varios ? `valor cobrado del combo (${encargo.length} trámites)` : "valor cobrado"}</span>
            </div>
            <span className="peq tenue">Derechos {pesos(suma("costoDerechos"))} · Honorarios {pesos(suma("honorarios"))}{suma("otrosCostos") ? ` · Otros ${pesos(suma("otrosCostos"))}` : ""}</span>
          </div>
        )}

        <div>
          <div className="fila" style={{ justifyContent: "space-between" }}>
            <b className="peq">Pagos</b>
            {!pago && <button className="btn btn-sm" onClick={() => setPago({ valor: Math.max(0, valor - pagado), concepto: "abono", metodo: "", fecha: hoyISO() })}><Plus size={14} />Registrar pago</button>}
          </div>
          <div className="lista-filas">
            {pagos.map((p) => (
              <div key={p.id} className="item">
                <div className="principal"><b>{pesos(p.valor)}</b><small>{CONCEPTO_PAGO_LABEL[p.concepto as ConceptoPago]} · {fecha(p.fecha)}{p.metodo ? ` · ${p.metodo}` : ""}{varios && p.tramiteId !== t.id ? ` · en ${tipoNombre(p.tramiteId)}` : ""}</small></div>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Quitar pago" onClick={async () => {
                  if (!(await confirmar({ titulo: "Quitar pago", texto: `Se quita el pago de ${pesos(p.valor)} del ${fecha(p.fecha)}.`, boton: "Quitar", peligro: true }))) return;
                  try { await escribir("DELETE", `/api/tramites/${p.tramiteId}/pagos/${p.id}`); } catch (e) { avisar(mensajeDe(e), "error"); }
                }}><Trash2 size={14} /></button>
              </div>
            ))}
            {!pagos.length && !pago && <div className="peq tenue" style={{ padding: "6px 0" }}>Sin pagos.</div>}
          </div>
          {pago && (
            <div className="pila" style={{ gap: 8, marginTop: 8 }}>
              <div className="campos">
                <Campo etiqueta="Valor"><Pesos valor={pago.valor} cambiar={(v) => setPago({ ...pago, valor: v })} /></Campo>
                <Campo etiqueta="Concepto"><Opciones valor={pago.concepto} cambiar={(v) => setPago({ ...pago, concepto: (v || "abono") as ConceptoPago })} opciones={CONCEPTOS_PAGO.map((c) => [c, CONCEPTO_PAGO_LABEL[c]] as const)} /></Campo>
                <Campo etiqueta="Método"><Texto valor={pago.metodo} cambiar={(v) => setPago({ ...pago, metodo: v })} placeholder="Efectivo, Nequi, transferencia…" /></Campo>
                <Campo etiqueta="Fecha"><Fecha valor={pago.fecha} cambiar={(v) => setPago({ ...pago, fecha: v })} /></Campo>
              </div>
              <ErrorFormulario error={error} />
              <div className="fila" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-sm" onClick={() => { setPago(null); setError(null); }}>Cancelar</button>
                <button className="btn btn-sm btn-primario" onClick={async () => {
                  setError(null);
                  // En un encargo, el pago va al trámite que tiene el valor (así el saldo de cada uno cuadra).
                  try { await escribir("POST", `/api/tramites/${principal.id}/pagos`, pago); setPago(null); avisar("Pago registrado"); } catch (e) { setError(mensajeDe(e)); }
                }}>Guardar pago</button>
              </div>
            </div>
          )}
          <div className="saldo"><span>Saldo{varios ? " del combo" : ""}</span><span style={{ color: valor - pagado > 0 ? "var(--rojo)" : "var(--verde)" }}>{pesos(Math.max(0, valor - pagado))}</span></div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Datos ───────────────────────── */

/** Expedición (1ª vez): con clases o sin clases, de un toque (la alerta de la carta de compromiso va en los dos casos). */
function Clases({ t }: { t: Tramite }) {
  const { avisar } = useUI();
  const poner = async (v: boolean) => {
    if (t.conClases === v) return;
    try { await escribir("PATCH", `/api/tramites/${t.id}`, { conClases: v }); avisar(v ? "Con clases" : "Sin clases"); } catch (e) { avisar(mensajeDe(e), "error"); }
  };
  return (
    <div className="seg" role="group" aria-label="Clases">
      <button type="button" className={t.conClases === true ? "on" : ""} aria-pressed={t.conClases === true} onClick={() => poner(true)}>Con clases</button>
      <button type="button" className={t.conClases === false ? "on" : ""} aria-pressed={t.conClases === false} onClick={() => poner(false)}>Sin clases</button>
    </div>
  );
}

function Datos({ t, esLicencia, expedicion }: { t: Tramite; esLicencia: boolean; expedicion?: boolean }) {
  const { avisar } = useUI();
  const organismos = useOrganismos();
  const inicial = () => ({
    organismoId: t.organismoId ?? "", fechaEstimadaEntrega: t.fechaEstimadaEntrega ?? "", fechaRadicado: t.fechaRadicado ?? "", detalle: t.detalle ?? "",
    aliado: t.aliado ?? "", estadoTarjeta: (t.estadoTarjeta ?? "") as EstadoTarjeta | "", observaciones: t.observaciones ?? "",
  });
  const [f, setF] = useState(inicial);
  // Desde el clic derecho ("Editar datos"): ?editar=1 abre los datos ya en edición.
  const [params, setParams] = useSearchParams();
  const [editando, setEditando] = useState(() => params.get("editar") === "1");
  useEffect(() => { if (params.get("editar") === "1") setParams((p) => { const x = new URLSearchParams(p); x.delete("editar"); return x; }, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editando) setF(inicial()); }, [t, editando]); // eslint-disable-line react-hooks/exhaustive-deps
  const org = organismos.find((o) => o.id === t.organismoId);

  if (!editando) {
    return (
      <div className="card">
        <div className="card-cab"><b>Datos</b><button className="btn btn-sm accion" onClick={() => setEditando(true)}><Pencil size={13} />Editar</button></div>
        <div className="card-cuerpo">
          <dl className="dl">
            <div><dt>Organismo</dt><dd>{org ? <>{org.nombre}<Copiar valor={org.nombre} que="el organismo" /></> : <span className="sin-dato">Sin dato</span>}</dd></div>
            <div><dt>Entrega estimada</dt><dd>{fecha(t.fechaEstimadaEntrega) || <span className="sin-dato">Sin dato</span>}</dd></div>
            <div><dt>Radicado</dt><dd>{fecha(t.fechaRadicado) || <span className="sin-dato">Sin radicar</span>}</dd></div>
            <div><dt>Entregado</dt><dd>{fecha(t.fechaEntrega) || <span className="sin-dato">Sin entregar</span>}</dd></div>
            {(esLicencia || t.detalle) && <div><dt>{esLicencia ? "Categorías" : "Detalle"}</dt><dd>{t.detalle || <span className="sin-dato">Sin dato</span>}<Copiar valor={t.detalle} /></dd></div>}
            {expedicion && <div><dt>Clases</dt><dd><Clases t={t} />{t.conClases === null || t.conClases === undefined ? <span className="sin-dato" style={{ marginLeft: 8 }}>Sin decir</span> : null}</dd></div>}
            <div><dt>Aliado</dt><dd>{t.aliado || <span className="sin-dato">Ninguno</span>}<Copiar valor={t.aliado} que="el aliado" /></dd></div>
            <div><dt>Tarjeta física</dt><dd>{t.estadoTarjeta ? ESTADO_TARJETA_LABEL[t.estadoTarjeta as EstadoTarjeta] : <span className="sin-dato">No aplica</span>}</dd></div>
            <div><dt>Creado</dt><dd>{fecha(t.creado)}</dd></div>
            {t.observaciones && <div style={{ gridColumn: "1 / -1" }}><dt>Observaciones</dt><dd style={{ whiteSpace: "pre-wrap" }}>{t.observaciones}<Copiar valor={t.observaciones} que="las observaciones" /></dd></div>}
          </dl>
        </div>
      </div>
    );
  }
  const cats = categoriasDeTexto(f.detalle);
  return (
    <div className="card fcard editando">
      <div className="card-cab"><b>Editar datos</b></div>
      <div className="card-cuerpo pila" style={{ gap: 12 }}>
        <div className="campos">
          <Campo etiqueta="Organismo" ancho><BuscadorOrganismo organismos={organismos} valor={f.organismoId} cambiar={(v) => setF({ ...f, organismoId: v })} /></Campo>
          <Campo etiqueta="Entrega estimada"><Fecha valor={f.fechaEstimadaEntrega} cambiar={(v) => setF({ ...f, fechaEstimadaEntrega: v })} /></Campo>
          <Campo etiqueta="Fecha de radicado"><Fecha valor={f.fechaRadicado} cambiar={(v) => setF({ ...f, fechaRadicado: v })} /></Campo>
          {esLicencia ? (
            <Campo etiqueta="Categorías" ancho>
              <div className="fila-wrap" style={{ gap: 6 }}>
                {CATEGORIAS_LICENCIA.map((c) => (
                  <button type="button" key={c} className={`filtro-chip ${cats.includes(c) ? "on" : ""}`} onClick={() => setF({ ...f, detalle: (cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]).join(",") })}>{c}</button>
                ))}
              </div>
            </Campo>
          ) : (
            <Campo etiqueta="Detalle"><Texto valor={f.detalle} cambiar={(v) => setF({ ...f, detalle: v })} /></Campo>
          )}
          <Campo etiqueta="Aliado" ayuda="Tramitador, academia o centro médico"><Texto valor={f.aliado} cambiar={(v) => setF({ ...f, aliado: v })} /></Campo>
          <Campo etiqueta="Tarjeta física"><Opciones valor={f.estadoTarjeta} cambiar={(v) => setF({ ...f, estadoTarjeta: v })} vacio="No aplica" opciones={ESTADOS_TARJETA.map((s) => [s, ESTADO_TARJETA_LABEL[s]] as const)} /></Campo>
          <Campo etiqueta="Observaciones" ancho><textarea className="input" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
        </div>
        <ErrorFormulario error={error} />
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={() => { setEditando(false); setError(null); }}>Cancelar</button>
          <button className="btn btn-sm btn-primario" onClick={async () => {
            setError(null);
            try {
              const cambios = Object.fromEntries(Object.entries(f).filter(([k, v]) => (v || null) !== ((t as Record<string, unknown>)[k] ?? null)).map(([k, v]) => [k, v || null]));
              if (Object.keys(cambios).length) await escribir("PATCH", `/api/tramites/${t.id}`, cambios);
              setEditando(false);
              avisar("Datos guardados");
            } catch (e) { setError(mensajeDe(e)); }
          }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Personas y vehículo ───────────────────────── */

function Personas({ t, titular, placa, abrirCliente, abrirVehiculo }: { t: Tramite; titular?: string; placa?: string; abrirCliente: (id: string, persona?: PersonaDelTramite) => void; abrirVehiculo: (id: string) => void }) {
  const { avisar } = useUI();
  const opciones = useOpcionesClientes();
  const personas = useLiveQuery(async () => {
    const lista = await db.tramite_personas.where("tramiteId").equals(t.id).toArray();
    const clientes = new Map((await db.clientes.bulkGet([t.titularId, ...lista.map((p) => p.clienteId)])).filter(Boolean).map((c) => [c!.id, c!]));
    return { titular: clientes.get(t.titularId), lista: lista.map((p) => ({ p, nombre: clientes.get(p.clienteId)?.nombre ?? "", cliente: clientes.get(p.clienteId) })) };
  }, [t.id, t.titularId]);
  /** Documento y teléfono de una persona, cada uno con su botón de copiar. */
  const contacto = (c?: { tipoDocumento: string; numeroDocumento: string; telefono?: string | null; otrosTelefonos?: string[] | null }) => c && (c.numeroDocumento || c.telefono) ? (
    <small className="datos-copiables">
      {c.numeroDocumento && <span>{c.tipoDocumento} {c.numeroDocumento}<Copiar valor={c.numeroDocumento} que="el documento" /></span>}
      {c.telefono && <span>Tel. {c.telefono}<Copiar valor={c.telefono} que="el teléfono" /></span>}
      {(c.otrosTelefonos ?? []).map((x) => <span key={x}>Otro: {x}<Copiar valor={x} que="el teléfono" /></span>)}
    </small>
  ) : null;
  const vehiculos = useLiveQuery(() => db.vehiculos.toArray(), []) ?? [];
  const [agregar, setAgregar] = useState<{ clienteId: string | null; rol: RolPersona } | null>(null);
  // Una persona que no está en la base (un tercero, un comprador nuevo): se crea ahí mismo y queda elegida.
  const [nueva, setNueva] = useState<string | null>(null);
  const inicialNueva = useMemo(() => (nueva !== null ? { nombre: nueva.toUpperCase() } : undefined), [nueva]);
  const [cambiarVehiculo, setCambiarVehiculo] = useState(false);

  return (
    <div className="card">
      <div className="card-cab"><b>Personas y vehículo</b><button className="btn btn-sm accion" onClick={() => setAgregar({ clienteId: null, rol: "comprador" })}><UserPlus size={14} />Agregar persona</button></div>
      <div className="card-cuerpo lista-filas" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="item">
          <div className="principal"><small>Titular</small><span><a href="#" onClick={(e) => { e.preventDefault(); abrirCliente(t.titularId); }}><b>{titular}</b></a><Copiar valor={titular} que="el nombre" /></span>{contacto(personas?.titular)}</div>
        </div>
        <div className="item">
          <div className="principal">
            <small>Vehículo</small>
            {cambiarVehiculo ? (
              <Buscador
                opciones={vehiculos.map((v) => ({ id: v.id, titulo: v.placa, detalle: [v.marca, v.linea].filter(Boolean).join(" "), busqueda: v.busqueda }))}
                elegido={null}
                elegir={async (id) => { setCambiarVehiculo(false); if (!id) return; try { await escribir("PATCH", `/api/tramites/${t.id}`, { vehiculoId: id }); } catch (e) { avisar(mensajeDe(e), "error"); } }}
                placeholder="Buscar por placa"
              />
            ) : t.vehiculoId ? <span><a href="#" onClick={(e) => { e.preventDefault(); abrirVehiculo(t.vehiculoId!); }}><b>{placa}</b></a><Copiar valor={placa} que="la placa" /></span> : <span className="sin-dato">Sin vehículo</span>}
          </div>
          {!cambiarVehiculo && <button className="btn btn-sm btn-fantasma" onClick={() => setCambiarVehiculo(true)}>{t.vehiculoId ? "Cambiar" : "Agregar"}</button>}
        </div>
        {(personas?.lista ?? []).map(({ p, nombre, cliente }) => (
          <div key={p.id} className="item">
            {/* El rol se cambia en "Editar" de su ficha (tocando el nombre). */}
            <div className="principal"><small>{ROL_PERSONA_LABEL[p.rol as RolPersona]}</small>
              <span><a href="#" onClick={(e) => { e.preventDefault(); abrirCliente(p.clienteId, { tramiteId: t.id, personaId: p.id }); }}><b>{nombre}</b></a><Copiar valor={nombre} que="el nombre" /></span>{contacto(cliente)}</div>
            <button className="btn btn-sm btn-fantasma btn-icono" title="Quitar" onClick={async () => { try { await escribir("DELETE", `/api/tramites/${t.id}/personas/${p.id}`); } catch (e) { avisar(mensajeDe(e), "error"); } }}><X size={14} /></button>
          </div>
        ))}
        <PanelCliente abierto={nueva !== null} inicial={inicialNueva} onCerrar={() => setNueva(null)} alGuardar={(id) => setAgregar((a) => ({ clienteId: id, rol: a?.rol ?? "interviniente" }))} />
        {agregar && (
          <div className="item" style={{ flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}><Buscador opciones={opciones} elegido={agregar.clienteId} elegir={(id) => setAgregar({ ...agregar, clienteId: id })} placeholder="Buscar persona (nombre o cédula)" crear={{ texto: "Crear persona nueva", accion: (escrito) => setNueva(escrito) }} /></div>
            <select className="select" style={{ width: 240 }} value={agregar.rol} onChange={(e) => setAgregar({ ...agregar, rol: e.target.value as RolPersona })}>
              {ROLES_PERSONA.filter((r) => r !== "titular").map((r) => <option key={r} value={r}>{ROL_PERSONA_LABEL[r]}</option>)}
            </select>
            <button className="btn btn-sm btn-primario" disabled={!agregar.clienteId} onClick={async () => { try { await escribir("POST", `/api/tramites/${t.id}/personas`, agregar); setAgregar(null); } catch (e) { avisar(mensajeDe(e), "error"); } }}>Agregar</button>
            <button className="btn btn-sm btn-fantasma btn-icono" onClick={() => setAgregar(null)}><X size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Bitácora ───────────────────────── */

/** Destaca (o quita) una entrada de la bitácora como la nota del trámite. */
async function destacar(b: EntradaBitacora, si: boolean, avisar: ReturnType<typeof useUI>["avisar"]) {
  try { await escribir("POST", `/api/tramites/${b.tramiteId}/bitacora/${b.id}/destacar`, { destacada: si }); avisar(si ? "Quedó como nota destacada del trámite" : "Se quitó la nota destacada"); } catch (e) { avisar(mensajeDe(e), "error"); }
}

/** Fija (la chinche) o suelta una entrada de la bitácora: las fijadas salen pequeñas arriba, al lado de la destacada. */
async function fijar(b: EntradaBitacora, si: boolean, avisar: ReturnType<typeof useUI>["avisar"]) {
  try { await escribir("POST", `/api/tramites/${b.tramiteId}/bitacora/${b.id}/destacar`, { fijada: si }); avisar(si ? "Nota fijada arriba del trámite" : "Nota soltada (sigue en la bitácora)"); } catch (e) { avisar(mensajeDe(e), "error"); }
}
/**
 * El color de una nota del trámite: el amarillo es solo de la destacada; las demás (fijadas y escritas en la bitácora)
 * van en rosa, verde, azul o lila, siempre el mismo para la misma nota (arriba y en la bitácora).
 */
const COLORES_NOTA_TRAMITE = ["rosa", "verde", "azul", "lila"] as const;
const colorNota = (b: EntradaBitacora) => (b.destacada ? "amarillo" : COLORES_NOTA_TRAMITE[[...b.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORES_NOTA_TRAMITE.length]);
const verEnBitacora = (b: EntradaBitacora) => document.getElementById(`evento-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
const fechaCorta = (f: string) => new Date(f).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

/**
 * Arriba a la derecha del expediente: la nota destacada (la estrella: lo más importante, un rechazo, un problema) y, al
 * lado, las fijadas con la chinche (pequeñas, como las noticas). Una fijada se vuelve la destacada con su estrella (la
 * que era destacada pasa a fijada: nada se pierde si fue un error).
 */
function NotasArriba({ destacada, fijadas }: { destacada?: EntradaBitacora; fijadas: EntradaBitacora[] }) {
  const { avisar } = useUI();
  return (
    <div className="notas-arriba">
      {fijadas.length > 0 && (
        <div className="notas-fijadas" aria-label="Notas fijadas">
          {fijadas.map((b, i) => (
            <div key={b.id} className={`notica fijada c-${colorNota(b)} nota-fijada`} style={{ "--giro": `${[-1.2, 0.9, -0.6, 1.1][i % 4]}deg` } as CSSProperties} role="note" aria-label={`Nota fijada: ${b.descripcion ?? ""}`}>
              <div className="nota-texto-desplegable">
                <p className="notica-texto">{b.descripcion}</p>
                {(b.descripcion?.length ?? 0) > 70 && <div className="notica-completa" role="tooltip">{b.descripcion}</div>}
              </div>
              <div className="notica-pie">
                <small>{fechaCorta(b.fecha)}</small>
                <span className="nota-fijada-acc">
                  <button type="button" className="notica-btn" title="Convertirla en la nota destacada (la destacada de ahora queda fijada)" aria-label="Convertir en la nota destacada" onClick={() => destacar(b, true, avisar)}><Star size={13} /></button>
                  <button type="button" className="notica-btn" title="Ver en la bitácora" aria-label="Ver en la bitácora" onClick={() => verEnBitacora(b)}><ListIcon size={13} /></button>
                  <button type="button" className="notica-btn" title="Soltarla (sigue en la bitácora)" aria-label="Soltar la nota" onClick={() => fijar(b, false, avisar)}><PinOff size={13} /></button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {destacada && (
        // La destacada también es una notica (la única amarilla), más grande y con su estrella.
        <aside className="nota-destacada notica c-amarillo" aria-label="Nota destacada">
          <div className="nota-destacada-cab">
            <Star size={14} fill="currentColor" /><b>Nota destacada</b>
            <small>{fechaCorta(destacada.fecha)}</small>
          </div>
          {/* Si es larga (se corta a 3 renglones), al pasar el mouse por el texto la nota se despliega entera. */}
          <div className="nota-texto-desplegable">
            <p>{destacada.descripcion}</p>
            {(destacada.descripcion?.length ?? 0) > 110 && <div className="notica-completa" role="tooltip">{destacada.descripcion}</div>}
          </div>
          <div className="nota-destacada-acciones">
            <button type="button" className="accion peq" onClick={() => verEnBitacora(destacada)}>Ver en la bitácora</button>
            <button type="button" className="accion peq" onClick={() => fijar(destacada, true, avisar)} title="Deja de ser la destacada y queda fijada al lado">Pasar a fijada</button>
            <button type="button" className="accion peq" onClick={() => destacar(destacada, false, avisar)}>Quitar</button>
          </div>
        </aside>
      )}
    </div>
  );
}

function Bitacora({ tramiteId }: { tramiteId: string }) {
  const { avisar } = useUI();
  const eventos = useLiveQuery(() => db.bitacora.where("tramiteId").equals(tramiteId).toArray().then((b) => b.sort((a, c) => c.fecha.localeCompare(a.fecha))), [tramiteId]) ?? [];
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const { confirmar } = useUI();
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  async function guardarEdicion() {
    if (!editando?.texto.trim()) return;
    setGuardando(true);
    try { await escribir("PATCH", `/api/tramites/${tramiteId}/bitacora/${editando.id}`, { texto: editando.texto }); setEditando(null); avisar("Bitácora corregida"); } catch (e) { avisar(mensajeDe(e), "error"); } finally { setGuardando(false); }
  }
  async function borrar(b: EntradaBitacora) {
    const nota = b.tipoEvento === "nota";
    if (!(await confirmar({ titulo: nota ? "Borrar nota" : "Borrar de la bitácora", texto: `Se borra ${nota ? "la nota" : "la entrada"}: "${(b.descripcion ?? "").slice(0, 120)}"`, boton: "Borrar", peligro: true }))) return;
    try { await escribir("DELETE", `/api/tramites/${tramiteId}/bitacora/${b.id}`); avisar(nota ? "Nota borrada" : "Entrada borrada"); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function guardar() {
    if (!nota.trim()) return;
    setGuardando(true);
    try { await escribir("POST", `/api/tramites/${tramiteId}/notas`, { texto: nota }); setNota(""); } catch (e) { avisar(mensajeDe(e), "error"); } finally { setGuardando(false); }
  }
  return (
    <div className="card">
      <div className="card-cab"><b>Bitácora</b><span className="peq tenue">{eventos.length} entradas</span></div>
      <div className="card-cuerpo pila" style={{ gap: 14 }}>
        <div className="fila" style={{ alignItems: "flex-start" }}>
          <textarea className="input" style={{ minHeight: 40 }} placeholder="Escribir una nota…" value={nota} onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) guardar(); }} />
          <button className="btn btn-primario btn-icono" title="Agregar nota (Ctrl+Enter)" disabled={guardando || !nota.trim()} onClick={guardar}><MessageSquarePlus size={16} /></button>
        </div>
        <div className="bitacora">
          {eventos.map((b: EntradaBitacora) => (
            <div key={b.id} id={`evento-${b.id}`} className={`evento ${b.tipoEvento === "cambio_estado" ? "estado" : ""}${b.tipoEvento === "nota" || b.destacada ? ` es-nota c-${colorNota(b)}` : ""}${b.destacada ? " destacada" : ""}${b.fijada ? " fijada" : ""}`}>
              <div className="evento-cab">
                <small>{new Date(b.fecha).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}{ORIGEN_LABEL[b.origen] ? ` · ${ORIGEN_LABEL[b.origen]}` : ""}{b.destacada && <span className="etiqueta-destacada"><Star size={11} fill="currentColor" />Destacada</span>}{b.fijada && !b.destacada && <span className="etiqueta-fijada"><Pin size={11} fill="currentColor" />Fijada</span>}</small>
                {editando?.id !== b.id && (
                  <span className="evento-acciones">
                    <button type="button" className="btn-copiar" title={b.destacada ? "Quitar de nota destacada" : "Nota destacada: que salga grande arriba del trámite"} aria-label={b.destacada ? "Quitar de nota destacada" : "Destacar nota"} onClick={() => destacar(b, !b.destacada, avisar)}>{b.destacada ? <StarOff size={12} /> : <Star size={12} />}</button>
                    {!b.destacada && <button type="button" className={`btn-copiar${b.fijada ? " fijada-on" : ""}`} title={b.fijada ? "Soltar (deja de salir arriba)" : "Fijar con la chinche: sale pequeña arriba del trámite"} aria-label={b.fijada ? "Soltar la nota" : "Fijar la nota"} onClick={() => fijar(b, !b.fijada, avisar)}>{b.fijada ? <PinOff size={12} /> : <Pin size={12} />}</button>}
                    <Copiar valor={b.descripcion} que="el texto" />
                    <button type="button" className="btn-copiar" title="Corregir" aria-label="Corregir" onClick={() => setEditando({ id: b.id, texto: b.descripcion ?? "" })}><Pencil size={12} /></button>
                    <button type="button" className="btn-copiar" title={b.tipoEvento === "nota" ? "Borrar nota" : "Borrar de la bitácora"} aria-label={b.tipoEvento === "nota" ? "Borrar nota" : "Borrar de la bitácora"} onClick={() => borrar(b)}><Trash2 size={12} /></button>
                  </span>
                )}
              </div>
              {editando?.id === b.id ? (
                <div className="pila" style={{ gap: 6 }}>
                  <textarea className="input" aria-label="Corregir la entrada" autoFocus value={editando.texto} onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) guardarEdicion(); if (e.key === "Escape") setEditando(null); }} />
                  <div className="fila" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-primario" disabled={guardando || !editando.texto.trim()} onClick={guardarEdicion}>Guardar</button>
                    <button className="btn btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
                  </div>
                </div>
              ) : <p>{b.descripcion}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Accesos a los formatos que suele pedir este trámite (todos están en Formatos). */
/** La carta de compromiso de la academia (Formatos de la oficina), para imprimirla. */
const RUTA_CARTA = "/formatos/carta-compromiso-academia.pdf";

function FormatosDelTramite({ categoria, nombre, tramiteId }: { categoria: string; nombre: string; tramiteId: string }) {
  const n = normalizar(nombre);
  const ids: FormatoOficial["id"][] = categoria === "vehiculo"
    ? ["fun", ...(n.includes("traspaso") ? (["compraventa"] as const) : []), "mandato"]
    : categoria === "licencia" && !pideCompromiso({ nombre, categoria }) ? ["mandato"] : [];
  const carta = pideCompromiso({ nombre, categoria });
  if (!ids.length && !carta) return null;
  return (
    <div className="fila-wrap peq" style={{ gap: 8, alignItems: "center" }}>
      <span className="muted">Formatos:</span>
      {categoria === "vehiculo" && <Link className="btn btn-sm btn-primario" to={`/formatos/llenar?tramite=${tramiteId}`}><ScanLine size={13} />Llenar formatos</Link>}
      {carta && <a className="btn btn-sm" href={RUTA_CARTA} target="_blank" rel="noreferrer" title="Para imprimirla, que la firme y subirla firmada en Archivos"><FileText size={13} />Carta de compromiso</a>}
      {ids.map((id) => { const f = formatoOficial(id); return <a key={id} className="btn btn-sm" href={f.ruta} target="_blank" rel="noreferrer"><FileText size={13} />{id === "fun" ? "FUN" : id === "compraventa" ? "Compraventa" : "Contrato de mandato"}</a>; })}
      <Link className="peq accion" to="/formatos">Todos los formatos</Link>
    </div>
  );
}
