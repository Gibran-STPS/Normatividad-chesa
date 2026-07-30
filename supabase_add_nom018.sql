-- =====================================================================
-- Agrega la NOM-018-STPS-2015 al catálogo de normas
-- (faltaba: el catálogo saltaba de NOM-017 a NOM-019)
-- Seguro de volver a ejecutar: si el código ya existe, no hace nada.
-- =====================================================================
insert into normas_catalogo (code, descripcion) values
  ('NOM-018-STPS-2015', 'Sistema armonizado para la identificación y comunicación de peligros y riesgos por sustancias químicas peligrosas en los centros de trabajo')
on conflict (code) do nothing;
