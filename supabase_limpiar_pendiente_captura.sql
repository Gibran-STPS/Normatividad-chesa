-- =====================================================================
-- Limpia los centros que quedaron con el texto literal "Pendiente de
-- captura" guardado en Ubicación/Responsable (se creaban así cada vez
-- que el importador de calendario no encontraba coincidencia y creaba
-- un centro nuevo). Los deja vacíos para que el campo se vea con el
-- texto de ejemplo en gris, en vez de tener que borrarlo a mano.
-- Seguro de volver a ejecutar.
-- =====================================================================
update centros_trabajo set ubicacion = '' where ubicacion = 'Pendiente de captura';
update centros_trabajo set responsable = '' where responsable = 'Pendiente de captura';
