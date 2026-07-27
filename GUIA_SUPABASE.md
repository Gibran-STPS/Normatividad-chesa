# Guía: conectar Normatividad Grupo Automotriz Chesa a una base de datos real

Esto te toma entre 15 y 20 minutos. No necesitas saber programar — son formularios y un script que copias y pegas.

## Paso 1 — Crear tu cuenta y proyecto en Supabase

1. Ve a **https://supabase.com** y crea una cuenta gratis (con tu correo o con GitHub).
2. Clic en **"New Project"**.
3. Ponle un nombre, por ejemplo `chesa-normatividad`.
4. Crea una **contraseña de base de datos** (guárdala en un lugar seguro, no es la misma que la de los usuarios de la app).
5. Elige la región más cercana (ej. `East US` o `South America`).
6. Espera 1-2 minutos mientras Supabase crea tu proyecto.

## Paso 2 — Crear las tablas (base de datos)

1. En el menú izquierdo, entra a **SQL Editor**.
2. Clic en **"New query"**.
3. Abre el archivo `supabase_setup.sql` que te entregué, copia **todo** el contenido, y pégalo ahí.
4. Clic en **"Run"** (o Ctrl+Enter).
5. Deberías ver "Success. No rows returned" — eso significa que ya tienes 4 tablas: `centros_trabajo`, `normas_catalogo`, `centro_normas`, `perfiles`, ya con el catálogo de 26 NOM-STPS cargado.

## Paso 3 — Crear los usuarios (tú y tu compañero)

1. En el menú izquierdo, entra a **Authentication > Users**.
2. Clic en **"Add user" > "Create new user"**.
3. Captura:
   - Email: `admin@grupochesa.com` (o el correo real que quieras usar)
   - Password: la que tú elijas
   - Marca la casilla **"Auto Confirm User"** (importante, si no la marcas pide confirmar por correo).
4. Repite para tu compañero ingeniero.
5. **Copia el "User UID"** de cada usuario que se creó (aparece en la lista) — lo necesitas para el siguiente paso.

## Paso 4 — Asignar nombre y puesto a cada usuario

1. Ve otra vez a **SQL Editor > New query**.
2. Pega esto, cambiando `PEGA-AQUI-EL-UID` por el UID real que copiaste:

```sql
insert into perfiles (id, nombre, puesto) values
  ('PEGA-AQUI-EL-UID', 'Gibran Hashmed García Cruz', 'Responsable de Auditoría STPS');
```

3. Repite con el UID de tu compañero y su nombre/puesto.
4. Run.

## Paso 5 — Obtener tu URL y llave pública

1. Ve a **Project Settings** (ícono de engrane) **> API**.
2. Copia dos valores:
   - **Project URL** (algo como `https://xxxxxxxx.supabase.co`)
   - **anon public** key (una llave larga tipo `eyJhbGciOi...`)
3. **Esta llave "anon" es segura de compartir/incluir en el HTML** — no es una llave secreta; el acceso real está protegido por las reglas de seguridad (RLS) que ya activamos en el script SQL. NUNCA copies la llave "service_role" (esa sí es secreta) en el archivo HTML.

## Paso 6 — Pegar tus datos en el archivo

1. Abre el archivo `panel-control.html` con un editor de texto (Bloc de notas, VS Code, etc.).
2. Busca (Ctrl+F) el texto `SUPABASE_URL` cerca del inicio del `<script>`.
3. Reemplaza los valores de ejemplo por tu Project URL y tu anon key.
4. Guarda el archivo y ábrelo en el navegador.

## Cómo funciona a partir de ahora

- El login ya valida contra usuarios reales de Supabase, no contra una lista escrita en el código.
- Los centros de trabajo que agregues o edites se guardan en la base de datos real — persisten aunque cierres el navegador o lo abras en otra computadora.
- **La sesión ahora se recuerda automáticamente**: después de iniciar sesión una vez, el navegador te reconoce en las siguientes visitas y entra directo al panel, sin pedir usuario y contraseña de nuevo. Para cerrar sesión manualmente (por ejemplo en una computadora compartida), usa el botón "Cerrar sesión" del menú de usuario.
- La app ahora **necesita conexión a internet** para funcionar, porque está hablando con una base de datos real en la nube.

## Si algo no funciona

- Revisa la consola del navegador (F12 > Console) — los errores de Supabase suelen decir exactamente qué falta (URL mal copiada, política de RLS, etc.).
- Verifica que copiaste la llave **anon public**, no la **service_role**.
- Verifica que el usuario tenga "Auto Confirm User" marcado, si no, no podrá iniciar sesión hasta confirmar su correo.
