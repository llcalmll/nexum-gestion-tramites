import { useNavigate } from "react-router-dom";
import { Registrador } from "../componentes/Registrador";
import { Cabecera } from "../componentes/ui";
import { sincronizarAhora } from "../datos/sincronizacion";

/**
 * Consulta rápida: se sueltan la tarjeta de propiedad y las cédulas (fotos o fotocopias), se leen y se consultan con el
 * RUNT de una vez (precondiciones: SOAT, técnico-mecánica, prendas, comparendos, impuesto). Al final, dos casillas:
 * guardar el trámite y llenar los formularios; las dos, una o ninguna. Ver componentes/Registrador.tsx (modo consulta).
 */
export default function ConsultaRapida() {
  const navegar = useNavigate();
  return (
    <>
      <Cabecera titulo="Consulta rápida" sub="Tarjeta de propiedad y cédulas, en foto o fotocopia: se leen y se revisan las precondiciones con el RUNT" />
      <div className="contenido" style={{ maxWidth: 980 }}>
        <Registrador
          consulta
          alGuardar={() => { sincronizarAhora().catch(() => {}); }}
          abrir={(id) => navegar(`/tramites/${id}`)}
          llenarFormatos={(f) => navegar("/formatos/llenar", { state: { desdeConsulta: f } })}
        />
      </div>
    </>
  );
}
