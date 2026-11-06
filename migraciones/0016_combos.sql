-- Combos: los trámites creados juntos (un encargo: traspaso + levantamiento de prenda...) llevan un solo código, el
-- número del primero. Los números de cada trámite no cambian (también lo encuentran).
ALTER TABLE `tramites` ADD `codigo` integer;--> statement-breakpoint
UPDATE `tramites` SET `codigo` = (SELECT min(t2.`numero`) FROM `tramites` t2 WHERE t2.`encargo_id` = `tramites`.`encargo_id`) WHERE `encargo_id` IS NOT NULL;
