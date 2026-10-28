const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../electron/sqlite-store');
const Database = require('better-sqlite3');

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
  assert.throws(() => f.store.addEvent({actor_id:1,event_id:id,type:'acta',payload:{centro_codigo:'C02',mesa:'2',votos_partido:99}}), /datos distintos/);
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
  assert.throws(() => f.store.addEvent({actor_id:1,type:'acta',payload:{text:'x'.repeat(21000)}}), /supera el tamaño/);
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

test('legacy queue entries without an owner become conflicts and are never auto-synced', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-gestion-legacy-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, {recursive:true});
  const db = new Database(path.join(dataDir, 'sistema-gestion.sqlite'));
  db.exec(`CREATE TABLE desktop_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK(event_type IN ('verificacion','acta')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','synced','conflict','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_error TEXT
  )`);
  db.prepare("INSERT INTO desktop_outbox(event_id,event_type,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run('evt_legacy_1234567890','acta',JSON.stringify({centro_codigo:'C01',mesa:'1',votos_partido:3}),'pending','2026-01-01','2026-01-01');
  db.close();
  const store = openStore(dir);
  t.after(() => { try { store.close(); } catch (_) {} fs.rmSync(dir,{recursive:true,force:true}); });
  const row = store.listEvents()[0];
  assert.equal(row.status,'conflict');
  assert.match(row.last_error,/sin usuario propietario/);
  assert.equal(store.listSyncableEvents(1).length,0);
  store.addEvent({actor_id:1,event_id:'evt_legacy_mesa_001',type:'mesa',payload:{accion:'control',centro_codigo:'C01',mesa:'1'}});
  assert.equal(store.listSyncableEvents(1).length,1);
});

test('clearCache removes cached records on logout without deleting queued operations', t => {
  const f = fixture(t);
  f.store.setActiveUserId(7);
  f.store.setCache('padron:v1', [{cedula:'12345678'}]);
  f.store.addEvent({actor_id:7,event_id:'evt_logout_queue_001',type:'acta',payload:{centro_codigo:'C01',mesa:'1',votos_partido:4}});
  assert.notEqual(f.store.getCache('padron:v1'), null);
  assert.equal(f.store.pendingCount(), 1);
  assert.equal(f.store.clearCache(), true);
  assert.equal(f.store.getCache('padron:v1'), null);
  assert.equal(f.store.pendingCount(), 1);
});

test('SQLite cache stores and retrieves a large padrón snapshot without truncation', t => {
  const f = fixture(t);
  const padron = Array.from({length:10000},(_,i)=>({
    cedula:String(10000000+i),
    nombre:'Elector de prueba '+i,
    centro_codigo:'C'+String((i%250)+1).padStart(3,'0'),
    mesa:String((i%25)+1)
  }));
  f.store.setCache('padron:large:v1',padron);
  const restored=f.store.getCache('padron:large:v1').value;
  assert.equal(restored.length,10000);
  assert.deepEqual(restored[0],padron[0]);
  assert.deepEqual(restored[9999],padron[9999]);
});

test('listCache exposes query metadata and row counts without exposing cached payloads', t => {
  const f=fixture(t);
  f.store.setActiveUserId(7);
  f.store.setCache('sqlcache:centros:v1',{
    array:true,
    value:[{results:{columns:['codigo'],rows:[['C01'],['C02']]}}],
    query:[{q:'SELECT codigo FROM centros',params:[]}]
  });
  const entries=f.store.listCache();
  assert.equal(entries.length,1);
  assert.deepEqual(entries[0].query,['SELECT codigo FROM centros']);
  assert.equal(entries[0].rowCount,2);
  assert.equal(Object.prototype.hasOwnProperty.call(entries[0],'value'),false);
});
