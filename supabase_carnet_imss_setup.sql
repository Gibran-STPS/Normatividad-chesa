-- =====================================================================
-- Seguimiento del carnet IMSS por colaborador (nuevo ingreso).
-- Se usa en "Constancias de Vacaciones" para marcar quién ya entregó
-- su evidencia de alta ante el IMSS, y para que el correo mensual solo
-- liste a quienes siguen pendientes.
-- =====================================================================
alter table colaboradores add column if not exists carnet_imss_estatus text not null default 'Pendiente'
  check (carnet_imss_estatus in ('Pendiente','Enviado'));
