CREATE TABLE `avaluos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`anio_fiscal` integer NOT NULL,
	`tipo` text NOT NULL,
	`clase` text,
	`marca` text NOT NULL,
	`linea` text NOT NULL,
	`cilindraje` text,
	`valores_miles` text NOT NULL,
	`busqueda` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `avaluos_busqueda_idx` ON `avaluos` (`anio_fiscal`,`marca`,`linea`);--> statement-breakpoint
CREATE TABLE `bitacora` (
	`id` text PRIMARY KEY NOT NULL,
	`tramite_id` text NOT NULL,
	`tipo_evento` text NOT NULL,
	`descripcion` text,
	`estado_anterior` text,
	`estado_nuevo` text,
	`origen` text DEFAULT 'manual' NOT NULL,
	`referencia` text,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bitacora_tipo_chk" CHECK("bitacora"."tipo_evento" IN ('creacion', 'cambio_estado', 'nota', 'datos', 'costos', 'documento', 'pago', 'precondicion', 'persona')),
	CONSTRAINT "bitacora_origen_chk" CHECK("bitacora"."origen" IN ('manual', 'sistema', 'asistente', 'whatsapp'))
);
--> statement-breakpoint
CREATE INDEX `bitacora_tramite_idx` ON `bitacora` (`tramite_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `bitacora_version_idx` ON `bitacora` (`version`);--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` text PRIMARY KEY NOT NULL,
	`tipo_documento` text DEFAULT 'CC' NOT NULL,
	`numero_documento` text NOT NULL,
	`nombre` text NOT NULL,
	`telefono` text,
	`ciudad` text,
	`fecha_nacimiento` text,
	`fecha_expedicion_documento` text,
	`notas` text,
	`busqueda` text DEFAULT '' NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "clientes_tipo_documento_chk" CHECK("clientes"."tipo_documento" IN ('CC', 'TI', 'CE', 'Pasaporte', 'PPT', 'NIT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_documento_unq` ON `clientes` (`numero_documento`);--> statement-breakpoint
CREATE INDEX `clientes_telefono_idx` ON `clientes` (`telefono`);--> statement-breakpoint
CREATE INDEX `clientes_version_idx` ON `clientes` (`version`);--> statement-breakpoint
CREATE TABLE `contador` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documentos` (
	`id` text PRIMARY KEY NOT NULL,
	`tramite_id` text NOT NULL,
	`tipo_documento` text NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`archivo_clave` text,
	`archivo_nombre` text,
	`archivo_tipo` text,
	`archivo_bytes` integer,
	`origen` text DEFAULT 'manual' NOT NULL,
	`notas` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "documentos_estado_chk" CHECK("documentos"."estado" IN ('pendiente', 'recibido', 'validado', 'rechazado')),
	CONSTRAINT "documentos_origen_chk" CHECK("documentos"."origen" IN ('manual', 'sistema', 'asistente', 'whatsapp'))
);
--> statement-breakpoint
CREATE INDEX `documentos_tramite_idx` ON `documentos` (`tramite_id`);--> statement-breakpoint
CREATE INDEX `documentos_version_idx` ON `documentos` (`version`);--> statement-breakpoint
CREATE TABLE `eliminados` (
	`tabla` text NOT NULL,
	`registro_id` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `eliminados_version_idx` ON `eliminados` (`version`);--> statement-breakpoint
CREATE TABLE `licencias` (
	`id` text PRIMARY KEY NOT NULL,
	`cliente_id` text NOT NULL,
	`categoria` text NOT NULL,
	`fecha_expedicion` text,
	`fecha_vencimiento` text NOT NULL,
	`origen` text DEFAULT 'manual' NOT NULL,
	`tramite_id` text,
	`gestion_estado` text DEFAULT 'sin_gestion' NOT NULL,
	`gestion_nota` text,
	`gestion_fecha` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "licencias_categoria_chk" CHECK("licencias"."categoria" IN ('A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3')),
	CONSTRAINT "licencias_origen_chk" CHECK("licencias"."origen" IN ('manual', 'tramite', 'importada', 'foto', 'consulta')),
	CONSTRAINT "licencias_gestion_chk" CHECK("licencias"."gestion_estado" IN ('sin_gestion', 'por_llamar', 'contactado', 'agendado', 'renovado', 'descartado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `licencias_cliente_categoria_unq` ON `licencias` (`cliente_id`,`categoria`);--> statement-breakpoint
CREATE INDEX `licencias_vencimiento_idx` ON `licencias` (`fecha_vencimiento`);--> statement-breakpoint
CREATE INDEX `licencias_version_idx` ON `licencias` (`version`);--> statement-breakpoint
CREATE TABLE `organismos` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`ciudad` text,
	`departamento` text,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organismos_activo_chk" CHECK("organismos"."activo" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `organismos_version_idx` ON `organismos` (`version`);--> statement-breakpoint
CREATE TABLE `pagos` (
	`id` text PRIMARY KEY NOT NULL,
	`tramite_id` text NOT NULL,
	`concepto` text NOT NULL,
	`valor` integer NOT NULL,
	`fecha` text NOT NULL,
	`metodo` text,
	`comprobante_clave` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pagos_concepto_chk" CHECK("pagos"."concepto" IN ('derechos', 'honorarios', 'abono', 'otros'))
);
--> statement-breakpoint
CREATE INDEX `pagos_tramite_idx` ON `pagos` (`tramite_id`);--> statement-breakpoint
CREATE INDEX `pagos_version_idx` ON `pagos` (`version`);--> statement-breakpoint
CREATE TABLE `parametros` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`descripcion` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `parametros_version_idx` ON `parametros` (`version`);--> statement-breakpoint
CREATE TABLE `recordatorios` (
	`id` text PRIMARY KEY NOT NULL,
	`tipo` text DEFAULT 'recordatorio' NOT NULL,
	`titulo` text NOT NULL,
	`fecha` text NOT NULL,
	`hora` text,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`cliente_id` text,
	`tramite_id` text,
	`origen` text DEFAULT 'manual' NOT NULL,
	`notas` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recordatorios_tipo_chk" CHECK("recordatorios"."tipo" IN ('recordatorio', 'cita', 'llamada')),
	CONSTRAINT "recordatorios_estado_chk" CHECK("recordatorios"."estado" IN ('pendiente', 'hecho', 'cancelado')),
	CONSTRAINT "recordatorios_origen_chk" CHECK("recordatorios"."origen" IN ('manual', 'sistema', 'asistente', 'whatsapp'))
);
--> statement-breakpoint
CREATE INDEX `recordatorios_fecha_idx` ON `recordatorios` (`estado`,`fecha`);--> statement-breakpoint
CREATE INDEX `recordatorios_version_idx` ON `recordatorios` (`version`);--> statement-breakpoint
CREATE TABLE `tarifas` (
	`id` text PRIMARY KEY NOT NULL,
	`tipo_tramite_id` text NOT NULL,
	`organismo_id` text,
	`derechos_transito` integer DEFAULT 0 NOT NULL,
	`componente_runt` integer DEFAULT 0 NOT NULL,
	`estampillas` integer DEFAULT 0 NOT NULL,
	`paz_salvo` integer DEFAULT 0 NOT NULL,
	`honorarios` integer DEFAULT 0 NOT NULL,
	`vigente_desde` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tipo_tramite_id`) REFERENCES `tipos_tramite`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organismo_id`) REFERENCES `organismos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tarifas_tipo_organismo_unq` ON `tarifas` (`tipo_tramite_id`,`organismo_id`);--> statement-breakpoint
CREATE INDEX `tarifas_version_idx` ON `tarifas` (`version`);--> statement-breakpoint
CREATE TABLE `tipos_tramite` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`categoria` text NOT NULL,
	`descripcion` text,
	`requiere_vehiculo` integer DEFAULT true NOT NULL,
	`aplica_impuesto_registro` integer DEFAULT false NOT NULL,
	`sla_dias` integer,
	`requisitos` text DEFAULT '[]' NOT NULL,
	`precondiciones` text DEFAULT '{}' NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tipos_tramite_categoria_chk" CHECK("tipos_tramite"."categoria" IN ('vehiculo', 'licencia', 'seguros_multas')),
	CONSTRAINT "tipos_tramite_vehiculo_chk" CHECK("tipos_tramite"."requiere_vehiculo" IN (0, 1)),
	CONSTRAINT "tipos_tramite_registro_chk" CHECK("tipos_tramite"."aplica_impuesto_registro" IN (0, 1)),
	CONSTRAINT "tipos_tramite_activo_chk" CHECK("tipos_tramite"."activo" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tipos_tramite_nombre_unq` ON `tipos_tramite` (`nombre`);--> statement-breakpoint
CREATE INDEX `tipos_tramite_version_idx` ON `tipos_tramite` (`version`);--> statement-breakpoint
CREATE TABLE `tramite_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`tramite_id` text NOT NULL,
	`cliente_id` text NOT NULL,
	`rol` text DEFAULT 'interviniente' NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tramite_id`) REFERENCES `tramites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tramite_personas_rol_chk" CHECK("tramite_personas"."rol" IN ('titular', 'copropietario', 'comprador', 'vendedor', 'apoderado', 'interviniente'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tramite_personas_unq` ON `tramite_personas` (`tramite_id`,`cliente_id`,`rol`);--> statement-breakpoint
CREATE INDEX `tramite_personas_version_idx` ON `tramite_personas` (`version`);--> statement-breakpoint
CREATE TABLE `tramites` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` integer NOT NULL,
	`tipo_id` text NOT NULL,
	`titular_id` text NOT NULL,
	`vehiculo_id` text,
	`organismo_id` text,
	`encargo_id` text,
	`estado` text DEFAULT 'en_preparacion' NOT NULL,
	`borrador` integer DEFAULT false NOT NULL,
	`detalle` text,
	`fecha_radicado` text,
	`fecha_estimada_entrega` text,
	`fecha_entrega` text,
	`precondiciones_estado` text DEFAULT '{}' NOT NULL,
	`costo_derechos` integer DEFAULT 0 NOT NULL,
	`honorarios` integer DEFAULT 0 NOT NULL,
	`otros_costos` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`estado_pago` text DEFAULT 'pendiente' NOT NULL,
	`estado_tarjeta` text,
	`aliado` text,
	`observaciones` text,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tipo_id`) REFERENCES `tipos_tramite`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titular_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organismo_id`) REFERENCES `organismos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tramites_estado_chk" CHECK("tramites"."estado" IN ('en_preparacion', 'en_tramite', 'requiere_correccion', 'listo_para_entrega', 'entregado', 'cancelado')),
	CONSTRAINT "tramites_estado_pago_chk" CHECK("tramites"."estado_pago" IN ('pendiente', 'abonado', 'pagado')),
	CONSTRAINT "tramites_estado_tarjeta_chk" CHECK("tramites"."estado_tarjeta" IS NULL OR "tramites"."estado_tarjeta" IN ('no_recibida', 'en_oficina', 'enviada', 'entregada', 'rechazada')),
	CONSTRAINT "tramites_borrador_chk" CHECK("tramites"."borrador" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tramites_numero_unq` ON `tramites` (`numero`);--> statement-breakpoint
CREATE INDEX `tramites_estado_idx` ON `tramites` (`estado`);--> statement-breakpoint
CREATE INDEX `tramites_titular_idx` ON `tramites` (`titular_id`);--> statement-breakpoint
CREATE INDEX `tramites_vehiculo_idx` ON `tramites` (`vehiculo_id`);--> statement-breakpoint
CREATE INDEX `tramites_encargo_idx` ON `tramites` (`encargo_id`);--> statement-breakpoint
CREATE INDEX `tramites_version_idx` ON `tramites` (`version`);--> statement-breakpoint
CREATE TABLE `vehiculo_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`vehiculo_id` text NOT NULL,
	`cliente_id` text NOT NULL,
	`rol` text DEFAULT 'copropietario' NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "vehiculo_personas_rol_chk" CHECK("vehiculo_personas"."rol" IN ('titular', 'copropietario', 'comprador', 'vendedor', 'apoderado', 'interviniente'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehiculo_personas_unq` ON `vehiculo_personas` (`vehiculo_id`,`cliente_id`);--> statement-breakpoint
CREATE INDEX `vehiculo_personas_version_idx` ON `vehiculo_personas` (`version`);--> statement-breakpoint
CREATE TABLE `vehiculos` (
	`id` text PRIMARY KEY NOT NULL,
	`placa` text NOT NULL,
	`titular_id` text,
	`clase` text,
	`marca` text,
	`linea` text,
	`modelo` integer,
	`cilindraje` integer,
	`servicio` text,
	`color` text,
	`numero_motor` text,
	`numero_chasis` text,
	`numero_serie` text,
	`vin` text,
	`fecha_matricula` text,
	`organismo_matricula_id` text,
	`soat_vence` text,
	`rtm_vence` text,
	`impuesto_al_dia_hasta` text,
	`gravamenes` text DEFAULT '[]' NOT NULL,
	`avaluo_oficial` integer,
	`avaluo_detalle` text,
	`notas` text,
	`busqueda` text DEFAULT '' NOT NULL,
	`creado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`titular_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organismo_matricula_id`) REFERENCES `organismos`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "vehiculos_servicio_chk" CHECK("vehiculos"."servicio" IS NULL OR "vehiculos"."servicio" IN ('particular', 'publico', 'oficial', 'diplomatico'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehiculos_placa_unq` ON `vehiculos` (`placa`);--> statement-breakpoint
CREATE INDEX `vehiculos_titular_idx` ON `vehiculos` (`titular_id`);--> statement-breakpoint
CREATE INDEX `vehiculos_version_idx` ON `vehiculos` (`version`);