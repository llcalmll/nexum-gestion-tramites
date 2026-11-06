/*
 * Llenado de formatos: escribe los datos sobre los PDF originales de public/formatos (no tienen campos rellenables)
 * y devuelve un solo PDF listo para imprimir. Funciona igual en el navegador y en Node (pruebas).
 *
 * Formatos: formulario único (Ministerio de Transporte / RUNT), contrato de mandato (modelo general de Tránsito de
 * Pasto: "ante el organismo de tránsito que corresponda") y compraventa (modelo de Tránsito de Itagüí, tamaño oficio).
 * Los tres tienen texto real: cada posición sale de las etiquetas y rayas impresas, medidas letra por letra.
 * Coordenadas en puntos PDF desde la esquina de ARRIBA a la izquierda; y = línea base del texto.
 *
 * Cada casilla tiene un id: la vista previa la muestra editable y lo que se corrija ahí (`cambios`) reemplaza al
 * dato calculado al imprimir.
 */
import { ordenDelNombre } from "../../compartido/nombresComunes";
import { PDFDocument, popGraphicsState, pushGraphicsState, rgb, setCharacterSqueeze, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export interface PersonaFormato {
  apellido1: string; apellido2: string; nombres: string;
  /** CC, CE, NIT, PA (pasaporte), TI. */
  tipoDocumento: string; documento: string;
  direccion: string; ciudad: string; telefono: string;
}
export interface VehiculoFormato {
  placa: string; marca: string; linea: string; modelo: string; clase: string; color: string; cilindraje: string;
  combustible: string; capacidad: string; potencia: string; carroceria: string; servicio: string;
  motor: string; chasis: string; serie: string; vin: string; matriculadoEn: string;
}
export interface DatosFormatos {
  /** AAAA-MM-DD. */
  fecha: string;
  ciudadFirma: string;
  organismo: { nombre: string; ciudad: string };
  /** Casillas del punto 3 del formulario único (1 = matrícula ... 18 = otros). */
  casillas: number[];
  /** Cómo se nombra el trámite en el mandato ("traspaso", "levantamiento de prenda"...). */
  tramiteTexto: string;
  observaciones: string;
  vehiculo: VehiculoFormato;
  propietario: PersonaFormato;
  comprador: PersonaFormato | null;
  mandatario: { nombre: string; tipoDocumento?: string; documento: string };
  /** Precio de la compraventa en pesos (solo números); en letras se escribe solo. */
  precio: string;
  formaPago: string;
}
export type Formato = "fun" | "mandato_propietario" | "mandato_comprador" | "compraventa";

/**
 * Cada formato llenable: su PDF, el tamaño de la página (puntos) y la imagen de fondo de la vista previa. `reverso`:
 * la otra cara, que se imprime tal cual (en el formulario único: instrucciones y las casillas de las improntas).
 */
export const FORMATOS_LLENABLES: { id: Formato; nombre: string; archivo: string; ancho: number; alto: number; fondo: string; reverso?: string }[] = [
  { id: "fun", nombre: "Formulario único de solicitud de trámites (automotor)", archivo: "formulario-solicitud-tramites-automotor.pdf", ancho: 792, alto: 612, fondo: "/formatos/vista/fun.jpg", reverso: "/formatos/vista/fun-reverso.jpg" },
  { id: "mandato_propietario", nombre: "Contrato de mandato del propietario (vendedor)", archivo: "contrato-de-mandato.pdf", ancho: 612, alto: 792, fondo: "/formatos/vista/mandato.jpg" },
  { id: "mandato_comprador", nombre: "Contrato de mandato del comprador", archivo: "contrato-de-mandato.pdf", ancho: 612, alto: 792, fondo: "/formatos/vista/mandato.jpg" },
  { id: "compraventa", nombre: "Contrato de compraventa", archivo: "contrato-compraventa-transito-itagui.pdf", ancho: 595.32, alto: 935.52, fondo: "/formatos/vista/compraventa.jpg" },
];

/** Las casillas del punto 3 del formulario único, por tipo de trámite de la app. */
export const CASILLAS_FUN: { n: number; nombre: string; buscar: RegExp }[] = [
  { n: 1, nombre: "Matrícula / registro", buscar: /matricula inicial/ },
  { n: 2, nombre: "Traspaso", buscar: /traspaso/ },
  { n: 3, nombre: "Traslado de matrícula", buscar: /traslado/ },
  { n: 4, nombre: "Radicado de matrícula", buscar: /radicacion/ },
  { n: 5, nombre: "Cambio de color", buscar: /cambio de color/ },
  { n: 6, nombre: "Cambio de servicio", buscar: /cambio de servicio/ },
  { n: 7, nombre: "Regrabar motor", buscar: /regrabacion|regrabar motor/ },
  { n: 8, nombre: "Regrabar chasis", buscar: /regrabar chasis/ },
  { n: 9, nombre: "Transformación", buscar: /transformacion/ },
  { n: 10, nombre: "Duplicado licencia de tránsito", buscar: /duplicado de licencia de transito/ },
  { n: 11, nombre: "Inscripción de prenda", buscar: /inscripcion de prenda/ },
  { n: 12, nombre: "Levanta prenda", buscar: /levantamiento de prenda/ },
  { n: 13, nombre: "Cancelación de matrícula", buscar: /cancelacion/ },
  { n: 14, nombre: "Cambio de placas", buscar: /cambio de placa/ },
  { n: 15, nombre: "Duplicado de placas", buscar: /duplicado de placa/ },
  { n: 16, nombre: "Rematrícula", buscar: /rematricula/ },
  { n: 17, nombre: "Cambio de carrocería", buscar: /carroceria/ },
  { n: 18, nombre: "Otros", buscar: /$^/ },
];
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Casilla del formulario para un tipo de trámite (18 = otros si no tiene una propia). */
export const casillaDe = (tipo: string) => CASILLAS_FUN.find((c) => c.buscar.test(sinTildes(tipo)))?.n ?? 18;

/**
 * Nombres y apellidos de un nombre completo (o de los apellidos y nombres leídos aparte de la cédula). `orden`:
 * "nombres" (LUIS ROJAS, como en la app) o "apellidos" (MARTA DIAZ, como lo imprime la
 * tarjeta de propiedad): con tres palabras o más, las dos primeras son los apellidos. Sin `orden`, se decide por los
 * nombres de pila y apellidos comunes (muchos clientes quedaron con los apellidos primero: PEDRO RUIZ
 * salía TORRES / ISAAC / VILLALBA en el formulario único, 28/10/2026); sin pistas, con los nombres primero.
 */
export function dividirNombre(completo: string, apellidos?: string, nombres?: string, ordenDado?: "nombres" | "apellidos") {
  const PARTICULAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "SAN", "Y"]);
  const unir = (p: string[]) => {
    // "DE LA ROSA" es un solo apellido.
    const out: string[] = [];
    let pend = "";
    for (const w of p) { if (PARTICULAS.has(w)) pend += `${w} `; else { out.push(pend + w); pend = ""; } }
    if (pend) out.push(pend.trim());
    return out;
  };
  const limpiar = (s?: string) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (limpiar(apellidos) && limpiar(nombres)) {
    const a = unir(limpiar(apellidos).split(" "));
    return { apellido1: a[0] ?? "", apellido2: a.slice(1).join(" "), nombres: limpiar(nombres) };
  }
  const p = unir(limpiar(completo).split(" ").filter(Boolean));
  if (p.length <= 1) return { apellido1: "", apellido2: "", nombres: p.join(" ") };
  const orden = ordenDado ?? ordenDelNombre(p) ?? "nombres";
  if (orden === "apellidos") return p.length === 2 ? { apellido1: p[0], apellido2: "", nombres: p[1] } : { apellido1: p[0], apellido2: p[1], nombres: p.slice(2).join(" ") };
  if (p.length === 2) return { apellido1: p[1], apellido2: "", nombres: p[0] };
  if (p.length === 3) return { apellido1: p[1], apellido2: p[2], nombres: p[0] };
  return { apellido1: p[p.length - 2], apellido2: p[p.length - 1], nombres: p.slice(0, -2).join(" ") };
}
/**
 * Traspaso a persona indeterminada: el instructivo del formulario único dice que "en el campo correspondiente a
 * comprador se registra PERSONA INDETERMINADA". No lleva mandato ni compraventa a su nombre.
 */
export const PERSONA_INDETERMINADA: PersonaFormato = { apellido1: "PERSONA INDETERMINADA", apellido2: "", nombres: "", tipoDocumento: "", documento: "", direccion: "", ciudad: "", telefono: "" };
export const esIndeterminada = (p: PersonaFormato | null | undefined) => p?.apellido1 === PERSONA_INDETERMINADA.apellido1 && !p.documento;
export const nombreCompleto = (p: PersonaFormato) => [p.nombres, p.apellido1, p.apellido2].filter(Boolean).join(" ");

/* ───────────── números en letras (para el precio) ───────────── */

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
function cientos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100;
  const resto = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` Y ${UNIDADES[r % 10]}` : ""}`;
  return [CENTENAS[c], resto].filter(Boolean).join(" ");
}
/** 35000000 -> "TREINTA Y CINCO MILLONES" (para "... pesos m/cte"). "UNO" se apocopa: "UN MILLÓN", "VEINTIÚN MIL". */
export function numeroEnLetras(n: number): string {
  n = Math.floor(Math.abs(n));
  if (!n) return "CERO";
  const apocope = (s: string) => s.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
  const millones = Math.floor(n / 1_000_000), miles = Math.floor((n % 1_000_000) / 1000), resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocope(millones >= 1000 ? numeroEnLetras(millones) : cientos(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(cientos(miles))} MIL`);
  if (resto) partes.push(cientos(resto));
  return partes.join(" ");
}
/**
 * El precio como se escribe antes de "pesos" en un contrato: "UN MILLÓN DE", "VEINTIÚN MIL", "CIENTO UN" (millón y
 * millones exactos llevan "de"; "uno" al final se apocopa).
 */
export function precioEnLetras(n: number): string {
  n = Math.floor(Math.abs(n));
  const letras = numeroEnLetras(n).replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
  return n >= 1_000_000 && n % 1_000_000 === 0 ? `${letras} DE` : letras;
}
const miles = (n: number) => n.toLocaleString("es-CO");

/* ───────────── casillas de cada formato ───────────── */

/** Una casilla para escribir. `id` identifica la casilla (para corregirla en la vista previa). */
export interface Casilla { id: string; x: number; y: number; texto: string; ancho?: number; tam?: number; centro?: boolean; negrita?: boolean }
const X = (id: string, x: number, y: number): Casilla => ({ id, x: x - 4.5, y: y + 3.2, texto: "X", ancho: 9, tam: 10, centro: true, negrita: true });

const DOC_FUN: Record<string, number> = { CC: 40, NIT: 68, PA: 123.5, CE: 155, TI: 195 };
const CLASE_FUN: Record<string, [number, number]> = {
  automovil: [56.7, 228], bus: [106.6, 228], buseta: [152, 228], camion: [194, 228], camioneta: [237, 228], campero: [282, 228], microbus: [338, 228],
  tractocamion: [57, 250.5], motocicleta: [106, 250.5], motocarro: [152, 250.5], mototriciclo: [196, 250.5], cuatrimoto: [236, 250.5], volqueta: [280, 250.5], otro: [338, 250.5],
};
const COMBUSTIBLE_FUN: Record<string, number> = { gasolina: 555.3, diesel: 584.1, gas: 610.9, mixto: 637.7, electrico: 664.6, hidrogeno: 693.4, etanol: 720.1, biodiesel: 746.9 };
/**
 * Los combustibles que dice el texto: uno o varios ("Gasolina y gas", "GAS GASOLINA", "GASOLINA - GNV" marcan gasolina
 * y gas, como lo pidió Tránsito al corregir un formulario, 28/10/2026). "gas" no es el pedazo de "gasolina".
 */
export function combustiblesDe(texto: string): (keyof typeof COMBUSTIBLE_FUN)[] {
  const t = sinTildes(texto).toLowerCase();
  const hay: (keyof typeof COMBUSTIBLE_FUN)[] = [];
  if (/gasolina/.test(t)) hay.push("gasolina");
  if (/biodiesel/.test(t)) hay.push("biodiesel");
  if (/(^|[^o])diesel|acpm/.test(t)) hay.push("diesel");
  if (/\b(gas|gnv|glp)\b|gas natural/.test(t)) hay.push("gas");
  if (/mixto/.test(t)) hay.push("mixto");
  if (/electric/.test(t)) hay.push("electrico");
  if (/hidrogeno/.test(t)) hay.push("hidrogeno");
  if (/etanol/.test(t)) hay.push("etanol");
  return hay;
}
const SERVICIO_FUN: Record<string, number> = { particular: 582.7, publico: 609.6, diplomatico: 636.4, oficial: 663.4, especial: 691.9 };
const CASILLA_XY: Record<number, [number, number]> = {
  1: [37, 129], 2: [92, 129], 3: [150, 129], 4: [207, 129.5], 5: [263.6, 129], 6: [320.2, 129],
  7: [37.6, 154.5], 8: [92.4, 154.5], 9: [150, 154.5], 10: [206.3, 154.5], 11: [262.8, 154.5], 12: [319.1, 154.5],
  13: [37.2, 183], 14: [92.5, 183], 15: [150, 183], 16: [206.5, 183], 17: [263, 183], 18: [319.8, 183],
};

function partirPlaca(placa: string) {
  const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = p.match(/^([A-Z]+)(\d.*)$/);
  return m ? { letras: m[1], numeros: m[2] } : { letras: "", numeros: p };
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const partesFecha = (f: string) => { const [anio, mes, dia] = f.split("-"); return { anio: anio ?? "", mes: MESES[Number(mes) - 1] ?? "", mesNum: mes ?? "", dia: dia ? String(Number(dia)) : "" }; };

function casillasFun(d: DatosFormatos): Casilla[] {
  const v = d.vehiculo;
  const placa = partirPlaca(v.placa);
  // El punto 1 (organismo de tránsito y fecha del trámite) va en blanco: lo llena Tránsito (corrección de Tránsito en
  // un formulario, 28/10/2026). Quedan en blanco pero se pueden escribir a mano en la vista previa si algún día toca.
  const t: Casilla[] = [
    { id: "organismo", x: 518, y: 70.5, texto: "", ancho: 168, tam: 7 },
    { id: "organismo_ciudad", x: 487.5, y: 97, texto: "", ancho: 58, tam: 7.5 },
    { id: "dia", x: 603, y: 98, texto: "", ancho: 20, centro: true }, { id: "mes", x: 627, y: 98, texto: "", ancho: 22, centro: true }, { id: "anio", x: 653, y: 98, texto: "", ancho: 26, centro: true },
    { id: "placa_letras", x: 706, y: 91, texto: placa.letras, ancho: 26, tam: 10, centro: true, negrita: true }, { id: "placa_numeros", x: 733, y: 91, texto: placa.numeros, ancho: 25, tam: 10, centro: true, negrita: true },
    { id: "marca", x: 379, y: 133, texto: v.marca, ancho: 76 }, { id: "linea", x: 459, y: 133, texto: v.linea, ancho: 80 },
    { id: "color", x: 381, y: 161, texto: v.color, ancho: 238 }, { id: "modelo", x: 626, y: 161, texto: v.modelo, ancho: 52, centro: true }, { id: "cilindraje", x: 682, y: 161, texto: v.cilindraje, ancho: 74, centro: true },
    { id: "capacidad", x: 379, y: 187, texto: v.capacidad, ancho: 76 }, { id: "potencia", x: 691, y: 187, texto: v.potencia, ancho: 66, centro: true },
    { id: "carroceria", x: 396, y: 250, texto: v.carroceria, ancho: 165 },
    { id: "motor", x: 575, y: 232, texto: v.motor, ancho: 128 }, { id: "chasis", x: 575, y: 259, texto: v.chasis, ancho: 128 }, { id: "serie", x: 575, y: 287.5, texto: v.serie, ancho: 128 }, { id: "vin", x: 575, y: 314, texto: v.vin, ancho: 178 },
  ];
  for (const n of d.casillas) if (CASILLA_XY[n]) t.push(X(`tramite_${n}`, ...CASILLA_XY[n]));
  for (const c of combustiblesDe(v.combustible)) t.push(X(`combustible_${c}`, COMBUSTIBLE_FUN[c], 135.7));
  const clase = CLASE_FUN[sinTildes(v.clase).trim()] ?? (v.clase ? CLASE_FUN.otro : undefined);
  if (clase) t.push(X("clase", clase[0], clase[1] - 2));
  const serv = SERVICIO_FUN[sinTildes(v.servicio).trim()];
  if (serv) t.push(X("servicio", serv, 372.6));
  const persona = (p: PersonaFormato | null, quien: string, dy: number) => {
    t.push(
      { id: `${quien}_apellido1`, x: 36, y: 315 + dy, texto: p?.apellido1 ?? "", ancho: esIndeterminada(p) ? 224 : 112, tam: 9 }, { id: `${quien}_apellido2`, x: 154, y: 315 + dy, texto: p?.apellido2 ?? "", ancho: 106, tam: 9 }, { id: `${quien}_nombres`, x: 266, y: 315 + dy, texto: p?.nombres ?? "", ancho: 102, tam: 9 },
      { id: `${quien}_documento`, x: 318, y: 344 + dy, texto: p?.documento ?? "", ancho: 50, tam: 8.5, centro: true },
      { id: `${quien}_direccion`, x: 36, y: 368 + dy, texto: p?.direccion ?? "", ancho: 156 }, { id: `${quien}_ciudad`, x: 199, y: 368 + dy, texto: p?.ciudad ?? "", ancho: 106 }, { id: `${quien}_telefono`, x: 311, y: 368 + dy, texto: p?.telefono ?? "", ancho: 58 },
    );
    const doc = p ? DOC_FUN[p.tipoDocumento] : undefined;
    if (doc && p?.documento) t.push(X(`${quien}_tipo_doc`, doc, 340.8 + dy));
  };
  persona(d.propietario, "propietario", 0);
  persona(d.comprador, "comprador", 141.5);
  t.push({ id: "observaciones", x: 383, y: 478, texto: d.observaciones, ancho: 362, tam: 7.5 });
  return t;
}

/** Contrato de mandato (modelo general de Tránsito de Pasto). */
function casillasMandato(d: DatosFormatos, mandante: PersonaFormato): Casilla[] {
  const v = d.vehiculo;
  const f = partesFecha(d.fecha);
  // "CC__NIT__CE__": la X va en la raya del tipo de documento.
  const TIPO_X: Record<string, number> = { CC: 282.5, NIT: 315.2, CE: 345.3 };
  const t: Casilla[] = [
    { id: "ciudad", x: 96, y: 111.4, texto: d.ciudadFirma, ancho: 224, tam: 11 },
    { id: "fecha", x: 356, y: 111.4, texto: `${f.dia} de ${f.mes} de ${f.anio}`, ancho: 198, tam: 11 },
    { id: "mandante", x: 222, y: 137.1, texto: nombreCompleto(mandante), ancho: 238, tam: 11 },
    { id: "mandante_documento", x: 396, y: 150.9, texto: mandante.documento, ancho: 151, tam: 11 },
    { id: "mandatario", x: 107, y: 192.3, texto: d.mandatario.nombre, ancho: 231, tam: 11 },
    { id: "mandatario_documento", x: 320, y: 206.1, texto: d.mandatario.documento, ancho: 104, tam: 11 },
    { id: "tramite", x: 58, y: 344.1, texto: d.tramiteTexto, ancho: 490, tam: 11 },
    { id: "placa", x: 106, y: 385.5, texto: v.placa.toUpperCase(), ancho: 64, tam: 11, negrita: true }, { id: "marca", x: 220, y: 385.5, texto: v.marca, ancho: 92, tam: 10 },
    { id: "modelo", x: 373, y: 385.5, texto: v.modelo, ancho: 65, tam: 11, centro: true }, { id: "cilindraje", x: 515, y: 385.5, texto: v.cilindraje, ancho: 39, tam: 10, centro: true },
    { id: "motor", x: 119, y: 399.3, texto: v.motor, ancho: 164, tam: 10 }, { id: "chasis", x: 354, y: 399.3, texto: v.chasis, ancho: 198, tam: 10 },
    { id: "mandante_cc", x: 80, y: 662.5, texto: mandante.documento, ancho: 240, tam: 11 },
    { id: "mandatario_cc", x: 80, y: 731.5, texto: d.mandatario.documento, ancho: 240, tam: 11 },
  ];
  const tm = TIPO_X[mandante.tipoDocumento];
  if (tm && mandante.documento) t.push(X("mandante_tipo_doc", tm, 147.8));
  const tt = TIPO_X[d.mandatario.tipoDocumento ?? "CC"];
  if (tt && d.mandatario.documento) t.push(X("mandatario_tipo_doc", tt - 76, 203));
  return t;
}

/** Contrato de compraventa (modelo de Tránsito de Itagüí, tamaño oficio). */
function casillasCompraventa(d: DatosFormatos): Casilla[] {
  const v = d.vehiculo, p = d.propietario, c = d.comprador;
  const f = partesFecha(d.fecha);
  const precio = Number(String(d.precio).replace(/\D/g, ""));
  return [
    { id: "vendedor", x: 117, y: 133.8, texto: nombreCompleto(p), ancho: 274, tam: 10.5 },
    { id: "comprador", x: 238, y: 159, texto: c ? nombreCompleto(c) : "", ancho: 261, tam: 10.5 },
    { id: "placa", x: 106, y: 272.7, texto: v.placa.toUpperCase(), ancho: 54, tam: 10.5, negrita: true },
    { id: "marca", x: 109, y: 291.7, texto: v.marca, ancho: 84, tam: 10 }, { id: "modelo", x: 240, y: 291.7, texto: v.modelo, ancho: 72, tam: 10.5, centro: true }, { id: "linea", x: 350, y: 291.7, texto: v.linea, ancho: 127, tam: 10 },
    { id: "serie", x: 104, y: 310.8, texto: v.serie, ancho: 176, tam: 10 }, { id: "chasis", x: 324, y: 310.8, texto: v.chasis, ancho: 158, tam: 10 },
    { id: "motor", x: 106, y: 329.8, texto: v.motor, ancho: 170, tam: 10 }, { id: "color", x: 317, y: 329.8, texto: v.color, ancho: 164, tam: 10 },
    { id: "precio", x: 420, y: 361.3, texto: precio ? miles(precio) : "", ancho: 115, tam: 10.5, centro: true },
    { id: "precio_letras", x: 134, y: 380.3, texto: precio ? precioEnLetras(precio) : "", ancho: 243, tam: 10 },
    { id: "forma_pago", x: 303, y: 399.2, texto: d.formaPago, ancho: 231, tam: 10 },
    { id: "ciudad", x: 422, y: 722, texto: d.ciudadFirma, ancho: 85, tam: 10.5 },
    { id: "dia", x: 71, y: 734.7, texto: f.dia, ancho: 36, tam: 10.5, centro: true }, { id: "mes", x: 166, y: 734.7, texto: f.mes, ancho: 102, tam: 10.5, centro: true }, { id: "anio", x: 312, y: 734.7, texto: f.anio, ancho: 66, tam: 10.5, centro: true },
    { id: "vendedor_cc", x: 99, y: 798.8, texto: p.documento, ancho: 120, tam: 10.5 },
    { id: "comprador_cc", x: 347, y: 798.8, texto: c?.documento ?? "", ancho: 120, tam: 10.5 },
  ];
}

/** Todas las casillas de un formato con los datos (también las vacías: en la vista previa se pueden llenar). */
export function casillasDe(d: DatosFormatos, formato: Formato): Casilla[] {
  if (formato === "fun") return casillasFun(d);
  if (formato === "compraventa") return casillasCompraventa(d);
  const mandante = formato === "mandato_comprador" ? d.comprador : d.propietario;
  return mandante ? casillasMandato(d, mandante) : [];
}
/** Clave de una casilla en `cambios` (los dos mandatos usan las mismas casillas). */
export const claveCambio = (formato: Formato, id: string) => `${formato}:${id}`;

/* ───────────── escritura ───────────── */

/**
 * El texto como se puede imprimir con las fuentes estándar del PDF: en una línea (tabuladores y saltos, un espacio),
 * comillas y guiones tipográficos (los de WhatsApp) en su forma simple, y sin emojis ni caracteres que no tiene.
 */
export const textoImprimible = (s: string) => s.normalize("NFC")
  .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, "-").replace(/…/g, "...")
  .replace(/\s+/g, " ").replace(/[^\x20-\x7E¡-ÿ]/g, "").replace(/ {2,}/g, " ").trim();

/** Letra mínima que se sigue leyendo bien impresa; por debajo, antes se angosta la letra. */
const TAM_LEGIBLE = 6;
/** Lo más que se angosta la letra (porcentaje del ancho normal). */
const APRETAR_MIN = 50;

/**
 * Cómo escribir un texto para que quepa en su casilla, como lo haría uno a mano: primero letra más pequeña (hasta 6
 * pt), luego letra más angosta (hasta la mitad), y solo al final más pequeña aún (5 pt). `apretar` = % del ancho.
 */
export function ajusteQueCabe(texto: string, c: Pick<Casilla, "ancho" | "tam" | "negrita">, medir: (t: string, tam: number) => number) {
  let tam = c.tam ?? 8;
  if (!c.ancho) return { tam, apretar: 100 };
  while (tam > TAM_LEGIBLE && medir(texto, tam) > c.ancho) tam -= 0.25;
  let apretar = Math.min(100, Math.floor((100 * c.ancho) / medir(texto, tam)));
  if (apretar >= APRETAR_MIN) return { tam, apretar };
  apretar = APRETAR_MIN;
  while (tam > 5 && (medir(texto, tam) * APRETAR_MIN) / 100 > c.ancho) tam -= 0.25;
  return { tam, apretar };
}
/** Solo el tamaño de letra. */
export const tamQueCabe = (texto: string, c: Pick<Casilla, "ancho" | "tam" | "negrita">, medir: (t: string, tam: number) => number) => ajusteQueCabe(texto, c, medir).tam;

function escribir(pagina: PDFPage, f: { normal: PDFFont; negrita: PDFFont }, c: Casilla) {
  const texto = textoImprimible(c.texto ?? "");
  if (!texto) return;
  const fuente = c.negrita ? f.negrita : f.normal;
  const { tam, apretar } = ajusteQueCabe(texto, c, (t, s) => fuente.widthOfTextAtSize(t, s));
  const ancho = (fuente.widthOfTextAtSize(texto, tam) * apretar) / 100;
  const x = c.centro && c.ancho ? c.x + (c.ancho - ancho) / 2 : c.x;
  // La letra angosta (Tz) es parte del estado gráfico: se pone antes de escribir y se quita después.
  if (apretar < 100) pagina.pushOperators(pushGraphicsState(), setCharacterSqueeze(apretar));
  pagina.drawText(texto, { x, y: pagina.getHeight() - c.y, size: tam, font: fuente, color: rgb(0.05, 0.1, 0.35) });
  if (apretar < 100) pagina.pushOperators(popGraphicsState());
}

/**
 * Genera un PDF con los formatos elegidos, llenos. `cargar` trae los bytes de cada formato original
 * (en el navegador: fetch("/formatos/..."); en Node: readFile). `cambios` = lo corregido en la vista previa.
 */
export async function generarFormatos(d: DatosFormatos, elegidos: Formato[], cargar: (archivo: string) => Promise<ArrayBuffer | Uint8Array>, cambios: Record<string, string> = {}) {
  const salida = await PDFDocument.create();
  salida.setTitle(`Formatos ${d.vehiculo.placa.toUpperCase()} ${d.fecha}`);
  const f = { normal: await salida.embedFont(StandardFonts.Helvetica), negrita: await salida.embedFont(StandardFonts.HelveticaBold) };
  const originales = new Map<string, PDFDocument>();
  for (const id of elegidos) {
    const def = FORMATOS_LLENABLES.find((x) => x.id === id)!;
    if (id === "mandato_comprador" && (!d.comprador || esIndeterminada(d.comprador))) continue;
    if (id === "compraventa" && esIndeterminada(d.comprador)) continue;
    if (!originales.has(def.archivo)) originales.set(def.archivo, await PDFDocument.load(await cargar(def.archivo)));
    // La primera página se llena; la otra cara (si la tiene) va detrás tal cual, para imprimir a doble cara.
    const [pagina, ...detras] = await salida.copyPages(originales.get(def.archivo)!, def.reverso ? [0, 1] : [0]);
    salida.addPage(pagina);
    for (const p of detras) salida.addPage(p);
    for (const c of casillasDe(d, id)) escribir(pagina, f, { ...c, texto: cambios[claveCambio(id, c.id)] ?? c.texto });
  }
  return salida.save();
}
