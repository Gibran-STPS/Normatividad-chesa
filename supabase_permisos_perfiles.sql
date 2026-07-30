-- =====================================================================
-- Permite que cada usuario cree/edite SU PROPIO registro en "perfiles"
-- (nombre, puesto, teléfono). Antes solo existía permiso de lectura,
-- por eso no se podía guardar nombre/puesto/celular desde el panel.
-- =====================================================================
drop policy if exists "crear mi perfil" on perfiles;
create policy "crear mi perfil" on perfiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "editar mi perfil" on perfiles;
create policy "editar mi perfil" on perfiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
