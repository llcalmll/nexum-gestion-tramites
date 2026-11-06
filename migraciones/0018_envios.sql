-- Sobres enviados (Papelería > Envíos): a quién, a qué ciudad, con qué trámite y guía, y si ya llegó. El mapa los
-- muestra como camionetas en ruta hasta que el sobre llega.
CREATE TABLE `envios` (
	`id` text PRIMARY KEY NOT NULL,
	`tramite_id` text REFERENCES tramites(id) ON DELETE SET NULL,
	`destinatario` text NOT NULL,
	`ciudad` text NOT NULL,
	`direccion` text,
	`telefono` text,
	`guia` text,
	`formato` text DEFAULT 'grande' NOT NULL,
	`estado` text DEFAULT 'enviado' NOT NULL,
	`fecha_envio` text NOT NULL,
	`fecha_recibido` text,
	`notas` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "envios_estado_chk" CHECK("envios"."estado" in ('enviado', 'recibido', 'devuelto')),
	CONSTRAINT "envios_formato_chk" CHECK("envios"."formato" in ('grande', 'pequeno'))
);
--> statement-breakpoint
CREATE INDEX `envios_estado_idx` ON `envios` (`estado`, `fecha_envio`);
--> statement-breakpoint
CREATE INDEX `envios_tramite_idx` ON `envios` (`tramite_id`);
--> statement-breakpoint
CREATE INDEX `envios_version_idx` ON `envios` (`version`);
--> statement-breakpoint
CREATE TRIGGER envios_sync_ins AFTER INSERT ON envios BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE envios SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER envios_sync_upd AFTER UPDATE ON envios WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE envios SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER envios_sync_del AFTER DELETE ON envios BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('envios', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
