/*
 * Precios y tiempos de las licencias de conducción de la oficina (los que dio Felipe, 2026-10-30). Un solo sitio: de
 * aquí salen el cobro sugerido, la cotización del asistente, las plantillas de WhatsApp y las recomendaciones del
 * trámite. Lo que no está aquí (otras categorías, C2 con clases, la migración) no tiene precio: se pregunta.
 */
import { normalizar } from "./dominio";

export interface CursoLicencia {
  /** Las categorías, en orden ("A2", "A2+B1"). */
  clave: string;
  /** Como se dice en la oficina ("B1 + A2"). */
  etiqueta: string;
  nombre: string;
  sinClases: number;
  conClases: number;
  horasTeoricas: number;
  horasPracticas: number;
  /** La disponibilidad que se le recomienda a la persona (días hábiles, aproximados). */
  tiempo: string;
}

/** Primera vez (expedición), por categorías. */
export const CURSOS_LICENCIA: CursoLicencia[] = [
  { clave: "A2", etiqueta: "A2", nombre: "A2 (moto)", sinClases: 1_200_000, conClases: 1_300_000, horasTeoricas: 28, horasPracticas: 14, tiempo: "unas 2 semanas (unos 10 días hábiles)" },
  { clave: "B1", etiqueta: "B1", nombre: "B1 (carro particular)", sinClases: 1_400_000, conClases: 1_650_000, horasTeoricas: 30, horasPracticas: 20, tiempo: "unas 3 semanas (unos 15 días hábiles)" },
  { clave: "C1", etiqueta: "C1", nombre: "C1 (carro de servicio público)", sinClases: 1_600_000, conClases: 1_800_000, horasTeoricas: 35, horasPracticas: 35, tiempo: "unos 25 días hábiles (unas 5 semanas)" },
  { clave: "A2+B1", etiqueta: "B1 + A2", nombre: "B1 + A2 (carro particular y moto)", sinClases: 2_200_000, conClases: 2_600_000, horasTeoricas: 35, horasPracticas: 35, tiempo: "unos 25 días hábiles (unas 5 semanas)" },
  { clave: "A2+C1", etiqueta: "C1 + A2", nombre: "C1 + A2 (carro de servicio público y moto)", sinClases: 2_400_000, conClases: 2_700_000, horasTeoricas: 35, horasPracticas: 35, tiempo: "unos 25 días hábiles (unas 5 semanas)" },
];

/** Recategorización a C2: solo hay precio sin clases (casi todos ya saben manejar). */
export const RECATEGORIZACION_C2 = { sinClases: 1_800_000, tiempo: "1 semana entre teoría y práctica" };
/** Refrendación (renovación), todo incluido; se entrega en unas dos horas. */
export const REFRENDACION = { sencilla: 100_000, doble: 100_000, tiempo: "se entrega en unas dos horas" };
export const DUPLICADO_LICENCIA = 100_000;

export const HORAS_POR_DIA = "las teóricas, de 2 a 8 horas al día; las prácticas, de 2 a 9 horas al día (según la academia)";
/** Lo que piden todos los trámites de licencia. */
export const REQUISITOS_LICENCIA = [
  "Estar sin comparendos (a paz y salvo en el SIMIT).",
  "Traer la cédula original.",
  "La fotocopia de la cédula: va adjunta en todos los trámites de licencia.",
  "Si no trae foto 3x4 fondo blanco, se la tomamos en la oficina.",
];

const pesos = (v: number) => `$${v.toLocaleString("es-CO")}`;
const ORDEN = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"];
const claveDe = (categorias: string[]) => [...new Set(categorias.map((c) => c.toUpperCase()))].sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b)).join("+");

export type ClaseTramiteLicencia = "expedicion" | "renovacion" | "recategorizacion" | "duplicado" | "migracion" | null;
export function claseLicencia(nombreTipo: string): ClaseTramiteLicencia {
  const n = normalizar(nombreTipo);
  return /expedici/.test(n) ? "expedicion" : /renovaci|refrend/.test(n) ? "renovacion" : /recategoriz/.test(n) ? "recategorizacion" : /duplicad/.test(n) ? "duplicado" : /migraci/.test(n) ? "migracion" : null;
}

export interface PrecioLicencia {
  /** El valor a cobrar, o null si falta un dato (con clases o sin clases) o esa combinación no tiene precio. */
  valor: number | null;
  /** Para la línea del cobro: "Licencia B1 con clases (primera vez)". */
  concepto: string;
  /** Qué falta o por qué no hay precio, dicho para Felipe. */
  aviso?: string;
  /** Las horas y el tiempo, para decírselo a la persona. */
  detalle?: string;
}

/**
 * El precio de un trámite de licencia por sus categorías (y, en la primera vez, con o sin clases). undefined si ese
 * trámite no tiene precios aquí (la migración): se cobra como siempre.
 */
export function precioLicencia(nombreTipo: string, categorias: string[], conClases: boolean | null | undefined): PrecioLicencia | undefined {
  const clase = claseLicencia(nombreTipo);
  const clave = claveDe(categorias);
  const cats = clave.replace(/\+/g, " + ") || "sin categorías";
  if (clase === "duplicado") return { valor: DUPLICADO_LICENCIA, concepto: "Duplicado de licencia de conducción" };
  if (clase === "renovacion") {
    const n = categorias.length;
    if (!n) return { valor: null, concepto: "Refrendación de licencia", aviso: `Faltan las categorías: sencilla ${pesos(REFRENDACION.sencilla)}, doble ${pesos(REFRENDACION.doble)}.` };
    if (n > 2) return { valor: null, concepto: `Refrendación ${cats}`, aviso: `No hay precio de refrendación de ${n} categorías (la doble vale ${pesos(REFRENDACION.doble)}): póngalo en el cobro.` };
    return { valor: n === 1 ? REFRENDACION.sencilla : REFRENDACION.doble, concepto: `Refrendación ${n === 1 ? "sencilla" : "doble"} ${cats} (todo incluido)`, detalle: `Refrendación: ${REFRENDACION.tiempo}.` };
  }
  if (clase === "recategorizacion") {
    if (categorias.map((c) => c.toUpperCase()).includes("C2") && categorias.every((c) => /^(B1|C1|C2)$/i.test(c))) {
      return { valor: RECATEGORIZACION_C2.sinClases, concepto: "Recategorización a C2 (sin clases)", detalle: `Recategorización a C2: ${RECATEGORIZACION_C2.tiempo}.` };
    }
    return { valor: null, concepto: `Recategorización ${cats}`, aviso: `No hay precio de recategorización ${cats} (solo de C2 sin clases, ${pesos(RECATEGORIZACION_C2.sinClases)}): póngalo en el cobro.` };
  }
  if (clase === "expedicion") {
    const curso = CURSOS_LICENCIA.find((c) => c.clave === clave);
    if (!curso) return { valor: null, concepto: `Licencia ${cats} (primera vez)`, aviso: `No hay precio de licencia ${cats} por primera vez (hay de ${CURSOS_LICENCIA.map((c) => c.etiqueta).join(", ")}): póngalo en el cobro.` };
    const detalle = `${curso.horasTeoricas} horas teóricas y ${curso.horasPracticas} prácticas (obligatorias); disponibilidad recomendada: ${curso.tiempo}.`;
    if (typeof conClases !== "boolean") return { valor: null, concepto: `Licencia ${curso.etiqueta} (primera vez)`, aviso: `Falta decir si es con clases (${pesos(curso.conClases)}) o sin clases (${pesos(curso.sinClases)}).`, detalle };
    return { valor: conClases ? curso.conClases : curso.sinClases, concepto: `Licencia ${curso.etiqueta} ${conClases ? "con" : "sin"} clases (primera vez)`, detalle };
  }
  return undefined;
}

/** La tabla en texto, para el asistente (se la sabe de memoria y la usa al cotizar y al sugerir el cobro). */
export function tablaPreciosLicencia() {
  return [
    "PRECIOS DE LICENCIAS DE CONDUCCIÓN, el pase de la persona; NO la licencia de tránsito del vehículo (de la oficina; el cobro sugerido y requisitos_y_costos ya los traen):",
    ...CURSOS_LICENCIA.map((c) => `  Primera vez ${c.nombre}: sin clases ${pesos(c.sinClases)}, con clases ${pesos(c.conClases)}; ${c.horasTeoricas} h teóricas y ${c.horasPracticas} h prácticas; ${c.tiempo}.`),
    `  Recategorización a C2: ${pesos(RECATEGORIZACION_C2.sinClases)} sin clases (con clases no hay precio); ${RECATEGORIZACION_C2.tiempo}.`,
    `  Refrendación (renovación) sencilla ${pesos(REFRENDACION.sencilla)}, doble ${pesos(REFRENDACION.doble)}, todo incluido; ${REFRENDACION.tiempo}.`,
    `  Duplicado de licencia de conducción: ${pesos(DUPLICADO_LICENCIA)}; trae la cédula original. (El duplicado de la licencia de tránsito del vehículo es otro trámite, con su tarifa.)`,
    `  Horas por día: ${HORAS_POR_DIA}. Cumplir las horas es obligatorio. Los tiempos son aproximados, en días hábiles.`,
    `  Requisitos de todo trámite de licencia: ${REQUISITOS_LICENCIA.join(" ")}`,
    "  Sin precio (pregúntale a Felipe, no lo inventes): otras categorías o combinaciones (A1, B2, B3, C3...), C2 con clases, otras recategorizaciones y la migración.",
  ].join("\n");
}

// ─── Plantillas de WhatsApp ──────────────────────────────────────────────────

/** `sub`: la licencia dentro del grupo (sus mensajes general, sin clases y con clases van juntos). */
export interface PlantillaWhatsApp { id: string; grupo: string; sub?: string; titulo: string; texto: string }

const PIE = "El cumplimiento de las horas es totalmente obligatorio. Requisitos: estar sin comparendos, traer la cédula original y una fotocopia; si no tiene foto 3x4 fondo blanco, se la tomamos aquí.\n\nQuedamos muy atentos.";

/** Los mensajes listos para copiar (cortos y cordiales), con los precios de la tabla. Felipe los edita en Más > Plantillas de mensajes. */
export function plantillasLicencia(): PlantillaWhatsApp[] {
  const REQUISITOS = "Requisitos: estar sin comparendos, traer la cédula original y una fotocopia; si no tiene foto 3x4 fondo blanco, se la tomamos aquí.\n\nQuedamos muy atentos.";
  // Por licencia, tres mensajes: el general (los dos precios), el de sin clases y el de con clases.
  const primeraVez = (c: CursoLicencia): PlantillaWhatsApp[] => {
    const base = { grupo: c.clave.includes("+") ? "Combos" : "Licencia por primera vez", sub: `Licencia ${c.etiqueta}` };
    const id = `licencia_${c.clave.replace("+", "_").toLowerCase()}`;
    const horas = `• Horas: ${c.horasTeoricas} teóricas y ${c.horasPracticas} prácticas\n• Disponibilidad recomendada: ${c.tiempo}, aproximadamente`;
    const una = (modo: string, valor: number): string => `Le comparto la información de la licencia ${c.nombre}, por primera vez, ${modo}:\n\n• Valor: ${pesos(valor)}\n${horas}\n\n${PIE}`;
    return [
      { ...base, id, titulo: `Licencia ${c.etiqueta}: general`, texto: `Le comparto la información de la licencia ${c.nombre}, por primera vez:\n\n• Sin clases: ${pesos(c.sinClases)}\n• Con clases: ${pesos(c.conClases)}\n${horas}\n\n${PIE}` },
      { ...base, id: `${id}_sin_clases`, titulo: `Licencia ${c.etiqueta}: sin clases`, texto: una("sin clases", c.sinClases) },
      { ...base, id: `${id}_con_clases`, titulo: `Licencia ${c.etiqueta}: con clases`, texto: una("con clases", c.conClases) },
    ];
  };
  return [
    ...CURSOS_LICENCIA.filter((c) => !c.clave.includes("+")).flatMap(primeraVez),
    ...CURSOS_LICENCIA.filter((c) => c.clave.includes("+")).flatMap(primeraVez),
    {
      id: "refrendacion", grupo: "Refrendación", titulo: "Refrendación: general",
      texto: `Le comparto el valor de la refrendación de la licencia, con todo incluido:\n\n• Sencilla (una categoría): ${pesos(REFRENDACION.sencilla)}\n• Doble (dos categorías): ${pesos(REFRENDACION.doble)}\n• Se entrega en unas dos horas\n\n${REQUISITOS}`,
    },
    {
      id: "refrendacion_sencilla", grupo: "Refrendación", titulo: "Refrendación sencilla",
      texto: `Le comparto el valor de la refrendación sencilla de la licencia (una categoría), con todo incluido:\n\n• Valor: ${pesos(REFRENDACION.sencilla)}\n• Se entrega en unas dos horas\n\n${REQUISITOS}`,
    },
    {
      id: "refrendacion_doble", grupo: "Refrendación", titulo: "Refrendación doble",
      texto: `Le comparto el valor de la refrendación doble de la licencia (dos categorías), con todo incluido:\n\n• Valor: ${pesos(REFRENDACION.doble)}\n• Se entrega en unas dos horas\n\n${REQUISITOS}`,
    },
    {
      id: "recategorizacion_c2", grupo: "Recategorización", titulo: "Recategorización a C2",
      texto: `Le comparto la información de la recategorización a C2:\n\n• Valor (sin clases): ${pesos(RECATEGORIZACION_C2.sinClases)}\n• Tiempo: ${RECATEGORIZACION_C2.tiempo}, aproximadamente\n\n${PIE}`,
    },
    {
      id: "duplicado_licencia", grupo: "Duplicado", titulo: "Duplicado de licencia de conducción",
      texto: `El duplicado de la licencia de conducción tiene un valor de ${pesos(DUPLICADO_LICENCIA)}.\n\n${REQUISITOS}`,
    },
    {
      id: "horas_licencia", grupo: "Información general", titulo: "Horas por día y disponibilidad",
      texto: `Le cuento cómo funcionan las horas del curso: ${HORAS_POR_DIA}. Por eso recomendamos tener disponibilidad de varios días hábiles; los tiempos son aproximados.\n\nEl cumplimiento de las horas es totalmente obligatorio.\n\nQuedamos muy atentos.`,
    },
    {
      id: "requisitos_licencia", grupo: "Información general", titulo: "Requisitos de los trámites de licencia",
      texto: `Estos son los requisitos para el trámite de la licencia:\n\n• Estar sin comparendos\n• Cédula original\n• Fotocopia de la cédula\n• Foto 3x4 fondo blanco (si no la tiene, se la tomamos aquí)\n\nQuedamos muy atentos.`,
    },
  ];
}
