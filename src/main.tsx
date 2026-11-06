import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { aplicarTema } from "./datos/preferencias";
import "./estilos/app.css";

// El tema se aplica antes de pintar para que no parpadee, y sigue al sistema en "automático".
aplicarTema();
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", aplicarTema);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
