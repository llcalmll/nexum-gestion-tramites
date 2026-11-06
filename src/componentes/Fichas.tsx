import { useLiveQuery } from "dexie-react-hooks";
import { Car, FilePlus2, IdCard, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { codigoTramite, ESTADO_TRAMITE_COLOR, ESTADO_TRAMITE_LABEL, type EstadoTramite, type Gravamen, ROL_PERSONA_LABEL, type RolPersona, type TipoGravamen, TIPOS_GRAVAMEN } from "../../compartido/dominio";
import { db } from "../datos/db";
import { escribir, mensajeDe } from "../datos/escribir";
import { fecha, pesos, TONO_SEMAFORO } from "../logica/formato";
import { api } from "../datos/api";
import { Campo, ErrorFormulario, Fecha, LeerFoto, Opciones, Texto } from "./formulario";
import { PanelCliente, type PersonaDelTramite } from "./PanelCliente";
import { PanelVehiculo } from "./PanelVehiculo";
import { Badge, Panel, useUI } from "./ui";
import { BotonRuntCliente, BotonRuntVehiculo } from "./ConsultasRunt";
import { nombresDeCombos, unoPorCombo } from "../logica/combos";
import { Copiar } from "./Copiar";
import { BotonFinalizar } from "./Finalizar";
import { InfoIncompleta } from "./InfoIncompleta";
import { useFaltantes } from "../datos/incompletos";
import { Vigencia } from "./Vigencia";

const GRAVAMEN_LABEL: Record<TipoGravamen, string> = { prenda: "Prenda / garantía mobiliaria", embargo: "Embargo", limitacion_dominio: "Limitación de dominio" };

/** Un dato de la ficha. Si es texto, se puede copiar (o lo que diga `copiar`). */
function Dato({ t, children, copiar }: { t: string; children: React.ReactNode; copiar?: string | null }) {
  const valor = copiar !== undefined ? copiar : typeof children === "string" || typeof children === "number" ? String(children) : null;
  return <div><dt>{t}</dt><dd>{children || <span className="sin-dato">Sin dato</span>}{children ? <Copiar valor={valor} que={t.toLowerCase()} /> : null}</dd></div>;
}

function ListaTramites({ filtro }: { filtro: { titularId?: string; vehiculoId?: string } }) {
  const nav = useNavigate();
  const datos = useLiveQuery(async () => {
    const lista = filtro.titularId ? await db.tramites.where("titularId").equals(filtro.titularId).toArray() : await db.tramites.where("vehiculoId").equals(filtro.vehiculoId!).toArray();
    const tipos = new Map((await db.tipos_tramite.toArray()).map((t) => [t.id, t.nombre]));
    // Un combo va una vez, con sus trámites juntos.
    const combos = nombresDeCombos(lista, tipos);
    return unoPorCombo(lista.sort((a, b) => a.numero - b.numero)).reverse().map((t) => ({ t, tipo: (t.encargoId && combos.get(t.encargoId)) || (tipos.get(t.tipoId) ?? ""), combo: !!(t.encargoId && combos.has(t.encargoId)) }));
  }, [filtro.titularId, filtro.vehiculoId]);
  const faltan = useFaltantes();
  if (!datos?.length) return <div className="peq tenue">Sin trámites.</div>;
  return (
    <div className="lista-filas">
      {datos.map(({ t, tipo, combo }) => (
        <a key={t.id} className="item" href={`/tramites/${t.id}`} onClick={(e) => { e.preventDefault(); nav(`/tramites/${t.id}`); }}>
          <div className="principal"><b>{tipo}</b><small>{codigoTramite(t)}{combo ? " · combo" : ""}</small></div>
          <InfoIncompleta falta={faltan.get(t.id)} />
          <Badge tono={TONO_SEMAFORO[ESTADO_TRAMITE_COLOR[t.estado as EstadoTramite]]} punto>{ESTADO_TRAMITE_LABEL[t.estado as EstadoTramite]}</Badge>
          <BotonFinalizar t={t} etiqueta={false} tamano="xs" />
        </a>
      ))}
    </div>
  );
}

/* ───────────────────────── Cliente ───────────────────────── */

/** `persona`: abierta desde una persona del trámite (no el titular): muestra su rol, que se cambia en "Editar". */
export function FichaCliente({ clienteId, onCerrar, persona }: { clienteId: string | null; onCerrar: () => void; persona?: PersonaDelTramite | null }) {
  const nav = useNavigate();
  const { confirmar, avisar } = useUI();
  const c = useLiveQuery(() => (clienteId ? db.clientes.get(clienteId) : undefined), [clienteId]);
  const vehiculos = useLiveQuery(() => (clienteId ? db.vehiculos.where("titularId").equals(clienteId).toArray() : []), [clienteId]) ?? [];
  const licencias = useLiveQuery(() => (clienteId ? db.licencias.where("clienteId").equals(clienteId).toArray() : []), [clienteId]) ?? [];
  const chat = useLiveQuery(() => (clienteId ? db.wa_chats.where("clienteId").equals(clienteId).first() : undefined), [clienteId]);
  const [editar, setEditar] = useState(false);
  const rol = useLiveQuery(() => (persona ? db.tramite_personas.get(persona.personaId) : undefined), [persona?.personaId])?.rol;
  const [nuevoVehiculo, setNuevoVehiculo] = useState(false);
  const [vehiculo, setVehiculo] = useState<string | null>(null);
  const [leerLicencia, setLeerLicencia] = useState(false);
  const [licencia, setLicencia] = useState<{ categorias: string; fechaVencimiento: string; fechaExpedicion: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guardarLicencia() {
    if (!licencia || !clienteId) return;
    setError(null);
    try {
      await escribir("POST", `/api/clientes/${clienteId}/licencias`, { ...licencia, categorias: licencia.categorias.split(/[,\s]+/), origen: "foto" });
      avisar("Licencia registrada");
      setLicencia(null);
      setLeerLicencia(false);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  return (
    <>
      <Panel
        abierto={!!clienteId && !!c}
        onCerrar={onCerrar}
        cabecera={<div><h2>{c?.nombre}<Copiar valor={c?.nombre} que="el nombre" /></h2><div className="peq tenue">{c?.numeroDocumento ? <>{c.tipoDocumento} {c.numeroDocumento}<Copiar valor={c.numeroDocumento} que="el documento" /></> : "Sin documento"}</div></div>}
        pie={
          <div className="fila" style={{ width: "100%" }}>
            <button className="btn btn-peligro btn-sm" onClick={async () => {
              if (!clienteId || !(await confirmar({ titulo: "Borrar cliente", texto: "Solo se puede borrar si no tiene trámites.", boton: "Borrar", peligro: true }))) return;
              try { await escribir("DELETE", `/api/clientes/${clienteId}`); avisar("Cliente borrado"); onCerrar(); } catch (e) { avisar(mensajeDe(e), "error"); }
            }}><Trash2 size={14} />Borrar</button>
            <div className="espacio" />
            <button className="btn" onClick={() => setEditar(true)}><Pencil size={14} />Editar</button>
            <button className="btn btn-primario" onClick={() => { onCerrar(); nav(`/tramites?nuevo=1&titular=${clienteId}`); }}><FilePlus2 size={14} />Nuevo trámite</button>
          </div>
        }
      >
        {c && (
          <div className="pila">
            <dl className="dl">
              {persona && rol && <div><dt>Rol en este trámite</dt><dd>{ROL_PERSONA_LABEL[rol as RolPersona] ?? rol}</dd></div>}
              <Dato t="Teléfono" copiar={c.telefono}>{c.telefono}{chat && chat.clasificacion !== "personal" && <> · <a href={`/whatsapp?chat=${chat.id}`} onClick={(e) => { e.preventDefault(); onCerrar(); nav(`/whatsapp?chat=${chat.id}`); }}>Ver chat de WhatsApp ({chat.mensajes})</a></>}</Dato>
              {(c.otrosTelefonos ?? []).length > 0 && <Dato t="Otros teléfonos"><span className="telefonos-extra">{c.otrosTelefonos!.map((x) => <span key={x}>{x}<Copiar valor={x} que="el teléfono" /></span>)}</span></Dato>}
              <Dato t="Ciudad">{c.ciudad}</Dato>
              <Dato t="Dirección">{c.direccion}</Dato>
              <Dato t="Fecha de nacimiento">{fecha(c.fechaNacimiento)}</Dato>
              <Dato t="Expedición del documento">{fecha(c.fechaExpedicionDocumento)}</Dato>
            </dl>

            <div>
              <div className="fila" style={{ justifyContent: "space-between" }}><h3>Vehículos</h3><button className="btn btn-sm" onClick={() => setNuevoVehiculo(true)}><Plus size={14} />Agregar</button></div>
              <div className="lista-filas">
                {vehiculos.map((v) => (
                  <button key={v.id} className="item fila-ia" style={{ border: 0, background: "none", width: "100%", textAlign: "left", font: "inherit" }} onClick={() => setVehiculo(v.id)}>
                    <Car size={16} className="tenue" />
                    <div className="principal"><b>{v.placa}</b><small>{[v.marca, v.linea, v.modelo].filter(Boolean).join(" ")}</small></div>
                  </button>
                ))}
                {!vehiculos.length && <div className="peq tenue">Sin vehículos a su nombre.</div>}
              </div>
            </div>

            <div>
              <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3>Licencias</h3>
                <span className="fila" style={{ gap: 6, alignItems: "flex-start" }}>
                  <BotonRuntCliente cliente={c} />
                  <button className="btn btn-sm" onClick={() => setLeerLicencia(!leerLicencia)}><IdCard size={14} />Leer licencia</button>
                </span>
              </div>
              {leerLicencia && (
                <div className="pila" style={{ gap: 10, margin: "8px 0" }}>
                  <LeerFoto tipo="licencia" compacta={!!licencia} alLeer={(d) => setLicencia({
                    categorias: Array.isArray(d.categorias) ? d.categorias.join(", ") : String(d.categorias ?? ""),
                    fechaVencimiento: String(d.fechaVencimiento ?? ""),
                    fechaExpedicion: String(d.fechaExpedicion ?? ""),
                  })} />
                  {licencia && (
                    <div className="campos">
                      <Campo etiqueta="Categorías" leido ancho><Texto valor={licencia.categorias} cambiar={(v) => setLicencia({ ...licencia, categorias: v.toUpperCase() })} /></Campo>
                      <Campo etiqueta="Vence" leido><Fecha valor={licencia.fechaVencimiento} cambiar={(v) => setLicencia({ ...licencia, fechaVencimiento: v })} /></Campo>
                      <Campo etiqueta="Expedición" leido><Fecha valor={licencia.fechaExpedicion} cambiar={(v) => setLicencia({ ...licencia, fechaExpedicion: v })} /></Campo>
                      <div style={{ gridColumn: "1 / -1" }}><button className="btn btn-primario btn-sm" onClick={guardarLicencia}>Guardar licencia</button></div>
                    </div>
                  )}
                  <ErrorFormulario error={error} />
                </div>
              )}
              <div className="lista-filas">
                {licencias.map((l) => (
                  <div key={l.id} className="item"><div className="principal"><b>{l.categoria}</b><small>Expedida {fecha(l.fechaExpedicion) || "sin dato"}</small></div><Vigencia hasta={l.fechaVencimiento} /></div>
                ))}
                {!licencias.length && !leerLicencia && <div className="peq tenue">Sin licencias registradas.</div>}
              </div>
            </div>

            <div><h3 style={{ marginBottom: 4 }}>Trámites</h3><ListaTramites filtro={{ titularId: c.id }} /></div>
          </div>
        )}
      </Panel>
      <PanelCliente abierto={editar} onCerrar={() => setEditar(false)} clienteId={clienteId} persona={persona} />
      <PanelVehiculo abierto={nuevoVehiculo} onCerrar={() => setNuevoVehiculo(false)} titularInicial={clienteId} />
      <FichaVehiculo vehiculoId={vehiculo} onCerrar={() => setVehiculo(null)} />
    </>
  );
}

/* ───────────────────────── Avalúo (base gravable) ───────────────────────── */

type ResultadoAvaluo = { id: number; tipo: string; clase: string | null; marca: string; linea: string; cilindraje: string | null; valor?: number; anioUsado?: number };

function Avaluo({ v }: { v: { id: string; marca: string | null; linea: string | null; modelo: number | null; avaluoOficial: number | null; avaluoDetalle: string | null } }) {
  const { avisar } = useUI();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [modelo, setModelo] = useState("");
  const [resultados, setResultados] = useState<{ anioFiscal: number; resultados: ResultadoAvaluo[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar(texto = q, anio = modelo) {
    setError(null);
    setBuscando(true);
    try {
      setResultados(await api(`/api/avaluos?q=${encodeURIComponent(texto)}&modelo=${encodeURIComponent(anio)}`));
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }
  function abrir() {
    const texto = [v.marca, v.linea].filter(Boolean).join(" ");
    const anio = v.modelo ? String(v.modelo) : "";
    setQ(texto); setModelo(anio); setResultados(null); setAbierto(true);
    if (texto) buscar(texto, anio);
  }
  async function usar(r: ResultadoAvaluo) {
    if (!r.valor) return setError("Escriba el año modelo para calcular el avalúo.");
    try {
      await escribir("PATCH", `/api/vehiculos/${v.id}`, { avaluoOficial: r.valor, avaluoDetalle: `${r.marca} ${r.linea}${r.cilindraje ? ` ${r.cilindraje}` : ""} · modelo ${r.anioUsado} · base gravable ${resultados?.anioFiscal}` });
      avisar("Avalúo guardado");
      setAbierto(false);
    } catch (e) { setError(mensajeDe(e)); }
  }

  return (
    <div>
      <div className="fila" style={{ justifyContent: "space-between" }}>
        <h3>Avalúo</h3>
        <button className="btn btn-sm" onClick={abrir}>{v.avaluoOficial ? "Recalcular" : "Buscar en la base gravable"}</button>
      </div>
      <div className="peq" style={{ marginTop: 4 }}>
        {v.avaluoOficial ? <><b>{pesos(v.avaluoOficial)}</b> <span className="tenue">· {v.avaluoDetalle}</span></> : <span className="sin-dato">Sin avalúo. Se usa para el impuesto de registro y la retención en traspasos.</span>}
      </div>
      {abierto && (
        <div className="pila" style={{ gap: 8, marginTop: 10 }}>
          <div className="fila">
            <input className="input" placeholder="Marca y línea" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} />
            <input className="input" style={{ width: 90 }} placeholder="Modelo" inputMode="numeric" value={modelo} onChange={(e) => setModelo(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && buscar()} />
            <button className="btn btn-sm btn-primario" disabled={buscando} onClick={() => buscar()}>{buscando ? "Buscando…" : "Buscar"}</button>
          </div>
          <ErrorFormulario error={error} />
          {resultados && (
            <div className="lista-filas">
              {resultados.resultados.map((r) => (
                <div key={r.id} className="item">
                  <div className="principal"><b>{r.marca} {r.linea}</b><small>{[r.clase, r.cilindraje && `${r.cilindraje}`, r.anioUsado && r.anioUsado !== Number(modelo) ? `se usa el año ${r.anioUsado}` : null].filter(Boolean).join(" · ")}</small></div>
                  {r.valor ? <b>{pesos(r.valor)}</b> : <span className="peq tenue">Falta el modelo</span>}
                  <button className="btn btn-sm" onClick={() => usar(r)}>Usar</button>
                </div>
              ))}
              {!resultados.resultados.length && <div className="peq tenue">No encontré líneas con esas palabras. Pruebe con menos palabras (por ejemplo, solo la marca y el modelo de la línea).</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Vehículo ───────────────────────── */

export function FichaVehiculo({ vehiculoId, onCerrar }: { vehiculoId: string | null; onCerrar: () => void }) {
  const { confirmar, avisar } = useUI();
  const v = useLiveQuery(() => (vehiculoId ? db.vehiculos.get(vehiculoId) : undefined), [vehiculoId]);
  const titular = useLiveQuery(() => (v?.titularId ? db.clientes.get(v.titularId) : undefined), [v?.titularId]);
  const [editar, setEditar] = useState(false);
  const [nuevoGravamen, setNuevoGravamen] = useState<Gravamen | null>(null);

  async function guardarGravamenes(lista: Gravamen[]) {
    try { await escribir("PATCH", `/api/vehiculos/${vehiculoId}`, { gravamenes: lista }); avisar("Gravámenes actualizados"); setNuevoGravamen(null); } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  return (
    <>
      <Panel
        abierto={!!vehiculoId && !!v}
        onCerrar={onCerrar}
        cabecera={<div><h2>{v?.placa}<Copiar valor={v?.placa} que="la placa" /></h2><div className="peq tenue">{[v?.clase, v?.marca, v?.linea, v?.modelo].filter(Boolean).join(" · ")}</div></div>}
        pie={
          <div className="fila" style={{ width: "100%" }}>
            <button className="btn btn-peligro btn-sm" onClick={async () => {
              if (!vehiculoId || !(await confirmar({ titulo: "Borrar vehículo", texto: "Solo se puede borrar si no tiene trámites.", boton: "Borrar", peligro: true }))) return;
              try { await escribir("DELETE", `/api/vehiculos/${vehiculoId}`); avisar("Vehículo borrado"); onCerrar(); } catch (e) { avisar(mensajeDe(e), "error"); }
            }}><Trash2 size={14} />Borrar</button>
            <div className="espacio" />
            <button className="btn" onClick={() => setEditar(true)}><Pencil size={14} />Editar</button>
          </div>
        }
      >
        {v && (
          <div className="pila">
            <dl className="dl">
              <Dato t="Titular">{titular ? `${titular.nombre}${titular.numeroDocumento ? ` (${titular.numeroDocumento})` : ""}` : ""}</Dato>
              <Dato t="Servicio">{v.servicio}</Dato>
              <Dato t="SOAT"><Vigencia hasta={v.soatVence} /></Dato>
              <Dato t="Técnico-mecánica"><Vigencia hasta={v.rtmVence} /></Dato>
              <Dato t="Impuesto al día hasta"><Vigencia hasta={v.impuestoAlDiaHasta} /></Dato>
              <Dato t="Color">{v.color}</Dato>
              <Dato t="Cilindraje">{v.cilindraje ? `${v.cilindraje} cc` : ""}</Dato>
              <Dato t="Motor">{v.numeroMotor}</Dato>
              <Dato t="Chasis">{v.numeroChasis}</Dato>
              <Dato t="Serie">{v.numeroSerie}</Dato>
              <Dato t="VIN">{v.vin}</Dato>
              <Dato t="Matrícula">{fecha(v.fechaMatricula)}</Dato>
              <Dato t="Combustible">{v.combustible}</Dato>
              <Dato t="Carrocería">{v.carroceria}</Dato>
              <Dato t="Capacidad">{v.capacidad}</Dato>
              <Dato t="Potencia">{v.potencia ? `${v.potencia} HP` : ""}</Dato>
              <Dato t="Licencia de tránsito">{v.licenciaTransito}</Dato>
            </dl>
            <div className="fila" style={{ justifyContent: "flex-end" }}><BotonRuntVehiculo vehiculo={v} titular={titular} /></div>
            <Avaluo v={v} />
            <div>
              <div className="fila" style={{ justifyContent: "space-between" }}>
                <h3>Gravámenes</h3>
                <button className="btn btn-sm" onClick={() => setNuevoGravamen({ tipo: "prenda" })}><Plus size={14} />Agregar</button>
              </div>
              <div className="lista-filas">
                {v.gravamenes.map((g, i) => (
                  <div key={i} className="item">
                    <div className="principal"><b>{GRAVAMEN_LABEL[g.tipo]}</b><small>{[g.origen, g.descripcion].filter(Boolean).join(" · ")}</small></div>
                    <button className="btn btn-fantasma btn-sm btn-icono" title="Quitar" onClick={() => guardarGravamenes(v.gravamenes.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                  </div>
                ))}
                {!v.gravamenes.length && !nuevoGravamen && <div className="peq tenue">Sin gravámenes registrados.</div>}
              </div>
              {nuevoGravamen && (
                <div className="campos" style={{ marginTop: 8 }}>
                  <Campo etiqueta="Tipo"><Opciones valor={nuevoGravamen.tipo} cambiar={(t) => setNuevoGravamen({ ...nuevoGravamen, tipo: (t || "prenda") as TipoGravamen })} opciones={TIPOS_GRAVAMEN.map((t) => [t, GRAVAMEN_LABEL[t]] as const)} /></Campo>
                  <Campo etiqueta="A favor de / origen"><Texto valor={nuevoGravamen.origen} cambiar={(o) => setNuevoGravamen({ ...nuevoGravamen, origen: o })} /></Campo>
                  <Campo etiqueta="Descripción" ancho><Texto valor={nuevoGravamen.descripcion} cambiar={(d) => setNuevoGravamen({ ...nuevoGravamen, descripcion: d })} /></Campo>
                  <div className="fila" style={{ gridColumn: "1 / -1" }}>
                    <button className="btn btn-primario btn-sm" onClick={() => guardarGravamenes([...v.gravamenes, nuevoGravamen])}>Guardar gravamen</button>
                    <button className="btn btn-sm" onClick={() => setNuevoGravamen(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
            <div><h3 style={{ marginBottom: 4 }}>Trámites</h3><ListaTramites filtro={{ vehiculoId: v.id }} /></div>
          </div>
        )}
      </Panel>
      <PanelVehiculo abierto={editar} onCerrar={() => setEditar(false)} vehiculoId={vehiculoId} />
    </>
  );
}
