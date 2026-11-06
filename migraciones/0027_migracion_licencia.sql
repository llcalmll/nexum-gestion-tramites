-- Migración de licencia (Felipe, 27/10/2026): la licencia vigente de un menor de edad pasa a ser de mayor de edad,
-- vigente y activa, al cumplir los 18. Es de licencia (sin vehículo), con las mismas precondiciones que las demás.
INSERT OR IGNORE INTO tipos_tramite (id, nombre, categoria, requiere_vehiculo, aplica_impuesto_registro, requisitos, precondiciones, orden)
VALUES ('6d1f3c2a-8b4e-4f7a-9c5d-2e8a1b7f4c90', 'Migración de licencia', 'licencia', 0, 0, '[]', '{"runt":true,"identidad":true,"paz_salvo_simit":true}', 24);
