/**
 * Imprimir en bruto (las fotos 3x4, el rótulo del sobre): se arma un PDF y se imprime ese PDF desde un marco oculto,
 * como los formatos. Así no sale el encabezado ni el pie que el navegador le pone a una página web (el título
 * "Nexum Tránsito", la dirección, la fecha): imprimiendo la página con los márgenes en cero igual salían.
 */
export function imprimirPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  marco.src = url;
  marco.onload = () => {
    try { marco.contentWindow?.focus(); marco.contentWindow?.print(); } catch { window.open(url, "_blank"); }
    setTimeout(() => { marco.remove(); URL.revokeObjectURL(url); }, 100_000);
  };
  document.body.appendChild(marco);
}

