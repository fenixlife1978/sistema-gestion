# Escritorio offline-first — sistema-gestion

## Objetivo y autoridad de datos

La aplicación Electron utiliza el servidor cuando hay conexión y mantiene SQLite local para la caché de lecturas confirmadas y una cola duradera de operaciones admitidas durante una caída de red. SQLite permite continuidad local, pero **no reemplaza la validación del servidor ni convierte una operación pendiente en confirmada**.

## Componentes

- `electron/sqlite-store.js`: SQLite en el directorio de datos del usuario, WAL, cola duradera, migraciones locales y caché.
- `electron/sync-engine.js`: motor de sincronización con dependencias inyectables para probar desconexión, sesión, reintentos, conflictos y concurrencia.
- `electron/preload.js`: puente IPC limitado para estado, cola, caché, usuario activo y sincronización.
- `electron/main.js`: ventana Electron, pantalla de contingencia, validación remota del usuario activo y reintentos en segundo plano.
- `electron/offline.html`: contingencia local para registrar **verificaciones y actas**; no representa todavía todos los módulos del ERP.
- `api/desktop-sync.js`: valida sesión y rol, exige que `actor_id` coincida con la sesión autenticada, reclama eventos con token temporal, recupera reclamaciones abandonadas y devuelve conflictos.
- `api/turso.js`: proxy de lectura endurecido; la caché solo guarda resultados SELECT que el servidor confirmó.
- `index.html`: asocia el usuario activo con la sesión validada y limpia caché y propietario activo al cerrar sesión, sin borrar operaciones pendientes.
- Pruebas: `tests/offline-store.test.js`, `tests/desktop-sync.test.js` y `tests/sync-engine.test.js`.

## Propiedad y privacidad de la cola

Cada evento nuevo contiene el identificador del usuario propietario. El proceso principal no confía en un identificador enviado libremente por el renderer: confirma el usuario contra `/api/auth/session` y la API vuelve a comprobar que el propietario del evento coincida con la sesión que lo envía.

La sincronización solo selecciona eventos del usuario activo. La pantalla de contingencia oculta el contenido de eventos de otras cuentas. Las operaciones antiguas que no tengan propietario se convierten en `conflict` para revisión y no se aplican automáticamente bajo otra cuenta.

Al cerrar sesión se elimina el usuario activo y se limpia la caché local, pero la cola permanece intacta. Esto evita tanto la pérdida silenciosa de operaciones como la reutilización de lecturas cacheadas por otra cuenta. Para continuar sincronizando una cola, debe autenticarse el mismo usuario propietario.

## Estados de una operación

- `pending`: guardada en SQLite, aún no confirmada por el servidor.
- `failed`: intento fallido y susceptible de reintento.
- `syncing`: envío en curso o reclamado temporalmente por el servidor.
- `conflict`: requiere revisión; queda excluida del reintento automático.
- `synced`: el servidor confirmó la operación.

El servidor usa `event_id` para reconocer reintentos y evita que un mismo identificador se reutilice para otro usuario o tipo de operación. Los conflictos se conservan localmente y no deben bloquear el envío de otros eventos.

## Validación automatizada

`npm run test:offline` ejecuta pruebas para:

- persistencia de SQLite tras reinicio, idempotencia y validación de datos;
- migración segura de eventos antiguos sin propietario;
- conservación de operaciones pendientes al limpiar caché;
- lectura/escritura de un snapshot de padrón de 10.000 registros;
- rechazo de sesiones vencidas, métodos HTTP no permitidos y eventos pertenecientes a otro usuario;
- desconexión sin pérdida de cola, sesión ausente, sincronización exitosa, conflictos sin reintento automático y llamadas concurrentes.

El workflow de GitHub Actions valida sintaxis JavaScript, ejecuta las pruebas y construye el instalador de Windows como artefacto descargable de Actions (retención de 14 días, sin necesidad de crear un Release).

## Primer administrador

La inicialización ya no debe crear `admin@comando.com / admin123`. Si una base está vacía, el operador debe configurar temporalmente `INITIAL_ADMIN_USER` y `INITIAL_ADMIN_PASSWORD` (mínimo 16 caracteres) para inicializar el primer acceso. No publicar ni registrar estos secretos. En una base existente con usuarios, esta configuración no es necesaria.

## Alcance pendiente — no declarar finalizado todavía

La pantalla de contingencia permite actualmente encolar verificaciones y actas. **Los demás módulos y sus escrituras todavía no están adaptados para operar completamente offline.** Antes de declarar el escritorio completamente offline-first, faltan pruebas E2E con la aplicación instalada y un entorno de prueba real para:

- cortar y restablecer la red mientras se usa la interfaz;
- reiniciar la aplicación/equipo con operaciones pendientes y verificar su sincronización posterior;
- probar sesión vencida, cierre de sesión y cambio entre dos operadores en el mismo equipo;
- probar conflictos reales contra datos ya modificados en el servidor y su resolución operativa;
- validar volúmenes representativos de padrón, latencia, límites y recuperación ante fallos de Turso;
- adaptar cada operación crítica restante a un endpoint específico, idempotente y con permisos verificados.

No presentar una operación local como confirmada por el servidor hasta recibir estado `synced`.
