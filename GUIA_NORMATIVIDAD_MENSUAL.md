# Guía: Módulo de Actividades Normativas Mensuales

Este módulo reemplaza tres cosas que hacías a mano: el checklist mensual por
centro (tus P/R en Excel), las constancias de vacaciones (Excel + Word con
combinación de correspondencia), y el armado del correo mensual con sus
adjuntos. Vive dentro del panel, en **Actividades Normativas**, con 4
pestañas: Calendario del Mes, Constancias de Vacaciones, Plantillas de
Documentos, y Correo Mensual.

Todo corre **en tu navegador** (igual que el tablero de jornada laboral):
lee tus Excel, genera los PDF y arma el ZIP sin depender de ningún servidor
adicional — solo sigue usando tu base de datos de Supabase para guardar la
información.

## Puesta en marcha (una sola vez)

### Paso 1 — Ejecutar el script SQL

1. Ve a Supabase > **SQL Editor > New query**.
2. Copia y pega **todo** el contenido de `supabase_normatividad_mensual_setup.sql`.
3. Clic en **Run**.

### Paso 2 — Crear el bucket de Storage para las plantillas

El script SQL no puede crear buckets de Storage (es una limitación de
Supabase), así que este paso sí es manual:

1. En el menú izquierdo de Supabase, ve a **Storage**.
2. Clic en **New bucket**.
3. Nombre exacto: `plantillas`
4. Público: **No** (déjalo privado).
5. Ya creado, entra al bucket > **Policies** > **New policy**, y crea 3
   políticas simples, una por operación (SELECT, INSERT, DELETE), cada una
   con la condición `auth.role() = 'authenticated'`. Si Supabase te ofrece
   una plantilla llamada algo como "Enable access for authenticated users
   only", úsala — hace exactamente esto.

### Paso 3 — Capturar el "Código de agencia" y el correo de cada centro

**Ya no es un requisito previo** — desde esta versión, si subes el Excel de
calendario y alguna hoja no coincide con ningún centro existente, el panel
**crea el centro automáticamente** usando el nombre de la hoja como nombre
provisional y como "Código de agencia". Te avisa cuáles creó para que
entres después a completar su ubicación, responsable y correo.

Aun así, conviene revisar esto por cada centro una vez creado:

1. Ve a **Centros de Trabajo** y edita cada centro.
2. Confirma o corrige **"Código de agencia"** — debe coincidir con el
   nombre exacto de su hoja en el Excel de calendario (por ejemplo
   `N. SCC`, `N.CMT`).
3. Llena **"Correo del responsable"** con el correo real al que se le
   envía el correo mensual de ese centro.

Como vas a preparar un solo Excel con las 22 agencias, en cuanto lo subas
por primera vez el panel te va a crear los 22 centros automáticamente
(si aún no existen) — de ahí solo entras a completar ubicación,
responsable y correo de cada uno.

## Uso mensual

### 1) Calendario del Mes

- La primera vez (y cada que renueves el calendario anual), sube tu Excel
  con el botón **"Importar calendario (.xlsx)"**. Debe tener una hoja por
  centro con la misma estructura que ya usas (Norma en una fila, Actividad
  en la columna C, y P/R en las 12 columnas de meses).
- Elige centro + mes + año para ver el checklist. Marca cada actividad como
  "Realizada" con un clic — reemplaza escribir la R a mano.
- Si ves un aviso de "hojas sin mapear", significa que el nombre de esa hoja
  no coincide con el "Código de agencia" de ningún centro — revísalo en
  Centros de Trabajo.

### 2) Constancias de Vacaciones

- Sube tu Cuadro General de Antigüedades (hoja `CONCENTRADO`) con el botón
  correspondiente. Puedes volver a subirlo cuando haya altas/bajas — no
  duplica a nadie (usa la CLAVE como identificador único).
- Elige centro + mes + año: el panel te muestra automáticamente quién
  cumple aniversario ese mes, cuántos días le tocan (según la tabla legal
  vigente) y las fechas exactas de su periodo.
- "Generar PDF" hace una constancia individual; "Generar todas (ZIP)" las
  hace todas de un jalón.
- Cada constancia generada queda registrada en la tabla
  `constancias_generadas`, como respaldo/trazabilidad.
- Si la ley cambia la tabla de días por antigüedad, edítala directamente en
  Supabase (tabla `tabla_vacaciones_dias`) — no está escrita en el código.

### 3) Plantillas de Documentos

- Sube aquí, una sola vez, cada formato Word/Excel que normalmente anexas
  por norma. Puedes subir más de uno por norma si aplica.
- De aquí en adelante, el correo mensual los toma automáticamente sin que
  tengas que volver a buscarlos en tu computadora.

### 4) Correo Mensual

- Elige centro + mes + año y da clic en **"Generar borrador"**.
- El panel arma: el asunto, el cuerpo con cada actividad del mes (y el
  nombre correcto del responsable actual del centro), la lista de formatos
  que se van a anexar, y si aplica, cuántas constancias de vacaciones se
  incluyen.
- Puedes editar el asunto o el cuerpo libremente antes de enviarlo.
- **"Descargar adjuntos (ZIP)"** te da un único archivo con todos los
  formatos + constancias listos para adjuntar.
- **"Abrir en Outlook"** abre un borrador nuevo en tu cliente de correo con
  el destinatario, asunto y cuerpo ya llenos. Por seguridad del navegador,
  **ningún sitio web puede adjuntar archivos automáticamente a un correo**
  — tendrás que arrastrar el ZIP descargado (o sus archivos) al borrador
  antes de enviar. Es un paso manual, pero ya no tienes que redactar nada
  ni ir a buscar los formatos uno por uno.
- "Copiar cuerpo" copia asunto + cuerpo al portapapeles, por si tu Outlook
  no abre bien el enlace `mailto:`.

## Notas y limitaciones a tener presentes

- El cálculo de vacaciones asume que el colaborador cumple años el mismo
  día del mes que ingresó, y que el periodo se cuenta en días naturales
  (no hábiles) a partir de esa fecha — igual que tu hoja `CONSTANCIAS V`
  actual.
- La tabla legal viene cargada hasta 40 años de antigüedad; si algún
  colaborador supera esa antigüedad, agrégalo tú mismo a la tabla
  `tabla_vacaciones_dias` en Supabase.
- El importador de antigüedades intenta emparejar el nombre de "SUCURSAL"
  de tu Excel con el nombre o código de agencia de cada centro. Si algún
  colaborador queda "sin centro asignado", el aviso te dice cuáles
  sucursales no reconoció — puedes ajustarlas manualmente después
  actualizando ese registro en Supabase (tabla `colaboradores`), o
  ajustando el nombre del centro/código de agencia para que coincida.
