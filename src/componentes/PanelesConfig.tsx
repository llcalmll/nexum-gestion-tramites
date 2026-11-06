import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CATEGORIA_LABEL, CATEGORIAS_TRAMITE, PRECONDICION_LABEL, PRECONDICIONES, type CategoriaTramite, type Precondicion } from "../../compartido/dominio";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { useOrganismos, useTipos } from "../datos/hooks";
import { BuscadorOrganismo, Campo, ErrorFormulario, Fecha, Opciones, Pesos, Texto } from "./formulario";
import { Panel, useUI } from "./ui";

/** Panel de edición genérico: guardar, borrar y errores. */
function PanelEdicion({ titulo, abierto, onCerrar, guardar, borrar, children }: { titulo: string; abierto: boolean; onCerrar: () => void; guardar: () => Promise<void>; borrar?: () => Promise<void>; children: React.ReactNode }) {
  const { avisar, confirmar } = useUI();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (abierto) setError(null); }, [abierto]);
  const correr = async (f: () => Promise<void>, ok: string) => {
    setError(null);
    setOcupado(true);
    try { await f(); avisar(ok); onCerrar(); } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(false); }
  };
  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={<h2>{titulo}</h2>}
      pie={
        <div className="fila" style={{ width: "100%" }}>
          {borrar && <button className="btn btn-peligro btn-sm" disabled={ocupado} onClick={async () => { if (await confirmar({ titulo: "Borrar", texto: "Esta acción no se puede deshacer.", boton: "Borrar", peligro: true })) correr(borrar, "Borrado"); }}><Trash2 size={14} />Borrar</button>}
          <div className="espacio" />
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={ocupado} onClick={() => correr(guardar, "Guardado")}>{ocupado ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      <div className="pila">{children}<ErrorFormulario error={error} /></div>
    </Panel>
  );
}

/* ───────────────────────── Tipo de trámite ───────────────────────── */

export function PanelTipo({ id, abierto, onCerrar }: { id: string | null; abierto: boolean; onCerrar: () => void }) {
  const previo = useLiveQuery(() => (id ? db.tipos_tramite.get(id) : undefined), [id]);
  const vacio = { nombre: "", categoria: "vehiculo" as CategoriaTramite, descripcion: "", requiereVehiculo: true, aplicaImpuestoRegistro: false, slaDias: "", orden: "0", activo: true, precondiciones: {} as Partial<Record<Precondicion, boolean>>, requisitos: [] as { documento: string; obligatorio: boolean }[] };
  const [f, setF] = useState(vacio);
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (id && !previo)) return;
    setCargado(true);
    setF(previo ? {
      nombre: previo.nombre, categoria: previo.categoria as CategoriaTramite, descripcion: previo.descripcion ?? "", requiereVehiculo: previo.requiereVehiculo, aplicaImpuestoRegistro: previo.aplicaImpuestoRegistro,
      slaDias: previo.slaDias == null ? "" : String(previo.slaDias), orden: String(previo.orden), activo: previo.activo, precondiciones: { ...previo.precondiciones }, requisitos: previo.requisitos.map((r) => ({ ...r })),
    } : vacio);
  }, [abierto, cargado, id, previo]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    const cuerpo = { ...f, slaDias: f.slaDias || null, requisitos: f.requisitos.filter((r) => r.documento.trim()) };
    await (id ? escribir("PATCH", `/api/config/tipos/${id}`, cuerpo) : escribir("POST", "/api/config/tipos", cuerpo));
  };
  return (
    <PanelEdicion titulo={id ? `Editar: ${previo?.nombre ?? ""}` : "Nuevo tipo de trámite"} abierto={abierto} onCerrar={onCerrar} guardar={guardar} borrar={id ? () => escribir("DELETE", `/api/config/tipos/${id}`).then(() => undefined) : undefined}>
      <div className="campos">
        <Campo etiqueta="Nombre" obligatorio ancho><Texto valor={f.nombre} cambiar={(v) => setF({ ...f, nombre: v })} /></Campo>
        <Campo etiqueta="Categoría"><Opciones valor={f.categoria} cambiar={(v) => setF({ ...f, categoria: (v || "vehiculo") as CategoriaTramite })} opciones={CATEGORIAS_TRAMITE.map((c) => [c, CATEGORIA_LABEL[c]] as const)} /></Campo>
        <Campo etiqueta="Días hábiles de entrega" ayuda="Con ellos se propone la fecha de entrega"><Texto valor={f.slaDias} cambiar={(v) => setF({ ...f, slaDias: v.replace(/\D/g, "") })} tipo="number" /></Campo>
        <Campo etiqueta="Orden en las listas"><Texto valor={f.orden} cambiar={(v) => setF({ ...f, orden: v.replace(/\D/g, "") })} tipo="number" /></Campo>
        <div className="campo pila" style={{ gap: 6 }}>
          <label className="fila peq"><input type="checkbox" checked={f.requiereVehiculo} onChange={(e) => setF({ ...f, requiereVehiculo: e.target.checked })} />Pide vehículo</label>
          <label className="fila peq"><input type="checkbox" checked={f.aplicaImpuestoRegistro} onChange={(e) => setF({ ...f, aplicaImpuestoRegistro: e.target.checked })} />Aplica impuesto de registro</label>
          <label className="fila peq"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activo (aparece al crear trámites)</label>
        </div>
        <Campo etiqueta="Descripción" ancho><textarea className="input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
      </div>
      <div>
        <div className="separador">Precondiciones</div>
        <div className="fila-wrap" style={{ gap: 6, marginTop: 8 }}>
          {PRECONDICIONES.map((p) => (
            <button type="button" key={p} className={`filtro-chip ${f.precondiciones[p] ? "on" : ""}`} onClick={() => setF({ ...f, precondiciones: { ...f.precondiciones, [p]: !f.precondiciones[p] } })}>{PRECONDICION_LABEL[p]}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="separador">Documentos requeridos</div>
        <div className="pila" style={{ gap: 6, marginTop: 8 }}>
          {f.requisitos.map((r, i) => (
            <div key={i} className="fila">
              <input className="input" value={r.documento} placeholder="Nombre del documento" onChange={(e) => setF({ ...f, requisitos: f.requisitos.map((x, j) => (j === i ? { ...x, documento: e.target.value } : x)) })} />
              <label className="fila peq" style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={r.obligatorio} onChange={(e) => setF({ ...f, requisitos: f.requisitos.map((x, j) => (j === i ? { ...x, obligatorio: e.target.checked } : x)) })} />Obligatorio</label>
              <button className="btn btn-sm btn-fantasma btn-icono" onClick={() => setF({ ...f, requisitos: f.requisitos.filter((_, j) => j !== i) })}><X size={14} /></button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setF({ ...f, requisitos: [...f.requisitos, { documento: "", obligatorio: true }] })}><Plus size={14} />Agregar documento</button>
        </div>
      </div>
    </PanelEdicion>
  );
}

/* ───────────────────────── Tarifa ───────────────────────── */

export function PanelTarifa({ id, abierto, onCerrar }: { id: string | null; abierto: boolean; onCerrar: () => void }) {
  const tipos = useTipos();
  const organismos = useOrganismos();
  const previo = useLiveQuery(() => (id ? db.tarifas.get(id) : undefined), [id]);
  const vacio = { tipoTramiteId: "", organismoId: "", derechosTransito: 0, componenteRunt: 0, estampillas: 0, pazSalvo: 0, honorarios: 0, vigenteDesde: "" };
  const [f, setF] = useState(vacio);
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (id && !previo)) return;
    setCargado(true);
    setF(previo ? { ...vacio, ...previo, organismoId: previo.organismoId ?? "", vigenteDesde: previo.vigenteDesde ?? "" } : vacio);
  }, [abierto, cargado, id, previo]); // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async () => {
    if (!f.tipoTramiteId) throw new Error("Elija el tipo de trámite.");
    const cuerpo = { tipoTramiteId: f.tipoTramiteId, organismoId: f.organismoId || null, derechosTransito: f.derechosTransito, componenteRunt: f.componenteRunt, estampillas: f.estampillas, pazSalvo: f.pazSalvo, honorarios: f.honorarios, vigenteDesde: f.vigenteDesde || null };
    await (id ? escribir("PATCH", `/api/config/tarifas/${id}`, cuerpo) : escribir("POST", "/api/config/tarifas", cuerpo));
  };
  return (
    <PanelEdicion titulo={id ? "Editar tarifa" : "Nueva tarifa"} abierto={abierto} onCerrar={onCerrar} guardar={guardar} borrar={id ? () => escribir("DELETE", `/api/config/tarifas/${id}`).then(() => undefined) : undefined}>
      <div className="campos">
        <Campo etiqueta="Tipo de trámite" obligatorio ancho><Opciones valor={f.tipoTramiteId} cambiar={(v) => setF({ ...f, tipoTramiteId: v })} vacio="Elegir…" opciones={tipos.map((t) => [t.id, t.nombre] as const)} /></Campo>
        <Campo etiqueta="Organismo" ancho ayuda="Vacío = aplica a todos los organismos"><BuscadorOrganismo organismos={organismos} valor={f.organismoId} cambiar={(v) => setF({ ...f, organismoId: v })} vacio="Todos" /></Campo>
        <Campo etiqueta="Derechos de tránsito"><Pesos valor={f.derechosTransito} cambiar={(v) => setF({ ...f, derechosTransito: v })} /></Campo>
        <Campo etiqueta="Componente RUNT"><Pesos valor={f.componenteRunt} cambiar={(v) => setF({ ...f, componenteRunt: v })} /></Campo>
        <Campo etiqueta="Estampillas"><Pesos valor={f.estampillas} cambiar={(v) => setF({ ...f, estampillas: v })} /></Campo>
        <Campo etiqueta="Paz y salvo"><Pesos valor={f.pazSalvo} cambiar={(v) => setF({ ...f, pazSalvo: v })} /></Campo>
        <Campo etiqueta="Honorarios" ayuda="0 = los honorarios por defecto"><Pesos valor={f.honorarios} cambiar={(v) => setF({ ...f, honorarios: v })} /></Campo>
        <Campo etiqueta="Vigente desde"><Fecha valor={f.vigenteDesde} cambiar={(v) => setF({ ...f, vigenteDesde: v })} /></Campo>
      </div>
    </PanelEdicion>
  );
}

/* ───────────────────────── Organismo ───────────────────────── */

export function PanelOrganismo({ id, abierto, onCerrar }: { id: string | null; abierto: boolean; onCerrar: () => void }) {
  const previo = useLiveQuery(() => (id ? db.organismos.get(id) : undefined), [id]);
  const vacio = { nombre: "", ciudad: "", departamento: "", notas: "", activo: true };
  const [f, setF] = useState(vacio);
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (id && !previo)) return;
    setCargado(true);
    setF(previo ? { nombre: previo.nombre, ciudad: previo.ciudad ?? "", departamento: previo.departamento ?? "", notas: previo.notas ?? "", activo: previo.activo } : vacio);
  }, [abierto, cargado, id, previo]); // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async () => {
    const cuerpo = { ...f, ciudad: f.ciudad || null, departamento: f.departamento || null, notas: f.notas || null };
    await (id ? escribir("PATCH", `/api/config/organismos/${id}`, cuerpo) : escribir("POST", "/api/config/organismos", cuerpo));
  };
  return (
    <PanelEdicion titulo={id ? "Editar organismo" : "Nuevo organismo"} abierto={abierto} onCerrar={onCerrar} guardar={guardar} borrar={id ? () => escribir("DELETE", `/api/config/organismos/${id}`).then(() => undefined) : undefined}>
      <div className="campos">
        <Campo etiqueta="Nombre" obligatorio ancho><Texto valor={f.nombre} cambiar={(v) => setF({ ...f, nombre: v })} /></Campo>
        <Campo etiqueta="Ciudad"><Texto valor={f.ciudad} cambiar={(v) => setF({ ...f, ciudad: v })} /></Campo>
        <Campo etiqueta="Departamento"><Texto valor={f.departamento} cambiar={(v) => setF({ ...f, departamento: v })} /></Campo>
        <Campo etiqueta="Notas" ancho><textarea className="input" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
        <label className="fila peq"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />Activo</label>
      </div>
    </PanelEdicion>
  );
}

/* ───────────────────────── Parámetro ───────────────────────── */

export function PanelParametro({ clave, abierto, onCerrar }: { clave: string | null; abierto: boolean; onCerrar: () => void }) {
  const previo = useLiveQuery(() => (clave ? db.parametros.get(clave) : undefined), [clave]);
  const [valor, setValor] = useState("");
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || !previo) return;
    setCargado(true);
    setValor(previo.valor);
  }, [abierto, cargado, previo]);
  const largo = valor.length > 80 || valor.includes("\n");
  return (
    <PanelEdicion titulo={`Parámetro: ${clave ?? ""}`} abierto={abierto} onCerrar={onCerrar} guardar={async () => { await escribir("PUT", `/api/config/parametros/${clave}`, { valor }); }}>
      {previo?.descripcion && <div className="muted">{previo.descripcion}</div>}
      <Campo etiqueta="Valor">
        {largo ? <textarea className="input" style={{ minHeight: 360, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }} value={valor} onChange={(e) => setValor(e.target.value)} /> : <input className="input" value={valor} onChange={(e) => setValor(e.target.value)} />}
      </Campo>
    </PanelEdicion>
  );
}
