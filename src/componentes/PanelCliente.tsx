import { useLiveQuery } from "dexie-react-hooks";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ROL_PERSONA_LABEL, ROLES_PERSONA, type RolPersona, TIPOS_DOCUMENTO, type TipoDocumento } from "../../compartido/dominio";
import { db } from "../datos/db";
import { ErrorEscritura, escribir, mensajeDe } from "../datos/escribir";
import { Campo, ErrorFormulario, Fecha, LeerFoto, Opciones, Texto } from "./formulario";
import { Panel, useUI } from "./ui";

interface Formulario {
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombre: string;
  telefono: string;
  /** Los demás números de la persona (muchas tienen varios). */
  otrosTelefonos: string[];
  ciudad: string;
  direccion: string;
  fechaNacimiento: string;
  fechaExpedicionDocumento: string;
}
/** Una persona de un trámite (no el titular): al editarla, también se cambia su rol en ese trámite. */
export interface PersonaDelTramite { tramiteId: string; personaId: string }
const VACIO: Formulario = { tipoDocumento: "CC", numeroDocumento: "", nombre: "", telefono: "", otrosTelefonos: [], ciudad: "", direccion: "", fechaNacimiento: "", fechaExpedicionDocumento: "" };

/**
 * Crear o editar un cliente. Al crear, el camino principal es la foto de la cédula:
 * se lee, se revisa y se guarda. Solo el nombre es obligatorio; el documento se puede completar después.
 */
export function PanelCliente({ abierto, onCerrar, clienteId, alGuardar, inicial, foto, persona }: {
  abierto: boolean; onCerrar: () => void; clienteId?: string | null; alGuardar?: (id: string) => void;
  /** Editando una persona del trámite: su rol (comprador, apoderado...) se cambia aquí también. */
  persona?: PersonaDelTramite | null;
  /** Al crear: datos que ya se saben (por ejemplo, el teléfono del chat de WhatsApp). */
  inicial?: Partial<Formulario>;
  /** Al crear: foto de la cédula que ya se tiene; se lee sola. */
  foto?: Blob | null;
}) {
  const { avisar } = useUI();
  const previo = useLiveQuery(() => (clienteId ? db.clientes.get(clienteId) : undefined), [clienteId]);
  const rolPrevio = useLiveQuery(() => (persona ? db.tramite_personas.get(persona.personaId) : undefined), [persona?.personaId])?.rol as RolPersona | undefined;
  const [rol, setRol] = useState<RolPersona | "">("");
  const [f, setF] = useState<Formulario>(VACIO);
  const [leidos, setLeidos] = useState<Set<string>>(new Set());
  const [aMano, setAMano] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existente, setExistente] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Se carga una sola vez al abrir: una actualización de datos en segundo plano no borra lo que se está escribiendo.
  const [cargado, setCargado] = useState(false);
  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (clienteId && !previo)) return;
    setCargado(true);
    setRol(rolPrevio ?? "");
    setError(null);
    setExistente(null);
    setLeidos(new Set());
    // Editando, o con el nombre ya escrito (desde el buscador de personas): los campos de una vez.
    setAMano(!!clienteId || !!inicial?.nombre);
    setF(previo ? {
      tipoDocumento: previo.tipoDocumento as TipoDocumento, numeroDocumento: previo.numeroDocumento, nombre: previo.nombre, telefono: previo.telefono ?? "", otrosTelefonos: previo.otrosTelefonos ?? [],
      ciudad: previo.ciudad ?? "", direccion: previo.direccion ?? "", fechaNacimiento: previo.fechaNacimiento ?? "", fechaExpedicionDocumento: previo.fechaExpedicionDocumento ?? "",
    } : { ...VACIO, ...inicial });
  }, [abierto, cargado, clienteId, previo, inicial, rolPrevio]);

  const poner = (k: keyof Formulario) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function alLeer(d: Record<string, string | string[]>) {
    const tipo = String(d.tipoDocumento ?? "").toUpperCase();
    const nuevos: Partial<Formulario> = {
      ...(tipo === "CC" || tipo === "CE" ? { tipoDocumento: tipo } : {}),
      ...(d.numeroDocumento ? { numeroDocumento: String(d.numeroDocumento) } : {}),
      ...(d.nombreCompleto ? { nombre: String(d.nombreCompleto) } : {}),
      ...(d.fechaNacimiento ? { fechaNacimiento: String(d.fechaNacimiento) } : {}),
      ...(d.fechaExpedicionDocumento ? { fechaExpedicionDocumento: String(d.fechaExpedicionDocumento) } : {}),
    };
    setF((x) => ({ ...x, ...nuevos }));
    setLeidos(new Set(Object.keys(nuevos)));
    setAMano(true);
  }

  async function guardar() {
    setError(null);
    setExistente(null);
    if (!f.nombre.trim()) return setError("El nombre es obligatorio.");
    setGuardando(true);
    try {
      const cuerpo = { ...f, telefono: f.telefono || null, otrosTelefonos: f.otrosTelefonos.map((t) => t.trim()).filter(Boolean), ciudad: f.ciudad || null, direccion: f.direccion || null, fechaNacimiento: f.fechaNacimiento || null, fechaExpedicionDocumento: f.fechaExpedicionDocumento || null };
      // El rol en el trámite primero (si cambió): si falla, no se guarda nada a medias.
      const cambioRol = !!(persona && rol && rol !== rolPrevio);
      if (cambioRol) await escribir("PATCH", `/api/tramites/${persona!.tramiteId}/personas/${persona!.personaId}`, { rol });
      const r = clienteId ? await escribir<{ id: string }>("PATCH", `/api/clientes/${clienteId}`, cuerpo) : await escribir<{ id: string }>("POST", "/api/clientes", cuerpo);
      avisar(clienteId ? (cambioRol ? `Guardado: ahora ${ROL_PERSONA_LABEL[rol as RolPersona].toLowerCase()} en este trámite` : "Cliente actualizado") : "Cliente creado");
      alGuardar?.(r.id);
      onCerrar();
    } catch (e) {
      setError(mensajeDe(e));
      if (e instanceof ErrorEscritura && typeof e.datos.existenteId === "string") setExistente(e.datos.existenteId);
    } finally {
      setGuardando(false);
    }
  }

  const l = (k: string) => leidos.has(k);
  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={<h2>{clienteId ? "Editar cliente" : "Nuevo cliente"}</h2>}
      pie={
        <div className="fila" style={{ justifyContent: "flex-end", width: "100%" }}>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando || (!aMano && !clienteId)} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      <div className="pila">
        {!clienteId && <LeerFoto tipo="cedula" alLeer={alLeer} compacta={aMano} inicial={abierto ? foto : null} />}
        {!clienteId && !aMano && (
          <button className="btn btn-fantasma" onClick={() => setAMano(true)}>O escribir los datos a mano</button>
        )}
        {aMano && (
          <div className="campos">
            {leidos.size > 0 && <div className="aviso info ancho" style={{ gridColumn: "1 / -1" }}>Revise los datos leídos de la foto antes de guardar.</div>}
            {persona && rolPrevio && (
              <Campo etiqueta="Rol en este trámite" ancho ayuda="Lo que es en este trámite (comprador, apoderado...); no cambia sus datos en los demás">
                <Opciones valor={rol} cambiar={(v) => v && setRol(v as RolPersona)} opciones={ROLES_PERSONA.filter((x) => x !== "titular").map((x) => [x, ROL_PERSONA_LABEL[x]] as const)} />
              </Campo>
            )}
            <Campo etiqueta="Tipo de documento" leido={l("tipoDocumento")}>
              <Opciones valor={f.tipoDocumento} cambiar={(v) => poner("tipoDocumento")(v || "CC")} opciones={TIPOS_DOCUMENTO.map((t) => [t, t] as const)} />
            </Campo>
            <Campo etiqueta="Número de documento" leido={l("numeroDocumento")} ayuda={f.numeroDocumento ? undefined : "Se puede completar después"}>
              <Texto valor={f.numeroDocumento} cambiar={poner("numeroDocumento")} autoFocus={!leidos.size} />
            </Campo>
            <Campo etiqueta="Nombre completo" obligatorio ancho leido={l("nombre")}>
              <Texto valor={f.nombre} cambiar={poner("nombre")} placeholder="Nombres y apellidos" />
            </Campo>
            <Campo etiqueta="Teléfono" ayuda={f.otrosTelefonos.length ? "El principal (WhatsApp y formulario único)" : "Opcional"}>
              <Texto valor={f.telefono} cambiar={poner("telefono")} tipo="tel" placeholder="300 000 0000" etiqueta="Teléfono" />
            </Campo>
            {/* Los demás números (fuera de la etiqueta del principal): uno por fila, con su X; el botón agrega otro. */}
            <div className="otros-telefonos">
              {f.otrosTelefonos.map((t, i) => (
                <span key={i} className="fila otro-telefono">
                  <Texto valor={t} cambiar={(v) => setF((x) => ({ ...x, otrosTelefonos: x.otrosTelefonos.map((y, k) => (k === i ? v : y)) }))} tipo="tel" placeholder="Otro número" etiqueta={`Otro teléfono ${i + 1}`} autoFocus={!t} />
                  <button type="button" className="btn btn-sm btn-fantasma btn-icono" aria-label={`Quitar el otro teléfono ${i + 1}`} title="Quitar este número" onClick={() => setF((x) => ({ ...x, otrosTelefonos: x.otrosTelefonos.filter((_, k) => k !== i) }))}><X size={14} /></button>
                </span>
              ))}
              {f.otrosTelefonos.length < 5 && <button type="button" className="btn btn-sm agregar-telefono" onClick={() => setF((x) => ({ ...x, otrosTelefonos: [...x.otrosTelefonos, ""] }))}><Plus size={13} />Agregar otro número</button>}
            </div>
            <Campo etiqueta="Ciudad" ayuda="Opcional">
              <Texto valor={f.ciudad} cambiar={poner("ciudad")} />
            </Campo>
            <Campo etiqueta="Dirección" ayuda="Opcional: sale en el formulario único">
              <Texto valor={f.direccion} cambiar={poner("direccion")} />
            </Campo>
            <Campo etiqueta="Fecha de nacimiento" leido={l("fechaNacimiento")} ayuda="Se exige solo para trámites de licencia">
              <Fecha valor={f.fechaNacimiento} cambiar={poner("fechaNacimiento")} />
            </Campo>
            <Campo etiqueta="Expedición del documento" leido={l("fechaExpedicionDocumento")} ayuda="La usa la consulta RNMC">
              <Fecha valor={f.fechaExpedicionDocumento} cambiar={poner("fechaExpedicionDocumento")} />
            </Campo>
          </div>
        )}
        <ErrorFormulario error={error} />
        {existente && alGuardar && (
          <button className="btn" onClick={() => { alGuardar(existente); onCerrar(); }}>Usar el cliente que ya existe</button>
        )}
      </div>
    </Panel>
  );
}
