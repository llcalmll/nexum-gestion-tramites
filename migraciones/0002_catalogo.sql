-- Catálogo de arranque (sin datos personales), tomado de la plantilla de nexum-transito:
-- tipos de trámite con requisitos y precondiciones, organismos y tarifas 2026, y parámetros del negocio.
-- En el corte (fase 7) se reemplaza por el catálogo real exportado de Elestio.
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('6bd2c1ef-2496-4cab-8b6c-e43dbb7cc652', 'Matrícula inicial', 'vehiculo', 1, 1, '[{"documento":"FUN","obligatorio":true},{"documento":"Factura electrónica de venta","obligatorio":true},{"documento":"Manifiesto del vehículo","obligatorio":true},{"documento":"Improntas / certificación del fabricante","obligatorio":true}]', '{"runt":true,"identidad":true,"soat":true,"paz_salvo_simit":true,"improntas":true}', 1);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('1dc7916d-9b86-47f3-b488-a5496f46cb56', 'Traspaso de propiedad', 'vehiculo', 1, 1, '[{"documento":"FUN","obligatorio":true},{"documento":"Contrato de compraventa con improntas","obligatorio":true},{"documento":"Paz y salvo SIMIT (comprador y vendedor)","obligatorio":true},{"documento":"Paz y salvo impuesto vehicular","obligatorio":true},{"documento":"Recibo retención en la fuente 1%","obligatorio":true}]', '{"runt":true,"identidad":true,"soat":true,"rtm":true,"paz_salvo_simit":true,"paz_salvo_impuesto":true,"sin_gravamenes":true,"improntas":true,"contrato":true}', 2);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('d6640d16-dc59-4a5f-8f5c-1ff716e86fcd', 'Cambio de servicio', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true}', 4);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('b21e7f87-912d-4635-8e9b-f1e1000000fd', 'Cambio de color', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true,"improntas":true}', 5);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('93aa34b9-43d4-4747-9a27-82e773670522', 'Cambio de carrocería', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true,"improntas":true}', 6);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('12db18d1-5605-4d8f-85af-4b01e4228c55', 'Regrabación de motor/chasis/serie', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"rtm":true,"paz_salvo_simit":true,"improntas":true}', 7);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('85b33a66-dc30-4de2-b85f-0bd997464073', 'Cancelación de matrícula', 'vehiculo', 1, 0, '[]', '{"runt":true,"paz_salvo_simit":true,"paz_salvo_impuesto":true}', 8);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('f1379c8b-19d2-471e-9184-0ab2ab7447e8', 'Inscripción de prenda', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true,"improntas":true}', 9);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('de9b721a-a696-4b3b-82ed-b71d715b4d47', 'Levantamiento de prenda', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true,"improntas":true}', 9);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('9cf5c1fe-3087-4365-9f23-c10000000ae5', 'Duplicado de licencia de tránsito', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true}', 10);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('0df9ec01-b8cd-4af1-a904-c68ee7ecfea3', 'Duplicado de placa', 'vehiculo', 1, 0, '[]', '{"runt":true,"paz_salvo_simit":true}', 14);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('0ec3c140-3cce-4940-8c04-c5e100000c5e', 'Pago de impuestos', 'vehiculo', 1, 0, '[]', '{"runt":true}', 15);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('dca67bc0-36d0-491a-bcc6-aa060c00a148', 'Traslado + radicación de cuenta', 'vehiculo', 1, 0, '[]', '{"runt":true,"soat":true,"rtm":true,"paz_salvo_simit":true,"paz_salvo_impuesto":true}', 11);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('99b0c6e4-4f37-44fc-99af-722bdc100000', 'Certificado de tradición y libertad', 'vehiculo', 1, 0, '[]', '{"runt":true}', 12);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('bf7c55bd-669c-435e-8519-da10000d12b0', 'Rematrícula', 'vehiculo', 1, 1, '[]', '{"runt":true,"soat":true,"paz_salvo_simit":true,"paz_salvo_impuesto":true,"improntas":true}', 13);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('2f10000d-16d9-42cd-bcdf-3789fe30ec27', 'Expedición de licencia (1ª vez)', 'licencia', 0, 0, '[{"documento":"Certificado CRC","obligatorio":true},{"documento":"Certificado CEA","obligatorio":true},{"documento":"Exámenes CALE (teórico y práctico)","obligatorio":true},{"documento":"Documento de identidad","obligatorio":true}]', '{"runt":true,"identidad":true,"paz_salvo_simit":true}', 20);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('fd57db89-3649-4fd4-8f26-9ad44f07dc4d', 'Renovación de licencia', 'licencia', 0, 0, '[{"documento":"Certificado CRC vigente","obligatorio":true},{"documento":"Documento de identidad","obligatorio":true}]', '{"runt":true,"identidad":true,"paz_salvo_simit":true}', 21);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('500a90d4-b467-48de-b944-b30e3bf10000', 'Recategorización de licencia', 'licencia', 0, 0, '[]', '{"runt":true,"identidad":true,"paz_salvo_simit":true}', 22);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('b57cb486-11ba-4d71-a279-7361b24c8e90', 'Duplicado de licencia', 'licencia', 0, 0, '[]', '{"runt":true,"identidad":true,"paz_salvo_simit":true}', 23);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('73ae20f3-e85a-4ea4-a7ae-ffa10000da4b', 'SOAT', 'seguros_multas', 1, 0, '[]', '{"runt":true}', 30);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('579dcc9c-fb31-4dc3-a39d-9c0263eb9890', 'Revisión Técnico-Mecánica (RTM)', 'seguros_multas', 1, 0, '[]', '{"runt":true,"soat":true}', 31);
--> statement-breakpoint
INSERT INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden) VALUES ('7289b4d6-89d4-4ddd-80a1-4c3d41a8a0fe', 'Gestión de comparendos', 'seguros_multas', 0, 0, '[]', '{"identidad":true}', 32);
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('100000d9-fb88-48c9-9db9-10000fb111ac', 'Secretaría de Tránsito de Ibagué', 'Ibagué');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('a881fe47-e257-42d8-9300-9b6006ca504b', 'Secretaría de Tránsito de Alvarado', 'Alvarado');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('95ed048a-3b84-4d12-b6ed-ab7a4ccb0140', 'Secretaría de Tránsito de Funza', 'Funza');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('e694a96b-4a17-4e47-929e-5ab938aca292', 'Secretaría de Tránsito de Neiva', 'Neiva');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('7b32d664-7bed-486e-90e6-b65e613f665f', 'Secretaría de Tránsito de Chía', 'Chía');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('100000b3-b069-43db-b8ca-1f721e5eef10', 'Secretaría de Tránsito de Bogotá', 'Bogotá');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('100000ed-36aa-433e-8947-2cf282ec3e27', 'Secretaría de Tránsito de Soacha', 'Soacha');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('13d52ae1-4cbd-4816-bf65-5e10000bcdc7', 'Secretaría de Tránsito de Dos Quebradas', 'Juan Pérez');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('40ae34e5-3784-4fbf-a87a-9f4d4ca10000', 'Secretaría de Tránsito de Mariquita', 'Mariquita');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('f9dde0d4-1f88-4286-aa5a-820e100000a5', 'Secretaría de Tránsito de Chaparral', 'Chaparral');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('72cb82a8-2c94-4f65-bf19-200b10000000', 'Secretaría de Tránsito de Zulia', 'Zulia');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('92e823c8-bd99-4ddd-94e4-a31bdc65dee7', 'Secretaría de Tránsito de Pereira', 'Pereira');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('d7252f87-da0e-499f-a0e0-8c5f3e40d625', 'Secretaría de Tránsito de Espinal', 'Espinal');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('1e2834f7-b00b-4507-a0ef-a3af64d43c1b', 'Secretaría de Tránsito de Guayabal', 'Guayabal');
--> statement-breakpoint
INSERT INTO organismos (id, nombre, ciudad) VALUES ('fe6097d2-ba8f-43ba-b63f-6b6b96aff90e', 'Secretaría de Tránsito de Girardot', 'Girardot');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('7e1718c3-fb20-4673-8781-44fb10000f94', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '100000d9-fb88-48c9-9db9-10000fb111ac', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('b1000000-b664-41bd-9db7-c210a71dbb20', '1dc7916d-9b86-47f3-b488-a5496f46cb56', 'a881fe47-e257-42d8-9300-9b6006ca504b', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('d502a0ac-f8ed-426b-beca-2fb1bc1da1da', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '95ed048a-3b84-4d12-b6ed-ab7a4ccb0140', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('5fcca6c1-9025-49be-946d-d0eebd11be35', '1dc7916d-9b86-47f3-b488-a5496f46cb56', 'e694a96b-4a17-4e47-929e-5ab938aca292', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('7f1d3bf0-e9e0-40f9-a775-6b095f49ff3f', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '7b32d664-7bed-486e-90e6-b65e613f665f', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('0bae3966-91fe-40f3-9839-94fd7e734ae0', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '100000b3-b069-43db-b8ca-1f721e5eef10', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('769ed1e7-3bac-4bce-9cc5-ca0ffc8d3c84', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '100000ed-36aa-433e-8947-2cf282ec3e27', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('42e69fe2-5e8f-41ca-8198-d454ae049d56', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '13d52ae1-4cbd-4816-bf65-5e10000bcdc7', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('5cd6a86e-9627-4f4b-a991-9ec58e2096ca', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '40ae34e5-3784-4fbf-a87a-9f4d4ca10000', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('f24cba7f-7806-4be2-910e-daa9867ce16a', '1dc7916d-9b86-47f3-b488-a5496f46cb56', 'f9dde0d4-1f88-4286-aa5a-820e100000a5', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('547c2369-1330-487a-a1ac-f5d1cbab5347', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '72cb82a8-2c94-4f65-bf19-200b10000000', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('9c96aa28-22b7-4cfb-be51-5e10000d8f57', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '92e823c8-bd99-4ddd-94e4-a31bdc65dee7', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('10000000-5fc2-417e-a14c-9ecf10000c7b', '1dc7916d-9b86-47f3-b488-a5496f46cb56', 'd7252f87-da0e-499f-a0e0-8c5f3e40d625', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('25e6e821-29a5-435e-912f-058a78cff976', '1dc7916d-9b86-47f3-b488-a5496f46cb56', '1e2834f7-b00b-4507-a0ef-a3af64d43c1b', 100000, 0, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('af1fabaa-9177-40bd-b29c-5ff3b0e6842f', '1dc7916d-9b86-47f3-b488-a5496f46cb56', 'fe6097d2-ba8f-43ba-b63f-6b6b96aff90e', 10000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('27f05bfc-295a-422e-b5a7-c66ca0c5bc76', 'de9b721a-a696-4b3b-82ed-b71d715b4d47', '100000d9-fb88-48c9-9db9-10000fb111ac', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('caf8c4ea-a4e5-4739-b47b-55f5c3ca2926', '0df9ec01-b8cd-4af1-a904-c68ee7ecfea3', '100000d9-fb88-48c9-9db9-10000fb111ac', 100000, 0, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('a767e119-0bd2-49d0-92cc-0dc7ee10c08c', 'b57cb486-11ba-4d71-a279-7361b24c8e90', '100000d9-fb88-48c9-9db9-10000fb111ac', 100000, 10000, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO tarifas (id, tipo_tramite_id, organismo_id, derechos_transito, paz_salvo, honorarios, vigente_desde) VALUES ('0d4e0134-81f8-4190-a908-2ed7d2ed7c2d', '6bd2c1ef-2496-4cab-8b6c-e43dbb7cc652', '100000d9-fb88-48c9-9db9-10000fb111ac', 100000, 0, 100000, '2026-01-01');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('nombre_negocio', 'Nexum Tránsito', 'Nombre del negocio.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('honorarios_defecto', '100000', 'Honorarios por defecto (pesos) cuando la tarifa no define uno.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('smdlv', '10000', 'Salario mínimo diario legal vigente (pesos).');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('uvt', '0', 'Unidad de Valor Tributario (pesos). 0 = sin definir.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('impuesto_registro_tramos', '[{"hasta":10000000,"pct":1.5},{"hasta":129032000,"pct":2.5},{"pct":3.5}]', 'Tramos del impuesto de registro sobre el avalúo (JSON).');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('retefuente_pct', '1', 'Retención en la fuente (%) en traspasos de persona natural.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('rnmc_activo', 'false', 'Exigir RNMC (medidas correctivas) como precondición.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('asistente_estilo', 'breve', 'Estilo del asistente interno: breve o detallado.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('asistente_instrucciones', '', 'Instrucciones libres para el asistente interno.');
--> statement-breakpoint
INSERT INTO parametros (clave, valor, descripcion) VALUES ('faq', 'TRASPASO
P: ¿Qué necesito para traspasar un vehículo?
R: Cédulas de comprador y vendedor, tarjeta de propiedad, SOAT y tecnomecánica vigentes, paz y salvo de multas (SIMIT) e impuestos, y contrato de compraventa autenticado. Según el organismo puede pedirse peritaje/improntas.
P: ¿Puedo traspasar si el carro tiene multas o impuestos pendientes?
R: No. Hay que estar a paz y salvo en el SIMIT y en impuestos antes de traspasar. Te ayudamos a revisarlo.
P: ¿Cuánto se demora el traspaso?
R: Si los papeles están completos y no hay multas ni impuestos pendientes, suele quedar el mismo día o en pocos días hábiles.
P: ¿Necesito SOAT y tecnomecánica vigentes para traspasar?
R: Sí, ambos deben estar vigentes (la tecnomecánica si le aplica por antigüedad).

COMPRÉ Y NUNCA TRASPASÉ
P: ¿Todavía existe el traspaso a persona indeterminada?
R: No. Ese trámite se eliminó el 7 de febrero de 2026 por resolución del Ministerio de Transporte. Hoy la vía es ubicar al titular y hacer el traspaso normal, o revisar tu caso puntual; agendemos para verlo.

COMPARENDOS / MULTAS (SIMIT)
P: ¿Cómo sé cuánto debo en multas?
R: Se consulta en el SIMIT por placa y cédula. Te lo revisamos.
P: ¿Hay descuento por pagar rápido?
R: Sí: pagando en los primeros días hay descuento (normalmente 50% dentro de los 5 días hábiles y 25% hasta los 20), o tomando el curso pedagógico.
P: ¿Puedo hacer acuerdo de pago de mis multas?
R: Sí, en el SIMIT se pueden unificar varias multas en un acuerdo y pagar por cuotas. Si incumplís una cuota, el acuerdo se cae y pasa a cobro con intereses.

IMPUESTO VEHICULAR
P: ¿Cuánto es el impuesto de mi carro?
R: Se calcula sobre el avalúo oficial del vehículo según la tarifa del departamento. Pasame la placa y te lo estimamos.
P: ¿Hasta cuándo pago con descuento?
R: Depende del departamento y del año (por ejemplo en 2026 Bogotá dio 10% hasta el 15 de mayo). Te confirmamos la fecha de tu departamento.

RUNT
P: ¿Cómo consulto mi RUNT?
R: En www.runt.gov.co, opción "Consulta ciudadana por documento". Ahí ves tus vehículos y licencias.
P: ¿Cómo sé si mi licencia, SOAT o tecnomecánica están vigentes?
R: Todo se consulta en el RUNT por documento y placa.

LICENCIA DE CONDUCCIÓN
P: ¿Cada cuánto renuevo la licencia?
R: Particular: 10 años si sos menor de 60, 5 años entre 60 y 80, cada año si pasás de 80. Público: cada 3 años (cada año si sos mayor de 60).
P: ¿Qué necesito para renovar la licencia?
R: Estar inscrito en el RUNT, el certificado del examen médico (CRC) y estar a paz y salvo de multas. Te agendamos el examen y hacemos el trámite.

PRECIOS DE LICENCIAS (incluyen exámenes, derechos de tránsito, fotografía y servicio; son referencia, el valor final lo confirma el asesor)
P: ¿Cuánto cuesta sacar la licencia de moto (A2)?
R: A2 moto: $1.200.000 si ya sabés conducir, $1.300.000 con clases. Curso: 28h teóricas + 14h prácticas, ~20 días.
P: ¿Cuánto la licencia de carro particular (B1)?
R: B1 carro particular: $1.400.000 si ya sabés conducir, $1.600.000 con clases. Curso: 30h teóricas + 20h prácticas, ~30 días.
P: ¿Cuánto carro y moto juntas (B1 + A2)?
R: B1+A2: $2.300.000 si sabés ambas, $2.400.000 si sabés moto pero no carro, $2.500.000 si no sabés ninguna. Curso: 35h + 35h, ~30 días.
P: ¿Cuánto la licencia C1 (servicio público)?
R: C1 servicio público: $1.600.000 si sabés conducir, $1.750.000 si no. Curso: 35h teóricas + 30h prácticas, ~35 días.
P: ¿Cuánto C1 + A2?
R: C1+A2: $2.400.000 si sabés ambas, $2.600.000 si sabés moto pero no carro, $2.700.000 si no sabés ninguna. Curso: ~35 a 40 días.
P: ¿Cuánto la licencia C2 (servicio público)?
R: C2 servicio público: $1.800.000 si sabés conducir. Curso: 30h teóricas + 30h prácticas, ~25 días.
P: ¿Cuánto cuesta refrendar (renovar) la licencia?
R: Refrendación de una categoría: $100.000; de moto y carro: $100.000. Incluye exámenes médicos, derechos, fotografía y servicio. Se entrega en ~2 horas.
P: ¿Cuánto un duplicado de licencia?
R: Duplicado de licencia de conducción: $100.000. Incluye derechos, fotografía y servicio. Se entrega en ~30 minutos.

SOAT Y TECNOMECÁNICA
P: ¿Es obligatorio el SOAT?
R: Sí, todo vehículo debe tener SOAT vigente; sin él no circulás ni hacés trámites.

LA GESTORÍA
P: ¿Ustedes hacen el trámite por mí?
R: Sí, somos gestoría: te asesoramos y hacemos el trámite. Te cotizamos y agendamos una llamada o cita.
P: ¿Cuánto cobran ustedes?
R: Cobramos honorarios según el trámite; van siempre en el desglose de la cotización.', 'Preguntas frecuentes de la pantalla Ayuda (P: / R:).');
