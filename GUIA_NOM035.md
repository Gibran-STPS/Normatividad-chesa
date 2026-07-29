# Módulo NOM-035 · Riesgo Psicosocial — Guía de instalación

## Qué se agregó

1. **`panel-control.html`** (actualizado) — nueva sección "NOM-035 Riesgo Psicosocial" en el menú lateral:
   - Tabla de los 22 centros con: número de trabajadores, cuestionario aplicable (Guía I / II / III según numeral 7.1 de la Norma), respuestas recibidas y nivel de riesgo más reciente.
   - Botón **QR** por centro: genera (o reutiliza) un código de acceso único y lo muestra como QR + enlace copiable.
   - Botón **Resultados**: muestra el nivel de riesgo, el desglose por dominio (ambiente de trabajo, carga de trabajo, liderazgo, violencia, etc.) y el texto de plan de acción sugerido por la Norma según el nivel de riesgo. Incluye un botón para registrar el plan de acción en la base de datos.
2. **`encuesta-nom035.html`** (nuevo archivo, súbelo a la raíz del repo junto a `panel-control.html`) — la página pública que abren los colaboradores al escanear el QR. No requiere cuenta ni contraseña. Aplica:
   - **Guía I** (acontecimiento traumático severo) a todos los colaboradores, con la lógica de seguimiento exacta de la Norma para decidir si se requiere canalización clínica.
   - **Guía II** (46 reactivos) si el centro tiene entre 16 y 50 trabajadores, o **Guía III** (72 reactivos) si tiene más de 50 — calculado automáticamente a partir de `numero_trabajadores` del centro.
   - Centros con 15 trabajadores o menos solo ven la Guía I (la Norma no exige cuestionario extenso en ese caso).
   - Califica las respuestas con las tablas y umbrales exactos de la Norma (Tablas 2-4 para la Guía II, 5-7 para la Guía III) y guarda el resultado de forma **anónima** (no se pide ni guarda el nombre del trabajador).
3. **`supabase_nom035_setup.sql`** (nuevo) — crea las tablas `nom035_tokens`, `nom035_respuestas` y `nom035_planes_accion`, la seguridad a nivel de fila (RLS) y una función pública `obtener_centro_por_token` que permite que la página del cuestionario sepa el nombre del centro y su número de trabajadores sin exponer el resto de tu base de datos.

## Pasos para activarlo

### 1. Base de datos (una sola vez)
Abre el **SQL Editor** de tu proyecto Supabase (`ptukbtqxqscgozwduima`) y ejecuta el contenido completo de `supabase_nom035_setup.sql`. Es seguro volver a ejecutarlo si algo falla a la mitad.

### 2. Archivos al repositorio
Sube (o pide que se suba) `panel-control.html` actualizado y el nuevo `encuesta-nom035.html` a la raíz del repo `Gibran-STPS/Normatividad-chesa`, junto a los archivos que ya tienes. Con GitHub Pages activo, el cuestionario quedará disponible en:

```
https://gibran-stps.github.io/Normatividad-chesa/encuesta-nom035.html?t=TOKEN
```

El panel arma esa URL automáticamente al generar el QR — no necesitas escribirla a mano.

### 3. Usar el módulo
1. Entra a **NOM-035 Riesgo Psicosocial** en el menú.
2. Da clic en el icono de QR de un centro → se genera su código y puedes imprimirlo o compartir el enlace (por ejemplo, en el pizarrón de la comisión de seguridad e higiene, o por WhatsApp/correo al centro).
3. Los colaboradores lo escanean desde su celular, responden y sus respuestas se guardan automáticamente.
4. Da clic en el icono de resultados para ver el nivel de riesgo, el desglose por dominio y el plan de acción sugerido; puedes registrarlo con un clic para darle seguimiento.

## Notas importantes

- **Anonimato real**: la tabla `nom035_respuestas` no tiene columna de nombre ni de identificador de usuario; solo guarda datos generales (sexo, rango de edad, tipo de puesto) que pide la propia Guía de referencia V de la Norma.
- **Regenerar el QR**: si un código se comparte fuera de tu organización o quieres "cerrar" una ronda de aplicación, usa "Generar un nuevo código" en el modal del QR — el anterior deja de funcionar pero el historial de respuestas se conserva.
- **Vigencia recomendada**: la Norma exige repetir la identificación y análisis al menos cada dos años (numeral 7.9); puedes usar la fecha de las respuestas en `nom035_respuestas.created_at` para saber cuándo toca la siguiente ronda.
- **Este módulo no sustituye tu criterio profesional**: los umbrales y textos de plan de acción son una transcripción directa de la Norma, pero el análisis final y las decisiones de intervención deben validarse por el responsable de seguridad y salud en el trabajo.
