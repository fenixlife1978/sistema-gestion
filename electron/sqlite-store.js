const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function openStore(userDataPath) {
  const dir = path.join(userDataPath, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'sistema-gestion.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS desktop_outbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL CHECK(event_type IN ('verificacion','acta')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','synced','conflict','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_desktop_outbox_pending
      ON desktop_outbox(status, created_at);
    CREATE TABLE IF NOT EXISTS desktop_cache (
      cache_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS desktop_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = () => new Date().toISOString();
  const add = db.prepare(`INSERT OR IGNORE INTO desktop_outbox
    (event_id,event_type,payload_json,status,created_at,updated_at)
    VALUES(@event_id,@event_type,@payload_json,'pending',@now,@now)`);
  const getEventById = db.prepare('SELECT event_id,event_type,payload_json,status FROM desktop_outbox WHERE event_id=?');
  const list = db.prepare(`SELECT event_id,event_type,payload_json,status,attempts,created_at,last_error
    FROM desktop_outbox WHERE status IN ('pending','failed','conflict') ORDER BY created_at LIMIT 500`);
  const listSyncable = db.prepare(`SELECT event_id,event_type,payload_json,status,attempts,created_at,last_error
    FROM desktop_outbox WHERE status IN ('pending','failed') ORDER BY created_at LIMIT 25`);
  const update = db.prepare(`UPDATE desktop_outbox SET status=@status,attempts=attempts+@attempt,
    updated_at=@now,last_error=@error WHERE event_id=@id`);
  return {
    addEvent(event) {
      const event_id = String(event.event_id || crypto.randomUUID());
      if (!/^[a-zA-Z0-9_-]{12,100}$/.test(event_id)) throw new Error('Identificador de operación inválido');
      const event_type = String(event.type || '');
      if (!['verificacion','acta'].includes(event_type)) throw new Error('Tipo de operación no permitido para sincronización');
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Datos de operación inválidos');
      const payload_json = JSON.stringify(event.payload);
      if (payload_json.length > 20000) throw new Error('La operación supera el tamaño permitido');
      const inserted = add.run({ event_id, event_type, payload_json, now: now() });
      const stored = getEventById.get(event_id);
      if (!stored || stored.event_type !== event_type || stored.payload_json !== payload_json) {
        throw new Error('El identificador ya existe con datos distintos; no se sobrescribió la operación original');
      }
      return { event_id, queued: true, duplicate: inserted.changes === 0 };
    },
    listEvents() {
      return list.all().map(row => ({...row, payload: JSON.parse(row.payload_json)}));
    },
    listSyncableEvents() {
      return listSyncable.all().map(row => ({...row, payload: JSON.parse(row.payload_json)}));
    },
    setEventStatus(id, status, error = null) {
      if (!['pending','syncing','synced','conflict','failed'].includes(status)) throw new Error('Estado de sincronización inválido');
      update.run({ id, status, error: error ? String(error).slice(0,1000) : null, now: now(), attempt: status === 'synced' ? 0 : 1 });
    },
    pendingCount() {
      return db.prepare("SELECT COUNT(*) AS n FROM desktop_outbox WHERE status IN ('pending','failed')").get().n;
    },
    queueSummary() {
      const rows = db.prepare("SELECT status,COUNT(*) AS n FROM desktop_outbox WHERE status IN ('pending','failed','conflict','syncing') GROUP BY status").all();
      const summary = { pending:0, failed:0, conflict:0, syncing:0 };
      for (const row of rows) summary[row.status] = row.n;
      summary.toSync = summary.pending + summary.failed;
      summary.totalUnresolved = summary.toSync + summary.conflict + summary.syncing;
      return summary;
    },
    setCache(key, value) {
      if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(String(key))) throw new Error('Clave de caché inválida');
      db.prepare(`INSERT INTO desktop_cache(cache_key,value_json,updated_at) VALUES(?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .run(String(key), JSON.stringify(value), now());
      return true;
    },
    getCache(key) {
      if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(String(key))) return null;
      const row = db.prepare('SELECT value_json,updated_at FROM desktop_cache WHERE cache_key=?').get(String(key));
      return row ? { value: JSON.parse(row.value_json), updated_at: row.updated_at } : null;
    },
    clearCache() {
      db.prepare('DELETE FROM desktop_cache').run();
      return true;
    },
    close() { db.close(); }
  };
}
module.exports = { openStore };
