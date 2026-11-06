/*
 * POST /api/leer  { tipo: "cedula" | "licencia" | "tarjeta_propiedad" | "documento", imagen: "data:image/jpeg;base64,..." }
 * POST /api/leer/derecha  { imagenes: [4 data URL: la foto girada 0, 90, 180 y 270 grados] } -> { giro }
 *   Cuál de las cuatro se lee derecha. El lector a veces nota que una foto está de lado pero se equivoca de sentido
 *   (dice 90 cuando eran 270); comparando las cuatro acierta (en las pruebas: un recibo, un formulario y una tarjeta).
 *   Con derecha: true en /api/leer (la comparación dijo que ya estaba derecha, p. ej. una hoja apenas inclinada) se lee
 *   aunque el lector la vea girada; si la vio girada, los números quedan marcados para revisar.
 * Lee una foto con gpt-4o y salida JSON estricta (el modelo no puede devolver otra forma).
 * Luis Rojas: los datos vuelven a la app, Felipe los revisa y recién ahí se guardan.
 * La foto no se guarda en ningún lado.
 * Instrucciones y esquemas tomados de nexum-transito/lib/ia/documentos.ts.
 */
import { json } from "../http";
import { ErrorApi } from "../http";
import { registrarUsoIa, type Db, type Datos } from "../util";

export type TipoLectura = "cedula" | "licencia" | "tarjeta_propiedad" | "documento";
const MODELO = "gpt-4o";
const MAX_IMAGEN = 7_000_000; // caracteres del data URL (~5 MB de foto); la app la reduce antes de enviarla

const FECHA = { type: ["string", "null"], description: "Formato AAAA-MM-DD. null si no se ve." } as const;
const TEXTO = (d: string) => ({ type: ["string", "null"], description: `${d} null si no se ve en la foto.` });

/**
 * Lo primero que dice el lector: si la foto está girada. Una foto de lado se lee mal (en las pruebas, una tarjeta de
 * lado salió con otra placa y otra marca): la app la endereza y la vuelve a leer.
 */
const GIRO = { type: "string", enum: ["0", "90", "180", "270"], description: "Grados que hay que girar la foto EN EL SENTIDO DEL RELOJ para que el texto quede derecho, como se lee normalmente: 0 si ya está derecha; 90 si el texto va de abajo hacia arriba; 270 si va de arriba hacia abajo; 180 si está de cabeza." };
function esquema(propiedades: Record<string, unknown>) {
  const todas = { giro: GIRO, ...propiedades };
  return { type: "object", properties: todas, required: Object.keys(todas), additionalProperties: false };
}

const ESQUEMAS: Record<TipoLectura, { nombre: string; instruccion: string; schema: Record<string, unknown> }> = {
  cedula: {
    nombre: "datos_cedula",
    instruccion:
      "Es una CÉDULA DE CIUDADANÍA colombiana (o cédula de extranjería). Extrae los datos EXACTAMENTE como figuran. " +
      'El nombre completo va como "NOMBRES APELLIDOS" (en la cédula los apellidos suelen ir ARRIBA de los nombres: no los inviertas). ' +
      'tipoDocumento: "CC" si es cédula de ciudadanía, "CE" si es de extranjería.',
    schema: esquema({
      tipoDocumento: TEXTO("CC o CE."),
      numeroDocumento: TEXTO("Solo los dígitos, sin puntos ni espacios."),
      nombreCompleto: TEXTO("Nombres y apellidos, en ese orden."),
      apellidos: TEXTO("Solo los apellidos, como figuran en la cédula."),
      nombres: TEXTO("Solo los nombres, como figuran en la cédula."),
      fechaNacimiento: FECHA,
      fechaExpedicionDocumento: FECHA,
    }),
  },
  licencia: {
    nombre: "datos_licencia",
    instruccion:
      "Es una LICENCIA DE CONDUCCIÓN colombiana. Las categorías son códigos como A1, A2, B1, B2, B3, C1, C2, C3. " +
      "Puede haber VARIAS, cada una con su fecha de vencimiento: devuelve la fecha de vencimiento MARTA DIAZ (la que vence primero).",
    schema: esquema({
      numeroDocumento: TEXTO("Documento del titular, solo dígitos."),
      nombreCompleto: TEXTO("Nombre del titular."),
      categorias: { type: ["array", "null"], items: { type: "string" }, description: "Códigos de categoría (A1, B1, C2...). null si no se leen." },
      fechaVencimiento: FECHA,
      fechaExpedicion: FECHA,
    }),
  },
  tarjeta_propiedad: {
    nombre: "datos_tarjeta_propiedad",
    instruccion:
      "Es una TARJETA DE PROPIEDAD (licencia de tránsito) de un vehículo colombiano (una cara o las dos: en el respaldo están la potencia, la fecha de matrícula y el organismo de tránsito). Lo que tenga asteriscos (******) no lo trae: null. " +
      "clase: usa exactamente una de estas palabras: Automóvil, Camioneta, Campero, Motocicleta, Cuatrimoto, Motocarro, Camión, Bus, Buseta, Microbús, Tractocamión, Volqueta, Remolque, Maquinaria. " +
      'tipoServicio: "particular" o "publico". cilindraje: solo el número, sin "cc".',
    schema: esquema({
      placa: TEXTO("Placa del vehículo, sin guiones."),
      marca: TEXTO("Marca."),
      linea: TEXTO("Línea o referencia."),
      clase: TEXTO("Clase, de la lista dada."),
      color: TEXTO("Color."),
      modeloAnio: TEXTO("Año del modelo, 4 dígitos."),
      cilindraje: TEXTO("Cilindraje en cc, solo el número."),
      numeroMotor: TEXTO("Número de motor."),
      numeroChasis: TEXTO("Número de chasis."),
      numeroSerie: TEXTO("Número de serie."),
      vin: TEXTO("VIN."),
      tipoServicio: TEXTO("particular o publico."),
      nombreTitular: TEXTO("Nombre del propietario."),
      documentoTitular: TEXTO("Documento del propietario, solo dígitos."),
      fechaMatricula: FECHA,
      combustible: TEXTO("Combustible como lo dice la tarjeta: Gasolina, Diésel, Gas, Mixto, Eléctrico, Hidrógeno, Etanol o Biodiésel. Si trae dos (GAS GASOLINA, GASOLINA - GAS), los dos: 'Gasolina y gas'."),
      capacidad: TEXTO("Capacidad (kg o pasajeros), como figura."),
      potencia: TEXTO("Potencia en HP, solo el número."),
      carroceria: TEXTO("Tipo de carrocería, como figura."),
      licenciaTransito: TEXTO("Número de la LICENCIA DE TRÁNSITO No. (arriba, a la derecha), solo dígitos."),
      organismoTransito: TEXTO("Texto EXACTO del campo ORGANISMO DE TRÁNSITO impreso en la tarjeta, letra por letra. Si ese campo no se ve o no se lee con total claridad, null. NUNCA lo deduzcas de la placa, del departamento ni de ningún otro dato."),
    }),
  },
  // Cualquier hoja de un trámite (para registrar uno que ya llega digitado): dice qué es y saca lo que trae.
  documento: {
    nombre: "documento_de_tramite",
    instruccion:
      "Es UNA hoja de un trámite de tránsito colombiano, en foto. Puede venir GIRADA (de lado o de cabeza): eso va en giro (si el texto corre vertical, de arriba abajo o de abajo arriba, NO está derecha); si está girada no la leas así: la app la endereza y te la manda otra vez. Puede estar arrugada o escrita a mano. Primero di qué es (clase):\n" +
      "- tarjeta_propiedad: tarjeta de propiedad / licencia de tránsito del vehículo.\n" +
      "- cedula: cédula de ciudadanía o de extranjería (una cara o las dos).\n" +
      "- licencia_conduccion: licencia de conducción (pase): una persona con rol null; en tramites, sus categorías (A2, B1...).\n" +
      "- formulario_unico: Formulario Único de Solicitud de Trámites del Registro Nacional Automotor (FUN), lleno a mano o a máquina.\n" +
      "- contrato_mandato: contrato de mandato o poder para hacer el trámite.\n" +
      "- contrato_compraventa: contrato de compraventa del vehículo.\n" +
      "- nota: sobre, papel o nota a mano de la oficina (placa, trámite, nombres, teléfonos, valor cobrado, pendientes).\n" +
      "- recibo_pago: recibo, liquidación o comprobante de pago de un trámite en la Secretaría de Tránsito (o en el banco para tránsito).\n" +
      "- carta_compromiso: CARTA DE COMPROMISO de la academia de conducción (J Y G): título 'CARTA DE COMPROMISO', 'estudiante de la academia', 'compromiso de asistir puntualmente a todas las clases teóricas y prácticas... para obtener mi licencia de conducción', abajo 'Firma, Nombre, Cedula, Teléfono'. NO es una nota de la oficina ni un contrato.\n" +
      "- otro: cualquier otra cosa (SOAT, revisión técnico-mecánica, paz y salvo...).\n" +
      "Luego llena SOLO lo que esa hoja trae; lo demás, null. Reglas:\n" +
      "- Formulario único: en tramites, SOLO las casillas del punto 3 (TRÁMITE SOLICITADO) que tienen una X o marca hecha a mano, con su nombre impreso (por ejemplo 'TRASPASO', 'LEVANTA PRENDA'); las casillas vacías NO van." +
      "El punto 21 (DATOS DEL PROPIETARIO) es la persona con rol 'propietario'; el punto 22 (DATOS DEL COMPRADOR) es rol 'comprador'. Organismo: el punto 1 (nombre o ciudad del organismo de tránsito). " +
      "Los datos del vehículo salen de los puntos 2 a 16.\n" +
      "- Cédula: una persona con rol null, con apellidos y nombres separados como figuran (los apellidos van arriba).\n" +
      "- Tarjeta de propiedad: el vehículo, y el propietario como persona con rol 'propietario'. La tarjeta imprime el nombre con los APELLIDOS PRIMERO (PEDRO RUIZ): apellidos = los apellidos (las dos primeras palabras, o un apellido compuesto como RINCON DE AYA), nombres = lo demás, y nombreCompleto = nombres y apellidos (CLARA MORA). organismo: el texto del campo organismo de tránsito. Si vienen las dos caras, lee las dos: en el respaldo están la potencia, la fecha de matrícula y el organismo de tránsito. Lo que tenga asteriscos (******) no lo trae: null.\n" +
      "- Mandato: el mandante (quien da el poder) con rol 'mandante'; el mandatario con rol 'mandatario'.\n" +
      "- Recibo de pago: en tramites, cada trámite tal como está escrito (por ejemplo 'TRAMITE RENOVACION LICENCIA CONDUCCION CARRO'), sin repetir; el solicitante como persona con rol null: su nombre, y numeroDocumento SOLO si está impreso en el campo de identificación o documento del solicitante (el número del recibo, del pago, del registro o el 'Nro' de la liquidación NO son la cédula); si ese campo está vacío, numeroDocumento null. organismo: la secretaría de tránsito; notas: número del recibo, fecha de pago y valor total pagado con su detalle, tal como figuran (forma: 'Recibo <número> · pagado el <fecha> · $<total>: <concepto> <valor> + <concepto> <valor>'). Lo pagado NO va en valor (valor es lo que cobra la oficina). Nunca inventes un número que no esté en la foto.\n" +
      "- Compraventa: vendedor y comprador con esos roles; precio: el precio de la venta en números.\n" +
      "- Carta de compromiso: el estudiante como persona con rol null: el nombre, el número de C.C. o T.I. y el teléfono escritos a mano (null si están en blanco); notas: 'firmada' si tiene firma escrita, 'sin firma' si el espacio de la firma está vacío.\n" +
      "- Recibo de caja menor (un recibo de la oficina, de lo que el cliente pagó o abonó): es nota; sus notas empiezan con 'Recibo de caja menor'.\n" +
      "- notas: solo lo escrito por alguien (pendientes, observaciones); NUNCA el texto impreso del formato ni sus instrucciones.\n" +
      "- Nota: la placa (suele ir arriba, grande, con o sin guion: 'ABC123') va en vehiculo.placa; cada persona con su rol si lo dice ('vendedor', 'comprador') o 'otro'; valor: lo que se cobra, en números (100.000 -> 540000); tramites: lo que dice que se hace; notas: lo demás que esté escrito, tal cual.\n" +
      "- Escrito a mano: lee dígito por dígito. Si un dígito no se distingue con seguridad (un 2 que parece 7, un 1 que parece 7...), pon tu mejor lectura y agrega el campo a dudosos. Si no se lee nada, null. Números de documento y teléfonos: solo dígitos.",
    schema: esquema({
      clase: { type: "string", enum: ["tarjeta_propiedad", "cedula", "licencia_conduccion", "formulario_unico", "contrato_mandato", "contrato_compraventa", "recibo_pago", "carta_compromiso", "nota", "otro"], description: "Qué es esta hoja." },
      tramites: { type: ["array", "null"], items: { type: "string" }, description: "Trámites marcados o escritos." },
      organismo: TEXTO("Organismo o ciudad de tránsito, como figura."),
      vehiculo: {
        type: ["object", "null"], additionalProperties: false,
        properties: {
          placa: TEXTO("Placa sin guiones."), marca: TEXTO("Marca."), linea: TEXTO("Línea exacta como está impresa: todas sus palabras, en su orden y con sus siglas (UG, ABS, FI, 4X2, AT...); cada sigla es otra versión con otro avalúo."), modelo: TEXTO("Año del modelo, 4 dígitos."),
          clase: TEXTO("Clase de vehículo (Automóvil, Motocicleta, Camioneta...)."), color: TEXTO("Color."), cilindraje: TEXTO("Solo el número."),
          servicio: TEXTO("particular o publico."), combustible: TEXTO("Combustible como lo dice la hoja; si trae dos (GAS GASOLINA), los dos: 'Gasolina y gas'."), motor: TEXTO("Número de motor."), chasis: TEXTO("Número de chasis."),
          serie: TEXTO("Número de serie."), vin: TEXTO("VIN."), capacidad: TEXTO("Capacidad (pasajeros o kg), como figura."), carroceria: TEXTO("Carrocería."),
          potencia: TEXTO("Potencia en HP, solo el número."), fechaMatricula: FECHA, licenciaTransito: TEXTO("Número de la licencia de tránsito (en la tarjeta: 'LICENCIA DE TRÁNSITO No.'), solo dígitos."),
        },
        required: ["placa", "marca", "linea", "modelo", "clase", "color", "cilindraje", "servicio", "combustible", "motor", "chasis", "serie", "vin", "capacidad", "carroceria", "potencia", "fechaMatricula", "licenciaTransito"],
      },
      personas: {
        type: ["array", "null"],
        items: {
          type: "object", additionalProperties: false,
          properties: {
            rol: { type: ["string", "null"], enum: ["propietario", "vendedor", "comprador", "mandante", "mandatario", "otro", null], description: "Rol en esta hoja." },
            nombreCompleto: TEXTO("Nombres y apellidos, en ese orden."), apellidos: TEXTO("Solo los apellidos."), nombres: TEXTO("Solo los nombres."),
            tipoDocumento: TEXTO("CC, CE, NIT, PA o TI."), numeroDocumento: TEXTO("Solo dígitos."), telefono: TEXTO("Solo dígitos."),
            direccion: TEXTO("Dirección."), ciudad: TEXTO("Ciudad."), fechaNacimiento: FECHA, fechaExpedicionDocumento: FECHA,
          },
          required: ["rol", "nombreCompleto", "apellidos", "nombres", "tipoDocumento", "numeroDocumento", "telefono", "direccion", "ciudad", "fechaNacimiento", "fechaExpedicionDocumento"],
        },
      },
      valor: TEXTO("Valor cobrado por la oficina (en notas), solo dígitos."),
      precio: TEXTO("Precio de la compraventa, solo dígitos."),
      notas: TEXTO("Otras anotaciones escritas (pendientes, observaciones), tal cual."),
      dudosos: { type: ["array", "null"], items: { type: "string" }, description: "Campos con algún carácter dudoso, como ruta: 'vehiculo.placa', 'valor', 'personas.0.numeroDocumento', 'personas.1.telefono'." },
    }),
  },
};

/** Quita los null (la app espera "campo ausente") y los textos vacíos, también dentro de objetos y listas. */
function limpiar(v: unknown): unknown {
  if (v == null) return undefined;
  if (Array.isArray(v)) { const l = v.map(limpiar).filter((x) => x !== undefined); return l.length ? l : undefined; }
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const y = limpiar(x); if (y !== undefined) o[k] = y; }
    return Object.keys(o).length ? o : undefined;
  }
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : undefined;
}

const SISTEMA =
  "Extraes datos de documentos colombianos a partir de una foto. " +
  "REGLA DE ORO: si un dato no se ve con claridad, devuelves null. NO ADIVINES y NO COMPLETES. " +
  "Un campo vacío se llena en dos segundos; un dato inventado se cuela al expediente y nadie lo detecta. " +
  "Las fechas SIEMPRE en formato AAAA-MM-DD.\n\n";

/**
 * Los datos clave en que dos lecturas de la misma hoja no coinciden: si dos modelos leen distinto un número escrito a
 * mano, ese número hay que revisarlo. (Si uno no lo leyó, no cuenta como desacuerdo.)
 */
function desacuerdos(a: Record<string, unknown>, b: Record<string, unknown>) {
  const limpio = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out: string[] = [];
  const va = (a.vehiculo ?? {}) as Record<string, unknown>, vb = (b.vehiculo ?? {}) as Record<string, unknown>;
  for (const k of ["placa", "modelo", "cilindraje", "motor", "chasis", "vin"]) if (va[k] && vb[k] && limpio(va[k]) !== limpio(vb[k])) out.push(`vehiculo.${k}`);
  for (const k of ["valor", "precio"]) if (a[k] && b[k] && limpio(a[k]) !== limpio(b[k])) out.push(k);
  const pa = (a.personas ?? []) as Record<string, unknown>[], pb = (b.personas ?? []) as Record<string, unknown>[];
  pb.forEach((p, i) => {
    const q = pa.find((x) => x.rol && x.rol === p.rol) ?? pa[i];
    if (!q) return;
    for (const k of ["numeroDocumento", "telefono"]) if (p[k] && q[k] && limpio(p[k]) !== limpio(q[k])) out.push(`personas.${i}.${k}`);
  });
  return out;
}

/**
 * El chasis y el VIN casi siempre son el mismo número (y en las motos, también la serie): si se leyeron distintos, uno
 * de los dos está mal leído (o los dos) y hay que mirarlos.
 */
function numerosQueNoCuadran(v: Record<string, unknown> | undefined, claves: [string, string, string]) {
  if (!v) return [];
  const valores = claves.map((k) => String(v[k] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const largos = valores.filter((x) => x.length >= 11);
  if (largos.length < 2 || new Set(largos).size === 1) return [];
  return claves.filter((_, i) => valores[i].length >= 11);
}

/**
 * Hojas que se releen con el modelo que lee mejor: las que casi siempre vienen escritas a mano, y los recibos de pago
 * (fotos de lado, letra pequeña: gpt-4o no notaba que venían de lado e inventaba la cédula, el recibo y los valores).
 */
const A_MANO = new Set(["formulario_unico", "contrato_mandato", "contrato_compraventa", "nota", "recibo_pago", "carta_compromiso"]);
/** El que relee lo escrito a mano: en las pruebas (scripts/estres-lector.mjs) gpt-4o inventaba datos de un formulario a mano; gpt-5 no. */
const MODELO_A_MANO = "gpt-5";

/**
 * Lee una foto. `modeloLector` cambia el modelo (pruebas); para las hojas de un trámite ("documento"), las que vienen
 * a mano se releen con `modeloAMano` (por defecto gpt-5; "no" para no releer).
 */
export async function leer(db: Db, apiKey: string | undefined, cuerpo: Datos, modeloLector?: string, modeloAMano?: string): Promise<Response> {
  if (!apiKey) throw new ErrorApi("Falta configurar la clave de OpenAI.", 503);
  const tipo = cuerpo.tipo as TipoLectura;
  const cfg = ESQUEMAS[tipo];
  if (!cfg) throw new ErrorApi("Tipo de documento no válido.");
  const imagen = typeof cuerpo.imagen === "string" ? cuerpo.imagen : "";
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imagen)) throw new ErrorApi("La foto debe ser JPG, PNG o WEBP.");
  if (imagen.length > MAX_IMAGEN) throw new ErrorApi("La foto es demasiado pesada. Tómela de nuevo con menos resolución.");

  /** Una lectura con un modelo: el JSON tal como lo devolvió. */
  async function leerCon(modelo: string): Promise<Record<string, unknown>> {
    // Los modelos de razonamiento (gpt-5, o*) no aceptan temperature ni max_tokens.
    const razona = /^(gpt-5|o\d)/.test(modelo);
    let r: Response;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(razona ? 100_000 : 10_000),
        body: JSON.stringify({
          model: modelo,
          ...(razona ? { max_completion_tokens: 16000, reasoning_effort: "low" } : { max_tokens: tipo === "documento" ? 1800 : 800, temperature: 0 }),
          store: false,
          response_format: { type: "json_schema", json_schema: { name: cfg.nombre, strict: true, schema: cfg.schema } },
          messages: [
            { role: "system", content: SISTEMA + cfg.instruccion },
            { role: "user", content: [{ type: "text", text: "Extrae los datos de este documento." }, { type: "image_url", image_url: { url: imagen, detail: "high" } }] },
          ],
        }),
      });
    } catch (e) {
      console.error("OpenAI no respondió", e);
      throw new ErrorApi("No se pudo leer la foto (OpenAI no respondió). Intente de nuevo o escriba los datos.", 502);
    }
    if (!r.ok) {
      console.error("OpenAI respondió", r.status, (await r.text()).slice(0, 500));
      throw new ErrorApi(r.status === 401 ? "La clave de OpenAI no es válida." : "No se pudo leer la foto. Intente de nuevo o escriba los datos.", 502);
    }
    const res = (await r.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    await registrarUsoIa(db, `leer_${tipo}`, modelo, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0).run();
    const contenido = res.choices?.[0]?.message?.content;
    if (!contenido) throw new ErrorApi("No se pudo leer la foto. Pruebe con otra.", 422);
    try { return JSON.parse(contenido); } catch { throw new ErrorApi("No se pudo leer la foto. Pruebe con otra.", 422); }
  }

  const crudo = await leerCon(modeloLector || MODELO);
  // Girada: lo leído no sirve; la app la endereza y la manda otra vez. Salvo que la app ya comparó los cuatro giros y
  // esta es la derecha: entonces se lee (el lector vio girada una hoja apenas inclinada) y se marcan los números.
  const yaDerecha = cuerpo.derecha === true;
  const esGiro = (g: unknown) => ["90", "180", "270"].includes(String(g));
  let laVioGirada = esGiro(crudo.giro);
  const girar = laVioGirada && !yaDerecha ? Number(crudo.giro) : 0;
  delete crudo.giro;
  if (girar) return json({ tipo, girar, datos: {} });
  if (tipo === "documento") {
    let datos = (limpiar(crudo) ?? {}) as Record<string, unknown>;
    if (!datos.clase) throw new ErrorApi("No se pudo leer la hoja. Pruebe con más luz y la hoja completa.", 422);
    // Lo escrito a mano se relee con el modelo que mejor lo lee (si falla, queda la primera lectura, marcada para revisar).
    const aMano = modeloAMano === "no" ? "" : modeloAMano || MODELO_A_MANO;
    if (aMano && A_MANO.has(String(datos.clase))) {
      try {
        const crudaOtra = await leerCon(aMano);
        // El que lee mejor ve que está girada: la app la endereza y la manda otra vez.
        laVioGirada ||= esGiro(crudaOtra.giro);
        const giroOtra = esGiro(crudaOtra.giro) && !yaDerecha ? Number(crudaOtra.giro) : 0;
        if (giroOtra) return json({ tipo, girar: giroOtra, datos: {} });
        delete crudaOtra.giro;
        const otra = (limpiar(crudaOtra) ?? {}) as Record<string, unknown>;
        if (otra.clase) datos = { ...otra, releida: true, dudosos: [...new Set([...((otra.dudosos as string[]) ?? []), ...desacuerdos(datos, otra)])] };
      } catch (e) {
        console.error("No se pudo releer", e);
        datos = { ...datos, dudosos: [...new Set([...((datos.dudosos as string[]) ?? []), "vehiculo.placa", "valor", "personas.0.numeroDocumento", "personas.0.telefono", "personas.1.numeroDocumento", "personas.1.telefono"])] };
      }
    }
    const raros = numerosQueNoCuadran(datos.vehiculo as Record<string, unknown> | undefined, ["chasis", "vin", "serie"]).map((k) => `vehiculo.${k}`);
    // Foto de baja resolución (o que el lector vio girada): un carácter se puede correr sin que el lector lo note; los números se revisan siempre.
    if (cuerpo.baja === true || laVioGirada) {
      const v = (datos.vehiculo ?? {}) as Record<string, unknown>;
      raros.push(...["motor", "chasis", "vin", "serie", "licenciaTransito"].filter((k) => v[k]).map((k) => `vehiculo.${k}`));
      ((datos.personas ?? []) as Record<string, unknown>[]).forEach((p, i) => { if (p.numeroDocumento) raros.push(`personas.${i}.numeroDocumento`); });
    }
    if (raros.length) datos = { ...datos, dudosos: [...new Set([...((datos.dudosos as string[]) ?? []), ...raros])] };
    return json({ tipo, datos });
  }
  // Los null se quitan: la app espera "campo ausente", no la palabra null.
  const datos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(crudo)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) datos[k] = v.map(String); continue; }
    const s = String(v).trim();
    if (s && s.toLowerCase() !== "null") datos[k] = s;
  }
  if (!Object.keys(datos).length) throw new ErrorApi("No se pudo leer ningún dato. Pruebe con más luz, sin reflejos y con el documento derecho.", 422);
  const raros = tipo === "tarjeta_propiedad" ? numerosQueNoCuadran(datos, ["numeroChasis", "vin", "numeroSerie"]) : [];
  if (cuerpo.baja === true || laVioGirada) raros.push(...["numeroMotor", "numeroChasis", "vin", "numeroSerie", "documentoTitular", "licenciaTransito", "numeroDocumento"].filter((k) => datos[k] && !raros.includes(k)));
  if (raros.length) datos.dudosos = raros;
  return json({ tipo, datos });
}

/** POST /api/leer/derecha: de cuatro giros de la misma foto, cuál se lee derecho. Ver el encabezado. */
export async function elegirDerecha(db: Db, apiKey: string | undefined, cuerpo: Datos): Promise<Response> {
  if (!apiKey) throw new ErrorApi("Falta configurar la clave de OpenAI.", 503);
  const imagenes = Array.isArray(cuerpo.imagenes) ? cuerpo.imagenes.filter((x): x is string => typeof x === "string") : [];
  if (imagenes.length !== 4 || imagenes.some((x) => !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x) || x.length > MAX_IMAGEN / 2)) throw new ErrorApi("Mande las cuatro fotos (JPG).");
  const modelo = "gpt-4o";
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        model: modelo, temperature: 0, max_tokens: 20, store: false,
        response_format: { type: "json_schema", json_schema: { name: "foto_derecha", strict: true, schema: { type: "object", properties: { derecha: { type: "string", enum: ["1", "2", "3", "4"] } }, required: ["derecha"], additionalProperties: false } } },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Son 4 copias de la misma foto, cada una girada distinto. ¿En cuál el texto principal se lee derecho: horizontal, de izquierda a derecha y no de cabeza? Responde el número (1, 2, 3 o 4)." },
            ...imagenes.flatMap((url, i) => [{ type: "text", text: `Imagen ${i + 1}:` }, { type: "image_url", image_url: { url, detail: "high" } }]),
          ],
        }],
      }),
    });
  } catch { throw new ErrorApi("No se pudo revisar la foto (OpenAI no respondió).", 502); }
  if (!r.ok) throw new ErrorApi("No se pudo revisar la foto.", 502);
  const res = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  await registrarUsoIa(db, "leer_derecha", modelo, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0).run();
  let n = 0;
  try { n = Number((JSON.parse(res.choices?.[0]?.message?.content ?? "{}") as { derecha?: string }).derecha); } catch { n = 0; }
  if (!(n >= 1 && n <= 4)) throw new ErrorApi("No se pudo revisar la foto.", 502);
  return json({ giro: (n - 1) * 90 });
}
