-- =====================================================================
-- Normatividad Grupo Automotriz Chesa — Módulo de IA (resúmenes de riesgo)
-- Ejecuta esto DESPUÉS de supabase_setup.sql, en: SQL Editor > New query
-- =====================================================================

-- Historial de resúmenes de riesgo generados por IA para cada centro
create table if not exists resumenes_riesgo (
  id uuid primary key default gen_random_uuid(),
  centro_id text references centros_trabajo(id) on delete cascade,
  resumen text not null,
  nivel_riesgo text not null check (nivel_riesgo in ('Bajo','Medio','Alto','Crítico')),
  generado_en timestamptz not null default now(),
  generado_por uuid references auth.users(id)
);

alter table resumenes_riesgo enable row level security;

-- Cualquier usuario autenticado puede leer el historial de resúmenes
create policy "leer resumenes_riesgo" on resumenes_riesgo
  for select using (auth.role() = 'authenticated');

-- La escritura la hace la Edge Function usando la llave "service_role"
-- (que se salta RLS por diseño), así que NO se necesita política de
-- inserción para usuarios normales. Esto es intencional: evita que
-- alguien inserte resúmenes falsos directamente desde el navegador.

-- Índice para traer rápido "el último resumen de cada centro"
create index if not exists idx_resumenes_riesgo_centro_fecha
  on resumenes_riesgo (centro_id, generado_en desc);
