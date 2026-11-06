/*
 * Pantallas de apoyo.
 *   POST/PATCH/DELETE /api/recordatorios[/:id]     citas, llamadas y recordatorios
 *   PATCH             /api/licencias/:id           seguimiento del radar (estado de la llamada y nota)
 *   GET               /api/avaluos?q=&modelo=      base gravable: líneas parecidas y su avalúo para el año modelo
 *   (cron diario)     revisarVencimientos          crea recordatorios de SOAT, RTM, impuesto y licencias por vencer
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { ESTADOS_GESTION_LICENCIA, ESTADOS_RECORDATORIO, normalizar, TIPOS_RECORDATORIO } from "../../compartido/dominio";
import * as E from "../../compartido/esquema";
import { edadEn, hoyColombia, sumarDias, vigenciaLicenciaAnios } from "../../compartido/reglas";
import { ErrorApi, json } from "../http";
import { enLista, fecha, nuevoId, origen, texto, textoObligatorio, type Datos, type Db } from "../util";

// ─── Recordatorios ───────────────────────────────────────────────────────────

function camposRecordatorio(d: Datos, nuevo: boolean) {
  const c: Partial<typeof E.recordatorios.$inferInsert> = {};
  if (nuevo || "titulo" in d) c.titulo = textoObligatorio(d.titulo, "qué hay que hacer", 300);
  if (nuevo || "fecha" in d) {
    const f = fecha(d.fecha, "recordatorio");
    if (!f) throw new ErrorApi("Falta la fecha.");
    c.fecha = f;
  }
  if ("hora" in d) {
    const h = texto(d.hora, 5);
    if (h && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) throw new ErrorApi("La hora no es válida (HH:MM).");
    c.hora = h;
  }
  if (nuevo || "tipo" in d) c.tipo = d.tipo ? enLista(d.tipo, TIPOS_RECORDATORIO, "tipo") : "recordatorio";
  if ("estado" in d) c.estado = enLista(d.estado, ESTADOS_RECORDATORIO, "estado");
  if ("clienteId" in d) c.clienteId = texto(d.clienteId, 64);
  if ("tramiteId" in d) c.tramiteId = texto(d.tramiteId, 64);
  if ("notas" in d) c.notas = texto(d.notas, 2000);
  if (nuevo) c.origen = origen(d.origen);
  return c;
}

export async function crearRecordatorio(db: Db, d: Datos) {
  const id = nuevoId();
  await db.insert(E.recordatorios).values({ ...(camposRecordatorio(d, true) as typeof E.recordatorios.$inferInsert), id }).run();
  return json({ id });
}
export async function editarRecordatorio(db: Db, id: string, d: Datos) {
  const r = await db.update(E.recordatorios).set(camposRecordatorio(d, false)).where(eq(E.recordatorios.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("El recordatorio no existe.", 404);
  return json({ id });
}
export async function borrarRecordatorio(db: Db, id: string) {
  const r = await db.delete(E.recordatorios).where(eq(E.recordatorios.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("El recordatorio no existe.", 404);
  return json({ ok: true });
}

// ─── Radar de licencias ──────────────────────────────────────────────────────

export async function seguimientoLicencia(db: Db, id: string, d: Datos) {
  const c: Partial<typeof E.licencias.$inferInsert> = { gestionFecha: hoyColombia() };
  if ("gestionEstado" in d) c.gestionEstado = enLista(d.gestionEstado, ESTADOS_GESTION_LICENCIA, "seguimiento");
  if ("gestionNota" in d) c.gestionNota = texto(d.gestionNota, 1000);
  if ("fechaVencimiento" in d) {
    const f = fecha(d.fechaVencimiento, "vencimiento");
    if (!f) throw new ErrorApi("Falta la fecha de vencimiento.");
    c.fechaVencimiento = f;
  }
  const r = await db.update(E.licencias).set(c).where(eq(E.licencias.id, id)).run();
  if (!r.meta.changes) throw new ErrorApi("La licencia no existe.", 404);
  return json({ id });
}

// ─── Avalúos (base gravable) ─────────────────────────────────────────────────

/** Avalúo en pesos para un año modelo (la tabla está en miles; "2001" = "2001 y anteriores"). */
export function avaluoParaModelo(valores: Record<string, number>, modelo: number): { valor: number; anioUsado: number } | null {
  const anios = Object.keys(valores).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!anios.length) return null;
  const usado = anios.includes(modelo) ? modelo : modelo <= anios[0] ? anios[0] : modelo >= anios[anios.length - 1] ? anios[anios.length - 1] : [...anios].reverse().find((a) => a <= modelo) ?? anios[0];
  return { valor: valores[String(usado)] * 1000, anioUsado: usado };
}

/** Las palabras para comparar nombres de línea, con letras y cifras pegadas separadas ("NS160" = "NS 160"). */
const piezas = (s: string) => normalizar(s).replace(/([a-z])(\d)|(\d)([a-z])/g, (_, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`)).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Avalúo (base gravable del último año fiscal cargado) para una marca, línea y modelo. Devuelve la línea más parecida
 * y hasta 6 alternativas, para decir cuál se usó; si otra encaja igual de bien con otro valor, la marca en `dudosas`
 * (para confirmarlo en el SIBGA antes de cobrar). `perfecta`: la línea y el cilindraje son los de la tarjeta (si no, se
 * pregunta "¿es esa?"). Si ninguna línea trae las palabras de la tarjeta, la más parecida de la misma marca y motor va
 * como `sugerida` (no se cobra sola: se confirma).
 */
export async function avaluoDe(db: Db, marca: string, linea: string, modelo: number | null, cilindraje?: number | null) {
  // Las palabras sin signos: la tarjeta dice "ABC123-6 (FZ-S)" y la tabla "ABC123 FZS"; con el guion y el paréntesis
  // pegados no se encontraba nada. Una cifra sola sí cuenta (MAZDA 3 no es cualquier MAZDA). Sin repetir: "ABC123-2
  // (ABC123)" busca ABC123 una vez.
  const palabras = [...new Set(normalizar(`${marca} ${linea}`).split(/[^a-z0-9]+/).filter((p) => p.length >= 2 || /^\d$/.test(p)))].slice(0, 6);
  // Todas las palabras de la tarjeta (sin el tope de 6 de la búsqueda), para ver qué tan igual es cada línea.
  const dichas = new Set(piezas(`${marca} ${linea}`)), deMarca = new Set(piezas(marca));
  if (!palabras.length || !modelo) return null;
  const ultimo = (await db.select({ a: sql<number>`max(${E.avaluos.anioFiscal})` }).from(E.avaluos).get())?.a;
  if (!ultimo) return null;
  // La tabla separa versiones por cilindraje (Logan 1400 y 1600 valen distinto) y lo redondea (1598 -> 1600):
  // con cilindraje se toma la versión más cercana; sin él, la de línea más corta (la base).
  const cil = (f: { cilindraje: string | null }) => Number(String(f.cilindraje ?? "").replace(/\D/g, "")) || null;
  const nombre = (f: { marca: string; linea: string; cilindraje: string | null }) => `${f.marca} ${f.linea}${f.cilindraje ? ` ${f.cilindraje}` : ""}`;
  // Primero con todas las palabras; si no hay, se suelta la última (líneas escritas distinto en la tarjeta).
  for (let n = palabras.length; n >= Math.min(2, palabras.length); n--) {
    const filas = await db.select().from(E.avaluos)
      // También sin guiones ni espacios en la tabla: "ABC123" en la tarjeta es "ABC123-A" en la tabla y "ABC123",
      // "ABC123".
      .where(and(eq(E.avaluos.anioFiscal, ultimo), ...palabras.slice(0, n).map((p) => sql`(${E.avaluos.busqueda} LIKE ${`%${p}%`} OR replace(replace(${E.avaluos.busqueda}, '-', ''), ' ', '') LIKE ${`%${p}%`})`)))
      .orderBy(asc(sql`length(${E.avaluos.linea})`)).limit(60);
    // Los números van como número entero, no como pedazo ("CB 110" no es "CBR 1100"); y con cilindraje no sirve una
    // versión de motor muy distinto (más de un 30 %).
    const numeros = palabras.slice(0, n).filter((p) => /^\d+$/.test(p));
    const sirven = filas.filter((f) => numeros.every((num) => new RegExp(`(^|\\D)${num}(\\D|$)`).test(f.busqueda ?? ""))
      && (!cilindraje || !cil(f) || Math.abs(cil(f)! - cilindraje) <= cilindraje * 0.3));
    // Cilindrajes a menos de 10 cc son el mismo motor (la tabla redondea: 1598 y 1600). Entre esos, primero la línea
    // base estándar (cuando la tarjeta no dice la versión, es esa: Stepway 2015 = la base, no la "1.6L MT").
    const cerca = (f: { cilindraje: string | null }) => (cilindraje && cil(f) ? Math.max(0, Math.abs(cil(f)! - cilindraje) - 10) : 0);
    const esBase = (f: { linea: string }) => (/\bBASE\b|\bESTANDAR\b|\bSTANDARD\b/i.test(normalizar(f.linea).toUpperCase()) ? 0 : 1);
    // Después, el cilindraje idéntico al de la tarjeta (PULSAR NS 200 FI es de 199 cc y la 200 NS FI UG de 200: la
    // tarjeta de 200 cc es la UG, como dice el SIBGA) y la línea con menos palabras distintas a las de la tarjeta
    // (que sobren o falten: A4 2.0 TFSI QUATTRO no es la A4 2.0 TFSI). Por último, la de nombre más corto.
    const exacto = (f: { cilindraje: string | null }) => (cilindraje && cil(f) === cilindraje ? 0 : 1);
    const distintas = (f: { marca: string; linea: string }) => {
      const suyas = new Set(piezas(`${f.marca} ${f.linea}`));
      let n = 0;
      for (const w of suyas) if (!dichas.has(w) && !deMarca.has(w)) n++;
      for (const w of dichas) if (!suyas.has(w)) n++;
      return n;
    };
    const orden = [...sirven].sort((a, b) => cerca(a) - cerca(b) || esBase(a) - esBase(b) || exacto(a) - exacto(b) || distintas(a) - distintas(b) || a.linea.length - b.linea.length);
    const con = orden.slice(0, 7).map((f) => ({ f, v: avaluoParaModelo(f.valoresMiles, modelo) })).filter((x) => x.v);
    if (con.length) {
      const [mejor, ...otras] = con;
      // Si la elegida no es idéntica (nombre y cilindraje) y otra igual de cercana vale distinto (más de un 5 %), no hay
      // cómo saber cuál es con lo que dice la tarjeta: se avisa con su valor.
      const perfecta = distintas(mejor.f) === 0 && (!cilindraje || exacto(mejor.f) === 0);
      const dudosas = perfecta ? [] : otras.filter((x) => cerca(x.f) === cerca(mejor.f) && esBase(x.f) === esBase(mejor.f) && Math.abs(x.v!.valor - mejor.v!.valor) > mejor.v!.valor * 0.05).slice(0, 2);
      return {
        anioFiscal: ultimo, valor: mejor.v!.valor, anioModeloUsado: mejor.v!.anioUsado,
        linea: nombre(mejor.f), perfecta, sugerida: false,
        alternativas: otras.map((x) => ({ linea: nombre(x.f), valor: x.v!.valor })),
        dudosas: dudosas.map((x) => ({ linea: nombre(x.f), valor: x.v!.valor })),
      };
    }
  }
  // Ninguna línea con esas palabras: la más parecida de la misma marca (las palabras de la tarjeta que tiene) y con el
  // motor parecido (a un 20 % del cilindraje). Va como sugerencia, para decir sí o no.
  const marcaClave = palabras[0];
  const filas = await db.select().from(E.avaluos).where(and(eq(E.avaluos.anioFiscal, ultimo), sql`${E.avaluos.busqueda} LIKE ${`%${marcaClave}%`}`)).limit(4000);
  const parecido = (f: { marca: string; linea: string }) => piezas(`${f.marca} ${f.linea}`).filter((w) => dichas.has(w) && !deMarca.has(w)).length;
  const candidatas = filas.filter((f) => normalizar(f.marca).includes(marcaClave) && (!cilindraje || (cil(f) !== null && Math.abs(cil(f)! - cilindraje) <= cilindraje * 0.2)))
    .sort((a, b) => parecido(b) - parecido(a) || Math.abs((cil(a) ?? 0) - (cilindraje ?? 0)) - Math.abs((cil(b) ?? 0) - (cilindraje ?? 0)) || a.linea.length - b.linea.length);
  // Sin cilindraje ni una palabra en común, no hay de dónde sugerir.
  const utiles = candidatas.filter((f) => cilindraje || parecido(f) > 0).slice(0, 4).map((f) => ({ f, v: avaluoParaModelo(f.valoresMiles, modelo) })).filter((x) => x.v);
  if (!utiles.length) return null;
  const [mejor, ...otras] = utiles;
  return {
    anioFiscal: ultimo, valor: mejor.v!.valor, anioModeloUsado: mejor.v!.anioUsado, linea: nombre(mejor.f), perfecta: false, sugerida: true,
    alternativas: otras.map((x) => ({ linea: nombre(x.f), valor: x.v!.valor })), dudosas: [] as { linea: string; valor: number }[],
  };
}

export async function buscarAvaluos(db: Db, url: URL) {
  const palabras = normalizar(url.searchParams.get("q") ?? "").split(" ").filter((p) => p.length >= 2).slice(0, 5);
  const modelo = Number(url.searchParams.get("modelo")) || null;
  if (!palabras.length) throw new ErrorApi("Escriba la marca y la línea.");
  const ultimo = (await db.select({ a: sql<number>`max(${E.avaluos.anioFiscal})` }).from(E.avaluos).get())?.a;
  if (!ultimo) throw new ErrorApi("La base gravable no está cargada.", 404);
  const condiciones = palabras.map((p) => sql`${E.avaluos.busqueda} LIKE ${`%${p}%`}`);
  const filas = await db
    .select()
    .from(E.avaluos)
    .where(and(eq(E.avaluos.anioFiscal, ultimo), ...condiciones))
    .orderBy(asc(sql`length(${E.avaluos.linea})`))
    .limit(12);
  return json({
    anioFiscal: ultimo,
    resultados: filas.map((f) => ({
      id: f.id, tipo: f.tipo, clase: f.clase, marca: f.marca, linea: f.linea, cilindraje: f.cilindraje,
      ...(modelo ? avaluoParaModelo(f.valoresMiles, modelo) : {}),
    })),
  });
}

// ─── Aviso diario: vencimientos -> recordatorios ─────────────────────────────

const DIAS_VEHICULO = 15;
const DIAS_LICENCIA = 45;

/**
 * Corre una vez al día (cron). Crea un recordatorio por cada SOAT, técnico-mecánica o impuesto que vence en
 * los próximos días, y una llamada por cada licencia que vence pronto. El id incluye la fecha de vencimiento,
 * así que nunca se repite aunque corra varias veces; si se renueva y cambia la fecha, se avisa de nuevo a su tiempo.
 */
export async function revisarVencimientos(db: Db) {
  const hoy = hoyColombia();
  const hastaV = sumarDias(hoy, DIAS_VEHICULO);
  const hastaL = sumarDias(hoy, DIAS_LICENCIA);
  const vehiculos = await db
    .select({ id: E.vehiculos.id, placa: E.vehiculos.placa, titularId: E.vehiculos.titularId, soat: E.vehiculos.soatVence, rtm: E.vehiculos.rtmVence, impuesto: E.vehiculos.impuestoAlDiaHasta })
    .from(E.vehiculos)
    .where(sql`(${E.vehiculos.soatVence} BETWEEN ${hoy} AND ${hastaV}) OR (${E.vehiculos.rtmVence} BETWEEN ${hoy} AND ${hastaV}) OR (${E.vehiculos.impuestoAlDiaHasta} BETWEEN ${hoy} AND ${hastaV})`);
  const licencias = await db
    .select({ id: E.licencias.id, clienteId: E.licencias.clienteId, categoria: E.licencias.categoria, vence: E.licencias.fechaVencimiento, origen: E.licencias.origen, nombre: E.clientes.nombre, nacimiento: E.clientes.fechaNacimiento })
    .from(E.licencias)
    .innerJoin(E.clientes, eq(E.clientes.id, E.licencias.clienteId))
    .where(and(sql`${E.licencias.fechaVencimiento} BETWEEN ${hoy} AND ${hastaL}`, sql`${E.licencias.gestionEstado} NOT IN ('descartado', 'agendado')`));

  const nuevos: (typeof E.recordatorios.$inferInsert)[] = [];
  const NOMBRE = { soat: "el SOAT", rtm: "la técnico-mecánica", impuesto: "el impuesto" } as const;
  for (const v of vehiculos) {
    for (const k of ["soat", "rtm", "impuesto"] as const) {
      const f = v[k];
      if (f && f >= hoy && f <= hastaV) nuevos.push({ id: `auto-${k}-${v.id}-${f}`, tipo: "recordatorio", titulo: `Vence ${NOMBRE[k]} de ${v.placa} el ${f}`, fecha: hoy, clienteId: v.titularId, origen: "sistema" });
    }
  }
  for (const l of licencias) {
    // Lo que implica la edad al renovar (art. 197, Decreto 019 de 2012), o que la fecha es estimada si falta el nacimiento.
    const edad = edadEn(l.nacimiento, l.vence);
    const nota = edad != null
      ? ` · al renovar con ${edad} años queda por ${vigenciaLicenciaAnios(l.categoria, edad)} año${vigenciaLicenciaAnios(l.categoria, edad) === 1 ? "" : "s"}`
      : l.origen === "importada" || l.origen === "tramite" ? " · fecha estimada: falta su fecha de nacimiento" : "";
    nuevos.push({ id: `auto-lic-${l.id}-${l.vence}`, tipo: "llamada", titulo: `Llamar a ${l.nombre}: su licencia ${l.categoria} vence el ${l.vence}${nota}`, fecha: hoy, clienteId: l.clienteId, origen: "sistema" });
  }
  for (let i = 0; i < nuevos.length; i += 25) {
    await db.insert(E.recordatorios).values(nuevos.slice(i, i + 25)).onConflictDoNothing().run();
  }
  return { revisados: vehiculos.length + licencias.length, propuestos: nuevos.length };
}
