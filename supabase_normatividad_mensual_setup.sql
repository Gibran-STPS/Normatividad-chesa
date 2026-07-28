-- =====================================================================
-- Normatividad Grupo Automotriz Chesa — Módulo de Seguimiento Mensual
-- (Calendario normativo por centro + Constancias de vacaciones)
-- Ejecuta esto DESPUÉS de supabase_setup.sql y supabase_ia_setup.sql,
-- en: SQL Editor > New query
-- =====================================================================

-- 1) Cada centro necesita un "código de agencia" para poder emparejarlo
--    con las hojas de tu Excel de calendario (ej. "N. SCC", "N.CMT").
--    Lo capturas una sola vez por centro, desde el modal de "Editar Centro".
alter table centros_trabajo add column if not exists codigo_agencia text;

-- 1.1) Correo del responsable de cada centro, para armar el borrador del
--      correo mensual (también se captura una sola vez, desde el mismo modal).
alter table centros_trabajo add column if not exists responsable_email text;

-- 1.2) Marca del centro (Nissan, Renault, Changan, Ecos Digitales...) para
--      mostrar su logo correspondiente junto al de Grupo Chesa.
alter table centros_trabajo add column if not exists marca text;

-- 2) Calendario normativo: una fila por centro + norma + actividad + mes.
--    Se llena con el importador del Excel (no manualmente), y cada mes
--    se marca "Realizada" desde el panel en lugar de escribir una R a mano.
create table if not exists calendario_normativo (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  norma_code text references normas_catalogo(code) on delete set null,
  norma_titulo_original text,
  actividad text not null,
  mes int not null check (mes between 1 and 12),
  anio int not null,
  estado text not null default 'Planeada' check (estado in ('Planeada','Realizada')),
  fecha_realizada date,
  realizado_por uuid references auth.users(id),
  notas text,
  -- Clave NULL-safe para que el importador pueda hacer upsert aunque
  -- norma_code no coincida con el catálogo (Postgres no deduplica NULLs
  -- en una unique constraint normal).
  clave_unica text generated always as (
    centro_id || '|' || coalesce(norma_code,'') || '|' || actividad || '|' || mes::text || '|' || anio::text
  ) stored unique
);

alter table calendario_normativo enable row level security;
drop policy if exists "leer calendario_normativo" on calendario_normativo;
create policy "leer calendario_normativo" on calendario_normativo
  for select using (auth.role() = 'authenticated');
drop policy if exists "escribir calendario_normativo" on calendario_normativo;
create policy "escribir calendario_normativo" on calendario_normativo
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "actualizar calendario_normativo" on calendario_normativo;
create policy "actualizar calendario_normativo" on calendario_normativo
  for update using (auth.role() = 'authenticated');
drop policy if exists "borrar calendario_normativo" on calendario_normativo;
create policy "borrar calendario_normativo" on calendario_normativo
  for delete using (auth.role() = 'authenticated');

create index if not exists idx_calendario_centro_mes
  on calendario_normativo (centro_id, anio, mes);

-- 3) Plantillas de documentos (los Word/Excel que anexas por actividad).
--    El archivo real vive en Supabase Storage (bucket "plantillas");
--    esta tabla solo guarda la referencia y a qué norma/actividad pertenece.
create table if not exists plantillas_documentos (
  id uuid primary key default gen_random_uuid(),
  norma_code text references normas_catalogo(code) on delete set null,
  actividad text,
  nombre_archivo text not null,
  storage_path text not null,
  subido_en timestamptz not null default now(),
  subido_por uuid references auth.users(id)
);

alter table plantillas_documentos enable row level security;
drop policy if exists "leer plantillas_documentos" on plantillas_documentos;
create policy "leer plantillas_documentos" on plantillas_documentos
  for select using (auth.role() = 'authenticated');
drop policy if exists "escribir plantillas_documentos" on plantillas_documentos;
create policy "escribir plantillas_documentos" on plantillas_documentos
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "borrar plantillas_documentos" on plantillas_documentos;
create policy "borrar plantillas_documentos" on plantillas_documentos
  for delete using (auth.role() = 'authenticated');

-- 4) Tabla legal de días de vacaciones por antigüedad (reforma vigente).
--    Editable aquí mismo si la ley cambia — no está escrita en el código.
create table if not exists tabla_vacaciones_dias (
  anios_laborados int primary key,
  dias_vacaciones int not null
);

alter table tabla_vacaciones_dias enable row level security;
drop policy if exists "leer tabla_vacaciones_dias" on tabla_vacaciones_dias;
create policy "leer tabla_vacaciones_dias" on tabla_vacaciones_dias
  for select using (auth.role() = 'authenticated');
drop policy if exists "escribir tabla_vacaciones_dias" on tabla_vacaciones_dias;
create policy "escribir tabla_vacaciones_dias" on tabla_vacaciones_dias
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "actualizar tabla_vacaciones_dias" on tabla_vacaciones_dias;
create policy "actualizar tabla_vacaciones_dias" on tabla_vacaciones_dias
  for update using (auth.role() = 'authenticated');

insert into tabla_vacaciones_dias (anios_laborados, dias_vacaciones) values
  (1,12),(2,14),(3,16),(4,18),(5,20),
  (6,22),(7,22),(8,22),(9,22),(10,22),
  (11,24),(12,24),(13,24),(14,24),(15,24),
  (16,26),(17,26),(18,26),(19,26),(20,26),
  (21,28),(22,28),(23,28),(24,28),(25,28),
  (26,30),(27,30),(28,30),(29,30),(30,30),
  (31,32),(32,32),(33,32),(34,32),(35,32),
  (36,34),(37,34),(38,34),(39,34),(40,34)
on conflict (anios_laborados) do nothing;

-- 5) Colaboradores (importados desde tu Cuadro General de Antigüedades).
create table if not exists colaboradores (
  clave text primary key,
  nombre text not null,
  marca text,
  sucursal_nombre text,
  centro_id text references centros_trabajo(id) on delete set null,
  tipo_contrato text,
  fecha_ingreso date not null,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

alter table colaboradores enable row level security;
drop policy if exists "leer colaboradores" on colaboradores;
create policy "leer colaboradores" on colaboradores
  for select using (auth.role() = 'authenticated');
drop policy if exists "escribir colaboradores" on colaboradores;
create policy "escribir colaboradores" on colaboradores
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "actualizar colaboradores" on colaboradores;
create policy "actualizar colaboradores" on colaboradores
  for update using (auth.role() = 'authenticated');

create index if not exists idx_colaboradores_centro
  on colaboradores (centro_id);

-- 6) Historial de constancias de vacaciones generadas (para no repetir
--    el mismo periodo sin querer, y como respaldo/trazabilidad).
create table if not exists constancias_generadas (
  id uuid primary key default gen_random_uuid(),
  colaborador_clave text references colaboradores(clave) on delete cascade,
  centro_id text references centros_trabajo(id),
  anios_laborados int,
  dias int,
  periodo_inicio date,
  periodo_fin date,
  generado_en timestamptz not null default now(),
  generado_por uuid references auth.users(id)
);

alter table constancias_generadas enable row level security;
drop policy if exists "leer constancias_generadas" on constancias_generadas;
create policy "leer constancias_generadas" on constancias_generadas
  for select using (auth.role() = 'authenticated');
drop policy if exists "escribir constancias_generadas" on constancias_generadas;
create policy "escribir constancias_generadas" on constancias_generadas
  for insert with check (auth.role() = 'authenticated');

-- =====================================================================
-- IMPORTANTE — Bucket de Storage para las plantillas
-- Este script SQL no puede crear buckets de Storage. Hazlo una vez,
-- a mano, en el dashboard de Supabase:
--   1. Ve a Storage (menú izquierdo) > "New bucket".
--   2. Nómbralo exactamente: plantillas
--   3. Márcalo como "Public bucket" = NO (privado).
--   4. Crea estas políticas en Storage > plantillas > Policies:
--      - SELECT: authenticated
--      - INSERT: authenticated
--      - DELETE: authenticated
--    (En "New policy" elige la plantilla "Give users access to only
--    their own top level folder" NO — usa mejor "Enable read/write
--    access for authenticated users only" si aparece, o crea una
--    política custom con la expresión: auth.role() = 'authenticated'
--    para SELECT, INSERT y DELETE.)
-- =====================================================================
