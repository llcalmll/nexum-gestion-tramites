CREATE TABLE `uso_ia` (
	`fecha` text NOT NULL,
	`funcion` text NOT NULL,
	`modelo` text NOT NULL,
	`llamadas` integer DEFAULT 0 NOT NULL,
	`tokens_entrada` integer DEFAULT 0 NOT NULL,
	`tokens_salida` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`fecha`, `funcion`, `modelo`)
);
