import { Download, ExternalLink, FileText, Mail, MapPin, MessageCircle, Phone, Smartphone } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useState } from "react";
import { acotarCopias, AccionesPdf, Copias } from "./VistaPdf";

/**
 * Formatos de la oficina (transcritos de las copias físicas, sin cambiarles el texto), como los oficiales: cada uno se
 * abre o se descarga en PDF, y tiene su vista previa con sus ajustes.
 *  - Aceptación de cargos de la infracción C-02 (Secretaría de Movilidad de Ibagué; va con los inmovilizados) y las
 *    tirillas del comparendo que casi siempre van con ella (varias por hoja, una debajo de otra, para ahorrar papel).
 *    Cada una con su vista previa y se imprime por aparte: la C-02 con sus copias, las tirillas con cuántas.
 *  - Carta de compromiso de la academia J Y G (licencias: terminar las clases).
 *  - Planilla de entrega de tarjetas de propiedad (quién la recibió, con cédula, teléfono y firma: por si después dicen
 *    que no la recibieron). Hoja carta horizontal; se imprimen las hojas que se quieran.
 *  - Acta de pérdida de placa de Su Placa Vehicular (Cali): la llena el dueño para pedir la placa nueva.
 * Los PDF fijos están en public/formatos (los genera scripts/generar-formatos-oficina.mjs desde estas mismas hojas);
 * el de cada impresión se arma juntando sus páginas.
 */

/** Cuántas tirillas caben en una hoja carta (una debajo de otra, con línea de corte). */
export const TIRILLAS_POR_HOJA = 5;
const CAMPOS_TIRILLA = ["NOMBRE", "CEDULA", "FECHA DEL COMPARENDO", "DIRECCION", "TELEFONO", "MOTIVO DE COMPARENDO"];
export const PDF_OFICINA = {
  c02: "/formatos/aceptacion-cargos-c02.pdf",
  compromiso: "/formatos/carta-compromiso-academia.pdf",
  entrega: "/formatos/entrega-tarjetas-propiedad.pdf",
  placa: "/formatos/acta-perdida-placa.pdf",
  /** Una hoja con n tirillas (1 a 5). */
  tirillas: (n: number) => (n >= TIRILLAS_POR_HOJA ? "/formatos/tirillas-comparendo.pdf" : `/formatos/tirillas-comparendo-${n}.pdf`),
};

type Pedido = { c02: number } | { tirillas: number } | { compromiso: number } | { entrega: number } | { placa: number };
/** Las hojas de tirillas: cuántas lleva cada una (5, 5, ..., y el resto). */
const hojasDeTirillas = (n: number) => Array.from({ length: Math.ceil(n / TIRILLAS_POR_HOJA) }, (_, i) => Math.min(TIRILLAS_POR_HOJA, n - i * TIRILLAS_POR_HOJA));

/** El PDF de lo pedido, juntando las páginas de los PDF fijos. */
async function armarPdf(p: Pedido): Promise<Uint8Array> {
  const salida = await PDFDocument.create();
  const cache = new Map<string, PDFDocument>();
  const pegar = async (ruta: string) => {
    if (!cache.has(ruta)) {
      const r = await fetch(ruta);
      if (!r.ok) throw new Error("No se pudo abrir el formato.");
      cache.set(ruta, await PDFDocument.load(await r.arrayBuffer()));
    }
    const origen = cache.get(ruta)!;
    for (const pg of await salida.copyPages(origen, origen.getPageIndices())) salida.addPage(pg);
  };
  if ("compromiso" in p) for (let i = 0; i < p.compromiso; i++) await pegar(PDF_OFICINA.compromiso);
  else if ("entrega" in p) for (let i = 0; i < p.entrega; i++) await pegar(PDF_OFICINA.entrega);
  else if ("placa" in p) for (let i = 0; i < p.placa; i++) await pegar(PDF_OFICINA.placa);
  else if ("c02" in p) for (let i = 0; i < p.c02; i++) await pegar(PDF_OFICINA.c02);
  else for (const n of hojasDeTirillas(p.tirillas)) await pegar(PDF_OFICINA.tirillas(n));
  return salida.save();
}

const Linea = ({ ancho }: { ancho?: string }) => <span className="fo-linea" style={ancho ? { width: ancho } : undefined} />;

export function HojaC02() {
  return (
    <div className="fo-hoja fo-c02">
      <h1>ACEPTACION DE CARGOS DE LA INFRACCION C-02</h1>
      <div className="fo-datos">
        <b>INFRACCION: C-02</b><span />
        <b>COMPARENDO:</b><Linea />
        <b>NOMBRE:</b><Linea />
        <b>C.C.:</b><Linea />
        <b>PLACA:</b><Linea />
      </div>
      <p>
        En Ibagué, a los <span className="fo-fecha">__DD / MM / AA__</span> , se hace presente en esta secretaria el <b>SEÑOR(A)</b><Linea ancho="62mm" /><b>C.C.</b> <Linea ancho="45mm" />, quien de manera libre y
        espontánea con relación a la orden de comparendo referenciada por la infracción <b>C-02</b> de la ley 1383 de 16 de marzo de 2010, que dice: <i>Estacionar un vehículo en sitios prohibidos</i> MANIFIESTA: <b>ACEPTO EL CARGUE DE LA INFRACCIÓN</b>, con todas sus consecuencias jurídicas de conformidad con lo expuesto en el código nacional de tránsito.
      </p>
      <p>
        En este estado de la diligencia y en vista de la manifestación que hace el compareciente, en el sentido de allanarse a los cargos imputados, existen los elementos suficientes para imputarle responsabilidad contravencional, por lo cual se impondrá al conductor la multa establecida, en el artículo 131 literal C.02 del Código Nacional de Tránsito Terrestre modificado por el artículo 21 de la ley 1383 de 16 de marzo de 2010 sin necesidad de otra actuación administrativa siempre y cuando No impugne la Ana Gómez. En consecuencia, de esto la orden de comparendo será incorporada a la plataforma interna de la secretaria y al SIMIT, asociada al número de identificación del aquí aceptante.
        <br />En caso de No estar de acuerdo con la Orden de comparendo podrá solicitar audiencia Pública, e impugnar la misma.
      </p>
      <p>No siendo otro el motivo de la presente y una vez leída y aprobada, se firma por quien asume el cargue de la infracción por la orden de comparendo de la referencia y por quien recibe el presente documento.</p>
      <div className="fo-firmas">
        <div className="fo-firma">
          <span>Acepto:</span>
          <span className="fo-espacio" />
          <span>FIRMA:</span>
          <span>NOMBRE: <Linea ancho="70mm" /></span>
          <span>C.C:. <Linea ancho="70mm" /></span>
        </div>
        <div className="fo-huella"><span /><b>HUELLA</b></div>
      </div>
      <div className="fo-recibe">
        <span>RECIBE:</span>
        <span>FUNCIONARIO <Linea ancho="65mm" /></span>
      </div>
    </div>
  );
}

export function HojaTirillas({ n }: { n: number }) {
  return (
    <div className="fo-hoja fo-tirillas">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="fo-corte">
          <table className="fo-tirilla">
            <tbody>{CAMPOS_TIRILLA.map((c) => <tr key={c}><th>{c}</th><td /></tr>)}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function HojaCompromiso() {
  return (
    <div className="fo-hoja fo-compromiso">
      <p>Ibagué, <Linea ancho="68mm" /></p>
      <h1>CARTA DE COMPROMISO</h1>
      <p>Yo <Linea ancho="68mm" /> IDENTIFICADO CON C.C __ T.I __ Numero <Linea ancho="40mm" />, estudiante de la academia <b>J Y G</b> me permito manifestar por medio de la presente carta mi compromiso de asistir puntualmente a todas las clases teóricas y prácticas programadas para obtener mi licencia de conducción.</p>
      <p>Reconozco la importancia de cada sesión de aprendizaje y me comprometo a:<br />Asistir puntualmente a todas las clases: tanto teóricas como prácticas, según el horario establecido por la escuela.</p>
      <p>Cumplir con el reglamento interno: Respetando las normas y procedimientos de la escuela de conducción</p>
      <p><b>aprovechar al máximo las clases:</b> Prestando atención, participando activamente y realizando las tareas asignadas</p>
      <p><b>Mantener una actitud responsable:</b> durante todo el proceso de aprendizaje</p>
      <p><b>Consecuencias del incumplimiento:</b> soy consciente de que en caso de que yo no pueda continuar con las clases no se me va a hacer devolución del dinero.</p>
      <p>Me notificaron que tengo un máximo de tres meses para terminar el proceso de la licencia y en caso de superar el tiempo tendría que comprar nuevamente el pin</p>
      <p>Entiendo que el cumplimiento de este compromiso es fundamental para mi formación como conductor responsable y seguro. En caso de incumplimiento, acepto la consecuencia establecida por la escuela de conducción.</p>
      <p><b>IMPORTANTE: tengo entendido y claro que en septiembre llega el sistema KALE y probablemente tengo que asumir el pago del derecho del examen teórico con ellos.</b></p>
      <p>Atentamente:</p>
      <p className="fo-pie">Firma<br />Nombre<br />Cedula</p>
      <p>Teléfono</p>
    </div>
  );
}

/** Cuántas filas tiene la planilla de entrega (caben en una hoja carta horizontal con espacio para firmar). */
const FILAS_ENTREGA = 12;
/**
 * Acta de pérdida de placa de Su Placa Vehicular (Conversión de Materiales, Cali), para pedir la fabricación de una
 * placa perdida. El texto tal cual el original; los logos son los del original, recortados (el resto se rehízo nítido).
 */
export function HojaPlacaPerdida() {
  const Caja = () => <span className="fo-pp-caja" />;
  return (
    <div className="fo-hoja fo-placa">
      <div className="fo-pp-cabecera">
        <img src="/formatos/placa-perdida/logo-conversion.png" alt="Conversión de materiales" className="fo-pp-logo1" />
        <img src="/formatos/placa-perdida/logo-suplaca.png" alt="Su placa vehicular" className="fo-pp-logo2" />
        <ul>
          <li>. Fabricación de placas en relieve, reflectivas para vehículos y motos.</li>
          <li>. Conversión de toda clase de material con aplicación a la publicidad.</li>
          <li>. Señalización vial, Industrial y Comercial <small>,Carpintería Metálica.</small></li>
        </ul>
      </div>
      <p className="fo-pp-intro">Para solicitar su placa vehicular por <span className="fo-pp-rojo">PERDIDA</span> es necesario<br />completar este documento para constatar el hecho que nos reporta.</p>
      <h1>ACTA DE PERDIDA</h1>
      <div className="fo-pp-fecha">
        <div><span>DÍA - MES - AÑO</span><div className="fo-pp-cajas"><Caja /><Caja /><Caja /></div></div>
        <b>A LUIS ROJAS</b>
      </div>
      <p className="fo-pp-renglon">El suscrito <Linea ancho="78mm" /> identificado con C.C: <Linea ancho="40mm" /></p>
      <p className="fo-pp-renglon">de <Linea ancho="38mm" /> por medio del presente certifico la perdida de la PLACA con las</p>
      <p className="fo-pp-renglon">siguientes características:</p>
      <div className="fo-pp-caracteristicas">
        <div className="fo-pp-campos">
          {["PLACA No:", "SERVICIO:", "ORGANISMO:", "CLASE DE VEHÍCULO:", "MARCA:"].map((c) => <p key={c} className="fo-pp-renglon">{c} <Linea /></p>)}
        </div>
        <div className="fo-pp-cuantas">
          <div className="fo-pp-opciones"><div><span>1 PLACA</span><Caja /></div><div><span>2 PLACAS</span><Caja /></div></div>
          <span className="fo-pp-rojo-claro">Marca con una X</span>
        </div>
      </div>
      <p className="fo-pp-renglon">La placa en mención se perdió el día <i>DÍA</i> de <i>MES</i> del <i>AÑO</i> entre las <i>HORAS</i>,</p>
      <p className="fo-pp-renglon">en <i>LUGAR</i></p>
      <div className="fo-pp-firma">
        <div className="fo-pp-huella"><i>HUELLA</i></div>
        <div className="fo-pp-firma-datos">
          <b>FIRMA DEL DENUNCIANTE</b>
          <p className="fo-pp-renglon"><b>C.C.:</b> <Linea ancho="45mm" /> <b>de</b> <Linea ancho="36mm" /></p>
          <p className="fo-pp-renglon"><b>Numero de celular:</b> <Linea ancho="62mm" /></p>
        </div>
      </div>
      <div className="fo-pp-pie">
        <span><MapPin size={15} className="fo-pp-ic rojo" />Dirección de ejemplo Cali - Valle</span>
        <span><Phone size={15} className="fo-pp-ic azul" />370 3234</span>
        <span><MessageCircle size={15} className="fo-pp-ic verde" />300 000 0000</span>
        <span><Smartphone size={15} className="fo-pp-ic negro" />300 000 0000</span>
        <span><Mail size={15} className="fo-pp-ic azul" />usuario@ejemplo.com</span>
        <span><Mail size={15} className="fo-pp-ic azul" />usuario@ejemplo.com</span>
      </div>
    </div>
  );
}

export function HojaEntregaTarjetas() {
  return (
    <div className="fo-hoja fo-horizontal fo-entrega">
      <h1>ENTREGA DE TARJETAS DE PROPIEDAD 2026</h1>
      <table>
        <thead><tr><th>PLACA</th><th>NOMBRE DE MARTA DIAZ</th><th>CEDULA</th><th>TELEFONO</th><th>FIRMA</th></tr></thead>
        <tbody>{Array.from({ length: FILAS_ENTREGA }, (_, i) => <tr key={i}><td /><td /><td /><td /><td /></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Una hoja en miniatura, como las vistas previas de los demás formatos (`horizontal`: carta acostada). */
const Miniatura = ({ titulo, children, horizontal }: { titulo: string; children: React.ReactNode; horizontal?: boolean }) => (
  <div className="pila" style={{ gap: 4 }}>
    <span className="peq muted">{titulo}</span>
    <div className={`hoja-vista-marco fo-marco${horizontal ? " horizontal" : ""}`}><div className="hoja-vista">{children}</div></div>
  </div>
);

/** Imprimir, descargar o abrir el PDF de lo pedido. */
const Acciones = ({ pedido, nombre, deshabilitado }: { pedido: Pedido; nombre: string; deshabilitado?: boolean }) => (
  <AccionesPdf armar={() => armarPdf(pedido)} nombre={nombre} deshabilitado={deshabilitado} />
);

/** Abrir y descargar el PDF fijo (como los formatos oficiales). */
const AbrirDescargar = ({ ruta }: { ruta: string }) => (
  <span className="fila" style={{ gap: 6, flexShrink: 0 }}>
    <a className="btn btn-sm" href={ruta} target="_blank" rel="noreferrer" title="Abrir para ver o imprimir (Ctrl+P)"><ExternalLink size={13} />Abrir</a>
    <a className="btn btn-sm" href={ruta} download title="Descargar el PDF"><Download size={13} />Descargar</a>
  </span>
);

/** La tarjeta de la pantalla Formatos con los formatos de la oficina. */
export function FormatosOficina() {
  const [copiasC02, setCopiasC02] = useState(1);
  const nC02 = acotarCopias(copiasC02);
  const [tirillas, setTirillas] = useState(TIRILLAS_POR_HOJA);
  const [hojasEntrega, setHojasEntrega] = useState(1);
  const nEntrega = Math.max(1, Math.min(20, Math.round(hojasEntrega) || 1));
  const [copiasCompromiso, setCopiasCompromiso] = useState(1);
  const [copiasPlaca, setCopiasPlaca] = useState(1);
  const nPlaca = acotarCopias(copiasPlaca);
  const nCompromiso = acotarCopias(copiasCompromiso);

  const n = Math.max(1, Math.min(60, Math.round(tirillas) || 1));
  const hojas = hojasDeTirillas(n);

  return (
    <div className="card">
      <div className="card-cab"><b>Formatos de la oficina</b><span className="peq tenue">Imprimir a tamaño real (100 %), sin "ajustar a la página"</span></div>
      <div className="card-cuerpo lista-filas">
        <div className="item fo-item">
          <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="principal">
            <b>Inmovilizados: aceptación de cargos de la infracción C-02</b>
            <small>Estacionar en sitio prohibido. Casi siempre va con las tirillas del comparendo (más abajo, cada una se imprime por aparte).</small>
            <small className="tenue">Carta · Secretaría de Movilidad de Ibagué (transcrita de la copia física)</small>
          </div>
          <AbrirDescargar ruta={PDF_OFICINA.c02} />
        </div>
        <details className="llenar-plegable fo-plegable">
          <summary>Vista previa y ajustes: aceptación C-02</summary>
          <div className="pila" style={{ gap: 12, marginTop: 10 }}>
            <div className="fo-opciones"><Copias valor={copiasC02} cambiar={setCopiasC02} /></div>
            <small className="tenue">{nC02 === 1 ? "Va 1 hoja." : `Van ${nC02} hojas (una por copia).`}</small>
            <Acciones pedido={{ c02: nC02 }} nombre={nC02 === 1 ? "aceptacion-c02.pdf" : `aceptacion-c02-${nC02}-copias.pdf`} />
            <div className="fo-vista"><Miniatura titulo="Aceptación de cargos C-02"><HojaC02 /></Miniatura></div>
          </div>
        </details>
        <div className="item fo-item">
          <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="principal">
            <b>Tirillas del comparendo</b>
            <small>Nombre, cédula, fecha del comparendo, dirección, teléfono y motivo. {TIRILLAS_POR_HOJA} por hoja, una debajo de otra, con línea para recortar. Van con la aceptación C-02.</small>
            <small className="tenue">Carta · De la oficina (transcrita de la copia física)</small>
          </div>
          <AbrirDescargar ruta={PDF_OFICINA.tirillas(TIRILLAS_POR_HOJA)} />
        </div>
        <details className="llenar-plegable fo-plegable">
          <summary>Vista previa y ajustes: tirillas del comparendo</summary>
          <div className="pila" style={{ gap: 12, marginTop: 10 }}>
            <div className="fo-opciones">
              <label>
                Cuántas
                <input className="input" type="number" min={1} max={60} value={tirillas} onChange={(e) => setTirillas(Number(e.target.value))} aria-label="Cuántas tirillas" />
                <small className="tenue">{TIRILLAS_POR_HOJA} por hoja</small>
              </label>
            </div>
            <small className="tenue">{`Van ${n} tirilla${n === 1 ? "" : "s"} (${hojas.length} hoja${hojas.length === 1 ? "" : "s"}).`}</small>
            <Acciones pedido={{ tirillas: n }} nombre={`tirillas-${n}.pdf`} />
            <div className="fo-vista">
              {hojas.slice(0, 3).map((k, i) => <Miniatura key={i} titulo={`Tirillas · hoja ${i + 1} de ${hojas.length} (${k})`}><HojaTirillas n={k} /></Miniatura>)}
              {hojas.length > 3 && <span className="peq muted fo-mas">Y {hojas.length - 3} hoja{hojas.length - 3 === 1 ? "" : "s"} más de tirillas.</span>}
            </div>
          </div>
        </details>
        <div className="item fo-item">
          <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="principal">
            <b>Carta de compromiso de la academia (licencias)</b>
            <small>El estudiante se compromete a terminar las clases teóricas y prácticas: sin devolución del dinero, tres meses para terminar el proceso o comprar el pin de nuevo.</small>
            <small className="tenue">Carta · Academia J Y G (transcrita de la copia física)</small>
          </div>
          <AbrirDescargar ruta={PDF_OFICINA.compromiso} />
        </div>
        <details className="llenar-plegable fo-plegable">
          <summary>Vista previa y ajustes: carta de compromiso</summary>
          <div className="pila" style={{ gap: 12, marginTop: 10 }}>
            <div className="fo-opciones"><Copias valor={copiasCompromiso} cambiar={setCopiasCompromiso} /></div>
            <Acciones pedido={{ compromiso: nCompromiso }} nombre={nCompromiso > 1 ? `carta-compromiso-academia-${nCompromiso}-copias.pdf` : "carta-compromiso-academia.pdf"} />
            <div className="fo-vista"><Miniatura titulo="Carta de compromiso"><HojaCompromiso /></Miniatura></div>
          </div>
        </details>
        <div className="item fo-item">
          <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="principal">
            <b>Planilla de entrega de tarjetas de propiedad</b>
            <small>Placa, nombre de quien recibe, cédula, teléfono y firma: queda la constancia por si después dicen que no la recibieron. {FILAS_ENTREGA} filas por hoja.</small>
            <small className="tenue">Carta horizontal · De la oficina (transcrita de la copia física)</small>
          </div>
          <AbrirDescargar ruta={PDF_OFICINA.entrega} />
        </div>
        <details className="llenar-plegable fo-plegable">
          <summary>Vista previa y ajustes: planilla de entrega</summary>
          <div className="pila" style={{ gap: 12, marginTop: 10 }}>
            <div className="fo-opciones">
              <label>Cuántas hojas<input className="input" type="number" min={1} max={20} value={hojasEntrega} onChange={(e) => setHojasEntrega(Number(e.target.value))} aria-label="Cuántas hojas de la planilla" /><small className="tenue">{nEntrega * FILAS_ENTREGA} filas</small></label>
            </div>
            <Acciones pedido={{ entrega: nEntrega }} nombre={`entrega-tarjetas-${nEntrega}-hojas.pdf`} />
            <div className="fo-vista"><Miniatura titulo="Planilla de entrega" horizontal><HojaEntregaTarjetas /></Miniatura></div>
          </div>
        </details>
        <div className="item fo-item">
          <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="principal">
            <b>Acta de pérdida de placa (fabricación de placa por pérdida)</b>
            <small>La llena y firma el dueño (con su huella) para pedir la placa nueva: placa, servicio, organismo, clase, marca, si es una o las dos placas, y cuándo y dónde se perdió.</small>
            <small className="tenue">Carta · Su Placa Vehicular, Cali (rehecha nítida del original, con el mismo texto)</small>
          </div>
          <AbrirDescargar ruta={PDF_OFICINA.placa} />
        </div>
        <details className="llenar-plegable fo-plegable">
          <summary>Vista previa y ajustes: acta de pérdida de placa</summary>
          <div className="pila" style={{ gap: 12, marginTop: 10 }}>
            <div className="fo-opciones"><Copias valor={copiasPlaca} cambiar={setCopiasPlaca} /></div>
            <Acciones pedido={{ placa: nPlaca }} nombre={nPlaca > 1 ? `acta-perdida-placa-${nPlaca}-copias.pdf` : "acta-perdida-placa.pdf"} />
            <div className="fo-vista"><Miniatura titulo="Acta de pérdida de placa"><HojaPlacaPerdida /></Miniatura></div>
          </div>
        </details>
      </div>
    </div>
  );
}
