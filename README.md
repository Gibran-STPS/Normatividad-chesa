# Normatividad Grupo Automotriz Chesa

Plataforma web para el seguimiento de cumplimiento de Normas Oficiales
Mexicanas (NOM-STPS) en los centros de trabajo de Grupo Automotriz Chesa.

## Contenido

- `panel-control.html` — la aplicación (frontend en HTML + Tailwind + JS, conectado a Supabase). Incluye, en la sección "Semana Laboral 40h" → pestaña "Tablero Detallado (Excel)", el tablero de cumplimiento de jornada laboral embebido.
- `tablero-jornada-laboral.html` — el tablero interactivo de Cumplimiento de Jornada Laboral (40h). Se abre solo o embebido dentro de `panel-control.html`. Arrastra ahí los `.xlsx` de reloj checador del mes; todo se procesa en el navegador, no sube nada a ningún servidor.
- `pipeline-jornada-laboral/` — el pipeline de Python (`run_all.sh` y scripts asociados) para generar mensualmente el Excel de auditoría consolidado y los PDFs de firma por unidad de negocio, a partir de los mismos archivos de reloj checador. Ver `pipeline-jornada-laboral/README.md` para el detalle completo.
- `supabase_setup.sql` — script inicial de base de datos (tablas y RLS).
- `supabase_ia_setup.sql` — tabla para el historial de resúmenes de riesgo generados por IA.
- `supabase_normatividad_mensual_setup.sql` — tablas para el calendario normativo por centro, plantillas de documentos, colaboradores y constancias de vacaciones.
- `supabase/functions/generar-resumen-riesgo/` — Edge Function que llama a Claude (Anthropic) para generar los resúmenes de riesgo.
- `vendor/` — librerías JS vendorizadas (SheetJS, jsPDF, JSZip) que usan tanto `panel-control.html` como el tablero de jornada laboral, para no depender de un CDN externo.
- `assets/logos/` — logos de Grupo Chesa y de cada marca (Nissan, Renault, Changan, Ecos Digitales), usados en Centros de Trabajo.
- `GUIA_SUPABASE.md` — cómo conectar la app a una base de datos real.
- `GUIA_IA.md` — cómo activar el módulo de resúmenes de riesgo con IA.
- `GUIA_NORMATIVIDAD_MENSUAL.md` — cómo activar y usar el calendario normativo, las constancias de vacaciones y el correo mensual.

## Demo pública

Publicada con GitHub Pages: https://Gibran-STPS.github.io/Normatividad-chesa/
