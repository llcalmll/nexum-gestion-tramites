import { Camera, ClipboardPaste, Eye, Loader2, Plus, ScanLine, Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BotonPegar, usePegarImagenes } from "./Pegar";
import { normalizar } from "../../compartido/dominio";
import { leerFoto, mensajeDe } from "../datos/escribir";
import { prepararFoto } from "../logica/foto";
import { verEnGrande } from "../formatos/fotosFormatos";

/* ───────────────────────── Campos ───────────────────────── */

/** Etiqueta + control. `leido` marca el dato que vino de la foto, para revisarlo. */
export function Campo({ etiqueta, children, ancho, leido, ayuda, obligatorio }: { etiqueta: string; children: ReactNode; ancho?: boolean; leido?: boolean; ayuda?: ReactNode; obligatorio?: boolean }) {
  return (
    <label className={`campo ${ancho ? "ancho" : ""}`}>
      <span className="etq">
        {etiqueta}
        {obligatorio && <span className="obligatorio" title="Obligatorio">*</span>}
        {leido && <span className="leido" title="Leído de la foto: revíselo">de la foto</span>}
      </span>
      {children}
      {ayuda && <span className="peq tenue">{ayuda}</span>}
    </label>
  );
}

export function Texto(props: { valor: string | null | undefined; cambiar: (v: string) => void; placeholder?: string; tipo?: string; autoFocus?: boolean; mayusculas?: boolean; etiqueta?: string }) {
  return (
    <input
      className="input"
      aria-label={props.etiqueta}
      type={props.tipo ?? "text"}
      value={props.valor ?? ""}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      style={props.mayusculas ? { textTransform: "uppercase" } : undefined}
      onChange={(e) => props.cambiar(e.target.value)}
    />
  );
}

export function Fecha({ valor, cambiar }: { valor: string | null | undefined; cambiar: (v: string) => void }) {
  return <input className="input" type="date" value={valor ?? ""} onChange={(e) => cambiar(e.target.value)} />;
}

export function Opciones<T extends string>({ valor, cambiar, opciones, vacio }: { valor: T | "" | null | undefined; cambiar: (v: T | "") => void; opciones: readonly (readonly [T, string])[]; vacio?: string }) {
  return (
    <select className="select" value={valor ?? ""} onChange={(e) => cambiar(e.target.value as T | "")}>
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}

export function Pesos({ valor, cambiar }: { valor: number; cambiar: (v: number) => void }) {
  const [texto, setTexto] = useState(valor ? valor.toLocaleString("es-CO") : "");
  useEffect(() => { setTexto(valor ? valor.toLocaleString("es-CO") : ""); }, [valor]);
  return (
    <input
      className="input num"
      inputMode="numeric"
      value={texto}
      placeholder="0"
      onChange={(e) => {
        const n = Number(e.target.value.replace(/\D/g, "")) || 0;
        setTexto(n ? n.toLocaleString("es-CO") : "");
        cambiar(n);
      }}
    />
  );
}

export function ErrorFormulario({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="aviso error" role="alert">{error}</div>;
}

/* ───────────────────────── Buscador ───────────────────────── */

export interface OpcionBuscador { id: string; titulo: string; detalle?: string; busqueda: string }

/** Buscar y elegir un cliente o un vehículo de la copia local. */
/** `crear`: al final de la lista, una opción para crear uno nuevo con lo que se escribió (por ejemplo, una persona). */
export function Buscador({ opciones, elegido, elegir, placeholder, extra, crear }: { opciones: OpcionBuscador[]; elegido: string | null; elegir: (id: string | null) => void; placeholder: string; extra?: ReactNode; crear?: { texto: string; accion: (escrito: string) => void } }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actual = opciones.find((o) => o.id === elegido);
  const resultados = useMemo(() => {
    // Cada palabra por aparte ("renovación luz", "abc 123"): todas tienen que estar.
    const palabras = normalizar(q).split(/\s+/).filter(Boolean);
    return (palabras.length ? opciones.filter((o) => palabras.every((p) => o.busqueda.includes(p))) : opciones).slice(0, 8);
  }, [opciones, q]);
  useEffect(() => {
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  if (actual) {
    return (
      <div className="elegido">
        <div><b>{actual.titulo}</b>{actual.detalle && <small>{actual.detalle}</small>}</div>
        <button type="button" className="btn btn-fantasma btn-sm btn-icono" title="Cambiar" onClick={() => elegir(null)}><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="buscador" ref={ref}>
      <div className="buscar">
        <Search size={15} />
        <input className="input" value={q} placeholder={placeholder} onFocus={() => setAbierto(true)} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} />
      </div>
      {abierto && (
        <div className="buscador-lista">
          {resultados.map((o) => (
            <button type="button" key={o.id} className="buscador-item" onClick={() => { elegir(o.id); setQ(""); setAbierto(false); }}>
              <b>{o.titulo}</b>{o.detalle && <small>{o.detalle}</small>}
            </button>
          ))}
          {!resultados.length && <div className="peq tenue" style={{ padding: "8px 10px" }}>Sin resultados</div>}
          {crear && (
            <button type="button" className="buscador-item buscador-crear" onClick={() => { crear.accion(q.trim()); setQ(""); setAbierto(false); }}>
              <b><Plus size={14} />{q.trim() ? `${crear.texto}: «${q.trim()}»` : crear.texto}</b>
            </button>
          )}
          {extra && <div className="buscador-extra" onClick={() => setAbierto(false)}>{extra}</div>}
        </div>
      )}
    </div>
  );
}

/** Elegir un organismo de tránsito escribiendo (Ibagué, Funza, "secretaría de..."), en vez de recorrer la lista. */
export function BuscadorOrganismo({ organismos, valor, cambiar, vacio = "Sin organismo" }: { organismos: { id: string; nombre: string; ciudad?: string | null; departamento?: string | null }[]; valor: string; cambiar: (id: string) => void; vacio?: string }) {
  const opciones = useMemo(() => organismos.map((o) => ({
    id: o.id, titulo: o.ciudad ?? o.nombre, detalle: [o.ciudad ? o.nombre : null, o.departamento].filter(Boolean).join(" · "),
    busqueda: normalizar(`${o.nombre} ${o.ciudad ?? ""} ${o.departamento ?? ""}`),
  })).sort((a, b) => a.titulo.localeCompare(b.titulo, "es")), [organismos]);
  return <Buscador opciones={opciones} elegido={valor || null} elegir={(id) => cambiar(id ?? "")} placeholder={`Buscar ciudad u organismo (vacío: ${vacio.toLowerCase()})`} />;
}

/* ───────────────────────── Captura y lectura de foto ───────────────────────── */

const NOMBRE_DOC = { cedula: "la cédula", licencia: "la licencia", tarjeta_propiedad: "la tarjeta de propiedad" } as const;

/**
 * Foto de un documento -> datos leídos. Acepta arrastrar, pegar (Ctrl+V), elegir archivo o tomarla con la cámara.
 * Solo propone: `alLeer` recibe los datos y el formulario los muestra para revisar. Con una foto puesta, "Quitar foto"
 * la quita (lo leído de ella queda en el formulario).
 */
export function LeerFoto({ tipo, alLeer, compacta, inicial, alFoto, puesta }: {
  tipo: keyof typeof NOMBRE_DOC; alLeer: (datos: Record<string, string | string[]>) => void; compacta?: boolean; inicial?: Blob | null;
  /** La foto leída (data URL; null al quitarla): para guardarla con lo llenado. */
  alFoto?: (foto: string | null) => void;
  /** Una foto que ya está (llegó del celular o de un borrador): se muestra sin volver a leerla. */
  puesta?: string | null;
}) {
  const [vista, setVista] = useState<string | null>(null);
  const [estado, setEstado] = useState<"esperando" | "leyendo" | "listo">("esperando");
  useEffect(() => { if (puesta && puesta !== vista && estado !== "leyendo") { setVista(puesta); setEstado("listo"); } }, [puesta]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  const [revisar, setRevisar] = useState<string[]>([]);
  const [encima, setEncima] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);

  async function procesar(archivo: File | Blob | undefined) {
    if (!archivo) return;
    setError(null);
    setRevisar([]);
    if (archivo.type && !archivo.type.startsWith("image/")) {
      setError("Ese archivo no es una foto. Use una imagen JPG o PNG.");
      return;
    }
    try {
      setEstado("leyendo");
      const imagen = await prepararFoto(archivo);
      setVista(imagen);
      const datos = await leerFoto(tipo, imagen);
      setEstado("listo");
      setRevisar(Array.isArray(datos.dudosos) ? datos.dudosos : []);
      alLeer(datos);
      alFoto?.(imagen);
    } catch (e) {
      setEstado("esperando");
      setError(mensajeDe(e));
    }
  }

  // Foto que ya viene (por ejemplo, una cédula que llegó por WhatsApp): se lee al abrir.
  useEffect(() => { if (inicial) procesar(inicial); }, [inicial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pegar una foto con Ctrl+V: va a esta foto si es donde se hizo clic o está el mouse (con varias en la pantalla).
  const zonaFoto = useRef<HTMLDivElement>(null);
  usePegarImagenes(zonaFoto, (f) => { if (estado !== "leyendo") procesar(f[0]); });

  return (
    <div className="pila" style={{ gap: 8 }}>
      <div
        ref={zonaFoto}
        className={`zona foto ${encima ? "encima" : ""} ${compacta ? "compacta" : ""}`}
        onClick={() => estado !== "leyendo" && archivoRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => { e.preventDefault(); setEncima(false); procesar(e.dataTransfer.files[0]); }}
      >
        <input ref={archivoRef} type="file" accept="image/*" onChange={(e) => { procesar(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={camaraRef} type="file" accept="image/*" capture="environment" onChange={(e) => { procesar(e.target.files?.[0]); e.target.value = ""; }} />
        {vista && <img src={vista} alt="" className="foto-vista" />}
        {estado === "leyendo" ? (
          <span className="fila"><Loader2 size={16} className="girando" /> Leyendo {NOMBRE_DOC[tipo]}…</span>
        ) : (
          <>
            <span className="fila"><ScanLine size={18} /><b>{estado === "listo" ? "Leer otra foto" : `Foto de ${NOMBRE_DOC[tipo]}`}</b></span>
            {!compacta && <span className="peq tenue fila" style={{ gap: 4 }}><Upload size={12} />Arrastre, elija un archivo o <ClipboardPaste size={12} />pegue con Ctrl+V</span>}
          </>
        )}
      </div>
      {/* En columnas angostas (Llenar formatos tiene tres fotos lado a lado) los botones bajan de renglón, sin montarse. */}
      <div className="fila" style={{ justifyContent: "center", flexWrap: "wrap", gap: 6 }}>
        <button type="button" className="btn btn-sm" disabled={estado === "leyendo"} onClick={() => camaraRef.current?.click()}><Camera size={14} />Tomar con la cámara</button>
        <BotonPegar disabled={estado === "leyendo"} recibir={(f) => procesar(f[0])} alError={setError} />
        {vista && estado !== "leyendo" && (
          <>
            <button type="button" className="btn btn-sm" title="Abrir la foto en grande, en otra pestaña" onClick={() => verEnGrande(vista)}><Eye size={14} />Ver</button>
            <button type="button" className="btn btn-sm btn-fantasma" title="Quita la foto (lo leído de ella se queda en el formulario: corríjalo abajo si no sirve)"
              onClick={() => { setVista(null); setEstado("esperando"); setRevisar([]); setError(null); alFoto?.(null); }}><X size={14} />Quitar foto</button>
          </>
        )}
      </div>
      {revisar.length > 0 && <div className="aviso info">Revise contra el documento: {revisar.map((k) => NOMBRE_DUDOSO[k] ?? k).join(", ")} (no se leyeron con seguridad).</div>}
      <ErrorFormulario error={error} />
    </div>
  );
}
const NOMBRE_DUDOSO: Record<string, string> = { numeroChasis: "chasis", vin: "VIN", numeroSerie: "serie", numeroMotor: "motor", documentoTitular: "documento del dueño", licenciaTransito: "licencia de tránsito", numeroDocumento: "número de documento" };
