-- Consolidados (Felipe, 27/10/2026): la "receta" de un PDF que junta varios documentos del trámite (de dónde sale
-- cada página y cómo se acomodó), para editarlo después desde los originales. JSON; NULL en los demás documentos.
ALTER TABLE `documentos` ADD `composicion` text;
