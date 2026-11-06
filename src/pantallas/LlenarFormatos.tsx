import { useLiveQuery } from "dexie-react-hooks";
import { PDFDocument } from "pdf-lib";
import { Check, ClipboardPlus, Download, ExternalLink, FilePlus, FileText, FolderOpen, Loader2, Printer, RotateCcw, Save, ShieldCheck, Smartphone, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { codigoTramite } from "../../compartido/dominio";
import { type Borrador, type BorradorResumen, errorDe, hace, hojasDeFormatos, PanelBorradores, seBorra, useBorradores } from "../componentes/BorradoresFormatos";
import { type Hoja, Registrador } from "../componentes/Registrador";
import { Buscador, Campo, Fecha, LeerFoto, Texto, type OpcionBuscador } from "../componentes/formulario";
import { Cabecera, Panel, useUI } from "../componentes/ui";
import { api, SesionVencida, SinAcceso } from "../datos/api";
import { db } from "../datos/db";
import { mensajeDe } from "../datos/escribir";
import { sincronizarAhora } from "../datos/sincronizacion";
import { conTarjeta, datosVacios as vacios, desdeCedula, ibagueDe, personaVacia, vehiculoVacio } from "../formatos/desdeFotos";
import { CASILLAS_FUN, casillaDe, dividirNombre, FORMATOS_LLENABLES, generarFormatos, PERSONA_INDETERMINADA, precioEnLetras, type DatosFormatos, type Formato, type PersonaFormato, type VehiculoFormato } from "../formatos/llenado";
import { VistaFormato, VistaReverso } from "../formatos/VistaFormato";
import { type DocFormato, fotoDeDocumento, fotoGuardada, fotosGuardadas, type FotosFormato } from "../formatos/fotosFormatos";
import { marcarFormatosVistos } from "../componentes/PestanasFotos";

/*
 * Llenar formatos: el formulario único (FUN), los contratos de mandato y la compraventa, llenos con los datos de un
 * trámite o de las fotos de la tarjeta de propiedad y las cédulas. La vista previa muestra cada formato como va a
 * salir y cada dato se puede corregir encima; al imprimir sale un solo PDF con las correcciones.
 * En vivo: lo que el celular lee en Formatos (la tarjeta, las cédulas) llega solo aquí a los pocos segundos, como si
 * la foto se hubiera tomado en el PC (lo toma este PC; si hay otro abierto, no se llena en los dos).
 * Los datos del trámite no cambian. Desde un borrador se anota el trámite (Registrar, ya armado con lo llenado; queda
 * ligado al borrador). Lo llenado se puede guardar como borrador (para alguien que viene después: se le
 * llenan el día antes y se imprimen cuando llega), en el servidor, 5 días. Lo que llega del celular (Formatos en la app del celular)
 * se abre aquí con ?celular=id; lo de la consulta rápida llega con sus datos (estado de la navegación). El organismo de
 * tránsito arranca en Ibagué.
 * En la vista previa van siempre el formulario único (las dos caras) y el mandato del propietario; la compraventa,
 * plegada (no está en todos los trámites), y el mandato del comprador, en "Ver más" (casi nunca se usa).
 */

const CLAVE_MANDATARIO = "nexum.formatos.mandatario";
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const datosVacios = () => vacios(mandatarioGuardado());
/** Con comprador (traspaso) va también la compraventa; el mandato del comprador solo si se pide (en "Ver más"). */
const CON_COMPRADOR: Formato[] = ["fun", "mandato_propietario", "compraventa"];
const DOCS_FORMATO: DocFormato[] = ["tarjeta", "propietario", "comprador"];
function mandatarioGuardado() {
  try { return { nombre: "", documento: "", ...JSON.parse(localStorage.getItem(CLAVE_MANDATARIO) ?? "{}") }; } catch { return { nombre: "", documento: "" }; }
}
type DocCelular = "tarjeta" | "propietario" | "comprador";
const NOMBRE_DOC: Record<DocCelular, string> = { tarjeta: "tarjeta de propiedad", propietario: "cédula del propietario", comprador: "cédula del comprador" };
const TIPO_DOC: Record<string, string> = { CC: "CC", CE: "CE", NIT: "NIT", Pasaporte: "PA", PPT: "PA", TI: "TI" };
const textoTramite = (nombres: string[]) => nombres.map((n) => n.toLowerCase().replace(/ de propiedad$/, "")).join(" y ");

export default function LlenarFormatos() {
  const { avisar, confirmar } = useUI();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const tramiteId = params.get("tramite");
  const celularId = params.get("celular");
  const borradorId = params.get("borrador");
  const [d, setD] = useState<DatosFormatos>(datosVacios);
  const [elegidos, setElegidos] = useState<Formato[]>(["fun", "mandato_propietario"]);
  const [generando, setGenerando] = useState<"imprimir" | "descargar" | "abrir" | null>(null);
  const [pdf, setPdf] = useState<{ url: string; nombre: string } | null>(null);
  /** Lo corregido a mano en la vista previa: clave "formato:casilla" -> texto. */
  const [cambios, setCambios] = useState<Record<string, string>>({});
  /**
   * Las fotos con que se llena (tomadas aquí, llegadas del celular o guardadas en el borrador): se ven en grande, se
   * guardan con el borrador y quedan en los archivos del trámite al anotarlo. `enBorrador`: las que ya tiene guardadas.
   */
  const [fotosDoc, setFotosDoc] = useState<FotosFormato>({});
  const [fotosEnBorrador, setFotosEnBorrador] = useState<FotosFormato>({});
  /**
   * Un solo sitio por foto: con un trámite (el elegido, o el anotado desde el borrador), las fotos SON sus archivos (se
   * ven las que tiene y lo que se pone aquí queda en él, sin copias). `enTramite`: las que ya están allá.
   * `copias`: las que llegaron del celular (en vivo o mandadas) y siguen allá hasta guardarse en el trámite o el borrador.
   */
  const [enTramite, setEnTramite] = useState<FotosFormato>({});
  const copias = useRef(new Set<string>());
  const ligadoA = useRef<string | null>(null);
  const soltarCopias = () => { for (const g of copias.current) void api(`/api/formatos-fotos/${g}`, { method: "DELETE" }).catch(() => {}); copias.current.clear(); };
  const ponerFoto = (doc: DocFormato, copia?: string) => (f: string | null) => {
    setFotosDoc((x) => { const n = { ...x }; if (f) n[doc] = f; else delete n[doc]; return n; });
    const tid = ligadoA.current;
    if (copia && !tid) copias.current.add(copia);
    if (!f || !tid) return;
    // Con trámite: va directo a su documento (tarjeta de propiedad, cédula del vendedor o del comprador).
    void api(`/api/tramites/${tid}/fotos-formatos`, { method: "POST", body: JSON.stringify({ doc, foto: f }) }).then(() => {
      setEnTramite((x) => ({ ...x, [doc]: f }));
      if (copia) void api(`/api/formatos-fotos/${copia}`, { method: "DELETE" }).catch(() => {});
      avisar(`La ${NOMBRE_DOC[doc]} quedó en los archivos del trámite.`);
    }, (e) => avisar(`No se guardó la foto en el trámite: ${mensajeDe(e)}`, "error"));
  };
  const organismos = useLiveQuery(() => db.organismos.toArray().then((o) => o.filter((x) => x.activo).sort((a, b) => (a.ciudad ?? a.nombre).localeCompare(b.ciudad ?? b.nombre, "es"))), []) ?? [];
  const [delCelular, setDelCelular] = useState<string | null>(null);
  // Lo que llega de la consulta rápida: los datos ya leídos y consultados.
  const desdeConsulta = (useLocation().state as { desdeConsulta?: { datos: DatosFormatos; elegidos: Formato[] } } | null)?.desdeConsulta;
  const [deConsulta, setDeConsulta] = useState<string | null>(null);
  useEffect(() => {
    if (!desdeConsulta) return;
    const { datos, elegidos: e } = desdeConsulta;
    setD({ ...datosVacios(), ...datos, mandatario: datos.mandatario?.nombre ? datos.mandatario : mandatarioGuardado() });
    setElegidos(e);
    setDeConsulta([datos.vehiculo.placa, [datos.propietario.nombres, datos.propietario.apellido1].filter(Boolean).join(" ")].filter(Boolean).join(" · "));
    setCambios({}); setPdf(null);
  }, [desdeConsulta]);
  // Ibagué con el nombre exacto de la lista (para que el selector lo muestre marcado).
  useEffect(() => {
    if (organismos.length && d.organismo.ciudad === "Ibagué" && !organismos.some((o) => o.nombre === d.organismo.nombre)) setD((x) => ({ ...x, organismo: ibagueDe(organismos) }));
  }, [organismos, d.organismo]);

  // Opciones para elegir el trámite: los abiertos primero (los más recientes arriba).
  const opciones = useLiveQuery(async (): Promise<OpcionBuscador[]> => {
    const [tramites, clientes, vehiculos, tipos] = await Promise.all([db.tramites.toArray(), db.clientes.toArray(), db.vehiculos.toArray(), db.tipos_tramite.toArray()]);
    const cli = new Map(clientes.map((c) => [c.id, c.nombre])), veh = new Map(vehiculos.map((v) => [v.id, v.placa])), tip = new Map(tipos.map((t) => [t.id, t]));
    return tramites
      .filter((t) => tip.get(t.tipoId)?.categoria === "vehiculo")
      .sort((a, b) => Number(["entregado", "cancelado"].includes(a.estado)) - Number(["entregado", "cancelado"].includes(b.estado)) || b.numero - a.numero)
      .slice(0, 400)
      .map((t) => {
        const placa = t.vehiculoId ? veh.get(t.vehiculoId) ?? "" : "";
        const titulo = `${codigoTramite(t)} · ${tip.get(t.tipoId)?.nombre ?? ""}${placa ? ` · ${placa}` : ""}`;
        return { id: t.id, titulo, detalle: cli.get(t.titularId) ?? "", busqueda: `${titulo} ${cli.get(t.titularId) ?? ""}`.toLowerCase() };
      });
  }, []) ?? [];

  // Datos del trámite elegido (y de los demás trámites de su encargo, para marcar todas las casillas).
  useEffect(() => {
    if (!tramiteId) return;
    let vigente = true;
    (async () => {
      const t = await db.tramites.get(tramiteId);
      if (!t || !vigente) return;
      const hermanos = t.encargoId ? (await db.tramites.where("encargoId").equals(t.encargoId).toArray()).filter((h) => h.estado !== "cancelado") : [t];
      const tipos = await Promise.all(hermanos.map((h) => db.tipos_tramite.get(h.tipoId)));
      const nombresTipo = tipos.map((x) => x?.nombre ?? "").filter(Boolean);
      const v = t.vehiculoId ? await db.vehiculos.get(t.vehiculoId) : undefined;
      const personas = await db.tramite_personas.where("tramiteId").anyOf(hermanos.map((h) => h.id)).toArray();
      const cliente = async (id?: string | null) => (id ? db.clientes.get(id) : undefined);
      const aPersona = (c: Awaited<ReturnType<typeof cliente>>): PersonaFormato | null => c ? ({ ...dividirNombre(c.nombre), tipoDocumento: TIPO_DOC[c.tipoDocumento] ?? "CC", documento: c.numeroDocumento ?? "", direccion: c.direccion ?? "", ciudad: c.ciudad ?? "", telefono: c.telefono ?? "" }) : null;
      const vendedor = personas.find((p) => p.rol === "vendedor")?.clienteId;
      const comprador = personas.find((p) => p.rol === "comprador")?.clienteId;
      const propietarioId = vendedor ?? v?.titularId ?? t.titularId;
      const esTraspaso = nombresTipo.some((n) => /traspaso/i.test(n));
      const compradorId = comprador ?? (esTraspaso && t.titularId !== propietarioId ? t.titularId : null);
      const organismo = t.organismoId ? await db.organismos.get(t.organismoId) : undefined;
      const ibague = ibagueDe(await db.organismos.toArray());
      const matricula = v?.organismoMatriculaId ? await db.organismos.get(v.organismoMatriculaId) : undefined;
      const propietario = aPersona(await cliente(propietarioId)) ?? personaVacia();
      const compradorP = compradorId ? aPersona(await cliente(compradorId)) : null;
      if (!vigente) return;
      setD((x) => ({
        ...x,
        organismo: organismo ? { nombre: organismo.nombre, ciudad: organismo.ciudad ?? "" } : ibague,
        casillas: [...new Set(nombresTipo.map(casillaDe))].sort((a, b) => a - b),
        tramiteTexto: textoTramite(nombresTipo),
        observaciones: nombresTipo.some((n) => /indeterminad/i.test(n)) ? "Traspaso a persona indeterminada." : "",
        vehiculo: v ? { ...vehiculoVacio(), placa: v.placa, marca: v.marca ?? "", linea: v.linea ?? "", modelo: v.modelo ? String(v.modelo) : "", clase: v.clase ?? "", color: v.color ?? "", cilindraje: v.cilindraje ? String(v.cilindraje) : "", servicio: v.servicio ?? "", motor: v.numeroMotor ?? "", chasis: v.numeroChasis ?? "", serie: v.numeroSerie ?? "", vin: v.vin ?? "", combustible: v.combustible ?? "", carroceria: v.carroceria ?? "", capacidad: v.capacidad ?? "", potencia: v.potencia ?? "", matriculadoEn: matricula?.ciudad ?? "" } : vehiculoVacio(),
        propietario,
        // Traspaso a persona indeterminada: el formulario único pide escribirlo en el campo del comprador.
        comprador: nombresTipo.some((n) => /indeterminad/i.test(n)) ? PERSONA_INDETERMINADA : compradorP,
      }));
      setElegidos(compradorId ? CON_COMPRADOR : ["fun", "mandato_propietario"]);
      setPdf(null);
    })();
    return () => { vigente = false; };
  }, [tramiteId]);

  // Lo que llegó del celular: sus datos tal cual, para revisarlos e imprimir.
  useEffect(() => {
    if (!celularId) return;
    let vigente = true;
    api<{ nombre: string; datos: DatosFormatos; elegidos?: Formato[]; fotos?: DocFormato[] }>(`/api/formatos-celular/${celularId}`).then((r) => {
      if (!vigente) return;
      setD({ ...datosVacios(), ...r.datos, mandatario: r.datos.mandatario?.nombre ? r.datos.mandatario : mandatarioGuardado() });
      setElegidos(r.elegidos?.length ? r.elegidos : r.datos.comprador ? CON_COMPRADOR : ["fun", "mandato_propietario"]);
      setDelCelular(r.nombre);
      setCambios({}); setPdf(null); setFotosDoc({}); setFotosEnBorrador({});
      marcarFormatosVistos(new Date().toISOString());
      // Las fotos que tomó el celular: se ven aquí y van al trámite si se anota.
      if (r.fotos?.length) void fotosGuardadas(`celular-${celularId}`, r.fotos).then((f) => { if (vigente) { setFotosDoc(f); copias.current.add(`celular-${celularId}`); } });
    }, (e) => avisar(mensajeDe(e), "error"));
    return () => { vigente = false; };
  }, [celularId]); // eslint-disable-line react-hooks/exhaustive-deps

  // El borrador abierto (?borrador=id): lo guardado tal cual (datos, formatos elegidos y correcciones de la vista previa).
  const [borrador, setBorrador] = useState<(BorradorResumen & { tramiteId: string | null }) | null>(null);
  /** Lo que quedó guardado (para saber si hay cambios sin guardar). */
  const [guardadoComo, setGuardadoComo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verBorradores, setVerBorradores] = useState(false);
  const [versionLista, setVersionLista] = useState(0);
  const borradores = useBorradores(versionLista);
  const foto = JSON.stringify({ d, elegidos, cambios });
  // Con trámite, las fotos se guardan solas en él: no dejan el borrador "con cambios".
  const tramiteLigado = tramiteId ?? borrador?.tramiteId ?? null;
  ligadoA.current = tramiteLigado;
  const fotosCambiaron = !tramiteLigado && DOCS_FORMATO.some((x) => fotosDoc[x] !== fotosEnBorrador[x]);
  // Las fotos que ya tiene el trámite (tarjeta y cédulas) se ven en su recuadro.
  useEffect(() => {
    setEnTramite({});
    if (!tramiteLigado) return;
    let vigente = true;
    void api<FotosFormato>(`/api/tramites/${tramiteLigado}/fotos-formatos`).then(async (ids) => {
      const fotos: FotosFormato = {};
      await Promise.all(DOCS_FORMATO.map(async (x) => { if (ids[x]) { const f = await fotoDeDocumento(ids[x]!); if (f) fotos[x] = f; } }));
      if (!vigente) return;
      setEnTramite(fotos);
      setFotosDoc((ya) => ({ ...fotos, ...Object.fromEntries(Object.entries(ya).filter(([, v]) => v)) }));
    }, () => { /* sin conexión: se ven al volver */ });
    return () => { vigente = false; };
  }, [tramiteLigado]);
  const sucio = guardadoComo !== foto || fotosCambiaron;
  const hayDatos = !!(d.vehiculo.placa || d.propietario.documento || d.propietario.nombres || d.propietario.apellido1 || (d.comprador && !sinDatos(d.comprador)));
  useEffect(() => {
    if (!borradorId) { setBorrador(null); setGuardadoComo(null); return; }
    if (borrador?.id === borradorId) return; // recién guardado: ya está en pantalla
    let vigente = true;
    api<Borrador & { fotos?: DocFormato[] }>(`/api/formatos-borradores/${borradorId}`).then(async (b) => {
      if (!vigente) return;
      const datos: DatosFormatos = { ...datosVacios(), ...b.datos, mandatario: b.datos.mandatario?.nombre ? b.datos.mandatario : mandatarioGuardado() };
      const el: Formato[] = b.elegidos?.length ? b.elegidos : datos.comprador ? CON_COMPRADOR : ["fun", "mandato_propietario"];
      const c = b.cambios ?? {};
      setD(datos); setElegidos(el); setCambios(c); setPdf(null); setDelCelular(null); setDeConsulta(null); setEnVivo([]); setFotos((n) => n + 1); setFotosDoc({}); copias.current.clear();
      setBorrador({ id: borradorId, nombre: b.nombre, guardado: b.guardado, vence: b.vence, tramiteId: b.tramiteId ?? null, tramite: b.tramiteCodigo ?? null });
      setGuardadoComo(JSON.stringify({ d: datos, elegidos: el, cambios: c }));
      // Sus fotos (las con que se llenó): se ven y van al trámite al anotarlo.
      const f = b.fotos?.length ? await fotosGuardadas(`borrador-${borradorId}`, b.fotos) : {};
      if (!vigente) return;
      // Se suman a las del trámite (si ya llegaron): cada una en su recuadro.
      setFotosDoc((ya) => ({ ...ya, ...f })); setFotosEnBorrador(f);
      if (anotarAlAbrir.current === borradorId) { anotarAlAbrir.current = null; setAnotar(hojasDeFormatos(datos, f)); }
    }, (e) => { if (vigente) { avisar(errorDe(e), "error"); setParams({}, { replace: true }); } });
    return () => { vigente = false; };
  }, [borradorId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Guarda lo llenado como borrador (el abierto se actualiza y vuelve a contar sus 5 días). `anotado`: el trámite que se
   * acaba de anotar desde él (queda ligado: la lista lo muestra con "Ver trámite").
   */
  async function guardarBorrador(anotado?: { id: string; codigo: string }) {
    setGuardando(true);
    try {
      const tid = anotado?.id ?? tramiteId ?? borrador?.tramiteId ?? null;
      const t = tid && !anotado ? await db.tramites.get(tid) : undefined;
      const codigo = anotado?.codigo ?? (t ? codigoTramite(t) : borrador?.tramite ?? null);
      // Las fotos, en un solo sitio. Con trámite: van a sus archivos (las que no estén allá) y el borrador no guarda copia.
      // Sin trámite: el borrador guarda las nuevas o cambiadas y quita las que se quitaron.
      const ya = borrador ? fotosEnBorrador : {};
      // (Recién anotado, el registrador ya las pegó: no se vuelven a subir.)
      if (tid && !anotado) for (const x of DOCS_FORMATO) if (fotosDoc[x] && fotosDoc[x] !== enTramite[x]) {
        await api(`/api/tramites/${tid}/fotos-formatos`, { method: "POST", body: JSON.stringify({ doc: x, foto: fotosDoc[x] }) });
        setEnTramite((e) => ({ ...e, [x]: fotosDoc[x] }));
      }
      const fotos = tid ? {} : Object.fromEntries(DOCS_FORMATO.filter((x) => fotosDoc[x] && fotosDoc[x] !== ya[x]).map((x) => [x, fotosDoc[x]]));
      const fotosQuitar = tid ? DOCS_FORMATO.filter((x) => ya[x]) : DOCS_FORMATO.filter((x) => ya[x] && !fotosDoc[x]);
      const cuerpo = JSON.stringify({ datos: d, elegidos, cambios, tramiteId: tid, tramiteCodigo: codigo, fotos, fotosQuitar });
      const r = await api<BorradorResumen>(borrador ? `/api/formatos-borradores/${borrador.id}` : "/api/formatos-borradores", { method: borrador ? "PUT" : "POST", body: cuerpo });
      setBorrador({ ...r, tramiteId: tid, tramite: codigo });
      setGuardadoComo(foto);
      setFotosEnBorrador(tid ? {} : fotosDoc);
      // Las que llegaron del celular ya quedaron guardadas (en el borrador o en el trámite): sin copias allá.
      soltarCopias();
      if (!borrador) setParams({ borrador: r.id }, { replace: true });
      setVersionLista((v) => v + 1);
      if (!anotado) avisar(`Borrador guardado: ${r.nombre}. Queda 5 días.`);
    } catch (e) {
      const m = errorDe(e);
      // Se venció mientras estaba abierto: lo escrito sigue en pantalla y el próximo guardado crea uno nuevo.
      if (borrador && /ya no está/.test(m)) { setBorrador(null); setGuardadoComo(null); setParams({}, { replace: true }); }
      avisar(m, "error");
    } finally { setGuardando(false); }
  }
  // Anotar el trámite desde el borrador: el registrador (Registrar trámite) se abre al lado, ya armado con lo llenado.
  const [anotar, setAnotar] = useState<Hoja[] | null>(null);
  const anotarAlAbrir = useRef<string | null>(null);
  /** Desde la lista: abre ese borrador y, ya cargado, el registrador. */
  async function anotarBorrador(id: string) {
    if (id === borrador?.id) { setVerBorradores(false); setAnotar(hojasDeFormatos(d, fotosDoc)); return; }
    anotarAlAbrir.current = id; // se abre el registrador apenas cargue el borrador
    if (!(await abrirBorrador(id))) anotarAlAbrir.current = null;
  }
  async function alAnotar(r: { ids: string[]; numeros: string[] }) {
    sincronizarAhora().catch(() => {});
    if (!r.ids[0]) return;
    // Las fotos ya quedaron en sus archivos (el registrador las pegó): son las del trámite, sin copias en otro lado.
    setEnTramite(fotosDoc);
    soltarCopias();
    // Queda ligado al borrador (que se guarda con lo de ahora y ya no guarda fotos: están en el trámite).
    if (borrador) await guardarBorrador({ id: r.ids[0], codigo: r.numeros[0] ?? "" });
    avisar(`Trámite ${r.numeros.join(", ")} anotado${borrador ? " y ligado al borrador" : ""}.`);
  }
  const pierde = async (texto: string) => !sucio || !hayDatos || await confirmar({ titulo: "Hay datos sin guardar", texto, boton: "Sí, seguir", peligro: true });
  /** Abre un borrador (si hay algo sin guardar, pregunta antes). `false` si se canceló. */
  async function abrirBorrador(id: string) {
    if (id === borrador?.id) { setVerBorradores(false); return true; }
    if (!(await pierde("Lo que lleva escrito aquí no está guardado y se pierde si abre otro borrador. Si lo necesita, toque Cancelar y luego «Guardar borrador»."))) return false;
    setBorrador(null);
    setParams({ borrador: id });
    setVerBorradores(false);
    return true;
  }
  /** "Empezar uno nuevo": todo en blanco, también las fotos puestas y lo que llegó del celular. */
  async function empezarNuevo() {
    if (!(await pierde("Lo que lleva escrito aquí no está guardado y se pierde al empezar uno nuevo."))) return;
    setParams({});
    setD(datosVacios()); setElegidos(["fun", "mandato_propietario"]); setCambios({}); setPdf(null);
    setDelCelular(null); setDeConsulta(null); setEnVivo([]); setFotos((n) => n + 1); setFotosDoc({}); setFotosEnBorrador({}); copias.current.clear();
  }
  const botonGuardar = (pequeno = false) => (
    <button className={`btn${pequeno ? "" : " btn-primario"}`} onClick={() => guardarBorrador()} disabled={guardando || !hayDatos || (!!borrador && !sucio)}
      title={!hayDatos ? "Primero llene algún dato (placa, propietario o comprador)" : "Guarda lo llenado para imprimirlo después (en todos los PC, 5 días)"}>
      {guardando ? <Loader2 size={15} className="girando" /> : borrador && !sucio ? <Check size={15} /> : <Save size={15} />}
      {borrador ? (sucio ? "Guardar cambios" : "Borrador guardado") : "Guardar borrador"}
    </button>
  );

  // Lo que lee el celular (Formatos), en vivo: se pregunta cada 2,5 s con la pantalla a la vista y se pone en el
  // formulario. Solo lo leído desde que se abrió la pantalla (un minuto antes, por si la foto se tomó justo antes).
  /** Al cambiar de datos (empezar uno nuevo, abrir otro borrador o elegir otro trámite) se quitan las fotos puestas. */
  const [fotos, setFotos] = useState(0);
  const [enVivo, setEnVivo] = useState<{ id: string; doc: DocCelular; texto: string; hora: string }[]>([]);
  const [vivoCaido, setVivoCaido] = useState(false);
  useEffect(() => {
    const desde = new Date(Date.now() - 10_000).toISOString();
    let vigente = true, ocupado = false;
    const revisar = async () => {
      if (document.hidden || ocupado || !vigente) return;
      ocupado = true;
      try {
        const r = await api<{ lecturas: { id: string; doc: DocCelular; datos: Record<string, string | string[]> }[] }>(`/api/formatos-vivo?desde=${encodeURIComponent(desde)}`);
        for (const l of r.lecturas) {
          if (!vigente || !(await api<{ tomado: boolean }>(`/api/formatos-vivo/${l.id}/tomar`, { method: "POST" })).tomado) continue;
          aplicarDelCelular(l.doc, l.datos);
          // La foto que tomó el celular (si la mandó): se ve aquí, como si se hubiera tomado en el PC.
          void fotoGuardada(`vivo-${l.id}`, l.doc).then((f) => { if (f && vigente) ponerFoto(l.doc, `vivo-${l.id}`)(f); });
          const texto = l.doc === "tarjeta" ? String(l.datos.placa ?? "").toUpperCase() : [desdeCedula(l.datos).nombres, desdeCedula(l.datos).apellido1].filter(Boolean).join(" ");
          setEnVivo((x) => [...x.filter((y) => y.doc !== l.doc), { id: l.id, doc: l.doc, texto, hora: new Date().toISOString() }]);
          avisar(`Llegó del celular: ${NOMBRE_DOC[l.doc]}${texto ? ` (${texto})` : ""}${Array.isArray(l.datos.dudosos) && l.datos.dudosos.length ? ". Revise los números: algunos no se leyeron con seguridad." : ""}`);
        }
        setVivoCaido(false);
      } catch (e) {
        // La sesión venció: se deja de preguntar (al volver a entrar, sigue); sin conexión, se reintenta sola.
        if (e instanceof SesionVencida || e instanceof SinAcceso) vigente = false;
        setVivoCaido(true);
      } finally { ocupado = false; }
    };
    const t = setInterval(revisar, 2500);
    void revisar();
    return () => { vigente = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Pone lo leído en el celular como si la foto se hubiera tomado aquí. */
  function aplicarDelCelular(doc: DocCelular, datos: Record<string, string | string[]>) {
    if (doc === "tarjeta") setD((x) => conTarjeta(x, datos));
    else if (doc === "propietario") setD((x) => ({ ...x, propietario: { ...x.propietario, ...desdeCedula(datos) } }));
    else {
      // Con comprador es traspaso (casilla 2, si no hay otra) y va la compraventa.
      setD((x) => ({ ...x, comprador: { ...(x.comprador ?? personaVacia()), ...desdeCedula(datos) }, casillas: x.casillas.length ? x.casillas : [CASILLA_TRASPASO], tramiteTexto: x.tramiteTexto || "traspaso" }));
      setElegidos((e) => [...new Set<Formato>([...e, "compraventa"])]);
    }
    setPdf(null);
  }

  useEffect(() => { try { localStorage.setItem(CLAVE_MANDATARIO, JSON.stringify(d.mandatario)); } catch { /* sin almacenamiento */ } }, [d.mandatario]);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);

  const poner = (c: Partial<DatosFormatos>) => { setD((x) => ({ ...x, ...c })); setPdf(null); };
  const ponerVehiculo = (c: Partial<VehiculoFormato>) => setD((x) => ({ ...x, vehiculo: { ...x.vehiculo, ...c } }));
  /** Lo leído de la tarjeta completa lo que falte (y corrige lo que venga distinto de la foto). */
  function leerTarjeta(datos: Record<string, string | string[]>) {
    setD((x) => conTarjeta(x, datos));
    setPdf(null);
  }

  const faltan = [
    !d.vehiculo.placa && "la placa", !d.propietario.documento && "la cédula del propietario", !(d.propietario.nombres || d.propietario.apellido1) && "el nombre del propietario",
    !d.casillas.length && "el trámite (punto 3 del formulario)",
    elegidos.some((e) => e.startsWith("mandato")) && !d.mandatario.nombre && "el mandatario",
  ].filter(Boolean) as string[];

  const visibles = FORMATOS_LLENABLES.map((f) => f.id).filter((id) => elegidos.includes(id) && (d.comprador || (id !== "mandato_comprador" && id !== "compraventa")));
  const corregidas = Object.keys(cambios).length;

  /** Arma el PDF con lo de la vista previa (datos + correcciones). */
  async function prepararPdf() {
    if (pdf) return pdf;
    const bytes = await generarFormatos(d, visibles, async (archivo) => {
      const r = await fetch(`/formatos/${archivo}`);
      if (!r.ok) throw new Error("No se pudo abrir el formato original.");
      return r.arrayBuffer();
    }, cambios);
    const listo = { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), nombre: `formatos-${d.vehiculo.placa.toUpperCase() || "tramite"}-${d.fecha}.pdf` };
    setPdf(listo);
    return listo;
  }
  /** Imprime el PDF tal cual (tamaño real) desde un marco oculto, sin salir de la pantalla. */
  function imprimirUrl(url: string) {
    const marco = document.createElement("iframe");
    marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    marco.src = url;
    marco.onload = () => { try { marco.contentWindow?.focus(); marco.contentWindow?.print(); } catch { window.open(url, "_blank"); } setTimeout(() => marco.remove(), 10_000); };
    document.body.appendChild(marco);
  }
  /**
   * Una sola hoja (cada una se imprime por aparte: el frente del formulario único, luego su respaldo metiendo otra vez
   * la hoja ya impresa, y el mandato en otra hoja). `pagina`: 0 la cara llena, 1 el respaldo.
   */
  const [hojaOcupada, setHojaOcupada] = useState<string | null>(null);
  async function hoja(id: Formato, pagina: number, cual: "imprimir" | "descargar") {
    const clave = `${id}-${pagina}-${cual}`;
    setHojaOcupada(clave);
    try {
      const fuente = await PDFDocument.load(await generarFormatos(d, [id], async (archivo) => {
        const r = await fetch(`/formatos/${archivo}`);
        if (!r.ok) throw new Error("No se pudo abrir el formato original.");
        return r.arrayBuffer();
      }, cambios));
      if (pagina >= fuente.getPageCount()) throw new Error("Esa hoja no está en el formato.");
      const salida = await PDFDocument.create();
      const [p] = await salida.copyPages(fuente, [pagina]);
      salida.addPage(p);
      const url = URL.createObjectURL(new Blob([(await salida.save()) as BlobPart], { type: "application/pdf" }));
      if (cual === "descargar") { const a = document.createElement("a"); a.href = url; a.download = `${id}${pagina ? "-respaldo" : ""}-${d.vehiculo.placa.toUpperCase() || "tramite"}.pdf`; a.click(); }
      else imprimirUrl(url);
      setTimeout(() => URL.revokeObjectURL(url), 100_000);
    } catch (e) { avisar(mensajeDe(e), "error"); } finally { setHojaOcupada(null); }
  }
  const botonesHoja = (id: Formato, pagina = 0) => (
    <span className="fila hoja-previa-acc" style={{ gap: 6 }}>
      <button className="btn btn-sm btn-primario" disabled={!!hojaOcupada} onClick={() => hoja(id, pagina, "imprimir")} title={pagina ? "Imprime solo el respaldo: vuelva a meter en la impresora la hoja con el frente ya impreso para que salga por detrás" : "Imprime solo esta hoja"}>
        {hojaOcupada === `${id}-${pagina}-imprimir` ? <Loader2 size={13} className="girando" /> : <Printer size={13} />}{pagina ? "Imprimir solo el respaldo" : "Imprimir esta hoja"}
      </button>
      <button className="btn btn-sm" disabled={!!hojaOcupada} onClick={() => hoja(id, pagina, "descargar")} title="Descargar solo esta hoja en PDF">
        {hojaOcupada === `${id}-${pagina}-descargar` ? <Loader2 size={13} className="girando" /> : <Download size={13} />}PDF
      </button>
    </span>
  );
  // «Imprimir» en lo que llegó del celular (Formatos): se abre aquí y se manda a imprimir de una vez, ya cargado.
  const imprimirAlAbrir = useRef(params.get("imprimir") === "1");
  useEffect(() => {
    if (!imprimirAlAbrir.current || !delCelular) return;
    imprimirAlAbrir.current = false;
    setParams((p) => { const n = new URLSearchParams(p); n.delete("imprimir"); return n; }, { replace: true });
    void accion("imprimir");
  }, [delCelular]); // eslint-disable-line react-hooks/exhaustive-deps
  async function accion(cual: "imprimir" | "descargar" | "abrir") {
    setGenerando(cual);
    try {
      const { url, nombre } = await prepararPdf();
      if (cual === "descargar") {
        const a = document.createElement("a"); a.href = url; a.download = nombre; a.click();
      } else if (cual === "abrir") {
        window.open(url, "_blank");
      } else imprimirUrl(url);
    } catch (e) { avisar(mensajeDe(e), "error"); } finally { setGenerando(null); }
  }
  /** El selector de un formato (con lo que necesita). */
  const elegir = (id: Formato) => {
    const f = FORMATOS_LLENABLES.find((x) => x.id === id)!;
    const deshabilitado = (id === "mandato_comprador" || id === "compraventa") && !d.comprador;
    return (
      <label key={id} className={`llenar-check${deshabilitado ? " tenue" : ""}`}>
        <input type="checkbox" checked={elegidos.includes(id) && !deshabilitado} disabled={deshabilitado} onChange={(e) => { setElegidos((x) => (e.target.checked ? [...x, id] : x.filter((y) => y !== id))); setPdf(null); }} />
        {id === "fun" ? `${f.nombre} (las dos caras)` : f.nombre}{deshabilitado && <small> (necesita comprador)</small>}
      </label>
    );
  };
  /**
   * Marca o desmarca una casilla del punto 3. El traspaso trae el comprador y el contrato de compraventa (desplegado);
   * al desmarcarlo se quitan solo si el comprador sigue vacío (lo escrito no se pierde).
   */
  function marcarCasilla(n: number, on: boolean) {
    const cambio: Partial<DatosFormatos> = { casillas: on ? d.casillas.filter((x) => x !== n) : [...d.casillas, n].sort((a, b) => a - b) };
    if (n === CASILLA_TRASPASO && !on) {
      if (!d.comprador) cambio.comprador = personaVacia();
      setElegidos((e) => [...new Set<Formato>([...e, "compraventa"])]);
    }
    if (n === CASILLA_TRASPASO && on && d.comprador && sinDatos(d.comprador)) {
      cambio.comprador = null;
      setElegidos((e) => e.filter((x) => x !== "mandato_comprador" && x !== "compraventa"));
    }
    poner(cambio);
  }
  const corregir = (clave: string, valor: string, calculado: string) => {
    setCambios((c) => { const n = { ...c }; if (valor === calculado) delete n[clave]; else n[clave] = valor; return n; });
    setPdf(null);
  };

  return (
    <>
      <Cabecera titulo="Llenar formatos" sub="Formulario único, mandatos y compraventa, llenos y listos para imprimir">
        {botonGuardar()}
        <button className="btn" onClick={() => { setVerBorradores(true); setVersionLista((v) => v + 1); }} title="Los borradores guardados (se borran solos a los 5 días)">
          <FolderOpen size={15} />Borradores{borradores.lista?.length ? <span className="borradores-cuenta">{borradores.lista.length}</span> : null}
        </button>
        <Link className="btn" to="/formatos"><FileText size={15} />Todos los formatos</Link>
      </Cabecera>
      <Panel abierto={!!anotar} onCerrar={() => setAnotar(null)} ancho={980}
        cabecera={<div><h2>Anotar trámite</h2><span className="peq muted">Con los datos de {borrador ? `«${borrador.nombre}»` : "los formatos"}: revise, elija valor, aliado y precondiciones, y guarde.</span></div>}>
        {anotar && <Registrador inicial={anotar} armarDeUna alGuardar={(r) => { void alAnotar(r); }} cancelar={() => setAnotar(null)} abrir={(id) => navegar(`/tramites/${id}`)} />}
      </Panel>
      <PanelBorradores abierto={verBorradores} cerrar={() => setVerBorradores(false)} lista={borradores.lista} error={borradores.error} actual={borrador?.id ?? null}
        abrir={abrirBorrador} anotar={anotarBorrador} borrado={(id) => { borradores.quitar(id); if (id === borrador?.id) { setBorrador(null); setGuardadoComo(null); setParams({}, { replace: true }); } }} />
      <div className="contenido llenar">
        <div className="card">
          <div className="card-cab"><b>1. De dónde salen los datos</b></div>
          <div className="card-cuerpo pila" style={{ gap: 12 }}>
            {borrador && (
              <div className="aviso info borrador-aviso">
                <Save size={15} />
                <span>Borrador <b>«{borrador.nombre}»</b>: guardado {hace(borrador.guardado)}, {seBorra(borrador.vence)}.{sucio && <b> Tiene cambios sin guardar.</b>}</span>
                {borrador.tramiteId
                  ? <Link className="btn btn-sm" to={`/tramites/${borrador.tramiteId}`} title="Abrir el expediente"><ExternalLink size={13} />Trámite {borrador.tramite ?? ""}</Link>
                  : <button className="btn btn-sm btn-primario" onClick={() => setAnotar(hojasDeFormatos(d, fotosDoc))} disabled={!hayDatos} title="Anotar el trámite con estos datos: se abre Registrar trámite ya armado"><ClipboardPlus size={13} />Anotar trámite</button>}
                <button className="btn btn-sm" onClick={empezarNuevo}><FilePlus size={13} />Empezar uno nuevo</button>
              </div>
            )}
            {deConsulta && <div className="aviso info"><ShieldCheck size={15} />Llegó de la consulta rápida: «{deConsulta}». Revise los datos y la vista previa antes de imprimir.</div>}
            {delCelular && <div className="aviso info"><Smartphone size={15} />Llegó del celular: «{delCelular}». Revise los datos y la vista previa antes de imprimir.</div>}
            <Campo etiqueta="Trámite" ayuda="Trae la placa, las personas y el organismo del trámite. Las fotos de abajo completan lo que le falte.">
              <Buscador opciones={opciones} elegido={tramiteId ?? borrador?.tramiteId ?? null} elegir={(id) => { setDelCelular(null); setDeConsulta(null); setEnVivo([]); setFotos((n) => n + 1); setFotosDoc({}); copias.current.clear(); if (id) setParams({ tramite: id }); else { setParams({}); setD(datosVacios()); } }} placeholder="Buscar por número, placa o cliente…" />
            </Campo>
            <div className={`llenar-vivo${enVivo.length ? " con" : ""}`}>
              <Smartphone size={15} />
              {enVivo.length
                ? <span>Del celular, en vivo: {enVivo.map((x) => <span key={x.id} className="llenar-vivo-item"><Check size={13} />{NOMBRE_DOC[x.doc]}{x.texto ? ` (${x.texto})` : ""}</span>)}</span>
                : <span>También con el celular: app <b>Fotos Pira</b> → <b>Formatos</b>. Cada foto que lea llega sola aquí, a los pocos segundos.</span>}
              {vivoCaido && <span className="peq tenue">(sin conexión: se reintenta sola)</span>}
            </div>
            <div className="llenar-fotos">
              {/* Cada foto (tomada aquí, del celular o del borrador) se ve, se abre en grande y va al trámite al anotarlo. */}
              <div><span className="peq muted">Tarjeta de propiedad</span><LeerFoto key={`t${fotos}`} tipo="tarjeta_propiedad" compacta alLeer={leerTarjeta} alFoto={ponerFoto("tarjeta")} puesta={fotosDoc.tarjeta} /></div>
              <div><span className="peq muted">Cédula del propietario (vendedor)</span><LeerFoto key={`p${fotos}`} tipo="cedula" compacta alLeer={(x) => poner({ propietario: { ...d.propietario, ...desdeCedula(x) } })} alFoto={ponerFoto("propietario")} puesta={fotosDoc.propietario} /></div>
              <div><span className="peq muted">Cédula del comprador</span><LeerFoto key={`c${fotos}`} tipo="cedula" compacta alLeer={(x) => { poner({ comprador: { ...(d.comprador ?? personaVacia()), ...desdeCedula(x) } }); setElegidos((e) => [...new Set<Formato>([...e, "compraventa"])]); }} alFoto={ponerFoto("comprador")} puesta={fotosDoc.comprador} /></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><b>2. Revisar los datos</b><span className="peq tenue">Lo que quede vacío sale en blanco para llenarlo a mano</span></div>
          <div className="card-cuerpo pila" style={{ gap: 16 }}>
            <div>
              <div className="llenar-titulo">Trámite solicitado (punto 3 del formulario)</div>
              <div className="fila-wrap" style={{ gap: 6 }}>
                {CASILLAS_FUN.map((c) => {
                  const on = d.casillas.includes(c.n);
                  return <button key={c.n} className={`filtro-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => marcarCasilla(c.n, on)}>{c.n}. {c.nombre}</button>;
                })}
              </div>
            </div>
            <div className="llenar-grilla">
              <Campo etiqueta="Organismo de tránsito">
                <select className="input" value={organismos.find((o) => o.nombre === d.organismo.nombre)?.id ?? ""} onChange={(e) => { const o = organismos.find((x) => x.id === e.target.value); poner({ organismo: { nombre: o?.nombre ?? "", ciudad: o?.ciudad ?? "" } }); }}>
                  <option value="">Sin organismo</option>
                  {organismos.map((o) => <option key={o.id} value={o.id}>{o.ciudad ? `${o.ciudad} · ${o.nombre}` : o.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Fecha"><Fecha valor={d.fecha} cambiar={(v) => poner({ fecha: v || hoy() })} /></Campo>
              <Campo etiqueta="Ciudad donde se firma"><Texto valor={d.ciudadFirma} cambiar={(v) => poner({ ciudadFirma: v })} /></Campo>
              <Campo etiqueta="Trámite (como va en el mandato)"><Texto valor={d.tramiteTexto} cambiar={(v) => poner({ tramiteTexto: v })} placeholder="traspaso" /></Campo>
            </div>

            <div>
              <div className="llenar-titulo">Vehículo</div>
              <div className="llenar-grilla">
                {([["placa", "Placa"], ["marca", "Marca"], ["linea", "Línea"], ["modelo", "Modelo"], ["clase", "Clase"], ["color", "Color"], ["cilindraje", "Cilindraje"], ["servicio", "Servicio"],
                  ["combustible", "Combustible"], ["capacidad", "Capacidad"], ["potencia", "Potencia (HP)"], ["carroceria", "Carrocería"], ["motor", "N° de motor"], ["chasis", "N° de chasis"], ["serie", "N° de serie"], ["vin", "VIN"], ["matriculadoEn", "Matriculado en"]] as [keyof VehiculoFormato, string][])
                  .map(([k, n]) => <Campo key={k} etiqueta={n}><Texto valor={d.vehiculo[k]} cambiar={(v) => { ponerVehiculo({ [k]: v }); setPdf(null); }} mayusculas={k === "placa"} /></Campo>)}
              </div>
            </div>

            <EditorPersona titulo="Propietario (vendedor)" p={d.propietario} cambiar={(p) => poner({ propietario: p })} />
            {d.comprador
              ? <EditorPersona titulo="Comprador" p={d.comprador} cambiar={(p) => poner({ comprador: p })} quitar={() => { poner({ comprador: null }); setElegidos((e) => e.filter((x) => x !== "mandato_comprador" && x !== "compraventa")); }} />
              : <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => { poner({ comprador: personaVacia() }); setElegidos((e) => [...new Set<Formato>([...e, "compraventa"])]); }}><UserPlus size={13} />Agregar comprador (traspaso)</button>}

            <div className="llenar-grilla">
              <Campo etiqueta="Mandatario (quien hace el trámite)" ayuda="Queda guardado en este PC."><Texto valor={d.mandatario.nombre} cambiar={(v) => poner({ mandatario: { ...d.mandatario, nombre: v } })} mayusculas /></Campo>
              <Campo etiqueta="Cédula del mandatario"><Texto valor={d.mandatario.documento} cambiar={(v) => poner({ mandatario: { ...d.mandatario, documento: v.replace(/\D/g, "") } })} /></Campo>
              <Campo etiqueta="Precio de la compraventa (pesos)" ayuda={Number(d.precio) ? `${precioEnLetras(Number(d.precio)).toLowerCase()} pesos` : "En letras se escribe solo."}>
                <Texto valor={Number(d.precio) ? Number(d.precio).toLocaleString("es-CO") : d.precio} cambiar={(v) => poner({ precio: v.replace(/\D/g, "") })} placeholder="10.000.000" />
              </Campo>
              <Campo etiqueta="Forma de pago"><Texto valor={d.formaPago} cambiar={(v) => poner({ formaPago: v })} placeholder="de contado" /></Campo>
              <Campo etiqueta="Observaciones (formulario único)"><Texto valor={d.observaciones} cambiar={(v) => poner({ observaciones: v })} /></Campo>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><b>3. Vista previa</b><span className="peq tenue">Así sale impreso. Toque cualquier dato para corregirlo.</span></div>
          <div className="card-cuerpo pila" style={{ gap: 12 }}>
            <div className="fila-wrap" style={{ gap: "6px 18px" }}>
              {(["fun", "mandato_propietario"] as Formato[]).map(elegir)}
            </div>
            {faltan.length > 0 && <div className="aviso info">Falta {faltan.join(", ")}: puede escribirlo en la vista previa o dejarlo para llenarlo a mano.</div>}
            <div className="fila-wrap llenar-acciones" style={{ gap: 8 }}>
              <button className="btn btn-primario" disabled={!!generando || !visibles.length} onClick={() => accion("imprimir")}>{generando === "imprimir" ? <Loader2 size={15} className="girando" /> : <Printer size={15} />}Imprimir todo junto</button>
              <button className="btn" disabled={!!generando || !visibles.length} onClick={() => accion("descargar")}>{generando === "descargar" ? <Loader2 size={15} className="girando" /> : <Download size={15} />}Descargar todo en PDF</button>
              <button className="btn" disabled={!!generando || !visibles.length} onClick={() => accion("abrir")}><ExternalLink size={15} />Abrir PDF</button>
              {botonGuardar(true)}
              {corregidas > 0 && <button className="btn btn-fantasma" onClick={() => { setCambios({}); setPdf(null); }} title="Deja los formatos con los datos de arriba"><RotateCcw size={15} />Quitar {corregidas} {corregidas === 1 ? "corrección" : "correcciones"}</button>}
            </div>
            {visibles.length > 0 && <div className="peq tenue">Hoja por hoja: cada vista tiene su «Imprimir esta hoja». El respaldo del formulario único se imprime aparte, metiendo otra vez la hoja con el frente ya impreso.</div>}
            {visibles.includes("fun") && <><VistaFormato formato="fun" d={d} cambios={cambios} corregir={corregir} acciones={botonesHoja("fun")} /><VistaReverso formato="fun" acciones={botonesHoja("fun", 1)} /></>}
            {visibles.includes("mandato_propietario") && <VistaFormato formato="mandato_propietario" d={d} cambios={cambios} corregir={corregir} acciones={botonesHoja("mandato_propietario")} />}
            {d.comprador && (
              <details className="llenar-plegable" open={d.casillas.includes(CASILLA_TRASPASO) || undefined}>
                <summary>Contrato de compraventa {visibles.includes("compraventa") ? <small>(va en el PDF)</small> : <small>(no va en el PDF)</small>}</summary>
                <div className="pila" style={{ gap: 10, marginTop: 10 }}>
                  {elegir("compraventa")}
                  <VistaFormato formato="compraventa" d={d} cambios={cambios} corregir={corregir} acciones={botonesHoja("compraventa")} />
                </div>
              </details>
            )}
            <details className="llenar-plegable">
              <summary>Ver más: contrato de mandato del comprador <small>(casi nunca se usa)</small></summary>
              <div className="pila" style={{ gap: 10, marginTop: 10 }}>
                {elegir("mandato_comprador")}
                {d.comprador && visibles.includes("mandato_comprador") && <VistaFormato formato="mandato_comprador" d={d} cambios={cambios} corregir={corregir} acciones={botonesHoja("mandato_comprador")} />}
              </div>
            </details>
            <div className="peq tenue">Al imprimir: tamaño Carta (la compraventa va en Oficio), escala 100 %. El formulario único va horizontal. «Imprimir todo junto» manda todas las hojas seguidas (el respaldo justo después del frente, para impresora a doble cara); si la impresora no imprime por las dos caras, use los botones de cada hoja.</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** La casilla "2. Traspaso" del punto 3 del formulario único. */
const CASILLA_TRASPASO = 2;
const sinDatos = (p: PersonaFormato) => !p.nombres && !p.apellido1 && !p.apellido2 && !p.documento && !p.direccion && !p.ciudad && !p.telefono;

function EditorPersona({ titulo, p, cambiar, quitar }: { titulo: string; p: PersonaFormato; cambiar: (p: PersonaFormato) => void; quitar?: () => void }) {
  const campo = (k: keyof PersonaFormato) => (v: string) => cambiar({ ...p, [k]: k === "documento" || k === "telefono" ? v.replace(/\D/g, "") : v });
  return (
    <div>
      <div className="llenar-titulo">{titulo}{quitar && <button className="btn btn-sm btn-fantasma" onClick={quitar} title="Quitar comprador"><X size={13} />Quitar</button>}</div>
      <div className="llenar-grilla">
        <Campo etiqueta="Nombres"><Texto valor={p.nombres} cambiar={campo("nombres")} mayusculas /></Campo>
        <Campo etiqueta="Primer apellido"><Texto valor={p.apellido1} cambiar={campo("apellido1")} mayusculas /></Campo>
        <Campo etiqueta="Segundo apellido"><Texto valor={p.apellido2} cambiar={campo("apellido2")} mayusculas /></Campo>
        <Campo etiqueta="Documento">
          <div className="fila" style={{ gap: 6 }}>
            <select className="input" style={{ width: 80 }} value={p.tipoDocumento} onChange={(e) => cambiar({ ...p, tipoDocumento: e.target.value })} aria-label="Tipo de documento">
              {["CC", "CE", "NIT", "PA", "TI"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <Texto valor={p.documento} cambiar={campo("documento")} />
          </div>
        </Campo>
        <Campo etiqueta="Dirección"><Texto valor={p.direccion} cambiar={campo("direccion")} /></Campo>
        <Campo etiqueta="Ciudad"><Texto valor={p.ciudad} cambiar={campo("ciudad")} /></Campo>
        <Campo etiqueta="Teléfono"><Texto valor={p.telefono} cambiar={campo("telefono")} /></Campo>
      </div>
    </div>
  );
}
