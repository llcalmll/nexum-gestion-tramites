import { useLiveQuery } from "dexie-react-hooks";
import { useMenuVehiculo } from "../componentes/accionesMenu";
import { Car, CarFront, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizar } from "../../compartido/dominio";
import { FichaVehiculo } from "../componentes/Fichas";
import { PanelVehiculo } from "../componentes/PanelVehiculo";
import { TablaDatos } from "../componentes/TablaDatos";
import { Cabecera, Vacio } from "../componentes/ui";
import { Vigencia } from "../componentes/Vigencia";
import { db } from "../datos/db";

export default function Vehiculos() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const datos = useLiveQuery(async () => ({ vehiculos: await db.vehiculos.toArray(), clientes: await db.clientes.toArray() }), []);
  const filas = useMemo(() => {
    if (!datos) return [];
    const nombre = new Map(datos.clientes.map((c) => [c.id, c]));
    const n = normalizar(q);
    return datos.vehiculos
      .map((v) => ({ v, titular: v.titularId ? nombre.get(v.titularId) : undefined }))
      .filter((f) => !n || normalizar(f.v.placa, f.v.marca, f.v.linea, f.titular?.nombre, f.titular?.numeroDocumento).includes(n));
  }, [datos, q]);
  const [editar, setEditar] = useState<string | null>(null);
  const poner = (k: string, v: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });

  const menuVehiculo = useMenuVehiculo((id) => poner("ficha", id), setEditar);
  return (
    <>
      <Cabecera titulo="Vehículos">
        <button className="btn btn-primario" onClick={() => poner("nuevo", "1")}><CarFront size={15} />Nuevo vehículo</button>
      </Cabecera>
      <div className="contenido">
        <TablaDatos
          idGuardado="vehiculos"
          filas={filas}
          clave={(f) => f.v.id}
          onFila={(f) => poner("ficha", f.v.id)}
          menuFila={(f) => menuVehiculo(f.v)}
          reinicio={q}
          ordenInicial={{ id: "placa", dir: 1 }}
          barra={<div className="buscar" style={{ width: 300 }}><Search size={15} /><input className="input" placeholder="Buscar por placa, marca o titular" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
          vacio={<Vacio icono={Car} titulo={q ? "Ningún vehículo coincide" : "Todavía no hay vehículos"}>{!q && <button className="btn btn-primario" onClick={() => poner("nuevo", "1")}>Crear con la foto de la tarjeta</button>}</Vacio>}
          columnas={[
            { id: "placa", titulo: "Placa", fija: true, valor: (f) => f.v.placa, celda: (f) => <b>{f.v.placa}</b> },
            { id: "vehiculo", titulo: "Vehículo", valor: (f) => [f.v.marca, f.v.linea].filter(Boolean).join(" "), celda: (f) => [f.v.marca, f.v.linea, f.v.modelo].filter(Boolean).join(" ") },
            { id: "titular", titulo: "Titular", valor: (f) => f.titular?.nombre, celda: (f) => f.titular?.nombre ?? <span className="sin-dato">Sin titular</span> },
            { id: "soat", titulo: "SOAT", valor: (f) => f.v.soatVence, celda: (f) => <Vigencia hasta={f.v.soatVence} /> },
            { id: "rtm", titulo: "Técnico-mecánica", valor: (f) => f.v.rtmVence, celda: (f) => <Vigencia hasta={f.v.rtmVence} /> },
            { id: "impuesto", titulo: "Impuesto al día hasta", valor: (f) => f.v.impuestoAlDiaHasta, celda: (f) => <Vigencia hasta={f.v.impuestoAlDiaHasta} /> },
          ]}
        />
      </div>
      <PanelVehiculo abierto={params.get("nuevo") === "1"} onCerrar={() => poner("nuevo", null)} alGuardar={(id) => setTimeout(() => poner("ficha", id), 0)} />
      <FichaVehiculo vehiculoId={params.get("ficha")} onCerrar={() => poner("ficha", null)} />
      <PanelVehiculo abierto={!!editar} vehiculoId={editar} onCerrar={() => setEditar(null)} />
    </>
  );
}
