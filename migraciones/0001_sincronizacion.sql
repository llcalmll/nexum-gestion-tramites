-- Sincronización con el navegador.
-- Cada insert, update o delete en una tabla sincronizada sube el contador global y marca la fila con ese número.
-- El navegador pide "lo que cambió desde N" (GET /api/cambios) y solo lee filas nuevas, usando el índice de version.
-- Los borrados quedan en "eliminados" para que el navegador también los quite.
-- Si se agrega una tabla sincronizada, sus triggers van en la migración que la crea.
INSERT INTO contador (id, version) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER clientes_sync_ins AFTER INSERT ON clientes BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE clientes SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER clientes_sync_upd AFTER UPDATE ON clientes WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE clientes SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER clientes_sync_del AFTER DELETE ON clientes BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('clientes', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER organismos_sync_ins AFTER INSERT ON organismos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE organismos SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER organismos_sync_upd AFTER UPDATE ON organismos WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE organismos SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER organismos_sync_del AFTER DELETE ON organismos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('organismos', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER tipos_tramite_sync_ins AFTER INSERT ON tipos_tramite BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tipos_tramite SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tipos_tramite_sync_upd AFTER UPDATE ON tipos_tramite WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tipos_tramite SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tipos_tramite_sync_del AFTER DELETE ON tipos_tramite BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('tipos_tramite', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER tarifas_sync_ins AFTER INSERT ON tarifas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tarifas SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tarifas_sync_upd AFTER UPDATE ON tarifas WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tarifas SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tarifas_sync_del AFTER DELETE ON tarifas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('tarifas', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER parametros_sync_ins AFTER INSERT ON parametros BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE parametros SET version = (SELECT version FROM contador WHERE id = 1) WHERE clave = NEW.clave;
END;
--> statement-breakpoint
CREATE TRIGGER parametros_sync_upd AFTER UPDATE ON parametros WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE parametros SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE clave = NEW.clave;
END;
--> statement-breakpoint
CREATE TRIGGER parametros_sync_del AFTER DELETE ON parametros BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('parametros', OLD.clave, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER vehiculos_sync_ins AFTER INSERT ON vehiculos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE vehiculos SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER vehiculos_sync_upd AFTER UPDATE ON vehiculos WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE vehiculos SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER vehiculos_sync_del AFTER DELETE ON vehiculos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('vehiculos', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER vehiculo_personas_sync_ins AFTER INSERT ON vehiculo_personas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE vehiculo_personas SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER vehiculo_personas_sync_upd AFTER UPDATE ON vehiculo_personas WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE vehiculo_personas SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER vehiculo_personas_sync_del AFTER DELETE ON vehiculo_personas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('vehiculo_personas', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER tramites_sync_ins AFTER INSERT ON tramites BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tramites SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tramites_sync_upd AFTER UPDATE ON tramites WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tramites SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tramites_sync_del AFTER DELETE ON tramites BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('tramites', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER tramite_personas_sync_ins AFTER INSERT ON tramite_personas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tramite_personas SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tramite_personas_sync_upd AFTER UPDATE ON tramite_personas WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE tramite_personas SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER tramite_personas_sync_del AFTER DELETE ON tramite_personas BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('tramite_personas', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER documentos_sync_ins AFTER INSERT ON documentos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE documentos SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER documentos_sync_upd AFTER UPDATE ON documentos WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE documentos SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER documentos_sync_del AFTER DELETE ON documentos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('documentos', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER pagos_sync_ins AFTER INSERT ON pagos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE pagos SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER pagos_sync_upd AFTER UPDATE ON pagos WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE pagos SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER pagos_sync_del AFTER DELETE ON pagos BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('pagos', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER bitacora_sync_ins AFTER INSERT ON bitacora BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE bitacora SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER bitacora_sync_upd AFTER UPDATE ON bitacora WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE bitacora SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER bitacora_sync_del AFTER DELETE ON bitacora BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('bitacora', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER licencias_sync_ins AFTER INSERT ON licencias BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE licencias SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER licencias_sync_upd AFTER UPDATE ON licencias WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE licencias SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER licencias_sync_del AFTER DELETE ON licencias BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('licencias', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
--> statement-breakpoint
CREATE TRIGGER recordatorios_sync_ins AFTER INSERT ON recordatorios BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE recordatorios SET version = (SELECT version FROM contador WHERE id = 1) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER recordatorios_sync_upd AFTER UPDATE ON recordatorios WHEN NEW.version = OLD.version BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  UPDATE recordatorios SET version = (SELECT version FROM contador WHERE id = 1), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER recordatorios_sync_del AFTER DELETE ON recordatorios BEGIN
  UPDATE contador SET version = version + 1 WHERE id = 1;
  INSERT INTO eliminados (tabla, registro_id, version) VALUES ('recordatorios', OLD.id, (SELECT version FROM contador WHERE id = 1));
END;
