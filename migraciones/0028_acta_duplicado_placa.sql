-- Duplicado de placa (Felipe, 27/10/2026): por pérdida, la placa se pide con el acta de pérdida de Su Placa Vehicular
-- (en Formatos, Formatos de la oficina), junto con la cédula y la tarjeta de propiedad. Se agrega el acta a sus
-- requisitos (una sola vez; lo demás queda como estaba).
UPDATE tipos_tramite
SET requisitos = json_insert(requisitos, '$[#]', json('{"documento":"Acta de pérdida de placa (formato de Su Placa Vehicular, en Formatos)","obligatorio":true}'))
WHERE nombre = 'Duplicado de placa' AND requisitos NOT LIKE '%Acta de pérdida de placa%';
