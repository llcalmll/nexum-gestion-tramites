/** "ABC123" -> "ABC 123"; motos "ABC12D" -> "ABC 12D". */
const separar = (p: string) => (/^[A-Z]{3}\d/.test(p) ? `${p.slice(0, 3)} ${p.slice(3)}` : p);

/**
 * Placa como la de un vehículo colombiano, en versión sobria: amarilla con letras oscuras
 * (blanca si es de servicio público). La ciudad va en el texto al pasar el mouse.
 */
export function Placa({ placa, ciudad, servicio }: { placa: string; ciudad?: string | null; servicio?: string | null }) {
  return (
    <span className={`placa ${servicio === "publico" ? "publica" : ""}`} title={`Placa ${placa}${ciudad ? ` · ${ciudad}` : ""}`}>
      <b>{separar(placa)}</b>
    </span>
  );
}

/**
 * Lo que va en el lugar de la placa cuando el trámite es de licencia: una "licencia" del mismo tamaño
 * que la placa, en azul claro (el fondo de la licencia anterior, según Mintransporte) para distinguirla
 * del amarillo de la placa, con el cuadro de la foto a la izquierda y las categorías.
 */
export function SimboloLicencia({ categorias }: { categorias?: string | null }) {
  const lista = (categorias ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  return (
    <span className="licencia-mini" title={`Licencia de conducción${lista.length ? ` ${lista.join(", ")}` : ""}`}>
      <i aria-hidden="true" />
      <b>{lista.length ? lista.join(" ") : "LIC"}</b>
    </span>
  );
}
