import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, FileText, Link2, MessageCircle, RefreshCw, ScanLine, Search, ShieldCheck, Sparkles, Unlink, UserPlus, UserX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CLASIFICACION_CHAT_LABEL, normalizar, type ClasificacionChat } from "../../compartido/dominio";
import type { ChatWhatsApp, MensajeWhatsApp, PropuestaWhatsApp } from "../../compartido/tipos";
import { Buscador } from "../componentes/formulario";
import { PanelCliente } from "../componentes/PanelCliente";
import { Badge, Cabecera, useUI, Vacio, type Tono } from "../componentes/ui";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { useOpcionesClientes } from "../datos/hooks";
import { alVencer } from "../datos/sesion";

/*
 * Monitor de WhatsApp (solo lectura). Los chats y las propuestas vienen en la copia local; los mensajes se piden
 * al abrir cada chat (no se guardan en el equipo). Nexum no envía nada: se responde desde el celular o WhatsApp Web.
 */

type Vista = "tramites" | "revisar" | "todos";
const EN_REVISION: ClasificacionChat[] = ["pendiente", "dudoso", "personal_propuesto"];
const TONO: Record<ClasificacionChat, Tono> = { pendiente: "gris", tramites: "verde", dudoso: "ambar", personal_propuesto: "morado", personal: "gris" };
const archivoUrl = (m: MensajeWhatsApp) => `/api/whatsapp/mensajes/${encodeURIComponent(m.id)}/archivo`;
const telefonoLocal = (id: string) => (id.length === 12 && id.startsWith("57") ? id.slice(2) : id);
const verTelefono = (id: string) => { const t = telefonoLocal(id); return t.length === 10 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : `+${id}`; };

function cuando(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  const dias = (hoy.getTime() - d.getTime()) / 10_000_000;
  return dias < 6 ? d.toLocaleDateString("es-CO", { weekday: "short" }) : d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

interface EstadoConexion {
  configurado: boolean; ultimoEvento: string | null; mensajes: number;
  historial: { fase?: number | null; avance?: number | null; error?: string; en: string } | null;
  sincronizacion: { hecha: boolean; fin: string | null; puede: boolean };
}

/** Estado de la conexión con Kapso y del historial, para saber si están llegando mensajes. */
function Conexion() {
  const { avisar } = useUI();
  const [e, setE] = useState<EstadoConexion | null>(null);
  const [error, setError] = useState(false);
  const [trayendo, setTrayendo] = useState<number | null>(null);
  const leer = useCallback(() => {
    api<EstadoConexion>("/api/whatsapp/estado").then((r) => { setE(r); setError(false); }, (x) => { if (x instanceof SesionVencida || x instanceof SinAcceso) alVencer(x); setError(true); });
  }, []);
  useEffect(() => { leer(); const t = setInterval(() => !document.hidden && leer(), 10_000); return () => clearInterval(t); }, [leer]);

  /** Trae el historial de Kapso página por página (el cron también lo hace solo, más despacio). */
  async function traerHistorial() {
    let total = 0;
    setTrayendo(0);
    try {
      for (let i = 0; i < 200; i++) {
        const r = await escribir<{ guardados: number; terminado: boolean }>("POST", "/api/whatsapp/sincronizar");
        total += r.guardados;
        setTrayendo(total);
        if (r.terminado) break;
      }
      avisar(`Historial al día: ${total} mensajes nuevos`);
    } catch (x) { avisar(mensajeDe(x), "error"); } finally { setTrayendo(null); leer(); }
  }

  if (error) return <span className="peq tenue">Sin conexión con el servidor</span>;
  if (!e) return null;
  const texto = !e.configurado ? "Falta conectar Kapso" : !e.ultimoEvento ? "Esperando la conexión del número" : e.historial?.error ? `Conectado · historial no compartido: ${e.historial.error}` : `Conectado · último aviso ${cuando(e.ultimoEvento)}`;
  return (
    <span className="fila peq muted" style={{ gap: 6, flexWrap: "wrap" }} title={`${e.mensajes.toLocaleString("es-CO")} mensajes guardados`}>
      <span className="punto-estado" style={{ "--c": e.ultimoEvento && e.configurado ? "var(--verde)" : "var(--texto-3)" } as React.CSSProperties} />{texto}
      {e.sincronizacion.puede && !e.sincronizacion.hecha && (
        trayendo != null
          ? <span>· trayendo historial: {trayendo} mensajes…</span>
          : <button className="btn btn-sm" onClick={traerHistorial} title="El historial se trae solo cada 5 minutos; esto lo acelera">Traer historial</button>
      )}
      <button className="btn btn-sm btn-fantasma btn-icono" title="Actualizar" onClick={leer}><RefreshCw size={13} /></button>
    </span>
  );
}

/** Ejecuta una propuesta con las rutas de siempre (reglas y bitácora incluidas, marcada "whatsapp"). */
async function confirmarPropuesta(p: PropuestaWhatsApp) {
  const cuerpo = JSON.parse(p.cuerpo) as Record<string, unknown>;
  const r = await escribir<{ id?: string }>(p.metodo as "POST" | "PATCH", p.ruta, { ...cuerpo, origen: "whatsapp", referencia: p.mensajeId });
  if (p.tipo === "cliente" && r.id) await escribir("PATCH", `/api/whatsapp/chats/${p.chatId}`, { clienteId: r.id });
  await escribir("PATCH", `/api/whatsapp/propuestas/${p.id}`, { estado: "hecha" });
}

function Propuestas({ lista }: { lista: PropuestaWhatsApp[] }) {
  const { avisar } = useUI();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  if (!lista.length) return null;
  async function decidir(p: PropuestaWhatsApp, si: boolean) {
    setOcupada(p.id);
    try {
      if (si) { await confirmarPropuesta(p); avisar("Hecho"); } else await escribir("PATCH", `/api/whatsapp/propuestas/${p.id}`, { estado: "descartada" });
      setErrores((e) => { const { [p.id]: _, ...resto } = e; return resto; });
    } catch (e) {
      setErrores((x) => ({ ...x, [p.id]: mensajeDe(e) }));
    } finally {
      setOcupada(null);
    }
  }
  return (
    <div className="wa-propuestas">
      {lista.map((p) => (
        <div key={p.id} className="bloque-ia propuesta">
          <div className="fila" style={{ gap: 8, alignItems: "flex-start" }}>
            <Sparkles size={15} style={{ color: "var(--primario)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div className="peq" style={{ marginBottom: 8 }}>{p.titulo}</div>
              <div className="fila" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primario" disabled={ocupada === p.id} onClick={() => decidir(p, true)}><Check size={13} />Confirmar</button>
                <button className="btn btn-sm" disabled={ocupada === p.id} onClick={() => decidir(p, false)}>Descartar</button>
                {errores[p.id] && <span className="peq" style={{ color: "var(--rojo)" }}>{errores[p.id]}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Mensaje({ m, alLeerCedula }: { m: MensajeWhatsApp; alLeerCedula: (m: MensajeWhatsApp) => void }) {
  const hay = !!(m.archivoClave || m.archivoEnlace);
  const hora = new Date(m.enviado).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  const leyenda = m.texto && !(m.tipo === "document" && m.texto === m.archivoNombre) ? <div className="wa-texto">{m.texto}</div> : null;
  let cuerpo;
  if (m.tipo === "image" || m.tipo === "sticker") {
    cuerpo = hay ? (
      <>
        <a href={archivoUrl(m)} target="_blank" rel="noreferrer"><img className={m.tipo === "sticker" ? "wa-sticker" : "wa-img"} src={archivoUrl(m)} alt="" loading="lazy" /></a>
        {m.tipo === "image" && m.direccion === "entrante" && <button className="btn btn-sm btn-fantasma wa-accion" title="Leer esta foto como cédula y crear el cliente" onClick={() => alLeerCedula(m)}><ScanLine size={13} />Leer como cédula</button>}
        {leyenda}
      </>
    ) : <><div className="peq tenue">[Foto no disponible: WhatsApp solo comparte archivos recientes]</div>{leyenda}</>;
  } else if (m.tipo === "audio") {
    cuerpo = hay ? <audio controls preload="none" src={archivoUrl(m)} /> : <div className="peq tenue">[Audio no disponible]</div>;
  } else if (m.tipo === "video") {
    cuerpo = hay ? <><video className="wa-img" controls preload="none" src={archivoUrl(m)} />{leyenda}</> : <div className="peq tenue">[Video no disponible]</div>;
  } else if (m.tipo === "document") {
    cuerpo = <>{hay ? <a className="wa-doc" href={archivoUrl(m)} target="_blank" rel="noreferrer"><FileText size={16} />{m.archivoNombre ?? "Documento"}</a> : <div className="peq tenue">[Documento no disponible: {m.archivoNombre ?? "sin nombre"}]</div>}{leyenda}</>;
  } else {
    cuerpo = m.texto ? <div className="wa-texto">{m.texto}</div> : <div className="peq tenue">[{m.tipo}]</div>;
  }
  return (
    <div className={`wa-msg ${m.direccion}`}>
      {cuerpo}
      <span className="wa-hora">{hora}</span>
    </div>
  );
}

function Conversacion({ chat, nombreCliente, propuestas, alVolver }: { chat: ChatWhatsApp; nombreCliente: string | null; propuestas: PropuestaWhatsApp[]; alVolver: () => void }) {
  const nav = useNavigate();
  const { confirmar, avisar } = useUI();
  const opcionesClientes = useOpcionesClientes();
  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [mas, setMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uniendo, setUniendo] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState<{ foto: Blob | null } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const alFinal = useRef(true);

  const pedir = useCallback(async (antes?: string) => {
    const r = await api<{ mensajes: MensajeWhatsApp[]; mas: boolean }>(`/api/whatsapp/chats/${chat.id}/mensajes${antes ? `?antes=${encodeURIComponent(antes)}` : ""}`);
    return r;
  }, [chat.id]);

  const fallo = (e: unknown) => {
    if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
    setError(e instanceof SinConexion ? "Sin conexión: los mensajes se ven con internet." : mensajeDe(e));
  };

  // Al abrir el chat y cada vez que llega algo nuevo (cambia el último mensaje): la página más reciente.
  useEffect(() => {
    let vigente = true;
    setError(null);
    pedir().then((r) => {
      if (!vigente) return;
      setMensajes((previos) => {
        const nuevos = new Map([...previos.filter((m) => m.chatId === chat.id), ...r.mensajes].map((m) => [m.id, m]));
        return [...nuevos.values()].sort((a, b) => a.enviado.localeCompare(b.enviado));
      });
      setMas((x) => (mensajes.length && mensajes[0]?.chatId === chat.id ? x : r.mas));
    }, fallo).finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [chat.id, chat.ultimoMensaje]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setMensajes([]); setCargando(true); setMas(false); alFinal.current = true; setUniendo(false); }, [chat.id]);
  useEffect(() => { if (alFinal.current && caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [mensajes]);
  useEffect(() => { if (chat.noLeidos > 0) escribir("PATCH", `/api/whatsapp/chats/${chat.id}`, { leido: true }).catch(() => {}); }, [chat.id, chat.noLeidos]);

  async function anteriores() {
    if (!mensajes.length) return;
    const alto = caja.current?.scrollHeight ?? 0;
    alFinal.current = false;
    try {
      const r = await pedir(mensajes[0].enviado);
      setMensajes((m) => [...r.mensajes, ...m]);
      setMas(r.mas);
      requestAnimationFrame(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight - alto; });
    } catch (e) { fallo(e); }
  }

  async function clasificar(c: "tramites" | "dudoso") {
    try { await escribir("PATCH", `/api/whatsapp/chats/${chat.id}`, { clasificacion: c }); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function personal() {
    if (!(await confirmar({ titulo: "Marcar como personal", texto: "Se borran de Nexum los mensajes y archivos de este chat, y lo que llegue de este número ya no se guarda. En el celular no cambia nada. No se puede deshacer.", boton: "Marcar como personal", peligro: true }))) return;
    try { await escribir("POST", "/api/whatsapp/personales", { ids: [chat.id] }); avisar("Chat marcado como personal"); alVolver(); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function unir(clienteId: string | null) {
    try { await escribir("PATCH", `/api/whatsapp/chats/${chat.id}`, { clienteId }); setUniendo(false); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  async function leerCedula(m: MensajeWhatsApp) {
    try {
      const r = await fetch(archivoUrl(m), { credentials: "same-origin" });
      if (!r.ok) throw new Error("No se pudo abrir la foto.");
      setNuevoCliente({ foto: await r.blob() });
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  // Separadores por día.
  const filas: ({ dia: string } | MensajeWhatsApp)[] = [];
  let dia = "";
  for (const m of mensajes) {
    const d = new Date(m.enviado).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (d !== dia) { filas.push({ dia: d }); dia = d; }
    filas.push(m);
  }
  const nombre = nombreCliente ?? chat.nombre ?? verTelefono(chat.id);

  return (
    <div className="wa-conversacion">
      <div className="wa-cab">
        <button className="btn btn-sm btn-fantasma btn-icono wa-volver" onClick={alVolver} aria-label="Volver"><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fila" style={{ gap: 8 }}><b className="recorte">{nombre}</b>{chat.clasificacion !== "tramites" && <Badge tono={TONO[chat.clasificacion as ClasificacionChat]}>{CLASIFICACION_CHAT_LABEL[chat.clasificacion as ClasificacionChat]}</Badge>}</div>
          <div className="peq tenue recorte">{verTelefono(chat.id)}{chat.nombre && nombreCliente ? ` · perfil "${chat.nombre}"` : ""}{chat.motivo && chat.clasificacion !== "tramites" ? ` · ${chat.motivo}` : ""}</div>
        </div>
        {chat.clienteId ? (
          <>
            <button className="btn btn-sm" onClick={() => nav(`/clientes?ficha=${chat.clienteId}`)}><Link2 size={13} />Ver cliente</button>
            <button className="btn btn-sm btn-fantasma btn-icono" title="Separar del cliente" onClick={() => unir(null)}><Unlink size={14} /></button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => setUniendo((u) => !u)}><Link2 size={13} />Unir con cliente</button>
            <button className="btn btn-sm" onClick={() => setNuevoCliente({ foto: null })}><UserPlus size={13} />Crear cliente</button>
          </>
        )}
      </div>
      {uniendo && (
        <div className="wa-unir">
          <Buscador opciones={opcionesClientes} elegido={null} elegir={(id) => id && unir(id)} placeholder="Buscar el cliente por nombre, documento o teléfono" />
        </div>
      )}
      {chat.clasificacion !== "tramites" && (
        <div className="wa-revisar">
          <span className="peq">{chat.clasificacion === "personal_propuesto" ? "La IA cree que este chat es personal." : chat.clasificacion === "dudoso" ? "La IA no está segura de qué trata este chat." : "Este chat todavía no está clasificado."}</span>
          <span className="espacio" />
          <button className="btn btn-sm" onClick={() => clasificar("tramites")}><ShieldCheck size={13} />Es de trámites</button>
          <button className="btn btn-sm btn-peligro" onClick={personal}><UserX size={13} />Es personal</button>
        </div>
      )}
      <Propuestas lista={propuestas} />
      <div className="wa-mensajes" ref={caja} onScroll={(e) => { const c = e.currentTarget; alFinal.current = c.scrollHeight - c.scrollTop - c.clientHeight < 60; }}>
        {mas && <button className="btn btn-sm wa-mas" onClick={anteriores}>Ver mensajes anteriores</button>}
        {cargando && !mensajes.length && <div className="peq tenue" style={{ textAlign: "center", padding: 24 }}>Cargando mensajes…</div>}
        {error && <div className="aviso error">{error}</div>}
        {!cargando && !error && !mensajes.length && <div className="peq tenue" style={{ textAlign: "center", padding: 24 }}>No hay mensajes guardados en este chat.</div>}
        {filas.map((f) => ("dia" in f ? <div key={`d-${f.dia}`} className="wa-dia"><span>{f.dia}</span></div> : <Mensaje key={f.id} m={f} alLeerCedula={leerCedula} />))}
      </div>
      <div className="wa-pie peq tenue">Solo lectura: responde desde el celular o WhatsApp Web.</div>
      <PanelCliente
        abierto={!!nuevoCliente}
        onCerrar={() => setNuevoCliente(null)}
        inicial={{ telefono: telefonoLocal(chat.id), nombre: chat.nombre ?? "" }}
        foto={nuevoCliente?.foto ?? null}
        alGuardar={(id) => unir(id)}
      />
    </div>
  );
}

export default function WhatsApp() {
  const { confirmar, avisar } = useUI();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const vista = (params.get("vista") as Vista) || "tramites";
  const elegido = params.get("chat");
  const datos = useLiveQuery(async () => ({
    chats: await db.wa_chats.toArray(),
    propuestas: await db.wa_propuestas.where("estado").equals("pendiente").toArray(),
    clientes: new Map((await db.clientes.toArray()).map((c) => [c.id, c.nombre])),
  }), []);
  const poner = (cambios: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(cambios)) v === null ? n.delete(k) : n.set(k, v); return n; }, { replace: true });

  const { visibles, cuenta, porChat } = useMemo(() => {
    const chats = (datos?.chats ?? []).filter((c) => c.clasificacion !== "personal");
    const porChat = new Map<string, PropuestaWhatsApp[]>();
    for (const p of datos?.propuestas ?? []) porChat.set(p.chatId, [...(porChat.get(p.chatId) ?? []), p]);
    const enVista = (c: ChatWhatsApp, v: Vista) => (v === "todos" ? true : v === "tramites" ? c.clasificacion === "tramites" : EN_REVISION.includes(c.clasificacion as ClasificacionChat));
    const n = normalizar(q);
    const visibles = chats
      .filter((c) => enVista(c, vista) && (!n || normalizar(c.nombre, c.id, telefonoLocal(c.id), c.ultimoTexto, c.clienteId ? datos?.clientes.get(c.clienteId) : "").includes(n)))
      .sort((a, b) => (porChat.has(b.id) ? 1 : 0) - (porChat.has(a.id) ? 1 : 0) || (b.ultimoMensaje ?? "").localeCompare(a.ultimoMensaje ?? ""));
    const cuenta: Partial<Record<Vista, number>> = { tramites: chats.filter((c) => enVista(c, "tramites")).length, revisar: chats.filter((c) => enVista(c, "revisar")).length, todos: chats.length };
    return { visibles, cuenta, porChat };
  }, [datos, vista, q]);

  const chat = elegido ? datos?.chats.find((c) => c.id === elegido && c.clasificacion !== "personal") : undefined;
  const personalesPropuestos = (datos?.chats ?? []).filter((c) => c.clasificacion === "personal_propuesto");

  async function confirmarPersonales() {
    const ids = personalesPropuestos.map((c) => c.id);
    if (!(await confirmar({
      titulo: `Confirmar ${ids.length} chat${ids.length === 1 ? "" : "s"} como personales`,
      texto: "Se borran de Nexum sus mensajes y archivos, y lo que llegue de esos números ya no se guarda. En el celular no cambia nada. No se puede deshacer. Si alguno es de un cliente, ábrelo antes y marca \"Es de trámites\".",
      boton: "Confirmar personales", peligro: true,
    }))) return;
    try {
      for (let i = 0; i < ids.length; i += 50) await escribir("POST", "/api/whatsapp/personales", { ids: ids.slice(i, i + 50) });
      avisar("Chats personales confirmados");
      if (elegido && ids.includes(elegido)) poner({ chat: null });
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  return (
    <>
      <Cabecera titulo="WhatsApp" sub={<Conexion />}>
        <div className="seg">
          {([["tramites", "Trámites"], ["revisar", "Por revisar"], ["todos", "Todos"]] as [Vista, string][]).map(([k, t]) => (
            <button key={k} className={vista === k ? "on" : ""} onClick={() => poner({ vista: k === "tramites" ? null : k })}>{t}{cuenta[k] !== undefined && <> <span className="cuenta">{cuenta[k]}</span></>}</button>
          ))}
        </div>
      </Cabecera>
      <div className="contenido">
        {vista === "revisar" && personalesPropuestos.length > 0 && (
          <div className="aviso" style={{ marginBottom: 12 }}>
            <UserX size={15} />La IA cree que {personalesPropuestos.length} chat{personalesPropuestos.length === 1 ? " es personal" : "s son personales"}. Revísalos y confírmalos para borrarlos de Nexum.
            <span className="espacio" />
            <button className="btn btn-sm btn-peligro" onClick={confirmarPersonales}>Confirmar {personalesPropuestos.length} como personales</button>
          </div>
        )}
        {datos && !datos.chats.length ? (
          <div className="card"><Vacio icono={MessageCircle} titulo="Todavía no hay chats">Cuando se conecte el número en Kapso, aquí aparecen los chats con sus mensajes.</Vacio></div>
        ) : (
          <div className={`wa ${chat ? "con-chat" : ""}`}>
            <div className="wa-lista">
              <div className="wa-buscar"><div className="buscar"><Search size={15} /><input className="input" placeholder="Buscar nombre, número o mensaje" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
              <div className="wa-chats">
                {visibles.map((c) => {
                  const nombre = (c.clienteId && datos?.clientes.get(c.clienteId)) || c.nombre || verTelefono(c.id);
                  const pendientes = porChat.get(c.id)?.length ?? 0;
                  return (
                    <button key={c.id} className={`wa-chat ${c.id === elegido ? "on" : ""}`} onClick={() => poner({ chat: c.id })}>
                      <div className="fila" style={{ gap: 6 }}>
                        <b className="recorte" style={{ flex: 1 }}>{nombre}</b>
                        <span className="peq tenue">{cuando(c.ultimoMensaje)}</span>
                      </div>
                      <div className="fila" style={{ gap: 6 }}>
                        <span className="peq muted recorte" style={{ flex: 1 }}>{c.ultimoTexto ?? ""}</span>
                        {c.clasificacion !== "tramites" && <Badge tono={TONO[c.clasificacion as ClasificacionChat]}>{CLASIFICACION_CHAT_LABEL[c.clasificacion as ClasificacionChat]}</Badge>}
                        {pendientes > 0 && <span className="wa-burbuja-ia" title={`${pendientes} propuesta(s) por confirmar`}><Sparkles size={11} />{pendientes}</span>}
                        {c.noLeidos > 0 && <span className="wa-no-leidos">{c.noLeidos}</span>}
                      </div>
                    </button>
                  );
                })}
                {!visibles.length && <div className="peq tenue" style={{ padding: 16, textAlign: "center" }}>{q ? "Ningún chat coincide." : vista === "revisar" ? "Nada por revisar." : "No hay chats en esta vista."}</div>}
              </div>
            </div>
            {chat ? (
              <Conversacion
                chat={chat}
                nombreCliente={chat.clienteId ? datos?.clientes.get(chat.clienteId) ?? null : null}
                propuestas={porChat.get(chat.id) ?? []}
                alVolver={() => poner({ chat: null })}
              />
            ) : (
              <div className="wa-conversacion wa-nada"><Vacio icono={MessageCircle} titulo="Elige un chat">Los mensajes se cargan al abrirlo. Las propuestas de la IA aparecen arriba de la conversación.</Vacio></div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
