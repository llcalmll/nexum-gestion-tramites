import { useEffect, useState } from "react";
import { api } from "../datos/api";

/*
 * Lo que llegó del celular y todavía no se ha visto: los escaneos (el menú los cuenta en "Escáner") y los formatos
 * (en "Formatos"). Se revisa cada 30 segundos con la pantalla a la vista; cada pantalla marca lo suyo como visto.
 */

const CLAVE_VISTO = "escaneos-vistos-hasta";
export const leerVisto = () => { try { return localStorage.getItem(CLAVE_VISTO) ?? ""; } catch { return ""; } };
export const marcarVisto = (iso: string) => { try { if (iso > leerVisto()) localStorage.setItem(CLAVE_VISTO, iso); } catch { /* sin almacenamiento */ } };

const CLAVE_FORMATOS = "formatos-celular-vistos-hasta";
export const leerFormatosVistos = () => { try { return localStorage.getItem(CLAVE_FORMATOS) ?? ""; } catch { return ""; } };
export const marcarFormatosVistos = (iso: string) => { try { if (iso > leerFormatosVistos()) localStorage.setItem(CLAVE_FORMATOS, iso); } catch { /* sin almacenamiento */ } };

export function useFormatosNuevos(enFormatos: boolean) {
  const [nuevos, setNuevos] = useState(0);
  useEffect(() => {
    if (enFormatos) { setNuevos(0); return; }
    const revisar = () => {
      if (document.hidden) return;
      api<{ envios: { subido: string }[] }>("/api/formatos-celular").then((r) => {
        if (!leerFormatosVistos()) marcarFormatosVistos(new Date().toISOString());
        const visto = leerFormatosVistos();
        setNuevos(r.envios.filter((e) => e.subido > visto).length);
      }, () => { /* el aviso no es crítico */ });
    };
    revisar();
    const t = setInterval(revisar, 10_000);
    return () => clearInterval(t);
  }, [enFormatos]);
  return nuevos;
}

export function useEscaneosNuevos(enEscaneos: boolean) {
  const [nuevos, setNuevos] = useState(0);
  useEffect(() => {
    if (enEscaneos) { setNuevos(0); return; }
    const revisar = () => {
      if (document.hidden) return;
      api<{ escaneos: { subido: string }[] }>("/api/escaneos").then((r) => {
        // La primera vez cuenta desde ahora (no todo lo viejo como nuevo).
        if (!leerVisto()) marcarVisto(new Date().toISOString());
        const visto = leerVisto();
        setNuevos(r.escaneos.filter((e) => e.subido > visto).length);
      }, () => { /* el aviso no es crítico */ });
    };
    revisar();
    const t = setInterval(revisar, 10_000);
    return () => clearInterval(t);
  }, [enEscaneos]);
  return nuevos;
}
