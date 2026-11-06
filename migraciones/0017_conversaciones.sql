-- Conversaciones del asistente: quedan guardadas (hasta 120 mensajes) y se borran solas a los 30 días sin usar.
CREATE TABLE `conversaciones` (
	`id` text PRIMARY KEY NOT NULL,
	`titulo` text NOT NULL,
	`mensajes` text NOT NULL,
	`cantidad` integer DEFAULT 0 NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversaciones_actualizado_idx` ON `conversaciones` (`actualizado`);
