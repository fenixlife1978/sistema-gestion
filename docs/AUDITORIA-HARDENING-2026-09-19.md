# Auditoría y endurecimiento — 19/09/2026

## Rama
`audit/hardening-2026-09-19`

## Objetivo
Endurecer el sistema sin modificar el comportamiento funcional de los módulos electorales.

## Hallazgos prioritarios

1. **Proxy SQL genérico**: `/api/turso` recibe SQL desde el navegador. El token de Turso permanece en servidor, pero el endpoint todavía expone una superficie de ejecución demasiado amplia.
2. **Autenticación cliente**: el login consulta `usuarios` y compara el hash en JavaScript.
3. **Sesión cliente**: `localStorage` era utilizado para conservar el registro completo del usuario, incluyendo `clave_hash`.
4. **Autorizaciones J/A**: la decisión de exigir autorización y su validación se ejecutan en el navegador; deben migrarse a una API transaccional de servidor.
5. **Migraciones**: los errores se ignoraban de forma indistinta; ahora los errores reales deben detener la inicialización, mientras que columnas/tablas ya existentes se consideran migraciones benignas.
6. **Restricciones**: varias reglas de negocio dependen de JavaScript y deben convertirse progresivamente en invariantes de base de datos/API.

## Cambios de esta fase

- Se eliminó `clave_hash` del objeto persistido en `localStorage`.
- Se guarda solamente el contexto mínimo de sesión en el navegador.
- La salida de sesión limpia explícitamente el objeto `USER`.
- Las migraciones ya aplicadas se reconocen como benignas.
- Los errores de esquema reales ya no se silencian: la inicialización falla con el detalle de los pasos afectados.

## Siguiente fase obligatoria

La siguiente migración debe reemplazar el proxy SQL genérico por operaciones de API explícitas:

- `/api/auth/login`
- `/api/auth/session`
- `/api/duplicidades/autorizar`
- `/api/personas/registrar`
- `/api/mesas/miembros`
- `/api/verificaciones`
- `/api/actas`
- `/api/cortes`

Cada operación deberá validar servidor-side identidad, rol, reglas de duplicidad, autorización J/A y transacción antes de escribir Turso.

> No se debe fusionar esta rama a `main` como solución final de seguridad hasta completar esa segunda fase.
