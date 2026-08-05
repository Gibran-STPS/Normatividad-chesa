-- =====================================================================
-- Agrega al PIPC (Programa Interno de Protección Civil) los metros
-- cuadrados del inmueble y su nivel de riesgo (clasificación estándar
-- de Protección Civil: Alto/Mediano/Bajo).
-- =====================================================================
alter table programas_proteccion_civil add column if not exists metros_cuadrados numeric;
alter table programas_proteccion_civil add column if not exists nivel_riesgo text
  check (nivel_riesgo in ('Alto', 'Mediano', 'Bajo'));
