/*
 * La vista previa de una tarjeta de propiedad (cotizar por fotos): la tarjeta recortada y derecha, con el mismo modelo
 * de encuadre del escáner de cédulas (escaner/modelo.ts, corre en el navegador). Si no la encuentra, la foto entera.
 */
import { cargarImagen, detectarTarjetas, vistaPrevia } from "../escaner/procesar";

/** Lado mayor de la vista previa: se lee la placa y los datos sin que pese (unos 100 KB). */
const LADO = 1100;

/** La tarjeta de la foto (ya derecha, como la deja leerHoja), recortada; `encuadrada` en falso: va la foto entera. */
export async function recortarTarjeta(foto: string): Promise<{ foto: string; encuadrada: boolean }> {
  const lienzo = await cargarImagen(await (await fetch(foto)).blob());
  const { tarjetas, encontrada } = await detectarTarjetas(lienzo);
  // La fotocopia con las dos caras trae dos: la primera (en orden de lectura) es la de adelante, la de la placa.
  if (encontrada) return { foto: vistaPrevia(lienzo, tarjetas[0], "original", 0, "tarjeta", LADO), encuadrada: true };
  const k = Math.min(1, LADO / Math.max(lienzo.width, lienzo.height));
  const chica = document.createElement("canvas");
  chica.width = Math.round(lienzo.width * k); chica.height = Math.round(lienzo.height * k);
  chica.getContext("2d")!.drawImage(lienzo, 0, 0, chica.width, chica.height);
  return { foto: chica.toDataURL("image/jpeg", 0.8), encuadrada: false };
}
