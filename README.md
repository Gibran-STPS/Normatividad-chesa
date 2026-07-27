# Normatividad Grupo Automotriz Chesa

Plataforma web para el seguimiento de cumplimiento de Normas Oficiales
Mexicanas (NOM-STPS) en los centros de trabajo de Grupo Automotriz Chesa.

## Contenido

- `panel-control.html` — la aplicación (frontend en HTML + Tailwind + JS, conectado a Supabase).
- `supabase_setup.sql` — script inicial de base de datos (tablas y RLS).
- `supabase_ia_setup.sql` — tabla para el historial de resúmenes de riesgo generados por IA.
- `supabase/functions/generar-resumen-riesgo/` — Edge Function que llama a Claude (Anthropic) para generar los resúmenes de riesgo.
- `GUIA_SUPABASE.md` — cómo conectar la app a una base de datos real.
- `GUIA_IA.md` — cómo activar el módulo de resúmenes de riesgo con IA.

## Demo pública

Publicada con GitHub Pages: https://Gibran-STPS.github.io/Normatividad-chesa/
