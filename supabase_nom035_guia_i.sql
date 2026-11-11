-- Guarda el resultado propio de la Guía I (acontecimientos traumáticos severos)
-- junto a cada respuesta, para mostrarlo en el panel y en el Excel.
alter table nom035_respuestas add column if not exists guia_i jsonb;
