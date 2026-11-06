/**
 * Formatos oficiales que van fijos en la app (public/formatos). Verificados el 2026-10-12 contra los que usa la oficina.
 * Los propios se suben desde la pantalla Formatos (tabla formatos, archivo en R2).
 */
export interface FormatoOficial {
  id: "fun" | "compraventa" | "mandato" | "fun-maquinaria" | "fun-remolques";
  nombre: string;
  uso: string;
  papel: string;
  fuente: string;
  ruta: string;
  /** Cómo se nombra en la vista previa ("Vista previa y ajustes: ..."). */
  corto: string;
  horizontal: boolean;
  /** Sus páginas, en orden (`vacia`: viene en blanco y no se imprime de entrada). */
  paginas: { titulo: string; vacia?: boolean }[];
}

/** La imagen de la página i (desde 0) para la vista previa: public/formatos/vista/<archivo>-<n>.jpg. */
export const vistaPagina = (f: FormatoOficial, i: number) => f.ruta.replace("/formatos/", "/formatos/vista/").replace(/\.pdf$/, `-${i + 1}.jpg`);
const FRENTE_RESPALDO = [{ titulo: "Frente" }, { titulo: "Respaldo (instrucciones)" }];

export const FORMATOS_OFICIALES: FormatoOficial[] = [
  {
    id: "fun", nombre: "Formulario de Solicitud de Trámites del Registro Nacional Automotor (FUN)",
    uso: "Todo trámite de vehículo: traspaso, matrícula, traslado, cambios, prendas, duplicados. Lo firman vendedor y comprador. Trae las instrucciones al respaldo.",
    papel: "Carta horizontal, 2 caras", fuente: "Ministerio de Transporte y RUNT (copia de la Ventanilla Única de Servicios, con la casilla del organismo en blanco)",
    ruta: "/formatos/formulario-solicitud-tramites-automotor.pdf",
    corto: "formulario único (FUN)", horizontal: true, paginas: FRENTE_RESPALDO,
  },
  {
    id: "compraventa", nombre: "Contrato de compraventa de vehículo automotor",
    uso: "Traspasos. Precio y forma de pago, tradición, entrega, cláusula penal, firmas con huella y testigo.",
    papel: "Oficio", fuente: "Secretaría de Movilidad de Itagüí",
    ruta: "/formatos/contrato-compraventa-transito-itagui.pdf",
    corto: "contrato de compraventa", horizontal: false, paginas: [{ titulo: "Contrato" }],
  },
  {
    id: "mandato", nombre: "Contrato de mandato (poder)",
    uso: "Para que la oficina radique y reciba el trámite a nombre del propietario (Resolución 12379 de 2012, art. 5).",
    papel: "Carta", fuente: "Tránsito de Pasto (modelo general: ante el organismo de tránsito que corresponda; Resolución 12379 de 2012)",
    ruta: "/formatos/contrato-de-mandato.pdf",
    corto: "contrato de mandato", horizontal: false, paginas: [{ titulo: "Contrato" }],
  },
  {
    id: "fun-maquinaria", nombre: "Formulario de Solicitud de Trámites del Registro Nacional de Maquinaria Agrícola y de Construcción",
    uso: "Trámites de maquinaria agrícola, industrial y de construcción autopropulsada.",
    papel: "A4 horizontal", fuente: "Tránsito de Tunja",
    ruta: "/formatos/formulario-solicitud-tramites-maquinaria.pdf",
    corto: "formulario de maquinaria", horizontal: true, paginas: FRENTE_RESPALDO,
  },
  {
    id: "fun-remolques", nombre: "Formulario de Solicitud de Trámites del Registro Nacional de Remolques y Semirremolques",
    uso: "Trámites de remolques, semirremolques y multimodulares.",
    papel: "Oficio horizontal", fuente: "Tránsito de Tunja",
    ruta: "/formatos/formulario-solicitud-tramites-remolques.pdf",
    corto: "formulario de remolques", horizontal: true, paginas: [...FRENTE_RESPALDO, { titulo: "Página 3 (en blanco)", vacia: true }],
  },
];

export const formatoOficial = (id: FormatoOficial["id"]) => FORMATOS_OFICIALES.find((f) => f.id === id)!;
