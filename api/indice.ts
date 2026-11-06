/**
 * Worker de Nexum Tránsito. Atiende /api/*; el resto (la app) lo sirven los archivos estáticos,
 * que no pasan por aquí y no cuentan como petición.
 *
 * Toda ruta pasa por Access (acceso.ts), menos POST /api/whatsapp/webhook: ese lo llama Kapso, que no puede
 * poner el PIN, y se protege con la firma de Kapso (rutas/whatsapp.ts). En Access tiene su propia aplicación con "Bypass".
 * El detalle de cada grupo de rutas está al inicio de su archivo en rutas/.
 */
import { drizzle } from "drizzle-orm/d1";
import type { RespuestaEstado } from "../compartido/tipos";
import { autorizar, type EnvAcceso } from "./acceso";
import { error, ErrorApi, json } from "./http";
import * as A from "./rutas/apoyo";
import { conversar, cotizarVarios, transcribir } from "./rutas/asistente";
import * as B from "./rutas/bandeja";
import * as Conv from "./rutas/conversaciones";
import * as Cot from "./rutas/cotizaciones";
import * as Sob from "./rutas/envios";
import * as M from "./rutas/movil";
import * as MT from "./rutas/movilTramites";
import * as Rg from "./rutas/registrar";
import * as Rv from "./rutas/revision";
import { cambios, versionActual } from "./rutas/cambios";
import * as C from "./rutas/config";
import * as Q from "./rutas/consultas";
import * as Doc from "./rutas/documentos";
import * as F from "./rutas/formatos";
import { leerDocumento } from "./rutas/aumento";
import * as Es from "./rutas/escaneos";
import * as FB from "./rutas/formatosBorradores";
import * as FC from "./rutas/formatosCelular";
import * as FV from "./rutas/formatosVivo";
import * as FF from "./rutas/formatosFotos";
import * as N from "./rutas/notas";
import { guardarDatosLeidos } from "./rutas/datosLeidos";
import * as Fo from "./rutas/fotos";
import { elegirDerecha, leer } from "./rutas/leer";
import * as P from "./rutas/personas";
import * as T from "./rutas/tramites";
import * as W from "./rutas/whatsapp";
import { leerJson, type Db } from "./util";

export interface Env extends EnvAcceso, Q.EnvConsultas, W.EnvWhatsApp {
  DB: D1Database;
  ARCHIVOS: R2Bucket;
  OPENAI_API_KEY?: string;
  /** Modelo del lector de documentos (por defecto gpt-4o). */
  LECTOR_MODELO?: string;
  /** Modelo que relee las hojas escritas a mano (por defecto gpt-5; "no" para no releer). */
  LECTOR_MODELO_A_MANO?: string;
  /** Workers AI (voz del asistente). */
  AI?: Ai;
}

interface Contexto { db: Db; env: Env; req: Request; url: URL; p: string[]; correo: string; ctx: ExecutionContext }
type Manejador = (c: Contexto) => Promise<Response>;

const ID = "([A-Za-z0-9_-]{1,64})";
const cuerpo = (c: Contexto) => leerJson(c.req);

/** [método, patrón, manejador]. Los grupos del patrón llegan en c.p. */
const RUTAS: [string, RegExp, Manejador][] = [
  ["GET", /^\/api\/estado$/, async (c) => json({ app: "nexum", correo: c.correo, version: await versionActual(c.db) } satisfies RespuestaEstado)],
  ["GET", /^\/api\/cambios$/, (c) => cambios(c.db, c.url)],
  ["POST", /^\/api\/leer$/, async (c) => leer(c.db, c.env.OPENAI_API_KEY, await leerJson(c.req, 7_500_000), c.env.LECTOR_MODELO, c.env.LECTOR_MODELO_A_MANO)],
  ["POST", /^\/api\/leer\/derecha$/, async (c) => elegirDerecha(c.db, c.env.OPENAI_API_KEY, await leerJson(c.req, 7_500_000))],
  ["POST", /^\/api\/aumento\/leer$/, async (c) => leerDocumento(c.db, c.env.OPENAI_API_KEY, await leerJson(c.req, 7_500_000))],
  ["POST", /^\/api\/asistente$/, async (c) => conversar(c.db, c.env.OPENAI_API_KEY, await leerJson(c.req, 10_000), c.env.OPENAI_BASE, c.env)],
  ["POST", /^\/api\/asistente\/voz$/, (c) => transcribir(c.env.AI, c.req)],
  ["POST", /^\/api\/cotizar$/, async (c) => cotizarVarios(c.db, await cuerpo(c))],
  ["GET", /^\/api\/cotizaciones$/, (c) => Cot.listar(c.db)],
  ["POST", /^\/api\/cotizaciones$/, async (c) => Cot.guardar(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/cotizaciones/${ID}$`), async (c) => Cot.renombrar(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/cotizaciones/${ID}$`), (c) => Cot.borrar(c.db, c.env.ARCHIVOS, c.p[0])],
  ["GET", new RegExp(`^/api/cotizaciones/${ID}/tarjetas$`), (c) => Cot.tarjetas(c.env.ARCHIVOS, c.p[0])],
  ["PUT", new RegExp(`^/api/cotizaciones/${ID}/tarjetas/([0-9])$`), (c) => Cot.subirTarjeta(c.db, c.env.ARCHIVOS, c.p[0], c.p[1], c.req)],
  ["GET", new RegExp(`^/api/cotizaciones/${ID}/tarjetas/([0-9])$`), (c) => Cot.verTarjeta(c.env.ARCHIVOS, c.p[0], c.p[1])],
  ["GET", /^\/api\/conversaciones$/, (c) => Conv.listar(c.db)],
  ["GET", new RegExp(`^/api/conversaciones/${ID}$`), (c) => Conv.ver(c.db, c.p[0])],
  ["PUT", new RegExp(`^/api/conversaciones/${ID}$`), async (c) => Conv.guardar(c.db, c.p[0], await leerJson(c.req, 100_000))],
  ["DELETE", new RegExp(`^/api/conversaciones/${ID}$`), (c) => Conv.borrar(c.db, c.p[0])],
  ["GET", /^\/api\/movil\/catalogo$/, async (c) => {
    // El catálogo dice además si PlacApi está conectado (para ofrecer la revisión al registrar).
    const r = await M.catalogo(c.db);
    return json({ ...((await r.json()) as object), placapi: !!c.env.PLACAPI_KEY });
  }],
  ["GET", /^\/api\/movil\/tramites$/, (c) => MT.listarTramites(c.db, c.url.searchParams.get("q") ?? "", c.url.searchParams.get("ver") ?? "abiertos", c.url.searchParams.get("seccion"))],
  ["GET", new RegExp(`^/api/movil/tramites/${ID}$`), (c) => MT.detalleTramite(c.db, c.p[0])],
  ["GET", /^\/api\/movil\/licencias$/, (c) => MT.listarLicencias(c.db, c.url.searchParams.get("q") ?? "")],
  ["POST", /^\/api\/registrar\/verificar$/, async (c) => Rv.verificarBorrador(c.db, c.env, await cuerpo(c))],
  ["POST", new RegExp(`^/api/registrar/verificar/${ID}/reintentar$`), async (c) => Rv.reintentarVerificacion(c.db, c.env, c.p[0], await cuerpo(c))],
  ["POST", new RegExp(`^/api/registrar/verificar/${ID}/agregar$`), async (c) => Rv.agregarAVerificacion(c.db, c.env, c.p[0], await cuerpo(c))],
  ["GET", /^\/api\/registrar\/personas$/, (c) => Rg.buscarPersonas(c.db, c.url.searchParams.get("q") ?? "")],
  ["GET", /^\/api\/registrar\/placa\/([A-Za-z0-9]{3,8})$/, (c) => Rg.datosPlaca(c.db, c.p[0])],
  ["POST", /^\/api\/registrar\/cobro$/, async (c) => Rg.vistaCobro(c.db, await cuerpo(c))],
  ["POST", /^\/api\/registrar$/, async (c) => Rg.registrar(c.db, c.env.ARCHIVOS, await cuerpo(c), (tramiteId) => {
    if (c.env.PLACAPI_KEY) c.ctx.waitUntil(Rv.revisarTramite(c.db, c.env, tramiteId).then((r) => console.log("Revisión previa", tramiteId, r.creditos), (e) => console.error("Revisión previa falló", tramiteId, e)));
  })],
  ["POST", /^\/api\/movil\/tramite$/, async (c) => M.crearDesdeFotos(c.db, c.env.ARCHIVOS, await cuerpo(c), (tramiteId) => {
    // Con PlacApi conectado, el trámite de vehículo que llega del celular se revisa solo (en segundo plano).
    if (c.env.PLACAPI_KEY) c.ctx.waitUntil(Rv.revisarTramite(c.db, c.env, tramiteId).then((r) => console.log("Revisión previa", tramiteId, r.creditos), (e) => console.error("Revisión previa falló", tramiteId, e)));
  })],
  ["GET", /^\/api\/bandeja$/, (c) => B.listar(c.db)],
  ["PATCH", /^\/api\/bandeja\/(\d{4}-\d{2}-\d{2})$/, async (c) => B.marcar(c.db, c.p[0], await cuerpo(c))],

  ["POST", /^\/api\/clientes$/, async (c) => P.crearCliente(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/clientes/${ID}$`), async (c) => P.editarCliente(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/clientes/${ID}$`), (c) => P.borrarCliente(c.db, c.p[0])],
  ["POST", new RegExp(`^/api/clientes/${ID}/licencias$`), async (c) => P.registrarLicencias(c.db, c.p[0], await cuerpo(c))],
  ["POST", /^\/api\/vehiculos$/, async (c) => P.crearVehiculo(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/vehiculos/${ID}$`), async (c) => P.editarVehiculo(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/vehiculos/${ID}$`), (c) => P.borrarVehiculo(c.db, c.p[0])],

  ["POST", /^\/api\/tramites$/, async (c) => T.crearTramites(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/tramites/${ID}$`), async (c) => T.editarTramite(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/tramites/${ID}$`), (c) => T.borrarTramite(c.db, c.p[0])],
  ["POST", new RegExp(`^/api/tramites/${ID}/estado$`), async (c) => T.cambiarEstado(c.db, c.p[0], await cuerpo(c))],
  ["POST", new RegExp(`^/api/tramites/${ID}/precondiciones$`), async (c) => T.marcarPrecondicion(c.db, c.p[0], await cuerpo(c))],
  ["GET", new RegExp(`^/api/tramites/${ID}/costos-sugeridos$`), (c) => T.costosSugeridos(c.db, c.p[0])],
  ["POST", new RegExp(`^/api/tramites/${ID}/costos$`), async (c) => T.guardarCostos(c.db, c.p[0], await cuerpo(c))],
  ["POST", new RegExp(`^/api/tramites/${ID}/valor$`), async (c) => T.fijarValor(c.db, c.p[0], await cuerpo(c))],
  ["POST", new RegExp(`^/api/tramites/${ID}/notas$`), async (c) => T.agregarNota(c.db, c.p[0], await cuerpo(c))],
  ["POST", new RegExp(`^/api/tramites/${ID}/problema$`), async (c) => T.marcarProblema(c.db, c.p[0], await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/tramites/${ID}/bitacora/${ID}$`), async (c) => T.editarBitacora(c.db, c.p[0], c.p[1], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/tramites/${ID}/bitacora/${ID}$`), (c) => T.borrarBitacora(c.db, c.p[0], c.p[1])],
  ["POST", new RegExp(`^/api/tramites/${ID}/bitacora/${ID}/destacar$`), async (c) => T.destacarBitacora(c.db, c.p[0], c.p[1], await cuerpo(c))],
  ["POST", new RegExp(`^/api/tramites/${ID}/pagos$`), async (c) => T.agregarPago(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/tramites/${ID}/pagos/${ID}$`), (c) => T.quitarPago(c.db, c.p[0], c.p[1])],
  ["POST", new RegExp(`^/api/tramites/${ID}/personas$`), async (c) => T.agregarPersona(c.db, c.p[0], await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/tramites/${ID}/personas/${ID}$`), async (c) => T.cambiarRolPersona(c.db, c.p[0], c.p[1], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/tramites/${ID}/personas/${ID}$`), (c) => T.quitarPersona(c.db, c.p[0], c.p[1])],
  ["POST", new RegExp(`^/api/tramites/${ID}/documentos$`), async (c) => Doc.agregarDocumento(c.db, c.p[0], await cuerpo(c))],

  ["PATCH", new RegExp(`^/api/documentos/${ID}$`), async (c) => Doc.editarDocumento(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/documentos/${ID}$`), (c) => Doc.borrarDocumento(c.db, c.env.ARCHIVOS, c.p[0])],
  ["PUT", new RegExp(`^/api/documentos/${ID}/archivo$`), (c) => Doc.subirArchivo(c.db, c.env.ARCHIVOS, c.p[0], c.req)],
  ["GET", new RegExp(`^/api/documentos/${ID}/archivo$`), (c) => Doc.verArchivo(c.db, c.env.ARCHIVOS, c.p[0], c.url)],
  ["DELETE", new RegExp(`^/api/documentos/${ID}/archivo$`), (c) => Doc.quitarArchivo(c.db, c.env.ARCHIVOS, c.p[0])],

  ["POST", /^\/api\/envios$/, async (c) => Sob.crearEnvio(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/envios/${ID}$`), async (c) => Sob.editarEnvio(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/envios/${ID}$`), (c) => Sob.borrarEnvio(c.db, c.p[0])],
  ["POST", /^\/api\/notas$/, async (c) => N.crearNota(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/notas/${ID}$`), async (c) => N.editarNota(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/notas/${ID}$`), (c) => N.borrarNota(c.db, c.p[0])],
  ["POST", /^\/api\/recordatorios$/, async (c) => A.crearRecordatorio(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/recordatorios/${ID}$`), async (c) => A.editarRecordatorio(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/recordatorios/${ID}$`), (c) => A.borrarRecordatorio(c.db, c.p[0])],
  ["PATCH", new RegExp(`^/api/licencias/${ID}$`), async (c) => A.seguimientoLicencia(c.db, c.p[0], await cuerpo(c))],
  ["GET", /^\/api\/avaluos$/, (c) => A.buscarAvaluos(c.db, c.url)],
  ["POST", /^\/api\/vencimientos\/revisar$/, async (c) => json(await A.revisarVencimientos(c.db))],

  ["POST", /^\/api\/config\/tipos$/, async (c) => C.crearTipo(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/config/tipos/${ID}$`), async (c) => C.editarTipo(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/config/tipos/${ID}$`), (c) => C.borrarTipo(c.db, c.p[0])],
  ["POST", /^\/api\/config\/tarifas$/, async (c) => C.crearTarifa(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/config/tarifas/${ID}$`), async (c) => C.editarTarifa(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/config/tarifas/${ID}$`), (c) => C.borrarTarifa(c.db, c.p[0])],
  ["POST", /^\/api\/config\/organismos$/, async (c) => C.crearOrganismo(c.db, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/config/organismos/${ID}$`), async (c) => C.editarOrganismo(c.db, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/config/organismos/${ID}$`), (c) => C.borrarOrganismo(c.db, c.p[0])],
  ["PUT", /^\/api\/config\/parametros\/([a-z0-9_]{1,60})$/, async (c) => C.guardarParametro(c.db, c.p[0], await cuerpo(c))],

  ["POST", new RegExp(`^/api/consultas/licencias/${ID}$`), (c) => Q.consultarLicencias(c.db, c.env, c.p[0])],
  ["POST", new RegExp(`^/api/consultas/vehiculo/${ID}$`), (c) => Q.consultarVehiculo(c.db, c.env, c.p[0])],
  ["GET", /^\/api\/consultas\/licencias-lote$/, (c) => Q.estimarLote(c.db)],
  ["POST", /^\/api\/consultas\/licencias-lote$/, async (c) => Q.consultarLicenciasLote(c.db, c.env, await cuerpo(c))],
  ["GET", /^\/api\/consultas\/resumen$/, (c) => Q.resumen(c.db, c.env)],
  ["POST", new RegExp(`^/api/consultas/revision/${ID}$`), (c) => Rv.revisar(c.db, c.env, c.p[0])],
  ["GET", new RegExp(`^/api/consultas/revision/${ID}$`), (c) => Rv.ultimaRevision(c.db, c.env, c.p[0])],
  ["POST", new RegExp(`^/api/consultas/revision/${ID}/reintentar$`), (c) => Rv.reintentarRevision(c.db, c.env, c.p[0])],

  ["GET", /^\/api\/formatos$/, (c) => F.listar(c.db)],
  ["PUT", /^\/api\/formatos$/, (c) => F.subir(c.db, c.env.ARCHIVOS, c.req, c.url)],
  ["GET", new RegExp(`^/api/formatos/${ID}/archivo$`), (c) => F.ver(c.db, c.env.ARCHIVOS, c.p[0], c.url)],
  ["DELETE", new RegExp(`^/api/formatos/${ID}$`), (c) => F.borrar(c.db, c.env.ARCHIVOS, c.p[0])],

  ["POST", /^\/api\/datos-leidos$/, async (c) => guardarDatosLeidos(c.db, await cuerpo(c))],
  // Los que traen las fotos con que se llenaron (tarjeta y cédulas, en data URL): hasta 15 MB.
  ["POST", /^\/api\/formatos-celular$/, async (c) => FC.recibir(c.env.ARCHIVOS, await leerJson(c.req, 10_000_000))],
  ["GET", /^\/api\/formatos-celular$/, (c) => FC.listar(c.env.ARCHIVOS)],
  ["GET", new RegExp(`^/api/formatos-celular/${FC.ENVIO}$`), (c) => FC.ver(c.env.ARCHIVOS, c.p[0])],
  ["DELETE", new RegExp(`^/api/formatos-celular/${FC.ENVIO}$`), (c) => FC.borrar(c.env.ARCHIVOS, c.p[0])],
  ["POST", /^\/api\/formatos-vivo$/, async (c) => FV.mandar(c.db, c.env.ARCHIVOS, await leerJson(c.req, 10_000_000))],
  ["GET", /^\/api\/formatos-vivo$/, (c) => FV.pendientes(c.db, c.url)],
  ["POST", new RegExp(`^/api/formatos-vivo/${ID}/tomar$`), (c) => FV.tomar(c.db, c.p[0])],
  ["GET", new RegExp(`^/api/formatos-vivo/${ID}$`), (c) => FV.estado(c.db, c.p[0])],
  ["POST", /^\/api\/formatos-borradores$/, async (c) => FB.guardar(c.env.ARCHIVOS, await leerJson(c.req, 10_000_000))],
  ["GET", /^\/api\/formatos-borradores$/, (c) => FB.listar(c.env.ARCHIVOS)],
  ["GET", new RegExp(`^/api/formatos-borradores/${FB.BORRADOR}$`), (c) => FB.ver(c.env.ARCHIVOS, c.p[0])],
  ["PUT", new RegExp(`^/api/formatos-borradores/${FB.BORRADOR}$`), async (c) => FB.guardar(c.env.ARCHIVOS, await leerJson(c.req, 10_000_000), c.p[0])],
  ["DELETE", new RegExp(`^/api/formatos-borradores/${FB.BORRADOR}$`), (c) => FB.borrar(c.env.ARCHIVOS, c.p[0])],
  ["GET", new RegExp(`^/api/formatos-fotos/${FF.GRUPO}$`), (c) => FF.listar(c.env.ARCHIVOS, c.p[0])],
  ["DELETE", new RegExp(`^/api/formatos-fotos/${FF.GRUPO}$`), (c) => FF.quitarGrupo(c.env.ARCHIVOS, c.p[0])],
  ["GET", new RegExp(`^/api/tramites/${ID}/fotos-formatos$`), (c) => FF.fotosDelTramite(c.db, c.p[0])],
  ["POST", new RegExp(`^/api/tramites/${ID}/fotos-formatos$`), async (c) => FF.adjuntarAlTramite(c.db, c.env.ARCHIVOS, c.p[0], await leerJson(c.req, 10_000_000))],
  ["GET", new RegExp(`^/api/formatos-fotos/${FF.GRUPO}/${FF.DOC}$`), (c) => FF.ver(c.env.ARCHIVOS, c.p[0], c.p[1])],
  ["PUT", /^\/api\/escaneos$/, (c) => Es.subir(c.env.ARCHIVOS, c.req, c.url)],
  ["GET", /^\/api\/escaneos$/, (c) => Es.listar(c.env.ARCHIVOS)],
  ["GET", new RegExp(`^/api/escaneos/${Es.ESCANEO}$`), (c) => Es.ver(c.env.ARCHIVOS, c.p[0], c.url)],
  ["PUT", new RegExp(`^/api/escaneos/${Es.ESCANEO}$`), (c) => Es.reemplazar(c.env.ARCHIVOS, c.p[0], c.req, c.url)],
  ["PATCH", new RegExp(`^/api/escaneos/${Es.ESCANEO}$`), async (c) => Es.renombrar(c.env.ARCHIVOS, c.p[0], await cuerpo(c))],
  ["DELETE", new RegExp(`^/api/escaneos/${Es.ESCANEO}$`), (c) => Es.borrar(c.env.ARCHIVOS, c.p[0])],
  ["POST", new RegExp(`^/api/escaneos/${Es.ESCANEO}/adjuntar$`), async (c) => Es.adjuntar(c.db, c.env.ARCHIVOS, c.p[0], await cuerpo(c))],
  ["POST", /^\/api\/fotos\/sesiones$/, async () => Fo.crearSesion()],
  ["PUT", new RegExp(`^/api/fotos/sesiones/${Fo.SESION}$`), (c) => Fo.subir(c.env.ARCHIVOS, c.p[0], c.req)],
  ["GET", new RegExp(`^/api/fotos/sesiones/${Fo.SESION}$`), (c) => Fo.listar(c.env.ARCHIVOS, c.p[0])],
  ["DELETE", new RegExp(`^/api/fotos/sesiones/${Fo.SESION}$`), (c) => Fo.borrarSesion(c.env.ARCHIVOS, c.p[0])],
  ["GET", new RegExp(`^/api/fotos/sesiones/${Fo.SESION}/${Fo.FOTO}$`), (c) => Fo.ver(c.env.ARCHIVOS, c.p[0], c.p[1])],
  ["DELETE", new RegExp(`^/api/fotos/sesiones/${Fo.SESION}/${Fo.FOTO}$`), (c) => Fo.borrarFoto(c.env.ARCHIVOS, c.p[0], c.p[1])],

  ["GET", /^\/api\/whatsapp\/estado$/, (c) => W.estado(c.db, c.env)],
  ["POST", /^\/api\/whatsapp\/sincronizar$/, (c) => W.sincronizar(c.db, c.env)],
  ["GET", /^\/api\/whatsapp\/chats\/([A-Za-z0-9.]{8,64})\/mensajes$/, (c) => W.mensajes(c.db, c.p[0], c.url)],
  ["PATCH", /^\/api\/whatsapp\/chats\/([A-Za-z0-9.]{8,64})$/, async (c) => W.editarChat(c.db, c.p[0], await cuerpo(c))],
  ["POST", /^\/api\/whatsapp\/personales$/, async (c) => W.confirmarPersonales(c.db, c.env, await cuerpo(c))],
  ["PATCH", new RegExp(`^/api/whatsapp/propuestas/${ID}$`), async (c) => W.editarPropuesta(c.db, c.p[0], await cuerpo(c))],
  ["GET", /^\/api\/whatsapp\/mensajes\/([A-Za-z0-9._=:+%-]{1,300})\/archivo$/, (c) => W.verArchivo(c.db, c.env, c.p[0])],
];

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return error("No encontrado", 404);
    try {
      // Lo llama Kapso: sin Access, con firma. Es la única ruta así.
      if (url.pathname === "/api/whatsapp/webhook") return req.method === "POST" ? await W.recibir(req, env, ctx) : error("Método no permitido", 405);
      const acceso = await autorizar(env, req);
      if (!acceso.ok) return error(acceso.error, acceso.estado);
      const ruta = url.pathname.replace(/\/+$/, "");
      let existeRuta = false;
      for (const [metodo, patron, manejar] of RUTAS) {
        const m = patron.exec(ruta);
        if (!m) continue;
        existeRuta = true;
        if (metodo !== req.method) continue;
        return await manejar({ db: drizzle(env.DB), env, req, url, p: m.slice(1), correo: acceso.correo, ctx });
      }
      return existeRuta ? error("Método no permitido", 405) : error("Ruta no encontrada", 404);
    } catch (e) {
      if (e instanceof ErrorApi) return error(e.message, e.estado);
      console.error(e);
      return error("Error interno del servidor. Intente de nuevo.", 500);
    }
  },

  /**
   * Crons (wrangler.jsonc): el diario revisa vencimientos -> recordatorios aunque no se abra la app y borra
   * las fotos 3x4 de más de 48 horas y los escaneos de más de 15 días;
   * el de cada 5 minutos procesa WhatsApp (archivos, clasificación y propuestas).
   */
  async scheduled(evento, env, ctx) {
    if (evento.cron === "30 11 * * *") {
      // 6:30 a. m. en Colombia: primero los vencimientos (crean recordatorios) y luego el resumen del día para la bandeja.
      const db = drizzle(env.DB);
      ctx.waitUntil(A.revisarVencimientos(db).then((r) => console.log("Vencimientos revisados", r)).then(() => B.generarResumen(db)).then((r) => console.log("Resumen del día", r)));
      ctx.waitUntil(Fo.limpiar(env.ARCHIVOS).then((r) => console.log("Fotos 3x4 viejas borradas", r)));
      ctx.waitUntil(Es.limpiar(env.ARCHIVOS).then((r) => console.log("Escaneos viejos borrados", r)));
      ctx.waitUntil(FC.limpiar(env.ARCHIVOS).then((r) => console.log("Formatos del celular viejos borrados", r)));
      // Las fotos de los borradores, después de los borradores (se borran las de los que ya no están).
      ctx.waitUntil(FB.limpiar(env.ARCHIVOS).then((r) => { console.log("Borradores de formatos viejos borrados", r); return FF.limpiar(env.ARCHIVOS); }).then((r) => console.log("Fotos de formatos viejas borradas", r)));
      ctx.waitUntil(Conv.limpiar(drizzle(env.DB)).then((r) => console.log("Conversaciones viejas borradas", r)));
      ctx.waitUntil(FV.limpiar(drizzle(env.DB)).then((r) => console.log("Formatos en vivo viejos borrados", r)));
      ctx.waitUntil(N.limpiar(drizzle(env.DB)).then((r) => console.log("Noticas hechas viejas borradas", r)));
      ctx.waitUntil(Sob.darPorLlegados(drizzle(env.DB)).then((r) => console.log("Sobres dados por llegados", r)));
    }
    else ctx.waitUntil(W.procesar(env).then((r) => console.log("WhatsApp procesado", r)));
  },
} satisfies ExportedHandler<Env>;
