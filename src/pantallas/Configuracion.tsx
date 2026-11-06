import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { CATEGORIA_LABEL, PRECONDICION_LABEL, type CategoriaTramite, type Precondicion } from "../../compartido/dominio";
import { Plus } from "lucide-react";
import { SeccionConsultas } from "../componentes/ConsultasRunt";
import { PanelOrganismo, PanelParametro, PanelTarifa, PanelTipo } from "../componentes/PanelesConfig";
import { TablaDatos } from "../componentes/TablaDatos";
import { Badge, Cabecera, useUI } from "../componentes/ui";
import { db } from "../datos/db";
import { ponerTema, useTema, type Tema } from "../datos/preferencias";
import { borrarCopiaLocal, leerVersionLocal, sincronizarAhora, useEstadoSync } from "../datos/sincronizacion";
import { pesos } from "../logica/formato";

const SECCIONES = [
  { id: "tipos", t: "Tipos de trámite" },
  { id: "tarifas", t: "Tarifas" },
  { id: "organismos", t: "Organismos" },
  { id: "parametros", t: "Parámetros" },
  { id: "consultas", t: "Consultas RUNT" },
  { id: "equipo", t: "Este equipo" },
] as const;
type Seccion = (typeof SECCIONES)[number]["id"];

type Edicion = { sec: Seccion; id: string | null } | null;
const NUEVO: Partial<Record<Seccion, string>> = { tipos: "Nuevo tipo de trámite", tarifas: "Nueva tarifa", organismos: "Nuevo organismo" };

export default function Configuracion() {
  const [sec, setSec] = useState<Seccion>("tipos");
  const [edicion, setEdicion] = useState<Edicion>(null);
  const editar = (id: string | null) => setEdicion({ sec, id });
  const cerrar = () => setEdicion(null);
  return (
    <>
      <Cabecera titulo="Configuración">
        {NUEVO[sec] && <button className="btn btn-primario" onClick={() => editar(null)}><Plus size={15} />{NUEVO[sec]}</button>}
      </Cabecera>
      <div className="contenido">
        <div className="tabs">
          {SECCIONES.map((s) => <button key={s.id} className={sec === s.id ? "on" : ""} onClick={() => setSec(s.id)}>{s.t}</button>)}
        </div>
        {sec === "tipos" && <Tipos editar={editar} />}
        {sec === "tarifas" && <Tarifas editar={editar} />}
        {sec === "organismos" && <Organismos editar={editar} />}
        {sec === "parametros" && <Parametros editar={editar} />}
        {sec === "consultas" && <SeccionConsultas />}
        {sec === "equipo" && <Equipo />}
      </div>
      <PanelTipo abierto={edicion?.sec === "tipos"} id={edicion?.id ?? null} onCerrar={cerrar} />
      <PanelTarifa abierto={edicion?.sec === "tarifas"} id={edicion?.id ?? null} onCerrar={cerrar} />
      <PanelOrganismo abierto={edicion?.sec === "organismos"} id={edicion?.id ?? null} onCerrar={cerrar} />
      <PanelParametro abierto={edicion?.sec === "parametros"} clave={edicion?.id ?? null} onCerrar={cerrar} />
    </>
  );
}

function Tipos({ editar }: { editar: (id: string) => void }) {
  const tipos = useLiveQuery(() => db.tipos_tramite.toArray(), []) ?? [];
  return (
    <TablaDatos
      idGuardado="config-tipos"
      filas={tipos}
      clave={(t) => t.id}
      onFila={(t) => editar(t.id)}
      ordenInicial={{ id: "orden", dir: 1 }}
      columnas={[
        { id: "orden", titulo: "#", alinear: "der", valor: (t) => t.orden, celda: (t) => t.orden },
        { id: "nombre", titulo: "Trámite", fija: true, valor: (t) => t.nombre, celda: (t) => <b>{t.nombre}</b> },
        { id: "categoria", titulo: "Categoría", valor: (t) => t.categoria, celda: (t) => CATEGORIA_LABEL[t.categoria as CategoriaTramite] },
        { id: "vehiculo", titulo: "Pide vehículo", valor: (t) => (t.requiereVehiculo ? 1 : 0), celda: (t) => (t.requiereVehiculo ? "Sí" : "No") },
        { id: "sla", titulo: "Días de entrega", alinear: "der", valor: (t) => t.slaDias, celda: (t) => t.slaDias ?? <span className="sin-dato">Sin dato</span> },
        {
          id: "precondiciones", titulo: "Precondiciones",
          celda: (t) => <div className="fila-wrap" style={{ gap: 4, padding: "6px 0", whiteSpace: "normal" }}>{Object.entries(t.precondiciones).filter(([, v]) => v).map(([k]) => <Badge key={k}>{PRECONDICION_LABEL[k as Precondicion] ?? k}</Badge>)}</div>,
        },
        { id: "requisitos", titulo: "Documentos", alinear: "der", valor: (t) => t.requisitos.length, celda: (t) => t.requisitos.length || "" },
        { id: "activo", titulo: "Activo", valor: (t) => (t.activo ? 1 : 0), celda: (t) => (t.activo ? "Sí" : <span className="sin-dato">No</span>) },
      ]}
    />
  );
}

function Tarifas({ editar }: { editar: (id: string) => void }) {
  const datos = useLiveQuery(async () => ({ tarifas: await db.tarifas.toArray(), tipos: await db.tipos_tramite.toArray(), organismos: await db.organismos.toArray() }), []);
  const filas = useMemo(() => {
    if (!datos) return [];
    const tipo = new Map(datos.tipos.map((t) => [t.id, t.nombre]));
    const org = new Map(datos.organismos.map((o) => [o.id, o.ciudad ?? o.nombre]));
    return datos.tarifas.map((t) => ({ t, tipo: tipo.get(t.tipoTramiteId) ?? "", organismo: t.organismoId ? org.get(t.organismoId) ?? "" : "Todos" }));
  }, [datos]);
  return (
    <TablaDatos
      idGuardado="config-tarifas"
      filas={filas}
      clave={(f) => f.t.id}
      onFila={(f) => editar(f.t.id)}
      ordenInicial={{ id: "tipo", dir: 1 }}
      columnas={[
        { id: "tipo", titulo: "Trámite", fija: true, valor: (f) => f.tipo, celda: (f) => <b>{f.tipo}</b> },
        { id: "organismo", titulo: "Organismo", valor: (f) => f.organismo, celda: (f) => f.organismo },
        { id: "derechos", titulo: "Derechos", alinear: "der", valor: (f) => f.t.derechosTransito, celda: (f) => pesos(f.t.derechosTransito) },
        { id: "pazsalvo", titulo: "Paz y salvo", alinear: "der", valor: (f) => f.t.pazSalvo, celda: (f) => pesos(f.t.pazSalvo) },
        { id: "honorarios", titulo: "Honorarios", alinear: "der", valor: (f) => f.t.honorarios, celda: (f) => (f.t.honorarios ? pesos(f.t.honorarios) : <span className="sin-dato">Por defecto</span>) },
        { id: "vigente", titulo: "Vigente desde", valor: (f) => f.t.vigenteDesde, celda: (f) => f.t.vigenteDesde ?? "" },
      ]}
    />
  );
}

function Organismos({ editar }: { editar: (id: string) => void }) {
  const organismos = useLiveQuery(() => db.organismos.toArray(), []) ?? [];
  return (
    <TablaDatos
      idGuardado="config-organismos"
      filas={organismos}
      clave={(o) => o.id}
      onFila={(o) => editar(o.id)}
      ordenInicial={{ id: "nombre", dir: 1 }}
      columnas={[
        { id: "nombre", titulo: "Organismo", fija: true, valor: (o) => o.nombre, celda: (o) => <b>{o.nombre}</b> },
        { id: "ciudad", titulo: "Ciudad", valor: (o) => o.ciudad, celda: (o) => o.ciudad ?? "" },
        { id: "departamento", titulo: "Departamento", valor: (o) => o.departamento, celda: (o) => o.departamento ?? "" },
        { id: "activo", titulo: "Activo", valor: (o) => (o.activo ? 1 : 0), celda: (o) => (o.activo ? "Sí" : "No") },
      ]}
    />
  );
}

function Parametros({ editar }: { editar: (id: string) => void }) {
  const parametros = useLiveQuery(() => db.parametros.toArray(), []) ?? [];
  return (
    <TablaDatos
      idGuardado="config-parametros"
      filas={parametros}
      clave={(p) => p.clave}
      onFila={(p) => editar(p.clave)}
      ordenInicial={{ id: "clave", dir: 1 }}
      columnas={[
        { id: "clave", titulo: "Parámetro", fija: true, valor: (p) => p.clave, celda: (p) => <b>{p.clave}</b> },
        { id: "valor", titulo: "Valor", celda: (p) => (p.valor.length > 80 ? `${p.valor.slice(0, 80)}…` : p.valor) },
        { id: "descripcion", titulo: "Para qué sirve", celda: (p) => p.descripcion ?? "" },
      ]}
    />
  );
}

function Equipo() {
  const tema = useTema();
  const sync = useEstadoSync();
  const { confirmar, avisar } = useUI();
  const version = useLiveQuery(() => leerVersionLocal(), [sync.ultima]);
  const temas: [Tema, string][] = [["claro", "Claro"], ["oscuro", "Oscuro"], ["auto", "Según el sistema"]];
  return (
    <div className="pila" style={{ gap: 16, maxWidth: 640 }}>
      <div className="card">
        <div className="card-cab"><b>Apariencia</b></div>
        <div className="card-cuerpo">
          <div className="seg">
            {temas.map(([t, n]) => <button key={t} className={tema === t ? "on" : ""} onClick={() => ponerTema(t)}>{n}</button>)}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-cab"><b>Copia de los datos en este equipo</b></div>
        <div className="card-cuerpo pila" style={{ gap: 8 }}>
          <div className="muted">La app trabaja sobre una copia guardada en este navegador y la actualiza cada 20 segundos mientras está abierta.</div>
          <div>Versión descargada: <b>{version ?? "…"}</b>{sync.ultima && <> · última revisión {new Date(sync.ultima).toLocaleTimeString("es-CO")}</>}</div>
          <div className="fila" style={{ gap: 8 }}>
            <button className="btn" onClick={() => sincronizarAhora()}>Actualizar ahora</button>
            <button className="btn" onClick={async () => {
              if (!(await confirmar({ titulo: "Volver a descargar todo", texto: "Se borra la copia de este equipo y se descarga completa desde el servidor." }))) return;
              await borrarCopiaLocal();
              await sincronizarAhora();
              avisar("Copia descargada de nuevo");
            }}>Volver a descargar todo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
