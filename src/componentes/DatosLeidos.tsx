import { Check, Copy, Loader2, ScanText, UserPlus } from "lucide-react";
import { useState } from "react";
import type { HojaLeida } from "../../compartido/registro";
import { api } from "../datos/api";
import { mensajeDe } from "../datos/escribir";
import { leerHoja } from "./Registrador";

/*
 * Los datos de una cédula, licencia o tarjeta de propiedad escaneada, para revisarlos y corregirlos a mano antes de
 * guardarlos: como cliente (cédula, licencia) o como vehículo (tarjeta). Si ya existe, no se cambia nada sin que Felipe
 * vea qué es distinto y marque qué actualizar (POST /api/datos-leidos).
 */

const PERSONA: [string, string][] = [["nombres", "Nombres"], ["apellidos", "Apellidos"], ["tipoDocumento", "Tipo de documento"], ["numeroDocumento", "Número de documento"],
  ["fechaNacimiento", "Nacimiento (AAAA-MM-DD)"], ["fechaExpedicionDocumento", "Expedición (AAAA-MM-DD)"], ["telefono", "Teléfono"], ["direccion", "Dirección"]];
const VEHICULO: [string, string][] = [["placa", "Placa"], ["marca", "Marca"], ["linea", "Línea"], ["modelo", "Modelo"], ["clase", "Clase"], ["color", "Color"], ["cilindraje", "Cilindraje"],
  ["servicio", "Servicio"], ["combustible", "Combustible"], ["carroceria", "Carrocería"], ["capacidad", "Capacidad"], ["potencia", "Potencia (HP)"], ["motor", "Motor"], ["chasis", "Chasis"],
  ["serie", "Serie"], ["vin", "VIN"], ["licenciaTransito", "Licencia de tránsito No."], ["fechaMatricula", "Matrícula (AAAA-MM-DD)"], ["organismo", "Organismo de tránsito"],
  ["propietario", "Propietario"], ["documentoPropietario", "Documento del propietario"]];

interface Respuesta { estado: "creado" | "existe" | "actualizado" | "igual"; id: string; nombre: string; diferencias: { campo: string; etiqueta: string; antes: string; nuevo: string }[] }

/** Lo leído pasado a campos de texto editables. */
function aCampos(l: HojaLeida): { tipo: "persona" | "vehiculo" | null; campos: Record<string, string>; revisar: Set<string> } {
  const dudosos = l.dudosos ?? [];
  if (l.clase === "tarjeta_propiedad" && l.vehiculo) {
    const v = l.vehiculo as Record<string, string | undefined>, p = l.personas?.find((x) => x.rol === "propietario") ?? l.personas?.[0];
    const campos: Record<string, string> = Object.fromEntries(VEHICULO.map(([k]) => [k, v[k] ?? ""]));
    campos.organismo = l.organismo ?? "";
    campos.propietario = p?.nombreCompleto ?? [p?.nombres, p?.apellidos].filter(Boolean).join(" ");
    campos.documentoPropietario = p?.numeroDocumento ?? "";
    return { tipo: "vehiculo", campos, revisar: new Set(dudosos.filter((d) => d.startsWith("vehiculo.")).map((d) => d.slice(9))) };
  }
  const p = (l.clase === "cedula" || l.clase === "licencia_conduccion") ? l.personas?.[0] : undefined;
  if (!p) return { tipo: null, campos: {}, revisar: new Set() };
  const campos: Record<string, string> = Object.fromEntries(PERSONA.map(([k]) => [k, String((p as Record<string, unknown>)[k] ?? "")]));
  if (!campos.nombres && !campos.apellidos && p.nombreCompleto) campos.nombres = p.nombreCompleto;
  if (!campos.tipoDocumento) campos.tipoDocumento = "CC";
  return { tipo: "persona", campos, revisar: new Set(dudosos.filter((d) => d.startsWith("personas.0.")).map((d) => d.slice(11))) };
}

export function DatosLeidos({ foto, etiqueta, alNombre, alGuardar }: { foto: () => Promise<string>; etiqueta: string; alNombre?: (nombre: string) => void; alGuardar?: () => void }) {
  const [estado, setEstado] = useState<"listo" | "leyendo" | "leido" | "guardando">("listo");
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"persona" | "vehiculo" | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [revisar, setRevisar] = useState<Set<string>>(new Set());
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [copiado, setCopiado] = useState(false);

  async function leer() {
    setError(null); setRespuesta(null); setEstado("leyendo");
    try {
      const { lectura } = await leerHoja(await foto());
      const r = aCampos(lectura);
      if (!r.tipo) throw new Error("No encontré una cédula, una licencia ni una tarjeta de propiedad en estas caras. Revise que estén derechas y completas.");
      setTipo(r.tipo); setCampos(r.campos); setRevisar(r.revisar); setEstado("leido");
      const quien = r.tipo === "vehiculo" ? `Tarjeta ${r.campos.placa}` : `Cédula ${[r.campos.nombres, r.campos.apellidos].filter(Boolean).join(" ")}`;
      if (quien.trim().split(" ").length > 1) alNombre?.(quien.trim());
    } catch (e) { setError(mensajeDe(e)); setEstado(tipo ? "leido" : "listo"); }
  }

  const cuerpo = (aplicar?: string[]) => tipo === "vehiculo"
    ? { vehiculo: { ...campos, numeroMotor: campos.motor, numeroChasis: campos.chasis, numeroSerie: campos.serie }, titular: { nombre: campos.propietario, numeroDocumento: campos.documentoPropietario }, aplicar }
    : { persona: { ...campos, nombre: [campos.nombres, campos.apellidos].filter(Boolean).join(" ") }, aplicar };

  async function guardar(aplicar?: string[]) {
    setError(null); setEstado("guardando");
    try {
      const r = await api<Respuesta>("/api/datos-leidos", { method: "POST", body: JSON.stringify(cuerpo(aplicar)) });
      setRespuesta(r);
      if (r.estado === "existe") setMarcados(new Set(r.diferencias.map((d) => d.campo)));
      if (r.estado !== "existe") alGuardar?.();
    } catch (e) { setError(mensajeDe(e)); } finally { setEstado("leido"); }
  }

  async function copiar() {
    const lista = tipo === "vehiculo" ? VEHICULO : PERSONA;
    await navigator.clipboard.writeText(lista.filter(([k]) => campos[k]).map(([k, n]) => `${n.replace(/ \(.*\)$/, "")}: ${campos[k]}`).join("\n"));
    setCopiado(true); setTimeout(() => setCopiado(false), 1500);
  }

  if (estado === "listo" || estado === "leyendo") {
    return (
      <div className="datos-leidos">
        <div className="fila" style={{ justifyContent: "space-between", gap: 8 }}>
          <b className="peq">{etiqueta}</b>
          <button className="btn btn-sm" disabled={estado === "leyendo"} onClick={leer}>{estado === "leyendo" ? <><Loader2 size={13} className="girando" />Leyendo…</> : <><ScanText size={13} />Leer datos</>}</button>
        </div>
        {error && <div className="aviso error">{error}</div>}
      </div>
    );
  }

  const lista = tipo === "vehiculo" ? VEHICULO : PERSONA;
  return (
    <div className="datos-leidos" role="group" aria-label={`Datos de ${etiqueta}`}>
      <div className="fila" style={{ justifyContent: "space-between", gap: 8 }}>
        <b className="peq">{etiqueta}: {tipo === "vehiculo" ? "tarjeta de propiedad" : "persona"}</b>
        <button className="btn btn-sm btn-fantasma" onClick={leer}><ScanText size={13} />Leer de nuevo</button>
      </div>
      {revisar.size > 0 && <div className="aviso info">Los campos marcados no se leyeron con seguridad: revíselos contra el documento.</div>}
      <div className="cot-campos">
        {lista.map(([k, nombre]) => (
          <label key={k} className={revisar.has(k) ? "reg-revisar" : ""}>{nombre}{revisar.has(k) ? " · revíselo" : ""}
            <input className="input" value={campos[k] ?? ""} onChange={(e) => { setCampos({ ...campos, [k]: e.target.value }); setRespuesta(null); }} />
          </label>
        ))}
      </div>
      {respuesta?.estado === "existe" ? (
        <div className="pila" style={{ gap: 8 }}>
          <div className="aviso info">{tipo === "vehiculo" ? `La placa ${respuesta.nombre}` : respuesta.nombre} ya está en la app con datos distintos. Marque lo que quiere actualizar:</div>
          {respuesta.diferencias.map((d) => (
            <label key={d.campo} className="fila peq" style={{ gap: 8 }}>
              <input type="checkbox" checked={marcados.has(d.campo)} onChange={(e) => { const m = new Set(marcados); if (e.target.checked) m.add(d.campo); else m.delete(d.campo); setMarcados(m); }} />
              <span><b>{d.etiqueta}:</b> {d.antes || "vacío"} → {d.nuevo}</span>
            </label>
          ))}
          <div className="fila" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-primario" disabled={!marcados.size || estado === "guardando"} onClick={() => guardar([...marcados])}><Check size={13} />Actualizar lo marcado</button>
            <button className="btn btn-sm" onClick={() => setRespuesta(null)}>Dejar como está</button>
          </div>
        </div>
      ) : respuesta ? (
        <div className="aviso" style={{ background: "var(--verde-s)", color: "var(--verde)" }}><Check size={14} />{
          respuesta.estado === "creado" ? `${respuesta.nombre} quedó guardado en ${tipo === "vehiculo" ? "Vehículos" : "Clientes"}.`
          : respuesta.estado === "actualizado" ? `${respuesta.nombre}: actualizado ${respuesta.diferencias.map((d) => d.etiqueta.toLowerCase()).join(", ")}.`
          : `${respuesta.nombre} ya estaba así en la app.`}</div>
      ) : null}
      {error && <div className="aviso error">{error}</div>}
      {respuesta?.estado !== "existe" && (
        <div className="fila" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-primario" disabled={estado === "guardando"} onClick={() => guardar()}>{estado === "guardando" ? <Loader2 size={13} className="girando" /> : <UserPlus size={13} />}{tipo === "vehiculo" ? "Guardar vehículo" : "Guardar como cliente"}</button>
          <button className="btn btn-sm" onClick={copiar}>{copiado ? <Check size={13} /> : <Copy size={13} />}{copiado ? "Copiado" : "Copiar datos"}</button>
        </div>
      )}
    </div>
  );
}
