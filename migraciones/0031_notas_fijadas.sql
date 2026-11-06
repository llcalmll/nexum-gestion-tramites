-- Notas fijadas (Felipe, 29/10/2026): además de la destacada (la estrella, una por trámite, grande), varias entradas de
-- la bitácora se fijan con la chinche y salen pequeñas arriba del expediente, al lado de la destacada.
ALTER TABLE `bitacora` ADD `fijada` integer DEFAULT 0 NOT NULL;
