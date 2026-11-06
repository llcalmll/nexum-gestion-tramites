import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import type { TipoRecordatorio } from "../../compartido/dominio";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { useOpcionesClientes } from "../datos/hooks";
import { hoyISO } from "../logica/formato";
import { Buscador, Campo, ErrorFormulario, Fecha, Opciones, Texto } from "./formulario";
import { Panel, useUI } from "./ui";

const TIPOS: [TipoRecordatorio, string][] = [["recordatorio", "Recordatorio"], ["llamada", "Llamada"], ["cita", "Cita"]];

/** Crear o editar (reprogramar) un recordatorio. Desde un expediente llega con el trámite y el cliente puestos. */
export function PanelRecordatorio({ abierto, onCerrar, id, clienteInicial, tramiteInicial }: { abierto: boolean; onCerrar: () => void; id?: string | null; clienteInicial?: string | null; tramiteInicial?: string | null }) {
  const { avisar, confirmar } = useUI();
  const previo = useLiveQuery(() => (id ? db.recordatorios.get(id) : undefined), [id]);
  const opciones = useOpcionesClientes();
  const vacio = { tipo: "recordatorio" as TipoRecordatorio, titulo: "", fecha: hoyISO(), hora: "", clienteId: null as string | null, tramiteId: null as string | null, notas: "" };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (id && !previo)) return;
    setCargado(true);
    setError(null);
    setF(previo
      ? { tipo: previo.tipo as TipoRecordatorio, titulo: previo.titulo, fecha: previo.fecha, hora: previo.hora ?? "", clienteId: previo.clienteId, tramiteId: previo.tramiteId, notas: previo.notas ?? "" }
      : { ...vacio, clienteId: clienteInicial ?? null, tramiteId: tramiteInicial ?? null });
  }, [abierto, cargado, id, previo, clienteInicial, tramiteInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    setError(null);
    if (!f.titulo.trim()) return setError("Escriba qué hay que hacer.");
    setGuardando(true);
    try {
      const cuerpo = { ...f, hora: f.hora || null, notas: f.notas || null, ...(id && previo?.estado !== "pendiente" && f.fecha !== previo?.fecha ? { estado: "pendiente" } : {}) };
      await (id ? escribir("PATCH", `/api/recordatorios/${id}`, cuerpo) : escribir("POST", "/api/recordatorios", cuerpo));
      avisar(id ? "Recordatorio actualizado" : "Recordatorio creado");
      onCerrar();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={<h2>{id ? "Editar recordatorio" : "Nuevo recordatorio"}</h2>}
      pie={
        <div className="fila" style={{ width: "100%" }}>
          {id && <button className="btn btn-peligro btn-sm" onClick={async () => {
            if (!(await confirmar({ titulo: "Borrar recordatorio", boton: "Borrar", peligro: true }))) return;
            try { await escribir("DELETE", `/api/recordatorios/${id}`); avisar("Recordatorio borrado"); onCerrar(); } catch (e) { setError(mensajeDe(e)); }
          }}>Borrar</button>}
          <div className="espacio" />
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      <div className="pila">
        <div className="campos">
          <Campo etiqueta="Qué hay que hacer" obligatorio ancho><Texto valor={f.titulo} cambiar={(v) => setF({ ...f, titulo: v })} autoFocus /></Campo>
          <Campo etiqueta="Tipo"><Opciones valor={f.tipo} cambiar={(v) => setF({ ...f, tipo: (v || "recordatorio") as TipoRecordatorio })} opciones={TIPOS} /></Campo>
          <Campo etiqueta="Fecha" obligatorio><Fecha valor={f.fecha} cambiar={(v) => setF({ ...f, fecha: v })} /></Campo>
          <Campo etiqueta="Hora" ayuda="Opcional"><input className="input" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></Campo>
          <Campo etiqueta="Cliente" ancho ayuda="Opcional">
            <Buscador opciones={opciones} elegido={f.clienteId} elegir={(c) => setF({ ...f, clienteId: c })} placeholder="Buscar cliente" />
          </Campo>
          <Campo etiqueta="Notas" ancho><textarea className="input" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
        </div>
        <ErrorFormulario error={error} />
      </div>
    </Panel>
  );
}
