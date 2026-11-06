import { Camera, Check, Images, Loader2, PenLine, RotateCcw, ScanLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS_LICENCIA, normalizar } from "../../../compartido/dominio";
import { avisosEdadLicencia, hoyColombia } from "../../../compartido/reglas";
import { api, SesionVencida, SinAcceso, SinConexion } from "../../datos/api";
import { prepararParaSubir } from "../../fotos/procesar";
import { leerDerecha } from "../../logica/foto";
import { CabeceraMovil, Campo, MENSAJE_SESION, SesionCaida, subirFoto } from "./comun";

/*
 * Licencia de conducción desde el celular, paso a paso y en línea recta: tipo (primera vez, renovación...) -> foto de
 * la cédula con teléfono y nacimiento -> categorías (se pueden leer de la licencia actual) -> revisar -> crear.
 * (Los trámites de vehículo se registran con las fotos de sus documentos: Registrador.)
 * Cada foto se lee con la IA (/api/leer) y se sube a una sesión de fotos; el servidor crea todo y pega las fotos a los
 * documentos del trámite (POST /api/movil/tramite). Si el celular se recarga a mitad (pasa al abrir la cámara en
 * algunos iPhone), el avance se recupera.
 */

type Rol = "titular";
interface Tipo { id: string; nombre: string; categoria: string; descripcion: string | null; requiereVehiculo: boolean; requisitos: { documento: string; obligatorio: boolean }[] }
interface Catalogo { tipos: Tipo[]; organismos: { id: string; nombre: string; ciudad: string | null }[]; organismoPorDefecto: string | null }
interface Persona { rol: Rol; tipoDocumento: string; numeroDocumento: string; nombre: string; telefono: string; fechaNacimiento: string; fechaExpedicionDocumento: string; foto?: string; leida?: boolean }
interface Creado { id: string; numero: string; fotos: number; avisos: string[] }
interface Estado {
  sesion: string | null; tipoId: string | null; paso: number; personas: Persona[];
  categorias: string[]; fotoLicencia?: string; cliente: Rol; organismoId: string | null; creado?: Creado;
}
type Datos = Record<string, string | string[]>;

const VACIO: Estado = { sesion: null, tipoId: null, paso: 0, personas: [], categorias: [], cliente: "titular", organismoId: null };
const personaVacia = (rol: Rol): Persona => ({ rol, tipoDocumento: "CC", numeroDocumento: "", nombre: "", telefono: "", fechaNacimiento: "", fechaExpedicionDocumento: "" });
const ROL_TEXTO: Record<Rol, string> = { titular: "del titular" };
const esPrimeraVez = (t: Tipo | undefined) => !!t && /expedicion|recategorizacion/.test(normalizar(t.nombre));
const esMigracion = (t: Tipo | undefined) => !!t && /migracion/.test(normalizar(t.nombre));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const digitos = (v: string) => v.replace(/\D/g, "");

function leerGuardado(clave: string): Estado {
  try { return { ...VACIO, ...JSON.parse(sessionStorage.getItem(clave) ?? "{}") }; } catch { return VACIO; }
}

const aDataUrl = (b: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(new Error("No se pudo leer la foto.")); r.readAsDataURL(b); });
const mensajeError = (e: unknown) => (e instanceof SesionVencida || e instanceof SesionCaida ? MENSAJE_SESION : e instanceof SinAcceso ? "Este correo no tiene acceso." : e instanceof SinConexion ? "Sin conexión: revise el internet." : e instanceof Error ? e.message : String(e));

export function TramiteMovil({ volver }: { volver: () => void }) {
  const clave = "movil-tramite-licencia";
  const [e, setE] = useState<Estado>(() => leerGuardado(clave));
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const poner = (c: Partial<Estado>) => setE((x) => ({ ...x, ...c }));

  useEffect(() => { try { sessionStorage.setItem(clave, JSON.stringify(e)); } catch { /* sin almacenamiento: no se recupera al recargar */ } }, [clave, e]);
  const cargarCatalogo = () => { setError(null); api<Catalogo>("/api/movil/catalogo").then(setCatalogo, (x) => setError(mensajeError(x))); };
  useEffect(cargarCatalogo, []);
  // Sesión de fotos propia de este trámite (las fotos 3x4 van a otra bandeja).
  useEffect(() => {
    if (e.sesion) return;
    api<{ sesion: string }>("/api/fotos/sesiones", { method: "POST" }).then((r) => poner({ sesion: r.sesion }), (x) => setError(mensajeError(x)));
  }, [e.sesion]);

  const tipos = useMemo(() => (catalogo?.tipos ?? []).filter((t) => t.categoria === "licencia"), [catalogo]);
  const tipo = tipos.find((t) => t.id === e.tipoId);
  const pasos = ["tipo", "persona:titular", "categorias", "resumen", "listo"];
  const paso = pasos[Math.min(e.paso, pasos.length - 1)];
  const ir = (n: number) => { setError(null); poner({ paso: n }); window.scrollTo({ top: 0 }); };
  const siguiente = () => ir(e.paso + 1);
  const atras = () => (e.paso > 0 ? ir(e.paso - 1) : volver());
  const persona = (rol: Rol) => e.personas.find((p) => p.rol === rol) ?? personaVacia(rol);
  const ponerPersona = (p: Persona) => setE((x) => ({ ...x, personas: [...x.personas.filter((y) => y.rol !== p.rol), p] }));
  const reiniciar = () => { try { sessionStorage.removeItem(clave); } catch { /* nada */ } setE(VACIO); setError(null); };

  function elegirTipo(t: Tipo) {
    poner({ tipoId: t.id, paso: 1, cliente: "titular", organismoId: e.organismoId ?? catalogo?.organismoPorDefecto ?? null });
  }

  async function crear() {
    if (!tipo) return;
    setCreando(true);
    setError(null);
    try {
      const personas = [persona("titular")].map(({ leida: _l, ...p }) => ({ ...p, foto: p.foto && e.sesion ? `${e.sesion}/${p.foto}` : undefined }));
      const r = await api<Creado>("/api/movil/tramite", {
        method: "POST",
        body: JSON.stringify({
          tipoId: tipo.id, organismoId: e.organismoId, cliente: e.cliente, personas,
          detalle: e.categorias.join(","),
          fotoLicencia: e.fotoLicencia && e.sesion ? `${e.sesion}/${e.fotoLicencia}` : undefined,
        }),
      });
      // Las fotos ya quedaron pegadas al trámite: se borran de la sesión temporal.
      if (e.sesion) api(`/api/fotos/sesiones/${e.sesion}`, { method: "DELETE" }).catch(() => {});
      poner({ creado: r, paso: pasos.indexOf("listo") });
    } catch (x) {
      setError(mensajeError(x));
    } finally {
      setCreando(false);
    }
  }

  const titulo = "Licencia de conducción";
  const numeroPaso = paso === "listo" ? undefined : `Paso ${e.paso + 1} de ${pasos.length - 1}`;
  const aviso = error && <div className="aviso error">{error}{!catalogo && <button className="btn btn-sm" onClick={cargarCatalogo}><RotateCcw size={13} />Reintentar</button>}</div>;

  if (paso === "listo" && e.creado) {
    return (
      <>
        <CabeceraMovil titulo={titulo} />
        <div className="movil-listo">
          <Check size={40} />
          <b>Trámite {e.creado.numero} creado</b>
          <span className="muted">{tipo?.nombre}{e.creado.fotos ? ` · ${e.creado.fotos} foto${e.creado.fotos === 1 ? "" : "s"} pegada${e.creado.fotos === 1 ? "" : "s"} a sus documentos` : ""}. Ya aparece en el PC.</span>
        </div>
        {e.creado.avisos.map((a, i) => <div key={i} className="aviso info">{a}</div>)}
        <button className="btn btn-primario tomar-boton" onClick={reiniciar}>Hacer otro trámite</button>
        <button className="btn tomar-boton tomar-galeria" onClick={() => { reiniciar(); volver(); }}>Volver al inicio</button>
      </>
    );
  }

  return (
    <>
      <CabeceraMovil titulo={titulo} volver={atras} paso={numeroPaso} />
      {aviso}
      {paso === "tipo" && (
        <div className="pila" style={{ gap: 8 }}>
          <p className="muted" style={{ margin: 0 }}>¿Qué trámite va a hacer?</p>
          {!catalogo ? <div className="tenue"><Loader2 size={16} className="girando" /> Cargando…</div>
            : tipos.map((t) => (
              <button key={t.id} className={`movil-opcion${t.id === e.tipoId ? " on" : ""}`} onClick={() => elegirTipo(t)}>
                <b>{t.nombre}</b>
              </button>
            ))}
        </div>
      )}

      {paso.startsWith("persona:") && e.sesion && (() => {
        const rol = paso.slice(8) as Rol;
        return <PasoPersona key={rol} sesion={e.sesion} p={persona(rol)} pedirNacimiento alCambiar={ponerPersona} listo={siguiente} />;
      })()}

      {paso === "categorias" && e.sesion && (
        <PasoCategorias sesion={e.sesion} primeraVez={esPrimeraVez(tipo)} migracion={esMigracion(tipo)} categorias={e.categorias} nacimiento={persona("titular").fechaNacimiento}
          alCambiar={(categorias, fotoLicencia) => poner({ categorias, ...(fotoLicencia ? { fotoLicencia } : {}) })} listo={siguiente} />
      )}

      {paso === "resumen" && (
        <div className="pila" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>Revise y cree el trámite.</p>
          <div className="movil-resumen">
            <div><span className="tenue">Trámite</span><b>{tipo?.nombre}</b></div>
            {(() => { const p = persona("titular"); return <div><span className="tenue">Persona</span><b>{p.nombre}</b>CC {p.numeroDocumento}{digitos(p.telefono) ? ` · Tel. ${digitos(p.telefono)}` : " · sin teléfono"}</div>; })()}
            <div><span className="tenue">Categorías</span><b>{e.categorias.join(", ")}</b></div>
          </div>
          <Campo etiqueta="Organismo de tránsito">
            <select className="input" value={e.organismoId ?? ""} onChange={(x) => poner({ organismoId: x.target.value || null })}>
              <option value="">Sin definir</option>
              {catalogo?.organismos.map((o) => <option key={o.id} value={o.id}>{o.ciudad ? `${o.ciudad} · ${o.nombre}` : o.nombre}</option>)}
            </select>
          </Campo>
          <button className="btn btn-primario tomar-boton" disabled={creando} onClick={crear}>{creando ? <><Loader2 size={18} className="girando" />Creando…</> : <><Check size={18} />Crear trámite</>}</button>
        </div>
      )}
    </>
  );
}

/** Tomar foto o elegirla de la galería; la sube y la lee. `alLeer` recibe los datos (o null si no se pudieron leer). */
function TomarDocumento({ sesion, tipo, foto, texto, alLeer }: { sesion: string; tipo: "cedula" | "licencia"; foto?: string; texto: string; alLeer: (datos: Datos | null, foto: string, error?: string) => void }) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"listo" | "subiendo" | "leyendo">("listo");
  const [error, setError] = useState<string | null>(null);

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setEstado("subiendo");
    try {
      const imagen = await prepararParaSubir(archivo, 2000);
      // Se sube y se lee a la vez.
      const lectura = aDataUrl(imagen).then((dataUrl) => leerDerecha(dataUrl, (foto, baja, derecha) => api<{ datos: Datos; girar?: number }>("/api/leer", { method: "POST", body: JSON.stringify({ tipo, imagen: foto, baja, derecha }) })));
      lectura.catch(() => {}); // si falla, se atiende abajo (sin aviso de promesa sin atender)
      const nombre = await subirFoto(sesion, imagen);
      setEstado("leyendo");
      try {
        alLeer((await lectura).datos, nombre);
      } catch (x) {
        if (x instanceof SesionVencida) throw x;
        alLeer(null, nombre, `No pude leer los datos (${mensajeError(x)}). Escríbalos abajo o tome la foto de nuevo, con buena luz y sin reflejos.`);
      }
    } catch (x) {
      setError(mensajeError(x));
    } finally {
      setEstado("listo");
    }
  }

  return (
    <div className="pila" style={{ gap: 8 }}>
      <div className="tomar-vista movil-doc">
        {foto ? <img src={`/api/fotos/sesiones/${sesion}/${foto}`} alt="Foto del documento" /> : <div className="pila tenue" style={{ alignItems: "center", gap: 6 }}><ScanLine size={44} /><span className="peq">{texto}</span></div>}
        {estado !== "listo" && <div className="tomar-capa"><Loader2 size={28} className="girando" />{estado === "subiendo" ? "Subiendo la foto…" : "Leyendo los datos…"}</div>}
      </div>
      {error && <div className="aviso error">{error}</div>}
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label={`Cámara: ${texto}`} onChange={(x) => { alElegir(x.target.files?.[0]); x.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*" hidden aria-label={`Galería: ${texto}`} onChange={(x) => { alElegir(x.target.files?.[0]); x.target.value = ""; }} />
      <div className="fila" style={{ gap: 8 }}>
        <button className="btn btn-primario" style={{ flex: 1, height: 46, justifyContent: "center" }} disabled={estado !== "listo"} onClick={() => camara.current?.click()}><Camera size={17} />{foto ? "Tomar otra" : "Tomar foto"}</button>
        <button className="btn" style={{ flex: 1, height: 46, justifyContent: "center" }} disabled={estado !== "listo"} onClick={() => galeria.current?.click()}><Images size={17} />Galería</button>
      </div>
    </div>
  );
}

function PasoPersona({ sesion, p, pedirNacimiento, alCambiar, listo }: { sesion: string; p: Persona; pedirNacimiento: boolean; alCambiar: (p: Persona) => void; listo: () => void }) {
  const [aMano, setAMano] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = (k: keyof Persona) => (x: React.ChangeEvent<HTMLInputElement>) => alCambiar({ ...p, [k]: x.target.value });
  const telefono = digitos(p.telefono);
  const valido = p.nombre.trim().length >= 3 && digitos(p.numeroDocumento).length >= 3 && (!telefono || (telefono.length >= 7 && telefono.length <= 12)) && (!pedirNacimiento || /^\d{4}-\d{2}-\d{2}$/.test(p.fechaNacimiento));
  return (
    <div className="pila" style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>Foto de la <b>cédula {ROL_TEXTO[p.rol]}</b>, por el lado de la foto{pedirNacimiento ? " (y si es la cédula nueva, también sirve)" : ""}.</p>
      <TomarDocumento sesion={sesion} tipo="cedula" foto={p.foto} texto={`Cédula ${ROL_TEXTO[p.rol]}`} alLeer={(d, foto, error) => {
        setAviso(error ?? null);
        if (!d) return alCambiar({ ...p, foto });
        alCambiar({
          ...p, foto, leida: true, nombre: str(d.nombreCompleto) || p.nombre, numeroDocumento: digitos(str(d.numeroDocumento)) || p.numeroDocumento,
          tipoDocumento: str(d.tipoDocumento) === "CE" ? "CE" : "CC", fechaNacimiento: str(d.fechaNacimiento) || p.fechaNacimiento, fechaExpedicionDocumento: str(d.fechaExpedicionDocumento) || p.fechaExpedicionDocumento,
        });
      }} />
      {aviso && <div className="aviso info">{aviso}</div>}
      {p.foto || p.leida || aMano || p.nombre ? (
        <div className="pila" style={{ gap: 10 }}>
          <Campo etiqueta="Nombre completo"><input className="input" value={p.nombre} onChange={campo("nombre")} autoCapitalize="characters" /></Campo>
          <Campo etiqueta="Cédula"><input className="input" value={p.numeroDocumento} onChange={campo("numeroDocumento")} inputMode="numeric" /></Campo>
          <Campo etiqueta={`Teléfono ${ROL_TEXTO[p.rol]}`} ayuda="No viene en la cédula: pregúnteselo.">
            <input className="input" type="tel" inputMode="tel" value={p.telefono} onChange={campo("telefono")} placeholder="1000000000" aria-label={`Teléfono ${ROL_TEXTO[p.rol]}`} />
          </Campo>
          {pedirNacimiento && <Campo etiqueta="Fecha de nacimiento" ayuda="La pide la norma para la vigencia de la licencia."><input className="input" type="date" value={p.fechaNacimiento} onChange={campo("fechaNacimiento")} /></Campo>}
          {telefono && (telefono.length < 7 || telefono.length > 12) && <div className="peq" style={{ color: "var(--rojo)" }}>El teléfono debe tener entre 7 y 12 números.</div>}
          <button className="btn btn-primario tomar-boton" disabled={!valido} onClick={listo}>{telefono ? "Continuar" : "Continuar sin teléfono"}</button>
        </div>
      ) : (
        <button className="btn mtr-siguiente" onClick={() => setAMano(true)}><PenLine size={16} />No tengo la foto: escribir a mano</button>
      )}
    </div>
  );
}

function PasoCategorias({ sesion, primeraVez, migracion, categorias, nacimiento, alCambiar, listo }: { sesion: string; primeraVez: boolean; migracion: boolean; categorias: string[]; nacimiento: string; alCambiar: (c: string[], fotoLicencia?: string) => void; listo: () => void }) {
  const [leerLicencia, setLeerLicencia] = useState(false);
  const [foto, setFoto] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | null>(null);
  const edad = avisosEdadLicencia(primeraVez, categorias, nacimiento, hoyColombia(), migracion);
  const alternar = (c: string) => alCambiar(categorias.includes(c) ? categorias.filter((x) => x !== c) : [...categorias, c].sort());
  return (
    <div className="pila" style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>¿Qué categorías?</p>
      <div className="movil-categorias">
        {CATEGORIAS_LICENCIA.map((c) => <button key={c} className={categorias.includes(c) ? "on" : ""} aria-pressed={categorias.includes(c)} onClick={() => alternar(c)}>{c}</button>)}
      </div>
      {!primeraVez && (leerLicencia ? (
        <TomarDocumento sesion={sesion} tipo="licencia" foto={foto} texto="Licencia actual" alLeer={(d, f, error) => {
          setFoto(f);
          setAviso(error ?? null);
          const leidas = Array.isArray(d?.categorias) ? (d!.categorias as string[]).filter((c) => (CATEGORIAS_LICENCIA as readonly string[]).includes(c)) : [];
          alCambiar(leidas.length ? leidas.sort() : categorias, f);
        }} />
      ) : <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setLeerLicencia(true)}><ScanLine size={13} />Leerlas de la licencia actual (foto)</button>)}
      {aviso && <div className="aviso info">{aviso}</div>}
      {edad.bloqueos.map((b, i) => <div key={i} className="aviso error">{b}</div>)}
      {edad.avisos.map((a, i) => <div key={i} className="peq muted">{a}</div>)}
      <button className="btn btn-primario tomar-boton" disabled={!categorias.length || edad.bloqueos.length > 0} onClick={listo}>Continuar</button>
    </div>
  );
}
