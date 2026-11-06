import { useLiveQuery } from "dexie-react-hooks";
import { HelpCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizar } from "../../compartido/dominio";
import { Cabecera, Vacio } from "../componentes/ui";
import { db } from "../datos/db";

type Pregunta = { tema: string; p: string; r: string };

/** El parámetro "faq" es texto: líneas de tema en mayúsculas, y pares "P: ..." / "R: ...". */
function leerFaq(texto: string): Pregunta[] {
  const lista: Pregunta[] = [];
  let tema = "";
  let actual: Pregunta | null = null;
  for (const linea of texto.split("\n").map((l) => l.trim())) {
    if (!linea) continue;
    if (linea.startsWith("P:")) {
      actual = { tema, p: linea.slice(2).trim(), r: "" };
      lista.push(actual);
    } else if (linea.startsWith("R:") && actual) {
      actual.r = linea.slice(2).trim();
    } else if (actual && actual.r && !/^[A-ZÁÉÍÓÚÑ0-9 /()+,.-]+$/.test(linea)) {
      actual.r += ` ${linea}`;
    } else {
      tema = linea;
      actual = null;
    }
  }
  return lista;
}

export default function Ayuda() {
  const faq = useLiveQuery(() => db.parametros.get("faq"), []);
  const [q, setQ] = useState("");
  const preguntas = useMemo(() => leerFaq(faq?.valor ?? ""), [faq]);
  const filtradas = useMemo(() => {
    const n = normalizar(q);
    return n ? preguntas.filter((x) => normalizar(x.tema, x.p, x.r).includes(n)) : preguntas;
  }, [preguntas, q]);
  const temas = [...new Set(filtradas.map((x) => x.tema))];

  return (
    <>
      <Cabecera titulo="Ayuda" sub="Preguntas frecuentes de trámites">
        <div className="buscar" style={{ width: 280 }}>
          <Search size={15} />
          <input className="input" placeholder="Buscar en las preguntas" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Cabecera>
      <div className="contenido">
        {!filtradas.length && <Vacio icono={HelpCircle} titulo={q ? "Ninguna pregunta coincide" : "Todavía no hay preguntas frecuentes"} />}
        {temas.map((t) => (
          <div className="card" key={t} style={{ maxWidth: 860 }}>
            <div className="card-cab"><b>{t || "General"}</b></div>
            <div className="card-cuerpo pila" style={{ gap: 14 }}>
              {filtradas.filter((x) => x.tema === t).map((x) => (
                <div key={x.p}>
                  <b>{x.p}</b>
                  <div className="muted" style={{ marginTop: 2 }}>{x.r}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
