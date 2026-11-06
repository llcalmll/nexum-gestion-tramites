-- Notica destacada (Felipe, 05/11/2026): además de fijarla, una notica se puede destacar: sale de primera con un brillo
-- que le da la vuelta a los bordes y late todo el tiempo. Es de las noticas de la barra de arriba, no de las del expediente.
ALTER TABLE `notas` ADD `destacada` integer DEFAULT 0 NOT NULL;
