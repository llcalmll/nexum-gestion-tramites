-- Nota destacada: una entrada de la bitácora de un trámite que sale grande arriba del expediente (una por trámite).
ALTER TABLE `bitacora` ADD `destacada` integer DEFAULT 0 NOT NULL;
