-- Precondición "Sin embargos ni otras limitaciones (RUNT)" (Felipe, 21/10/2026): el tránsito verifica que no haya
-- órdenes judiciales ni medidas que limiten la propiedad (Res. 12379 de 2012, art. 12; hoy Res. 20223040045295 de 2022).
-- Se marca a mano tras consultar el RUNT por placa. Va en los traspasos y en el levantamiento de prenda.
UPDATE tipos_tramite SET precondiciones = json_set(precondiciones, '$.sin_embargos', json('true')) WHERE nombre IN ('Traspaso de propiedad', 'Traspaso a persona indeterminada', 'Levantamiento de prenda');
