/*
 * Lo que Felipe escribe al registrar un trámite con fotos ("anótame esta refrendación C2, tel 300 000 0000, le cobro
 * 350, abonó 100 por Nequi, nació el 12/05/83, en Neiva, aún no viene la persona"): los datos que trae, para que el
 * borrador los tenga ya puestos. Código exacto, sin IA, y nada se adivina: lo que no se entiende con seguridad no se
 * toma (la categoría "moto" no es A1 ni A2; un número suelto no es plata). Lo que queda dicho y no es ningún dato
 * (instrucciones, "aún no viene la persona", "examen el lunes") va a las observaciones tal cual lo escribió.
 */
import { normalizar } from "./dominio";

export interface DatosDelTexto {
  /** Celular (10 dígitos, empieza por 3). */
  telefono: string;
  cedula: string;
  /** AAAA-MM-DD. */
  nacimiento: string;
  /** Lo que se cobra en total, en pesos (texto con solo dígitos). */
  valor: string;
  /** Lo que ya pagó (abono), y por dónde si lo dijo. */
  abono: string; metodoAbono: string;
  categorias: string[];
  /** Lo que dice de la clase de vehículo cuando no dice la categoría. */
  pista: "" | "moto" | "carro" | "publico";
  /** Expedición de licencia: "con clases" o "sin clases" (vacío si no lo dice). */
  clases: "" | "con" | "sin";
  /** El organismo nombrado ("en Neiva", "tránsito de Funza"). */
  organismo: { id: string; dicho: string } | null;
  /** El mensaje tal cual, si dice algo más que los datos (para las observaciones). */
  nota: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesDe = (m: string) => (m === "setiembre" ? 9 : MESES.indexOf(m) + 1);
const MES = `(${[...MESES, "setiembre"].join("|")})`;

/** "83" -> 1983, "07" -> 2007 (el año de dos cifras que aún no llega es del siglo pasado). */
function anio(y: string) {
  if (y.length === 4) return Number(y);
  const n = Number(y), ahora = new Date().getFullYear() % 100;
  return n > ahora ? 1900 + n : 2000 + n;
}
function iso(a: number, m: number, d: number) {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || a < 1920 || a > new Date().getFullYear()) return "";
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Una fecha escrita de cualquier forma usual: 12/05/1983, 12-5-83, 1983-05-12, 12 de mayo de 1983, mayo 12 de 1983. */
export function fechaDeTexto(s: string): { fecha: string; texto: string } | null {
  const formas: [RegExp, (m: RegExpExecArray) => string][] = [
    [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => iso(+m[1], +m[2], +m[3])],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, (m) => iso(anio(m[3]), +m[2], +m[1])],
    [new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?${MES}\\s*(?:de(?:l)?\\s+)?(\\d{4}|\\d{2})\\b`), (m) => iso(anio(m[3]), mesDe(m[2]), +m[1])],
    [new RegExp(`\\b${MES}\\s+(\\d{1,2})\\s*(?:de(?:l)?\\s+)?(\\d{4})\\b`), (m) => iso(+m[3], mesDe(m[1]), +m[2])],
  ];
  for (const [re, f] of formas) { const m = re.exec(s); if (m && f(m)) return { fecha: f(m), texto: m[0] }; }
  return null;
}

/** Los números dichos en letras (por voz: "trescientos mil", "dos mil siete", "un millón doscientos mil"). */
const PALABRA_NUMERO: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
  trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};
/**
 * El texto (sin tildes) con los números en letras pasados a cifras: "cobra trescientos mil" -> "cobra 300000". Un
 * "un"/"una" solo no es un número ("una renovación").
 */
export function letrasACifras(texto: string): string {
  return texto.replace(/\b(?:(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinti?\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|quinientos|\w+cientos|mil|millon|millones)(?:\s+y\s+|\s+|\b))+/g, (tramo) => {
    const ws = tramo.trim().split(/\s+/).filter((w) => w !== "y");
    if (!ws.every((w) => w in PALABRA_NUMERO || w === "mil" || w === "millon" || w === "millones")) return tramo;
    // "una" sola no es un número; "mil" o "millones" solos van con una cifra ("350 mil", "1.2 millones"): se dejan.
    if (ws.length === 1 && /^(un|uno|una)$/.test(ws[0])) return tramo;
    if (ws.every((w) => w === "mil" || w === "millon" || w === "millones")) return tramo;
    let total = 0, grupo = 0;
    for (const w of ws) {
      if (w === "mil") { total += (grupo || 1) * 1000; grupo = 0; }
      else if (w === "millon" || w === "millones") { total = (total + (grupo || 1)) * 1_000_000; grupo = 0; }
      else grupo += PALABRA_NUMERO[w];
    }
    return `${total + grupo}${/\s$/.test(tramo) ? " " : ""}`;
  });
}

/** Todas las fechas que trae un texto (AAAA-MM-DD), en orden. */
export function fechasDeTexto(texto: string): string[] {
  const out: string[] = [];
  let resto = letrasACifras(normalizar(texto));
  for (let f = fechaDeTexto(resto); f && out.length < 20; f = fechaDeTexto(resto)) { out.push(f.fecha); resto = resto.replace(f.texto, " "); }
  return out;
}

/** Plata: "350" (en una gestoría, 350 mil), "350 mil", "$100.000", "1.2 millones", "1'100.000". */
const NUM = String.raw`\$?\s*(\d{1,3}(?:[.,'’]\d{3})+|\d+(?:[.,]\d+)?)\s*(millones|millon|mil|k|lucas|luca|palos|palo)?(?![\d])`;
function pesos(num: string, unidad = ""): number | null {
  let n: number;
  if (/^(millon|palo)/.test(unidad)) n = Number(num.replace(/['’]/g, "").replace(",", ".")) * 1_000_000;
  else {
    const miles = /[.,'’]\d{3}$/.test(num);
    n = miles ? Number(num.replace(/[.,'’]/g, "")) : Number(num.replace(",", "."));
    if (/^(mil|k|luca)/.test(unidad) || n < 5000) n *= 1000;
  }
  n = Math.round(n);
  return Number.isFinite(n) && n >= 1000 && n <= 10_000_000 ? n : null;
}

/** Palabras que no son un dato ni algo que anotar: la orden, los nombres de los trámites, los conectores. */
const RELLENO = new Set(("anotame anota anotar anote anotalo agregame agrega agregar agregue agregalo registra registrame registrar registre registralo " +
  "guardame guarda guardar guardalo crea creame crear ingresa ingresame ingresar sube subeme subir mete meteme carga cargame hazme haz abre abreme " +
  "hola buenas buenos dias tardes noches porfa favor por plis gracias listo bueno ok " +
  "este esta ese esa estos estas eso esto tramite tramites licencia licencias conduccion conducir pase " +
  "de del la el los las un una unos unas y e o u a al en con para que es son le lo les se su sus mi me te nos ya tambien otro otra como " +
  "categoria categorias cat renovacion renovar renueva refrendacion refrendar expedicion expedir primera primer vez 1a 1ra 1era nueva nuevo sacar saca " +
  "migracion migrar mayor menor edad recategorizacion recategorizar duplicado " +
  "telefono tel cel celular whatsapp wsp numero cedula cc documento doc ti " +
  "cobro cobra cobrar cobre cobrale vale valor precio total cuesta abono abona abonó abonaron pago dejo consigno anticipo adelanto mando transfirio " +
  "nequi daviplata efectivo transferencia bancolombia mil pesos millones lucas " +
  "nacio nacido nacida nacimiento fecha cumple " +
  "adjunta adjunto adjuntas ambas ambos fotos foto hojas hoja documentos " +
  "transito organismo secretaria moto carro particular publico clases curso sin").split(" "));
const RAICES_TRAMITE = /^(refr|renov|renob|migr|recateg|duplic|expedi|anot|agreg|registr|guard)/;

/**
 * Los datos que trae el mensaje. `organismos`: los de la lista (para "en Neiva"). Solo la ciudad exacta cuenta, y
 * después de "en" o "tránsito de" (un apellido que también es ciudad no es el organismo).
 */
export function datosDelTexto(texto: string, organismos: { id: string; ciudad: string | null }[] = []): DatosDelTexto {
  const d: DatosDelTexto = { telefono: "", cedula: "", nacimiento: "", valor: "", abono: "", metodoAbono: "", categorias: [], pista: "", clases: "", organismo: null, nota: "" };
  const original = texto.replace(/\s+/g, " ").trim();
  if (!original) return d;
  // Se trabaja sobre el texto sin tildes; lo que ya se tomó se borra para que no se vuelva a leer como otro dato.
  let resto = ` ${letrasACifras(normalizar(original))} `;
  const quitar = (s: string) => { resto = resto.replace(s, " "); };

  // Celular: 10 dígitos que empiezan por 3, con o sin espacios ("300 000 0000", "300-000-0000").
  const tel = /(?<![\d])3(?:[\s.-]?\d){9}(?![\d])/.exec(resto);
  if (tel) { d.telefono = tel[0].replace(/\D/g, ""); quitar(tel[0]); }
  // Cédula: después de "CC", "cédula" o "documento" ("CC 1.105.461.520", "cedula 10000000").
  const cc = /\b(?:c\.?\s?c\.?|cedula|documento|doc|t\.?\s?i\.?|identificacion)\s*(?:n[o°º]?\.?|#|:|numero)?\s*((?:\d[\s.]?){6,11})(?![\d])/.exec(resto);
  if (cc) { const n = cc[1].replace(/\D/g, ""); if (n.length >= 6 && n.length <= 11) { d.cedula = n; quitar(cc[0]); } }
  // Nacimiento: la fecha que va después de "nació", "nacimiento" o "f. nac.".
  const nac = /\b(naci\w*|f\.?\s?nac\w*|fecha de nac\w*)\b/.exec(resto);
  if (nac) {
    const tras = resto.slice(nac.index, nac.index + 60);
    const f = fechaDeTexto(tras);
    if (f) { d.nacimiento = f.fecha; quitar(f.texto); quitar(nac[0]); }
  }

  // El abono: plata después de "abonó", "pagó", "dejó", "consignó", "anticipo"...
  const abono = new RegExp(`\\b(abon\\w*|pago|ya pago|dejo|consign\\w*|anticip\\w*|adelant\\w*|transfiri\\w*|mando)\\b([^\\d$]{0,25}?)${NUM}`).exec(resto);
  if (abono) {
    const v = pesos(abono[3], abono[4]);
    if (v) {
      d.abono = String(v);
      const cerca = resto.slice(abono.index, abono.index + abono[0].length + 30);
      d.metodoAbono = /nequi/.test(cerca) ? "Nequi" : /daviplata/.test(cerca) ? "Daviplata" : /efectivo/.test(cerca) ? "Efectivo" : /transfer|bancolombia|consign/.test(cerca) ? "Transferencia" : "";
      quitar(abono[0]);
    }
  }
  // Lo que se cobra: plata después de "cobro", "vale", "valor", "total", "precio"; si no lo dice, una cifra con "$",
  // "mil" o "millones" que quede suelta.
  const cobro = new RegExp(`\\b(cobr\\w*|vale|valor|precio|total|cuesta|sale (?:en|por))\\b([^\\d$]{0,20}?)${NUM}`).exec(resto)?.[0]
    ?? /\$\s*\d[\d.,'’]*(?:\s*(?:mil|millones|millon))?|\d[\d.,'’]*\s*(?:mil|millones|millon|lucas)\b/.exec(resto)?.[0];
  if (cobro) {
    const m = new RegExp(NUM).exec(cobro);
    const v = m ? pesos(m[1], m[2]) : null;
    if (v) { d.valor = String(v); quitar(cobro); }
  }

  // Categorías: "B1", "a2 y b1", "A2B1", "categoría C 2" (con espacio solo si dice "categoría").
  const mayus = original.toUpperCase().replace(/(CATEGOR[IÍ]A?S?|\bCAT\.?)\s*([ABC])\s*-?\s*([123])\b/g, "$1 $2$3");
  const cats = new Set<string>();
  for (const tok of mayus.match(/[A-Z0-9]+/g) ?? []) if (/^(?:[ABC][123])+$/.test(tok)) for (const c of tok.match(/[ABC][123]/g)!) cats.add(c);
  d.categorias = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"].filter((c) => cats.has(c));
  resto = resto.replace(/\b(?:[abc][123])+\b/g, " ").replace(/\bcategor\w*\s*[abc]\s*-?\s*[123]\b/g, " ");
  if (!d.categorias.length) d.pista = /\bmotos?\b/.test(resto) ? "moto" : /\b(publico|taxi|bus|buseta|camion\w*|servicio publico)\b/.test(resto) ? "publico" : /\b(carro|automovil|particular|camioneta)\b/.test(resto) ? "carro" : "";

  // Con clases o sin clases (expedición): "sin clases", "sin curso", "no va a hacer clases" / "con clases", "con curso".
  const sin = /\b(sin (las |el )?(clases|curso)|no (va a |quiere )?(hacer|ver|tomar) (las |el )?(clases|curso))\b/.exec(resto);
  const con = /\b(con (las |el )?(clases|curso)|va a (hacer|ver|tomar) (las |el )?(clases|curso))\b/.exec(resto);
  if (sin) { d.clases = "sin"; quitar(sin[0]); } else if (con) { d.clases = "con"; quitar(con[0]); }

  // El organismo: "en Neiva", "en el tránsito de Funza", "tránsito de Mariquita".
  const ciudades = organismos.filter((o) => o.ciudad).map((o) => ({ o, c: normalizar(o.ciudad) })).sort((a, b) => b.c.length - a.c.length);
  for (const m of resto.matchAll(/\b(?:en|transito de|organismo de|secretaria de)\s+(?:el\s+|la\s+)?(?:transito\s+de\s+)?([a-z]+(?:\s+[a-z]+){0,2})/g)) {
    const hallada = ciudades.find(({ c }) => ` ${m[1]} `.startsWith(` ${c} `));
    if (hallada) { d.organismo = { id: hallada.o.id, dicho: hallada.o.ciudad! }; resto = resto.replace(new RegExp(`\\b${hallada.c}\\b`), " "); break; }
  }

  // Lo demás: si dice algo más que la orden y los datos, el mensaje va tal cual a las observaciones.
  const sobra = resto.split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !RELLENO.has(w) && !RAICES_TRAMITE.test(w) && !/^\d+$/.test(w) && !MESES.includes(w));
  if (sobra.length) d.nota = original.slice(0, 400);
  return d;
}
