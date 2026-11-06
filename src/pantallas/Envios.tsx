import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Check, ChevronDown, Copy, History, Mail, MapPin, NotebookPen, Pencil, Printer, Search, Truck, Undo2, UserPlus } from "lucide-react";
import { sumarDiasHabiles } from "../../compartido/reglas";
import { useOpcionesTramites } from "../logica/opcionesTramites";
import type { Envio } from "../../compartido/tipos";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { codigoTramite, normalizar } from "../../compartido/dominio";
import { Copiar, copiarTexto } from "../componentes/Copiar";
import { Buscador, Campo, ErrorFormulario, Texto } from "../componentes/formulario";
import { Registrador } from "../componentes/Registrador";
import { sincronizarAhora } from "../datos/sincronizacion";
import { db } from "../datos/db";
import { fecha, hoyISO } from "../logica/formato";
import { TablaDatos } from "../componentes/TablaDatos";
import { Cabecera, Panel, useUI, Vacio } from "../componentes/ui";
import { escribir, mensajeDe } from "../datos/escribir";
import { useParametros } from "../datos/hooks";
import { imprimirPdf } from "../logica/imprimir";
import { rotuloPdf } from "../logica/rotuloPdf";

/** Los datos de quien envía o recibe un sobre (los de la guía de la transportadora). */
export interface DatosEnvio { nombre: string; documento: string; telefono: string; direccion: string; ciudad: string }
/** `cubre`: dónde radica (municipios o departamentos enteros, separados por coma); vacío, la ciudad del sobre. */
/** `notaEnSobre`: la nota sale en el sobre, debajo del destinatario ("déjelo debajo de la puerta"); si no, es solo para la oficina. */
interface Tramitador extends DatosEnvio { id: string; notas: string; cubre?: string; notaEnSobre?: boolean }

const VACIO: DatosEnvio = { nombre: "", documento: "", telefono: "", direccion: "", ciudad: "" };
const CAMPOS: [keyof DatosEnvio, string][] = [["nombre", "Nombre"], ["documento", "C.C."], ["telefono", "Teléfono"], ["direccion", "Dirección"], ["ciudad", "Ciudad"]];

function leer<T>(texto: string | undefined, porDefecto: T): T {
  try { return texto ? (JSON.parse(texto) as T) : porDefecto; } catch { return porDefecto; }
}
/** La ciudad del sobre sin el departamento ("Funza, Cundinamarca" es Funza). */
const ciudadSobre = (t: DatosEnvio) => t.ciudad.split(",")[0].trim();
/** Los lugares donde se busca a un tramitador: la ciudad del sobre y lo que cubre. */
const lugaresDe = (t: Tramitador) => [ciudadSobre(t), ...(t.cubre ?? "").split(/[,;\n]/).map((x) => x.trim())].filter(Boolean);
const limpio = <T extends DatosEnvio>(d: T): T => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as T;

/** El rótulo: arriba quien envía, abajo quien recibe (más grande). Media carta, para recortar y pegar en el sobre. */
/**
 * Los dos formatos: el sobre de manila grande (media carta, para recortar) y el sobrecito de manila pequeño (el "sobre
 * de pago" donde se meten billetes, ~9 x 16,5 cm): un rótulo de 9 x 16 cm en la esquina de la hoja, con la misma letra
 * para quien envía y quien recibe.
 */
type Formato = "grande" | "pequeno";
const FORMATOS: [Formato, string, string][] = [["grande", "Sobre grande", "Hoja carta: el rótulo en la mitad de arriba, para recortar"], ["pequeno", "Sobre pequeño", "Rótulo de 9 × 16 cm (el sobre de pago), en la esquina de la hoja, para recortar y pegar"]];
function leerFormato(): Formato { try { return localStorage.getItem("envio-formato") === "pequeno" ? "pequeno" : "grande"; } catch { return "grande"; } }

/** Las medidas del rótulo del sobre pequeño (ajustables): ancho y alto en mm, y la letra (1 = normal). */
interface Medidas { ancho: number; alto: number; letra: number }
const SOBRE_DE_PAGO: Medidas = { ancho: 90, alto: 160, letra: 1 };
const LIMITES = { ancho: [50, 200], alto: [40, 260], letra: [0.6, 1.6] } as const;
const acotar = (m: Medidas): Medidas => ({
  ancho: Math.round(Math.min(LIMITES.ancho[1], Math.max(LIMITES.ancho[0], m.ancho)) * 2) / 2,
  alto: Math.round(Math.min(LIMITES.alto[1], Math.max(LIMITES.alto[0], m.alto)) * 2) / 2,
  letra: Math.round(Math.min(LIMITES.letra[1], Math.max(LIMITES.letra[0], m.letra)) * 100) / 100,
});
/** La vista de la hoja va al 55 %: un píxel de pantalla son 1 / (0,55 · 3,78) mm. */
const MM_POR_PX = 1 / (0.55 * (96 / 25.4));

function Rotulo({ remite, recibe, nota, formato = "grande", medidas, ajustar }: { remite: DatosEnvio; recibe: DatosEnvio | null; nota?: string; formato?: Formato; medidas?: Medidas; ajustar?: (m: Medidas, fin?: boolean) => void }) {
  const parte = (titulo: string, d: DatosEnvio | null, clase: string, conNota?: string) => (
    <section className={`rotulo-parte ${clase}`}>
      <h3>{titulo}</h3>
      {CAMPOS.map(([k, etq]) => (
        <div key={k} className={`rotulo-linea rotulo-${k}`}><span>{etq}:</span><b>{d?.[k] || ""}</b></div>
      ))}
      {conNota && <div className="rotulo-linea rotulo-nota"><span>Nota:</span><b>{conNota}</b></div>}
    </section>
  );
  return (
    <div className={`rotulo${formato === "pequeno" ? " pequeno" : ""}`}
      style={formato === "pequeno" && medidas ? ({ "--ancho": `${medidas.ancho}mm`, "--alto": `${medidas.alto}mm`, "--letra": medidas.letra } as React.CSSProperties) : undefined}>
      {formato === "pequeno" && medidas && ajustar && (
        // La esquina para estirar o encoger el rótulo con el mouse (solo en la vista, no se imprime).
        <div className="rotulo-asa" role="slider" aria-label="Arrastrar para cambiar el tamaño" aria-valuetext={`${medidas.ancho / 10} x ${medidas.alto / 10} cm`} title="Arrastre para cambiar el tamaño"
          onPointerDown={(e) => {
            e.preventDefault();
            const x0 = e.clientX, y0 = e.clientY, m0 = medidas, el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const mover = (ev: PointerEvent) => ajustar(acotar({ ...m0, ancho: m0.ancho + (ev.clientX - x0) * MM_POR_PX, alto: m0.alto + (ev.clientY - y0) * MM_POR_PX }));
            const soltar = (ev: PointerEvent) => { el.removeEventListener("pointermove", mover); el.removeEventListener("pointerup", soltar); ajustar(acotar({ ...m0, ancho: m0.ancho + (ev.clientX - x0) * MM_POR_PX, alto: m0.alto + (ev.clientY - y0) * MM_POR_PX }), true); };
            el.addEventListener("pointermove", mover);
            el.addEventListener("pointerup", soltar);
          }} />
      )}
      {parte("Remitente", remite, "rotulo-remite")}
      {parte("Destinatario", recibe, "rotulo-recibe", nota)}
    </div>
  );
}

function FormularioDatos({ datos, cambiar, autoFocus }: { datos: DatosEnvio; cambiar: (d: DatosEnvio) => void; autoFocus?: boolean }) {
  return (
    <>
      {CAMPOS.map(([k, etq], i) => (
        <Campo key={k} etiqueta={k === "documento" ? "Cédula" : etq} obligatorio={k === "nombre" || k === "ciudad"} ayuda={k === "ciudad" ? "Con el departamento si hace falta: Chaparral, Tolima" : undefined}>
          <Texto valor={datos[k]} cambiar={(v) => cambiar({ ...datos, [k]: v })} autoFocus={autoFocus && i === 0} tipo={k === "telefono" ? "tel" : undefined} />
        </Campo>
      ))}
    </>
  );
}

/**
 * Envíos: el rótulo del sobre de manila para mandar un trámite a otra ciudad. Quien envía es la oficina (sus datos
 * quedan guardados; se pueden cambiar solo para un envío); quien recibe es el tramitador que se elija por ciudad.
 */
export default function Envios() {
  const { avisar, confirmar } = useUI();
  const params = useParametros();
  const remitenteFijo = useMemo(() => ({ ...VACIO, ...leer<Partial<DatosEnvio>>(params.envio_remitente, {}) }), [params.envio_remitente]);
  const direccionFija = [remitenteFijo.direccion, remitenteFijo.ciudad].filter(Boolean).join(", ");
  const datosFijos = [remitenteFijo.nombre, remitenteFijo.documento && `C.C. ${remitenteFijo.documento}`, remitenteFijo.telefono && `Tel. ${remitenteFijo.telefono}`, direccionFija].filter(Boolean).join("\n");
  const tramitadores = useMemo(() => leer<Tramitador[]>(params.envio_tramitadores, []), [params.envio_tramitadores]);

  const [remitenteEnvio, setRemitenteEnvio] = useState<DatosEnvio | null>(null);
  const [ciudad, setCiudad] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  const [otro, setOtro] = useState<DatosEnvio | null>(null);
  const [editando, setEditando] = useState<{ tipo: "tramitador"; datos: Tramitador } | { tipo: "remitente"; datos: DatosEnvio } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [formato, setFormato] = useState<Formato>(leerFormato);
  // El sobre: de entrada se sigue (en "Sobres en camino", hasta que llegue); se puede desmarcar (una tarjeta para un
  // cliente no deja rastro). Con trámite se sigue siempre y se anota en su bitácora. En el mapa, solo si se pide. El
  // trámite se busca por placa, número o cliente; si no existe, se crea ahí mismo con sus documentos.
  const [seguir, setSeguir] = useState(true);
  // Corregir un sobre ya registrado (otra dirección...) y reimprimirlo: se carga arriba y al imprimir se actualiza el mismo.
  const [corrigiendo, setCorrigiendo] = useState<Envio | null>(null);
  const [enMapa, setEnMapa] = useState(false);
  const [tramiteSobre, setTramiteSobre] = useState<string | null>(null);
  const [crearTramite, setCrearTramite] = useState<string | null>(null);
  const [guia, setGuia] = useState("");
  // Las opciones del sobre van en un desplegable (cerrado: se ve en una línea lo elegido).
  const [opciones, setOpciones] = useState(false);
  const navegar = useNavigate();
  const seSigue = !!tramiteSobre || seguir;
  const enCamino = useLiveQuery(() => db.envios.where("estado").equals("enviado").toArray().then((l) => l.sort((a, b) => a.fechaEnvio.localeCompare(b.fechaEnvio))), []) ?? [];
  const tramites = useLiveQuery(() => db.tramites.toArray(), []);
  const organismos = useLiveQuery(() => db.organismos.toArray(), []);
  const placas = useLiveQuery(async () => new Map((await db.vehiculos.toArray()).map((v) => [v.id, v.placa])), []);
  // El buscador de trámites y licencias de toda la app (la placa, o el nombre en licencias, en negrilla): los abiertos.
  const opcionesTramite = useOpcionesTramites({ soloAbiertos: true }) ?? [];
  const tramiteElegido = tramiteSobre ? tramites?.find((x) => x.id === tramiteSobre) : undefined;
  const resumenOpciones = [
    tramiteElegido ? codigoTramite(tramiteElegido) : tramiteSobre ? "Con trámite" : "Sin trámite",
    guia.trim() && `guía ${guia.trim()}`,
    seSigue ? "se sigue" : "solo se imprime",
    seSigue && enMapa && "en el mapa",
  ].filter(Boolean).join(" · ");
  /** Un trámite recién creado desde aquí: se trae a la copia local y queda elegido. */
  async function alCrearTramite(ids: string[]) {
    setCrearTramite(null);
    try { await sincronizarAhora(); } catch { /* lo trae la próxima sincronización */ }
    if (ids[0]) setTramiteSobre(ids[0]);
  }
  /** Registra el sobre (en camino; con su trámite, anotado en la bitácora) y deja todo listo para el siguiente. */
  /** Deja todo listo para el siguiente sobre. */
  function limpiarSobre() { setTramiteSobre(null); setGuia(""); setEnMapa(false); setSeguir(true); setCorrigiendo(null); }
  async function registrarSobre() {
    if (!recibe) return;
    const datos = { destinatario: recibe.nombre, ciudad: recibe.ciudad, direccion: recibe.direccion || null, telefono: recibe.telefono || null, tramiteId: tramiteSobre, guia: guia || null, formato, enMapa };
    try {
      if (corrigiendo) {
        await escribir("PATCH", `/api/envios/${corrigiendo.id}`, datos);
        avisar("Sobre actualizado (el mismo, no otro)");
        setOtro(null);
      } else {
        await escribir("POST", "/api/envios", datos);
        const t = tramiteSobre ? tramites?.find((x) => x.id === tramiteSobre) : undefined;
        avisar(t ? `Sobre registrado y anotado en la bitácora de ${codigoTramite(t)}` : "Sobre registrado: queda en camino hasta que llegue");
      }
      limpiarSobre();
    } catch (e) { avisar(`${corrigiendo ? "No se actualizó" : "No se registró"} el sobre: ${mensajeDe(e)}`, "error"); }
  }
  /** "Corregir o reimprimir" un sobre de la lista: sus datos arriba (destinatario, dirección, trámite, guía...). */
  function corregir(e: Envio) {
    const t = tramitadores.find((x) => normalizar(x.nombre) === normalizar(e.destinatario));
    setOtro({ ...VACIO, nombre: e.destinatario, documento: t?.documento ?? "", telefono: e.telefono ?? "", direccion: e.direccion ?? "", ciudad: e.ciudad });
    setFormato(e.formato === "pequeno" ? "pequeno" : "grande");
    setTramiteSobre(e.tramiteId ?? null); setGuia(e.guia ?? ""); setEnMapa(!!e.enMapa); setSeguir(true);
    setCorrigiendo(e);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelarCorreccion() { setOtro(null); limpiarSobre(); }
  async function imprimirRotulo() {
    if (seSigue || corrigiendo) await registrarSobre();
    // Se imprime el PDF del rótulo (sin el encabezado que el navegador le pone a una página).
    try { imprimirPdf(await rotuloPdf(remite, recibe, formato, medidas, notaSobre)); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  // El historial de sobres (los que ya llegaron o se devolvieron): un desplegable cerrado; solo se leen al abrirlo.
  const [historial, setHistorial] = useState(false);
  const [buscaHist, setBuscaHist] = useState("");
  const nHistorial = useLiveQuery(() => db.envios.filter((e) => e.estado !== "enviado").count(), []) ?? 0;
  const historico = useLiveQuery(async () => (historial ? (await db.envios.filter((e) => e.estado !== "enviado").toArray()).sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio)) : []), [historial]) ?? [];
  const historicoVisto = useMemo(() => {
    const ps = normalizar(buscaHist).split(/\s+/).filter(Boolean);
    if (!ps.length) return historico;
    return historico.filter((e) => {
      const t = e.tramiteId ? tramites?.find((x) => x.id === e.tramiteId) : undefined;
      const placa = t?.vehiculoId ? placas?.get(t.vehiculoId) ?? "" : "";
      const texto = normalizar(`${e.destinatario} ${e.ciudad} ${e.guia ?? ""} ${t ? codigoTramite(t) : ""} ${placa}`);
      return ps.every((x) => texto.includes(x));
    });
  }, [historico, buscaHist, tramites, placas]);
  /** Un sobre marcado como llegado (o devuelto) por error vuelve a "en camino". */
  async function volverACamino(id: string) {
    try { await escribir("PATCH", `/api/envios/${id}`, { estado: "enviado" }); avisar("El sobre vuelve a estar en camino"); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  // Los sobres que ya tienen su nota de "ya debería haber llegado" en la bitácora (por su referencia).
  const anotados = useLiveQuery(async () => new Set((await db.bitacora.filter((b) => !!b.referencia?.startsWith("envio:")).toArray()).map((b) => b.referencia!.slice(6))), []) ?? new Set<string>();
  /** Opcional: deja en la bitácora del trámite que el sobre ya debería haber llegado (no cambia el sobre). */
  async function anotarDemora(e: { id: string; tramiteId?: string | null; destinatario: string; ciudad: string; fechaEnvio: string }) {
    if (!e.tramiteId) return;
    try {
      await escribir("POST", `/api/tramites/${e.tramiteId}/notas`, { texto: `El sobre a ${e.destinatario} (${e.ciudad}) ya debería haber llegado: salió el ${fecha(e.fechaEnvio)} y tarda ${DIAS_ENVIO} días hábiles`, referencia: `envio:${e.id}` });
      avisar("Anotado en la bitácora del trámite");
    } catch (err) { avisar(mensajeDe(err), "error"); }
  }
  async function marcarEnvio(id: string, estado: "recibido" | "devuelto") {
    try { await escribir("PATCH", `/api/envios/${id}`, { estado }); avisar(estado === "recibido" ? "Sobre recibido" : "Sobre marcado como devuelto"); } catch (e) { avisar(mensajeDe(e), "error"); }
  }
  // Medidas del sobre pequeño: las guardadas (para todos los equipos) o las del sobre de pago; mientras se ajustan, las
  // de la pantalla, y se guardan al soltar o un momento después de escribirlas.
  const guardadas = useMemo(() => { const m = leer<Partial<Medidas> | null>(params.envio_sobre_pequeno, null); return m ? acotar({ ...SOBRE_DE_PAGO, ...m }) : SOBRE_DE_PAGO; }, [params.envio_sobre_pequeno]);
  const [medidasEdit, setMedidasEdit] = useState<Medidas | null>(null);
  const medidas = medidasEdit ?? guardadas;
  const tGuardar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ajustar = (m: Medidas, ya = false) => {
    setMedidasEdit(m);
    if (tGuardar.current) clearTimeout(tGuardar.current);
    tGuardar.current = setTimeout(async () => {
      try { await escribir("PUT", "/api/config/parametros/envio_sobre_pequeno", { valor: JSON.stringify(m) }); } catch (e) { avisar(mensajeDe(e), "error"); }
    }, ya ? 0 : 700);
  };

  // Las ciudades (y departamentos) con tramitador, cada una una vez (sin importar tildes ni mayúsculas): donde recibe
  // los sobres y donde dice que radica.
  const ciudades = useMemo(() => {
    const m = new Map<string, string>();
    // Primero las ciudades de los sobres (con su departamento: "Espinal, Tolima"), luego lo que cubren.
    for (const t of tramitadores) if (ciudadSobre(t) && !m.has(normalizar(ciudadSobre(t)))) m.set(normalizar(ciudadSobre(t)), t.ciudad.trim());
    for (const t of tramitadores) for (const l of lugaresDe(t)) if (!m.has(normalizar(l))) m.set(normalizar(l), l);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [tramitadores]);
  const deLaCiudad = useMemo(() => tramitadores.filter((t) => lugaresDe(t).some((l) => normalizar(l) === ciudad)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [tramitadores, ciudad]);

  const remite = remitenteEnvio ?? remitenteFijo;
  // Con un solo tramitador en la ciudad, queda elegido.
  const elegidoYa = elegido ?? (deLaCiudad.length === 1 ? deLaCiudad[0].id : null);
  const recibe = otro ?? deLaCiudad.find((t) => t.id === elegidoYa) ?? null;
  // El tramitador del sobre (también al corregir uno de la lista, por su nombre) y su nota, si va en el sobre.
  const tramitadorSobre = recibe ? ("id" in recibe ? (recibe as Tramitador) : tramitadores.find((x) => normalizar(x.nombre) === normalizar(recibe.nombre))) ?? null : null;
  // Lo marcado en la casilla se ve al instante (mientras se guarda); si no se pudo guardar, vuelve como estaba.
  const [notaMarcada, setNotaMarcada] = useState<Record<string, boolean>>({});
  const conNota = !!tramitadorSobre && (notaMarcada[tramitadorSobre.id] ?? !!tramitadorSobre.notaEnSobre);
  const notaSobre = conNota && tramitadorSobre?.notas?.trim() ? tramitadorSobre.notas.trim() : "";
  /** Prende o apaga que la nota del tramitador salga en el sobre (queda guardado para los próximos). */
  async function notaEnSobre(t: Tramitador, si: boolean) {
    setNotaMarcada((m) => ({ ...m, [t.id]: si }));
    try {
      await escribir("PUT", "/api/config/parametros/envio_tramitadores", { valor: JSON.stringify(tramitadores.map((x) => (x.id === t.id ? { ...x, notaEnSobre: si } : x))) });
      avisar(si ? "La nota sale en el sobre" : "La nota ya no sale en el sobre");
    } catch (e) {
      setNotaMarcada((m) => ({ ...m, [t.id]: !si }));
      avisar(mensajeDe(e), "error");
    }
  }
  // Desde un trámite ("Enviar a Neiva", en su menú o su expediente): llega con el trámite elegido y, si hay tramitador
  // en la ciudad de su organismo, con la ciudad (y el tramitador, si es uno solo).
  const [busqueda, setBusqueda] = useSearchParams();
  const desdeTramite = busqueda.get("tramite");
  const [sinTramitador, setSinTramitador] = useState<string | null>(null);
  useEffect(() => {
    if (!desdeTramite || !tramites || !organismos) return;
    const t = tramites.find((x) => x.id === desdeTramite);
    setBusqueda(new URLSearchParams(), { replace: true });
    if (!t) return;
    setTramiteSobre(t.id);
    setOpciones(true);
    const org = organismos.find((o) => o.id === t.organismoId);
    const k = claveCiudad(org, ciudades);
    if (k) { setCiudad(k); setElegido(null); setOtro(null); setSinTramitador(null); }
    else setSinTramitador(org?.ciudad ?? null);
  }, [desdeTramite, tramites, organismos, ciudades, setBusqueda]);
  const faltaRemitente = !remitenteFijo.nombre.trim();

  async function guardar() {
    if (!editando) return;
    const d = limpio(editando.datos);
    if (!d.nombre) return setError("Escriba el nombre.");
    if (editando.tipo === "tramitador" && !d.ciudad) return setError("Escriba la ciudad: con ella se busca al tramitador.");
    setOcupado(true); setError(null);
    try {
      if (editando.tipo === "remitente") {
        await escribir("PUT", "/api/config/parametros/envio_remitente", { valor: JSON.stringify(d) });
      } else {
        const t = d as Tramitador;
        const lista = tramitadores.some((x) => x.id === t.id) ? tramitadores.map((x) => (x.id === t.id ? t : x)) : [...tramitadores, t];
        await escribir("PUT", "/api/config/parametros/envio_tramitadores", { valor: JSON.stringify(lista) });
        setCiudad(normalizar(ciudadSobre(t))); setElegido(t.id); setOtro(null);
        // Lo guardado en el editor manda sobre lo marcado antes en la casilla de la vista.
        setNotaMarcada((m) => { const n = { ...m }; delete n[t.id]; return n; });
      }
      avisar("Guardado");
      setEditando(null);
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(false); }
  }

  async function borrar(t: Tramitador) {
    if (!(await confirmar({ titulo: "Borrar tramitador", texto: `Se borra a ${t.nombre} (${t.ciudad}) de la lista.`, boton: "Borrar", peligro: true }))) return;
    try {
      await escribir("PUT", "/api/config/parametros/envio_tramitadores", { valor: JSON.stringify(tramitadores.filter((x) => x.id !== t.id)) });
      if (elegido === t.id) setElegido(null);
      setEditando(null);
      avisar("Tramitador borrado");
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  const nuevoTramitador = () => { setError(null); setEditando({ tipo: "tramitador", datos: { ...VACIO, id: crypto.randomUUID(), notas: "", cubre: "", ciudad: ciudades.find(([k]) => k === ciudad)?.[1] ?? "" } }); };

  return (
    <>
      <Cabecera titulo="Envíos" sub="El rótulo del sobre para mandar un trámite a otra ciudad">
        <button className="btn btn-primario" disabled={!recibe || faltaRemitente} onClick={imprimirRotulo}
          title={faltaRemitente ? "Primero los datos de quien envía" : !recibe ? "Elija a quién se envía" : seSigue ? "Imprime el rótulo y registra el sobre" : "Solo imprime el rótulo (no registra nada)"}>
          <Printer size={15} />{corrigiendo ? "Actualizar e imprimir" : seSigue ? "Imprimir y registrar" : "Imprimir rótulo"}</button>
      </Cabecera>
      <div className="contenido">
        {corrigiendo && (
          <div className="aviso info envio-corrigiendo">
            <Pencil size={15} />
            <span>Corrigiendo el sobre a <b>{corrigiendo.destinatario}</b> ({corrigiendo.ciudad}), que salió el {fecha(corrigiendo.fechaEnvio)}. Cambie lo que haga falta (la dirección, el teléfono...) y toque <b>«Actualizar e imprimir»</b>: se actualiza ese mismo sobre, no se crea otro.</span>
            <button className="btn btn-sm" onClick={cancelarCorreccion}>Cancelar</button>
          </div>
        )}
        <div className="envio-rejilla">
          <div className="pila" style={{ gap: 14 }}>
            <div className="card">
              <div className="card-cab">
                <b>Envía</b>
                {!remitenteEnvio && <button className="btn btn-sm" onClick={() => { setError(null); setEditando({ tipo: "remitente", datos: remitenteFijo }); }}><Pencil size={13} />{faltaRemitente ? "Escribir los datos" : "Editar los de siempre"}</button>}
              </div>
              <div className="card-cuerpo pila" style={{ gap: 8 }}>
                {faltaRemitente && <div className="aviso info">Escriba una vez los datos de la oficina: quedan guardados para todos los envíos.</div>}
                {!faltaRemitente && !remitenteEnvio && (
                  <>
                    {/* La dirección de la oficina se pide mucho: se copia sola o con todos los datos. */}
                    <div className="envio-datos"><b>{remitenteFijo.nombre}</b><span>{[remitenteFijo.documento && `C.C. ${remitenteFijo.documento}`, remitenteFijo.telefono && `Tel. ${remitenteFijo.telefono}`].filter(Boolean).join(" · ")}</span><span className="envio-direccion">{direccionFija}<Copiar valor={direccionFija} que="la dirección" /></span></div>
                    <span className="fila-wrap" style={{ gap: 6 }}>
                      <button className="btn btn-sm" onClick={async () => { if (await copiarTexto(datosFijos)) avisar("Datos copiados: nombre, cédula, teléfono y dirección"); }}><Copy size={13} />Copiar todos los datos</button>
                      <button className="btn btn-sm btn-fantasma" onClick={() => setRemitenteEnvio({ ...remitenteFijo })}>Cambiar solo para este envío</button>
                    </span>
                  </>
                )}
                {remitenteEnvio && (
                  <>
                    <FormularioDatos datos={remitenteEnvio} cambiar={setRemitenteEnvio} />
                    <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setRemitenteEnvio(null)}>Volver a los de siempre</button>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-cab"><b>Recibe</b></div>
              <div className="card-cuerpo pila" style={{ gap: 10 }}>
                {sinTramitador && !otro && (
                  <div className="aviso info fila-wrap" style={{ gap: 8 }}>
                    <span>No hay tramitador en <b>{sinTramitador}</b> todavía.</span>
                    <button className="btn btn-sm" onClick={() => { setError(null); setEditando({ tipo: "tramitador", datos: { ...VACIO, id: crypto.randomUUID(), notas: "", cubre: "", ciudad: sinTramitador } }); }}><UserPlus size={13} />Agregarlo</button>
                    <button className="btn btn-sm btn-fantasma" onClick={() => { setSinTramitador(null); setOtro({ ...VACIO, ciudad: sinTramitador }); }}>Escribir a quién va</button>
                  </div>
                )}
                {!otro && (
                  <>
                    <Campo etiqueta="Ciudad">
                      <select className="input" aria-label="Ciudad" value={ciudad} onChange={(e) => { setCiudad(e.target.value); setElegido(null); }}>
                        <option value="">{ciudades.length ? "Elegir la ciudad…" : "Todavía no hay tramitadores"}</option>
                        {ciudades.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                      </select>
                    </Campo>
                    {ciudad && (
                      <div className="envio-opciones" role="radiogroup" aria-label="Tramitador">
                        {deLaCiudad.map((t) => (
                          <button key={t.id} role="radio" aria-checked={elegidoYa === t.id} className={`envio-opcion${elegidoYa === t.id ? " on" : ""}`} onClick={() => setElegido(t.id)}>
                            <b>{t.nombre}</b>
                            <small>{[t.telefono, t.direccion, normalizar(ciudadSobre(t)) !== ciudad && ciudadSobre(t)].filter(Boolean).join(" · ") || "Sin teléfono ni dirección"}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    <button className="btn btn-sm btn-fantasma" style={{ alignSelf: "flex-start" }} onClick={() => setOtro({ ...VACIO })}>Enviar a otra persona (escribir los datos)</button>
                  </>
                )}
                {otro && (
                  <>
                    <FormularioDatos datos={otro} cambiar={setOtro} autoFocus />
                    <div className="fila" style={{ gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => { setError(null); setEditando({ tipo: "tramitador", datos: { ...limpio(otro), id: crypto.randomUUID(), notas: "", cubre: "" } }); }}><UserPlus size={13} />Guardar como tramitador</button>
                      <button className="btn btn-sm btn-fantasma" onClick={() => setOtro(null)}>Elegir un tramitador</button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className={`card envio-sobre${opciones ? " abierta" : ""}`}>
              <button type="button" className="card-cab envio-opciones-cab" aria-expanded={opciones} onClick={() => setOpciones((x) => !x)}>
                <span><b>Opciones del sobre</b><small>{resumenOpciones}</small></span>
                <ChevronDown size={16} />
              </button>
              {opciones && (
              <div className="card-cuerpo pila" style={{ gap: 12 }}>
                <Campo etiqueta="Trámite" ayuda={tramiteSobre ? "Con trámite, el sobre se sigue hasta que llegue y queda anotado en su bitácora." : "Por placa, número o cliente. Si no existe, «Crear trámite nuevo» lo registra con la tarjeta y las cédulas."}>
                  <Buscador opciones={opcionesTramite} elegido={tramiteSobre} elegir={setTramiteSobre} placeholder="Placa, número del trámite o cliente (también licencias)"
                    crear={{ texto: "Crear trámite nuevo", accion: (escrito) => setCrearTramite(escrito) }} />
                </Campo>
                <Campo etiqueta="Número de guía" ayuda="Servientrega, Interrapidísimo... Se puede poner después.">
                  <Texto valor={guia} cambiar={setGuia} />
                </Campo>
                <label className={`envio-casilla${tramiteSobre || corrigiendo ? " fija" : ""}`}>
                  <input type="checkbox" checked={seSigue || !!corrigiendo} disabled={!!tramiteSobre || !!corrigiendo} onChange={(e) => setSeguir(e.target.checked)} />
                  <span><b>Seguir este sobre</b><small>{corrigiendo ? "Ya está registrado: se actualiza." : tramiteSobre ? "Con trámite se sigue siempre." : `Queda en «Sobres en camino»: a los ${DIAS_ENVIO} días hábiles avisa que ya debería haber llegado. Desmárquelo para algo sin importancia (una tarjeta a un cliente).`}</small></span>
                </label>
                <label className={`envio-casilla${seSigue ? "" : " apagada"}`}>
                  <input type="checkbox" checked={seSigue && enMapa} disabled={!seSigue} onChange={(e) => setEnMapa(e.target.checked)} />
                  <span><b><MapPin size={13} />Dejar en el mapa</b><small>{seSigue ? "Con el pulso hasta las 6:30 de mañana; después queda gris, como constancia." : "Solo para un sobre que se sigue."}</small></span>
                </label>
                {seSigue && (
                  <button type="button" className="btn btn-sm btn-fantasma" style={{ alignSelf: "flex-start" }} disabled={!recibe} onClick={() => void registrarSobre()}
                    title={recibe ? (corrigiendo ? "Guarda la corrección sin imprimir" : "Para cuando el rótulo se hizo a mano o ya estaba impreso") : "Primero elija a quién se envía"}>{corrigiendo ? "Guardar sin imprimir" : "Registrar sin imprimir"}</button>
                )}
              </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-cab">
              <b>Hoja para imprimir</b>
              <div className="seg" role="radiogroup" aria-label="Tamaño del sobre">
                {FORMATOS.map(([k, n]) => <button key={k} role="radio" aria-checked={formato === k} className={formato === k ? "on" : ""} onClick={() => { setFormato(k); try { localStorage.setItem("envio-formato", k); } catch { /* sin almacenamiento */ } }}>{n}</button>)}
              </div>
            </div>
            <div className="peq tenue" style={{ padding: "0 16px" }}>{formato === "pequeno" ? `Rótulo de ${(medidas.ancho / 10).toLocaleString("es-CO")} × ${(medidas.alto / 10).toLocaleString("es-CO")} cm en la esquina de la hoja, para recortar y pegar` : FORMATOS.find(([k]) => k === formato)![2]}</div>
            {formato === "pequeno" && (
              <div className="sobre-medidas" aria-label="Tamaño del rótulo pequeño">
                {([["ancho", "Ancho", 5], ["alto", "Alto", 5]] as const).map(([k, n, paso]) => (
                  <label key={k} className="sobre-medida">
                    <span>{n}</span>
                    <button type="button" className="btn btn-sm btn-icono" aria-label={`${n}: menos`} onClick={() => ajustar(acotar({ ...medidas, [k]: medidas[k] - paso }))}>−</button>
                    <input className="input" type="number" inputMode="decimal" step={0.5} min={LIMITES[k][0] / 10} max={LIMITES[k][1] / 10} aria-label={`${n} en centímetros`}
                      value={medidas[k] / 10} onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v > 0) ajustar(acotar({ ...medidas, [k]: v * 10 })); }} />
                    <small>cm</small>
                    <button type="button" className="btn btn-sm btn-icono" aria-label={`${n}: más`} onClick={() => ajustar(acotar({ ...medidas, [k]: medidas[k] + paso }))}>+</button>
                  </label>
                ))}
                <span className="sobre-medida">
                  <span>Letra</span>
                  <button type="button" className="btn btn-sm btn-icono" aria-label="Letra más pequeña" onClick={() => ajustar(acotar({ ...medidas, letra: medidas.letra - 0.05 }))}>A−</button>
                  <b style={{ minWidth: 44, textAlign: "center" }}>{Math.round(medidas.letra * 100)} %</b>
                  <button type="button" className="btn btn-sm btn-icono" aria-label="Letra más grande" onClick={() => ajustar(acotar({ ...medidas, letra: medidas.letra + 0.05 }))}>A+</button>
                </span>
                <button type="button" className="btn btn-sm btn-fantasma" onClick={() => ajustar(SOBRE_DE_PAGO, true)} disabled={medidas.ancho === SOBRE_DE_PAGO.ancho && medidas.alto === SOBRE_DE_PAGO.alto && medidas.letra === 1}>Volver a 9 × 16 cm</button>
              </div>
            )}
            <div className="card-cuerpo">
              <div className="hoja-vista-marco" aria-label="Vista de la hoja">
                <div className="hoja-vista"><Rotulo remite={remite} recibe={recibe} nota={notaSobre} formato={formato} medidas={medidas} ajustar={ajustar} /></div>
              </div>
              {/* La nota del tramitador: se prende o se apaga para el sobre, aquí mismo. */}
              {tramitadorSobre?.notas?.trim() && (
                <label className="nota-sobre">
                  <input type="checkbox" checked={conNota} onChange={(e) => void notaEnSobre(tramitadorSobre, e.target.checked)} />
                  <span>Nota en el sobre: <b>{tramitadorSobre.notas.trim()}</b></span>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><b>Sobres en camino</b><span className="peq tenue">{enCamino.length ? `${enCamino.length} sin llegar · tardan 1 o 2 días hábiles` : "Ninguno"}</span></div>
          <div className="card-cuerpo lista-filas" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {!enCamino.length && <span className="peq muted" style={{ padding: "8px 0" }}>No hay sobres en camino. Al imprimir un rótulo, el sobre queda aquí hasta que se marque que llegó.</span>}
            {enCamino.map((e) => {
              const dias = Math.round((new Date(`${hoyISO()}T12:00:00`).getTime() - new Date(`${e.fechaEnvio}T12:00:00`).getTime()) / 10_000_000);
              const tr = e.tramiteId ? tramites?.find((t) => t.id === e.tramiteId) : undefined;
              const limite = sumarDiasHabiles(e.fechaEnvio, DIAS_ENVIO);
              const tarde = hoyISO() > limite;
              return (
                <div key={e.id} className={`item sobre-item${tarde ? " tarde" : ""}${corrigiendo?.id === e.id ? " corrigiendo" : ""}`}>
                  {tarde ? <AlertTriangle size={16} className="sobre-tarde-ic" /> : <Truck size={16} className="tenue" />}
                  <div className="principal">
                    <b>{e.destinatario} · {e.ciudad}{tarde && <span className="sobre-tarde">Ya debería haber llegado</span>}</b>
                    <small>Salió el {fecha(e.fechaEnvio)} ({dias === 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`}) · {tarde ? `debía llegar a más tardar el ${fecha(limite)}` : `llega a más tardar el ${fecha(limite)}`}{tr ? ` · ${codigoTramite(tr)}` : ""}{e.guia ? ` · guía ${e.guia}` : ""}</small>
                  </div>
                  {tarde && e.tramiteId && (anotados.has(e.id)
                    ? <span className="peq tenue sobre-anotado"><Check size={12} />Anotado</span>
                    : <button className="btn btn-sm btn-fantasma" title="Opcional: deja en la bitácora del trámite que el sobre ya debería haber llegado" onClick={() => void anotarDemora(e)}><NotebookPen size={13} />Anotar en la bitácora</button>)}
                  <button className={`btn btn-sm btn-fantasma btn-icono envio-mapa${e.enMapa ? " on" : ""}`} aria-pressed={!!e.enMapa} title={e.enMapa ? "Está en el mapa: tocar para quitarlo" : "Dejarlo en el mapa"} aria-label={e.enMapa ? "Quitar del mapa" : "Dejar en el mapa"}
                    onClick={async () => { try { await escribir("PATCH", `/api/envios/${e.id}`, { enMapa: !e.enMapa }); } catch (err) { avisar(mensajeDe(err), "error"); } }}><MapPin size={13} /></button>
                  <button className="btn btn-sm btn-fantasma" title="Cargar este sobre arriba para cambiarle algo (la dirección, el teléfono...) e imprimirlo de nuevo: se actualiza el mismo" onClick={() => corregir(e)}><Printer size={13} />Corregir o reimprimir</button>
                  <button className="btn btn-sm btn-finalizar" onClick={() => marcarEnvio(e.id, "recibido")}><Check size={13} />Llegó</button>
                  <button className="btn btn-sm btn-fantasma" title="Lo devolvieron" onClick={() => marcarEnvio(e.id, "devuelto")}><Undo2 size={13} />Devuelto</button>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`card envio-historial${historial ? " abierta" : ""}`}>
          <button type="button" className="card-cab envio-opciones-cab" aria-expanded={historial} onClick={() => setHistorial((x) => !x)}>
            <span><b><History size={14} />Historial de sobres</b><small>{nHistorial ? `${nHistorial} ${nHistorial === 1 ? "sobre que llegó o se devolvió" : "sobres que llegaron o se devolvieron"}` : "Todavía no hay sobres que hayan llegado"}</small></span>
            <ChevronDown size={16} />
          </button>
          {historial && (
            <div className="card-cuerpo pila" style={{ gap: 10 }}>
              <div className="buscar" style={{ maxWidth: 420 }}><Search size={15} /><input className="input" value={buscaHist} onChange={(e) => setBuscaHist(e.target.value)} placeholder="Destinatario, ciudad, placa, código o guía" aria-label="Buscar en el historial de sobres" /></div>
              <TablaDatos
                idGuardado="historial-sobres"
                filas={historicoVisto}
                clave={(e) => e.id}
                ordenInicial={{ id: "salio", dir: -1 }}
                vacio={<span className="peq tenue" style={{ padding: 12 }}>{buscaHist.trim() ? `Nada con «${buscaHist}».` : "Todavía no hay sobres que hayan llegado."}</span>}
                columnas={[
                  { id: "destinatario", titulo: "A quién", fija: true, valor: (e) => e.destinatario, celda: (e) => <div><b>{e.destinatario}</b><small className="tenue" style={{ display: "block" }}>{e.ciudad}</small></div> },
                  { id: "salio", titulo: "Salió", valor: (e) => e.fechaEnvio, celda: (e) => fecha(e.fechaEnvio) },
                  { id: "llego", titulo: "Llegó", valor: (e) => e.fechaRecibido ?? "", celda: (e) => (e.estado === "devuelto" ? <span className="sobre-devuelto"><Undo2 size={12} />Devuelto</span> : e.fechaRecibido ? fecha(e.fechaRecibido) : <span className="sin-dato">Sin fecha</span>) },
                  { id: "tramite", titulo: "Trámite", valor: (e) => { const t = e.tramiteId ? tramites?.find((x) => x.id === e.tramiteId) : undefined; return t ? codigoTramite(t) : ""; },
                    celda: (e) => { const t = e.tramiteId ? tramites?.find((x) => x.id === e.tramiteId) : undefined; const placa = t?.vehiculoId ? placas?.get(t.vehiculoId) : ""; return t ? <a href={`/tramites/${t.id}`} onClick={(x) => { x.preventDefault(); navegar(`/tramites/${t.id}`); }}><b>{placa || codigoTramite(t)}</b>{placa && <small className="tenue" style={{ display: "block" }}>{codigoTramite(t)}</small>}</a> : <span className="sin-dato">Sin trámite</span>; } },
                  { id: "guia", titulo: "Guía", valor: (e) => e.guia ?? "", celda: (e) => e.guia || <span className="sin-dato">Sin guía</span> },
                  { id: "acciones", titulo: "", ancho: 96, celda: (e) => (
                    <div className="fila" style={{ gap: 4, justifyContent: "flex-end" }}>
                      <button className="btn btn-sm btn-fantasma btn-icono" aria-label="Reimprimir" title="Reimprimir: lo carga arriba para imprimirlo de nuevo (o corregirlo)" onClick={() => corregir(e)}><Printer size={14} /></button>
                      <button className="btn btn-sm btn-fantasma btn-icono" aria-label="Volver a en camino" title="Volver a en camino (si se marcó como llegado o devuelto por error)" onClick={() => void volverACamino(e.id)}><Truck size={14} /></button>
                    </div>
                  ) },
                ]}
              />
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-cab"><b>Tramitadores</b><button className="btn btn-sm" onClick={nuevoTramitador}><UserPlus size={13} />Agregar tramitador</button></div>
          <TablaDatos
            idGuardado="tramitadores"
            filas={tramitadores}
            clave={(t) => t.id}
            onFila={(t) => { setError(null); setEditando({ tipo: "tramitador", datos: { ...VACIO, ...t, notas: t.notas ?? "", cubre: t.cubre ?? "" } }); }}
            ordenInicial={{ id: "ciudad", dir: 1 }}
            vacio={<Vacio icono={Mail} titulo="Todavía no hay tramitadores"><button className="btn btn-primario" onClick={nuevoTramitador}>Agregar el primero</button></Vacio>}
            columnas={[
              { id: "nombre", titulo: "Nombre", fija: true, valor: (t) => t.nombre, celda: (t) => <div><b>{t.nombre}</b>{t.documento && <small className="tenue" style={{ display: "block" }}>C.C. {t.documento}</small>}</div> },
              { id: "ciudad", titulo: "Ciudad", valor: (t) => t.ciudad, celda: (t) => t.ciudad },
              { id: "cubre", titulo: "Zona que cubre", valor: (t) => t.cubre ?? "", celda: (t) => t.cubre || <span className="tenue">{ciudadSobre(t)}</span> },
              { id: "telefono", titulo: "Teléfono", valor: (t) => t.telefono, celda: (t) => t.telefono || <span className="sin-dato">Sin dato</span> },
              { id: "direccion", titulo: "Dirección", valor: (t) => t.direccion, celda: (t) => t.direccion || <span className="sin-dato">Sin dato</span> },
              { id: "notas", titulo: "Notas", oculta: true, valor: (t) => t.notas ?? "", celda: (t) => t.notas || "" },
            ]}
          />
        </div>
      </div>

      <Panel
        abierto={crearTramite !== null}
        onCerrar={() => setCrearTramite(null)}
        ancho={860}
        cabecera={<div><h2>Trámite nuevo para este envío</h2><div className="peq tenue">{crearTramite ? `Placa ${crearTramite.toUpperCase()}: s` : "S"}uba o pegue la tarjeta y las cédulas: se leen solas y usted confirma antes de guardar. Al guardarlo queda elegido aquí.</div></div>}
      >
        {crearTramite !== null && <Registrador alGuardar={(r) => { void alCrearTramite(r.ids); }} cancelar={() => setCrearTramite(null)} abrir={(id) => navegar(`/tramites/${id}`)} />}
      </Panel>

      <Panel
        abierto={!!editando}
        onCerrar={() => setEditando(null)}
        cabecera={<h2>{editando?.tipo === "remitente" ? "Quien envía (los de siempre)" : tramitadores.some((t) => t.id === (editando?.datos as Tramitador | undefined)?.id) ? "Editar tramitador" : "Nuevo tramitador"}</h2>}
        pie={
          <div className="fila" style={{ width: "100%" }}>
            {editando?.tipo === "tramitador" && tramitadores.some((t) => t.id === editando.datos.id) && <button className="btn btn-peligro btn-sm" onClick={() => borrar(editando.datos)}>Borrar</button>}
            <div className="espacio" />
            <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-primario" disabled={ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar"}</button>
          </div>
        }
      >
        {editando && (
          <div className="pila">
            <FormularioDatos datos={editando.datos} cambiar={(d) => setEditando({ ...editando, datos: { ...editando.datos, ...d } } as typeof editando)} autoFocus />
            {editando.tipo === "tramitador" && (
              <Campo etiqueta="Zona que cubre" ayuda="Dónde radica, separado por comas: municipios (Funza, Madrid) o un departamento entero (Cundinamarca). El de un departamento vale para sus municipios sin tramitador propio. Vacío: la ciudad del sobre.">
                <Texto valor={(editando.datos as Tramitador).cubre ?? ""} cambiar={(v) => setEditando({ ...editando, datos: { ...editando.datos, cubre: v } })} />
              </Campo>
            )}
            {editando.tipo === "tramitador" && (
              <Campo etiqueta="Notas" ayuda="Opcional: horario, transportadora que prefiere, «déjelo debajo de la puerta»...">
                <Texto valor={editando.datos.notas} cambiar={(v) => setEditando({ ...editando, datos: { ...editando.datos, notas: v } })} />
              </Campo>
            )}
            {editando.tipo === "tramitador" && (
              <label className="nota-sobre">
                <input type="checkbox" disabled={!editando.datos.notas.trim()} checked={!!(editando.datos as Tramitador).notaEnSobre && !!editando.datos.notas.trim()}
                  onChange={(e) => setEditando({ ...editando, datos: { ...editando.datos, notaEnSobre: e.target.checked } })} />
                <span>Que la nota salga en el sobre, debajo del destinatario{editando.datos.notas.trim() ? "" : " (escriba primero la nota)"}</span>
              </label>
            )}
            <ErrorFormulario error={error} />
          </div>
        )}
      </Panel>

    </>
  );
}

/** Lo que tarda un sobre (días hábiles): pasado eso, "ya debería haber llegado" (como en el servidor, api/rutas/envios.ts). */
const DIAS_ENVIO = 2;

/**
 * La ciudad de Envíos (su clave en la lista) para el organismo de un trámite: la misma ciudad (con o sin su
 * departamento) o, si no, el departamento entero que cubre un tramitador. Null si no hay tramitador para ella.
 */
function claveCiudad(org: { ciudad?: string | null; departamento?: string | null } | undefined, ciudades: [string, string][]) {
  if (!org?.ciudad) return null;
  const c = normalizar(org.ciudad), d = normalizar(org.departamento ?? "");
  const claves = ciudades.map(([k]) => k);
  return claves.find((k) => k === c || k === `${c}, ${d}` || k.startsWith(`${c},`)) ?? (d ? claves.find((k) => k === d) ?? null : null);
}
