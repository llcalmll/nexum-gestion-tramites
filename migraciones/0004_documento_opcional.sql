-- El documento del cliente pasa a ser opcional (vacío = sin documento todavía): único solo cuando existe.
-- Se cambia solo el índice; la tabla no se reconstruye (en D1 eso dispararía borrados en cascada).
DROP INDEX `clientes_documento_unq`;--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_documento_unq` ON `clientes` (`numero_documento`) WHERE numero_documento <> '';