const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../electron/sqlite-store');
const { createSyncEngine } = require('../electron/sync-engine');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-gestion-sync-'));
  const store = openStore(dir);
  t.after(() => {
    try { store.close(); } catch (_) {}
    fs.rmSync(dir, {recursive:true,force:true});
  });
  return store;
}

function addEvent(store, actor_id, event_id) {
  return store.addEvent({
    actor_id,
    event_id,
    type:'acta',
    payload:{centro_codigo:'C01',mesa:'1',votos_partido:10}
  });
}

function response(ok, data) {
  return {ok,json:async()=>data};
}

test('offline connection keeps events pending and never calls the server', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_offline_001');
  let calls=0;
  const sync=createSyncEngine({
    store,isOnline:()=>false,
    getCookieHeader:async()=> 'erp_session=valid',
    postSync:async()=>{calls++;return response(true,{results:[]});}
  });
  const result=await sync();
  assert.equal(result.ok,false);
  assert.equal(calls,0);
  assert.equal(store.pendingCount(),1);
});

test('missing session cookie keeps the owner queue pending', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_cookie_001');
  let calls=0;
  const sync=createSyncEngine({
    store,isOnline:()=>true,
    getCookieHeader:async()=>null,
    postSync:async()=>{calls++;return response(true,{results:[]});}
  });
  const result=await sync();
  assert.equal(result.ok,false);
  assert.match(result.message,/sesión/);
  assert.equal(calls,0);
  assert.equal(store.pendingCount(),1);
});

test('successful sync sends only the active user events and preserves other users queue', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_user7_001');
  addEvent(store,8,'evt_sync_user8_001');
  let sent=[];
  const sync=createSyncEngine({
    store,isOnline:()=>true,
    getCookieHeader:async()=> 'erp_session=valid',
    postSync:async({cookieHeader,events})=>{
      assert.equal(cookieHeader,'erp_session=valid');
      sent=events;
      return response(true,{results:events.map(e=>({event_id:e.event_id,status:'synced'}))});
    }
  });
  const result=await sync();
  assert.equal(result.ok,true);
  assert.deepEqual(sent.map(e=>e.actor_id),[7]);
  assert.equal(store.listSyncableEvents(7).length,0);
  assert.equal(store.listSyncableEvents(8).length,1);
  assert.equal(store.pendingCount(),1);
});

test('server conflicts are retained and excluded from automatic retries', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_conflict_01');
  const sync=createSyncEngine({
    store,isOnline:()=>true,
    getCookieHeader:async()=> 'erp_session=valid',
    postSync:async({events})=>response(true,{results:[{event_id:events[0].event_id,status:'conflict',error:'Propietario distinto'}]})
  });
  const result=await sync();
  assert.equal(result.ok,true);
  assert.equal(store.listSyncableEvents(7).length,0);
  assert.equal(store.queueSummary().conflict,1);
  assert.equal(store.queueSummary().totalUnresolved,1);
});

test('HTTP rejection leaves events pending for a later authenticated retry', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_401_001');
  const sync=createSyncEngine({
    store,isOnline:()=>true,
    getCookieHeader:async()=> 'erp_session=expired',
    postSync:async()=>response(false,{error:'Sesión vencida'})
  });
  const result=await sync();
  assert.equal(result.ok,false);
  assert.match(result.message,/Sesión vencida/);
  assert.equal(store.pendingCount(),1);
  assert.equal(store.listSyncableEvents(7)[0].status,'pending');
});

test('concurrent sync calls do not send the same batch twice', async t => {
  const store=fixture(t);
  store.setActiveUserId(7);
  addEvent(store,7,'evt_sync_race_001');
  let calls=0, signalStarted, releasePost;
  const started=new Promise(resolve=>{signalStarted=resolve;});
  const gate=new Promise(resolve=>{releasePost=resolve;});
  const sync=createSyncEngine({
    store,isOnline:()=>true,
    getCookieHeader:async()=> 'erp_session=valid',
    postSync:async({events})=>{
      calls++;
      signalStarted();
      await gate;
      return response(true,{results:events.map(e=>({event_id:e.event_id,status:'synced'}))});
    }
  });
  const first=sync();
  await started;
  const second=await sync();
  assert.equal(second.ok,false);
  assert.equal(calls,1);
  releasePost();
  assert.equal((await first).ok,true);
  assert.equal(store.pendingCount(),0);
});
