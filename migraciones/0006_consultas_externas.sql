CREATE TABLE `consultas_externas` (
	`id` text PRIMARY KEY NOT NULL,
	`servicio` text DEFAULT 'placapi' NOT NULL,
	`tipo` text NOT NULL,
	`referencia` text NOT NULL,
	`creditos` integer DEFAULT 0 NOT NULL,
	`resultado` text NOT NULL,
	`detalle` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "consultas_externas_resultado_chk" CHECK("consultas_externas"."resultado" IN ('ok', 'sin_datos', 'error'))
);
--> statement-breakpoint
CREATE INDEX `consultas_externas_ref_idx` ON `consultas_externas` (`tipo`,`referencia`,`creado`);--> statement-breakpoint
CREATE INDEX `consultas_externas_creado_idx` ON `consultas_externas` (`creado`);