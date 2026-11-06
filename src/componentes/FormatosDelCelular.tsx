import { Loader2, Printer, ScanLine, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { mensajeDe } from "../datos/escribir";
import { alVencer } from "../datos/sesion";
import { leerFormatosVistos, marcarFormatosVistos } from "./PestanasFotos";
import { useUI } from "./ui";

/*
 * En la pantalla Formatos del PC: los formatos que llegaron del celular (app "Fotos Pira" → Formatos). Aparecen solos
 * (se revisa cada 5 segundos con la pantalla a la vista), los nuevos marcados "Nuevo"; cada uno se abre en Llenar
 * formatos para revisarlo e imprimir. Al lado, el código para abrir la app del celular.
 */

interface Envio { id: string; nombre: string; subido: string }
const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 10_000);
  return min < 1 ? "ahora" : min < 60 ? `hace ${min} min` : min < 24 * 60 ? `hace ${Math.round(min / 60)} h` : new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};

export function FormatosDelCelular() {
  const { confirmar, avisar } = useUI();
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [vistoAntes] = useState(() => leerFormatosVistos() || new Date().toISOString());

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ envios: Envio[] }>("/api/formatos-celular");
      setEnvios(r.envios); setError(null);
      if (r.envios[0]) marcarFormatosVistos(r.envios[0].subido);
    } catch (e) {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: lo del celular se ve con internet." : mensajeDe(e));
    }
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 5000);
    return () => clearInterval(t);
  }, [cargar]);
  useEffect(() => { QRCode.toDataURL(`${location.origin}/fotos/tomar`, { margin: 1, width: 150, errorCorrectionLevel: "M" }).then(setQr, () => {}); }, []);

  async function borrar(e: Envio) {
    if (!(await confirmar({ titulo: `¿Borrar "${e.nombre}"?`, texto: "Se borra lo que mandó el celular. Los formatos ya impresos no cambian.", boton: "Borrar", peligro: true }))) return;
    try { await api(`/api/formatos-celular/${e.id}`, { method: "DELETE" }); setEnvios((x) => x?.filter((y) => y.id !== e.id) ?? null); } catch (err) { avisar(mensajeDe(err), "error"); }
  }

  return (
    <div className="card formatos-celular">
      <div className="card-cab"><Smartphone size={16} className="tenue" /><b>Del celular</b><span className="peq tenue">Llegan solos · se borran a los 15 días</span></div>
      <div className="card-cuerpo formatos-celular-cuerpo">
        <div className="lista-filas" style={{ flex: 1, minWidth: 0 }}>
          {error && <div className="aviso error">{error}</div>}
          {!envios ? <div className="tenue"><Loader2 size={14} className="girando" /> Cargando…</div>
            : !envios.length ? <div className="peq muted" style={{ padding: "6px 0" }}>Aún no ha llegado nada. En el celular: app <b>Fotos Pira</b> → <b>Formatos</b>: fotos de la tarjeta y las cédulas, vista previa y <b>Enviar al PC</b>.</div>
            : envios.map((e) => (
              <div key={e.id} className="item" style={{ gap: 12 }}>
                <Smartphone size={18} className="tenue" style={{ flexShrink: 0 }} />
                <div className="principal">
                  <span className="fila" style={{ gap: 6 }}><b>{e.nombre}</b>{e.subido > vistoAntes && <span className="etiqueta-nuevo">Nuevo</span>}</span>
                  <small>{hace(e.subido)}</small>
                </div>
                {/* Dos botones: revisar (abre los datos y la vista previa) o imprimir de una vez (los abre y manda a imprimir). */}
                <Link className="btn btn-sm" to={`/formatos/llenar?celular=${e.id}`} title="Abrir los datos, las fotos y la vista previa para revisarlos"><ScanLine size={13} />Revisar</Link>
                <Link className="btn btn-sm btn-primario" to={`/formatos/llenar?celular=${e.id}&imprimir=1`} title="Imprimir los formatos de una vez (quedan abiertos para revisarlos)"><Printer size={13} />Imprimir</Link>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Borrar" aria-label={`Borrar ${e.nombre}`} onClick={() => borrar(e)}><Trash2 size={14} /></button>
              </div>
            ))}
        </div>
        <div className="formatos-celular-qr">
          {qr ? <img src={qr} alt="Código para abrir la app del celular" width={120} height={120} /> : <Loader2 className="girando" />}
          <span className="peq muted">App del celular: <b>Fotos Pira</b> → Formatos</span>
        </div>
      </div>
    </div>
  );
}
