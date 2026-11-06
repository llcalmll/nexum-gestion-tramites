import { useEscaneosNuevos, useFormatosNuevos } from "./componentes/PestanasFotos";
import { MenuContextualRaiz } from "./componentes/MenuContextual";
import { Noticas } from "./componentes/Noticas";
import { VersionNueva } from "./componentes/VersionNueva";
import { BarChart3, CalendarClock, Car, CarFront, Cloud, CloudOff, ChevronDown, Contact, FileInput, FilePlus2, FileScan, FileText, FolderOpen, Globe2, HelpCircle, IdCard, LayoutDashboard, Lock, LogOut, Mail, MessageCircle, MessageSquareText, Moon, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, ScanSearch, Settings, ShieldX, Sun, UserPlus, Users, WifiOff } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Asistente } from "./componentes/Asistente";
import { inicialesPersona, Menu, ProveedorUI, useUI } from "./componentes/ui";
import { ponerTema, useOscuro } from "./datos/preferencias";
import { cerrarSesion, iniciarSesion, useSesion, volverAEntrar } from "./datos/sesion";
import { sincronizarAhora, useEstadoSync } from "./datos/sincronizacion";
import Ayuda from "./pantallas/Ayuda";
import Clientes from "./pantallas/Clientes";
import Configuracion from "./pantallas/Configuracion";
import Expediente from "./pantallas/Expediente";
import Formatos from "./pantallas/Formatos";
import Inicio from "./pantallas/Inicio";
import Licencias from "./pantallas/Licencias";
import Plantillas from "./pantallas/Plantillas";
import Recordatorios from "./pantallas/Recordatorios";
import Reportes from "./pantallas/Reportes";
import Tramites from "./pantallas/Tramites";
import Vehiculos from "./pantallas/Vehiculos";
import WhatsApp from "./pantallas/WhatsApp";
import { db } from "./datos/db";

// Las fotos y los formatos cargan sus librerías solo cuando se abre la pantalla.
const Fotos = lazy(() => import("./pantallas/Fotos"));
const LlenarFormatos = lazy(() => import("./pantallas/LlenarFormatos"));
const Escaneos = lazy(() => import("./pantallas/Escaneos"));
const Envios = lazy(() => import("./pantallas/Envios"));
const Mapa = lazy(() => import("./pantallas/Mapa"));
const TomarFoto = lazy(() => import("./pantallas/TomarFoto"));
const Registrar = lazy(() => import("./pantallas/Registrar"));
const ConsultaRapida = lazy(() => import("./pantallas/ConsultaRapida"));

const PRINCIPAL = [
  { a: "/", icono: Globe2, texto: "Mapa" },
  { a: "/tramites", icono: FileText, texto: "Trámites" },
  { a: "/clientes", icono: Users, texto: "Clientes" },
  { a: "/vehiculos", icono: Car, texto: "Vehículos" },
  { a: "/licencias", icono: IdCard, texto: "Licencias" },
  { a: "/whatsapp", icono: MessageCircle, texto: "WhatsApp" },
];
/** Papelería: lo que tiene que ver con papeles (desplegable en el menú). */
const PAPELERIA = [
  { a: "/escaneos", icono: FileScan, texto: "Escáner" },
  { a: "/fotos", icono: Contact, texto: "Fotos 3x4" },
  { a: "/envios", icono: Mail, texto: "Envíos" },
  { a: "/formatos", icono: FolderOpen, texto: "Formatos" },
];
const MAS = [
  { a: "/plantillas", icono: MessageSquareText, texto: "Plantillas de mensajes" },
  { a: "/registrar", icono: FileInput, texto: "Registrar trámite" },
  { a: "/consulta-rapida", icono: ScanSearch, texto: "Consulta rápida" },
  { a: "/inicio", icono: LayoutDashboard, texto: "Resumen" },
  { a: "/reportes", icono: BarChart3, texto: "Reportes" },
  { a: "/recordatorios", icono: CalendarClock, texto: "Recordatorios" },
  { a: "/ayuda", icono: HelpCircle, texto: "Ayuda" },
  { a: "/configuracion", icono: Settings, texto: "Configuración" },
];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function leerColapsada() {
  try { return localStorage.getItem("lateral-colapsada") === "1"; } catch { return false; }
}

export default function App() {
  // El celular que toma la foto 3x4 no carga la app completa ni descarga datos (lo abre el QR del PC).
  if (/^\/fotos\/tomar(\/|$)/.test(location.pathname)) {
    return (
      <Suspense fallback={<div className="cargando"><div className="caja"><div className="giro" /></div></div>}>
        <Routes>
          <Route path="/fotos/tomar" element={<TomarFoto />} />
          <Route path="/fotos/tomar/:sesion" element={<TomarFoto />} />
        </Routes>
      </Suspense>
    );
  }
  return <AppCompleta />;
}

function AppCompleta() {
  const s = useSesion();
  useEffect(() => { iniciarSesion(); }, []);
  if (s.fase === "cargando") return <div className="cargando"><div className="caja"><div className="giro" /><span>Cargando…</span></div></div>;
  if (s.fase === "preparando") return <Preparando />;
  if (s.fase === "sin-red") {
    return (
      <Pantalla icono={WifiOff} titulo={s.mensaje ? "No se pudieron descargar los datos" : "No hay conexión con el servidor"}>
        <p className="muted">{s.mensaje ? `${s.mensaje.replace(/\.+$/, "")}. Lo descargado se conserva; al reintentar sigue desde donde quedó.` : "Este equipo todavía no tiene la copia completa de los datos. Revise el internet e intente de nuevo; lo descargado se conserva."}</p>
        <button className="btn btn-primario" onClick={() => iniciarSesion()}>Reintentar</button>
      </Pantalla>
    );
  }
  if (s.fase === "sin-acceso") {
    return (
      <Pantalla icono={ShieldX} titulo="Sin acceso">
        <p className="muted">{s.mensaje}</p>
        <button className="btn btn-primario" onClick={() => cerrarSesion()}>Entrar con otro correo</button>
      </Pantalla>
    );
  }
  return (
    <ProveedorUI>
      <Marco correo={s.correo ?? ""} />
      {s.fase === "vencida" && (
        <>
          <div className="velo" />
          <div className="modal" role="alertdialog">
            <div className="modal-cuerpo">
              <h2 className="fila" style={{ gap: 8, marginBottom: 6 }}><Lock size={18} />Su sesión venció</h2>
              <div className="muted">Para seguir, vuelva a entrar con su correo y el código que le llega. Los datos de este equipo se conservan.</div>
            </div>
            <div className="modal-pie">
              <button className="btn btn-primario" autoFocus onClick={volverAEntrar}>Volver a entrar</button>
            </div>
          </div>
        </>
      )}
    </ProveedorUI>
  );
}

function Pantalla({ icono: I, titulo, children }: { icono: typeof WifiOff; titulo: string; children: React.ReactNode }) {
  return (
    <div className="cargando">
      <div className="caja" style={{ maxWidth: 420, textAlign: "center", gap: 12 }}>
        <I size={28} />
        <b style={{ color: "var(--texto)", fontSize: 16 }}>{titulo}</b>
        {children}
      </div>
    </div>
  );
}

/** Primera descarga en este equipo: la app se muestra cuando ya están todos los datos. */
function Preparando() {
  const { avance } = useEstadoSync();
  const pct = Math.round((avance ?? 0) * 100);
  return (
    <div className="cargando">
      <div className="caja" style={{ gap: 14 }}>
        <b style={{ color: "var(--texto)", fontSize: 15 }}>Preparando tus datos</b>
        <div className="avance" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
        <span className="peq">{avance === undefined ? "Conectando…" : `${pct} %`}</span>
        <span className="peq tenue" style={{ maxWidth: 300 }}>Solo pasa la primera vez en este equipo. Después la app abre al instante.</span>
      </div>
    </div>
  );
}

/** Estado de la descarga de datos, en la barra superior. */
function IndicadorSync() {
  const s = useEstadoSync();
  const sinRed = s.estado === "sin-conexion" || s.estado === "error";
  const texto = sinRed ? s.mensaje ?? "Sin conexión" : s.estado === "recibiendo" ? "Recibiendo datos…" : s.ultima ? `Datos al día (${new Date(s.ultima).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })})` : "Datos al día";
  return (
    <button className={`top-btn ${sinRed ? "alerta" : ""}`} title={`${texto}. Clic para actualizar ahora.`} onClick={() => sincronizarAhora()}>
      {sinRed ? <CloudOff size={18} /> : s.estado === "recibiendo" ? <RefreshCw size={17} className="girando" /> : <Cloud size={18} />}
    </button>
  );
}

function Marco({ correo }: { correo: string }) {
  const { confirmar } = useUI();
  const sync = useEstadoSync();
  const oscuro = useOscuro();
  const nav = useNavigate();
  const ruta = useLocation().pathname;
  const [papeleria, setPapeleria] = useState(() => { try { return localStorage.getItem("menu-papeleria") !== "0"; } catch { return true; } });
  const alternarPapeleria = () => setPapeleria((v) => { try { localStorage.setItem("menu-papeleria", v ? "0" : "1"); } catch { /* sin almacenamiento */ } return !v; });
  const escaneosNuevos = useEscaneosNuevos(ruta.startsWith("/escaneos"));
  const formatosNuevos = useFormatosNuevos(ruta.startsWith("/formatos"));
  const papeleriaNuevos = escaneosNuevos + formatosNuevos;
  const [colapsada, setColapsada] = useState(leerColapsada);
  const alternar = () => setColapsada((c) => {
    try { localStorage.setItem("lateral-colapsada", c ? "0" : "1"); } catch { /* nada */ }
    return !c;
  });
  const hoy = new Date();
  // Lo que espera a Felipe en WhatsApp: propuestas por confirmar y chats por revisar.
  const porConfirmar = useLiveQuery(async () => (await db.wa_propuestas.where("estado").equals("pendiente").count())
    + (await db.wa_chats.where("clasificacion").anyOf("dudoso", "personal_propuesto").count()), []) ?? 0;

  return (
    <div className={`app ${colapsada ? "colapsada" : ""}`}>
      <VersionNueva />
      <MenuContextualRaiz />
      <div className="topbar">
        <div className="marca"><img className="logo-img" src="/logo.png" alt="" /><span>Nexum Tránsito</span></div>
        {/* Las noticas, a la vista en el centro de la barra (en cualquier pantalla), con su botón para verlas todas. */}
        <Noticas />
        <Menu derecha boton={(abrir) => <button className="top-btn" onClick={abrir} title="Crear"><Plus size={18} /></button>}>
          {(cerrar) => (
            <>
              <button className="menu-item" onClick={() => { nav("/tramites?nuevo=1"); cerrar(); }}><FilePlus2 size={15} />Nuevo trámite</button>
              <button className="menu-item" onClick={() => { nav("/clientes?nuevo=1"); cerrar(); }}><UserPlus size={15} />Nuevo cliente</button>
              <button className="menu-item" onClick={() => { nav("/vehiculos?nuevo=1"); cerrar(); }}><CarFront size={15} />Nuevo vehículo</button>
            </>
          )}
        </Menu>
        <div className="fecha-top">
          <b>{hoy.getDate()}</b>
          <span><small>{MESES[hoy.getMonth()]}</small><small>{hoy.toLocaleDateString("es-CO", { weekday: "long" })}</small></span>
        </div>
        <button className="top-btn" onClick={() => ponerTema(oscuro ? "claro" : "oscuro")} title={oscuro ? "Modo claro" : "Modo oscuro (para la noche)"} aria-label={oscuro ? "Modo claro" : "Modo oscuro"}>
          {oscuro ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <IndicadorSync />
        <Menu derecha boton={(abrir) => <button className="avatar-top" onClick={abrir} title={correo}>{inicialesPersona(correo.split("@")[0].replace(/\d+/g, ""))}</button>}>
          {(cerrar) => (
            <>
              <div className="titulo">{correo}</div>
              <button className="menu-item" onClick={() => { ponerTema(oscuro ? "claro" : "oscuro"); cerrar(); }}>
                {oscuro ? <Sun size={15} /> : <Moon size={15} />}{oscuro ? "Modo claro" : "Modo oscuro"}
              </button>
              <button className="menu-item" onClick={() => { nav("/configuracion"); cerrar(); }}><Settings size={15} />Configuración</button>
              <hr />
              <button className="menu-item" onClick={async () => {
                cerrar();
                if (await confirmar({ titulo: "Cerrar sesión", texto: "Se borra la copia de los datos guardada en este equipo. Al volver a entrar se descarga de nuevo.", boton: "Cerrar sesión" })) await cerrarSesion();
              }}><LogOut size={15} />Cerrar sesión</button>
            </>
          )}
        </Menu>
      </div>

      <div className="cuerpo">
        <nav className="lateral">
          <div className="seccion">Principal</div>
          {PRINCIPAL.map((m) => (
            <NavLink key={m.a} to={m.a} end={m.a === "/"} title={m.texto}>
              <m.icono size={17} /><span>{m.texto}</span>
              {m.a === "/whatsapp" && porConfirmar > 0 && <i className="insignia" title={`${porConfirmar} por confirmar`}>{porConfirmar}</i>}
            </NavLink>
          ))}
          <button className={`seccion grupo${papeleria ? " abierto" : ""}`} onClick={() => alternarPapeleria()} aria-expanded={papeleria} title="Papelería">
            <span>Papelería</span>{papeleriaNuevos > 0 && !papeleria && <i className="insignia" title={`${papeleriaNuevos} nuevo(s) del celular`}>{papeleriaNuevos}</i>}<ChevronDown size={13} />
          </button>
          {(papeleria || PAPELERIA.some((m) => ruta.startsWith(m.a))) && PAPELERIA.map((m) => (
            <NavLink key={m.a} to={m.a} title={m.texto}>
              <m.icono size={17} /><span>{m.texto}</span>
              {m.a === "/escaneos" && escaneosNuevos > 0 && <i className="insignia" title={`${escaneosNuevos} escaneo(s) nuevo(s)`}>{escaneosNuevos}</i>}
              {m.a === "/formatos" && formatosNuevos > 0 && <i className="insignia" title={`${formatosNuevos} formato(s) nuevo(s) del celular`}>{formatosNuevos}</i>}
            </NavLink>
          ))}
          <div className="seccion">Más</div>
          {MAS.map((m) => (
            <NavLink key={m.a} to={m.a} title={m.texto}>
              <m.icono size={17} /><span>{m.texto}</span>
            </NavLink>
          ))}
          <a className="colapsar" href="#" onClick={(e) => { e.preventDefault(); alternar(); }} title={colapsada ? "Expandir menú" : "Contraer menú"}>
            {colapsada ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>Contraer menú</span>
          </a>
        </nav>

        <div className="principal">
          {sync.estado === "sin-conexion" && (
            <div className="aviso" style={{ margin: "12px 24px 0" }}>
              <WifiOff size={15} /> Sin conexión. Se muestra la copia guardada en este equipo; se actualiza sola cuando vuelva el internet.
            </div>
          )}
          {sync.estado === "error" && <div className="aviso error" style={{ margin: "12px 24px 0" }}>No se pudieron actualizar los datos: {sync.mensaje}</div>}
          <Routes>
            {/* La primera pantalla es el mapa (con lo de hoy resumido arriba); el resumen completo queda en /inicio. */}
            <Route path="/" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Mapa /></Suspense>} />
            <Route path="/inicio" element={<Inicio />} />
            <Route path="/tramites" element={<Tramites />} />
            <Route path="/tramites/:id" element={<Expediente />} />
            <Route path="/mapa" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Mapa /></Suspense>} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/vehiculos" element={<Vehiculos />} />
            <Route path="/licencias" element={<Licencias />} />
            <Route path="/recordatorios" element={<Recordatorios />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/plantillas" element={<Plantillas />} />
            <Route path="/formatos" element={<Formatos />} />
            <Route path="/registrar" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Registrar /></Suspense>} />
            <Route path="/consulta-rapida" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><ConsultaRapida /></Suspense>} />
            <Route path="/escaneos" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Escaneos /></Suspense>} />
            <Route path="/formatos/llenar" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><LlenarFormatos /></Suspense>} />
            <Route path="/fotos" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Fotos /></Suspense>} />
            <Route path="/envios" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Envios /></Suspense>} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/ayuda" element={<Ayuda />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="*" element={<Suspense fallback={<div className="contenido muted">Cargando…</div>}><Mapa /></Suspense>} />
          </Routes>
        </div>
      </div>
      <Asistente />
    </div>
  );
}
