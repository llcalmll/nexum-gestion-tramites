CREATE TABLE `resumenes_diarios` (
	`fecha` text PRIMARY KEY NOT NULL,
	`contenido` text NOT NULL,
	`leido` integer DEFAULT false NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "resumenes_diarios_leido" CHECK("resumenes_diarios"."leido" IN (0, 1))
);
