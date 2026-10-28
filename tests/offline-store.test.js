const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../electron/sqlite-store');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-gestion-offline-'));
  let store = openStore(dir);
  t.after(() => {
    try { store?.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    get store() { return store; },
    reopen() { store.close(); store = openStore(dir); return store; }
  };
}

test('offline outbox persists events across store restarts', t => {
  const f = fixture(t);
  const event = { actor_id:1, event_id:'evt_12345678901234567890', type:'verificacion', payload:{cedula:'12345678',centro_codigo:'C01',mesa:'1'} };
  assert.equal(f.store.addEvent(event).queued, true);
  assert.equal(f.store.pendingCount(), 1);
  const reopened = f.reopen();
  assert.equal(reopened.pendingCount(), 1);
  assert.deepEqual(reopened.listSyncableEvents(1)[0].payload, event.payload);
});

test('outbox is idempotent by event id and does not overwrite original payload', t => {
  const f = fixture(t);
  const id = 'evt_12345678901234567890';
  const original = {actor_id:1,event_id:id,type:'acta',payload:{centro_codigo:'C01',mesa:'1',votos_partido:10}};
  assert.equal(f.store.addEvent(original).duplicate, false);
  assert.equal(f.store.addEvent(original).duplicate, true);
  assert.throws(() => f.store.addEvent({event_id:id,type:'acta',payload:{centro_codigo:'C02',mesa:'2',votos_partido:99}}), /datos distintos/);
  const rows = f.store.listSyncableEvents(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.centro_codigo, 'C01');
});

test('conflicts are visible but excluded from automatic sync batches', t => {
  const f = fixture(t);
  f.store.addEvent({actor_id:1,event_id:'evt_12345678901234567890',type:'acta',payload:{centro_codigo:'C01',mesa:'1',votos_partido:10}});
  f.store.addEvent({actor_id:1,event_id:'evt_22345678901234567890',type:'verificacion',payload:{cedula:'12345678',centro_codigo:'C01',mesa:'1'}});
  f.store.setEventStatus('evt_12345678901234567890','conflict','Resultados distintos');
  assert.equal(f.store.listSyncableEvents(1).length, 1);
  assert.equal(f.store.queueSummary().conflict, 1);
  assert.equal(f.store.queueSummary().totalUnresolved, 2);
});

test('cache round-trips JSON and rejects invalid keys', t => {
  const f = fixture(t);
  const value = [{id:1,nombre:'Centro de prueba'}];
  f.store.setCache('centros:v1', value);
  assert.deepEqual(f.store.getCache('centros:v1').value, value);
  assert.equal(f.store.getCache('clave con espacios'), null);
  assert.throws(() => f.store.setCache('clave con espacios', value), /Clave de caché inválida/);
});

test('outbox rejects unknown types, malformed ids, arrays and oversized payloads', t => {
  const f = fixture(t);
  assert.throws(() => f.store.addEvent({actor_id:1,event_id:'x',type:'acta',payload:{}}), /Identificador/);
  assert.throws(() => f.store.addEvent({actor_id:1,type:'borrar',payload:{}}), /Tipo de operación/);
  assert.throws(() => f.store.addEvent({actor_id:1,type:'acta',payload:[]}), /Datos de operación/);
  assert.throws(() => f.store.addEvent({type:'acta',payload:{text:'x'.repeat(21000)}}), /supera el tamaño/);
});

test('outbox binds each operation to its creator and persists active user', t => {
  const f = fixture(t);
  f.store.setActiveUserId(7);
  assert.equal(f.store.getActiveUserId(), 7);
  const id = 'evt_owner_123456789012';
  f.store.addEvent({actor_id:7,event_id:id,type:'acta',payload:{centro_codigo:'C01',mesa:'1',votos_partido:5}});
  assert.equal(f.store.listSyncableEvents(7).length, 1);
  assert.equal(f.store.listSyncableEvents(8).length, 0);
  assert.throws(() => f.store.addEvent({actor_id:8,event_id:id,type:'acta',payload:{centro_codigo:'C01',mesa:'1',votos_partido:5}}), /datos distintos/);
  f.store.setActiveUserId(null);
  assert.equal(f.store.getActiveUserId(), null);
});
