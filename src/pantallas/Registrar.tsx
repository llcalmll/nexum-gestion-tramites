import { useNavigate } from "react-router-dom";
import { Registrador } from "../componentes/Registrador";
import { Cabecera } from "../componentes/ui";
import { sincronizarAhora } from "../datos/sincronizacion";

/**
 * Registrar desde documentos: el trámite que llega ya digitado (formulario único y mandato a mano, el sobre...) o
 * del que solo hay fotos, se anota subiendo las fotos de sus hojas. Ver componentes/Registrador.tsx.
 */
export default function Registrar() {
  const navegar = useNavigate();
  return (
    <>
      <Cabecera titulo="Registrar desde documentos" sub="Suba las fotos de lo que tenga del trámite: se lee todo y usted confirma antes de guardar" />
      <div className="contenido" style={{ maxWidth: 980 }}>
        <Registrador alGuardar={() => { sincronizarAhora().catch(() => {}); }} abrir={(id) => navegar(`/tramites/${id}`)} />
      </div>
    </>
  );
}
