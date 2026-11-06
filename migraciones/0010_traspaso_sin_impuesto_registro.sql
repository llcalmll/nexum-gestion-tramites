-- El traspaso no lleva impuesto de registro departamental (así cotiza la oficina: derechos, retención en la fuente,
-- paz y salvo y honorarios). Matrícula inicial y rematrícula sí lo llevan.
UPDATE tipos_tramite SET aplica_impuesto_registro = 0 WHERE nombre = 'Traspaso de propiedad';
