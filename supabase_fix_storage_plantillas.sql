-- =====================================================================
-- Corrige el acceso al bucket de Storage "plantillas"
-- (resuelve el error "new row violates row-level security policy"
-- al subir plantillas de documentos)
--
-- Por qué pasaba: las políticas del bucket se crearon a mano desde el
-- dashboard de Supabase (Storage > plantillas > Policies), y es fácil
-- elegir por error una plantilla que solo permite subir dentro de una
-- carpeta con el propio ID de usuario. Como esta app guarda los
-- archivos en carpetas por norma (ej. "NOM-036/archivo.docx", no por
-- ID de usuario), esa política los rechazaba siempre.
--
-- Qué hace este script: crea (o repara) 3 políticas con nombre fijo,
-- aplicadas solo al bucket "plantillas", que permiten a cualquier
-- usuario autenticado leer/subir/borrar sin importar la carpeta.
-- Es seguro volver a ejecutarlo — no toca políticas de otros buckets.
-- =====================================================================

drop policy if exists "chesa_plantillas_select" on storage.objects;
create policy "chesa_plantillas_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'plantillas');

drop policy if exists "chesa_plantillas_insert" on storage.objects;
create policy "chesa_plantillas_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plantillas');

drop policy if exists "chesa_plantillas_delete" on storage.objects;
create policy "chesa_plantillas_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plantillas');

-- =====================================================================
-- Opcional pero recomendado: revisa si además existe una política
-- vieja y restrictiva sobre este mismo bucket (la que causó el error).
-- Corre esta consulta para verla:
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects';
--
-- Las políticas son permisivas por defecto (se combinan con "OR"), así
-- que con las 3 de arriba ya deberías poder subir sin problema aunque
-- la vieja siga ahí. Si quieres limpiarla del todo, identifica su
-- nombre en el resultado de arriba y bórrala con:
--   drop policy "nombre_de_la_politica_vieja" on storage.objects;
-- =====================================================================
