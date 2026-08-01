-- =====================================================================
-- Agrega "ciudad" (nombre corto de la ciudad, ej. "San Cristóbal de
-- Las Casas") como campo separado de "ubicacion" (que puede traer la
-- dirección completa) y de "direccion". Se usa en el pie de página de
-- las plantillas ({{CIUDAD_CORTA}}), para no repetir ahí la dirección
-- completa.
-- =====================================================================
alter table centros_trabajo add column if not exists ciudad text;
