-- Expedición de licencia (1ª vez): con clases o sin clases (Felipe, 27/10/2026). Con clases, la persona firma la carta
-- de compromiso de terminar las clases (la alerta del trámite lo recuerda). NULL: no se ha dicho (o no aplica).
ALTER TABLE `tramites` ADD `con_clases` integer;
