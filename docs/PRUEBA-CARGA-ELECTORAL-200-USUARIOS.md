# Prueba de carga electoral — 200 usuarios

## Objetivo

Validar el comportamiento del sistema con el patrón esperado de la jornada:
- hasta 200 usuarios con sesión abierta;
- actividad intermitente, no 200 operaciones continuas;
- consultas de sesión cada ~20 s con desfase aleatorio;
- duración configurable;
- pruebas de 300 usuarios como margen adicional;
- sin modificar datos en la prueba por defecto.

El arnés usa Node 20+ y fetch nativo; no requiere instalar dependencias.

## Importante: no probar escrituras contra producción

El escenario predeterminado (session) solo ejecuta:
1. POST /api/auth/login
2. GET /api/auth/session repetidamente.

Esto permite medir autenticación, cookies HttpOnly, dispatcher de Vercel y consultas de sesión a Turso sin alterar datos funcionales.

El escenario verification modifica la base de datos y está bloqueado salvo que se establezcan simultáneamente:
- LOAD_TEST_WRITES=1
- LOAD_TEST_ENV=staging

Además exige credenciales, centro, mesa y cédulas de prueba. Debe utilizarse exclusivamente con una base de datos de staging.

## Prueba recomendada

### 1. Smoke test

BASE_URL="https://<preview-o-staging>" TEST_USER="operador" TEST_PASSWORD="<clave-de-prueba>" TEST_ROLE="O" node tools/load-test.mjs --vus 10 --duration 60 --ramp 10

### 2. Carga esperada

BASE_URL="https://<preview-o-staging>" TEST_USER="operador" TEST_PASSWORD="<clave-de-prueba>" TEST_ROLE="O" node tools/load-test.mjs --vus 200 --duration 600 --ramp 60 --interval 20

Son 200 usuarios virtuales durante 10 minutos, entrando progresivamente durante 1 minuto y después haciendo consultas de sesión espaciadas. Es deliberadamente mucho más intenso que la actividad descrita para una cola electoral normal.

### 3. Margen

BASE_URL="https://<preview-o-staging>" TEST_USER="operador" TEST_PASSWORD="<clave-de-prueba>" TEST_ROLE="O" node tools/load-test.mjs --vus 300 --duration 300 --ramp 60 --interval 15

## Qué observar

- HTTP 2xx/4xx/5xx;
- FUNCTION_THROTTLED, 429, 500, 502, 503 y 504;
- latencia p50/p90/p95/p99;
- errores de conexión a Turso;
- duración de consultas;
- memoria/CPU de la función;
- logs de Vercel;
- consumo de Turso;
- errores de autenticación;
- estabilidad de las sesiones.

El script devuelve automáticamente tasa de error, solicitudes por segundo y percentiles de latencia.

## Criterio práctico para esta jornada

No se debe declarar capacidad de producción únicamente porque una prueba termine correctamente. La prueba debe repetirse después de cualquier cambio importante en autenticación, verificaciones, cortes, métricas o Turso.

## Matriz mínima

| Prueba | VU | Duración |
|---|---:|---:|
| Smoke | 10 | 1 min |
| Normal | 100 | 10 min |
| Esperada | 200 | 10–30 min |
| Margen | 300 | 5–10 min |

Luego puede hacerse una prueba prolongada de 1–2 horas con 200 VU para detectar degradación acumulada.

## Nota sobre Vercel

La documentación actual de Vercel indica que Fluid Compute permite concurrencia dentro de una misma instancia y que las funciones Node.js/Python pueden autoescalar hasta 30.000 ejecuciones concurrentes en Hobby/Pro, sujeto a los demás límites del servicio. Esto no sustituye la prueba de carga de esta aplicación concreta.

Fuente: https://vercel.com/docs/functions/limitations