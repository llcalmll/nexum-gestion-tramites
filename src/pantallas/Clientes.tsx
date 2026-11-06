import { useLiveQuery } from "dexie-react-hooks";
import { useMenuCliente } from "../componentes/accionesMenu";
import { Search, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizar } from "../../compartido/dominio";
import { FichaCliente } from "../componentes/Fichas";
import { PanelCliente } from "../componentes/PanelCliente";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Cabecera, Vacio } from "../componentes/ui";
import { db } from "../datos/db";

export default function Clientes() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const datos = useLiveQuery(async () => ({ clientes: await db.clientes.toArray(), vehiculos: await db.vehiculos.toArray(), tramites: await db.tramites.toArray() }), []);
  const filas = useMemo(() => {
    if (!datos) return [];
    const porTitular = new Map<string, number>();
    for (const v of datos.vehiculos) if (v.titularId) porTitular.set(v.titularId, (porTitular.get(v.titularId) ?? 0) + 1);
    const tramites = new Map<string, number>();
    for (const t of datos.tramites) tramites.set(t.titularId, (tramites.get(t.titularId) ?? 0) + 1);
    const n = normalizar(q);
    return datos.clientes
      .filter((c) => !n || (c.busqueda || normalizar(c.nombre, c.numeroDocumento, c.telefono, ...(c.otrosTelefonos ?? []))).includes(n))
      .map((c) => ({ c, vehiculos: porTitular.get(c.id) ?? 0, tramites: tramites.get(c.id) ?? 0 }));
  }, [datos, q]);
  const nuevo = params.get("nuevo") === "1";
  const [editar, setEditar] = useState<string | null>(null);
  const menuCliente = useMenuCliente((id) => poner("ficha", id), setEditar);
  const ficha = params.get("ficha");
  const poner = (k: string, v: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });

  return (
    <>
      <Cabecera titulo="Clientes">
        <button className="btn btn-primario" onClick={() => poner("nuevo", "1")}><UserPlus size={15} />Nuevo cliente</button>
      </Cabecera>
      <div className="contenido">
        <TablaDatos
          idGuardado="clientes"
          filas={filas}
          clave={(f) => f.c.id}
          onFila={(f) => poner("ficha", f.c.id)}
          menuFila={(f) => menuCliente(f.c)}
          reinicio={q}
          ordenInicial={{ id: "nombre", dir: 1 }}
          barra={<div className="buscar" style={{ width: 300 }}><Search size={15} /><input className="input" placeholder="Buscar por nombre, documento o teléfono" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
          vacio={<Vacio icono={Users} titulo={q ? "Ningún cliente coincide" : "Todavía no hay clientes"}>{!q && <button className="btn btn-primario" onClick={() => poner("nuevo", "1")}>Crear con la foto de la cédula</button>}</Vacio>}
          columnas={[
            { id: "nombre", titulo: "Nombre", fija: true, valor: (f) => f.c.nombre, celda: (f) => <div className="principal-celda"><Avatar nombre={f.c.nombre} /><div><b>{f.c.nombre}</b><small>{f.c.numeroDocumento ? `${f.c.tipoDocumento} ${f.c.numeroDocumento}` : "Sin documento"}</small></div></div> },
            { id: "telefono", titulo: "Teléfono", valor: (f) => [f.c.telefono, ...(f.c.otrosTelefonos ?? [])].filter(Boolean).join(" "), celda: (f) => f.c.telefono ? <span title={(f.c.otrosTelefonos ?? []).length ? `Otros: ${f.c.otrosTelefonos!.join(", ")}` : undefined}>{f.c.telefono}{(f.c.otrosTelefonos ?? []).length ? <small className="tenue"> +{f.c.otrosTelefonos!.length}</small> : null}</span> : <span className="sin-dato">Sin dato</span> },
            { id: "ciudad", titulo: "Ciudad", valor: (f) => f.c.ciudad, celda: (f) => f.c.ciudad ?? "" },
            { id: "vehiculos", titulo: "Vehículos", alinear: "der", valor: (f) => f.vehiculos, celda: (f) => f.vehiculos || "" },
            { id: "tramites", titulo: "Trámites", alinear: "der", valor: (f) => f.tramites, celda: (f) => f.tramites || "" },
          ]}
        />
      </div>
      <PanelCliente abierto={nuevo} onCerrar={() => poner("nuevo", null)} alGuardar={(id) => setTimeout(() => poner("ficha", id), 0)} />
      <FichaCliente clienteId={ficha} onCerrar={() => poner("ficha", null)} />
      <PanelCliente abierto={!!editar} clienteId={editar} onCerrar={() => setEditar(null)} />
    </>
  );
}
