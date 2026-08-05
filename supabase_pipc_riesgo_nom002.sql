-- =====================================================================
-- Ajusta el nivel de riesgo del PIPC a la terminología de la
-- NOM-002-STPS: solo "Ordinario" o "Alto" (antes tenía Bajo/Mediano/Alto).
-- Si ya tenías registros con "Bajo" o "Mediano", se migran a "Ordinario"
-- (que es la categoría de la norma que los cubre).
-- =====================================================================
update programas_proteccion_civil
  set nivel_riesgo = 'Ordinario'
  where nivel_riesgo in ('Bajo', 'Mediano');

alter table programas_proteccion_civil drop constraint if exists programas_proteccion_civil_nivel_riesgo_check;
alter table programas_proteccion_civil add constraint programas_proteccion_civil_nivel_riesgo_check
  check (nivel_riesgo in ('Ordinario', 'Alto'));
