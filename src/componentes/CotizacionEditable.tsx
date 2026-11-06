import { ChevronDown, Copy, Eye, Image as Imagen, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { ciudadDe, copiarImagen, tablaCotizacion, textoCliente, vehiculoDe } from "../logica/tablaCotizacion";
import { copiarTexto } from "./Copiar";
import { useUI } from "./ui";

/*
 * La cotización del asistente (y la del cotizador de tarjetas), editable: cada valor y los honorarios se cambian, se
 * quita o se agrega una línea, y el total se recalcula al instante. "Copiar" copia el texto para el cliente (la
 * placa y el modelo, cada concepto y el total; sin el organismo ni el avalúo) y "Copiar imagen", la tabla como en la
 * hoja COTIZACIONES 2026 (logica/tablaCotizacion.ts), las dos con lo editado. Lo editado queda también en el mensaje
 * (si después se le pregunta al asistente, ve los valores nuevos) y en Cotizaciones al guardarla.
 */

export interface LineaCotizacion { tramite: string | null; concepto: string; valor: number }
export interface CotizacionDatos {
  titulo: string; organismo: string; tramite: string;
  /** Por separado (las de antes no los traen: salen del título y del organismo). */
  ciudad?: string | null; placa?: string | null; vehiculo?: string | null; modelo?: number | string | null;
  lineas: LineaCotizacion[]; honorarios: number; honorariosNota: string | null;
  falta: string[]; notas: string[];
  /** El texto con que la entregó la herramienta (para quitarlo de la respuesta y mostrar esto en su lugar). */
  texto: string;
  /** Lo que calculó la herramienta (para "Volver a lo calculado" y marcar lo cambiado) y lo que leyó (placa, vehículo…). */
  original?: { lineas: LineaCotizacion[]; honorarios: number; avaluo?: AvaluoCotizacion; falta?: string[]; datos?: DatosLeidos; titulo?: string };
  /** En traspasos: el avalúo (al escribirlo, la retención sale sola) y las líneas de la base gravable para elegir. */
  avaluo?: AvaluoCotizacion;
}
export interface AvaluoCotizacion {
  pct: number; valor: number | null; linea: string | null; origen: string | null;
  /** Pregunta "¿es esa?": la línea no es idéntica a la de la tarjeta (o es solo una sugerencia, sin cobrar). */
  confirmar: boolean; sugerida: boolean; confirmado?: boolean;
  opciones: { linea: string; valor: number }[];
}

/** Lo que el asistente leyó de la tarjeta o del mensaje y va en la tabla: se corrige a mano si lo leyó mal. */
export interface DatosLeidos { placa: string | null; vehiculo: string | null; modelo: string | null; ciudad: string }
export const datosLeidos = (c: CotizacionDatos): DatosLeidos => ({ ...vehiculoDe(c), ciudad: ciudadDe(c) });

/**
 * La cotización con un dato corregido. El título (el de la cabecera y del texto que ve el asistente) se rehace desde
 * el original: lo leído se reemplaza por lo corregido donde aparezca.
 */
export function conDato(c: CotizacionDatos, campo: keyof DatosLeidos, valor: string, leidos: DatosLeidos, tituloOriginal: string): CotizacionDatos {
  const limpio = campo === "placa" ? valor.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) : campo === "modelo" ? valor.replace(/\D/g, "").slice(0, 4) : campo === "vehiculo" ? valor.toUpperCase() : valor;
  const d: DatosLeidos = { ...datosLeidos(c), [campo]: limpio || (campo === "ciudad" ? "" : null) };
  let titulo = tituloOriginal;
  if (leidos.placa) titulo = titulo.split(leidos.placa).join(d.placa ?? "Sin placa");
  else if (d.placa) titulo = titulo.replace(/\bsin placa\b/i, d.placa);
  if (leidos.vehiculo && d.vehiculo?.trim()) titulo = titulo.split(leidos.vehiculo).join(d.vehiculo.trim());
  if (leidos.modelo && d.modelo) titulo = titulo.split(`modelo ${leidos.modelo}`).join(`modelo ${d.modelo}`);
  return { ...c, ...d, titulo };
}

const RETENCION = /^Retención en la fuente/i;
/**
 * La cotización con otro avalúo: la retención es el porcentaje del avalúo (la línea se crea si no estaba, al final de
 * los del traspaso, y se quita con el avalúo en 0); con avalúo ya no falta "el precio de venta (para la retención)".
 */
export function conAvaluo(c: CotizacionDatos, valor: number | null, linea: string | null, origen: string | null): CotizacionDatos {
  const a = c.avaluo!;
  const retencion = valor ? Math.round((valor * a.pct) / 100) : 0;
  let lineas = c.lineas;
  const i = lineas.findIndex((l) => RETENCION.test(l.concepto));
  if (i >= 0) lineas = retencion ? lineas.map((l, k) => (k === i ? { ...l, valor: retencion } : l)) : lineas.filter((_, k) => k !== i);
  else if (retencion) {
    const tramite = lineas.find((l) => l.tramite && /traspaso/i.test(l.tramite))?.tramite ?? null;
    const despues = tramite ? lineas.map((l) => l.tramite).lastIndexOf(tramite) + 1 : lineas.length;
    lineas = [...lineas.slice(0, despues), { tramite, concepto: `Retención en la fuente (${a.pct}%)`, valor: retencion }, ...lineas.slice(despues)];
  }
  return { ...c, lineas, falta: valor ? c.falta.filter((f) => !/precio de venta/i.test(f)) : c.falta, avaluo: { ...a, valor, linea, origen, confirmado: true } };
}

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-CO")}`;
export const totalCotizacion = (c: CotizacionDatos) => c.lineas.reduce((s, l) => s + (l.valor || 0), 0) + (c.honorarios || 0);

/** La cotización en texto, como la entrega la oficina (con los valores editados). */
export function textoCotizacion(c: CotizacionDatos, n = 0) {
  const lineas: string[] = [];
  let actual: string | null = null;
  for (const l of c.lineas) {
    if (l.tramite && l.tramite !== actual) { actual = l.tramite; lineas.push(`${l.tramite}:`); }
    lineas.push(`${l.tramite ? "  " : ""}${l.concepto}: ${pesos(l.valor)}`);
  }
  const total = totalCotizacion(c);
  return [
    `**${n ? `${n}. ` : ""}${c.titulo}**`, `Organismo: ${c.organismo}`, ...lineas,
    // Una licencia lleva su precio todo en una línea: sin "Honorarios: $0".
    c.honorarios || c.honorariosNota ? `Honorarios${c.honorariosNota ? ` (${c.honorariosNota})` : ""}: ${pesos(c.honorarios)}` : "",
    c.falta.length ? `**Total parcial: ${pesos(total)}** (falta ${c.falta.join(" y ")})` : `**Total: ${pesos(total)}**`,
    // El "OJO" del avalúo es para la oficina (confirmar en el SIBGA), no para el cliente.
    ...c.notas.filter((x) => !/^OJO:/.test(x)),
  ].filter(Boolean).join("\n");
}

/**
 * Lo que dijo el asistente sin la cotización (que se muestra aparte, editable). Si la copió tal cual, se quita entera;
 * si no, se quitan las líneas con valores en pesos y las del encabezado.
 */
export function sinCotizacion(texto: string, cotizaciones: CotizacionDatos[]) {
  let t = texto;
  for (const c of cotizaciones) {
    const variantes = [c.texto, ...[1, 2, 3, 4, 5, 6].map((i) => c.texto.replace(/^\*\*/, `**${i}. `))];
    for (const v of variantes) t = t.split(v).join("");
  }
  const lineas = t.split("\n").filter((l) => !/\$\s?\d/.test(l) && !/^\s*Organismo:/i.test(l) && !cotizaciones.some((c) => l.includes(c.titulo)) && !c_esNota(l, cotizaciones));
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const c_esNota = (l: string, cotizaciones: CotizacionDatos[]) => cotizaciones.some((c) => c.notas.some((n) => l.trim() === n.trim()));

/** La vista previa de una tarjeta de propiedad (cotizar por fotos): pequeña; al tocarla, grande. */
export function VistaTarjeta({ src, placa }: { src: string; placa?: string | null }) {
  const [grande, setGrande] = useState(false);
  const [falla, setFalla] = useState(false);
  if (falla) return null;
  const nombre = `Tarjeta de propiedad${placa ? ` de ${placa}` : ""}`;
  return (
    <button type="button" className={`cot-tarjeta${grande ? " grande" : ""}`} aria-expanded={grande} title={grande ? "Achicar" : "Ver la tarjeta en grande"} onClick={() => setGrande(!grande)}>
      <img src={src} alt={nombre} onError={() => setFalla(true)} />
    </button>
  );
}

export function CotizacionEditable({ c, n, cambiar, tarjeta }: { c: CotizacionDatos; n?: number; cambiar: (c: CotizacionDatos) => void; tarjeta?: string }) {
  const { avisar } = useUI();
  const [nueva, setNueva] = useState<{ concepto: string; valor: string } | null>(null);
  const [verTabla, setVerTabla] = useState(false);
  const original = c.original ?? { lineas: c.lineas, honorarios: c.honorarios, avaluo: c.avaluo, falta: c.falta, datos: datosLeidos(c), titulo: c.titulo };
  const con = (x: Partial<CotizacionDatos>) => cambiar({ ...c, original, ...x });
  const total = totalCotizacion(c);
  const editada = JSON.stringify({ l: c.lineas, h: c.honorarios, a: c.avaluo?.valor }) !== JSON.stringify({ l: original.lineas, h: original.honorarios, a: original.avaluo?.valor });
  const ponerAvaluo = (valor: number | null, linea: string | null, origen: string | null) => cambiar({ ...conAvaluo(c, valor, linea, origen), original });
  // Cambiada: nueva o con otro valor que el calculado (por su concepto: quitar una no marca las de abajo).
  const cambiada = (i: number) => { const l = c.lineas[i], o = original.lineas.find((x) => x.concepto === l.concepto && x.tramite === l.tramite); return !o || o.valor !== l.valor; };
  let actual: string | null = null;
  return (
    <div className="cot-editable">
      <div className="cot-editable-cab">
        <b>{n ? `${n}. ` : ""}{c.titulo}</b>
        <small>{c.organismo}</small>
      </div>
      {tarjeta && <VistaTarjeta src={tarjeta} placa={c.placa} />}
      <DatosEditables c={c} leidos={original.datos ?? datosLeidos(c)} poner={(campo, v) => {
        // Las cotizaciones editadas antes de esto no guardaban lo leído: se toma como leído lo que tienen ahora.
        const o = { ...original, datos: original.datos ?? datosLeidos(c), titulo: original.titulo ?? c.titulo };
        cambiar({ ...conDato(c, campo, v, o.datos, o.titulo), original: o });
      }}
        volver={() => cambiar({ ...c, ...original.datos, titulo: original.titulo ?? c.titulo, original })} />
      <div className="cot-editable-lineas">
        {c.lineas.map((l, i) => {
          const grupo = l.tramite && l.tramite !== actual ? (actual = l.tramite) : null;
          return (
            <div key={i} className="cot-editable-grupo">
              {grupo && <div className="cot-editable-tramite">{grupo}</div>}
              <div className={`cot-editable-linea${cambiada(i) ? " cambiada" : ""}`}>
                <span className="cot-editable-concepto">{l.concepto}</span>
                <Valor valor={l.valor} etiqueta={l.concepto} cambiar={(v) => con({ lineas: c.lineas.map((x, k) => (k === i ? { ...x, valor: v } : x)) })} />
                <button type="button" className="cot-editable-quitar" aria-label={`Quitar ${l.concepto}`} title="Quitar esta línea" onClick={() => con({ lineas: c.lineas.filter((_, k) => k !== i) })}><X size={12} /></button>
              </div>
            </div>
          );
        })}
        {nueva ? (
          <div className="cot-editable-linea nueva">
            <input className="cot-editable-nombre" autoFocus placeholder="Concepto (ej. Envío)" value={nueva.concepto} onChange={(e) => setNueva({ ...nueva, concepto: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Escape") setNueva(null); }} aria-label="Concepto de la línea nueva" />
            <Valor valor={Number(nueva.valor) || 0} etiqueta="la línea nueva" cambiar={(v) => setNueva({ ...nueva, valor: String(v) })} />
            <button type="button" className="btn btn-sm btn-primario" disabled={!nueva.concepto.trim()}
              onClick={() => { con({ lineas: [...c.lineas, { tramite: null, concepto: nueva.concepto.trim(), valor: Number(nueva.valor) || 0 }] }); setNueva(null); }}>Agregar</button>
          </div>
        ) : (
          <button type="button" className="cot-editable-agregar" onClick={() => setNueva({ concepto: "", valor: "" })}><Plus size={12} />Agregar línea</button>
        )}
        {c.avaluo && <AvaluoEditable a={c.avaluo} cambiado={c.avaluo.valor !== original.avaluo?.valor} poner={ponerAvaluo} confirmar={() => con({ avaluo: { ...c.avaluo!, confirmado: true } })} />}
        <div className={`cot-editable-linea honorarios${c.honorarios !== original.honorarios ? " cambiada" : ""}`}>
          <span className="cot-editable-concepto">Honorarios{c.honorariosNota ? <small> ({c.honorariosNota})</small> : null}</span>
          <Valor valor={c.honorarios} etiqueta="los honorarios" cambiar={(v) => con({ honorarios: v })} />
          <span className="cot-editable-quitar-vacio" />
        </div>
      </div>
      <div className="cot-editable-total">
        <span>{c.falta.length ? "Total parcial" : "Total"}</span>
        <b key={total} className="cot-editable-suma">{pesos(total)}</b>
      </div>
      {c.falta.length > 0 && <div className="peq cot-aviso">Falta {c.falta.join(" y ")}.</div>}
      {/* El "OJO" del avalúo (otra versión encaja igual con otro valor) va resaltado: hay que confirmarlo antes de cobrar. */}
      {c.notas.map((x) => (/^OJO:/.test(x) ? <div key={x} className="aviso cot-ojo" role="note">{x}</div> : <div key={x} className="peq tenue">{x}</div>))}
      {verTabla && <img className="cot-tabla" src={tablaCotizacion(c).toDataURL("image/png")} alt="La cotización en tabla" />}
      <div className="fila-wrap" style={{ gap: 6 }}>
        <button type="button" className="btn btn-sm" title="El texto para el cliente: la placa y el modelo, cada concepto y el total" onClick={async () => { if (await copiarTexto(textoCliente(c))) avisar("Cotización copiada"); }}><Copy size={13} />Copiar</button>
        <button type="button" className="btn btn-sm" title="La tabla como en la hoja de cotizaciones, para pegarla en WhatsApp" onClick={async () => {
          try {
            const v = vehiculoDe(c);
            const r = await copiarImagen(c, `Cotización ${v.placa ?? v.vehiculo ?? c.tramite}`);
            if (r === "copiada") avisar("Imagen de la tabla copiada: péguela en WhatsApp");
            else if (r === "descargada") avisar("Este navegador no deja copiar imágenes: quedó descargada");
          } catch { avisar("No se pudo copiar la imagen", "error"); }
        }}><Imagen size={13} />Copiar imagen</button>
        <button type="button" className="btn btn-sm btn-fantasma" aria-pressed={verTabla} onClick={() => setVerTabla((x) => !x)}><Eye size={13} />{verTabla ? "Ocultar tabla" : "Ver tabla"}</button>
        {editada && <button type="button" className="btn btn-sm btn-fantasma" onClick={() => cambiar({ ...c, lineas: original.lineas, honorarios: original.honorarios, avaluo: original.avaluo, falta: original.falta ?? c.falta, original })} title="Deja los valores que calculó el asistente"><RotateCcw size={13} />Volver a lo calculado</button>}
      </div>
    </div>
  );
}

const CAMPOS_LEIDOS: { campo: keyof DatosLeidos; etiqueta: string; ayuda: string }[] = [
  { campo: "placa", etiqueta: "Placa", ayuda: "ABC123" },
  { campo: "vehiculo", etiqueta: "Vehículo (marca y línea)", ayuda: "HYUNDAI ACCENT GL" },
  { campo: "modelo", etiqueta: "Modelo", ayuda: "2013" },
  { campo: "ciudad", etiqueta: "Ciudad (arriba en la tabla)", ayuda: "Ibagué" },
];

/**
 * Lo que el asistente leyó (de la foto de la tarjeta o del mensaje) y va en la tabla y en el texto: la placa, el
 * vehículo, el modelo y la ciudad. Plegado muestra cómo quedó; abierto se corrige si lo leyó mal (y se puede volver a
 * lo leído). Lo corregido sale en "Copiar", "Copiar imagen" y en lo que ve el asistente si se le sigue preguntando.
 */
function DatosEditables({ c, leidos, poner, volver }: { c: CotizacionDatos; leidos: DatosLeidos; poner: (campo: keyof DatosLeidos, valor: string) => void; volver: () => void }) {
  const d = datosLeidos(c);
  const corregidos = CAMPOS_LEIDOS.filter(({ campo }) => (d[campo] ?? "") !== (leidos[campo] ?? ""));
  const resumen = [d.placa ?? "Sin placa", d.vehiculo, d.modelo && `modelo ${d.modelo}`, d.ciudad].filter(Boolean).join(" · ");
  return (
    <details className={`cot-datos${corregidos.length ? " corregidos" : ""}`}>
      <summary>
        <ChevronDown size={13} className="cot-datos-flecha" />
        <span className="cot-datos-resumen">{resumen}</span>
        <span className="cot-datos-accion">{corregidos.length ? `Corregido (${corregidos.map((x) => x.etiqueta.split(" ")[0].toLowerCase()).join(", ")})` : "Corregir lo leído"}</span>
      </summary>
      <div className="cot-datos-campos">
        {CAMPOS_LEIDOS.map(({ campo, etiqueta, ayuda }) => (
          <label key={campo} className={`cot-datos-campo${corregidos.some((x) => x.campo === campo) ? " cambiada" : ""}`}>
            <span>{etiqueta}</span>
            <input className="input" value={d[campo] ?? ""} placeholder={ayuda} inputMode={campo === "modelo" ? "numeric" : undefined}
              onChange={(e) => poner(campo, e.target.value)} onFocus={(e) => e.target.select()} />
            {corregidos.some((x) => x.campo === campo) && <small className="tenue">Leído: {leidos[campo] || "(nada)"}</small>}
          </label>
        ))}
      </div>
      {corregidos.length > 0 && <button type="button" className="btn btn-sm btn-fantasma" onClick={volver}><RotateCcw size={13} />Volver a lo leído</button>}
    </details>
  );
}

/**
 * El avalúo comercial del traspaso: se escribe y la retención sale sola. Si salió de una línea que no es idéntica a la de
 * la tarjeta (o es solo una sugerencia, sin cobrar), pregunta "¿es esa?" con Sí / No y las otras líneas para elegir.
 */
function AvaluoEditable({ a, cambiado, poner, confirmar }: { a: AvaluoCotizacion; cambiado: boolean; poner: (valor: number | null, linea: string | null, origen: string | null) => void; confirmar: () => void }) {
  const [otras, setOtras] = useState(false);
  const preguntar = a.confirmar && !a.confirmado;
  const sugerida = a.sugerida && !a.confirmado ? a.opciones[0] : null;
  const usar = (o: { linea: string; valor: number }) => { poner(o.valor, o.linea, `base gravable: ${o.linea}`); setOtras(false); };
  return (
    <div className="cot-avaluo">
      <div className={`cot-editable-linea avaluo${cambiado ? " cambiada" : ""}`}>
        <span className="cot-editable-concepto">Avalúo comercial <small>(la retención sale sola: {a.pct} %)</small></span>
        <Valor valor={a.valor ?? 0} etiqueta="avalúo comercial" cambiar={(v) => poner(v || null, null, v ? "escrito a mano" : null)} />
        <span className="cot-editable-quitar-vacio" />
      </div>
      {a.valor ? <small className="tenue">{a.origen ?? ""}{a.origen ? " · " : ""}Retención {pesos(Math.round((a.valor * a.pct) / 100))}; si el precio de venta es mayor, va sobre el precio.</small> : null}
      {preguntar && (
        <div className="aviso cot-ojo" role="group" aria-label="Confirmar el avalúo">
          {sugerida
            ? <span>No está la línea de la tarjeta en la base gravable. La más parecida: <b>{sugerida.linea}</b>, {pesos(sugerida.valor)} (retención {pesos(Math.round((sugerida.valor * a.pct) / 100))}). ¿Es esa?</span>
            : <span>Tomé la más parecida de la base gravable: <b>{a.linea}</b>, {pesos(a.valor ?? 0)}. ¿Es esa?</span>}
          <span className="fila-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-primario" onClick={() => (sugerida ? usar(sugerida) : confirmar())}>Sí{sugerida ? ", usarla" : ""}</button>
            <button type="button" className="btn btn-sm" onClick={() => { if (!sugerida) poner(null, null, null); else confirmar(); setOtras(true); }}>No, es otra</button>
          </span>
        </div>
      )}
      {(otras || (preguntar && a.opciones.length > (sugerida ? 1 : 0))) && a.opciones.filter((o) => o !== sugerida).length > 0 && (
        <div className="cot-avaluo-opciones">
          <small className="tenue">Otras líneas parecidas (o escriba el avalúo del SIBGA arriba):</small>
          {a.opciones.filter((o) => o !== sugerida).map((o) => (
            <button key={o.linea} type="button" className="btn btn-sm btn-fantasma" onClick={() => usar(o)}>Usar {o.linea}: {pesos(o.valor)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Un valor en pesos que se escribe con sus puntos (1.234.567) y se guarda como número. */
function Valor({ valor, etiqueta, cambiar }: { valor: number; etiqueta: string; cambiar: (v: number) => void }) {
  return (
    <span className="cot-editable-valor">
      <span>$</span>
      <input inputMode="numeric" value={valor ? valor.toLocaleString("es-CO") : ""} placeholder="0" aria-label={`Valor de ${etiqueta}`}
        onChange={(e) => cambiar(Number(e.target.value.replace(/\D/g, "").slice(0, 12)) || 0)} onFocus={(e) => e.target.select()} />
    </span>
  );
}
