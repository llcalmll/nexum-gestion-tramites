import { Calculator, Loader2 } from "lucide-react";
import { motoSinImpuesto, organismoDeTexto, tiposDelTexto } from "../../compartido/reglas";
import { VistaTarjeta } from "./CotizacionEditable";

/*
 * Cotizador de tarjetas de propiedad, como lo hace un tramitador: antes de calcular se confirman los trámites y, por
 * cada vehículo, sus datos, el organismo de tránsito donde está matriculado y el precio de venta. Nada se supone: lo
 * que leyó la IA de la foto es una propuesta que se ve y se corrige; sin organismo no se cotiza.
 */

export interface Catalogo {
  tipos: { id: string; nombre: string; categoria: string }[];
  organismos: { id: string; nombre: string; ciudad: string | null }[];
  /** [tipoId, organismoId]: organismoId null es la tarifa general (sirve en todos). */
  tarifas: [string, string | null][];
}
export interface VehiculoCot {
  clave: number; placa: string; marca: string; linea: string; modelo: string; cilindraje: string; clase: string;
  organismoId: string; precio: string;
  /** Lo que la IA leyó en el campo "organismo de tránsito" de la tarjeta (solo para mostrarlo). */
  leido: string;
  /** La foto adjunta de donde salió (su id en el asistente): para la vista previa de la tarjeta. */
  tarjeta?: number;
}
export interface FormCotizacion { tipoIds: string[]; vehiculos: VehiculoCot[] }

let siguiente = 1;

/** Arma el formulario con lo leído y lo escrito: los trámites que se nombraron y el organismo solo si es claro. */
export function armarCotizacion(cat: Catalogo, texto: string, leidos: Record<string, string>[]): FormCotizacion {
  return {
    tipoIds: tiposDelTexto(cat.tipos, texto).map((t) => t.id),
    vehiculos: leidos.map((d) => ({
      clave: siguiente++, placa: d.placa ?? "", marca: d.marca ?? "", linea: d.linea ?? "", modelo: d.modeloAnio ?? "", cilindraje: d.cilindraje ?? "", clase: d.clase ?? "",
      // Lo que diga la tarjeta; si no dice nada, Ibagué (casi todo se hace allá). Si dice uno que no está en la lista, se elige.
      organismoId: organismoDeTexto(cat.organismos, d.organismoTransito)?.id ?? (d.organismoTransito ? "" : cat.organismos.find((o) => o.ciudad === "Ibagué")?.id ?? ""), precio: "", leido: d.organismoTransito ?? "",
    })),
  };
}

const pesosEnTexto = (s: string) => (s.replace(/\D/g, "") ? `$${Number(s.replace(/\D/g, "")).toLocaleString("es-CO")}` : "");
const ciudad = (o: { nombre: string; ciudad: string | null } | undefined) => o?.ciudad ?? o?.nombre ?? "";

export function CotizadorTarjetas({ cat, form, cambiar, cotizar, cancelar, cotizando, recortes }: {
  cat: Catalogo; form: FormCotizacion; cambiar: (f: FormCotizacion) => void; cotizar: () => void; cancelar: () => void; cotizando: boolean;
  /** La tarjeta recortada de cada foto (por su id): se ve encima de los datos, para compararlos. */
  recortes?: Record<number, { foto: string; encuadrada: boolean } | null>;
}) {
  const deVehiculo = cat.tipos.filter((t) => t.categoria === "vehiculo");
  const elegidos = deVehiculo.filter((t) => form.tipoIds.includes(t.id));
  const traspaso = elegidos.some((t) => /traspaso/i.test(t.nombre));
  const tieneTarifa = (tipoId: string, organismoId: string) => cat.tarifas.some(([t, o]) => t === tipoId && (o === null || o === organismoId));
  const poner = (clave: number, cambios: Partial<VehiculoCot>) => cambiar({ ...form, vehiculos: form.vehiculos.map((v) => (v.clave === clave ? { ...v, ...cambios } : v)) });
  const alternar = (id: string) => cambiar({ ...form, tipoIds: form.tipoIds.includes(id) ? form.tipoIds.filter((x) => x !== id) : [...form.tipoIds, id] });

  const faltan = [
    !form.tipoIds.length && "elija el trámite",
    ...form.vehiculos.filter((v) => !v.organismoId).map((v) => `elija el organismo de ${v.placa || "la tarjeta sin placa"}`),
  ].filter(Boolean) as string[];

  return (
    <div className="bloque-ia cotizador" aria-label="Datos para cotizar">
      <b>Confirme los datos para cotizar</b>
      <div className="cot-titulo">Trámites</div>
      <div className="fila-wrap" style={{ gap: 6 }} role="group" aria-label="Trámites a cotizar">
        {deVehiculo.map((t) => (
          <button key={t.id} type="button" className={`cot-chip${form.tipoIds.includes(t.id) ? " on" : ""}`} aria-pressed={form.tipoIds.includes(t.id)} onClick={() => alternar(t.id)}>{t.nombre}</button>
        ))}
      </div>
      {form.vehiculos.map((v) => {
        const org = cat.organismos.find((o) => o.id === v.organismoId);
        const sinTarifa = org ? elegidos.filter((t) => !tieneTarifa(t.id, org.id)) : [];
        const exenta = motoSinImpuesto({ clase: v.clase, cilindraje: v.cilindraje });
        return (
          <div key={v.clave} className="cot-vehiculo" role="group" aria-label={`Vehículo ${v.placa || "sin placa"}`}>
            {v.tarjeta !== undefined && recortes?.[v.tarjeta] && <VistaTarjeta src={recortes[v.tarjeta]!.foto} placa={v.placa} />}
            {v.tarjeta !== undefined && recortes?.[v.tarjeta] === undefined && <span className="peq tenue"><Loader2 size={12} className="girando" /> Recortando la tarjeta…</span>}
            <div className="cot-campos">
              <label>Placa<input className="input" value={v.placa} onChange={(e) => poner(v.clave, { placa: e.target.value.toUpperCase() })} /></label>
              <label>Clase<input className="input" value={v.clase} onChange={(e) => poner(v.clave, { clase: e.target.value })} /></label>
              <label>Marca<input className="input" value={v.marca} onChange={(e) => poner(v.clave, { marca: e.target.value })} /></label>
              <label>Línea<input className="input" value={v.linea} onChange={(e) => poner(v.clave, { linea: e.target.value })} /></label>
              <label>Modelo<input className="input" inputMode="numeric" value={v.modelo} onChange={(e) => poner(v.clave, { modelo: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
              <label>Cilindraje (cc)<input className="input" inputMode="numeric" value={v.cilindraje} onChange={(e) => poner(v.clave, { cilindraje: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></label>
            </div>
            <label className="cot-largo">Organismo de tránsito (donde está matriculado)
              <select className="input" value={v.organismoId} onChange={(e) => poner(v.clave, { organismoId: e.target.value })} aria-invalid={!v.organismoId}>
                <option value="">Elija el organismo…</option>
                {cat.organismos.map((o) => <option key={o.id} value={o.id}>{ciudad(o)}</option>)}
              </select>
            </label>
            <div className="peq tenue">
              {v.leido
                ? org && org.id === organismoDeTexto(cat.organismos, v.leido)?.id ? `En la tarjeta: «${v.leido}». Confírmelo.` : `En la tarjeta se leyó «${v.leido}»${organismoDeTexto(cat.organismos, v.leido) ? "" : ", que no está en la lista"}: confirme el organismo.`
                : org ? "La tarjeta no dice el organismo: quedó Ibagué. Cámbielo si es otro." : "La tarjeta no dice el organismo: elíjalo."}
            </div>
            {sinTarifa.map((t) => <div key={t.id} className="peq cot-aviso">No hay tarifa de {t.nombre.toLowerCase()} en {ciudad(org)}: saldrá como total parcial.</div>)}
            {traspaso && (
              <label className="cot-largo">Precio de venta
                <input className="input" inputMode="numeric" placeholder="$ 0" value={pesosEnTexto(v.precio)} onChange={(e) => poner(v.clave, { precio: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
                <small className="tenue">
                  {exenta ? "Las motos de 125 cc o menos no tienen avalúo en la base gravable: la retención (1 %) va sobre este precio. Sin él, queda pendiente."
                    : "Opcional: la retención (1 %) va sobre el mayor entre este precio y el avalúo de la base gravable."}
                </small>
              </label>
            )}
          </div>
        );
      })}
      {faltan.length > 0 && <div className="peq cot-aviso">Para cotizar: {faltan.join("; ")}.</div>}
      <div className="fila" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primario" disabled={!!faltan.length || cotizando} onClick={cotizar}>{cotizando ? <Loader2 size={13} className="girando" /> : <Calculator size={13} />}Cotizar</button>
        <button className="btn btn-sm" onClick={cancelar} disabled={cotizando}>Cancelar</button>
      </div>
    </div>
  );
}
