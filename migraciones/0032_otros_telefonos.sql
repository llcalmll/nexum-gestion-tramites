-- Varios teléfonos por persona (Felipe, 30/10/2026): el de siempre sigue en `telefono` (el principal: WhatsApp,
-- formulario único...) y los demás van aquí, como lista JSON de números con solo dígitos. NULL = ninguno más.
ALTER TABLE `clientes` ADD `otros_telefonos` text;
