-- =====================================================================
-- NOM-035-STPS-2018 · Factores de riesgo psicosocial
-- Tablas, seguridad (RLS) y función pública para el cuestionario por QR
-- Ejecutar en el SQL Editor de Supabase (proyecto ptukbtqxqscgozwduima)
-- Re-ejecutable de forma segura (usa "if not exists").
-- =====================================================================

-- 1) Tokens de acceso público por centro de trabajo (uno activo por centro).
--    El token es lo único que viaja en la URL / QR que ven los colaboradores.
create table if not exists nom035_tokens (
    id uuid primary key default gen_random_uuid(),
    centro_id uuid not null references centros_trabajo(id) on delete cascade,
    token text not null unique,
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_nom035_tokens_centro on nom035_tokens(centro_id);

-- 2) Respuestas de los colaboradores (anónimas: no se guarda nombre).
create table if not exists nom035_respuestas (
    id uuid primary key default gen_random_uuid(),
    centro_id uuid not null references centros_trabajo(id) on delete cascade,
    token text not null,
    guia text not null check (guia in ('I','II','III')),
    respuestas jsonb not null,           -- { "1": 4, "2": 3, ... } valores 0-4 ya normalizados
    datos_trabajador jsonb,              -- sexo, edad (rango), puesto tipo, etc. (Guía V, sin nombre)
    calificacion_final numeric,
    nivel_riesgo text,                   -- Nulo | Bajo | Medio | Alto | Muy alto
    detalle_dominios jsonb,              -- [{ "dominio": "...", "calificacion": n, "nivel": "..." }, ...]
    requiere_atencion_clinica boolean default false, -- resultado de la Guía I (acontecimiento traumático)
    created_at timestamptz not null default now()
);

create index if not exists idx_nom035_respuestas_centro on nom035_respuestas(centro_id);
create index if not exists idx_nom035_respuestas_fecha on nom035_respuestas(created_at);

-- 3) Plan de acción / seguimiento (uso interno del equipo de cumplimiento).
create table if not exists nom035_planes_accion (
    id uuid primary key default gen_random_uuid(),
    centro_id uuid not null references centros_trabajo(id) on delete cascade,
    nivel_riesgo text not null,
    descripcion text not null,
    responsable text,
    fecha_limite date,
    estatus text not null default 'Pendiente' check (estatus in ('Pendiente','En proceso','Completado')),
    created_at timestamptz not null default now()
);

create index if not exists idx_nom035_planes_centro on nom035_planes_accion(centro_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table nom035_tokens enable row level security;
alter table nom035_respuestas enable row level security;
alter table nom035_planes_accion enable row level security;

-- El equipo interno (usuarios autenticados de la app) puede leer y administrar todo.
drop policy if exists nom035_tokens_auth_all on nom035_tokens;
create policy nom035_tokens_auth_all on nom035_tokens
    for all to authenticated using (true) with check (true);

drop policy if exists nom035_respuestas_auth_select on nom035_respuestas;
create policy nom035_respuestas_auth_select on nom035_respuestas
    for select to authenticated using (true);

drop policy if exists nom035_respuestas_auth_delete on nom035_respuestas;
create policy nom035_respuestas_auth_delete on nom035_respuestas
    for delete to authenticated using (true);

drop policy if exists nom035_planes_auth_all on nom035_planes_accion;
create policy nom035_planes_auth_all on nom035_planes_accion
    for all to authenticated using (true) with check (true);

-- El público (colaboradores sin cuenta, "anon") SOLO puede insertar respuestas,
-- y únicamente si el token que envían corresponde a un token activo.
-- No puede leer, editar ni borrar nada.
drop policy if exists nom035_respuestas_anon_insert on nom035_respuestas;
create policy nom035_respuestas_anon_insert on nom035_respuestas
    for insert to anon
    with check (
        exists (
            select 1 from nom035_tokens t
            where t.token = nom035_respuestas.token
              and t.centro_id = nom035_respuestas.centro_id
              and t.activo = true
        )
    );

-- =====================================================================
-- Función pública (RPC) para que la página del cuestionario obtenga los
-- datos mínimos del centro (nombre y número de trabajadores) a partir
-- únicamente del token del QR, sin exponer el resto de centros_trabajo.
-- SECURITY DEFINER: corre con permisos del dueño, ignorando RLS de
-- centros_trabajo, pero solo devuelve las 3 columnas indicadas.
-- =====================================================================
create or replace function obtener_centro_por_token(p_token text)
returns table (centro_id uuid, nombre text, numero_trabajadores int)
language sql
security definer
set search_path = public
as $$
    select c.id, c.nombre, c.numero_trabajadores
    from nom035_tokens t
    join centros_trabajo c on c.id = t.centro_id
    where t.token = p_token and t.activo = true;
$$;

grant execute on function obtener_centro_por_token(text) to anon, authenticated;

-- =====================================================================
-- Notas:
-- * Un centro puede tener varios tokens históricos; solo el más reciente
--   con activo = true es válido. Al "regenerar" un QR, desactiva el
--   anterior en vez de borrarlo, para conservar el historial de respuestas.
-- * numero_trabajadores en centros_trabajo determina qué cuestionario
--   corresponde (Guía II para 16-50, Guía III para >50, según NOM-035
--   numerales 7.1 y 8.1). Los centros con 15 o menos solo están
--   obligados a la Guía I (acontecimientos traumáticos).
-- =====================================================================
