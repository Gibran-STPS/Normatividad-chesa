-- =====================================================================
-- Certificados Técnicos: compresores, tanques de gas, estudios de
-- ruido/iluminación y programas internos de protección civil (PIPC).
-- Cada tabla se relaciona con un centro de trabajo. Las fechas de
-- vigencia se usan para mostrar alertas cuando un dictamen/estudio/PIPC
-- está por vencer o ya venció.
-- =====================================================================

create table if not exists compresores (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  tipo_compresor text,
  grado_compresor text,
  numero_control_stps text,
  vigencia_dictamen date,
  creado_en timestamptz not null default now()
);

create table if not exists tanques_gas (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  capacidad text,
  vigencia_nom004 date,  -- NOM-004-SEDG-2004
  vigencia_nom013 date,  -- NOM-013-SEDG-2002
  creado_en timestamptz not null default now()
);

create table if not exists estudios_ruido_iluminacion (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  vigencia_nom011 date,  -- NOM-011-STPS (ruido)
  vigencia_nom025 date,  -- NOM-025-STPS (iluminación)
  creado_en timestamptz not null default now()
);

create table if not exists programas_proteccion_civil (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  vigencia_pipc date,
  creado_en timestamptz not null default now()
);

-- RLS: cualquier usuario autenticado del panel puede leer/escribir
-- (mismo criterio que el resto de las tablas del sistema).
do $$
declare
  t text;
begin
  foreach t in array array['compresores','tanques_gas','estudios_ruido_iluminacion','programas_proteccion_civil']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "leer %I" on %I;', t, t);
    execute format('create policy "leer %I" on %I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists "escribir %I" on %I;', t, t);
    execute format('create policy "escribir %I" on %I for insert to authenticated with check (true);', t, t);
    execute format('drop policy if exists "actualizar %I" on %I;', t, t);
    execute format('create policy "actualizar %I" on %I for update to authenticated using (true) with check (true);', t, t);
    execute format('drop policy if exists "borrar %I" on %I;', t, t);
    execute format('create policy "borrar %I" on %I for delete to authenticated using (true);', t, t);
  end loop;
end $$;
