-- =====================================================================
-- Corrige el guardado del cuestionario NOM-035 público
-- ("new row violates row-level security policy for table nom035_respuestas")
--
-- Por qué pasaba: la política de INSERT en nom035_respuestas valida el
-- token consultando la tabla nom035_tokens ("exists (select 1 from
-- nom035_tokens ...)"). Esa tabla también tiene RLS activado, pero
-- nunca se le dio permiso de LECTURA al público (rol "anon") — solo a
-- "authenticated". Entonces, cuando un colaborador sin cuenta llenaba
-- el cuestionario, la base de datos no podía ni siquiera verificar si
-- su token era válido (para ella, la tabla se veía vacía), y por lo
-- tanto rechazaba el insert.
--
-- Esta política deja que el público solo pueda LEER los tokens activos
-- (nunca editarlos ni verlos si están desactivados), que es justo lo
-- que la validación necesita.
-- =====================================================================
drop policy if exists "nom035_tokens_anon_select" on nom035_tokens;
create policy "nom035_tokens_anon_select" on nom035_tokens
    for select to anon
    using (activo = true);
