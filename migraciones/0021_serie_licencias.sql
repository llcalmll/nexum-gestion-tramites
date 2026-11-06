-- Las licencias con su propia numeración (Felipe, 16/10/2026): cada trámite lleva su serie, "T" (trámites de vehículos
-- y los demás) o "L" (licencias), y el número es único dentro de su serie. Las licencias existentes pasan a la serie L,
-- numeradas desde 1 en orden de fecha (de recepción y, a igual fecha, de su número anterior). Un combo que mezcla
-- licencia y vehículo se queda en la T. Cada licencia renumerada guarda en su bitácora su código anterior (así lo
-- encuentra también la búsqueda) y los combos de licencias conservan su código común (el número de su primera parte).
ALTER TABLE tramites ADD COLUMN serie text DEFAULT 'T' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS tramites_numero_unq;
--> statement-breakpoint
CREATE UNIQUE INDEX tramites_serie_numero_unq ON tramites (serie, numero);
--> statement-breakpoint
CREATE TABLE _renumeracion_l (id text PRIMARY KEY, viejo integer NOT NULL, creado text NOT NULL, nuevo integer NOT NULL);
--> statement-breakpoint
INSERT INTO _renumeracion_l (id, viejo, creado, nuevo)
SELECT t.id, t.numero, t.creado, ROW_NUMBER() OVER (ORDER BY t.creado, t.numero)
FROM tramites t JOIN tipos_tramite tt ON tt.id = t.tipo_id
WHERE tt.categoria = 'licencia'
  AND NOT EXISTS (SELECT 1 FROM tramites o JOIN tipos_tramite ot ON ot.id = o.tipo_id WHERE t.encargo_id IS NOT NULL AND o.encargo_id = t.encargo_id AND ot.categoria <> 'licencia');
--> statement-breakpoint
UPDATE tramites SET serie = 'L', numero = (SELECT nuevo FROM _renumeracion_l r WHERE r.id = tramites.id) WHERE id IN (SELECT id FROM _renumeracion_l);
--> statement-breakpoint
UPDATE tramites SET codigo = (SELECT MIN(p.numero) FROM tramites p WHERE p.encargo_id = tramites.encargo_id AND p.serie = 'L') WHERE serie = 'L' AND encargo_id IS NOT NULL AND codigo IS NOT NULL;
--> statement-breakpoint
INSERT INTO bitacora (id, tramite_id, tipo_evento, descripcion, origen, fecha)
SELECT lower(hex(randomblob(16))), r.id, 'nota', 'Numeración de licencias aparte: el código anterior era T-' || substr(r.creado, 1, 4) || '-' || printf('%05d', r.viejo) || '; ahora es L-' || substr(r.creado, 1, 4) || '-' || printf('%05d', r.nuevo) || '.', 'sistema', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM _renumeracion_l r;
--> statement-breakpoint
DROP TABLE _renumeracion_l;
