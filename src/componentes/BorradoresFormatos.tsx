import { ClipboardPlus, ExternalLink, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { HojaLeida, PersonaLeida } from "../../compartido/registro";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { CASILLAS_FUN, esIndeterminada, type DatosFormatos, type Formato, type PersonaFormato } from "../formatos/llenado";
import type { FotosFormato } from "../formatos/fotosFormatos";
import { type Hoja, nuevaHoja } from "./Registrador";
import { Panel, useUI } from "./ui";

/*
 * Los borradores de Llenar formatos (lo llenado para alguien que viene después): se guardan en el servidor (los ve
 * cualquier PC de la oficina) y se borran solos a los 5 días de su último guardado. Aquí, la lista para abrirlos o
 * borrarlos, en un panel al lado. Desde un borrador se anota el trámite (el registrador, ya armado con sus datos).
 */

/** `tramiteId`/`tramite`: el trámite del que salió o el que se anotó desde él (su código). */
export interface BorradorResumen { id: string; nombre: string; detalle?: string; guardado: string; vence: string; tramiteId?: string | null; tramite?: string | null }
export interface Borrador extends BorradorResumen { datos: DatosFormatos; elegidos: Formato[]; cambios: Record<string, string>; tramiteId: string | null; tramiteCodigo?: string | null }

/**
 * Lo llenado, como hojas ya leídas para el registrador (Registrar trámite): la tarjeta con el vehículo, el organismo y
 * las personas (propietario y comprador, con su papel) y una nota con los trámites marcados en el punto 3. Así el
 * registrador arma el trámite de una vez y Felipe solo confirma (valor, aliado, precondiciones). Con las fotos con que
 * se llenó (`fotos`), la tarjeta va con la suya y cada cédula como una hoja más: al guardar, quedan en los archivos del
 * trámite (tarjeta de propiedad, cédula del vendedor y del comprador).
 */
export function hojasDeFormatos(d: DatosFormatos, fotos: FotosFormato = {}): Hoja[] {
  const DOC: Record<string, string> = { PA: "Pasaporte" };
  const persona = (p: PersonaFormato | null, rol: string): PersonaLeida | null => {
    if (!p || esIndeterminada(p) || !(p.nombres || p.apellido1 || p.documento)) return null;
    const apellidos = [p.apellido1, p.apellido2].filter(Boolean).join(" ");
    return { rol, nombres: p.nombres, apellidos, nombreCompleto: [p.nombres, apellidos].filter(Boolean).join(" "), tipoDocumento: DOC[p.tipoDocumento] ?? p.tipoDocumento, numeroDocumento: p.documento, telefono: p.telefono, direccion: p.direccion, ciudad: p.ciudad };
  };
  const v = d.vehiculo;
  const tarjeta: HojaLeida = {
    clase: "tarjeta_propiedad", organismo: d.organismo.nombre || d.organismo.ciudad,
    vehiculo: { placa: v.placa, marca: v.marca, linea: v.linea, modelo: v.modelo, clase: v.clase, color: v.color, cilindraje: v.cilindraje, servicio: v.servicio, combustible: v.combustible, motor: v.motor, chasis: v.chasis, serie: v.serie, vin: v.vin, capacidad: v.capacidad, carroceria: v.carroceria, potencia: v.potencia },
    personas: [persona(d.propietario, "propietario"), persona(d.comprador, "comprador")].filter((x): x is PersonaLeida => !!x),
  };
  const tramites = [d.tramiteTexto, ...d.casillas.map((n) => CASILLAS_FUN.find((c) => c.n === n)?.nombre ?? ""), /indeterminad/i.test(d.observaciones) ? "traspaso a persona indeterminada" : ""].filter(Boolean);
  const hoja = (lectura: HojaLeida, foto = ""): Hoja => ({ ...nuevaHoja(foto), estado: "lista", lectura });
  // Las cédulas con foto: la misma persona que en la tarjeta (el registrador las junta por el documento).
  const cedulas = ([["propietario", d.propietario], ["comprador", d.comprador]] as const).flatMap(([rol, p]) => {
    const per = persona(p, rol);
    return fotos[rol] && per ? [hoja({ clase: "cedula", personas: [per] }, fotos[rol])] : [];
  });
  return [hoja(tarjeta, fotos.tarjeta ?? ""), ...cedulas, ...(tramites.length ? [hoja({ clase: "nota", tramites })] : [])];
}

export const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 10_000);
  return min < 1 ? "ahora" : min < 60 ? `hace ${min} min` : min < 24 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`;
};
/** "se borra el sáb. 25 oct." (o "hoy" / "mañana"). */
export const seBorra = (iso: string) => {
  const dia = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const v = new Date(iso), hoy = new Date();
  if (dia(v) === dia(hoy)) return "se borra hoy";
  if (dia(v) === dia(new Date(hoy.getTime() + 10_000_000))) return "se borra mañana";
  return `se borra el ${v.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Bogota" })}`;
};
/** Si el error es de sesión, lleva a entrar otra vez; si no, el mensaje para mostrar. */
export function errorDe(e: unknown) {
  if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
  return e instanceof SinConexion ? "Sin conexión: los borradores se guardan y se abren con internet." : mensajeDe(e);
}

/** La lista de borradores (se recarga al abrir el panel y cuando cambia `version`). */
export function useBorradores(version: number) {
  const [lista, setLista] = useState<BorradorResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try { setLista((await api<{ borradores: BorradorResumen[] }>("/api/formatos-borradores")).borradores); setError(null); }
    catch (e) { setError(errorDe(e)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar, version]);
  return { lista, error, cargar, quitar: (id: string) => setLista((x) => x?.filter((b) => b.id !== id) ?? null) };
}

export function PanelBorradores({ abierto, cerrar, lista, error, actual, abrir, anotar, borrado }: {
  abierto: boolean; cerrar: () => void; lista: BorradorResumen[] | null; error: string | null; actual: string | null;
  abrir: (id: string) => void; anotar: (id: string) => void; borrado: (id: string) => void;
}) {
  const { confirmar, avisar } = useUI();
  const [ocupado, setOcupado] = useState<string | null>(null);
  async function borrar(b: BorradorResumen) {
    if (!(await confirmar({ titulo: `¿Borrar el borrador «${b.nombre}»?`, texto: "Se borran los datos guardados. Lo que ya se imprimió no cambia.", boton: "Borrar", peligro: true }))) return;
    setOcupado(b.id);
    try { await api(`/api/formatos-borradores/${b.id}`, { method: "DELETE" }); borrado(b.id); avisar("Borrador borrado"); }
    catch (e) { avisar(errorDe(e), "error"); } finally { setOcupado(null); }
  }
  return (
    <Panel abierto={abierto} onCerrar={cerrar} ancho={460} cabecera={<div><h2>Borradores</h2><span className="peq muted">Se ven en todos los PC de la oficina y se borran solos a los 5 días.</span></div>}>
      <div className="pila borradores" style={{ gap: 8 }}>
        {error && <div className="aviso error">{error}</div>}
        {!lista ? (!error && <div className="tenue"><Loader2 size={14} className="girando" /> Cargando…</div>)
          : !lista.length ? <div className="peq muted">No hay borradores. Llene los datos y toque <b>Guardar borrador</b>: queda guardado 5 días, listo para imprimir cuando llegue la persona.</div>
          : lista.map((b) => (
            <div key={b.id} className={`borrador${b.id === actual ? " on" : ""}`}>
              <button type="button" className="borrador-abrir" onClick={() => abrir(b.id)} title="Abrir este borrador">
                <b>{b.nombre}</b>
                {b.detalle && <span className="peq">{b.detalle}</span>}
                <small className="tenue">Guardado {hace(b.guardado)} · {seBorra(b.vence)}</small>
                {b.tramiteId && <span className="borrador-tramite peq">Trámite {b.tramite ?? "anotado"}</span>}
              </button>
              {b.tramiteId
                ? <Link className="btn btn-sm" to={`/tramites/${b.tramiteId}`} title="Abrir el expediente del trámite"><ExternalLink size={13} />Ver trámite</Link>
                : <button type="button" className="btn btn-sm" onClick={() => anotar(b.id)} title="Anotar el trámite con los datos de este borrador"><ClipboardPlus size={13} />Anotar trámite</button>}
              {b.id === actual ? <span className="peq borrador-abierto">Abierto</span> : <button type="button" className="btn btn-sm btn-primario" onClick={() => abrir(b.id)}><FolderOpen size={13} />Abrir</button>}
              <button type="button" className="btn btn-sm btn-fantasma btn-icono" aria-label={`Borrar ${b.nombre}`} title="Borrar" disabled={ocupado === b.id} onClick={() => borrar(b)}>
                {ocupado === b.id ? <Loader2 size={14} className="girando" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
      </div>
    </Panel>
  );
}
