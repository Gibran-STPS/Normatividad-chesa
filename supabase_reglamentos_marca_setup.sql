-- =====================================================================
-- Folio del Reglamento Interior de Trabajo (RIT) por marca
-- Cada marca (Nissan, Renault, Changan, Ecos Digitales) tiene su propio
-- expediente de RIT. Se guarda una sola vez por marca -- no por centro --
-- para que nunca se mezcle el folio de una marca con el de otra.
--
-- El marcador {{RIT_EXPEDIENTE}} en tus plantillas Word/Excel se
-- rellena automáticamente según la marca del centro que genera el
-- documento (Configuración > Reglamento Interior de Trabajo por marca).
-- =====================================================================
create table if not exists reglamentos_marca (
  marca text primary key,          -- 'NISSAN' | 'RENAULT' | 'CHANGAN' | 'ECOS'
  rit_expediente text,
  updated_at timestamptz not null default now()
);

alter table reglamentos_marca enable row level security;

drop policy if exists "leer reglamentos_marca" on reglamentos_marca;
create policy "leer reglamentos_marca" on reglamentos_marca
  for select to authenticated using (true);

drop policy if exists "escribir reglamentos_marca" on reglamentos_marca;
create policy "escribir reglamentos_marca" on reglamentos_marca
  for insert to authenticated with check (true);

drop policy if exists "actualizar reglamentos_marca" on reglamentos_marca;
create policy "actualizar reglamentos_marca" on reglamentos_marca
  for update to authenticated using (true) with check (true);

-- Precarga las 4 marcas con folio vacío, para que aparezcan de una vez
-- en el panel (Configuración) listas para capturarse. Si ya existen,
-- no se sobreescriben.
insert into reglamentos_marca (marca, rit_expediente) values
  ('NISSAN', null),
  ('RENAULT', null),
  ('CHANGAN', null),
  ('ECOS', null)
on conflict (marca) do nothing;
