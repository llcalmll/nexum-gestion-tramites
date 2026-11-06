/*
 * Las fotos 3x4 del carrusel del celular, guardadas en el celular (IndexedDB): se conservan al cambiar de sección, al
 * salir a otra app y si el celular recarga la página. Solo se borran con «Quitar esta» o «Quitar todas». Cada foto con
 * su sesión (la bandeja del PC o la del QR), su estado y si va marcada para el PC.
 */
export interface FotoGuardada { id: string; sesion: string; archivo: Blob; estado: "local" | "enviada" | "fallida"; marcada: boolean; orden: number }

const BASE = "fotos-pira", TABLA = "carrusel3x4";
let abierta: Promise<IDBDatabase> | null = null;
function base(): Promise<IDBDatabase> {
  abierta ??= new Promise((ok, mal) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(TABLA)) r.result.createObjectStore(TABLA, { keyPath: "id" }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { abierta = null; mal(r.error); };
  });
  return abierta;
}
async function tabla(modo: IDBTransactionMode) { return (await base()).transaction(TABLA, modo).objectStore(TABLA); }
const esperar = <T,>(q: IDBRequest<T>) => new Promise<T>((ok, mal) => { q.onsuccess = () => ok(q.result); q.onerror = () => mal(q.error); });

/** Las de una sesión, en el orden en que se tomaron. Sin almacenamiento (modo privado...), ninguna. */
export async function fotosGuardadas(sesion: string): Promise<FotoGuardada[]> {
  try { return ((await esperar((await tabla("readonly")).getAll())) as FotoGuardada[]).filter((f) => f.sesion === sesion).sort((a, b) => a.orden - b.orden); }
  catch { return []; }
}
/** Guarda (o actualiza) una foto. Si el celular no deja guardar, sigue solo en memoria. */
export async function guardarFoto(f: FotoGuardada) { try { await esperar((await tabla("readwrite")).put(f)); } catch { /* solo en memoria */ } }
export async function borrarFoto(id: string) { try { await esperar((await tabla("readwrite")).delete(id)); } catch { /* nada */ } }
