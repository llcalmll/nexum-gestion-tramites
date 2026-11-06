-- La lista de requisitos que se armaba sola en cada trámite (nadie la llenaba): fuera las que no tienen archivo.
DELETE FROM `documentos` WHERE `archivo_clave` IS NULL AND `estado` = 'pendiente';
