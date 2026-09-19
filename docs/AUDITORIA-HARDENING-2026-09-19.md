# Auditoría y endurecimiento — 19/09/2026

## Rama
`audit/hardening-2026-09-19`

## Fase 2 — autenticación servidor

- Login movido a `/api/auth/login`.
- Sesión firmada por HMAC y almacenada en cookie HttpOnly/Secure/SameSite.
- `/api/auth/session` valida la cookie y vuelve a consultar el usuario activo en Turso.
- `/api/auth/logout` invalida la cookie.
- Las contraseñas existentes con SHA-256 legado se aceptan durante la transición y, tras un login correcto, se migran automáticamente a PBKDF2-HMAC-SHA256 con salt aleatorio.
- El navegador ya no recibe ni compara `clave_hash`.
- Se eliminó la restauración de sesión basada en `localStorage`.

## Pendiente antes de considerar terminada la seguridad

El proxy `/api/turso` todavía acepta SQL genérico y las operaciones críticas aún deben migrarse a APIs explícitas con autorización servidor-side y transacciones:

- `/api/duplicidades/autorizar`
- `/api/personas/registrar`
- `/api/mesas/miembros`
- `/api/verificaciones`
- `/api/actas`
- `/api/cortes`

No fusionar esta rama a `main` como solución final de seguridad hasta completar esa migración y ejecutar pruebas de bypass desde navegador/devtools.
