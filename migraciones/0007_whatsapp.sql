-- Fase 5: monitor de WhatsApp de solo lectura (Kapso, coexistencia). wa_chats y wa_propuestas se copian al navegador
-- (triggers de sincronización al final, como en 0001); wa_mensajes y wa_estado se consultan bajo demanda.
CREATE TABLE `wa_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text,
	`cliente_id` text,
	`clasificacion` text DEFAULT 'pendiente' NOT NULL,
	`motivo` text,
	`ultimo_mensaje` text,
	`ultimo_texto` text,
	`mensajes` integer DEFAULT 0 NOT NULL,
	`no_leidos` integer DEFAULT 0 NOT NULL,
	`analizado_hasta` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "wa_chats_clasificacion_chk" CHECK("wa_chats"."clasificacion" IN ('pendiente', 'tramites', 'dudoso', 'personal_propuesto', 'personal'))
);
--> statement-breakpoint
CREATE INDEX `wa_chats_cliente_idx` ON `wa_chats` (`cliente_id`);--> statement-breakpoint
CREATE INDEX `wa_chats_version_idx` ON `wa_chats` (`version`);--> statement-breakpoint
CREATE TABLE `wa_estado` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wa_mensajes` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`direccion` text NOT NULL,
	`tipo` text NOT NULL,
	`texto` text,
	`archivo_clave` text,
	`archivo_tipo` text,
	`archivo_nombre` text,
	`archivo_enlace` text,
	`enviado` text NOT NULL,
	`origen` text DEFAULT 'vivo' NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `wa_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wa_mensajes_direccion_chk" CHECK("wa_mensajes"."direccion" IN ('entrante', 'saliente')),
	CONSTRAINT "wa_mensajes_origen_chk" CHECK("wa_mensajes"."origen" IN ('vivo', 'historial'))
);
--> statement-breakpoint
CREATE INDEX `wa_mensajes_chat_idx` ON `wa_mensajes` (`chat_id`,`enviado`);--> statement-breakpoint
CREATE TABLE `wa_propuestas` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`tipo` text NOT NULL,
	`titulo` text NOT NULL,
	`metodo` text NOT NULL,
	`ruta` text NOT NULL,
	`cuerpo` text NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`mensaje_id` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `wa_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wa_propuestas_estado_chk" CHECK("wa_propuestas"."estado" IN ('pendiente', 'hecha', 'descartada'))
);
--> statement-breakpoint
CREATE INDEX `wa_propuestas_chat_idx` ON `wa_propuestas` (`chat_id`);--> statement-breakpoint
CREATE INDEX `wa_propuestas_version_idx` ON `wa_propuestas` (`version`);--> statement-breakpoint
CREATE TRIGGER wa_chats_sync_ins AFTER INSERT ON wa_chats BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE wa_chats SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER wa_chats_sync_upd AFTER UPDATE ON wa_chats WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE wa_chats SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER wa_chats_sync_del AFTER DELETE ON wa_chats BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('wa_chats', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER wa_propuestas_sync_ins AFTER INSERT ON wa_propuestas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE wa_propuestas SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER wa_propuestas_sync_upd AFTER UPDATE ON wa_propuestas WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE wa_propuestas SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER wa_propuestas_sync_del AFTER DELETE ON wa_propuestas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('wa_propuestas', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
