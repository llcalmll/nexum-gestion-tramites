CREATE TABLE `formatos` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`descripcion` text,
	`archivo_clave` text NOT NULL,
	`archivo_nombre` text NOT NULL,
	`archivo_tipo` text NOT NULL,
	`archivo_bytes` integer NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
