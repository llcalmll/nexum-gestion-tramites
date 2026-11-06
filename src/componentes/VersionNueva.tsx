import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

/** El programa de la app que está corriendo (el index-xxxx.js de esta página). Vacío en `vite dev`. */
const actual = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? "";

/**
 * Avisa cuando se publicó una versión nueva de la app: una pestaña abierta desde antes sigue con la vieja hasta que se
 * recarga (por eso se veía el código anterior de las licencias). Mira cada 5 minutos y al volver a la pestaña; no
 * recarga sola, para no perder lo que se esté escribiendo.
 */
export function VersionNueva() {
  const [hay, setHay] = useState(false);
  useEffect(() => {
    const mio = actual();
    if (!mio) return;
    let vivo = true;
    const revisar = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return;
        const nuevo = (await r.text()).match(/\/assets\/index-[^"']+\.js/)?.[0];
        if (vivo && nuevo && !mio.endsWith(nuevo)) setHay(true);
      } catch { /* sin red o sesión vencida: se mira la próxima vez */ }
    };
    const t = setInterval(revisar, 5 * 10_000);
    document.addEventListener("visibilitychange", revisar);
    return () => { vivo = false; clearInterval(t); document.removeEventListener("visibilitychange", revisar); };
  }, []);
  if (!hay) return null;
  return (
    <div className="version-nueva" role="status">
      <span>Hay una versión nueva de la app.</span>
      <button className="btn btn-sm btn-primario" onClick={() => location.reload()}><RefreshCw size={13} />Actualizar</button>
    </div>
  );
}
