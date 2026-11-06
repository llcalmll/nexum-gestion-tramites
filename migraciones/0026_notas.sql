-- Noticas (Felipe, 23/10/2026): notas rápidas y tareas del día, en la barra de arriba (junto a la fecha), en cualquier
-- pantalla. `fijada`: importante (va primero); `hecha`: tachada; las hechas se borran a los 7 días (cron diario).
-- Se copian al navegador como las demás tablas (versión, triggers y eliminados).
CREATE TABLE `notas` (
	`id` text PRIMARY KEY NOT NULL,
	`texto` text NOT NULL,
	`color` text DEFAULT 'amarillo' NOT NULL,
	`fijada` integer DEFAULT 0 NOT NULL,
	`hecha` integer DEFAULT 0 NOT NULL,
	`hecha_en` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notas_color_chk" CHECK("notas"."color" in ('amarillo', 'rosa', 'verde', 'azul', 'lila')),
	CONSTRAINT "notas_fijada_chk" CHECK("notas"."fijada" in (0, 1)),
	CONSTRAINT "notas_hecha_chk" CHECK("notas"."hecha" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `notas_version_idx` ON `notas` (`version`);
--> statement-breakpoint
CREATE TRIGGER notas_sync_ins AFTER INSERT ON notas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE notas SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER notas_sync_upd AFTER UPDATE ON notas WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE notas SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER notas_sync_del AFTER DELETE ON notas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('notas', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
