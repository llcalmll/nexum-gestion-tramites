import { AlertTriangle, Camera, Check, ExternalLink, FileText, FileUp, Info, Loader2, RotateCw, ShieldCheck, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CAMPOS_VEHICULO_BORRADOR, CATEGORIAS_LICENCIA, CLASES_HOJA, combinarHojas, type Borrador, type ClaseHoja, type HojaLeida, type PersonaBorrador } from "../../compartido/registro";
import { avisosEdadLicencia, sumarDiasHabiles } from "../../compartido/reglas";
import { hoyISO } from "../logica/formato";
import { aBorrador, ClienteGuardado, CobroEditable, PlacaGuardada, type CostosCorregidos, type PersonaGuardada } from "./FormularioTramite";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import type { ParteRevision } from "../../compartido/revision";
import { mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { desdeBorrador } from "../formatos/desdeFotos";
import type { DatosFormatos, Formato } from "../formatos/llenado";
import { FaltoAlgo } from "./ConsultasRunt";
import { BotonPegar, usePegarImagenes } from "./Pegar";
import { girarFoto, leerDerecha, prepararFoto } from "../logica/foto";
import { subirFoto } from "../pantallas/movil/comun";

/*
 * Registrar un trámite desde las fotos de sus documentos (lo que haya: tarjeta, cédulas, formulario único y mandato
 * llenos a mano, compraventa, el sobre con notas). Dos pasos:
 *   1. Hojas: se suben o se toman las fotos; cada una se lee sola (qué es y qué trae). Se pueden girar o cambiar de clase.
 *   2. Confirmar: el trámite armado con todas las hojas (sin IA: compartido/registro.ts). Lo que dos hojas dicen distinto
 *      se elige con un toque; lo que solo sale de algo escrito a mano va marcado para revisarlo. Una sola pregunta: qué
 *      hacer con las precondiciones. Al guardar, las fotos quedan pegadas en sus documentos.
 * Lo usan la pantalla Registrar, el asistente (fotos adjuntas + "guárdame este trámite") y la app del celular.
 *
 * Licencias (refrendación/renovación, primera vez...): con el recibo de pago, la cédula o la licencia; sin vehículo,
 * con el titular, su fecha de nacimiento y las categorías.
 *
 * Nuevo trámite (`manual`, en el PC y en el celular): este mismo formulario, vacío desde el comienzo (sin fotos). Los
 * clientes y la placa se escriben o se eligen de los ya guardados; un texto como el que se le escribe al asistente lo
 * llena (sin IA), y también se le pueden agregar fotos de los documentos. El cobro sugerido se corrige ahí mismo; va
 * con la entrega estimada y la preanotación (guardar aunque falte un dato esencial).
 *
 * Consulta rápida (`consulta`): las mismas hojas (tarjeta y las dos cédulas, en foto o fotocopia) se leen y se
 * consultan con el RUNT de una vez. Con el resultado, dos casillas: guardar el trámite y llenar los formularios; se
 * marcan las dos, una o ninguna (solo consultar).
 */

export interface Catalogo {
  tipos: { id: string; nombre: string; categoria: string; requiereVehiculo?: boolean; slaDias?: number | null }[];
  organismos: { id: string; nombre: string; ciudad: string | null }[];
  placapi?: boolean;
  /** Ibagué: casi todo se hace allá. */
  organismoPorDefecto?: string | null;
}
/** Una hoja: la foto ya preparada (JPEG, lado mayor 2000 px) y lo que se leyó de ella. */
/** `foto` vacía: la hoja no viene de una foto sino de datos ya escritos (un borrador de Llenar formatos). */
export interface Hoja { clave: number; foto: string; estado: "leyendo" | "lista" | "error"; lectura?: HojaLeida; error?: string }
let siguiente = 1;
export const nuevaHoja = (foto: string): Hoja => ({ clave: siguiente++, foto, estado: "leyendo" });

/** Lee una hoja (qué es y qué trae). Si venía girada, devuelve también la foto derecha. */
export async function leerHoja(foto: string): Promise<{ lectura: HojaLeida; foto: string }> {
  try {
    const r = await leerDerecha(foto, (imagen, baja, derecha) => api<{ datos: HojaLeida; girar?: number }>("/api/leer", { method: "POST", body: JSON.stringify({ tipo: "documento", imagen, baja, derecha }) }));
    return { lectura: r.datos, foto: r.foto };
  } catch (e) {
    if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
    throw new Error(e instanceof SinConexion ? "Sin conexión: no se pudo leer." : mensajeDe(e));
  }
}

/** Gira una foto 90° a la derecha. */
const girar = (foto: string) => girarFoto(foto, 90);
const aBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

/** Lo que devuelve POST /api/registrar/verificar. */
interface Verificacion {
  id: string; placa: string; creditos: number;
  hallazgos: { tema: string; quien?: string; estado: "ok" | "alerta" | "bloquea" | "sin_dato"; detalle: string }[];
  runt: { datos: Record<string, unknown>; soat: string | null; rtm: string | null } | null;
  /** Lo que no llegó (la fuente no respondió): se puede pedir de nuevo solo eso. */
  faltaron?: ParteRevision[];
  /** Qué se consultó: el RUNT, el SIMIT o los dos. */
  consultado?: ("runt" | "simit")[];
  /** Lo que el RUNT corrigió de lo leído: campo, lo que había, lo que dice el RUNT. */
  corregidos: { campo: string; antes: string; ahora: string }[];
}
/** Qué consulta la consulta rápida: el RUNT del vehículo, el SIMIT de las personas o los dos (al menos uno). */
type Que = { runt: boolean; simit: boolean };
const alcanceDe = (q: Que) => (q.runt && q.simit ? "todo" : q.runt ? "runt" : "simit");
/** Créditos: los dos = consulta completa (3, trae también el impuesto) + 1 del comprador; RUNT solo = 1; SIMIT = 1 por cédula. */
const creditosDe = (q: Que, personas: number, conComprador: boolean) => (q.runt && q.simit ? 3 + (conComprador ? 1 : 0) : q.runt ? 1 : Math.max(1, personas));
const creditos = (n: number) => `${n} crédito${n === 1 ? "" : "s"}`;
const nombreQue = (q: { runt: boolean; simit: boolean }) => (q.runt && q.simit ? "el RUNT y el SIMIT" : q.runt ? "el RUNT" : "el SIMIT");
const QUE_TRAE = {
  todo: "Registro, SOAT, técnico-mecánica, prendas, comparendos del vendedor y del comprador, e impuesto (consulta completa).",
  runt: "Solo el RUNT del vehículo: registro, SOAT, técnico-mecánica y prendas (sin comparendos ni impuesto).",
  simit: "Solo el SIMIT: comparendos del vendedor y del comprador.",
} as const;
const ESTADO_HALLAZGO = { ok: ["OK", "rev-ok"], alerta: ["Ojo", "rev-alerta"], bloquea: ["Frena", "rev-bloquea"], sin_dato: ["Sin dato", "rev-sin"] } as const;
/** Los campos del vehículo que trae el RUNT (nombre en la respuesta -> nombre en el borrador). */
const DEL_RUNT: [string, keyof Borrador["vehiculo"]][] = [["marca", "marca"], ["linea", "linea"], ["modelo", "modelo"], ["clase", "clase"], ["color", "color"], ["cilindraje", "cilindraje"], ["servicio", "servicio"], ["motor", "motor"], ["chasis", "chasis"], ["serie", "serie"], ["vin", "vin"], ["combustible", "combustible"], ["carroceria", "carroceria"], ["capacidad", "capacidad"], ["licenciaTransito", "licenciaTransito"], ["fechaMatricula", "fechaMatricula"]];

const NOMBRE_CAMPO: Record<string, string> = { placa: "Placa", marca: "Marca", linea: "Línea", modelo: "Modelo", clase: "Clase", color: "Color", cilindraje: "Cilindraje", servicio: "Servicio", combustible: "Combustible", motor: "Motor", chasis: "Chasis", serie: "Serie", vin: "VIN", carroceria: "Carrocería", capacidad: "Capacidad", potencia: "Potencia (HP)", fechaMatricula: "Fecha de matrícula (AAAA-MM-DD)", licenciaTransito: "Licencia de tránsito No." };
/** Se ven abiertos; los demás datos de la tarjeta quedan en "Más datos de la tarjeta". */
const VEHICULO_PRINCIPAL = ["placa", "marca", "linea", "modelo", "clase", "color", "cilindraje", "motor", "chasis", "vin"];
const pesosEnTexto = (s: string) => (s.replace(/\D/g, "") ? `$${Number(s.replace(/\D/g, "")).toLocaleString("es-CO")}` : "");
/** Nuevo trámite: lo que viene armado de antes (el cliente, el trámite y la categoría desde el radar de licencias). */
export interface InicioManual { titular?: PersonaGuardada | null; tipoNombre?: string | null; categorias?: string | null; licenciaId?: string | null }
const PERSONA_VACIA: PersonaBorrador = { nombre: "", tipoDocumento: "CC", numeroDocumento: "", telefono: "", direccion: "", ciudad: "", fechaNacimiento: "", fechaExpedicionDocumento: "" };
/** Lo que se llenó después (con un texto o con fotos) se suma a lo ya escrito: manda lo nuevo, lo vacío no borra nada. */
function mezclar(a: Borrador, n: Borrador): Borrador {
  const persona = (x: PersonaBorrador | null, y: PersonaBorrador | null) => (!y ? x : !x ? y : Object.fromEntries(Object.keys(PERSONA_VACIA).map((k) => [k, y[k as keyof PersonaBorrador] || x[k as keyof PersonaBorrador]])) as unknown as PersonaBorrador);
  return {
    ...a,
    tipoIds: n.tipoIds.length ? n.tipoIds : a.tipoIds,
    organismoId: n.organismoLeido ? n.organismoId : a.organismoId, organismoLeido: n.organismoLeido || a.organismoLeido,
    vehiculo: Object.fromEntries(CAMPOS_VEHICULO_BORRADOR.map((k) => [k, n.vehiculo[k] || a.vehiculo[k]])) as Borrador["vehiculo"],
    vendedor: persona(a.vendedor, n.vendedor), comprador: persona(a.comprador, n.comprador), cliente: n.comprador ? n.cliente : a.cliente,
    valor: n.valor || a.valor, precioVenta: n.precioVenta || a.precioVenta, observaciones: n.observaciones || a.observaciones,
    abono: n.abono || a.abono, metodoAbono: n.metodoAbono || a.metodoAbono, conClases: n.conClases || a.conClases,
    categorias: n.categorias || a.categorias, pistaCategoria: n.pistaCategoria || a.pistaCategoria,
    roles: n.roles, diferencias: n.diferencias, avisos: n.avisos, fuentes: { ...a.fuentes, ...n.fuentes }, revisar: [...new Set([...a.revisar, ...n.revisar])],
  };
}

export function Registrador({ inicial = [], texto = "", movil, armarDeUna, consulta, manual, alGuardar, cancelar, abrir, llenarFormatos }: {
  inicial?: Hoja[]; texto?: string; movil?: boolean;
  /** Nuevo trámite a mano: el formulario desde el comienzo (ver el encabezado). */
  manual?: InicioManual;
  /** Si las hojas ya vienen leídas (desde el asistente), pasa de una a confirmar. */
  armarDeUna?: boolean;
  /** Consulta rápida: leer y consultar con el RUNT; guardar y llenar formularios son opcionales. */
  consulta?: boolean;
  alGuardar?: (r: { ids: string[]; numeros: string[]; avisos?: string[] }) => void; cancelar?: () => void; abrir?: (id: string) => void;
  /** Abre los formatos con estos datos (consulta rápida). */
  llenarFormatos?: (f: { datos: DatosFormatos; elegidos: Formato[] }) => void;
}) {
  const [hojas, setHojas] = useState<Hoja[]>(inicial);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [precond, setPrecond] = useState<"cumplidas" | "pendientes" | "placapi" | "">("");
  const [aliado, setAliado] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ ids: string[]; numeros: string[]; avisos: string[] } | null>(null);
  const [verif, setVerif] = useState<Verificacion | null>(null);
  const [verificando, setVerificando] = useState(false);
  /** Consulta rápida: lo que se hace después de consultar. */
  const [sigue, setSigue] = useState({ guardar: false, formatos: false });
  /** Consulta rápida: qué consultar (los dos de entrada: todo de una). */
  const [que, setQue] = useState<Que>({ runt: true, simit: true });
  const archivos = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const zonaHojas = useRef<HTMLDivElement>(null);
  const leyendo = useRef(new Set<number>());
  // ── Nuevo trámite (manual) ──
  /** El texto como se le escribe al asistente ("traspaso de la ABC123, vende..."): llena el formulario sin IA. */
  const [nota, setNota] = useState("");
  /** Las fotos de los documentos, para llenar el formulario con ellas (sin perder lo ya escrito). */
  const [verHojas, setVerHojas] = useState(false);
  /** Las personas elegidas de las ya guardadas (vendedor/titular y comprador): se usan esas al guardar. */
  const [guardados, setGuardados] = useState<{ vendedor?: string; comprador?: string }>({});
  const [preanotar, setPreanotar] = useState(false);
  const [entrega, setEntrega] = useState({ fecha: "", aMano: false });
  const [cuenta, setCuenta] = useState<{ corregidos: CostosCorregidos; total: number }>({ corregidos: [], total: 0 });

  useEffect(() => { api<Catalogo>("/api/movil/catalogo").then(setCat, (e) => setError(mensajeDe(e))); }, []);
  const yaArmo = useRef(false);
  // Las hojas que llegan sin leer se leen solas (de a tres a la vez).
  useEffect(() => {
    const pendientes = hojas.filter((h) => h.estado === "leyendo" && !leyendo.current.has(h.clave)).slice(0, Math.max(0, 3 - leyendo.current.size));
    for (const h of pendientes) {
      leyendo.current.add(h.clave);
      leerHoja(h.foto).then(
        ({ lectura, foto }) => setHojas((hs) => hs.map((x) => (x.clave === h.clave ? { ...x, estado: "lista", lectura, foto } : x))),
        (e) => setHojas((hs) => hs.map((x) => (x.clave === h.clave ? { ...x, estado: "error", error: mensajeDe(e) } : x))),
      ).finally(() => { leyendo.current.delete(h.clave); setHojas((hs) => [...hs]); });
    }
  }, [hojas]);

  async function agregar(lista: FileList | File[]) {
    setError(null);
    for (const f of [...lista].filter((x) => x.type.startsWith("image/"))) {
      try { const foto = await prepararFoto(f); setHojas((hs) => [...hs, nuevaHoja(foto)]); }
      catch (e) { setError(mensajeDe(e)); }
    }
  }
  // Ctrl+V: la imagen copiada (de WhatsApp...) entra como una hoja más, sin descargarla.
  usePegarImagenes(zonaHojas, (f) => agregar(f), !b && !hecho);
  const poner = (clave: number, cambios: Partial<Hoja>) => setHojas((hs) => hs.map((h) => (h.clave === clave ? { ...h, ...cambios } : h)));
  const listas = hojas.filter((h) => h.estado === "lista" && h.lectura);
  const leyendoAlgo = hojas.some((h) => h.estado === "leyendo");

  function armar(): Borrador | null {
    if (!cat) return null;
    const leidas = listas.map((h) => h.lectura!);
    let armado = combinarHojas(leidas, cat, [texto, nota].filter(Boolean).join(" "));
    // Consulta rápida con dos cédulas y nada que diga el trámite: es un traspaso (vende uno, compra el otro).
    if (consulta && !armado.tipoIds.length && leidas.filter((l) => l.clase === "cedula").length >= 2) armado = combinarHojas(leidas, cat, `${texto} traspaso`);
    // Si ninguna hoja dice el organismo, queda Ibagué (casi todo se hace allá); si dicen otro, ese.
    // Escrito a mano, la placa sale del texto ("traspaso de la ABC123", "ABC123").
    const placaDicha = manual && !armado.vehiculo.placa ? nota.toUpperCase().match(/\b([A-Z]{3})[\s-]?(\d{2}[A-Z0-9])\b/) : null;
    if (placaDicha) armado = { ...armado, vehiculo: { ...armado.vehiculo, placa: placaDicha[1] + placaDicha[2] } };
    const listo = armado.organismoId || armado.organismoLeido ? armado : { ...armado, organismoId: cat.organismoPorDefecto ?? "" };
    // Nuevo trámite: se suma a lo que ya estaba escrito.
    if (manual && b) {
      // Los avisos de "no se sabe" no aplican: el formulario ya está a la vista para escribirlo.
      const m = mezclar(b, listo);
      setB({ ...m, avisos: m.avisos.filter((x) => !/^Ninguna hoja trae la placa|^No se sabe qué trámite/.test(x)) });
      setVerHojas(false);
      return listo;
    }
    setB(listo);
    setPrecond("");
    setVerif(null);
    return listo;
  }
  // Nuevo trámite: el formulario arranca vacío (en Ibagué), con lo que venga armado de antes.
  const empezo = useRef(false);
  useEffect(() => {
    if (!manual || empezo.current || !cat) return;
    empezo.current = true;
    const vacio = combinarHojas([], cat, "");
    const tipo = manual.tipoNombre ? cat.tipos.find((t) => t.nombre === manual.tipoNombre)?.id : undefined;
    setB({ ...vacio, avisos: [], organismoId: cat.organismoPorDefecto ?? "", tipoIds: tipo ? [tipo] : [], categorias: manual.categorias ?? "", vendedor: manual.titular ? aBorrador(manual.titular) : null, cliente: manual.titular ? "vendedor" : "comprador" });
    if (manual.titular) setGuardados({ vendedor: manual.titular.id });
  }, [manual, cat]);
  // La entrega estimada sale de los días del trámite, hasta que se escriba a mano.
  const slaManual = manual && b && cat ? Math.max(0, ...cat.tipos.filter((t) => b.tipoIds.includes(t.id)).map((t) => t.slaDias ?? 0)) : 0;
  useEffect(() => { if (manual && !entrega.aMano) setEntrega({ fecha: slaManual ? sumarDiasHabiles(hoyISO(), slaManual) : "", aMano: false }); }, [slaManual]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Consulta rápida: arma con las hojas y consulta con el RUNT de una vez (si están la placa y la cédula del dueño). */
  function consultar() {
    armadoCon.current = listasClave;
    const x = armar();
    // El RUNT pide la placa y la cédula del dueño; el SIMIT, al menos una cédula.
    const puede = x && cat?.placapi && (que.runt ? x.vehiculo.placa && x.vendedor?.numeroDocumento : x.vendedor?.numeroDocumento || x.comprador?.numeroDocumento);
    if (puede) verificar(x);
  }
  useEffect(() => {
    if (!armarDeUna || yaArmo.current || !cat || !hojas.length || hojas.some((h) => h.estado === "leyendo")) return;
    yaArmo.current = true;
    armadoCon.current = listasClave;
    armar();
  });
  // Paso 2 abierto: si cambian las hojas, se vuelve a armar (avisando que se pierden los cambios hechos a mano).
  const listasClave = listas.map((h) => `${h.clave}:${h.lectura!.clase}`).join(",");
  const armadoCon = useRef("");
  useEffect(() => { if (!manual && b && armadoCon.current && armadoCon.current !== listasClave) setB(null); }, [listasClave, b, manual]);

  /** Verifica todo con el RUNT antes de guardar: corrige el vehículo con lo oficial y muestra lo que frena. */
  /** Verifica (con `reintento`: pide de nuevo lo que no llegó; con `agregar`: le suma el RUNT o el SIMIT que no se pidió). */
  async function verificar(base: Borrador | null = b, reintento?: Verificacion, agregar?: "runt" | "simit") {
    if (!base) return;
    setVerificando(true); setError(null);
    try {
      const ruta = reintento ? `/api/registrar/verificar/${reintento.id}/${agregar ? "agregar" : "reintentar"}` : "/api/registrar/verificar";
      const r = await api<Omit<Verificacion, "placa" | "corregidos">>(ruta, {
        method: "POST",
        body: JSON.stringify({ tipoIds: base.tipoIds, placa: base.vehiculo.placa, vendedor: base.vendedor, comprador: base.comprador, alcance: agregar ?? (consulta ? alcanceDe(que) : "todo") }),
      });
      const b = base;
      const corregidos: Verificacion["corregidos"] = [...(reintento?.corregidos ?? [])];
      const vehiculo = { ...b.vehiculo };
      const fuentes = { ...b.fuentes };
      let revisarCampos = b.revisar;
      for (const [k, campo] of DEL_RUNT) {
        const v = r.runt?.datos[k];
        if (v === null || v === undefined || String(v).trim() === "") continue;
        const ahora = campo === "servicio" ? String(v).toLowerCase() : String(v).toUpperCase().trim();
        if (vehiculo[campo] && vehiculo[campo].replace(/\W/g, "") !== ahora.replace(/\W/g, "") && campo !== "servicio" && !corregidos.some((c) => c.campo === (NOMBRE_CAMPO[campo] ?? campo))) corregidos.push({ campo: NOMBRE_CAMPO[campo] ?? campo, antes: vehiculo[campo], ahora });
        vehiculo[campo] = ahora;
        fuentes[`vehiculo.${campo}`] = ["RUNT"];
        revisarCampos = revisarCampos.filter((x) => x !== `vehiculo.${campo}`);
      }
      // La placa y la cédula del dueño quedaron confirmadas si el RUNT respondió con el vehículo.
      if (r.runt) { fuentes["vehiculo.placa"] = ["RUNT"]; fuentes["vendedor.numeroDocumento"] = ["RUNT"]; revisarCampos = revisarCampos.filter((x) => x !== "vehiculo.placa" && x !== "vendedor.numeroDocumento"); }
      setB({ ...b, vehiculo, fuentes, revisar: revisarCampos, diferencias: r.runt ? b.diferencias.filter((d) => !d.campo.startsWith("vehiculo.") && d.campo !== "vendedor.numeroDocumento") : b.diferencias });
      setVerif({ ...r, placa: b.vehiculo.placa, corregidos });
      if (r.runt || r.consultado?.length) setPrecond((p) => p || "placapi");
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: no se pudo verificar." : mensajeDe(e));
    } finally { setVerificando(false); }
  }

  async function guardar() {
    if (!b || !cat) return false;
    setGuardando(true); setError(null);
    try {
      // Las fotos van a una sesión privada; el servidor las pega a sus documentos y la sesión se borra a las 48 horas.
      const { sesion } = await api<{ sesion: string }>("/api/fotos/sesiones", { method: "POST" });
      const fotos = [];
      for (const [i, h] of listas.entries()) {
        if (!h.foto) continue; // datos escritos (un borrador): no hay foto que pegar
        const nombre = await subirFoto(sesion, await aBlob(h.foto));
        // Un recibo de caja menor (la lectura lo dice en las notas) queda con su nombre, no como "Nota de la oficina".
        const recibo = h.lectura!.clase === "nota" && /recibo de caja/i.test(h.lectura!.notas ?? "") ? "Recibo de caja menor" : null;
        fotos.push({ ref: `${sesion}/${nombre}`, clase: h.lectura!.clase, rol: b.roles[i] ?? null, nombre: recibo });
      }
      const persona = (p: PersonaBorrador | null, r: "vendedor" | "comprador") => (p && p.nombre ? { ...p, clienteId: guardados[r] ?? null } : null);
      const r = await api<{ ids: string[]; numeros: string[]; avisos: string[] }>("/api/registrar", {
        method: "POST",
        body: JSON.stringify({
          tipoIds: b.tipoIds, organismoId: b.organismoId || null, cliente: b.cliente, vehiculo: b.vehiculo, vendedor: persona(b.vendedor, "vendedor"), comprador: persona(b.comprador, "comprador"), categorias: b.categorias,
          // A mano, el cobro va corregido por línea (no un valor total).
          valor: manual ? null : b.valor || null, abono: b.abono || null, conClases: expedicion && b.conClases ? b.conClases === "con" : null, metodoAbono: b.metodoAbono || null, aliado: aliado || null, observaciones: b.observaciones || null, precondiciones: precond, fotos,
          // La verificación ya pagada se aplica al guardar (si la placa no cambió después).
          verificacionId: verif && verif.placa === b.vehiculo.placa ? verif.id : null,
          ...(manual ? { desde: "nuevo", preanotacion: preanotar, fechaEstimadaEntrega: entrega.fecha || null, licenciaId: manual.licenciaId ?? null, costos: cuenta.corregidos } : {}),
        }),
      });
      setHecho(r);
      alGuardar?.(r);
      return true;
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: no se guardó. Intente de nuevo." : mensajeDe(e));
      return false;
    } finally { setGuardando(false); }
  }

  function reiniciar() { setHecho(null); setB(null); setHojas([]); setPrecond(""); setAliado(""); setVerif(null); setSigue({ guardar: false, formatos: false }); setError(null); setNota(""); setGuardados({}); setPreanotar(false); setEntrega({ fecha: "", aMano: false }); empezo.current = false; }

  /** Los interruptores RUNT y SIMIT (al menos uno encendido). */
  const elegirQue = (
    <div className="consulta-que" role="group" aria-label="Qué consultar">
      <span className="peq">Consultar:</span>
      {(["runt", "simit"] as const).map((k) => {
        const unico = que[k] && !que[k === "runt" ? "simit" : "runt"];
        return (
          <button key={k} type="button" role="switch" aria-checked={que[k]} className={`cot-chip${que[k] ? " on" : ""}`} title={unico ? "Al menos uno queda encendido" : undefined}
            onClick={() => { if (!unico) setQue((x) => ({ ...x, [k]: !x[k] })); }}>{k === "runt" ? "RUNT" : "SIMIT"}</button>
        );
      })}
      <small className="tenue">{QUE_TRAE[alcanceDe(que)]}</small>
    </div>
  );

  /** Consulta rápida: guarda, abre los formatos, las dos cosas o ninguna (solo se consultó: queda lista para otra). */
  async function continuar() {
    if (!b || !cat) return;
    const f = sigue.formatos ? desdeBorrador(b, cat.tipos, cat.organismos) : null;
    if (sigue.guardar && !(await guardar())) return;
    if (f) llenarFormatos?.(f);
    else if (!sigue.guardar) reiniciar();
  }

  if (hecho) {
    return (
      <div className="bloque-ia registrador">
        <div className="reg-hecho"><Check size={18} /><b>Quedó registrado: {hecho.numeros.join(", ")}</b></div>
        {hecho.avisos.map((a) => <div key={a} className="peq cot-aviso">{a}</div>)}
        <div className="fila-wrap" style={{ gap: 6 }}>
          {abrir && <button className="btn btn-sm" onClick={() => abrir(hecho.ids[0])}><ExternalLink size={13} />Abrir el trámite</button>}
          <button className="btn btn-sm" onClick={reiniciar}>{consulta ? "Nueva consulta" : "Registrar otro"}</button>
        </div>
      </div>
    );
  }

  // Nuevo trámite: mientras llega el catálogo.
  if (manual && !b && !verHojas) return <div className="bloque-ia registrador"><span className="peq"><Loader2 size={13} className="girando" /> Preparando el formulario…</span>{error && <div className="peq cot-aviso">{error}</div>}</div>;

  // ── Paso 1: las hojas ──
  if (!b || verHojas) {
    const cedulas = listas.filter((h) => h.lectura!.clase === "cedula").length;
    return (
      <div ref={zonaHojas} className="bloque-ia registrador" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); agregar(e.dataTransfer.files); }}>
        <b>{consulta ? "Tarjeta de propiedad y cédulas" : "Las hojas del trámite"}</b>
        <div className="peq tenue">{consulta
          ? "La tarjeta de propiedad y las cédulas del vendedor y del comprador, en foto o fotocopia, en cualquier orden. Se leen solas y se consultan con el RUNT."
          : "Tarjeta de propiedad, cédulas, formulario único, mandato, compraventa, el sobre con las notas, o el recibo de pago de una licencia (refrendación, primera vez): lo que tenga, en cualquier orden."}</div>
        <div className="reg-hojas">
          {hojas.map((h) => (
            <div key={h.clave} className={`reg-hoja ${h.estado}`}>
              {h.foto ? <img src={h.foto} alt="" /> : <span className="reg-hoja-datos peq">Datos del borrador</span>}
              {h.estado === "leyendo" ? <span className="peq"><Loader2 size={12} className="girando" /> Leyendo…</span>
                : h.estado === "error" ? <span className="peq cot-aviso" title={h.error}>No se pudo leer</span>
                : (
                  <select className="input" aria-label="Qué es esta hoja" value={h.lectura!.clase} onChange={(e) => poner(h.clave, { lectura: { ...h.lectura!, clase: e.target.value as ClaseHoja } })}>
                    {CLASES_HOJA.map((c) => <option key={c.clase} value={c.clase}>{c.nombre}</option>)}
                  </select>
                )}
              <div className="fila" style={{ gap: 2 }}>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Girar y volver a leer" aria-label="Girar" disabled={h.estado === "leyendo" || !h.foto} onClick={async () => poner(h.clave, { foto: await girar(h.foto), estado: "leyendo", lectura: undefined })}><RotateCw size={13} /></button>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Quitar" aria-label="Quitar hoja" onClick={() => setHojas((hs) => hs.filter((x) => x.clave !== h.clave))}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          <button className="reg-agregar" onClick={() => archivos.current?.click()}><FileUp size={20} />Agregar fotos</button>
          {movil && <button className="reg-agregar" onClick={() => camara.current?.click()}><Camera size={20} />Tomar foto</button>}
          {!movil && <BotonPegar recibir={(f) => agregar(f)} className="reg-agregar" texto="Pegar imagen" alError={setError} />}
        </div>
        {!movil && <small className="tenue">También puede pegar con Ctrl+V una imagen copiada (de WhatsApp: clic derecho → Copiar imagen).</small>}
        <input ref={archivos} type="file" accept="image/*" multiple hidden aria-label="Fotos de las hojas" onChange={(e) => { agregar(e.target.files ?? []); e.target.value = ""; }} />
        <input ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto de una hoja" onChange={(e) => { agregar(e.target.files ?? []); e.target.value = ""; }} />
        {consulta && cat?.placapi && elegirQue}
        {consulta && cat && !cat.placapi && <div className="peq cot-aviso">PlacApi no está conectado: se leen las hojas, pero la consulta con el RUNT no está disponible.</div>}
        {error && <div className="peq cot-aviso">{error}</div>}
        <div className="fila" style={{ gap: 6 }}>
          {consulta ? (
            <button className="btn btn-sm btn-primario" disabled={!listas.length || leyendoAlgo || !cat} onClick={consultar}>
              {leyendoAlgo ? <><Loader2 size={13} className="girando" />Leyendo…</> : <><ShieldCheck size={13} />{cat?.placapi ? `Consultar ${nombreQue(que)} (${creditos(creditosDe(que, Math.min(2, cedulas), cedulas >= 2))})` : "Ver lo leído"}</>}
            </button>
          ) : (
            <button className="btn btn-sm btn-primario" disabled={!listas.length || leyendoAlgo || !cat} onClick={() => { armadoCon.current = listasClave; armar(); }}>
              {leyendoAlgo ? <><Loader2 size={13} className="girando" />Leyendo…</> : manual ? "Llenar el formulario con estas fotos" : "Armar el trámite"}
            </button>
          )}
          {manual ? <button className="btn btn-sm" onClick={() => setVerHojas(false)}>Volver al formulario</button> : cancelar && <button className="btn btn-sm" onClick={cancelar}>Cancelar</button>}
        </div>
      </div>
    );
  }

  // ── Paso 2: confirmar ──
  const bb = b;
  const deVehiculo = cat!.tipos.filter((t) => t.categoria === "vehiculo");
  /** SOAT, técnico-mecánica, comparendos: solo a mano (con o sin placa, según el trámite). */
  const deSeguros = manual ? cat!.tipos.filter((t) => t.categoria === "seguros_multas") : [];
  const elegidosTipos = cat!.tipos.filter((t) => b.tipoIds.includes(t.id));
  const pideVehiculo = elegidosTipos.some((t) => t.requiereVehiculo);
  /** A mano, el vehículo se oculta solo si lo elegido no lo usa (un comparendo) y no hay placa escrita. */
  const sinVehiculo = !!manual && elegidosTipos.length > 0 && !pideVehiculo && !elegidosTipos.some((t) => t.categoria === "vehiculo") && !b.vehiculo.placa;
  const deLicencia = consulta ? [] : cat!.tipos.filter((t) => t.categoria === "licencia");
  /** Trámite de licencia: sin vehículo; la persona es el titular. No se mezcla con los de vehículo. */
  const licencia = deLicencia.some((t) => b.tipoIds.includes(t.id));
  const traspaso = !licencia && deVehiculo.some((t) => b.tipoIds.includes(t.id) && /traspaso/i.test(t.nombre));
  // Primera vez: con clases o sin clases (en los dos casos la persona firma la carta de compromiso de terminarlas).
  const expedicion = licencia && deLicencia.some((t) => b.tipoIds.includes(t.id) && /expedici[oó]n/i.test(t.nombre));
  const compromiso = expedicion;
  const set = (c: Partial<Borrador>) => setB({ ...b, ...c });
  const setPersona = (r: "vendedor" | "comprador", c: Partial<PersonaBorrador>) => {
    // Cambiar el nombre o la cédula de una persona elegida de las guardadas: ya es otra (se crea al guardar).
    if (guardados[r] && (c.nombre !== undefined || c.numeroDocumento !== undefined)) setGuardados((g) => ({ ...g, [r]: undefined }));
    set({ [r]: { ...(b[r] ?? PERSONA_VACIA), ...c } });
  };
  const usarGuardada = (r: "vendedor" | "comprador", c: PersonaGuardada) => { set({ [r]: { ...(b[r] ?? PERSONA_VACIA), ...aBorrador(c) } }); setGuardados((g) => ({ ...g, [r]: c.id })); };
  const revisar = (campo: string) => b.revisar.includes(campo);
  const marca = (campo: string) => (revisar(campo) ? " reg-revisar" : "");
  const fuente = (campo: string) => b.fuentes[campo]?.length ? <small className="tenue">({b.fuentes[campo].join(", ")}{revisar(campo) ? " · revíselo" : ""})</small> : null;
  const campoVehiculo = (k: (typeof CAMPOS_VEHICULO_BORRADOR)[number]) => (
    <label key={k} className={marca(`vehiculo.${k}`)}>{NOMBRE_CAMPO[k]} {fuente(`vehiculo.${k}`)}
      <input className="input" value={b.vehiculo[k]} onChange={(e) => set({ vehiculo: { ...b.vehiculo, [k]: k === "placa" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") : e.target.value.toUpperCase() } })} />
    </label>
  );
  /** Elegir una opción de una diferencia. */
  function elegir(campo: string, valor: string) {
    const [a, k] = campo.split(".");
    if (a === "vehiculo") set({ vehiculo: { ...bb.vehiculo, [k]: valor } });
    else if (a === "vendedor" || a === "comprador") setPersona(a, { [k]: valor });
    else if (campo === "organismo") set({ organismoId: valor });
    else if (campo === "valor") set({ valor });
  }
  const actual = (campo: string) => {
    const [a, k] = campo.split(".");
    return a === "vehiculo" ? b.vehiculo[k as keyof typeof b.vehiculo] : a === "vendedor" || a === "comprador" ? (b[a] as unknown as Record<string, string> | null)?.[k] : campo === "organismo" ? b.organismoId : campo === "valor" ? b.valor : "";
  };
  const etiquetaOpcion = (campo: string, v: string) => (campo === "organismo" ? cat!.organismos.find((o) => o.id === v)?.ciudad ?? v : campo === "valor" ? pesosEnTexto(v) : v);
  const elegidas = b.categorias.split(",").filter(Boolean);
  // Primera vez y recategorización exigen edad mínima (art. 19); en toda licencia la edad fija la vigencia (art. 197).
  const expedicionORecat = licencia && elegidosTipos.some((t) => t.categoria === "licencia" && /expedici[oó]n|recategorizaci[oó]n/i.test(t.nombre));
  const migracion = licencia && elegidosTipos.some((t) => t.categoria === "licencia" && /migraci[oó]n/i.test(t.nombre));
  const fechaNac = b.vendedor?.fechaNacimiento ?? "";
  const edad = manual && licencia ? avisosEdadLicencia(expedicionORecat, elegidas, fechaNac || null, hoyISO(), migracion) : null;
  const paraGuardar = manual && preanotar ? [
    !b.tipoIds.length && "elija el trámite",
    !b.vendedor?.nombre && !b.comprador?.nombre && "el nombre del cliente",
  ].filter(Boolean) as string[] : manual && licencia ? [
    !b.vendedor?.nombre && "el nombre del titular",
    !b.vendedor?.numeroDocumento && !guardados.vendedor && "la cédula del titular",
    !b.categorias && "elija la categoría",
    expedicion && !b.conClases && "diga si es con clases o sin clases",
    !fechaNac && "la fecha de nacimiento del titular (para el vencimiento)",
    ...(edad?.bloqueos ?? []),
    !precond && "responda qué hacer con las precondiciones",
  ].filter(Boolean) as string[] : manual ? [
    !b.tipoIds.length && "elija el trámite",
    !b.vehiculo.placa && pideVehiculo && "escriba la placa",
    !b.vendedor?.nombre && (traspaso ? "el vendedor" : pideVehiculo ? "el propietario" : "el titular"),
    traspaso && !b.comprador?.nombre && !elegidosTipos.some((t) => /indeterminad/i.test(t.nombre)) && "el comprador",
    !precond && "responda qué hacer con las precondiciones",
  ].filter(Boolean) as string[] : licencia ? [
    !b.vendedor?.nombre && "el nombre del titular",
    !b.vendedor?.numeroDocumento && "la cédula del titular",
    !b.categorias && "elija la categoría",
    expedicion && !b.conClases && "diga si es con clases o sin clases",
    !precond && "responda qué hacer con las precondiciones",
  ].filter(Boolean) as string[] : [
    !b.tipoIds.length && "elija el trámite",
    !b.vehiculo.placa && "escriba la placa",
    !b.vendedor?.nombre && (traspaso ? "el vendedor" : "el propietario"),
    traspaso && !b.comprador?.nombre && "el comprador",
    !precond && "responda qué hacer con las precondiciones",
  ].filter(Boolean) as string[];
  const paraFormatos = [
    !b.vehiculo.placa && "escriba la placa",
    !b.vendedor?.numeroDocumento && "la cédula del propietario",
    !b.vendedor?.nombre && "el nombre del propietario",
  ].filter(Boolean) as string[];
  // En la consulta rápida solo se pide lo de lo que se vaya a hacer.
  const faltan = !consulta ? paraGuardar : [...new Set([...(sigue.guardar ? paraGuardar : []), ...(sigue.formatos ? paraFormatos : [])])];

  const persona = (r: "vendedor" | "comprador", titulo: string) => {
    const p = b[r];
    return (
      <div className="cot-vehiculo" role="group" aria-label={titulo}>
        <b>{titulo}{b.cliente === r && (!consulta || sigue.guardar) ? <span className="peq tenue"> · cliente del trámite</span> : null}</b>
        {manual && <ClienteGuardado quien={titulo.split(" ")[0].toLowerCase()} elegido={!!guardados[r]} cedula={p?.numeroDocumento ?? ""} elegir={(c) => usarGuardada(r, c)} soltar={() => setGuardados((g) => ({ ...g, [r]: undefined }))} />}
        <div className="cot-campos">
          <label className={`cot-largo${marca(`${r}.nombre`)}`} style={{ gridColumn: "1 / -1" }}>Nombre completo {fuente(`${r}.nombre`)}<input className="input" value={p?.nombre ?? ""} onChange={(e) => setPersona(r, { nombre: e.target.value.toUpperCase() })} /></label>
          <label className={marca(`${r}.numeroDocumento`)}>Cédula {fuente(`${r}.numeroDocumento`)}<input className="input" inputMode="numeric" value={p?.numeroDocumento ?? ""} onChange={(e) => setPersona(r, { numeroDocumento: e.target.value.replace(/\D/g, "") })} /></label>
          <label className={marca(`${r}.telefono`)}>Teléfono {fuente(`${r}.telefono`)}<input className="input" inputMode="tel" value={p?.telefono ?? ""} onChange={(e) => setPersona(r, { telefono: e.target.value.replace(/\D/g, "") })} /></label>
          <label>Dirección<input className="input" value={p?.direccion ?? ""} onChange={(e) => setPersona(r, { direccion: e.target.value.toUpperCase() })} /></label>
          <label>Ciudad<input className="input" value={p?.ciudad ?? ""} onChange={(e) => setPersona(r, { ciudad: e.target.value.toUpperCase() })} /></label>
          {licencia && <label>Fecha de nacimiento <small className="tenue">(para el vencimiento{manual ? "" : "; si ya es cliente con la fecha, puede quedar vacía"})</small><input className="input" type="date" value={p?.fechaNacimiento ?? ""} onChange={(e) => setPersona(r, { fechaNacimiento: e.target.value })} /></label>}
        </div>
      </div>
    );
  };

  const verificado = !!verif && verif.placa === b.vehiculo.placa;
  const conComprador = !!(traspaso || consulta) && !!b.comprador?.numeroDocumento;
  const cedulasB = [b.vendedor?.numeroDocumento, conComprador && b.comprador?.numeroDocumento].filter(Boolean).length;
  const creditosVerificar = consulta ? creditosDe(que, cedulasB, conComprador) : traspaso && b.comprador?.numeroDocumento ? 4 : 3;
  const consultado = { runt: !!verif?.consultado?.includes("runt") || (!!verif && !verif.consultado), simit: !!verif?.consultado?.includes("simit") || (!!verif && !verif.consultado) };
  const puedeVerificar = consulta && !que.runt ? !!(b.vendedor?.numeroDocumento || b.comprador?.numeroDocumento) : !!(b.vehiculo.placa && b.vendedor?.numeroDocumento);
  const diferencias = b.diferencias.length > 0 && (
    <div className="reg-diferencias" role="group" aria-label="Diferencias entre las hojas">
      <b className="peq">Las hojas no coinciden en esto: elija el correcto</b>
      {b.diferencias.map((d) => (
        <div key={d.campo} className="reg-diferencia">
          <span className="peq">{d.etiqueta}</span>
          <div className="fila-wrap" style={{ gap: 4 }}>
            {d.opciones.map((o) => (
              <button key={o.valor} type="button" className={`cot-chip${actual(d.campo) === o.valor ? " on" : ""}`} aria-pressed={actual(d.campo) === o.valor} onClick={() => elegir(d.campo, o.valor)}>
                {etiquetaOpcion(d.campo, o.valor)} <small>({o.fuentes.join(", ")})</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  // Elegir un trámite de licencia quita los de vehículo, y al revés (no se registran juntos).
  const alternar = (id: string, deLicencia: boolean) => {
    const otros = b.tipoIds.filter((x) => cat!.tipos.some((t) => t.id === x && (t.categoria === "licencia") === deLicencia));
    set({ tipoIds: otros.includes(id) ? otros.filter((x) => x !== id) : [...otros, id] });
  };
  const chips = (lista: typeof deVehiculo, deLic: boolean) => lista.map((t) => (
    <button key={t.id} type="button" className={`cot-chip${b.tipoIds.includes(t.id) ? " on" : ""}`} aria-pressed={b.tipoIds.includes(t.id)} onClick={() => alternar(t.id, deLic)}>{t.nombre}</button>
  ));
  const tramites = (
    <>
      <div className="cot-titulo">Trámites</div>
      <div className="fila-wrap" style={{ gap: 6 }} role="group" aria-label="Trámites">{chips(deVehiculo, false)}</div>
      {deSeguros.length > 0 && (
        <>
          <div className="peq muted">Seguros y multas</div>
          <div className="fila-wrap" style={{ gap: 6 }} role="group" aria-label="Trámites de seguros y multas">{chips(deSeguros, false)}</div>
        </>
      )}
      {deLicencia.length > 0 && (
        <>
          <div className="peq muted">Licencia de conducción</div>
          <div className="fila-wrap" style={{ gap: 6 }} role="group" aria-label="Trámites de licencia">{chips(deLicencia, true)}</div>
        </>
      )}
    </>
  );
  const categorias = licencia && (
    <div role="group" aria-label="Categorías">
      <div className="cot-titulo">Categorías{b.pistaCategoria ? <span className="peq tenue"> · dice {b.pistaCategoria === "publico" ? "servicio público" : b.pistaCategoria}{b.pistaCategoria === "moto" ? " (A1 hasta 125 cc, A2 más de 125 cc)" : ""}</span> : null}</div>
      <div className="fila-wrap" style={{ gap: 6 }}>
        {CATEGORIAS_LICENCIA.map((c) => (
          <button key={c} type="button" className={`cot-chip${elegidas.includes(c) ? " on" : ""}`} aria-pressed={elegidas.includes(c)}
            onClick={() => set({ categorias: CATEGORIAS_LICENCIA.filter((x) => (x === c ? !elegidas.includes(c) : elegidas.includes(x))).join(",") })}>{c}</button>
        ))}
      </div>
      {compromiso && (listas.some((h) => h.lectura?.clase === "carta_compromiso")
        ? <div className="aviso ok" style={{ marginTop: 8 }}><Check size={16} /><span>La carta de compromiso va con el trámite (viene en las fotos): queda en Archivos, sin alerta.</span></div>
        : <div className="aviso importante peligro" role="alert" style={{ marginTop: 8 }}><AlertTriangle size={22} /><span><b>Atención:</b> con clases o sin clases, la persona debe firmar la carta de compromiso de terminar las clases. El trámite queda con la carta pendiente en Archivos, para subirla firmada.</span></div>)}
      {expedicion && (
        <div className="fila" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
          <span className="peq">Clases:</span>
          <div className="seg" role="group" aria-label="Con clases o sin clases">
            {(["con", "sin"] as const).map((x) => <button key={x} type="button" className={b.conClases === x ? "on" : ""} aria-pressed={b.conClases === x} onClick={() => set({ conClases: x })}>{x === "con" ? "Con clases" : "Sin clases"}</button>)}
          </div>
        </div>
      )}
    </div>
  );
  const organismo = (
    <label className="cot-largo">Organismo de tránsito
      <select className="input" value={b.organismoId} onChange={(e) => set({ organismoId: e.target.value })}>
        <option value="">Sin organismo todavía</option>
        {cat!.organismos.map((o) => <option key={o.id} value={o.id}>{o.ciudad ?? o.nombre}</option>)}
      </select>
      <small className="tenue">{b.organismoLeido ? `Leído: «${b.organismoLeido}».` : manual ? (b.organismoId ? "Cámbielo si es otro." : "") : b.organismoId ? "Ninguna hoja lo dice: quedó Ibagué. Cámbielo si es otro." : "Ninguna hoja lo dice: elíjalo."}</small>
    </label>
  );
  const vehiculo = (
    <div className="cot-vehiculo" role="group" aria-label="Vehículo">
      <b>Vehículo</b>
      <div className="cot-campos">
        {CAMPOS_VEHICULO_BORRADOR.filter((k) => VEHICULO_PRINCIPAL.includes(k)).map(campoVehiculo)}
      </div>
      {manual && <PlacaGuardada placa={b.vehiculo.placa} vehiculo={b.vehiculo} usar={(v, dueno) => {
        const vehiculo = Object.fromEntries(CAMPOS_VEHICULO_BORRADOR.map((k) => [k, b.vehiculo[k] || v[k]])) as Borrador["vehiculo"];
        // El propietario guardado va de vendedor (o propietario) si todavía no se escribió nadie.
        if (dueno && !b.vendedor?.nombre) { setB({ ...b, vehiculo, vendedor: aBorrador(dueno) }); setGuardados((g) => ({ ...g, vendedor: dueno.id })); }
        else set({ vehiculo });
      }} />}
      <details className="cot-mas">
        <summary>Más datos de la tarjeta{(() => { const n = CAMPOS_VEHICULO_BORRADOR.filter((k) => !VEHICULO_PRINCIPAL.includes(k) && b.vehiculo[k]).length; return n ? ` (${n} leídos)` : ""; })()}</summary>
        <div className="cot-campos">{CAMPOS_VEHICULO_BORRADOR.filter((k) => !VEHICULO_PRINCIPAL.includes(k)).map(campoVehiculo)}</div>
      </details>
    </div>
  );
  const personas = licencia ? persona("vendedor", "Titular") : (
    <>
      {persona("vendedor", traspaso ? "Vendedor (propietario actual)" : sinVehiculo ? "Titular" : "Propietario")}
      {(traspaso || (consulta && !!b.comprador)) && persona("comprador", "Comprador")}
    </>
  );
  const cliente = traspaso && (
    <div className="fila" style={{ gap: 8 }} role="group" aria-label="Cliente del trámite">
      <span className="peq">Cliente:</span>
      {(["comprador", "vendedor"] as const).map((r) => <button key={r} type="button" className={`cot-chip${b.cliente === r ? " on" : ""}`} aria-pressed={b.cliente === r} onClick={() => set({ cliente: r })}>{r === "comprador" ? "El comprador" : "El vendedor"}</button>)}
    </div>
  );
  const cobro = manual ? (
    <>
      <CobroEditable b={b} tipos={cat!.tipos} alCambiar={setCuenta} />
      <div className="cot-campos">
        <label className={b.abono ? "reg-revisar" : ""}>Abono (ya pagó)<input className="input" inputMode="numeric" value={pesosEnTexto(b.abono)} onChange={(e) => set({ abono: e.target.value.replace(/\D/g, "") })} placeholder="$ 0" aria-label="Abono" /></label>
        <label>Aliado (opcional)<input className="input" value={aliado} onChange={(e) => setAliado(e.target.value.toUpperCase())} placeholder="Quién lo trajo" /></label>
        <label>Entrega estimada <small className="tenue">{slaManual && !entrega.aMano ? `(${slaManual} días hábiles según el trámite)` : "(opcional)"}</small>
          <input className="input" type="date" aria-label="Entrega estimada" value={entrega.fecha} onChange={(e) => setEntrega({ fecha: e.target.value, aMano: true })} /></label>
      </div>
      <label className="cot-largo">Observaciones<textarea className="input" value={b.observaciones} onChange={(e) => set({ observaciones: e.target.value })} /></label>
    </>
  ) : (
    <>
      <div className="cot-campos">
        <label className={marca("valor")}>Valor cobrado {fuente("valor")}<input className="input" inputMode="numeric" value={pesosEnTexto(b.valor)} onChange={(e) => set({ valor: e.target.value.replace(/\D/g, "") })} placeholder="$ 0" /></label>
        <label className={b.abono ? "reg-revisar" : ""}>Abono (ya pagó){b.abono && <small className="tenue"> · su mensaje{b.metodoAbono ? `, ${b.metodoAbono}` : ""}</small>}<input className="input" inputMode="numeric" value={pesosEnTexto(b.abono)} onChange={(e) => set({ abono: e.target.value.replace(/\D/g, "") })} placeholder="$ 0" aria-label="Abono" /></label>
        <label>Aliado (opcional)<input className="input" value={aliado} onChange={(e) => setAliado(e.target.value.toUpperCase())} placeholder="Quién lo trajo" /></label>
      </div>
      <label className="cot-largo">Observaciones<textarea className="input" value={b.observaciones} onChange={(e) => set({ observaciones: e.target.value })} /></label>
    </>
  );
  const verificacion = cat!.placapi && !licencia && (
    <div className="reg-verificar" role="group" aria-label="Verificación con el RUNT">
      {!verificado ? (
        <>
          {consulta && elegirQue}
          <button type="button" className="btn btn-sm" disabled={verificando || !puedeVerificar} onClick={() => verificar()}>
            {verificando ? <Loader2 size={13} className="girando" /> : <ShieldCheck size={13} />}{verificando ? "Consultando…" : consulta ? `Consultar ${nombreQue(que)} (${creditos(creditosVerificar)})` : `Verificar todo con el RUNT (${creditosVerificar} créditos)`}
          </button>
          <small className="tenue">{consulta && !que.runt ? (puedeVerificar ? "" : "Hace falta al menos una cédula.") : !b.vehiculo.placa ? "Hace falta la placa." : !b.vendedor?.numeroDocumento ? "Hace falta la cédula del vendedor (el dueño actual): el RUNT la pide." : consulta ? "" : "Trae los datos oficiales del vehículo (corrige lo leído a mano) y revisa SOAT, técnico-mecánica, prendas, comparendos e impuesto."}</small>
        </>
      ) : (
        <>
          <b className="peq">{consulta ? `Consultado con ${nombreQue(consultado)}` : "Verificado con el RUNT"} ({creditos(verif!.creditos)})</b>
          {consultado.runt && !verif!.runt && !verif!.faltaron?.length && <div className="peq cot-aviso"><AlertTriangle size={12} /> El RUNT no encontró la placa {verif!.placa} con la cédula {b.vendedor?.numeroDocumento}: alguna de las dos está mal (revise las hojas). No se cobró esa consulta.</div>}
          {verif!.corregidos.length > 0 && <div className="peq">Corregido con el RUNT: {verif!.corregidos.map((c) => `${c.campo} ${c.antes} → ${c.ahora}`).join("; ")}.</div>}
          {verif!.hallazgos.map((h, i) => (
            <div key={i} className="fila peq" style={{ gap: 8, alignItems: "flex-start" }}>
              <span className={`rev-estado ${ESTADO_HALLAZGO[h.estado][1]}`}>{ESTADO_HALLAZGO[h.estado][0]}</span>
              <span><b>{h.tema}</b>{h.quien ? ` (${h.quien})` : ""}: {h.detalle}</span>
            </div>
          ))}
          {!!verif!.faltaron?.length && <FaltoAlgo faltaron={verif!.faltaron} ocupado={verificando} pedir={() => verificar(b, verif!)} />}
          {consulta && (!consultado.runt || !consultado.simit) && (
            <div className="fila-wrap" style={{ gap: 6 }}>
              {!consultado.simit && <button type="button" className="btn btn-sm" disabled={verificando || !(b.vendedor?.numeroDocumento || b.comprador?.numeroDocumento)} onClick={() => verificar(b, verif!, "simit")}>{verificando ? <Loader2 size={13} className="girando" /> : <ShieldCheck size={13} />}Consultar también el SIMIT ({Math.max(1, cedulasB)} crédito{Math.max(1, cedulasB) === 1 ? "" : "s"})</button>}
              {!consultado.runt && <button type="button" className="btn btn-sm" disabled={verificando || !b.vehiculo.placa || !b.vendedor?.numeroDocumento} onClick={() => verificar(b, verif!, "runt")}>{verificando ? <Loader2 size={13} className="girando" /> : <ShieldCheck size={13} />}Consultar también el RUNT (1 crédito)</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
  const precondiciones = (
    <>
      <div className="cot-titulo">¿Ya están las precondiciones?</div>
      <div className="pila" style={{ gap: 4 }} role="radiogroup" aria-label="Precondiciones">
        {([["cumplidas", "Sí, todas cumplidas"], ["pendientes", "No, quedan pendientes"], ["placapi", !cat!.placapi ? "Que las revise PlacApi (todavía no está conectado)" : verificado ? "Las que salieron limpias en la verificación (sin costo: ya se pagó)" : licencia ? "Que las revise PlacApi al guardar (su licencia y el SIMIT: 2 créditos)" : "Que las revise PlacApi al guardar (4 créditos en traspaso)"]] as const).map(([v, t]) => (
          <label key={v} className="reg-opcion"><input type="radio" name="precondiciones" value={v} checked={precond === v} disabled={v === "placapi" && !cat!.placapi} onChange={() => setPrecond(v)} />{t}</label>
        ))}
      </div>
    </>
  );
  const volver = <button className="btn btn-sm btn-fantasma" onClick={() => setB(null)}>Volver a las hojas</button>;
  const avisos = b.avisos.filter((a) => !(licencia && /placa/i.test(a))).map((a) => <div key={a} className="peq cot-aviso"><AlertTriangle size={12} /> {a}</div>);

  if (consulta) {
    const accion = sigue.guardar && sigue.formatos ? "Guardar y llenar los formularios" : sigue.guardar ? "Guardar el trámite" : sigue.formatos ? "Llenar los formularios" : "Terminar";
    return (
      <div className="bloque-ia registrador" aria-label="Resultado de la consulta">
        <div className="fila" style={{ justifyContent: "space-between" }}>
          <b>Resultado de la consulta</b>
          {volver}
        </div>
        {avisos}
        {verificacion}
        {diferencias}
        {vehiculo}
        {personas}
        {tramites}
        <div className="cot-titulo">¿Qué sigue?</div>
        <div className="consulta-sigue" role="group" aria-label="Qué sigue">
          <label className="reg-opcion"><input type="checkbox" checked={sigue.guardar} onChange={(e) => setSigue((x) => ({ ...x, guardar: e.target.checked }))} /><span><b>Guardar el trámite</b><small className="tenue">Queda anotado con lo leído y lo consultado (sin volver a pagar la consulta).</small></span></label>
          <label className="reg-opcion"><input type="checkbox" checked={sigue.formatos} onChange={(e) => setSigue((x) => ({ ...x, formatos: e.target.checked }))} /><span><b>Llenar los formularios</b><small className="tenue">Formulario único, mandato y, si hay comprador, compraventa, con estos datos.</small></span></label>
          {!sigue.guardar && !sigue.formatos && <small className="tenue">Sin marcar ninguna, la consulta termina aquí.</small>}
        </div>
        {(sigue.guardar || sigue.formatos) && organismo}
        {sigue.guardar && <>{cliente}{cobro}{precondiciones}</>}
        {faltan.length > 0 && <div className="peq cot-aviso">Falta: {faltan.join("; ")}.</div>}
        {error && <div className="peq cot-aviso">{error}</div>}
        <div className="fila" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-primario" disabled={!!faltan.length || guardando || verificando} onClick={continuar}>
            {guardando ? <Loader2 size={13} className="girando" /> : sigue.formatos ? <FileText size={13} /> : <Check size={13} />}{accion}
          </button>
          {cancelar && <button className="btn btn-sm" onClick={cancelar} disabled={guardando}><X size={13} />Cancelar</button>}
        </div>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="bloque-ia registrador form-tramite" aria-label="Nuevo trámite">
        <div className="form-nota" role="group" aria-label="Escribirlo en palabras">
          <label className="cot-largo">Escríbalo como se lo diría al asistente <small className="tenue">(opcional: llena el formulario, sin IA)</small>
            <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: traspaso de la ABC123, vende Pedro Ruiz CC 12345678, compra Clara Mora CC 87654321, tel 3000000000, Ibagué" />
          </label>
          <div className="fila-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" disabled={!nota.trim()} onClick={() => armar()}><Wand2 size={13} />Llenar con lo escrito</button>
            <button type="button" className="btn btn-sm" onClick={() => setVerHojas(true)}><Camera size={13} />Llenar con fotos de los documentos{listas.length ? ` (${listas.length})` : ""}</button>
          </div>
        </div>
        {leyendoAlgo && <div className="aviso info" role="status"><Loader2 size={15} className="girando" /><span>Leyendo las hojas ({listas.length} de {hojas.length}). El formulario se llena solo cuando terminen.</span></div>}
        {hojas.some((h) => h.estado === "error") && <div className="aviso error"><Info size={15} /><span>No se pudo leer {hojas.filter((h) => h.estado === "error").length === 1 ? "una hoja" : `${hojas.filter((h) => h.estado === "error").length} hojas`}: escriba esos datos aquí o reintente en «Llenar con fotos». Una hoja sin leer no se guarda en el trámite.</span></div>}
        {avisos}
        {diferencias}
        {tramites}
        {categorias}
        {organismo}
        {!licencia && !sinVehiculo && vehiculo}
        {personas}
        {cliente}
        {edad?.avisos.map((a) => <div key={a} className="aviso info"><Info size={15} /><span>{a}</span></div>)}
        {cobro}
        {verificacion}
        {!preanotar && precondiciones}
        <label className="interruptor-fila" title="Para anotarlo ya aunque falte un dato esencial (el comprador, la placa...): queda con la etiqueta «Falta info» y se quita sola al completarlo">
          <input type="checkbox" role="switch" checked={preanotar} onChange={(e) => setPreanotar(e.target.checked)} />
          <span><b>Preanotación</b><small className="tenue" style={{ display: "block" }}>Guardar aunque falten datos (comprador, placa, categorías...). Basta el trámite y el nombre del cliente; queda con «Falta info» hasta completarlo.</small></span>
        </label>
        {faltan.length > 0 && <div className="peq cot-aviso">Para guardar: {faltan.join("; ")}.</div>}
        {error && <div className="peq cot-aviso">{error}</div>}
        <div className="fila form-acciones" style={{ gap: 6 }}>
          {b.tipoIds.length > 0 && <span className="muted">Total: <b>{pesosEnTexto(String(cuenta.total))}</b></span>}
          <div className="espacio" />
          {cancelar && <button className="btn" onClick={cancelar} disabled={guardando}>Cancelar</button>}
          <button className="btn btn-primario" disabled={!!faltan.length || guardando || leyendoAlgo} onClick={guardar}>{guardando ? <Loader2 size={14} className="girando" /> : <Check size={14} />}{b.tipoIds.length > 1 ? `Crear ${b.tipoIds.length} trámites` : "Crear trámite"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bloque-ia registrador" aria-label="Confirmar el trámite">
      <div className="fila" style={{ justifyContent: "space-between" }}>
        <b>Confirme el trámite</b>
        {volver}
      </div>
      {avisos}
      {diferencias}
      {tramites}
      {categorias}
      {organismo}
      {!licencia && vehiculo}
      {personas}
      {cliente}
      {cobro}
      {verificacion}
      {precondiciones}
      {faltan.length > 0 && <div className="peq cot-aviso">Para guardar: {faltan.join("; ")}.</div>}
      {error && <div className="peq cot-aviso">{error}</div>}
      <div className="fila" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primario" disabled={!!faltan.length || guardando} onClick={guardar}>{guardando ? <Loader2 size={13} className="girando" /> : <Check size={13} />}Guardar el trámite</button>
        {cancelar && <button className="btn btn-sm" onClick={cancelar} disabled={guardando}><X size={13} />Cancelar</button>}
      </div>
    </div>
  );
}
