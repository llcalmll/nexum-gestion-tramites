import { Check, ChevronDown, ClipboardCopy, MessageSquareText, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizar } from "../../compartido/dominio";
import { plantillasLicencia, type PlantillaWhatsApp } from "../../compartido/preciosLicencia";
import { Badge, Cabecera, useUI, Vacio } from "../componentes/ui";
import { escribir, mensajeDe } from "../datos/escribir";
import { useParametros } from "../datos/hooks";

/*
 * Plantillas de mensajes (menú Más): los mensajes cortos para responderle al cliente por WhatsApp, listos para copiar
 * y pegar, en desplegables por categoría.
 * - Las de licencias de conducción salen de la tabla de precios; la que Felipe edita queda guardada con su texto
 *   (parámetro plantillas_whatsapp) y se puede volver al original.
 * - Las propias (parámetro plantillas_propias: categoría, título y mensaje) las crea Felipe, en una categoría nueva o
 *   en una que ya exista, y las edita o borra. Los datos de la oficina (cuentas para consignar...) van aquí, no en el
 *   código.
 */

const CLAVE = "plantillas_whatsapp";
const CLAVE_PROPIAS = "plantillas_propias";
const CLAVE_ABIERTOS = "plantillas-abiertas";

/** Lo que trae cada categoría, para saber cuál abrir sin tener que abrirlas todas. */
const DESCRIPCION: Record<string, string> = {
  "Licencia por primera vez": "A2, B1 y C1: mensaje general, sin clases y con clases",
  "Combos": "B1 + A2 y C1 + A2: mensaje general, sin clases y con clases",
  "Refrendación": "Mensaje general, sencilla y doble (todo incluido)",
  "Recategorización": "A C2, sin clases",
  "Duplicado": "Licencia de conducción",
  "Información general": "Horas por día, disponibilidad y requisitos",
};

type Propia = { id: string; grupo: string; titulo: string; texto: string };
type Plant = PlantillaWhatsApp & { propia?: boolean };

function leerJson<T>(valor: string | undefined, vacio: T): T {
  try { const v = JSON.parse(valor ?? ""); return v && typeof v === "object" ? v : vacio; } catch { return vacio; }
}

function leerAbiertos(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CLAVE_ABIERTOS) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Crear o editar un mensaje propio: la categoría (una de las que hay o una nueva), el título y el mensaje. */
function FormMensaje({ inicial, categorias, guardar, cancelar }: { inicial: Omit<Propia, "id">; categorias: string[]; guardar: (p: Omit<Propia, "id">) => Promise<void>; cancelar: () => void }) {
  const [p, setP] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const listo = p.grupo.trim() && p.titulo.trim() && p.texto.trim();
  return (
    <form className="plantilla plantilla-form" aria-label={inicial.titulo ? `Editar ${inicial.titulo}` : "Mensaje nuevo"}
      onSubmit={async (e) => { e.preventDefault(); if (!listo) return; setGuardando(true); await guardar({ grupo: p.grupo.trim(), titulo: p.titulo.trim(), texto: p.texto.trim() }); setGuardando(false); }}>
      <label className="plantilla-campo">
        <span>Categoría <small>(elija una o escriba una nueva)</small></span>
        <input className="input" list="plantillas-categorias" value={p.grupo} placeholder="Ej. Cuentas para consignar" onChange={(e) => setP({ ...p, grupo: e.target.value })} autoFocus={!inicial.grupo} />
        <datalist id="plantillas-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="plantilla-campo">
        <span>Título</span>
        <input className="input" value={p.titulo} placeholder="Ej. Cuenta Bancolombia" onChange={(e) => setP({ ...p, titulo: e.target.value })} autoFocus={!!inicial.grupo && !inicial.titulo} />
      </label>
      <label className="plantilla-campo">
        <span>Mensaje</span>
        <textarea className="input plantilla-editor" value={p.texto} rows={Math.min(16, p.texto.split("\n").length + 3)} placeholder="Estos son los datos…" onChange={(e) => setP({ ...p, texto: e.target.value })} />
      </label>
      <div className="fila plantilla-acciones">
        <button type="submit" className="btn btn-sm btn-primario" disabled={!listo || guardando}><Check size={13} />Guardar</button>
        <button type="button" className="btn btn-sm" onClick={cancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function Plantilla({ p, editada, guardar, editarPropia, borrar }: {
  p: Plant; editada: string | undefined; guardar: (texto: string | null) => Promise<void>; editarPropia?: () => void; borrar?: () => void;
}) {
  const { avisar } = useUI();
  const texto = editada ?? p.texto;
  const [editando, setEditando] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 1600);
    } catch { avisar("No se pudo copiar", "error"); }
  }
  async function listo() {
    if (editando === null) return;
    const limpio = editando.trim();
    // Igual al original (o vacío): se vuelve al original y sigue los precios de la tabla.
    await guardar(!limpio || limpio === p.texto.trim() ? null : limpio);
    setEditando(null);
  }
  return (
    <article className="plantilla" aria-label={p.titulo}>
      <div className="plantilla-cab">
        <b>{p.titulo}</b>
        {editada !== undefined && <Badge tono="ambar">Editada</Badge>}
      </div>
      {editando === null ? (
        <div className="plantilla-burbuja wa-texto">{texto}</div>
      ) : (
        <textarea className="input plantilla-editor" aria-label={`Texto de ${p.titulo}`} value={editando} rows={Math.min(16, editando.split("\n").length + 2)} onChange={(e) => setEditando(e.target.value)} autoFocus />
      )}
      <div className="fila plantilla-acciones">
        {editando === null ? (
          <>
            <button type="button" className={`btn btn-sm ${copiada ? "" : "btn-primario"}`} onClick={copiar}>{copiada ? <><Check size={13} />Copiado</> : <><ClipboardCopy size={13} />Copiar</>}</button>
            <button type="button" className="btn btn-sm" onClick={() => (editarPropia ? editarPropia() : setEditando(texto))}><Pencil size={13} />Editar</button>
            {editada !== undefined && <button type="button" className="btn btn-sm btn-fantasma" title="Deja el texto con los precios de la tabla" onClick={() => guardar(null)}><RotateCcw size={13} />Volver al original</button>}
            {borrar && <button type="button" className="btn btn-sm btn-fantasma btn-icono plantilla-borrar" aria-label={`Borrar ${p.titulo}`} title="Borrar este mensaje" onClick={borrar}><Trash2 size={13} /></button>}
          </>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primario" onClick={listo}><Check size={13} />Guardar</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
          </>
        )}
      </div>
    </article>
  );
}

export default function Plantillas() {
  const { avisar, confirmar } = useUI();
  const params = useParametros();
  const editadas = useMemo(() => leerJson<Record<string, string>>(params[CLAVE], {}), [params]);
  const propias = useMemo(() => { const v = leerJson<Propia[]>(params[CLAVE_PROPIAS], []); return Array.isArray(v) ? v : []; }, [params]);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState(leerAbiertos);
  /** El formulario abierto: uno nuevo (con su categoría, o arriba sin ella) o editando una propia. */
  const [creando, setCreando] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const fijas = useMemo(() => plantillasLicencia(), []);
  // Las propias van después de las de la tabla (en su categoría si ya existe; si no, en una nueva al final).
  const todas: Plant[] = [...fijas, ...propias.map((p) => ({ ...p, propia: true }))];
  const categorias = [...new Set(todas.map((p) => p.grupo))];
  const n = normalizar(q);
  const visibles = todas.filter((p) => !n || normalizar(p.titulo, p.grupo, editadas[p.id] ?? p.texto).includes(n));
  const grupos = [...new Set(visibles.map((p) => p.grupo))];

  function alternar(g: string, abierto: boolean) {
    // Buscando, todo lo que coincide se ve abierto: no se cambia lo que queda recordado.
    if (n) return;
    setAbiertos((a) => {
      const nuevos = abierto ? [...new Set([...a, g])] : a.filter((x) => x !== g);
      try { localStorage.setItem(CLAVE_ABIERTOS, JSON.stringify(nuevos)); } catch { /* sin almacenamiento */ }
      return nuevos;
    });
  }

  async function guardar(id: string, texto: string | null) {
    const { [id]: _, ...resto } = editadas;
    try {
      await escribir("PUT", `/api/config/parametros/${CLAVE}`, { valor: JSON.stringify(texto === null ? resto : { ...resto, [id]: texto }) });
      avisar(texto === null ? "Plantilla original" : "Plantilla guardada");
    } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  async function guardarPropias(lista: Propia[], aviso: string) {
    try {
      await escribir("PUT", `/api/config/parametros/${CLAVE_PROPIAS}`, { valor: JSON.stringify(lista) });
      avisar(aviso);
      return true;
    } catch (e) { avisar(mensajeDe(e), "error"); return false; }
  }
  async function crear(p: Omit<Propia, "id">) {
    if (await guardarPropias([...propias, { ...p, id: `propia_${crypto.randomUUID().slice(0, 8)}` }], "Mensaje creado")) {
      setCreando(null);
      setQ("");
      // Queda abierta su categoría, para verlo.
      if (!abiertos.includes(p.grupo)) alternar(p.grupo, true);
    }
  }
  async function editarPropia(id: string, p: Omit<Propia, "id">) {
    if (await guardarPropias(propias.map((x) => (x.id === id ? { ...x, ...p } : x)), "Mensaje guardado")) {
      setEditandoId(null);
      if (!abiertos.includes(p.grupo)) alternar(p.grupo, true);
    }
  }
  async function borrarPropia(p: Propia) {
    if (!(await confirmar({ titulo: "Borrar el mensaje", texto: `Se borra «${p.titulo}» de ${p.grupo}. No se puede deshacer.`, boton: "Borrar", peligro: true }))) return;
    await guardarPropias(propias.filter((x) => x.id !== p.id), "Mensaje borrado");
  }

  return (
    <>
      <Cabecera titulo="Plantillas de mensajes" sub="Listas para copiar y pegar en WhatsApp. Edite la que quiera (por ejemplo un precio) o cree las suyas: categoría, título y mensaje.">
        <div className="buscar" style={{ width: 280 }}>
          <Search size={15} />
          <input className="input" placeholder="Buscar: A2, combo, cuenta…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primario" onClick={() => { setEditandoId(null); setCreando(""); }}><Plus size={15} />Nuevo mensaje</button>
      </Cabecera>
      <div className="contenido plantillas">
        {creando === "" && (
          <div className="card plantillas-nuevo">
            <FormMensaje inicial={{ grupo: "", titulo: "", texto: "" }} categorias={categorias} guardar={crear} cancelar={() => setCreando(null)} />
          </div>
        )}
        {!visibles.length && <div className="card"><Vacio icono={MessageSquareText} titulo="Ninguna plantilla coincide" /></div>}
        {grupos.map((g) => {
          const del = visibles.filter((p) => p.grupo === g);
          const abierto = !!n || abiertos.includes(g) || creando === g || del.some((p) => p.id === editandoId);
          const nEditadas = del.filter((p) => editadas[p.id] !== undefined).length;
          return (
            <details key={g} className="card plantillas-grupo" open={abierto} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== abierto) alternar(g, o); }}>
              <summary>
                <ChevronDown size={16} className="plantillas-flecha" />
                <span className="plantillas-nombre">
                  <b>{g}</b>
                  <small>{DESCRIPCION[g] ?? del.map((p) => p.titulo).join(" · ")}</small>
                </span>
                {nEditadas > 0 && <Badge tono="ambar">{nEditadas === 1 ? "1 editada" : `${nEditadas} editadas`}</Badge>}
                <span className="plantillas-cuenta">{del.length === 1 ? "1 mensaje" : `${del.length} mensajes`}</span>
              </summary>
              {/* Por licencia (A2, B1…), sus mensajes en una fila: general, sin clases y con clases. */}
              {[...new Set(del.map((p) => p.sub))].map((s) => (
                <div key={s ?? ""} className="plantillas-sub">
                  {s && <h3>{s}</h3>}
                  <div className="plantillas-lista">
                    {del.filter((p) => p.sub === s).map((p) => (p.propia && p.id === editandoId
                      ? <FormMensaje key={p.id} inicial={{ grupo: p.grupo, titulo: p.titulo, texto: p.texto }} categorias={categorias} guardar={(x) => editarPropia(p.id, x)} cancelar={() => setEditandoId(null)} />
                      : <Plantilla key={p.id} p={p} editada={p.propia ? undefined : editadas[p.id]} guardar={(t) => guardar(p.id, t)}
                          editarPropia={p.propia ? () => { setCreando(null); setEditandoId(p.id); } : undefined} borrar={p.propia ? () => void borrarPropia(p as Propia) : undefined} />))}
                    {creando === g && !s && <FormMensaje inicial={{ grupo: g, titulo: "", texto: "" }} categorias={categorias} guardar={crear} cancelar={() => setCreando(null)} />}
                  </div>
                </div>
              ))}
              {/* En una categoría con licencias (todas con su subtítulo), el mensaje nuevo va en su propia fila. */}
              {creando === g && del.every((p) => p.sub) && (
                <div className="plantillas-sub"><div className="plantillas-lista"><FormMensaje inicial={{ grupo: g, titulo: "", texto: "" }} categorias={categorias} guardar={crear} cancelar={() => setCreando(null)} /></div></div>
              )}
              {creando !== g && <button type="button" className="plantillas-agregar" onClick={() => { setEditandoId(null); setCreando(g); }}><Plus size={13} />Agregar un mensaje en {g}</button>}
            </details>
          );
        })}
      </div>
    </>
  );
}
