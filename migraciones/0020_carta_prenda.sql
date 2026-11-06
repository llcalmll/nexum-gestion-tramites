-- Levantamiento de prenda: la precondición "Carta de levantamiento de prenda" (la carta original del acreedor, banco o
-- financiera, que autoriza al tránsito a levantarla; sin ella devuelven el trámite) y el documento en sus requisitos.
-- Solo datos del catálogo (se pueden seguir editando en Configuración).
UPDATE tipos_tramite SET precondiciones = json_set(precondiciones, '$.carta_prenda', json('true')) WHERE nombre = 'Levantamiento de prenda';
--> statement-breakpoint
UPDATE tipos_tramite SET requisitos = json_insert(requisitos, '$[#]', json('{"documento":"Carta de levantamiento de prenda del acreedor (original)","obligatorio":true}')) WHERE nombre = 'Levantamiento de prenda' AND requisitos NOT LIKE '%Carta de levantamiento de prenda%';
