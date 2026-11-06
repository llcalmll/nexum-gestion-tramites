CREATE TABLE `cotizaciones` (
	`id` text PRIMARY KEY NOT NULL,
	`titulo` text NOT NULL,
	`tramite` text,
	`total` integer DEFAULT 0 NOT NULL,
	`texto` text NOT NULL,
	`origen` text DEFAULT 'fotos' NOT NULL,
	`datos` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cotizaciones_creado_idx` ON `cotizaciones` (`creado`);
