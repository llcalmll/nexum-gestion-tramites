/**
 * Prepara una foto para leerla con IA: respeta la orientación del celular, la reduce a 2.000 px por el lado mayor y
 * la pasa a JPG. Así sube rápido y pesa poco (unos cientos de KB).
 * Al leerla (paraLeer), si es pequeña se AMPLÍA: en las pruebas, una tarjeta de propiedad de 335×597 px (reenviada por
 * chat) salió con el motor, el chasis y la cédula inventados; ampliada ×3 se leyó casi toda bien. Aun así, en una foto
 * tan pequeña un carácter se puede correr ("26A0" leído "260A"): los números de identificación se marcan para revisar.
 */
import { api } from "../datos/api";

const LADO_MIN = 1600, LADO_MAX = 2000;
/** Por debajo de esto (lado mayor de la foto original), los números leídos se marcan para revisar. */
const LADO_BAJA = 1000;
export const escalaParaLeer = (ancho: number, alto: number) => {
  const lado = Math.max(ancho, alto);
  return lado < LADO_MIN ? Math.min(3, LADO_MIN / lado) : Math.min(1, LADO_MAX / lado);
};

function dibujar(fuente: CanvasImageSource, ancho: number, alto: number, escala: number) {
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  const g = lienzo.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL("image/jpeg", 0.85);
}

export async function prepararFoto(archivo: File | Blob): Promise<string> {
  if (archivo.size > 25 * 1024 * 1024) throw new Error("La foto pesa más de 25 MB.");
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo abrir la imagen. Use una foto JPG o PNG (las fotos HEIC del iPhone no se pueden leer en este navegador).");
  }
  const url = dibujar(imagen, imagen.width, imagen.height, Math.min(1, LADO_MAX / Math.max(imagen.width, imagen.height)));
  imagen.close();
  return url;
}

async function abrir(foto: string) {
  const img = new Image();
  img.src = foto;
  await img.decode();
  return img;
}

/** Una foto (data URL) lista para leer: ampliada si es pequeña (la que ya está bien se devuelve igual), y si era de baja resolución. */
export async function paraLeer(foto: string): Promise<{ foto: string; baja: boolean }> {
  const img = await abrir(foto);
  const e = escalaParaLeer(img.naturalWidth, img.naturalHeight);
  return { foto: e === 1 ? foto : dibujar(img, img.naturalWidth, img.naturalHeight, e), baja: Math.max(img.naturalWidth, img.naturalHeight) < LADO_BAJA };
}

/** Gira una foto en el sentido del reloj (90, 180 o 270 grados). */
export async function girarFoto(foto: string, grados: number): Promise<string> {
  const img = await abrir(foto);
  const vueltas = ((Math.round(grados / 90) % 4) + 4) % 4;
  if (!vueltas) return foto;
  const c = document.createElement("canvas");
  c.width = vueltas % 2 ? img.naturalHeight : img.naturalWidth;
  c.height = vueltas % 2 ? img.naturalWidth : img.naturalHeight;
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((vueltas * Math.PI) / 2);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Una copia pequeña (768 px), para comparar giros. */
async function pequena(foto: string) {
  const img = await abrir(foto);
  return dibujar(img, img.naturalWidth, img.naturalHeight, Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight)));
}

/** De los cuatro giros de la foto, cuál se lee derecho (POST /api/leer/derecha); null si no se pudo saber. */
async function giroDerecho(foto: string): Promise<number | null> {
  try {
    const base = await pequena(foto);
    const imagenes = await Promise.all([0, 90, 180, 270].map((g) => girarFoto(base, g)));
    return (await api<{ giro: number }>("/api/leer/derecha", { method: "POST", body: JSON.stringify({ imagenes }) })).giro;
  } catch { return null; }
}

/**
 * Lee una foto con el lector (POST /api/leer). Si el lector dice que está girada, se endereza y se lee otra vez: una
 * foto de lado se lee mal. El lector a veces se equivoca de sentido (dice 90 cuando eran 270): por eso, la primera vez
 * se le muestran los cuatro giros y elige el que se lee derecho; si elige la que ya mandó (una hoja apenas inclinada),
 * se manda otra vez con `derecha` y el lector la lee así; si no, se suma el giro que diga (hasta 3 lecturas).
 * Devuelve lo leído y la foto derecha.
 */
export async function leerDerecha<T>(foto: string, leer: (imagen: string, baja: boolean, derecha: boolean) => Promise<{ datos: T; girar?: number }>): Promise<{ datos: T; foto: string }> {
  const { foto: lista, baja } = await paraLeer(foto);
  let actual = lista, giro = 0, comparada = false, derecha = false;
  for (let intento = 0; intento < 3; intento++) {
    const r = await leer(actual, baja, derecha);
    if (!r.girar) return { datos: r.datos, foto: actual };
    const elegido = comparada ? null : await giroDerecho(lista);
    comparada = true;
    if (elegido === giro) { derecha = true; continue; }
    giro = elegido !== null ? elegido : (giro + r.girar) % 360;
    actual = await girarFoto(lista, giro);
  }
  throw new Error("La foto parece girada y no se pudo enderezar. Tómela derecha, de frente y con buena luz.");
}
