/*
 * Los datos de los formatos a partir de lo que se lee de las fotos (tarjeta de propiedad y cédulas). Lo usan Llenar
 * formatos en el PC, Formatos en el celular y la consulta rápida (desde el trámite ya armado con las hojas).
 */
import type { Borrador, PersonaBorrador } from "../../compartido/registro";
import { casillaDe, dividirNombre, type DatosFormatos, type Formato, type PersonaFormato, type VehiculoFormato } from "./llenado";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const str = (v: unknown) => (typeof v === "string" ? v : "");
type Leido = Record<string, string | string[]>;

export const personaVacia = (): PersonaFormato => ({ apellido1: "", apellido2: "", nombres: "", tipoDocumento: "CC", documento: "", direccion: "", ciudad: "", telefono: "" });
export const vehiculoVacio = (): VehiculoFormato => ({ placa: "", marca: "", linea: "", modelo: "", clase: "", color: "", cilindraje: "", combustible: "", capacidad: "", potencia: "", carroceria: "", servicio: "", motor: "", chasis: "", serie: "", vin: "", matriculadoEn: "" });
/**
 * El organismo de tránsito arranca en Ibagué (casi todo se hace allá); si es otro, se cambia. Con la lista de
 * organismos a la mano se toma el nombre de allí; si no, el de la base.
 */
export const IBAGUE = { nombre: "Secretaría de Tránsito de Ibagué", ciudad: "Ibagué" };
export const ibagueDe = (organismos: { nombre: string; ciudad: string | null }[]) => {
  const o = organismos.find((x) => x.ciudad === "Ibagué");
  return o ? { nombre: o.nombre, ciudad: "Ibagué" } : IBAGUE;
};
export const datosVacios = (mandatario: DatosFormatos["mandatario"] = { nombre: "", documento: "" }, organismo = IBAGUE): DatosFormatos => ({
  fecha: hoy(), ciudadFirma: "Ibagué", organismo, casillas: [], tramiteTexto: "", observaciones: "",
  vehiculo: vehiculoVacio(), propietario: personaVacia(), comprador: null, mandatario, precio: "", formaPago: "",
});

/** Lo leído de una cédula. */
export const desdeCedula = (datos: Leido): Partial<PersonaFormato> => ({
  ...dividirNombre(str(datos.nombreCompleto), str(datos.apellidos), str(datos.nombres)),
  ...(str(datos.numeroDocumento) ? { documento: str(datos.numeroDocumento) } : {}),
  tipoDocumento: str(datos.tipoDocumento) === "CE" ? "CE" : "CC",
});

/** Lo leído de la tarjeta de propiedad completa el vehículo (y el propietario, si todavía no tiene documento). */
export function conTarjeta(x: DatosFormatos, datos: Leido): DatosFormatos {
  const s = (k: string) => str(datos[k]);
  const v = { ...x.vehiculo };
  const poner = (k: keyof VehiculoFormato, valor: string) => { if (valor) v[k] = valor; };
  poner("placa", s("placa").toUpperCase()); poner("marca", s("marca")); poner("linea", s("linea")); poner("clase", s("clase")); poner("color", s("color"));
  poner("modelo", s("modeloAnio").replace(/\D/g, "").slice(0, 4)); poner("cilindraje", s("cilindraje").replace(/\D/g, "")); poner("servicio", s("tipoServicio"));
  poner("motor", s("numeroMotor")); poner("chasis", s("numeroChasis")); poner("serie", s("numeroSerie")); poner("vin", s("vin"));
  poner("combustible", s("combustible")); poner("capacidad", s("capacidad")); poner("potencia", s("potencia")); poner("carroceria", s("carroceria")); poner("matriculadoEn", s("organismoTransito"));
  // La tarjeta imprime el nombre con los apellidos primero (ANA GOMEZ).
  const propietario = !x.propietario.documento && s("documentoTitular") ? { ...x.propietario, ...dividirNombre(s("nombreTitular"), "", "", "apellidos"), documento: s("documentoTitular") } : x.propietario;
  return { ...x, vehiculo: v, propietario };
}

const TIPO_DOC: Record<string, string> = { CC: "CC", CE: "CE", NIT: "NIT", Pasaporte: "PA", PPT: "PA", TI: "TI" };
/** "traspaso y traslado de cuenta". */
export const textoTramite = (nombres: string[]) => nombres.map((n) => n.toLowerCase().replace(/ de propiedad$/, "")).join(" y ");

/**
 * Lo armado con las hojas (registrador / consulta rápida) pasado a los formatos: trámites (casillas del formulario
 * único), organismo, vehículo, propietario (el vendedor) y comprador. Con comprador va también la compraventa.
 */
export function desdeBorrador(b: Borrador, tipos: { id: string; nombre: string }[], organismos: { id: string; nombre: string; ciudad: string | null }[], mandatario?: DatosFormatos["mandatario"]): { datos: DatosFormatos; elegidos: Formato[] } {
  const nombres = tipos.filter((t) => b.tipoIds.includes(t.id)).map((t) => t.nombre);
  const o = organismos.find((x) => x.id === b.organismoId);
  const persona = (p: PersonaBorrador | null): PersonaFormato | null => p && (p.nombre || p.numeroDocumento)
    ? { ...dividirNombre(p.nombre), tipoDocumento: TIPO_DOC[p.tipoDocumento] ?? "CC", documento: p.numeroDocumento, direccion: p.direccion, ciudad: p.ciudad, telefono: p.telefono }
    : null;
  const v = b.vehiculo;
  const comprador = persona(b.comprador);
  const datos: DatosFormatos = {
    ...datosVacios(mandatario, o ? { nombre: o.nombre, ciudad: o.ciudad ?? "" } : ibagueDe(organismos)),
    casillas: [...new Set(nombres.map(casillaDe))].sort((x, y) => x - y),
    tramiteTexto: textoTramite(nombres),
    vehiculo: { ...vehiculoVacio(), placa: v.placa, marca: v.marca, linea: v.linea, modelo: v.modelo, clase: v.clase, color: v.color, cilindraje: v.cilindraje, servicio: v.servicio, motor: v.motor, chasis: v.chasis, serie: v.serie, vin: v.vin, combustible: v.combustible, carroceria: v.carroceria, capacidad: v.capacidad, potencia: v.potencia, matriculadoEn: b.organismoLeido },
    propietario: persona(b.vendedor) ?? personaVacia(),
    comprador,
    precio: b.precioVenta.replace(/\D/g, ""),
  };
  return { datos, elegidos: comprador ? ["fun", "mandato_propietario", "compraventa"] : ["fun", "mandato_propietario"] };
}
