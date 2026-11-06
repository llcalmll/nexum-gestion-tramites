import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { SERVICIOS_VEHICULO } from "../../compartido/dominio";
import { CLASES_VEHICULO, claseMasParecida, normalizarPlaca, soloDigitos } from "../../compartido/reglas";
import { db } from "../datos/db";
import { dividirNombre, nombreCompleto } from "../formatos/llenado";
import { escribir, mensajeDe } from "../datos/escribir";
import { useOpcionesClientes } from "../datos/hooks";
import { Buscador, Campo, ErrorFormulario, Fecha, LeerFoto, Opciones, Texto } from "./formulario";
import { Panel, useUI } from "./ui";

const CAMPOS = ["placa", "clase", "marca", "linea", "modelo", "cilindraje", "servicio", "color", "numeroMotor", "numeroChasis", "numeroSerie", "vin", "fechaMatricula", "combustible", "carroceria", "capacidad", "potencia", "licenciaTransito", "soatVence", "rtmVence", "impuestoAlDiaHasta"] as const;
type Formulario = Record<(typeof CAMPOS)[number], string>;
const VACIO = Object.fromEntries(CAMPOS.map((c) => [c, ""])) as Formulario;

/**
 * Crear o editar un vehículo. Al crear, el camino principal es la foto de la tarjeta de propiedad.
 * Solo la placa es obligatoria. El titular que trae la tarjeta se enlaza al cliente que ya existe o se crea.
 */
export function PanelVehiculo({ abierto, onCerrar, vehiculoId, titularInicial, alGuardar }: { abierto: boolean; onCerrar: () => void; vehiculoId?: string | null; titularInicial?: string | null; alGuardar?: (id: string, titularId: string | null) => void }) {
  const { avisar } = useUI();
  const previo = useLiveQuery(() => (vehiculoId ? db.vehiculos.get(vehiculoId) : undefined), [vehiculoId]);
  const clientes = useLiveQuery(() => db.clientes.toArray(), []) ?? [];
  const opcionesClientes = useOpcionesClientes();
  const [f, setF] = useState<Formulario>(VACIO);
  const [leidos, setLeidos] = useState<Set<string>>(new Set());
  const [titularId, setTitularId] = useState<string | null>(null);
  const [titularLeido, setTitularLeido] = useState<{ numeroDocumento: string; nombre: string } | null>(null);
  const [aMano, setAMano] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cargado, setCargado] = useState(false);

  useEffect(() => { if (!abierto) setCargado(false); }, [abierto]);
  useEffect(() => {
    if (!abierto || cargado || (vehiculoId && !previo)) return;
    setCargado(true);
    setError(null);
    setLeidos(new Set());
    setTitularLeido(null);
    setAMano(!!vehiculoId);
    setTitularId(previo?.titularId ?? titularInicial ?? null);
    setF(previo ? (Object.fromEntries(CAMPOS.map((c) => [c, previo[c] == null ? "" : String(previo[c])])) as Formulario) : VACIO);
  }, [abierto, cargado, vehiculoId, previo, titularInicial]);

  const poner = (k: keyof Formulario) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function alLeer(d: Record<string, string | string[]>) {
    const s = (k: string) => (d[k] ? String(d[k]) : "");
    const nuevos: Partial<Formulario> = {};
    if (s("placa")) nuevos.placa = normalizarPlaca(s("placa"));
    if (s("clase")) nuevos.clase = claseMasParecida(s("clase")) ?? s("clase");
    for (const [k, origen] of [["marca", "marca"], ["linea", "linea"], ["color", "color"], ["numeroMotor", "numeroMotor"], ["numeroChasis", "numeroChasis"], ["numeroSerie", "numeroSerie"], ["vin", "vin"], ["fechaMatricula", "fechaMatricula"], ["combustible", "combustible"], ["carroceria", "carroceria"], ["capacidad", "capacidad"], ["potencia", "potencia"], ["licenciaTransito", "licenciaTransito"]] as const) {
      if (s(origen)) nuevos[k] = s(origen);
    }
    if (s("modeloAnio")) nuevos.modelo = soloDigitos(s("modeloAnio")).slice(0, 4);
    if (s("cilindraje")) nuevos.cilindraje = soloDigitos(s("cilindraje"));
    const servicio = s("tipoServicio").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if ((SERVICIOS_VEHICULO as readonly string[]).includes(servicio)) nuevos.servicio = servicio;
    setF((x) => ({ ...x, ...nuevos }));
    setLeidos(new Set(Object.keys(nuevos)));
    setAMano(true);
    // Titular de la tarjeta: si ese documento ya es cliente se enlaza; si no, se propone crearlo.
    const doc = soloDigitos(s("documentoTitular"));
    if (doc) {
      const ya = clientes.find((c) => c.numeroDocumento === doc);
      if (ya) { setTitularId(ya.id); setTitularLeido(null); }
      // La tarjeta trae el nombre con los apellidos primero: se guarda como los demás clientes (nombres y apellidos).
      else { setTitularId(null); setTitularLeido({ numeroDocumento: doc, nombre: nombreCompleto({ ...dividirNombre(s("nombreTitular"), "", "", "apellidos"), tipoDocumento: "", documento: "", direccion: "", ciudad: "", telefono: "" }) }); }
    }
  }

  async function guardar() {
    setError(null);
    if (!f.placa.trim()) return setError("La placa es obligatoria.");
    if (titularLeido && (!titularLeido.numeroDocumento || !titularLeido.nombre.trim())) return setError("Complete el documento y el nombre del titular, o quítelo.");
    setGuardando(true);
    try {
      const cuerpo: Record<string, unknown> = Object.fromEntries(CAMPOS.map((c) => [c, f[c] || null]));
      cuerpo.titular = titularLeido ? { tipoDocumento: "CC", ...titularLeido } : titularId ? { id: titularId } : null;
      const r = vehiculoId
        ? await escribir<{ id: string; titularId: string | null }>("PATCH", `/api/vehiculos/${vehiculoId}`, cuerpo)
        : await escribir<{ id: string; titularId: string | null; titularCreado: boolean }>("POST", "/api/vehiculos", cuerpo);
      avisar(vehiculoId ? "Vehículo actualizado" : "titularCreado" in r && r.titularCreado ? "Vehículo y titular creados" : "Vehículo creado");
      alGuardar?.(r.id, r.titularId);
      onCerrar();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const l = (k: string) => leidos.has(k);
  /** Vigencias y datos de la tarjeta: casi nunca se escriben a mano (llegan de la foto o del RUNT); van plegados. */
  const MAS = ["soatVence", "rtmVence", "impuestoAlDiaHasta", "color", "cilindraje", "numeroMotor", "numeroChasis", "numeroSerie", "vin", "fechaMatricula", "combustible", "carroceria", "capacidad", "potencia", "licenciaTransito"] as const;
  const conDato = MAS.filter((k) => f[k]).length;
  const [masAbierto, setMasAbierto] = useState(false);
  useEffect(() => { if (leidos.size) setMasAbierto(true); }, [leidos]);
  const titularActual = clientes.find((c) => c.id === titularId);
  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={<h2>{vehiculoId ? `Editar vehículo ${previo?.placa ?? ""}` : "Nuevo vehículo"}</h2>}
      pie={
        <div className="fila" style={{ justifyContent: "flex-end", width: "100%" }}>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando || (!aMano && !vehiculoId)} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      <div className="pila">
        <LeerFoto tipo="tarjeta_propiedad" alLeer={alLeer} compacta={aMano} />
        {!vehiculoId && !aMano && <button className="btn btn-fantasma" onClick={() => setAMano(true)}>O escribir los datos a mano</button>}
        {aMano && (
          <div className="campos">
            {leidos.size > 0 && <div className="aviso info" style={{ gridColumn: "1 / -1" }}>Revise los datos leídos de la foto antes de guardar.</div>}
            <Campo etiqueta="Placa" obligatorio leido={l("placa")}><Texto valor={f.placa} cambiar={(v) => poner("placa")(v.toUpperCase())} mayusculas autoFocus={!leidos.size} /></Campo>
            <Campo etiqueta="Clase" leido={l("clase")}>
              <Opciones valor={f.clase} cambiar={poner("clase")} vacio="Sin dato" opciones={[...CLASES_VEHICULO.map((c) => [c, c] as const), ...(f.clase && !(CLASES_VEHICULO as readonly string[]).includes(f.clase) ? [[f.clase, f.clase] as const] : [])]} />
            </Campo>
            <Campo etiqueta="Marca" leido={l("marca")}><Texto valor={f.marca} cambiar={poner("marca")} mayusculas /></Campo>
            <Campo etiqueta="Línea" leido={l("linea")}><Texto valor={f.linea} cambiar={poner("linea")} mayusculas /></Campo>
            <Campo etiqueta="Modelo (año)" leido={l("modelo")}><Texto valor={f.modelo} cambiar={poner("modelo")} tipo="number" /></Campo>
            <Campo etiqueta="Servicio" leido={l("servicio")}>
              <Opciones valor={f.servicio} cambiar={poner("servicio")} vacio="Sin dato" opciones={[["particular", "Particular"], ["publico", "Público"], ["oficial", "Oficial"], ["diplomatico", "Diplomático"]] as const} />
            </Campo>

            <div className="separador">Titular</div>
            <div className="campo ancho">
              {titularLeido ? (
                <div className="pila" style={{ gap: 8 }}>
                  <div className="aviso info">Este documento no es cliente todavía: se crea al guardar.</div>
                  <div className="campos">
                    <Campo etiqueta="Documento del titular" leido><Texto valor={titularLeido.numeroDocumento} cambiar={(v) => setTitularLeido({ ...titularLeido, numeroDocumento: soloDigitos(v) })} /></Campo>
                    <Campo etiqueta="Nombre del titular" leido><Texto valor={titularLeido.nombre} cambiar={(v) => setTitularLeido({ ...titularLeido, nombre: v })} /></Campo>
                  </div>
                  <button className="btn btn-sm btn-fantasma" style={{ alignSelf: "flex-start" }} onClick={() => setTitularLeido(null)}>Elegir otro titular</button>
                </div>
              ) : (
                <>
                  <Buscador opciones={opcionesClientes} elegido={titularId} elegir={setTitularId} placeholder="Buscar titular por nombre o documento" />
                  {titularActual && leidos.size > 0 && <span className="peq tenue">El documento de la tarjeta ya es cliente: se enlaza con {titularActual.nombre}.</span>}
                </>
              )}
            </div>

            <details className="campo ancho mas-datos" open={masAbierto} onToggle={(e) => setMasAbierto((e.target as HTMLDetailsElement).open)}>
              <summary>Más datos: vigencias y datos de la tarjeta{conDato ? ` (${conDato} con dato)` : ""}</summary>
              <div className="campos">
            <div className="separador">Vigencias (opcionales)</div>
            <Campo etiqueta="SOAT vence"><Fecha valor={f.soatVence} cambiar={poner("soatVence")} /></Campo>
            <Campo etiqueta="Técnico-mecánica vence"><Fecha valor={f.rtmVence} cambiar={poner("rtmVence")} /></Campo>
            <Campo etiqueta="Impuesto al día hasta"><Fecha valor={f.impuestoAlDiaHasta} cambiar={poner("impuestoAlDiaHasta")} /></Campo>

            <div className="separador">Datos de la tarjeta</div>
            <Campo etiqueta="Color" leido={l("color")}><Texto valor={f.color} cambiar={poner("color")} mayusculas /></Campo>
            <Campo etiqueta="Cilindraje (cc)" leido={l("cilindraje")}><Texto valor={f.cilindraje} cambiar={poner("cilindraje")} tipo="number" /></Campo>
            <Campo etiqueta="Número de motor" leido={l("numeroMotor")}><Texto valor={f.numeroMotor} cambiar={poner("numeroMotor")} mayusculas /></Campo>
            <Campo etiqueta="Número de chasis" leido={l("numeroChasis")}><Texto valor={f.numeroChasis} cambiar={poner("numeroChasis")} mayusculas /></Campo>
            <Campo etiqueta="Número de serie" leido={l("numeroSerie")}><Texto valor={f.numeroSerie} cambiar={poner("numeroSerie")} mayusculas /></Campo>
            <Campo etiqueta="VIN" leido={l("vin")}><Texto valor={f.vin} cambiar={poner("vin")} mayusculas /></Campo>
            <Campo etiqueta="Fecha de matrícula" leido={l("fechaMatricula")}><Fecha valor={f.fechaMatricula} cambiar={poner("fechaMatricula")} /></Campo>
            <Campo etiqueta="Combustible" leido={l("combustible")}><Texto valor={f.combustible} cambiar={poner("combustible")} mayusculas /></Campo>
            <Campo etiqueta="Carrocería" leido={l("carroceria")}><Texto valor={f.carroceria} cambiar={poner("carroceria")} mayusculas /></Campo>
            <Campo etiqueta="Capacidad" leido={l("capacidad")}><Texto valor={f.capacidad} cambiar={poner("capacidad")} mayusculas /></Campo>
            <Campo etiqueta="Potencia (HP)" leido={l("potencia")}><Texto valor={f.potencia} cambiar={poner("potencia")} /></Campo>
            <Campo etiqueta="Licencia de tránsito No." leido={l("licenciaTransito")}><Texto valor={f.licenciaTransito} cambiar={poner("licenciaTransito")} /></Campo>
              </div>
            </details>
          </div>
        )}
        <ErrorFormulario error={error} />
      </div>
    </Panel>
  );
}
