-- =====================================================================
-- Agrega el teléfono al perfil del usuario, para usarlo en la firma
-- del Correo Mensual (nombre y puesto ya existían en "perfiles").
-- =====================================================================
alter table perfiles add column if not exists telefono text;
