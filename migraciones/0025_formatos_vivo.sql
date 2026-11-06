-- Formatos en vivo (Felipe, 23/10/2026): lo que el celular lee en Formatos (la tarjeta de propiedad, la cédula del
-- vendedor o la del comprador) llega solo a Llenar formatos abierto en el PC, sin "Enviar al PC". Cada lectura es una
-- fila; el PC que la toma la marca (si hay dos PC abiertos, la toma uno solo). Se borran a la hora (cron diario).
CREATE TABLE formatos_vivo (
  id TEXT PRIMARY KEY NOT NULL,
  doc TEXT NOT NULL CHECK (doc IN ('tarjeta', 'propietario', 'comprador')),
  datos TEXT NOT NULL,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  tomado TEXT
);
CREATE INDEX formatos_vivo_creado_idx ON formatos_vivo (creado);
