import { defineConfig } from "drizzle-kit";

// Solo genera el SQL de las migraciones; las aplica wrangler (`npm run migraciones:local` / `:remoto`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./compartido/esquema.ts",
  out: "./migraciones",
});
