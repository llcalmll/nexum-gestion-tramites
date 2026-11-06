import { Hammer } from "lucide-react";

/** Aviso de lo que todavía se está construyendo en una pantalla, con la fase en que llega. */
export function Proximamente({ fase, cosas }: { fase: number; cosas: string[] }) {
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-cuerpo fila" style={{ gap: 12, alignItems: "flex-start" }}>
        <span className="tenue" style={{ marginTop: 2 }}><Hammer size={18} /></span>
        <div>
          <b>Llega en la fase {fase}</b>
          <ul className="muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {cosas.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
