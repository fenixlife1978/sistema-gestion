# Escritorio offline-first — sistema-gestion

## Objetivo
El cliente Electron usa el servidor en tiempo real cuando hay conexión, pero conserva una base SQLite local para caché de lecturas y una cola duradera de operaciones cuando la red falla. SQLite local permite continuidad operativa; no reemplaza la validación final del servidor.

## Componentes
- `electron/sqlite-store.js`: SQLite en el directorio de datos del usuario, WAL, cola duradera y caché de lecturas confirmadas.
- `electron/preload.js`: API IPC limitada para consultar estado, leer cola, encolar operaciones y solicitar sincronización.
- `electron/main.js`: fallback local cuando no carga el sitio remoto y reintentos de sincronización en segundo plano.
- `electron/offline.html`: pantalla de contingencia para registrar verificaciones y actas mientras no haya conexión.
- `api/desktop-sync.js`: valida sesión activa y roles, reclama cada evento con token temporal para evitar procesamiento concurrente del mismo identificador, recupera reclamaciones abandonadas después de dos minutos y devuelve conflictos.
- `tests/offline-store.test.js`: pruebas automatizadas de persistencia SQLite, deduplicación local, separación de conflictos y caché.
- `index.html`: almacena en SQLite los resultados SELECT que ya confirmó el servidor y los reutiliza como caché si falla la red. Los SELECT cacheados nunca se usan como autoridad para escrituras.

## Estados
- `pending`: guardado en SQLite, aún no enviado.
- `failed`: intento de envío fallido; se reintenta.
- `syncing`: reservado para indicar un envío en curso.
- `conflict`: se conserva localmente y se excluye del reintento automático para que no bloquee otros eventos; debe resolverse manualmente.
- `synced`: el servidor confirmó la operación.
- `conflict`: el servidor rechazó la operación por conflicto; requiere resolución, no se sobrescribe automáticamente.

Una operación local no debe mostrarse como confirmada por el servidor hasta que su estado sea `synced`. El servidor usa `event_id` para reconocer reintentos y verifica que la clave corresponda al mismo usuario y tipo de operación. Los conflictos se cuentan por separado y no deben impedir el envío de eventos posteriores.

## Primer administrador
La inicialización ya no debe crear `admin@comando.com / admin123`. Si una base está vacía, el operador debe configurar temporalmente `INITIAL_ADMIN_USER` y `INITIAL_ADMIN_PASSWORD` (mínimo 16 caracteres) para inicializar el primer acceso. No publicar ni registrar estos secretos. En una base existente con usuarios, esta configuración no es necesaria.

## Alcance pendiente
Esta rama incorpora la base técnica de contingencia y el encolado de verificaciones y actas. Se añadieron pruebas automatizadas de la cola SQLite (`npm run test:offline`); deben ejecutarse en CI antes de considerar validadas. Aún requiere pruebas reales de caída de red, reinicio del equipo con cola pendiente, sesión expirada, duplicidad/reintentos, conflictos entre operadores y volumen de padrón. La pantalla offline es de contingencia: los demás módulos todavía no están adaptados para todas las operaciones offline. No declarar el escritorio completamente offline-first hasta terminar esas pruebas y adaptar cada operación crítica con un endpoint específico e idempotente.
