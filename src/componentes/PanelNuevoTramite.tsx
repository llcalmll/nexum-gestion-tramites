import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../datos/db";
import { Registrador, type InicioManual } from "./Registrador";
import { Panel, useUI } from "./ui";

/**
 * Nuevo trámite: el mismo formulario del asistente (Registrador en modo manual), con todas las casillas a la vista:
 * los trámites, el vehículo, el vendedor y el comprador (escritos o elegidos de los ya guardados), el cobro que se
 * corrige ahí mismo, la entrega, las precondiciones y la preanotación. Ver Registrador.tsx.
 */
export function PanelNuevoTramite({ abierto, onCerrar, titularInicial, tipoInicial, categoriaInicial, licenciaId, alCrear }: {
  abierto: boolean; onCerrar: () => void; titularInicial?: string | null;
  /** Desde el radar de licencias: nombre del tipo, categoría y la licencia que se renueva. */
  tipoInicial?: string | null; categoriaInicial?: string | null; licenciaId?: string | null;
  alCrear: (ids: string[]) => void;
}) {
  const { avisar } = useUI();
  // El cliente desde el que se abrió (su ficha, el radar): ya va puesto.
  const titular = useLiveQuery(() => (titularInicial ? db.clientes.get(titularInicial).then((c) => c ?? null) : null), [titularInicial]);
  const listo = !titularInicial || titular !== undefined;
  const inicio = useMemo<InicioManual>(() => ({
    titular: titular ? { id: titular.id, nombre: titular.nombre, tipoDocumento: titular.tipoDocumento, numeroDocumento: titular.numeroDocumento, telefono: titular.telefono, direccion: titular.direccion, ciudad: titular.ciudad, fechaNacimiento: titular.fechaNacimiento } : null,
    tipoNombre: tipoInicial, categorias: categoriaInicial, licenciaId,
  }), [titular, tipoInicial, categoriaInicial, licenciaId]);
  return (
    <Panel abierto={abierto} onCerrar={onCerrar} cabecera={<h2>Nuevo trámite</h2>} ancho={760}>
      {listo && (
        <Registrador key={`${titularInicial ?? ""}|${tipoInicial ?? ""}|${categoriaInicial ?? ""}`} manual={inicio} cancelar={onCerrar}
          alGuardar={(r) => {
            avisar(`${r.ids.length > 1 ? `Combo creado: ${r.numeros.join(", ")}` : `Trámite ${r.numeros[0] ?? ""} creado`}${r.avisos?.length ? `. ${r.avisos[0]}` : ""}`);
            alCrear(r.ids);
          }} />
      )}
    </Panel>
  );
}
