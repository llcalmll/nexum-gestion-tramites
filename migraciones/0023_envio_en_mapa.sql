-- Envíos en el mapa (Felipe, 22/10/2026): un sobre solo sale en el mapa si al imprimirlo se elige «Dejar en el mapa»
-- (o después, desde Sobres en camino). Activo (con el pulso en la vena) hasta las 6:30 del día siguiente; después,
-- gris, como constancia de los envíos a esa ciudad. Los que ya iban en camino se dejan en el mapa.
ALTER TABLE envios ADD COLUMN en_mapa INTEGER NOT NULL DEFAULT 0 CHECK (en_mapa IN (0, 1));
--> statement-breakpoint
UPDATE envios SET en_mapa = 1 WHERE estado = 'enviado';
