-- =====================================================================
-- Normatividad Grupo Automotriz Chesa — Configuración de base de datos
-- Ejecuta TODO este script de una sola vez en: Supabase > SQL Editor > New query
-- =====================================================================

-- 1) Catálogo de referencia: Normas Oficiales Mexicanas STPS
create table if not exists normas_catalogo (
  code text primary key,
  descripcion text not null
);

insert into normas_catalogo (code, descripcion) values
  ('NOM-001-STPS-2008', 'Edificios, locales, instalaciones y áreas en los centros de trabajo'),
  ('NOM-002-STPS-2010', 'Prevención y protección contra incendios'),
  ('NOM-004-STPS-1999', 'Sistemas de protección y dispositivos de seguridad en maquinaria y equipo'),
  ('NOM-005-STPS-1998', 'Manejo, transporte y almacenamiento de sustancias químicas peligrosas'),
  ('NOM-006-STPS-2014', 'Manejo y almacenamiento de materiales'),
  ('NOM-009-STPS-2011', 'Trabajos en altura'),
  ('NOM-010-STPS-2014', 'Agentes químicos contaminantes del ambiente laboral'),
  ('NOM-011-STPS-2001', 'Ruido en los centros de trabajo'),
  ('NOM-012-STPS-2012', 'Fuentes de radiación ionizante'),
  ('NOM-015-STPS-2001', 'Condiciones térmicas elevadas o abatidas'),
  ('NOM-017-STPS-2024', 'Equipo de protección personal'),
  ('NOM-018-STPS-2015', 'Sistema armonizado para la identificación y comunicación de peligros y riesgos por sustancias químicas peligrosas en los centros de trabajo'),
  ('NOM-019-STPS-2011', 'Comisiones de seguridad e higiene'),
  ('NOM-020-STPS-2011', 'Recipientes sujetos a presión, calderas y generadores de vapor'),
  ('NOM-021-STPS-2018', 'Informar sobre peligros y riesgos por sustancias químicas peligrosas'),
  ('NOM-022-STPS-2015', 'Electricidad estática'),
  ('NOM-025-STPS-2008', 'Condiciones de iluminación'),
  ('NOM-026-STPS-2008', 'Colores y señales de seguridad e higiene'),
  ('NOM-027-STPS-2008', 'Actividades de soldadura y corte'),
  ('NOM-029-STPS-2011', 'Mantenimiento de instalaciones eléctricas'),
  ('NOM-030-STPS-2009', 'Servicios preventivos de seguridad y salud en el trabajo'),
  ('NOM-031-STPS-2011', 'Construcción — condiciones de seguridad y salud'),
  ('NOM-033-STPS-2015', 'Espacios confinados'),
  ('NOM-034-STPS-2016', 'Acceso y desarrollo de actividades de trabajadores con discapacidad'),
  ('NOM-035-STPS-2018', 'Factores de riesgo psicosocial'),
  ('NOM-036-1-STPS-2018', 'Factores de riesgo ergonómico — manejo manual de cargas'),
  ('NOM-037-STPS-2023', 'Teletrabajo — condiciones de seguridad y salud')
on conflict (code) do nothing;

-- =====================================================================
-- IMPORTANTE: este catálogo es de referencia general con la información
-- que Claude tiene disponible. Antes de usarlo para auditorías reales,
-- verifíquenlo contra la publicación vigente de la Secretaría del
-- Trabajo y Previsión Social (DOF). Pueden editar/agregar/quitar filas
-- de esta tabla en cualquier momento desde el SQL Editor o Table Editor.
-- =====================================================================

-- 2) Centros de trabajo
create table if not exists centros_trabajo (
  id text primary key,
  nombre text not null,
  ubicacion text not null,
  responsable text not null,
  estado text not null default 'Activo' check (estado in ('Activo','Pendiente','Crítico','Auditando')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- 3) Relación: normas aplicables por centro (muchos a muchos)
create table if not exists centro_normas (
  centro_id text references centros_trabajo(id) on delete cascade,
  norma_code text references normas_catalogo(code) on delete cascade,
  primary key (centro_id, norma_code)
);

-- 4) Perfil de cada usuario (nombre y puesto que se muestra en el header)
create table if not exists perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  puesto text not null
);

-- =====================================================================
-- Seguridad: Row Level Security (RLS)
-- Solo usuarios que iniciaron sesión (los que ustedes creen en
-- Authentication > Users) pueden leer y escribir. Nadie más puede
-- entrar a los datos, ni siquiera con la URL/llave pública del proyecto.
-- =====================================================================
alter table normas_catalogo enable row level security;
alter table centros_trabajo enable row level security;
alter table centro_normas enable row level security;
alter table perfiles enable row level security;

create policy "leer normas_catalogo" on normas_catalogo
  for select using (auth.role() = 'authenticated');

create policy "leer centros_trabajo" on centros_trabajo
  for select using (auth.role() = 'authenticated');
create policy "escribir centros_trabajo" on centros_trabajo
  for insert with check (auth.role() = 'authenticated');
create policy "actualizar centros_trabajo" on centros_trabajo
  for update using (auth.role() = 'authenticated');
create policy "borrar centros_trabajo" on centros_trabajo
  for delete using (auth.role() = 'authenticated');

create policy "leer centro_normas" on centro_normas
  for select using (auth.role() = 'authenticated');
create policy "escribir centro_normas" on centro_normas
  for insert with check (auth.role() = 'authenticated');
create policy "borrar centro_normas" on centro_normas
  for delete using (auth.role() = 'authenticated');

create policy "leer mi perfil" on perfiles
  for select using (auth.role() = 'authenticated');

-- =====================================================================
-- OPCIONAL: descomenta este bloque solo si quieres partir de los 6
-- centros de ejemplo que usamos en la demo, para probar que todo
-- funciona antes de capturar tus 22 centros reales.
-- =====================================================================
-- insert into centros_trabajo (id, nombre, ubicacion, responsable, estado) values
--   ('CT-2024-001', 'Planta Bajío - Logística', 'Silao, Guanajuato', 'Ing. Ricardo Mendoza', 'Activo'),
--   ('CT-2024-002', 'Taller de Estampado Sur', 'Puebla, Pue.', 'Lic. Martha Elena Gómez', 'Pendiente'),
--   ('CT-2024-003', 'Almacén Mat. Peligrosos', 'Toluca, EdoMex', 'Ing. Alberto Ruíz', 'Activo'),
--   ('CT-2024-004', 'Planta Ensamble Norte', 'Apodaca, NL', 'Ing. Carla Villeda', 'Activo'),
--   ('CT-2024-005', 'Saltillo Stamping', 'Saltillo, Coahuila', 'Ing. Roberto Sánchez', 'Activo'),
--   ('CT-2024-006', 'Ensamblaje Bajío Norte', 'León, Guanajuato', 'Ing. Daniela Ponce', 'Crítico');
