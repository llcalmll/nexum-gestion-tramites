import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { join } from "node:path";
import { defineConfig } from "vite";

// `npm run dev` levanta la app y el Worker juntos (D1 y R2 locales en .wrangler/state).
// Las pruebas usan otra carpeta (NEXUM_ESTADO) para no tocar los datos de desarrollo.
//
// Workers AI (la voz del asistente) solo existe en la nube. En local queda apagado (la voz responde "no configurada")
// salvo con NEXUM_IA=1, y entonces se conecta con la sesión de afpiraa08 (.wrangler-cuenta): el wrangler "normal" de
// este PC es el de la cuenta del sindicato y el uso quedaría allá. La compilación para producción sí lleva el binding.
const IA_LOCAL = process.env.NEXUM_IA === "1";
// PlacApi cuesta plata y su llave está en .dev.vars: en local apunta a una dirección muerta (falla sin cobrar) salvo
// con NEXUM_PLACAPI=1. Las pruebas que lo necesitan usan su PlacApi falso (PLACAPI_BASE).
const PLACAPI_LOCAL = process.env.NEXUM_PLACAPI === "1";
export const PLACAPI_BLOQUEADA = "http://127.0.0.1:9/placapi-bloqueada-en-local";
if (IA_LOCAL) process.env.XDG_CONFIG_HOME = join(import.meta.dirname, ".wrangler-cuenta");

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      persistState: process.env.NEXUM_ESTADO ? { path: process.env.NEXUM_ESTADO } : true,
      remoteBindings: IA_LOCAL,
      config: (c) => {
        if (command === "serve" && !IA_LOCAL) delete c.ai;
        // Las pruebas pasan su PlacApi falso en NEXUM_PLACAPI_BASE; si no, en local queda bloqueado.
        if (command === "serve" && process.env.NEXUM_PLACAPI_BASE) c.vars = { ...c.vars, PLACAPI_BASE: process.env.NEXUM_PLACAPI_BASE };
        else if (command === "serve" && !PLACAPI_LOCAL) c.vars = { ...c.vars, PLACAPI_BASE: PLACAPI_BLOQUEADA };
      },
    }),
  ],
  server: { port: 5190 },
}));
