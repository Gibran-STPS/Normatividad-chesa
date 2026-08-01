-- =====================================================================
-- Actualiza NOM-017-STPS-2008 -> NOM-017-STPS-2024 en TODO el sistema
-- (la STPS publicó una edición nueva de esta norma).
--
-- "norma_code" es la llave que usan 3 tablas para saber qué norma es
-- cada cosa: qué centros la tienen asignada, qué plantillas le
-- pertenecen, y qué actividades del calendario son de esa norma. Por
-- eso no basta con renombrar el catálogo: hay que migrar las 3 antes
-- de borrar el código viejo, o se perdería esa información.
--
-- Seguro de volver a ejecutar (si ya no queda nada con el código viejo,
-- los "update" y el "delete" simplemente no afectan ninguna fila).
-- =====================================================================
begin;

-- 1) Crear el código nuevo en el catálogo, copiando la descripción del viejo.
--    Si quieres ajustar el texto exacto de la edición 2024, edita la
--    descripción después desde el panel o con un update aparte.
insert into normas_catalogo (code, descripcion)
  select 'NOM-017-STPS-2024', descripcion
  from normas_catalogo
  where code = 'NOM-017-STPS-2008'
  on conflict (code) do nothing;

-- 2) Migrar las 3 tablas que referencian el código viejo.
update centro_normas
  set norma_code = 'NOM-017-STPS-2024'
  where norma_code = 'NOM-017-STPS-2008';

update plantillas_documentos
  set norma_code = 'NOM-017-STPS-2024'
  where norma_code = 'NOM-017-STPS-2008';

update calendario_normativo
  set norma_code = 'NOM-017-STPS-2024'
  where norma_code = 'NOM-017-STPS-2008';

-- 3) Ya sin nada apuntando al código viejo, se puede borrar del catálogo.
delete from normas_catalogo where code = 'NOM-017-STPS-2008';

commit;
