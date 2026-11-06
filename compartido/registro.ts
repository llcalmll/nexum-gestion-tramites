/*
 * Registrar un trámite que ya llega digitado (o del que solo hay fotos): junta lo que se leyó de cada hoja (tarjeta
 * de propiedad, cédulas, formulario único, mandato, compraventa, el sobre con notas) en UN borrador de trámite para
 * que Felipe lo confirme. Es código exacto, sin IA: la IA solo leyó cada hoja por separado.
 *
 * Reglas:
 * - Vehículo: cada dato de la fuente más confiable que lo traiga (tarjeta > formulario > compraventa > mandato > nota).
 * - Personas: se juntan por número de documento y, si no hay, por nombre (dos palabras en común). El rol sale de
 *   donde aparecen (formulario: propietario = vendedor si hay comprador; compraventa; nota). La cédula manda en el
 *   nombre (apellidos y nombres separados) y el número; el formulario y la nota, en teléfono, dirección y ciudad.
 * - Trámites: las casillas marcadas del formulario, lo escrito en la nota y lo que Felipe escribió.
 * - Lo que dos hojas dicen distinto queda en `diferencias` (con el valor de cada una) para que Felipe elija.
 * - Nada se inventa: lo que ninguna hoja trae queda vacío.
 * - Licencias (refrendación = renovación, primera vez...): salen del recibo de pago, la cédula o la licencia; la persona
 *   es el titular y las categorías (A2, B1...) salen de lo que diga la licencia o el recibo. Si el recibo solo dice
 *   "moto" o "carro", la categoría se elige (no se adivina A1 o A2).
 * - Lo que Felipe escribe al mandarlo (textoFelipe.ts) también cuenta: el trámite, las categorías, el teléfono, la
 *   cédula y el nacimiento del titular si las hojas no los traen, lo que se cobra, el abono, la ciudad; y lo demás que
 *   diga va a las observaciones. Lo que salga del mensaje queda marcado para revisar ("su mensaje").
 */
import { normalizar } from "./dominio";
import { organismoDeTexto, tiposDelTexto } from "./reglas";
import { datosDelTexto } from "./textoFelipe";

export type ClaseHoja = "tarjeta_propiedad" | "cedula" | "licencia_conduccion" | "formulario_unico" | "contrato_mandato" | "contrato_compraventa" | "recibo_pago" | "carta_compromiso" | "nota" | "otro";
export const CLASES_HOJA: { clase: ClaseHoja; nombre: string }[] = [
  { clase: "tarjeta_propiedad", nombre: "Tarjeta de propiedad" }, { clase: "cedula", nombre: "Cédula" }, { clase: "licencia_conduccion", nombre: "Licencia de conducción" }, { clase: "formulario_unico", nombre: "Formulario único" },
  { clase: "contrato_mandato", nombre: "Contrato de mandato" }, { clase: "contrato_compraventa", nombre: "Compraventa" }, { clase: "recibo_pago", nombre: "Recibo de pago" }, { clase: "carta_compromiso", nombre: "Carta de compromiso" }, { clase: "nota", nombre: "Nota / sobre" }, { clase: "otro", nombre: "Otro documento" },
];

export interface PersonaLeida {
  rol?: string; nombreCompleto?: string; apellidos?: string; nombres?: string; tipoDocumento?: string; numeroDocumento?: string;
  telefono?: string; direccion?: string; ciudad?: string; fechaNacimiento?: string; fechaExpedicionDocumento?: string;
}
export interface VehiculoLeido {
  placa?: string; marca?: string; linea?: string; modelo?: string; clase?: string; color?: string; cilindraje?: string; servicio?: string;
  combustible?: string; motor?: string; chasis?: string; serie?: string; vin?: string; capacidad?: string; carroceria?: string;
  potencia?: string; fechaMatricula?: string; licenciaTransito?: string;
}
/** Lo que devuelve POST /api/leer con tipo "documento" para una hoja. */
export interface HojaLeida {
  clase: ClaseHoja; tramites?: string[]; organismo?: string; vehiculo?: VehiculoLeido; personas?: PersonaLeida[];
  valor?: string; precio?: string; notas?: string;
  /** Campos que el lector no leyó con seguridad ("vehiculo.placa", "personas.0.telefono", "valor"). */
  dudosos?: string[];
}

export interface PersonaBorrador {
  nombre: string; tipoDocumento: string; numeroDocumento: string; telefono: string; direccion: string; ciudad: string;
  fechaNacimiento: string; fechaExpedicionDocumento: string;
}
export const CAMPOS_VEHICULO_BORRADOR = ["placa", "marca", "linea", "modelo", "clase", "color", "cilindraje", "servicio", "combustible", "motor", "chasis", "serie", "vin", "carroceria", "capacidad", "potencia", "fechaMatricula", "licenciaTransito"] as const;
export type VehiculoBorrador = Record<(typeof CAMPOS_VEHICULO_BORRADOR)[number], string>;
export interface Diferencia { campo: string; etiqueta: string; opciones: { valor: string; fuentes: string[] }[] }
export interface Borrador {
  tipoIds: string[]; organismoId: string; organismoLeido: string;
  vehiculo: VehiculoBorrador; vendedor: PersonaBorrador | null; comprador: PersonaBorrador | null;
  /** Quién es el cliente del trámite (el que paga): el comprador en un traspaso; si no, el propietario. */
  cliente: "vendedor" | "comprador";
  valor: string; precioVenta: string; observaciones: string;
  /** Lo que ya pagó (dicho en el mensaje): queda como un abono del trámite. */
  abono: string; metodoAbono: string;
  /** Expedición de licencia: con clases o sin clases, si el mensaje lo dice ("" si no: se elige en el formulario). */
  conClases: "" | "con" | "sin";
  /** Licencia: las categorías ("A2,B1"), de la licencia o del recibo; vacío si no lo dicen. */
  categorias: string;
  /** Licencia: lo que dice el recibo (o el mensaje) de la clase de vehículo cuando no dice la categoría ("moto", "carro", "publico"). */
  pistaCategoria: string;
  /** Para cada hoja (en el orden en que llegaron): de quién es, si es de una persona (la cédula del vendedor...). */
  roles: ("vendedor" | "comprador" | null)[];
  diferencias: Diferencia[]; avisos: string[];
  /** De qué hojas sale cada dato ("vehiculo.placa": ["tarjeta", "formulario"], "comprador.telefono": ["nota"]...). */
  fuentes: Record<string, string[]>;
  /** Datos que conviene revisar: el lector dudó, o solo salen de algo escrito a mano (formulario, mandato, compraventa, nota). */
  revisar: string[];
}

const FUENTE: Record<ClaseHoja, string> = { tarjeta_propiedad: "tarjeta", cedula: "cédula", licencia_conduccion: "licencia", formulario_unico: "formulario", contrato_mandato: "mandato", contrato_compraventa: "compraventa", recibo_pago: "recibo", carta_compromiso: "carta de compromiso", nota: "nota", otro: "otro" };
const PRIORIDAD_VEHICULO: ClaseHoja[] = ["tarjeta_propiedad", "formulario_unico", "contrato_compraventa", "contrato_mandato", "nota", "otro", "recibo_pago", "cedula", "licencia_conduccion", "carta_compromiso"];
const ETIQUETA_VEHICULO: Record<string, string> = { placa: "Placa", marca: "Marca", linea: "Línea", modelo: "Modelo", clase: "Clase", color: "Color", cilindraje: "Cilindraje", servicio: "Servicio", combustible: "Combustible", motor: "Motor", chasis: "Chasis", serie: "Serie", vin: "VIN", carroceria: "Carrocería", capacidad: "Capacidad", potencia: "Potencia", fechaMatricula: "Fecha de matrícula", licenciaTransito: "Licencia de tránsito" };
/** Datos de identificación del vehículo: si dos hojas difieren, Felipe elige. (Color, servicio... se toma el de la fuente más confiable.) */
const VEHICULO_COMPARA = new Set(["placa", "marca", "modelo", "cilindraje", "motor", "chasis", "vin"]);

const soloDigitos = (s?: string) => (s ?? "").replace(/\D/g, "");
const limpioPlaca = (s?: string) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const mayus = (s?: string) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const palabras = (s?: string) => normalizar(s ?? "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1);
/** Nombre completo "NOMBRES APELLIDOS" (la cédula trae los dos aparte). */
const nombreDe = (p: PersonaLeida) => mayus(p.nombres && p.apellidos ? `${p.nombres} ${p.apellidos}` : p.nombreCompleto ?? [p.nombres, p.apellidos].filter(Boolean).join(" "));
/** Cuántos dígitos hay que cambiar, quitar o poner para pasar de un número al otro. */
function distancia(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Dos palabras de un nombre son la misma si son iguales o, en las largas, casi iguales ("ANZELMIO" y "ANGELMIRO", mal leídas a mano). */
const mismaPalabra = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && distancia(a, b) <= 2);
/**
 * La misma persona. Los nombres van como "NOMBRES APELLIDOS": la primera palabra es el primer nombre, y tiene que
 * coincidir (un papá y su hijo comparten los apellidos, no el nombre).
 * - Con el mismo documento, siempre.
 * - Si alguno no tiene documento: el primer nombre y otra palabra más en común.
 * - Con documentos distintos: el primer nombre y dos palabras más en común (un número escrito a mano mal leído: la
 *   diferencia se muestra para elegir), o el primer nombre y otra palabra con los números casi iguales.
 */
const mismaPersona = (a: { doc: string; nombres: string[] }, b: { doc: string; nombres: string[] }) => {
  if (a.doc && b.doc && a.doc === b.doc) return true;
  if (!a.nombres.length || !b.nombres.length) return false;
  const primerNombre = mismaPalabra(a.nombres[0], b.nombres[0]);
  const comunes = a.nombres.filter((w) => b.nombres.some((x) => mismaPalabra(w, x))).length;
  if (a.doc && b.doc) return primerNombre && (comunes >= 3 || (comunes >= 2 && distancia(a.doc, b.doc) <= 2));
  return primerNombre && (comunes >= 2 || Math.min(a.nombres.length, b.nombres.length) === 1);
};
/**
 * Cuánto pesa lo que dice cada hoja sobre quién vende y quién compra: la tarjeta trae al dueño registrado (el que
 * vende); la nota y la compraventa lo dicen con palabras; en el formulario a mano los puntos 21 y 22 a veces se leen
 * cruzados.
 */
const PESO_ROL: Record<ClaseHoja, number> = { tarjeta_propiedad: 3, nota: 2, contrato_compraventa: 2, formulario_unico: 1.5, contrato_mandato: 1, cedula: 0, licencia_conduccion: 0, recibo_pago: 0, carta_compromiso: 0, otro: 0.5 };
/** Hojas impresas (lo que traen es confiable); las demás suelen venir escritas a mano. */
const IMPRESA = new Set<ClaseHoja>(["tarjeta_propiedad", "cedula", "licencia_conduccion", "recibo_pago"]);
/**
 * Cómo se llaman (y se escriben a la carrera) los trámites de licencia en recibos, notas y mensajes -> como se llaman
 * en la lista.
 */
const SINONIMOS_LICENCIA: [RegExp, string][] = [
  // "refrendación" (a veces mal leída: "refracción"; mal escrita: "refrendaicion") es la renovación.
  [/\brefr(enda|acc)\w*/g, " renovacion licencia "],
  [/\breno[bv]\w*/g, " renovacion licencia "],
  [/\bse le vencio\b/g, " renovacion licencia "],
  // La migración: la licencia de menor de edad pasa a ser de mayor.
  [/\bmigr\w*/g, " migracion licencia "],
  [/\b(de menor a mayor|menor de edad a mayor|pas\w* a mayor( de edad)?|mayoria de edad|(ya )?cumplio (los )?18|ya es mayor de edad)\b/g, " migracion licencia "],
  [/\b(primera vez|primer vez|1a vez|1ra vez|1era vez|1 vez|por primera|licencia nueva|nueva licencia|sacar (la )?licencia|saca (la )?licencia|no tiene licencia|nunca ha tenido licencia)\b/g, " expedicion licencia "],
  [/\brecateg\w*/g, " recategorizacion licencia "],
  [/\b(sub\w*|agreg\w*|anad\w*|aument\w*|otra|nueva) (de |la |una )?categor\w*/g, " recategorizacion licencia "],
  // El duplicado: se le perdió, se la robaron.
  [/\b(duplicad\w*|se le perdio|la perdio|perdida|extravi\w*|robada|robaron|robo|hurto|hurtaron)\b/g, " duplicado licencia "],
];
export const CATEGORIAS_LICENCIA = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"] as const;

/** El texto (ya normalizado) con los trámites de licencia dichos como se llaman en la lista ("refrendación" -> renovación). */
export const conSinonimosLicencia = (texto: string) => SINONIMOS_LICENCIA.reduce((t, [re, por]) => t.replace(re, por), texto);

/** Lo que dicen las hojas de un dato: los valores distintos con las hojas que dicen cada uno. */
function opcionesDe(valores: { valor: string; fuente: string }[], igual: (a: string, b: string) => boolean) {
  const out: { valor: string; fuentes: string[] }[] = [];
  for (const v of valores) {
    if (!v.valor) continue;
    const o = out.find((x) => igual(x.valor, v.valor));
    if (o) { if (!o.fuentes.includes(v.fuente)) o.fuentes.push(v.fuente); } else out.push({ valor: v.valor, fuentes: [v.fuente] });
  }
  return out;
}

export function combinarHojas(
  hojas: HojaLeida[],
  cat: { tipos: { id: string; nombre: string; categoria: string }[]; organismos: { id: string; nombre: string; ciudad: string | null }[] },
  textoFelipe = "",
): Borrador {
  const diferencias: Diferencia[] = [];
  const avisos: string[] = [];
  const fuentes: Record<string, string[]> = {};
  const revisar = new Set<string>();
  const claseDeFuente = (f: string) => (Object.entries(FUENTE).find(([, n]) => f === n || f.startsWith(`${n} `))?.[0] ?? "otro") as ClaseHoja;
  /** Anota de dónde sale un dato y si hay que revisarlo (solo de hojas a mano, o el lector dudó). */
  const anotar = (campo: string, de: string[], dudo = false) => {
    if (!de.length) return;
    fuentes[campo] = de;
    if (dudo || !de.some((f) => IMPRESA.has(claseDeFuente(f)))) revisar.add(campo);
  };
  const dudoso = (i: number, ruta: string) => (hojas[i].dudosos ?? []).some((d) => d === ruta || d.endsWith(`.${ruta.split(".").pop()}`) && d.startsWith(ruta.split(".")[0]));
  const nombreHoja = (i: number) => { const n = hojas.filter((h, k) => k <= i && h.clase === hojas[i].clase).length; const total = hojas.filter((h) => h.clase === hojas[i].clase).length; return total > 1 ? `${FUENTE[hojas[i].clase]} ${n}` : FUENTE[hojas[i].clase]; };

  // ── Vehículo ──
  const vehiculo = Object.fromEntries(CAMPOS_VEHICULO_BORRADOR.map((k) => [k, ""])) as VehiculoBorrador;
  for (const k of CAMPOS_VEHICULO_BORRADOR) {
    const valores = PRIORIDAD_VEHICULO.flatMap((c) => hojas.map((h, i) => ({ h, i })).filter(({ h }) => h.clase === c && h.vehiculo?.[k]))
      .map(({ h, i }) => ({ valor: k === "placa" ? limpioPlaca(h.vehiculo![k]) : k === "modelo" || k === "cilindraje" || k === "licenciaTransito" ? soloDigitos(h.vehiculo![k]) : mayus(h.vehiculo![k]), fuente: nombreHoja(i) }));
    const igual = (a: string, b: string) => normalizar(a).replace(/[^a-z0-9]/g, "") === normalizar(b).replace(/[^a-z0-9]/g, "");
    const ops = opcionesDe(valores, igual);
    vehiculo[k] = ops[0]?.valor ?? "";
    if (ops.length > 1 && VEHICULO_COMPARA.has(k)) diferencias.push({ campo: `vehiculo.${k}`, etiqueta: ETIQUETA_VEHICULO[k], opciones: ops });
    // Lo que el lector marcó como dudoso se revisa, sea el dato que sea (la serie de una foto pequeña...).
    const dudo = !!ops[0] && hojas.some((h, i) => !!h.vehiculo?.[k] && ops[0].fuentes.includes(nombreHoja(i)) && dudoso(i, `vehiculo.${k}`));
    if (ops[0] && (VEHICULO_COMPARA.has(k) || dudo)) anotar(`vehiculo.${k}`, ops[0].fuentes, dudo);
  }
  // La placa a veces queda solo en el texto de una nota ("ABC123"): se toma de ahí (y se revisa).
  if (!vehiculo.placa) {
    for (const [i, h] of hojas.entries()) {
      const m = `${h.notas ?? ""} ${(h.tramites ?? []).join(" ")}`.toUpperCase().match(/\b([A-Z]{3})[\s-]?(\d{2}[A-Z0-9])\b/);
      if (m) { vehiculo.placa = m[1] + m[2]; anotar("vehiculo.placa", [nombreHoja(i)], true); break; }
    }
  }

  // ── Trámites ──
  // Lo que Felipe escribe o la nota de la oficina mandan; si no dicen nada, las casillas del formulario (marcadas a
  // mano, se leen peor); si tampoco, el mandato o la compraventa.
  const nombrados = (clases: ClaseHoja[], extra = "") => tiposDelTexto(cat.tipos, [...hojas.filter((h) => clases.includes(h.clase)).flatMap((h) => h.tramites ?? []), extra].join(" "));
  const porNota = nombrados(["nota"], textoFelipe), porFormulario = nombrados(["formulario_unico"]), porOtros = nombrados(["contrato_mandato", "contrato_compraventa", "otro"]);
  let tipos = porNota.length ? porNota : porFormulario.length ? porFormulario : porOtros;
  // Licencias: del recibo de pago, la nota o lo que Felipe escribió ("refrendación" es la renovación). Sin tarjeta de
  // propiedad ni formulario, si nombran un trámite de licencia, es de licencia.
  const textoLicencia = normalizar([...hojas.filter((h) => ["recibo_pago", "nota", "otro", "licencia_conduccion"].includes(h.clase)).flatMap((h) => h.tramites ?? []), textoFelipe].join(" "));
  const conSinonimos = conSinonimosLicencia(textoLicencia);
  // Lo que trae el mensaje de Felipe (teléfono, cobro, abono, ciudad...).
  const dt = datosDelTexto(textoFelipe, cat.organismos);
  const DE_MENSAJE = "su mensaje";
  const deLicencia = tiposDelTexto(cat.tipos, conSinonimos, "licencia");
  const sinVehiculo = !hojas.some((h) => h.clase === "tarjeta_propiedad" || h.clase === "formulario_unico" || h.clase === "contrato_compraventa");
  if (deLicencia.length && (sinVehiculo || !tipos.length)) tipos = deLicencia;
  const licencia = tipos.length > 0 && tipos.every((t) => t.categoria === "licencia");
  const lista = (ts: { nombre: string }[]) => ts.map((t) => t.nombre.toLowerCase()).join(" + ");
  if (porNota.length && porFormulario.length && lista(porNota) !== lista(porFormulario)) avisos.push(`El formulario marca ${lista(porFormulario)}; la nota dice ${lista(porNota)}: se tomó lo de la nota.`);
  const tipoIds = tipos.map((t) => t.id);
  const traspaso = tipos.some((t) => /traspaso/i.test(t.nombre)) || hojas.some((h) => h.clase === "contrato_compraventa");

  // ── Personas: se juntan por documento o nombre ──
  type Grupo = { doc: string; nombres: string[]; roles: { rol: string; peso: number }[]; datos: { p: PersonaLeida; clase: ClaseHoja; fuente: string; hoja: number }[] };
  const grupos: Grupo[] = [];
  hojas.forEach((h, i) => {
    for (const p of h.personas ?? []) {
      if (p.rol === "mandatario") continue; // el mandatario es la oficina
      const clave = { doc: soloDigitos(p.numeroDocumento), nombres: palabras(nombreDe(p)) };
      if (!clave.doc && !clave.nombres.length) continue;
      // En el formulario, el "propietario" es quien vende si es un traspaso; la tarjeta trae al dueño actual.
      const rol = p.rol === "propietario" ? (traspaso ? "vendedor" : "propietario") : p.rol ?? "";
      let g = grupos.find((x) => mismaPersona(x, clave));
      if (!g) { g = { ...clave, roles: [], datos: [] }; grupos.push(g); }
      if (!g.doc && clave.doc) g.doc = clave.doc;
      for (const w of clave.nombres) if (!g.nombres.some((x) => mismaPalabra(x, w))) g.nombres.push(w);
      if (rol) g.roles.push({ rol, peso: PESO_ROL[h.clase] });
      g.datos.push({ p, clase: h.clase, fuente: nombreHoja(i), hoja: i });
    }
  });
  // Un grupo puede haber quedado partido (primero solo nombre, luego documento): se vuelven a juntar.
  for (let i = 0; i < grupos.length; i++) for (let j = grupos.length - 1; j > i; j--) {
    if (mismaPersona(grupos[i], grupos[j])) { grupos[i].roles.push(...grupos[j].roles); grupos[i].datos.push(...grupos[j].datos); grupos[i].doc ||= grupos[j].doc; grupos.splice(j, 1); }
  }
  const rolDe = (g: Grupo): "vendedor" | "comprador" | null => {
    const suma = (f: (r: string) => boolean) => g.roles.filter((r) => f(r.rol)).reduce((n, r) => n + r.peso, 0);
    const v = suma((r) => r === "vendedor" || r === "propietario"), c = suma((r) => r === "comprador");
    return v > c ? "vendedor" : c > v ? "comprador" : null;
  };
  const conRol = grupos.map((g) => ({ g, rol: rolDe(g) }));
  // Las cédulas sueltas (sin rol en ninguna hoja): si solo falta uno de los dos, es ese.
  for (const x of conRol.filter((x) => !x.rol && x.g.datos.some((d) => d.clase === "cedula" || d.clase === "licencia_conduccion"))) {
    const libres = (["vendedor", "comprador"] as const).filter((r) => !conRol.some((y) => y.rol === r) && (r === "vendedor" || traspaso));
    if (libres.length === 1) x.rol = libres[0];
    else avisos.push(`No sé si ${nombreDe(x.g.datos[0].p) || "la persona de una cédula"} vende o compra: elíjalo.`);
  }
  // Falta el vendedor o el comprador y queda una sola persona sin papel: se le asigna el que falta y se avisa.
  for (const r of traspaso ? (["comprador", "vendedor"] as const) : (["vendedor"] as const)) {
    if (conRol.some((x) => x.rol === r)) continue;
    const sueltos = conRol.filter((x) => !x.rol);
    if (sueltos.length === 1) {
      sueltos[0].rol = r;
      avisos.push(`Se tomó a ${nombreDe(sueltos[0].g.datos[0].p) || "la otra persona"} como ${r} (las hojas no lo dicen claro): confírmelo.`);
    }
  }
  for (const r of ["vendedor", "comprador"] as const) {
    const de = conRol.filter((x) => x.rol === r);
    if (de.length > 1) avisos.push(`Hay ${de.length} personas como ${r}: ${de.map((x) => nombreDe(x.g.datos[0].p)).join(", ")}. Quedó la primera; revise.`);
  }
  const ORDEN_NOMBRE: ClaseHoja[] = ["cedula", "licencia_conduccion", "formulario_unico", "contrato_compraventa", "contrato_mandato", "tarjeta_propiedad", "recibo_pago", "nota", "carta_compromiso", "otro"];
  const ORDEN_CONTACTO: ClaseHoja[] = ["formulario_unico", "nota", "carta_compromiso", "cedula", "licencia_conduccion", "contrato_compraventa", "contrato_mandato", "tarjeta_propiedad", "recibo_pago", "otro"];
  const persona = (r: "vendedor" | "comprador"): PersonaBorrador | null => {
    const x = conRol.find((y) => y.rol === r);
    if (!x) return null;
    const por = (orden: ClaseHoja[]) => [...x.g.datos].sort((a, b) => orden.indexOf(a.clase) - orden.indexOf(b.clase));
    // Solo de las hojas de la lista (el nacimiento y la expedición de la cédula salen de la cédula, no de la licencia:
    // la fecha de expedición de la licencia se tomaba como la de la cédula).
    const primero = (orden: ClaseHoja[], f: (p: PersonaLeida) => string) => por(orden).filter((d) => orden.includes(d.clase)).map((d) => f(d.p)).find(Boolean) ?? "";
    const nombres = opcionesDe(por(ORDEN_NOMBRE).map((d) => ({ valor: nombreDe(d.p), fuente: d.fuente })), (a, b) => normalizar(a) === normalizar(b));
    if (nombres.length > 1) diferencias.push({ campo: `${r}.nombre`, etiqueta: `Nombre del ${r}`, opciones: nombres });
    const docs = opcionesDe(por(ORDEN_NOMBRE).map((d) => ({ valor: soloDigitos(d.p.numeroDocumento), fuente: d.fuente })), (a, b) => a === b);
    if (docs.length > 1) diferencias.push({ campo: `${r}.numeroDocumento`, etiqueta: `Documento del ${r}`, opciones: docs });
    const tels = opcionesDe(por(ORDEN_CONTACTO).map((d) => ({ valor: soloDigitos(d.p.telefono), fuente: d.fuente })), (a, b) => a === b);
    if (tels.length > 1) diferencias.push({ campo: `${r}.telefono`, etiqueta: `Teléfono del ${r}`, opciones: tels });
    const dudaDe = (campo: string, op?: { fuentes: string[] }) => !!op && x.g.datos.some((d) => op.fuentes.includes(d.fuente) && (hojas[d.hoja].personas ?? []).some((p, k) => p === d.p && (hojas[d.hoja].dudosos ?? []).some((z) => z === `personas.${k}.${campo}`)));
    if (nombres[0]) anotar(`${r}.nombre`, nombres[0].fuentes);
    if (docs[0]) anotar(`${r}.numeroDocumento`, docs[0].fuentes, dudaDe("numeroDocumento", docs[0]));
    if (tels[0]) anotar(`${r}.telefono`, tels[0].fuentes, dudaDe("telefono", tels[0]));
    return {
      nombre: nombres[0]?.valor ?? "", numeroDocumento: docs[0]?.valor ?? "", telefono: tels[0]?.valor ?? "",
      tipoDocumento: mayus(primero(ORDEN_NOMBRE, (p) => p.tipoDocumento ?? "")) || (docs[0] ? "CC" : ""),
      direccion: mayus(primero(ORDEN_CONTACTO, (p) => p.direccion ?? "")), ciudad: mayus(primero(ORDEN_CONTACTO, (p) => p.ciudad ?? "")),
      fechaNacimiento: primero(["cedula"], (p) => p.fechaNacimiento ?? ""), fechaExpedicionDocumento: primero(["cedula"], (p) => p.fechaExpedicionDocumento ?? ""),
    };
  };
  const vendedor = persona("vendedor");
  const comprador = traspaso ? persona("comprador") : null;
  // Sin traspaso, el "vendedor" es el propietario (el cliente).
  const propietario = vendedor ?? (traspaso ? null : (() => { const x = conRol.find((y) => y.rol === null || y.rol === "comprador"); return x ? (x.rol = "vendedor", persona("vendedor")) : null; })());
  const roles = hojas.map((_, i) => conRol.find((x) => x.g.datos.some((d) => d.hoja === i && (d.clase === "cedula" || d.clase === "licencia_conduccion")))?.rol ?? null);
  const otros = conRol.filter((x) => !x.rol && x.g.roles.some((r) => r.rol === "otro")).map((x) => nombreDe(x.g.datos[0].p));

  // ── Organismo, valor, notas ──
  const orgLeidos = opcionesDe(hojas.map((h, i) => ({ valor: mayus(h.organismo), fuente: nombreHoja(i) })), (a, b) => organismoDeTexto(cat.organismos, a)?.id === organismoDeTexto(cat.organismos, b)?.id && !!organismoDeTexto(cat.organismos, a));
  const orgs = orgLeidos.map((o) => ({ ...o, org: organismoDeTexto(cat.organismos, o.valor) }));
  const delMensaje = dt.organismo ? cat.organismos.find((o) => o.id === dt.organismo!.id) ?? null : null;
  const organismo = delMensaje ?? orgs.find((o) => o.org)?.org ?? null;
  if (delMensaje) {
    anotar("organismo", [DE_MENSAJE]);
    const otros = orgs.filter((o) => o.org && o.org.id !== delMensaje.id);
    if (otros.length) diferencias.push({ campo: "organismo", etiqueta: "Organismo de tránsito", opciones: [{ valor: delMensaje.id, fuentes: [DE_MENSAJE] }, ...otros.map((o) => ({ valor: o.org!.id, fuentes: o.fuentes }))] });
  } else if (orgs.filter((o) => o.org).length > 1) diferencias.push({ campo: "organismo", etiqueta: "Organismo de tránsito", opciones: orgs.filter((o) => o.org).map((o) => ({ valor: o.org!.id, fuentes: o.fuentes })) });
  if (!organismo && orgLeidos.length && !delMensaje) avisos.push(`Se leyó el organismo «${orgLeidos[0].valor}», que no está en la lista: elíjalo.`);
  const valores = opcionesDe([...(dt.valor ? [{ valor: dt.valor, fuente: DE_MENSAJE }] : []), ...hojas.filter((h) => h.clase === "nota").map((h, i) => ({ valor: soloDigitos(h.valor), fuente: `nota${i ? ` ${i + 1}` : ""}` }))], (a, b) => a === b);
  if (valores.length > 1) diferencias.push({ campo: "valor", etiqueta: "Valor cobrado", opciones: valores });
  if (valores[0]) anotar("valor", valores[0].fuentes, hojas.some((h) => h.clase === "nota" && (h.dudosos ?? []).includes("valor")));
  const precio = hojas.map((h) => soloDigitos(h.precio)).find(Boolean) ?? "";
  const notas = [...new Set(hojas.map((h) => (h.notas ?? "").trim()).filter(Boolean))];
  const observaciones = [dt.nota ? `Mensaje: «${dt.nota}»` : "", ...notas, otros.length ? `En la nota también: ${otros.join(", ")}.` : ""].filter(Boolean).join(" · ");

  // ── Licencia: categorías ──
  const textoCategorias = hojas.filter((h) => ["licencia_conduccion", "recibo_pago", "nota"].includes(h.clase)).flatMap((h) => [...(h.tramites ?? []), h.notas ?? ""]).join(" ").toUpperCase();
  const categorias = licencia ? CATEGORIAS_LICENCIA.filter((c) => new RegExp(`\\b${c}\\b`).test(textoCategorias) || dt.categorias.includes(c)) : [];
  if (licencia && dt.categorias.length) anotar("categorias", [DE_MENSAJE]);
  const pistaCategoria = licencia && !categorias.length ? (/\bMOTO/.test(textoCategorias) ? "moto" : /\b(CARRO|AUTOMOVIL|AUTOMÓVIL|PARTICULAR)\b/.test(textoCategorias) ? "carro" : dt.pista) : "";
  if (licencia && !categorias.length) avisos.push(pistaCategoria === "moto" ? "Dice moto pero no la categoría: elija A1 o A2." : pistaCategoria === "carro" ? "Dice carro pero no la categoría: elija B1, C1..." : pistaCategoria === "publico" ? "Dice servicio público pero no la categoría: elija C1, C2 o C3." : "Ni las hojas ni el mensaje dicen la categoría de la licencia: elíjala.");

  // El titular (o el propietario): lo que el mensaje trae y las hojas no (teléfono, cédula, nacimiento). Si el mensaje
  // dice otro teléfono que las hojas, se elige.
  let titular = propietario;
  if (!traspaso && (dt.telefono || dt.cedula || dt.nacimiento)) {
    titular = titular ? { ...titular } : licencia ? { nombre: "", tipoDocumento: "CC", numeroDocumento: "", telefono: "", direccion: "", ciudad: "", fechaNacimiento: "", fechaExpedicionDocumento: "" } : null;
    if (titular) {
      if (dt.telefono && !titular.telefono) { titular.telefono = dt.telefono; anotar("vendedor.telefono", [DE_MENSAJE]); }
      else if (dt.telefono && titular.telefono !== dt.telefono) {
        const previa = diferencias.find((x) => x.campo === "vendedor.telefono");
        if (previa) previa.opciones.unshift({ valor: dt.telefono, fuentes: [DE_MENSAJE] });
        else diferencias.push({ campo: "vendedor.telefono", etiqueta: `Teléfono del ${licencia ? "titular" : "propietario"}`, opciones: [{ valor: dt.telefono, fuentes: [DE_MENSAJE] }, { valor: titular.telefono, fuentes: fuentes["vendedor.telefono"] ?? ["hojas"] }] });
        titular.telefono = dt.telefono;
      }
      if (dt.cedula && !titular.numeroDocumento) { titular.numeroDocumento = dt.cedula; titular.tipoDocumento ||= "CC"; anotar("vendedor.numeroDocumento", [DE_MENSAJE]); }
      if (dt.nacimiento && !titular.fechaNacimiento) { titular.fechaNacimiento = dt.nacimiento; anotar("vendedor.fechaNacimiento", [DE_MENSAJE]); }
    }
  } else if (traspaso && dt.telefono) avisos.push(`Su mensaje trae el teléfono ${dt.telefono}: póngalo en quien corresponda (vendedor o comprador).`);
  if (dt.abono && !dt.valor && !valores.length) avisos.push("Dijo cuánto abonó pero no cuánto se cobra: escriba el valor.");
  if (licencia && titular && !titular.fechaNacimiento) avisos.push("Falta la fecha de nacimiento del titular (con ella se calcula el vencimiento): escríbala, salvo que ya la tenga en la base.");

  if (!vehiculo.placa && !licencia) avisos.push("Ninguna hoja trae la placa: escríbala.");
  if (!tipoIds.length) avisos.push("No se sabe qué trámite es: elíjalo.");
  if (traspaso && !comprador) avisos.push("Es un traspaso y no hay comprador: complételo.");

  return {
    tipoIds, organismoId: organismo?.id ?? "", organismoLeido: orgLeidos[0]?.valor ?? "",
    vehiculo, vendedor: titular, comprador, cliente: traspaso && comprador ? "comprador" : "vendedor",
    valor: valores[0]?.valor ?? "", precioVenta: precio, observaciones, abono: dt.abono, metodoAbono: dt.metodoAbono, conClases: dt.clases, roles, diferencias, avisos, fuentes, revisar: [...revisar],
    categorias: categorias.join(","), pistaCategoria,
  };
}
