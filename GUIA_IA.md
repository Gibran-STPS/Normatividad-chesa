# Guía: activar el Resumen de Riesgo con IA

Esto agrega un botón 🧠 junto a cada centro de trabajo que genera, con Claude
(la IA de Anthropic), un resumen de riesgo en 2-4 oraciones y una etiqueta
de nivel (Bajo/Medio/Alto/Crítico), basado en los datos reales del centro.

Tiempo estimado: 20-25 minutos. Requiere una terminal (te doy cada comando
exacto para copiar y pegar).

## Requisito: una API key de Anthropic

1. Ve a **https://console.anthropic.com** y crea una cuenta (o inicia sesión).
2. En **API Keys**, crea una nueva llave y cópiala (empieza con `sk-ant-...`).
   Guárdala en un lugar seguro — es secreta, nunca va en el HTML.
3. Esto requiere créditos/facturación activa en la cuenta de Anthropic.

## Paso 1 — Instalar la CLI de Supabase

En tu terminal:

```bash
npm install -g supabase
```

(Si no tienes Node.js instalado, descárgalo primero de https://nodejs.org)

## Paso 2 — Iniciar sesión y vincular tu proyecto

```bash
supabase login
```

Se abrirá el navegador para autorizar. Luego, dentro de la carpeta de este
proyecto:

```bash
cd ruta/a/tu/proyecto
supabase link --project-ref ptukbtqxqscgozwduima
```

(El "project-ref" es el código que aparece en tu Project URL de Supabase,
la parte antes de `.supabase.co` — en tu caso ya está arriba, pero
verifícalo en **Project Settings > General**.)

## Paso 3 — Crear la tabla del historial de resúmenes

1. En el dashboard de Supabase, ve a **SQL Editor > New query**.
2. Copia y pega **todo** el contenido de `supabase_ia_setup.sql`.
3. Clic en **Run**. Deberías ver "Success" — ya existe la tabla `resumenes_riesgo`.

## Paso 4 — Configurar el secreto de la API key

Este comando guarda tu llave de Anthropic de forma segura en Supabase
(nunca en tu código):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-tu-llave-aqui
```

## Paso 5 — Desplegar la Edge Function

```bash
supabase functions deploy generar-resumen-riesgo
```

Si todo sale bien verás un mensaje de éxito con la URL de la función.

## Paso 6 — Probar

1. Abre `panel-control.html` en tu navegador (con tu URL y llave de Supabase
   ya configuradas, como en la guía anterior).
2. Ve a **Centros de Trabajo**.
3. Da clic en el ícono 🧠 (junto al lápiz) de cualquier centro.
4. En unos segundos debe aparecer el resumen generado por IA.

## ¿Cómo funciona por dentro?

- El navegador NUNCA llama directamente a la API de Claude ni ve tu llave.
- Llama a tu Edge Function (que corre en los servidores de Supabase),
  pasando solo el `centro_id`.
- La Edge Function verifica que quien llama esté autenticado, junta los
  datos del centro (estado, normas asignadas, historial de riesgo previo),
  arma una pregunta para Claude, y guarda + regresa la respuesta.
- Cada resumen generado queda en la tabla `resumenes_riesgo`, así que
  con el tiempo tendrás un historial de cómo ha evolucionado el riesgo
  de cada centro — útil para tu presentación en la competencia.

## Si algo no funciona

- `supabase functions deploy` falla → revisa que hiciste `supabase link` primero.
- El botón 🧠 se queda cargando para siempre → abre la consola del navegador
  (F12 > Console) y revisa el error; probablemente falta el secreto
  `ANTHROPIC_API_KEY` o la tabla del Paso 3.
- Error 401 "No autenticado" → tu sesión de login expiró, vuelve a iniciar
  sesión en el panel.
- Para ver los logs de la función en vivo mientras pruebas:
  ```bash
  supabase functions logs generar-resumen-riesgo
  ```

## Extensiones posibles (para impresionar más en la competencia)

- Un botón "Generar resumen para los 22 centros" que llame la función en
  lote y arme un reporte ejecutivo.
- Mostrar en el Dashboard principal los 3 centros con nivel de riesgo más
  alto según el último resumen de IA.
- Programar la generación automática cada semana con un cron job de
  Supabase (`pg_cron`), sin que nadie tenga que dar clic.
