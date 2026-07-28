# Pipeline mensual de Cumplimiento de Jornada Laboral

Este paquete regenera el tablero, el Excel de auditoría y los 8+ PDFs de firma
cada mes, a partir de los archivos `REPORTE_DE_RELOJ_CHECADOR_*.xlsx` de reloj
checador de cada unidad de negocio.

## Reportes de firma (PDF de una hoja)

Cada reporte por unidad es de **una sola hoja**, con lo indispensable para
firmarlo: KPIs clave, medidor de cumplimiento, hasta 10 hallazgos representativos
(los casos más severos de exceso diario, exceso semanal, faltas y retardos) y
tres firmas:

| Firma | Rol |
|---|---|
| **Elabora** | Responsable de Auditoria STPS |
| **Recibe** | Gerente General |
| **Visto bueno** | Dirección de Talento Humano |

El detalle completo (todas las incidencias, no solo la muestra del PDF) sigue
disponible en el tablero interactivo y en `Base_Consolidada_Auditoria.xlsx`.

**Opcional:** en la sección "02 — Panorama y Documentos" del tablero puedes capturar el
nombre de cada firmante antes de generar los PDFs; si lo haces, el PDF imprime
el nombre y la fecha de hoy en la línea de firma (si lo dejas en blanco, el
PDF se comporta igual que antes). Cada generación queda registrada en una
bitácora de la sesión, exportable a CSV — ver la sección "Novedades de esta
versión" más abajo.

Puedes generarlos de dos formas, y ambas producen el mismo diseño:

1. **Desde el tablero** (sección "02 — Panorama y Documentos"): un botón "Descargar PDF"
   por unidad, o "Descargar todos los PDF" para bajarlos todos de un jalón.
   Se generan con jsPDF directamente en tu navegador — no requieren Python ni
   conexión a internet.
2. **Desde el pipeline de Python** (`run_all.sh`, ver abajo): se guardan en la
   carpeta `reportes_pdf/`.

## El tablero siempre abre vacío — así se actualizan los datos cada mes

Desde esta versión, `Tablero_Cumplimiento_Jornada_Laboral.html` **se genera
sin ninguna unidad precargada**. Ábrelo, arrastra los `.xlsx` del mes en curso
y listo — nunca vas a encontrarte datos de meses anteriores que tengas que
quitar antes de empezar. Es el mismo archivo, mes con mes: no hace falta pedir
uno nuevo ni volver a correr nada solo para "limpiarlo".

**A) Directamente en el navegador (recomendado para el día a día)**
Abre `Tablero_Cumplimiento_Jornada_Laboral.html` y usa la sección "01 — Datos"
hasta arriba: arrastra ahí los `.xlsx` del mes (o haz clic para seleccionarlos).
Todo se procesa **en tu propio navegador** — no sube nada a ningún servidor, no
requiere Python ni conexión a internet salvo para las tipografías.

- Si subes el archivo de una unidad que ya estaba cargada **en esta sesión**,
  la reemplaza automáticamente (no la duplica ni hace falta quitarla primero).
- Si quieres vaciar el tablero por completo antes de empezar un mes nuevo
  (por ejemplo, si vas a cargar menos unidades que la vez pasada), usa el botón
  **"Quitar todos"** junto al listado de unidades cargadas.
- Cierra o recarga la pestaña y el tablero vuelve a su estado vacío original
  — la sesión no se guarda sola a propósito, para que nunca abras el archivo
  y te encuentres datos de un mes que ya no aplica. Si quieres conservar un
  resultado, usa los botones de exportar (Excel, JSON, PDF, impresión) antes
  de cerrar.

Desde ahí mismo puedes exportar en cualquier momento:
- **Exportar Excel de auditoría**: genera al instante el mismo Excel
  consolidado que produce el pipeline de Python, con los datos que tengas
  cargados en ese momento en el navegador.
- **Exportar dataset (.json)**: guarda el estado actual para volver a
  cargarlo después o para alimentar el pipeline de Python si lo prefieres.
- **Descargar PDF de firma** (sección "02 — Panorama y Documentos"): uno por unidad o
  todos de un jalón.
- **Imprimir / Guardar como PDF**: usa el diálogo de impresión del navegador
  sobre la vista completa del tablero (respeta los filtros aplicados).

**B) Pipeline de Python (para el respaldo formal y la carpeta de PDFs completa)**

```bash
./run_all.sh /ruta/a/la/carpeta/con/los/excels/del/mes  2026
```

- El primer argumento es la carpeta donde pusiste **todos** los archivos
  `.xlsx` de reloj checador del mes (los 20+ de todas las unidades, con el
  mismo formato que los que ya conoces: `REPORTE_DE_RELOJ_CHECADOR_<MARCA>_
  <SUCURSAL>_<MES>_<ANIO>.xlsx`).
- El segundo argumento es el año de referencia normativa (usa **2026** hasta
  diciembre de 2026; cámbialo a **2027** a partir de enero de 2027, y así
  sucesivamente según la tabla del decreto).
- El script crea una carpeta `salida_<fecha>` con:
  - `Tablero_Cumplimiento_Jornada_Laboral.html` — el tablero reutilizable,
    generado **vacío a propósito** (ver arriba); los datos de esta corrida
    quedan respaldados en el Excel y los PDF, no horneados en el HTML.
  - `Base_Consolidada_Auditoria.xlsx` — todas las bases de datos consolidadas
    de esta corrida.
  - `reportes_pdf/` — un PDF de una hoja por unidad de negocio, listo para
    imprimir y pasar a firma.

Si alguna vez sí quieres una **foto de solo lectura** del tablero con los
datos de un mes ya cargados (por ejemplo para archivar una versión exacta de
abril 2026), puedes generarla aparte:

```bash
python3 build_dashboard.py --template dashboard_template.html --dataset salida_.../dataset.json \
  --chartjs vendor/chart.umd.js --xlsxjs vendor/xlsx.mini.min.js --jspdf vendor/jspdf.umd.min.js \
  --autotable vendor/jspdf.plugin.autotable.min.js --logos-dir logos --out Tablero_MAYO_2026_snapshot.html
```

Ese archivo aparte sí trae los datos horneados — trátalo como una copia de
archivo histórico, no como la herramienta que abres cada mes para trabajar.

## Por qué las gráficas no se veían antes (y cómo se corrigió)

La primera versión del tablero cargaba el motor de gráficas (Chart.js) desde
una CDN externa (cdnjs.cloudflare.com). Si la red donde se abre el archivo
bloquea dominios externos no listados en su lista blanca —muy común en redes
corporativas de agencias automotrices—, ese script nunca llegaba a cargar y
las gráficas quedaban en blanco sin ningún aviso visible. Desde esa corrección,
Chart.js, SheetJS y jsPDF están **empaquetados dentro del mismo archivo HTML**:
no dependen de ninguna descarga externa para funcionar (solo las tipografías de
Google Fonts son opcionales; si tampoco cargan, el tablero usa una tipografía
de reemplazo y sigue funcionando igual). Si aun así una gráfica no aparece,
revisa la consola del navegador (F12) — el tablero también muestra un aviso
visible en pantalla si Chart.js no pudo inicializarse.

## Si el archivo de alguna unidad tiene un formato distinto

Tanto el ETL de Python (`etl.py`) como el que corre en el navegador (dentro
de `app.js`) detectan las columnas por su **nombre** de encabezado (no por
posición), así que toleran que algunas unidades no tengan las columnas
"HORARIO" / "HORARIO COMIDA", o que el orden cambie un poco. Si al cargar un
archivo el tablero muestra un aviso de error, revisa el mensaje: indica el
archivo y la causa exacta.

## Actualizar el calendario del decreto

Todo el marco normativo vive en **`config_normativo.json`**, no está
"quemado" en el código. Si la autoridad publica un ajuste al calendario
progresivo (Art. 59) o al tope de horas extra (Art. 66), edita ese archivo:

```json
"jornada_ordinaria_maxima_semanal_por_anio": {
  "2026": 48, "2027": 46, "2028": 44, "2029": 42, "2030": 40
}
```

Vuelve a correr `run_all.sh` y el dashboard, el Excel y los PDFs recalculan
solos con el nuevo esquema. No hay que tocar ninguna fórmula ni gráfica.
(El tablero HTML ya trae esta misma tabla incrustada, así que si generas el
dashboard con `build_dashboard.py` después de editar el JSON, también se
actualiza ahí.)

## Qué significa cada indicador (para explicarlo a RRHH/Legal)

| Indicador | Definición | Base legal |
|---|---|---|
| % Cumplimiento semanal | % de semanas-colaborador con horas trabajadas ≤ límite vigente del año | Art. 59 LFT + Transitorio Segundo |
| Jornada >12h/día | Día en que (entrada→salida, descontando comida) superó 12 horas | Art. 68 LFT, último párrafo (tope absoluto, no excede aunque se pague extra) |
| Exceso de horas extra semanal | Semana en que el exceso sobre el límite ordinario superó el tope de horas extra del año | Art. 66 LFT + Transitorio Cuarto |
| Checada incompleta | Día con al menos una marca esperada ausente (entrada, salida o comida entre semana; en sábado, entrada o salida, y comida solo si se trabajó fuera del horario oficial), sin llegar a ser una falta total | Relevante para el registro electrónico obligatorio desde 2027 (Art. 132 fracc. XXXIV) |
| Falta | Día sin ninguna checada (ni entrada ni salida) — se toma la unión de lo reportado en la hoja "Días sin checadas" del archivo fuente y lo detectado directamente en las checadas diarias de cada unidad | — |
| Retardo | Entrada tardía respecto al horario teórico, clasificada en 6–12 / 13–24 / +25 minutos (tal como ya la calcula el sistema de checador de cada unidad; en sábado se recalcula contra el horario oficial de 09:00, no contra el que trae el archivo) | Política interna de puntualidad |
| Sábado fuera de horario | Sábado en que la salida ocurrió más de 15 minutos después de las 14:00 (horario oficial de sábado a nivel grupo: 09:00–14:00, sin comida) | Horario interno de sábado, no la LFT |

## Piezas del paquete

- `etl.py` — lee los Excel crudos y arma el dataset consolidado.
- `build_kpis.py` — calcula los KPIs por unidad/área, las listas de incidencias y el simulador de transición normativa.
- `build_excel_auditoria.py` — arma el Excel de respaldo documental (incluye la bitácora de firmas y el simulador).
- `build_pdf_reports.py` — arma los PDFs de firma de una hoja por unidad (acepta nombres de firmantes opcionales).
- `build_dashboard.py` + `dashboard_template.html` + `app.js` — arman el
  tablero HTML interactivo (incluye su propio generador de PDF con jsPDF).
- `config_normativo.json` — parámetros del decreto (editable).
- `logos/` — logos de Chesa, Nissan, Renault y Changan usados en el tablero,
  el Excel y los PDFs.
- `vendor/` — librerías empaquetadas localmente (Chart.js, SheetJS, jsPDF,
  jsPDF-AutoTable) para que el tablero no dependa de ninguna CDN externa.
- `run_all.sh` — corre todas las piezas anteriores en orden con un solo comando.

## Novedades de esta versión

**Corrección: el KPI "Colaboradores" por unidad no contaba a quienes solo aparecen en "Días sin checadas"**
Cuando un colaborador no tiene ninguna checada en todo el mes, algunos archivos fuente lo
reportan únicamente en la hoja "Días sin checadas" y nunca en la hoja de checadas diarias de su
unidad. El conteo de faltas (`faltas_total`) ya incorporaba correctamente a esas personas gracias
a `reconcile_faltas()` / `reconcileFaltas()`, pero el conteo de colaboradores por unidad
(`total_colaboradores`, la tarjeta "Colaboradores" del tablero y del PDF) se armaba solo a partir
de las checadas diarias, así que esas personas quedaban invisibles ahí — produciendo números
inconsistentes entre sí (p. ej. "1 colaborador" pero "78 faltas" en un mes de 26 días, cuando en
realidad eran 3 colaboradores × 26 días). Ahora tanto `build_kpis.py` como `app.js` unen las
checadas diarias con `faltas_resumen` (ya reconciliado) antes de contar colaboradores, tanto a
nivel unidad como a nivel área/departamento cuando la hoja trae ese dato. Verificado con un
archivo real de Changan Renault Ocosingo (junio 2026): antes reportaba 1 colaborador con 78
faltas; ahora reporta 3 colaboradores con 78 faltas, coincidiendo Python y JavaScript.

**Corrección: colaboradores con muchos días sin checada no se marcaban como falta**
Algunos colaboradores tienen decenas de días sin ninguna checada (ni entrada ni salida) que la
hoja "Días sin checadas" del archivo fuente no reporta correctamente — a veces el colaborador
completo no aparece ahí, aunque sí tenga faltas reales. Antes, esos días quedaban invisibles en
todo el tablero (no se contaban como falta, tampoco como checada incompleta). Ahora `etl.py` y
`app.js` detectan la falta directamente de las checadas diarias (día sin entrada **y** sin
salida) y la combinan con lo que reporte la hoja "Días sin checadas" — la unión de ambas
fuentes, no solo la hoja de resumen. Si un colaborador ya tenía faltas reportadas correctamente
ahí, no cambia nada; si le faltaban (como en el caso detectado), ahora sí se cuentan.

**Corrección: "checadas incompletas" no contaba omisiones de comida (solo entrada/salida)**
El indicador de "checada incompleta" solo se fijaba en si faltaba la entrada o la salida; si un
colaborador sí checó entrada y salida pero nunca su comida, ese día no se marcaba como
incompleto. Ahora, entre semana, cualquiera de las 4 marcas ausente (entrada, salida, comida)
cuenta como checada incompleta. En sábado no se exige comida en un día normal (no hay comida
programada ese día — ver la corrección de horario de sábado más abajo), pero si ese sábado se
trabajó fuera del horario oficial (después de las 14:00), sí se espera que haya comida checada;
si no la hay, también cuenta como incompleta. Esto evita tanto el falso negativo (comida nunca
checada entre semana, invisible antes) como el falso positivo (marcar como incompleto un sábado
normal de 5 horas sin comida, que es lo esperado).

**Corrección: registros sin colaborador real identificado (p. ej. "NN-1") se contaban como colaborador**
Algunos archivos traen registros con un nombre placeholder (por ejemplo "NN-1", "NN 2",
"SIN NOMBRE", "S/N", "N/A") en vez de un colaborador real con nombre y código — normalmente
checadas sin identificar. Antes se contaban como un colaborador más, apareciendo en el
selector de "04 — Colaboradores" y en los KPIs. Ahora `etl.py` y `app.js` ignoran esos
registros en las tres fuentes donde pueden aparecer (checadas diarias, "Resumen Retardos" y
"Días sin checadas"), en ambos motores. Si tu reloj checador usa otro texto placeholder que no
sea alguno de los anteriores, avísame para agregarlo al filtro (vive en la función
`es_nombre_placeholder` / `esNombrePlaceholder`, un solo lugar en cada motor).

**Corrección: el PDF de firma no incluía el KPI de marcaje completo**
El KPI "Colaboradores con marcaje completo" (ver más abajo) ya se mostraba en el
tablero interactivo, pero faltaba en el **PDF de una hoja para firma** — tanto en
el que genera el pipeline de Python (`build_pdf_reports.py`) como en el que se
descarga directo desde el navegador (sección "02 — Panorama y Documentos"). Ahora aparece en
ambos, como un séptimo recuadro de KPI junto a los demás.

**Corrección: filas de encabezado duplicadas se contaban como colaboradores fantasma**
Algunos archivos de reloj checador traen el encabezado (`ID, NOMBRE, FECHA, DIA...`)
repetido en dos filas consecutivas de la misma hoja. Sin filtrarla, esa segunda fila
de encabezado se procesaba como si fuera un colaborador real llamado "NOMBRE",
inflando el total de colaboradores en 1 y, en el pipeline de Python, también los
conteos de retardo (por una diferencia entre Python y JavaScript en cómo se evalúa
como "verdadero" un texto). Ahora ambos motores (`etl.py` y `app.js`) ignoran
explícitamente cualquier fila cuyo ID/Nombre sea literalmente "ID"/"NOMBRE" —
tanto en las hojas de checadas diarias como en "Resumen Retardos" y "Días sin
checadas". Verificado con datos reales: el conteo de colaboradores, retardos y el
nuevo KPI de marcaje completo ahora coinciden exactamente entre Python y el
navegador.

**Corrección: la sección "04 — Colaboradores" no mostraba nada sin elegir agencia primero**
Antes, esta sección exigía seleccionar una unidad en "02 — Panorama" antes de mostrar
cualquier colaborador — si no elegías una, se quedaba bloqueada con el mensaje
"Selecciona una agencia...". Ahora **funciona sin necesidad de elegir agencia primero**:
por defecto lista los colaboradores de todas las unidades cargadas (con una columna
"Unidad" que aparece automáticamente si hay más de una), y seguir usando el filtro de
unidad/área de "02 — Panorama" es opcional, solo para acotar. También se corrigió un
riesgo de fondo: si dos unidades distintas llegaran a compartir el mismo ID de
colaborador, antes podían mezclarse al seleccionar uno; ahora cada colaborador se
identifica de forma única por unidad + ID, tanto en la tabla como en el detalle día por
día y en la exportación a Excel.

**Nuevo KPI: colaboradores con marcaje completo (entrada + salida + comida)**
Antes solo se distinguía "checada completa" como tener entrada y salida (sin
importar la comida). Ahora el panel de KPIs globales y cada tarjeta de unidad
muestran, aparte, **cuántos colaboradores tienen las 4 marcaciones completas
en TODOS sus días del mes** (entrada, salida a comer, regreso de comer y
salida; en sábado solo se exige entrada y salida, ya que no hay horario de
comida oficial ese día — ver la corrección de sábado más abajo). Un
colaborador solo cuenta como "marcaje completo" si ningún día del mes le
faltó alguna marcación; con datos de reloj checador reales es normal que este
número sea bajo (la omisión de la checada de comida es, en la práctica, el
descuido más común) — es exactamente la señal que este indicador busca
mostrar para poder reforzar la disciplina de checado antes de que el registro
electrónico de jornada sea obligatorio en 2027. El detalle por colaborador
(qué día exactamente le faltó qué marcación) sigue disponible en la sección
"04 — Colaboradores".

**08 — Progreso Mensual (nueva sección)**
Nueva sección para comparar el mes contra los anteriores: gráfica de %
cumplimiento semanal por periodo, tarjetas de variación (▲/▼) contra el mes
previo guardado, y una tabla de periodos guardados. Funciona así:
- **"💾 Guardar snapshot de este mes"** guarda un resumen (KPIs globales y por
  unidad) del mes que tengas cargado en ese momento. El periodo (mes/año) se
  detecta solo a partir de las fechas reales de los archivos, igual que en el
  resto del tablero.
- Cada periodo guardado tiene su propio botón **"Eliminar"** en la tabla, por
  si necesitas corregir o quitar un mes — es completamente editable, no hace
  falta borrar todo el historial para corregir uno solo.
- **"🗑 Borrar historial completo"** limpia todos los periodos guardados de un
  jalón (pide confirmación).
- **"⬇ Exportar historial (CSV)"** respalda el historial completo fuera del
  navegador.

**Importante — dónde vive este historial:** a diferencia del resto del
tablero (que se abre vacío a propósito y no guarda nada entre sesiones), el
historial mensual **sí se guarda de forma persistente, en el `localStorage`
de tu navegador** — es lo único que rompe esa regla, y a propósito, porque es
justo el dato que necesitas conservar mes con mes para ver el progreso. Con
esto en mente:
- Vive en **este navegador, en esta computadora**. Si abres el tablero en otro
  equipo o navegador, no verás el historial ahí — expórtalo a CSV cada mes
  como respaldo si necesitas consultarlo desde otro lado.
- No depende de qué unidades cargues cada mes en la sección 01; es un resumen
  aparte que tú decides cuándo guardar.
- Si borras el caché/datos de navegación de tu navegador, este historial se
  borra junto con lo demás — exporta a CSV si te importa conservarlo a largo
  plazo.

**Corrección: los sábados se contaban con el horario de entre semana**
El reloj checador de todas las unidades trae, en los renglones de sábado, el mismo
`HORARIO` y `HORARIO COMIDA` de los días entre semana (y ese valor incluso varía
por empleado/área — `08:00-16:00`, `15:30-19:30`, `09:00-19:00`...), cuando el
horario real de sábado a nivel grupo es único: **09:00–14:00, sin comida**. Esto
hacía que el tablero mostrara un horario teórico equivocado y, lo más importante,
que los retardos de sábado (columnas `R 6-12`/`R 13-24`/`R +25`, precalculadas por
el propio reloj checador) se compararan contra ese horario incorrecto en vez de
contra las 09:00 reales.

Ahora, tanto el pipeline de Python (`etl.py`) como el ETL del navegador (`app.js`)
detectan el sábado por la columna `DIA` (tolerante a acentos/mayúsculas) o, si esa
columna no ayuda, por la fecha del registro, y para esos renglones:
- Muestran siempre `09:00 - 14:00` como horario teórico (ignoran el que trae el
  archivo para sábado).
- No restan tiempo de comida (el sábado no tiene horario de comida oficial),
  aunque el archivo trajera una checada de comida por error.
- Recalculan el retardo comparando la entrada real contra las 09:00 (misma escala
  de tolerancia 6-12/13-24/+25 min que ya usa el checador), en vez de usar las
  columnas de retardo del archivo para esos días.
- Marcan un nuevo hallazgo, **"Sábado fuera de horario"**: cuando la salida
  ocurre más de 15 minutos después de las 14:00 (por ejemplo, alguien que checó
  salida hasta las 19:00 o 22:00 un sábado), señal de que ese colaborador trabajó
  más allá del horario oficial de sábado y conviene revisarlo aparte antes de
  incluirlo en el análisis general de exceso de jornada.

Este nuevo hallazgo tiene su propia tabla filtrable (buscar por nombre o ID,
exportar a CSV) en la sección "05 — Evidencia y seguimiento" del tablero, su
propia hoja "Sabados Fuera de Horario" en el Excel de auditoría, y sus contadores
(`sabados_registrados`, `sabados_fuera_horario`) por unidad de negocio.

El horario oficial de sábado vive en **`config_normativo.json`**, bloque
`jornada_sabado` (editable, igual que el resto del marco normativo): puedes
apagar la corrección (`"activo": false`) o ajustar la hora de entrada/salida,
si el horario de sábado cambia, sin tocar el código.

**Corrección: la sección "04 — Colaboradores" no cuadraba para algunos empleados**
La causa más probable: Excel a veces guarda la columna de ID como número
(170024) y a veces como texto con decimales (170024.0) según cómo esté
formateada la celda — si una hoja del mismo archivo (por ejemplo "RESUMEN
RETARDOS" o "DIAS SIN CHECADAS") usaba un formato distinto al de la hoja de
checadas diarias, el mismo colaborador terminaba con dos IDs ligeramente
distintos y su información no se podía cruzar correctamente: aparecía
duplicado, con datos incompletos, o el detalle día por día se veía vacío al
seleccionarlo. Ahora todos los IDs se homologan a una sola forma de texto
(170024.0 y 170024 se tratan como el mismo colaborador) en el momento de leer
cada archivo, tanto en el pipeline de Python como al cargar archivos
directamente en el navegador. Además, la sección ahora es a prueba de
registros con datos faltantes (un ID vacío o similar ya no puede romper el
resto del tablero) y, si algo sí llegara a fallar, muestra un mensaje en
pantalla en vez de quedarse en blanco silenciosamente.

**Corrección: el logo de marca a veces no aparecía ("Marca: reporte")**
La causa raíz era el detector de marca a partir del nombre del archivo: solo
reconocía el prefijo exacto `REPORTE_DE_RELOJ_CHECADOR_`; si el nombre traía
alguna variación (plural, orden distinto, espacios en vez de guiones bajos,
una palabra de más), la palabra "REPORTE" se quedaba pegada al nombre y se
tomaba por error como si fuera la marca — por eso no aparecía ningún logo
y el texto decía "Marca: reporte". Ahora el detector:
1. Quita palabras de relleno ("reporte", "reportes", "de", "reloj",
   "checador"...) una por una, sin importar el orden ni la ortografía exacta.
2. Si aun así el primer dato no es una marca reconocida (Nissan, Renault,
   Changan), busca la marca más adelante en el nombre y la usa como ancla.
Además, esa línea de metadatos ya no repite "Marca: …" como texto — la marca
ahora solo se muestra una vez, de forma visual, con su logo y su etiqueta.

**El periodo del reporte ahora se calcula solo, mes con mes**
Antes decía "Periodo: Abril 2026" fijo en el código, sin importar de qué mes
fueran en realidad los archivos cargados — por eso en mayo seguía diciendo
abril. Ahora el periodo se calcula a partir de las fechas reales dentro de
los archivos de cada unidad (no del nombre del archivo ni de ningún valor
fijo), así que dirá "Mayo 2026", "Junio 2026", etc. automáticamente según lo
que cargues cada mes, sin tocar el código. Esto aplica tanto al texto
"Periodo: …" como al nombre del archivo PDF descargado
(`Reporte_Cumplimiento_<unidad>_MAYO_2026.pdf`) y al título del Excel de
auditoría.

**04 — Colaboradores: situación exacta por colaborador**
Nueva sección que agrega un tercer filtro (Colaborador) a los dos que ya
existían arriba (Agencia/unidad y Área, en "02 — Panorama"). Selecciona una
agencia, opcionalmente un área, y verás la lista de sus colaboradores con
retardos, faltas, jornadas que exceden el límite diario y checadas
incompletas. Haz clic en cualquier colaborador para ver su detalle día por
día (fecha, entrada, salida, horas y una columna de alerta). El botón
"⬇ Exportar a Excel" descarga exactamente lo que estás viendo — un colaborador
o toda la agencia — con una fila por día y una columna "Alerta" que marca en
texto claro cada retardo, falta o jornada excesiva, lista para revisar o
adjuntar como evidencia.

**Reportes PDF por agencia: logo de marca correcto, y detalle por colaborador**
- El logo de marca en la esquina superior ahora muestra **solo el de la marca
  de esa agencia** (Nissan, Renault o Changan, según corresponda) — ya no
  aparecen las tres juntas. El logo de Chesa se mantiene siempre.
- Debajo del logo de marca se agregó una etiqueta con el nombre de la marca
  en texto, para que quede inequívoco a qué agencia pertenece el reporte.
- Se agregó un **anexo con el detalle por colaborador**, en una página aparte
  *después* de la portada ejecutiva y de las firmas (que se quedaron donde
  siempre estuvieron, en la primera hoja): una tabla con cada colaborador de
  la agencia, sus retardos, faltas, jornadas que exceden las 12 horas diarias
  (Art. 68 LFT, tope de esta primera fase 2026) y checadas incompletas,
  ordenada de mayor a menor incidencia para que el Gerente General vea
  primero los casos que más atención requieren. El reporte ya no es de una
  sola hoja — el pie de página ahora muestra "Página X de Y" en lugar de
  "Hoja única".

**Tablero vacío por defecto**
`Tablero_Cumplimiento_Jornada_Laboral.html` ya no trae datos de ningún mes
horneados adentro — se abre siempre sin unidades cargadas, listo para arrastrar
los archivos del mes en curso. Ya no hace falta quitar, unidad por unidad, los
datos de meses anteriores antes de cargar los nuevos. Si en algún momento
quedaron unidades cargadas en la sesión actual del navegador y quieres empezar
de cero, usa el botón "Quitar todos" junto al listado de unidades (sección
"01 — Datos"). Ver la sección "El tablero siempre abre vacío" más arriba para
el detalle completo del flujo mensual.

**07 — Simulador de transición 48h → 40h**
Nueva sección en el tablero (y hoja "Simulador Transicion" en el Excel) que
proyecta el mismo patrón de horas trabajadas de este mes contra cada corte
anual del decreto (2026 a 2030), sin necesidad de cargar datos nuevos. Muestra
una gráfica de % de cumplimiento proyectado por año y una tabla por unidad con
la brecha de horas/semana que falta cerrar para llegar al límite de 2030. Así
se anticipa qué unidades necesitarán rediseñar turnos antes de cada reducción,
en vez de descubrirlo hasta que la ley ya esté vigente.

**Bitácora de firmas**
En la sección 02 (Panorama y Documentos, apartado desplegable "Documentos") puedes capturar el nombre de quien elabora,
recibe y da el visto bueno *antes* de generar los PDFs; si los llenas, el PDF
imprime el nombre y la fecha de hoy en la línea de firma (si los dejas en
blanco, el PDF se comporta como antes: espacio en blanco para firmar a mano).
Cada PDF generado queda registrado en una bitácora de la sesión (tabla en el
tablero, exportable a CSV) y también en una hoja "Bitacora Firmas" del Excel
de auditoría — reforzando la trazabilidad de quién firmó qué y cuándo.
En el pipeline de Python, pasa `--elabora "Nombre" --recibe "Nombre" --vobo
"Nombre"` a `build_pdf_reports.py` / `build_excel_auditoria.py` (o exporta las
variables de entorno `ELABORA`, `RECIBE`, `VOBO` antes de correr `run_all.sh`)
para prellenar los mismos nombres en el respaldo formal del mes.

**Nota sobre la bitácora del tablero:** vive solo en la sesión del navegador
(no sobrevive a recargar la página) — es una ayuda de seguimiento del momento,
no un registro permanente. Para conservarla, expórtala a CSV o genera el Excel
de auditoría antes de cerrar la pestaña.

## Limitaciones a tener presentes

- Este tablero es una **herramienta de apoyo interno**; no sustituye una
  revisión de Legal/RRHH antes de presentar cifras ante la autoridad laboral.
- Si una unidad no incluye la hoja "Días sin checadas" en su Excel (como pasó
  con Renault Tuxtla en abril 2026), sus faltas no quedan cuantificadas y el
  dashboard/reporte lo señala explícitamente como dato pendiente — no lo
  reporta como "cero faltas".
- Las horas trabajadas se calculan como (salida − entrada − tiempo de
  comida cuando hay checada de comida completa). Si el checador de alguna
  unidad usa otra convención (por ejemplo, descuenta comida fija sin checarla),
  avísame para ajustar la fórmula en `etl.py`.
- Los PDFs de una hoja muestran una **muestra representativa** de hallazgos
  (hasta 10, los más severos por categoría), no el listado completo; eso es
  intencional para que quepan en una hoja y sean fáciles de firmar. El listado
  completo vive en el tablero y en el Excel de auditoría.
