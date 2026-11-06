-- Notas de la oficina (Felipe, 2026-10-12): requisitos generales de vehículo, requisitos y notas por tipo,
-- el tipo nuevo "Carta de inmovilización / abandono" y las notas internas en las preguntas frecuentes.
-- Solo datos del catálogo (se pueden seguir editando en Configuración).
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"FUN","obligatorio":true},{"documento":"Factura electrónica de venta","obligatorio":true},{"documento":"Manifiesto del vehículo","obligatorio":true},{"documento":"Improntas / certificación del fabricante","obligatorio":true}]' WHERE nombre = 'Matrícula inicial';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":true},{"documento":"FUN","obligatorio":true},{"documento":"Contrato de compraventa con improntas","obligatorio":true},{"documento":"Paz y salvo SIMIT (comprador y vendedor)","obligatorio":true},{"documento":"Paz y salvo impuesto vehicular","obligatorio":true},{"documento":"Recibo retención en la fuente 1%","obligatorio":true}]' WHERE nombre = 'Traspaso de propiedad';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Cambio de servicio';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Cambio de color';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Cambio de carrocería';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Regrabación de motor/chasis/serie';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Cancelación de matrícula';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Inscripción de prenda';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true},{"documento":"Consulta de prenda o gravámenes (RUNT)","obligatorio":true}]' WHERE nombre = 'Levantamiento de prenda';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Duplicado de licencia de tránsito';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Traslado + radicación de cuenta';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Certificado de tradición y libertad';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Rematrícula';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Duplicado de placa';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Pago de impuestos';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Traslado de cuenta';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Radicación de cuenta';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Traspaso a persona indeterminada';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Siniestro';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true}]' WHERE nombre = 'Revocatoria';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la cédula del propietario","obligatorio":true},{"documento":"Fotocopia de la cédula del comprador","obligatorio":false},{"documento":"Improntas","obligatorio":true},{"documento":"Certificado de la SIJIN","obligatorio":true}]' WHERE nombre = 'Cambio de motor';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = '[{"documento":"Papel con los datos personales del infractor","obligatorio":true}]' WHERE nombre = 'Gestión de comparendos';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Primero se saca el historial del vehículo (lo saca la señora Estela).' WHERE nombre = 'Certificado de tradición y libertad';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Antes de empezar, revisar en el RUNT si el vehículo tiene prenda u otros gravámenes.' WHERE nombre = 'Levantamiento de prenda';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Pide certificado de la SIJIN.' WHERE nombre = 'Cambio de motor';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Escuelas (CEA): Motorland o JYG. Exámenes médicos (CRC): Edward.
Debe estar inscrito en el RUNT.
Edad mínima: 16 años para particular (A y B) y 18 para servicio público (C), art. 19 Ley 769 de 2002.' WHERE nombre = 'Expedición de licencia (1ª vez)';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Exámenes médicos (CRC): Edward.
Debe estar inscrito en el RUNT y a paz y salvo de multas.
Vigencia según la edad al expedirse (art. 197, Decreto 019 de 2012): particular 10 años antes de los 60, 5 entre 60 y 80, 1 después de los 80; servicio público (C) 3 años antes de los 60 y 1 desde los 60.' WHERE nombre = 'Renovación de licencia';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Escuelas (CEA): Motorland o JYG. Exámenes médicos (CRC): Edward.
Debe estar inscrito en el RUNT. Para categoría C (servicio público) se necesitan 18 años cumplidos.' WHERE nombre = 'Recategorización de licencia';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Debe estar inscrito en el RUNT.' WHERE nombre = 'Duplicado de licencia';
--> statement-breakpoint
UPDATE tipos_tramite SET descripcion = 'Incluir el papel con los datos personales del infractor, no la carta.' WHERE nombre = 'Gestión de comparendos';
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, descripcion, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden, activo)
  SELECT '284bd392-1495-4bb8-99da-e3c268cbdeef', 'Carta de inmovilización / abandono', 'seguros_multas', 'Revisar medidas correctivas (RNMC) antes de radicar.', 1, 0, '[{"documento":"Fotocopia de la cédula","obligatorio":true},{"documento":"Fotocopia de la tarjeta de propiedad","obligatorio":true},{"documento":"Fotocopia de la licencia de conducción","obligatorio":true}]', '{"sin_medidas_rnmc":true}', orden + 1, 1
  FROM tipos_tramite WHERE nombre = 'Gestión de comparendos'
  AND NOT EXISTS (SELECT 1 FROM tipos_tramite WHERE nombre = 'Carta de inmovilización / abandono');
--> statement-breakpoint
UPDATE parametros SET valor = valor || '

NOTAS DE LA OFICINA (internas)
P: ¿Qué se pide en cualquier trámite de vehículo?
R: Fotocopia de la tarjeta de propiedad, fotocopia de la cédula del propietario, fotocopia de la cédula del comprador (si hay comprador) e improntas.
P: ¿Qué pide el cambio de motor?
R: Certificado de la SIJIN, además de los papeles de todo trámite de vehículo.
P: ¿Cómo se saca un certificado de tradición?
R: Primero se saca el historial del vehículo; lo saca la señora Estela.
P: ¿Qué se revisa antes de un levantamiento de prenda?
R: Si el vehículo tiene prenda u otros gravámenes (en el RUNT).
P: ¿Con quién se trabajan las licencias?
R: Escuelas (CEA): Motorland y JYG. Exámenes médicos (CRC): Edward. La persona debe estar inscrita en el RUNT.
P: ¿Qué implica la edad en las licencias?
R: Para sacarla por primera vez: 16 años para particular (A y B) y 18 para servicio público (C) (art. 19, Ley 769 de 2002). La vigencia depende de la edad al expedirse (art. 197, Decreto 019 de 2012): particular 10 años antes de los 60, 5 entre 60 y 80, 1 después de los 80; servicio público 3 años antes de los 60 y 1 desde los 60. Para renovar: examen médico nuevo y estar a paz y salvo de multas.
P: ¿Qué se necesita para una carta de inmovilización o abandono?
R: Fotocopia de la cédula, de la tarjeta de propiedad y de la licencia, y revisar las medidas correctivas (RNMC).
P: ¿Qué se incluye en otras infracciones?
R: El papel con los datos personales del infractor, no la carta.' WHERE clave = 'faq' AND valor NOT LIKE '%NOTAS DE LA OFICINA%';
