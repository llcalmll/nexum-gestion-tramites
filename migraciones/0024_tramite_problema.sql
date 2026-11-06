-- Trámites con "chicharrón" (Felipe, 22/10/2026): los que tienen un problema raro (un embargo que sigue figurando
-- aunque ya trae el paz y salvo, algo que sale en un sistema y en otro no...). Se marcan con clic derecho y salen con
-- una calavera junto al código. En un combo, se marcan todas sus partes.
ALTER TABLE tramites ADD COLUMN problema INTEGER NOT NULL DEFAULT 0 CHECK (problema IN (0, 1));
