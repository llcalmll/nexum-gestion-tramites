import { Download, ExternalLink, FileText, ScanLine, Trash2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { FormatosDelCelular } from "../componentes/FormatosDelCelular";
import { FormatosOficina } from "../componentes/FormatosOficina";
import { Plegable, VistaImagen, VistaPdf } from "../componentes/VistaPdf";
import { Campo, ErrorFormulario, Texto } from "../componentes/formulario";
import { Cabecera, useUI } from "../componentes/ui";
import { api, SesionVencida, SinAcceso, SinConexion } from "../datos/api";
import { escribir, mensajeDe, subirArchivo } from "../datos/escribir";
import { FORMATOS_OFICIALES, vistaPagina } from "../datos/formatos";
import { alVencer } from "../datos/sesion";
import { fecha } from "../logica/formato";

interface FormatoPropio { id: string; nombre: string; descripcion: string | null; archivoNombre: string; archivoTipo: string; archivoBytes: number; creado: string }

const peso = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** La vista previa de un formato subido: PDF por páginas, imagen en una hoja; Word y Excel se abren en su programa. */
function VistaPropio({ f }: { f: FormatoPropio }) {
  const ruta = `/api/formatos/${f.id}/archivo`;
  const pdf = f.archivoTipo === "application/pdf" || /\.pdf$/i.test(f.archivoNombre);
  if (!pdf && !f.archivoTipo.startsWith("image/")) return <small className="tenue fo-sin-vista">Sin vista previa en la app (Word o Excel): ábralo o descárguelo e imprímalo desde su programa.</small>;
  return (
    <Plegable titulo={`Vista previa y ajustes: ${f.nombre}`}>
      {pdf ? <VistaPdf ruta={ruta} nombre={f.archivoNombre} /> : <VistaImagen ruta={ruta} nombre={f.archivoNombre} />}
    </Plegable>
  );
}

/** Formatos para descargar o imprimir: los oficiales van fijos en la app; los propios se suben aquí. */
export default function Formatos() {
  const { confirmar, avisar } = useUI();
  const [propios, setPropios] = useState<FormatoPropio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<{ nombre: string; descripcion: string; archivo: File | null } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    api<FormatoPropio[]>("/api/formatos").then((r) => { setPropios(r); setError(null); }, (e) => {
      if (e instanceof SesionVencida || e instanceof SinAcceso) alVencer(e);
      setError(e instanceof SinConexion ? "Sin conexión: los formatos propios se ven con internet. Los oficiales sí abren." : mensajeDe(e));
    });
  }, []);
  useEffect(cargar, [cargar]);

  async function guardar() {
    if (!nuevo?.archivo) return setErrorNuevo("Elija el archivo.");
    if (!nuevo.nombre.trim()) return setErrorNuevo("Escriba el nombre del formato.");
    setSubiendo(true);
    setErrorNuevo(null);
    try {
      await subirArchivo(`/api/formatos?${new URLSearchParams({ nombre: nuevo.nombre.trim(), descripcion: nuevo.descripcion.trim() })}`, nuevo.archivo);
      avisar("Formato guardado");
      setNuevo(null);
      cargar();
    } catch (e) {
      setErrorNuevo(mensajeDe(e));
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar(f: FormatoPropio) {
    if (!(await confirmar({ titulo: "Borrar formato", texto: `Se borra "${f.nombre}" de la app.`, boton: "Borrar", peligro: true }))) return;
    try { await escribir("DELETE", `/api/formatos/${f.id}`); avisar("Formato borrado"); cargar(); } catch (e) { avisar(mensajeDe(e), "error"); }
  }

  return (
    <>
      <Cabecera titulo="Formatos" sub="Para descargar o imprimir">
        <button className="btn btn-primario" onClick={() => setNuevo({ nombre: "", descripcion: "", archivo: null })}><Upload size={15} />Subir formato</button>
      </Cabecera>
      <div className="contenido">
        <div className="card llenar-entrada">
          <div className="card-cuerpo fila" style={{ gap: 14, alignItems: "center" }}>
            <ScanLine size={26} className="tenue" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <b>Llenar formatos automáticamente</b>
              <div className="peq muted">Formulario único, contratos de mandato y compraventa llenos con los datos de un trámite o de las fotos de la tarjeta de propiedad y las cédulas, listos para imprimir.</div>
            </div>
            <Link className="btn btn-primario" to="/formatos/llenar"><ScanLine size={15} />Llenar formatos</Link>
          </div>
        </div>
        <FormatosDelCelular />
        <div className="card">
          <div className="card-cab"><b>Formatos oficiales</b><span className="peq tenue">Imprimir a tamaño real (100 %), sin "ajustar a la página"</span></div>
          <div className="card-cuerpo lista-filas">
            {FORMATOS_OFICIALES.map((f) => (
              <Fragment key={f.id}>
              <div className="item" style={{ alignItems: "flex-start", gap: 12 }}>
                <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
                <div className="principal">
                  <b>{f.nombre}</b>
                  <small>{f.uso}</small>
                  <small className="tenue">{f.papel} · {f.fuente}</small>
                </div>
                <span className="fila" style={{ gap: 6, flexShrink: 0 }}>
                  <a className="btn btn-sm" href={f.ruta} target="_blank" rel="noreferrer" title="Abrir para ver o imprimir (Ctrl+P)"><ExternalLink size={13} />Abrir</a>
                  <a className="btn btn-sm" href={f.ruta} download title="Descargar el PDF"><Download size={13} />Descargar</a>
                </span>
              </div>
              <Plegable titulo={`Vista previa y ajustes: ${f.corto}`}>
                <VistaPdf ruta={f.ruta} nombre={f.ruta.split("/").pop()!} paginas={f.paginas.map((p, i) => ({ ...p, imagen: vistaPagina(f, i), horizontal: f.horizontal }))}
                  nota={f.paginas.length > 1 && !f.paginas.some((p) => p.vacia) ? "Frente y respaldo van seguidos: a doble cara salen en la misma hoja." : undefined} />
              </Plegable>
              </Fragment>
            ))}
          </div>
        </div>

        <FormatosOficina />

        <div className="card">
          <div className="card-cab"><b>Formatos propios</b><span className="peq tenue">PDF, Word, Excel o imágenes, hasta 20 MB</span></div>
          <div className="card-cuerpo lista-filas">
            {error && <div className="aviso error">{error}</div>}
            {propios?.length === 0 && <div className="peq tenue" style={{ padding: "8px 0" }}>Todavía no hay formatos propios. Con "Subir formato" agregas los que uses (por ejemplo, los de otro organismo de tránsito).</div>}
            {propios?.map((f) => (
              <Fragment key={f.id}>
              <div className="item" style={{ alignItems: "flex-start", gap: 12 }}>
                <FileText size={18} className="tenue" style={{ marginTop: 2, flexShrink: 0 }} />
                <div className="principal">
                  <b>{f.nombre}</b>
                  {f.descripcion && <small>{f.descripcion}</small>}
                  <small className="tenue">{f.archivoNombre} · {peso(f.archivoBytes)} · subido {fecha(f.creado)}</small>
                </div>
                <span className="fila" style={{ gap: 6, flexShrink: 0 }}>
                  <a className="btn btn-sm" href={`/api/formatos/${f.id}/archivo`} target="_blank" rel="noreferrer"><ExternalLink size={13} />Abrir</a>
                  <a className="btn btn-sm" href={`/api/formatos/${f.id}/archivo?descargar`}><Download size={13} />Descargar</a>
                  <button className="btn btn-sm btn-fantasma btn-icono btn-peligro" title="Borrar" onClick={() => borrar(f)}><Trash2 size={14} /></button>
                </span>
              </div>
              <VistaPropio f={f} />
              </Fragment>
            ))}
          </div>
        </div>

        {nuevo && (
          <div className="card">
            <div className="card-cab"><b>Subir formato</b></div>
            <div className="card-cuerpo pila" style={{ gap: 10, maxWidth: 560 }}>
              <Campo etiqueta="Nombre" obligatorio><Texto valor={nuevo.nombre} cambiar={(v) => setNuevo({ ...nuevo, nombre: v })} placeholder="Ej.: Formulario de licencias" autoFocus /></Campo>
              <Campo etiqueta="Para qué sirve" ayuda="Opcional"><Texto valor={nuevo.descripcion} cambiar={(v) => setNuevo({ ...nuevo, descripcion: v })} /></Campo>
              <Campo etiqueta="Archivo" obligatorio>
                <div className="fila" style={{ gap: 8 }}>
                  <input ref={archivoRef} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => { const a = e.target.files?.[0] ?? null; setNuevo({ ...nuevo, archivo: a, nombre: nuevo.nombre || (a?.name.replace(/\.[^.]+$/, "") ?? "") }); }} />
                  <button className="btn" onClick={() => archivoRef.current?.click()}><Upload size={14} />Elegir archivo</button>
                  <span className="peq muted">{nuevo.archivo ? `${nuevo.archivo.name} (${peso(nuevo.archivo.size)})` : "Ningún archivo"}</span>
                </div>
              </Campo>
              <ErrorFormulario error={errorNuevo} />
              <div className="fila" style={{ gap: 8 }}>
                <button className="btn btn-primario" disabled={subiendo} onClick={guardar}>{subiendo ? "Subiendo…" : "Guardar"}</button>
                <button className="btn" onClick={() => { setNuevo(null); setErrorNuevo(null); }}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
