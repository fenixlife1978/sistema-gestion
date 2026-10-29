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
      actor_id INTEGER,
      event_type TEXT NOT NULL CHECK(event_type IN ('verificacion','acta','mesa')),
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
  // Migración compatible con instalaciones que ya tienen una cola SQLite creada.
  const columns = db.prepare('PRAGMA table_info(desktop_outbox)').all().map(c => c.name);
  if (!columns.includes('actor_id')) db.exec('ALTER TABLE desktop_outbox ADD COLUMN actor_id INTEGER');
  db.prepare("UPDATE desktop_outbox SET status='conflict',last_error='Operación antigua sin usuario propietario; requiere revisión antes de sincronizar',updated_at=? WHERE actor_id IS NULL AND status IN ('pending','failed','syncing')").run(new Date().toISOString());
  const outboxSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='desktop_outbox'").get()?.sql || '';
  if (!outboxSql.includes("'mesa'")) {
    db.exec(`
      CREATE TABLE desktop_outbox_next (
        event_id TEXT PRIMARY KEY,
        actor_id INTEGER,
        event_type TEXT NOT NULL CHECK(event_type IN ('verificacion','acta','mesa')),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','synced','conflict','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      INSERT INTO desktop_outbox_next(event_id,actor_id,event_type,payload_json,status,attempts,created_at,updated_at,last_error)
        SELECT event_id,actor_id,event_type,payload_json,status,attempts,created_at,updated_at,last_error FROM desktop_outbox;
      DROP TABLE desktop_outbox;
      ALTER TABLE desktop_outbox_next RENAME TO desktop_outbox;
      CREATE INDEX IF NOT EXISTS idx_desktop_outbox_pending ON desktop_outbox(status,created_at);
    `);
  }
  const now = () => new Date().toISOString();
  const add = db.prepare(`INSERT OR IGNORE INTO desktop_outbox
    (event_id,actor_id,event_type,payload_json,status,created_at,updated_at)
    VALUES(@event_id,@actor_id,@event_type,@payload_json,'pending',@now,@now)`);
  const getEventById = db.prepare('SELECT event_id,actor_id,event_type,payload_json,status FROM desktop_outbox WHERE event_id=?');
  const list = db.prepare(`SELECT event_id,actor_id,event_type,payload_json,status,attempts,created_at,last_error
    FROM desktop_outbox WHERE status IN ('pending','failed','conflict') ORDER BY created_at,rowid LIMIT 500`);
  const listSyncable = db.prepare(`SELECT event_id,actor_id,event_type,payload_json,status,attempts,created_at,last_error
    FROM desktop_outbox WHERE status IN ('pending','failed') AND actor_id=? ORDER BY created_at,rowid LIMIT 25`);
  const update = db.prepare(`UPDATE desktop_outbox SET status=@status,attempts=attempts+@attempt,
    updated_at=@now,last_error=@error WHERE event_id=@id`);
  return {
    addEvent(event) {
      const actor_id = Number(event.actor_id);
      if (!Number.isSafeInteger(actor_id) || actor_id < 1) throw new Error('Debe existir un usuario propietario para guardar la operación offline');
      const event_id = String(event.event_id || crypto.randomUUID());
      if (!/^[a-zA-Z0-9_-]{12,100}$/.test(event_id)) throw new Error('Identificador de operación inválido');
      const event_type = String(event.type || '');
      if (!['verificacion','acta','mesa'].includes(event_type)) throw new Error('Tipo de operación no permitido para sincronización');
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Datos de operación inválidos');
      const payload_json = JSON.stringify(event.payload);
      if (payload_json.length > 20000) throw new Error('La operación supera el tamaño permitido');
      const inserted = add.run({ event_id, actor_id, event_type, payload_json, now: now() });
      const stored = getEventById.get(event_id);
      if (!stored || Number(stored.actor_id) !== actor_id || stored.event_type !== event_type || stored.payload_json !== payload_json) {
        throw new Error('El identificador ya existe con datos distintos; no se sobrescribió la operación original');
      }
      return { event_id, queued: true, duplicate: inserted.changes === 0 };
    },
    listEvents() {
      return list.all().map(row => ({...row, payload: JSON.parse(row.payload_json)}));
    },
    listSyncableEvents(actorId) {
      const id = Number(actorId);
      if (!Number.isSafeInteger(id) || id < 1) return [];
      return listSyncable.all(id).map(row => ({...row, payload: JSON.parse(row.payload_json)}));
    },
    setActiveUserId(userId) {
      const id = userId === null || userId === undefined || userId === '' ? null : Number(userId);
      if (id !== null && (!Number.isSafeInteger(id) || id < 1)) throw new Error('Identificador de usuario inválido');
      if (id === null) db.prepare("DELETE FROM desktop_meta WHERE meta_key='active_user_id'").run();
      else db.prepare("INSERT INTO desktop_meta(meta_key,meta_value,updated_at) VALUES('active_user_id',?,?) ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value,updated_at=excluded.updated_at").run(String(id),now());
      return id;
    },
    getActiveUserId() {
      const row = db.prepare("SELECT meta_value FROM desktop_meta WHERE meta_key='active_user_id'").get();
      const id = row ? Number(row.meta_value) : null;
      return Number.isSafeInteger(id) && id > 0 ? id : null;
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
    listCache() {
      return db.prepare('SELECT cache_key,value_json,updated_at FROM desktop_cache ORDER BY updated_at DESC LIMIT 100').all().map(row => {
        let cached;
        try { cached = JSON.parse(row.value_json); } catch (_) { cached = null; }
        const queries = Array.isArray(cached?.query) ? cached.query.map(q => String(q.q || '')).filter(Boolean) : [];
        const resultItems = Array.isArray(cached?.value) ? cached.value : [cached?.value];
        const rowCount = resultItems.reduce((sum,item) => sum + (Array.isArray(item?.results?.rows) ? item.results.rows.length : 0),0);
        return { key:row.cache_key, query:queries, updated_at:row.updated_at, rowCount };
      }).filter(item => item.query.length > 0);
    },
    clearCache() {
      db.prepare('DELETE FROM desktop_cache').run();
      return true;
    },
    close() { db.close(); }
  };
}
module.exports = { openStore };
