import { Bot, Camera, Car, ChevronRight, FilePlus2, FileScan, FileText, FolderOpen, IdCard, MoreVertical, ScanSearch, Share } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Asistente } from "../componentes/Asistente";
import { Registrador } from "../componentes/Registrador";
import { CabeceraMovil } from "./movil/comun";
import { BANDEJA } from "../fotos/procesar";
import { instalada } from "./movil/comun";
import { EscanearMovil } from "./movil/EscanearMovil";
import { TramitesMovil } from "./movil/TramitesMovil";
import { abrirConDatos, FormatosMovil } from "./movil/FormatosMovil";
import { Fotos3x4Movil } from "./movil/Fotos3x4Movil";
import { TramiteMovil } from "./movil/TramiteMovil";

/** Datos de la app instalable (iPhone: Safari > Compartir > Agregar a pantalla de inicio; Android: Chrome > ⋮ > Instalar app). */
function declararApp() {
  const poner = (sel: string, crear: () => HTMLElement) => document.head.querySelector(sel) ?? document.head.appendChild(crear());
  const link = (rel: string, href: string) => () => Object.assign(document.createElement("link"), { rel, href });
  const meta = (name: string, content: string) => () => Object.assign(document.createElement("meta"), { name, content });
  poner('link[rel="manifest"]', link("manifest", "/manifest-fotos.webmanifest"));
  poner('link[rel="apple-touch-icon"]', link("apple-touch-icon", "/iconos/fotos-180.png"));
  poner('meta[name="apple-mobile-web-app-title"]', meta("apple-mobile-web-app-title", "Fotos Pira"));
  poner('meta[name="apple-mobile-web-app-capable"]', meta("apple-mobile-web-app-capable", "yes"));
  poner('meta[name="mobile-web-app-capable"]', meta("mobile-web-app-capable", "yes"));
  document.title = "Fotos Pira";
}

/** Para decir cómo se instala: en Android desde el menú de Chrome; en iPhone desde Compartir de Safari. */
const esAndroid = /android/i.test(navigator.userAgent);
const esIphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

type Seccion = "inicio" | "asistente" | "consulta" | "registrar" | "nuevo" | "3x4" | "licencia" | "escanear" | "formatos" | "tramites";
/** Nuevo trámite a mano: el formulario vacío (sin cliente ni trámite puestos de antes). */
const MANUAL_VACIO = {};
const CLAVE = "movil-seccion";
const leerSeccion = (): Seccion => {
  // Desde un QR del PC: directo a esa sección (?seccion=escanear).
  const pedida = new URLSearchParams(location.search).get("seccion");
  if (pedida === "escanear" || pedida === "formatos" || pedida === "consulta" || pedida === "tramites") return pedida;
  try { const s = sessionStorage.getItem(CLAVE); return s === "asistente" || s === "consulta" || s === "registrar" || s === "nuevo" || s === "3x4" || s === "licencia" || s === "escanear" || s === "formatos" || s === "tramites" ? s : s === "vehiculo" ? "registrar" : "inicio"; } catch { return "inicio"; }
};

/**
 * App del celular "Fotos · Trámites Pira" (instalada, o abierta desde el QR del PC). No carga la app completa ni
 * descarga datos. Arriba el asistente (conversación, cotizaciones y bandeja, igual que en el PC); debajo, las fotos:
 * consulta rápida (tarjeta y cédulas -> precondiciones con el RUNT; luego guardar y/o llenar formularios),
 * fotos 3x4 (van a la fila del PC), nuevo trámite escrito a mano (el formulario del PC), trámite de vehículo (Registrador) y licencia (las
 * fotos de los documentos se leen solas y el trámite queda creado) y escanear documentos (PDF para el PC o para
 * compartir). El QR de una sesión (/fotos/tomar/:sesion) abre directo las fotos 3x4.
 */
export default function TomarFoto() {
  const { sesion } = useParams();
  useEffect(declararApp, []);
  const [seccion, setSeccion] = useState<Seccion>(() => (sesion ? "3x4" : leerSeccion()));
  useEffect(() => { try { sessionStorage.setItem(CLAVE, seccion); } catch { /* sin almacenamiento */ } }, [seccion]);
  const inicio = () => setSeccion("inicio");
  // Las secciones ya abiertas se quedan vivas (solo se ocultan): al volver a una, todo sigue como se dejó (las fotos
  // tomadas, lo escrito, lo escaneado), aunque no se haya mandado al PC.
  const [abiertas, setAbiertas] = useState<Seccion[]>(() => [seccion]);
  useEffect(() => { setAbiertas((a) => (a.includes(seccion) ? a : [...a, seccion])); }, [seccion]);
  /** Formatos se vuelve a abrir de cero cuando la consulta rápida le pasa datos nuevos. */
  const [vezFormatos, setVezFormatos] = useState(0);
  const vista = (s: Seccion, contenido: ReactNode) => (abiertas.includes(s) || seccion === s) && <div key={`${s}-${s === "formatos" ? vezFormatos : 0}`} className="seccion-movil" hidden={seccion !== s}>{contenido}</div>;

  return (
    <>
    {vista("asistente", <Asistente movil volver={inicio} />)}
    <div className="tomar-foto" hidden={seccion === "asistente"}>
      {vista("3x4", <Fotos3x4Movil sesion={sesion ?? BANDEJA} volver={sesion ? undefined : inicio} />)}
      {vista("licencia", <TramiteMovil volver={inicio} />)}
      {vista("escanear", <EscanearMovil volver={inicio} />)}
      {vista("tramites", <TramitesMovil volver={inicio} />)}
      {vista("formatos", <FormatosMovil volver={inicio} />)}
      {vista("registrar", <><CabeceraMovil titulo="Trámite de vehículo" volver={inicio} /><Registrador movil /></>)}
      {vista("nuevo", <><CabeceraMovil titulo="Nuevo trámite" volver={inicio} /><Registrador movil manual={MANUAL_VACIO} cancelar={inicio} /></>)}
      {vista("consulta", <><CabeceraMovil titulo="Consulta rápida" volver={inicio} /><Registrador movil consulta llenarFormatos={(f) => { abrirConDatos(f.datos); setVezFormatos((n) => n + 1); setSeccion("formatos"); }} /></>)}
      {seccion !== "inicio" ? null
        : (
          <>
            <div className="movil-bienvenida">
              <img className="logo-img" src="/logo.png" alt="" />
              <b>Fotos · Trámites Pira</b>
              <span className="muted">Bienvenido. ¿Qué desea hacer?</span>
            </div>
            {!instalada() && (esAndroid
              ? <div className="aviso info"><MoreVertical size={16} /><span>Para tenerla como app: en Chrome toque el menú <b>⋮</b> (arriba a la derecha) y luego <b>Instalar app</b> (en algunos teléfonos dice <b>Agregar a la pantalla principal</b>).</span></div>
              : esIphone && <div className="aviso info"><Share size={16} /><span>Para tenerla como app: toque <b>Compartir</b> en Safari, luego <b>Agregar a pantalla de inicio</b>, con <b>Abrir como app web</b> activado.</span></div>)}
            <button className="movil-menu destacado" onClick={() => setSeccion("asistente")}>
              <Bot size={26} /><span><b>Asistente</b><small>Pregúntele, háblele o cotice con fotos de tarjetas de propiedad</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("tramites")}>
              <FolderOpen size={26} /><span><b>Trámites y licencias</b><small>Buscar por placa o cliente; ver las personas, los documentos y las notas; pegarle un documento con la cámara</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("consulta")}>
              <ScanSearch size={26} /><span><b>Consulta rápida</b><small>Tarjeta y cédulas (fotos o fotocopias): revisa las precondiciones con el RUNT; luego, si quiere, guarda el trámite o llena los formularios</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <div className="movil-grupo">Fotos y documentos</div>
            <button className="movil-menu" onClick={() => setSeccion("3x4")}>
              <Camera size={26} /><span><b>Fotos 3x4</b><small>Foto con fondo blanco; se imprime en el PC</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("nuevo")}>
              <FilePlus2 size={26} /><span><b>Nuevo trámite</b><small>Escribir los datos (vehículo, vendedor, comprador, cobro) o elegir clientes ya guardados; sin fotos</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("registrar")}>
              <Car size={26} /><span><b>Trámite de vehículo</b><small>Fotos de la tarjeta y las cédulas (y si ya está digitado, del formulario y el sobre): se lee todo y usted confirma</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("licencia")}>
              <IdCard size={26} /><span><b>Licencia de conducción</b><small>Primera vez, renovación y demás: foto de la cédula</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("formatos")}>
              <FileText size={26} /><span><b>Formatos</b><small>Fotos de la tarjeta y las cédulas: formulario único y contratos llenos, para imprimir en el PC</small></span><ChevronRight size={18} className="tenue" />
            </button>
            <button className="movil-menu" onClick={() => setSeccion("escanear")}>
              <FileScan size={26} /><span><b>Escanear documentos</b><small>Hojas o cédulas, derechas y limpias, en PDF para el PC o para compartir</small></span><ChevronRight size={18} className="tenue" />
            </button>
          </>
        )}
    </div>
    </>
  );
}
