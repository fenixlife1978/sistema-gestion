#!/usr/bin/env node
/**
 * Load test for sistema-gestion.
 *
 * Safe default: only GET /api/health and authenticated GET /api/auth/session.
 * It does NOT mutate production data.
 *
 * Node 20+ (native fetch). No npm dependencies.
 *
 * Example:
 *   BASE_URL=https://staging.example.com \
 *   TEST_USER=operador TEST_PASSWORD='...' TEST_ROLE=O \
 *   node tools/load-test.mjs --vus 200 --duration 600 --ramp 60
 *
 * Write scenario is intentionally opt-in and requires:
 *   LOAD_TEST_WRITES=1
 *   LOAD_TEST_ENV=staging
 *   TEST_CENTER=<center code>
 *   TEST_CEDULAS=V123,V456,...
 *   TEST_MESA=1
 *
 * Never run the write scenario against the election/production database.
 */

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const hasArg = name => args.includes(name);

const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/, '');
const VUS = Math.max(1, Number(getArg('--vus', process.env.VUS || 200)));
const DURATION_SEC = Math.max(10, Number(getArg('--duration', process.env.DURATION || 600)));
const RAMP_SEC = Math.max(0, Number(getArg('--ramp', process.env.RAMP || 60)));
const INTERVAL_SEC = Math.max(2, Number(getArg('--interval', process.env.INTERVAL || 20)));
const SCENARIO = String(getArg('--scenario', process.env.SCENARIO || 'session')).toLowerCase();
const USER = String(process.env.TEST_USER || '');
const PASSWORD = String(process.env.TEST_PASSWORD || '');
const ROLE = String(process.env.TEST_ROLE || 'O').toUpperCase();

if (!BASE_URL) {
  console.error('Falta BASE_URL. Debe apuntar a un entorno de prueba/preview.');
  process.exit(2);
}
if (!/^https?:\/\//i.test(BASE_URL)) {
  console.error('BASE_URL debe comenzar por http:// o https://');
  process.exit(2);
}
if (!['session','verification'].includes(SCENARIO)) {
  console.error('SCENARIO debe ser session o verification.');
  process.exit(2);
}
if (SCENARIO === 'session' && (!USER || !PASSWORD || !['J','A','O'].includes(ROLE))) {
  console.error('Para scenario=session se requieren TEST_USER, TEST_PASSWORD y TEST_ROLE=J|A|O.');
  process.exit(2);
}
if (SCENARIO === 'verification') {
  if (process.env.LOAD_TEST_WRITES !== '1' || process.env.LOAD_TEST_ENV !== 'staging') {
    console.error('El escenario verification requiere LOAD_TEST_WRITES=1 y LOAD_TEST_ENV=staging.');
    process.exit(2);
  }
  if (!USER || !PASSWORD || !['J','A','O'].includes(ROLE)) {
    console.error('Para verification se requieren TEST_USER, TEST_PASSWORD y TEST_ROLE=J|A|O.');
    process.exit(2);
  }
  if (!process.env.TEST_CENTER || !process.env.TEST_CEDULAS || !process.env.TEST_MESA) {
    console.error('Verification requiere TEST_CENTER, TEST_CEDULAS y TEST_MESA.');
    process.exit(2);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const metrics = {
  requests: 0,
  ok: 0,
  errors: 0,
  byStatus: new Map(),
  latencies: [],
  startedAt: Date.now()
};

function record(status, latency, error) {
  metrics.requests++;
  metrics.latencies.push(latency);
  metrics.byStatus.set(status, (metrics.byStatus.get(status) || 0) + 1);
  if (status >= 200 && status < 400) metrics.ok++;
  else metrics.errors++;
  if (error) metrics.lastError = String(error);
}

async function request(path, options = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(BASE_URL + path, {
      redirect: 'manual',
      ...options,
      headers: {
        'Accept': 'application/json',
        ...(options.headers || {})
      }
    });
    status = response.status;
    await response.arrayBuffer();
    record(status, Math.round(performance.now() - started));
    return response;
  } catch (e) {
    record(0, Math.round(performance.now() - started), e.message);
    return null;
  }
}

async function login() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({usuario: USER, clave: PASSWORD, rol: ROLE})
  });
  if (!response || response.status !== 200) throw new Error('Login falló');
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/(?:^|,\s*)erp_session=([^;]+)/);
  if (!match) throw new Error('Login no devolvió erp_session');
  return decodeURIComponent(match[1]);
}

async function runUser(id, deadline) {
  let cookie;
  try {
    cookie = await login();
  } catch (e) {
    return;
  }

  const initial = await request('/api/auth/session', {
    headers: {Cookie: 'erp_session=' + encodeURIComponent(cookie)}
  });
  if (!initial || initial.status !== 200) return;

  let next = Date.now() + Math.floor(Math.random() * INTERVAL_SEC * 1000);
  while (Date.now() < deadline) {
    const wait = next - Date.now();
    if (wait > 0) await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) break;

    await request('/api/auth/session', {
      headers: {Cookie: 'erp_session=' + encodeURIComponent(cookie)}
    });

    if (SCENARIO === 'verification') {
      const cedulas = String(process.env.TEST_CEDULAS).split(',').map(x => x.trim()).filter(Boolean);
      const cedula = cedulas[id % cedulas.length];
      await request('/api/verificaciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'erp_session=' + encodeURIComponent(cookie)
        },
        body: JSON.stringify({
          cedula,
          centro_codigo: String(process.env.TEST_CENTER),
          mesa: String(process.env.TEST_MESA)
        })
      });
    }

    next = Date.now() + INTERVAL_SEC * 1000 + Math.floor(Math.random() * 5000);
  }
}

async function main() {
  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    scenario: SCENARIO,
    virtualUsers: VUS,
    durationSec: DURATION_SEC,
    rampSec: RAMP_SEC,
    intervalSec: INTERVAL_SEC
  }, null, 2));

  const deadline = Date.now() + DURATION_SEC * 1000;
  const users = [];
  const stepMs = RAMP_SEC > 0 ? (RAMP_SEC * 1000) / VUS : 0;

  for (let i = 0; i < VUS; i++) {
    users.push(runUser(i, deadline));
    if (stepMs) await sleep(stepMs);
  }

  await Promise.all(users);
  const sorted = metrics.latencies.slice().sort((a,b) => a-b);
  const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
  const elapsedSec = (Date.now() - metrics.startedAt) / 1000;
  const status = Object.fromEntries(metrics.byStatus.entries());

  console.log(JSON.stringify({
    completedAt: new Date().toISOString(),
    elapsedSec: Number(elapsedSec.toFixed(1)),
    requests: metrics.requests,
    ok: metrics.ok,
    errors: metrics.errors,
    errorRate: metrics.requests ? Number((metrics.errors / metrics.requests * 100).toFixed(2)) : 0,
    requestsPerSecond: Number((metrics.requests / elapsedSec).toFixed(2)),
    latencyMs: {
      p50: percentile(0.50),
      p90: percentile(0.90),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: sorted.length ? sorted[sorted.length - 1] : null
    },
    status,
    lastError: metrics.lastError || null
  }, null, 2));

  if (metrics.errors) process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
