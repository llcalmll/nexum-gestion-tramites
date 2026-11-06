import { Check, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Borrador, PersonaBorrador, VehiculoBorrador } from "../../compartido/registro";
import { api } from "../datos/api";

/*
 * Piezas del formulario de Nuevo trámite (el Registrador en modo `manual`, el mismo del asistente) que consultan la
 * base: elegir un cliente ya guardado, traer los datos de una placa guardada y el cobro sugerido, que se corrige ahí
 * mismo. Van por la API (no por la base del equipo) para que sirvan igual en el PC y en la app del celular.
 */

/** Un cliente guardado, como lo devuelve /api/registrar/personas. */
export interface PersonaGuardada {
  id: string; nombre: string; tipoDocumento: string; numeroDocumento: string; telefono: string | null; direccion: string | null; ciudad: string | null; fechaNacimiento: string | null;
}
export const aBorrador = (c: PersonaGuardada): PersonaBorrador => ({
  nombre: c.nombre ?? "", tipoDocumento: c.tipoDocumento || "CC", numeroDocumento: c.numeroDocumento ?? "", telefono: c.telefono ?? "", direccion: c.direccion ?? "", ciudad: c.ciudad ?? "",
  fechaNacimiento: c.fechaNacimiento ?? "", fechaExpedicionDocumento: "",
});
const detalle = (c: PersonaGuardada) => [c.numeroDocumento ? `${c.tipoDocumento} ${c.numeroDocumento}` : "Sin documento", c.telefono].filter(Boolean).join(" · ");

/** Espera a que se deje de escribir antes de preguntar. */
function useDemorado<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/**
 * Elegir un cliente ya guardado (por nombre, cédula o teléfono) en vez de escribirlo. Si la cédula escrita ya es de un
 * cliente, lo dice y ofrece usar sus datos.
 */
export function ClienteGuardado({ quien, elegido, cedula, elegir, soltar }: {
  quien: string; elegido: boolean; cedula: string; elegir: (c: PersonaGuardada) => void; soltar: () => void;
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<PersonaGuardada[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mismaCedula, setMismaCedula] = useState<PersonaGuardada | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const buscado = useDemorado(q.trim());
  useEffect(() => {
    if (!buscado) { setLista(null); return; }
    let vivo = true;
    setCargando(true);
    api<{ clientes: PersonaGuardada[] }>(`/api/registrar/personas?q=${encodeURIComponent(buscado)}`)
      .then((r) => { if (vivo) setLista(r.clientes); }, () => { if (vivo) setLista([]); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [buscado]);
  const ced = useDemorado(cedula.replace(/\D/g, ""), 400);
  useEffect(() => {
    if (elegido || ced.length < 6) { setMismaCedula(null); return; }
    let vivo = true;
    api<{ clientes: PersonaGuardada[] }>(`/api/registrar/personas?q=${ced}`)
      .then((r) => { if (vivo) setMismaCedula(r.clientes.find((c) => c.numeroDocumento === ced) ?? null); }, () => {});
    return () => { vivo = false; };
  }, [ced, elegido]);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);

  if (elegido) {
    return (
      <div className="form-guardado">
        <Check size={14} /><span className="peq">Cliente ya guardado: se usa ese (lo que escriba de más se le completa).</span>
        <button type="button" className="btn btn-sm btn-fantasma" onClick={soltar}><X size={13} />Es otra persona</button>
      </div>
    );
  }
  return (
    <>
      <div className="buscador form-buscar-guardado" ref={caja}>
        <div className="buscar">
          <Search size={15} />
          <input className="input" value={q} placeholder={`Buscar ${quien} ya guardado: nombre, cédula o teléfono`} aria-label={`Buscar ${quien} ya guardado`}
            onFocus={() => setAbierto(true)} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} />
          {cargando && <Loader2 size={14} className="girando" />}
        </div>
        {abierto && lista && (
          <div className="buscador-lista">
            {lista.map((c) => (
              <button type="button" key={c.id} className="buscador-item" onClick={() => { elegir(c); setQ(""); setAbierto(false); }}>
                <b>{c.nombre}</b><small>{detalle(c)}</small>
              </button>
            ))}
            {!lista.length && <div className="peq tenue" style={{ padding: "8px 10px" }}>No está guardado: escriba sus datos abajo y se crea al guardar.</div>}
          </div>
        )}
      </div>
      {mismaCedula && (
        <div className="form-guardado sugerencia">
          <span className="peq">La cédula {mismaCedula.numeroDocumento} ya es de <b>{mismaCedula.nombre}</b>.</span>
          <button type="button" className="btn btn-sm" onClick={() => elegir(mismaCedula)}>Usar sus datos</button>
        </div>
      )}
    </>
  );
}

/** Si la placa escrita ya está guardada, ofrece llenar el vehículo (y el propietario) con lo que hay. */
export function PlacaGuardada({ placa, vehiculo, usar }: {
  placa: string; vehiculo: VehiculoBorrador; usar: (v: VehiculoBorrador, propietario: PersonaGuardada | null) => void;
}) {
  const [hallado, setHallado] = useState<{ vehiculo: VehiculoBorrador; propietario: PersonaGuardada | null } | null>(null);
  const p = useDemorado(placa, 400);
  useEffect(() => {
    if (p.length < 5) { setHallado(null); return; }
    let vivo = true;
    api<{ vehiculo: VehiculoBorrador | null; propietario: PersonaGuardada | null }>(`/api/registrar/placa/${p}`)
      .then((r) => { if (vivo) setHallado(r.vehiculo ? { vehiculo: r.vehiculo, propietario: r.propietario } : null); }, () => { if (vivo) setHallado(null); });
    return () => { vivo = false; };
  }, [p]);
  if (!hallado || hallado.vehiculo.placa !== placa) return null;
  // Ya se usó (o ya se escribió todo lo que la placa guardada trae): no se ofrece más.
  const falta = (Object.keys(hallado.vehiculo) as (keyof VehiculoBorrador)[]).some((k) => hallado.vehiculo[k] && !vehiculo[k]);
  if (!falta) return null;
  const v = hallado.vehiculo;
  return (
    <div className="form-guardado sugerencia">
      <span className="peq"><b>{placa}</b> ya está guardada ({[v.marca, v.linea, v.modelo].filter(Boolean).join(" ") || "sin más datos"}{hallado.propietario ? `; propietario ${hallado.propietario.nombre}` : ""}).</span>
      <button type="button" className="btn btn-sm" onClick={() => usar(v, hallado.propietario)}>Usar sus datos</button>
    </div>
  );
}

interface CobroSugerido { tipoId: string; lineas: { concepto: string; valor: number }[]; honorarios: number; avisos: string[] }
/** Lo que se manda al guardar: solo los trámites con algún valor corregido. */
export type CostosCorregidos = { tipoId: string; costoDerechos: number; honorarios: number }[];
const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const pesosEnTexto = (s: string) => (s.replace(/\D/g, "") ? pesos(Number(s.replace(/\D/g, ""))) : "");

/**
 * Los costos sugeridos (los mismos cálculos de crear: tarifa del organismo, paz y salvo, retención, honorarios una vez
 * por encargo) y cada valor se corrige ahí mismo. Lo corregido se guarda tal cual; lo demás, como sugiere la tarifa.
 */
export function CobroEditable({ b, tipos, alCambiar }: {
  b: Borrador; tipos: { id: string; nombre: string; categoria: string }[];
  alCambiar: (c: { corregidos: CostosCorregidos; total: number }) => void;
}) {
  const [sugerido, setSugerido] = useState<{ costos: CobroSugerido[]; avisos: string[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Lo corregido a mano: "tipoId|concepto" o "tipoId|honorarios" -> pesos escritos. */
  const [editado, setEditado] = useState<Record<string, string>>({});
  const pedido = useDemorado(JSON.stringify({
    tipoIds: b.tipoIds, organismoId: b.organismoId || null, categorias: b.categorias, conClases: b.conClases || null,
    vehiculo: { placa: b.vehiculo.placa, marca: b.vehiculo.marca, linea: b.vehiculo.linea, modelo: b.vehiculo.modelo, cilindraje: b.vehiculo.cilindraje, clase: b.vehiculo.clase },
  }), 450);
  useEffect(() => {
    if (!b.tipoIds.length) { setSugerido(null); return; }
    let vivo = true;
    setCargando(true); setError(null);
    api<{ costos: CobroSugerido[]; avisos: string[] }>("/api/registrar/cobro", { method: "POST", body: pedido })
      .then((r) => { if (vivo) setSugerido(r); }, () => { if (vivo) setError("No se pudo calcular el cobro sugerido (¿sin conexión?). Puede escribir los valores."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  const costos = (sugerido?.costos ?? []).filter((c) => b.tipoIds.includes(c.tipoId));
  const valor = (clave: string, base: number) => (clave in editado ? Number(editado[clave].replace(/\D/g, "")) || 0 : base);
  const calculado = costos.map((c) => {
    const lineas = c.lineas.map((l) => ({ ...l, clave: `${c.tipoId}|${l.concepto}`, final: valor(`${c.tipoId}|${l.concepto}`, l.valor) }));
    const honorarios = valor(`${c.tipoId}|honorarios`, c.honorarios);
    const corregido = Object.keys(editado).some((k) => k.startsWith(`${c.tipoId}|`));
    return { ...c, lineasFinal: lineas, honorariosFinal: honorarios, corregido };
  });
  const total = calculado.reduce((s, c) => s + c.lineasFinal.reduce((x, l) => x + l.final, 0) + c.honorariosFinal, 0);
  const corregidos: CostosCorregidos = calculado.filter((c) => c.corregido).map((c) => ({ tipoId: c.tipoId, costoDerechos: c.lineasFinal.reduce((x, l) => x + l.final, 0), honorarios: c.honorariosFinal }));
  const firma = JSON.stringify([corregidos, total]);
  useEffect(() => { alCambiar({ corregidos, total }); }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b.tipoIds.length) return null;
  const campo = (clave: string, base: number, etiqueta: string) => (
    <label className={`form-costo${clave in editado ? " editado" : ""}`}>
      <span>{etiqueta}</span>
      <input className="input num" inputMode="numeric" aria-label={etiqueta} value={pesosEnTexto(clave in editado ? editado[clave] : String(base))}
        onChange={(e) => setEditado((x) => ({ ...x, [clave]: e.target.value.replace(/\D/g, "") }))} />
    </label>
  );
  return (
    <div className="cot-vehiculo form-cobro" role="group" aria-label="Cobro">
      <b>Cobro {cargando && <Loader2 size={13} className="girando" />}<span className="peq tenue"> · lo sugerido por la tarifa; corrija el valor que quiera</span></b>
      {error && <div className="peq cot-aviso">{error}</div>}
      {calculado.map((c) => {
        const tipo = tipos.find((t) => t.id === c.tipoId);
        return (
          <div key={c.tipoId} className="form-cobro-tramite">
            <div className="peq"><b>{tipo?.nombre}</b></div>
            {c.lineasFinal.map((l) => <div key={l.clave}>{campo(l.clave, l.valor, l.concepto)}</div>)}
            {/* Las licencias van con su precio todo en una línea. */}
            {(c.honorarios > 0 || tipo?.categoria !== "licencia" || `${c.tipoId}|honorarios` in editado) && campo(`${c.tipoId}|honorarios`, c.honorarios, "Honorarios")}
            {c.avisos.map((a) => <div key={a} className="peq tenue">{a}</div>)}
          </div>
        );
      })}
      {sugerido?.avisos.filter((a) => !/^Cobro sugerido/.test(a)).map((a) => <div key={a} className="peq tenue">{a}</div>)}
      <div className="form-cobro-total">
        <span>Total</span><b>{pesos(total)}</b>
        {Object.keys(editado).length > 0 && <button type="button" className="btn btn-sm btn-fantasma" onClick={() => setEditado({})}>Volver a lo sugerido</button>}
      </div>
    </div>
  );
}
