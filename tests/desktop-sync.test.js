const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const authPath = require.resolve('../lib/auth');
const apiPath = require.resolve('../api/desktop-sync');

function loadHandler({ session = { uid:5, usuario:'admin', rol:'A' }, queryResults = {} } = {}) {
  const authModule = require(authPath);
  const originalAuth = require.cache[authPath];
  const originalApi = require.cache[apiPath];
  const queries = [];
  const fakeAuth = {
    parseBody: req => req.body,
    turso: async statements => {
      for (const statement of statements) {
        queries.push(statement.q);
        if (statement.q.startsWith('SELECT id,usuario,rol,activo FROM usuarios')) {
          return [{ id:5, usuario:'admin', rol:'A', activo:1 }];
        }
        const prefix=Object.keys(queryResults).find(key=>statement.q.startsWith(key));
        if(prefix) return queryResults[prefix];
      }
      return [];
    },
    rowsFrom: result => result,
    verify: () => session,
    getCookie: () => 'signed-session'
  };
  require.cache[authPath] = { id:authPath, filename:authPath, loaded:true, exports:fakeAuth };
  delete require.cache[apiPath];
  const handler = require(apiPath);
  return {
    handler,
    queries,
    restore() {
      if (originalAuth) require.cache[authPath] = originalAuth;
      else delete require.cache[authPath];
      if (originalApi) require.cache[apiPath] = originalApi;
      else delete require.cache[apiPath];
    }
  };
}

function responseRecorder() {
  return {
    code:200, headers:{}, body:null,
    setHeader(key,value) { this.headers[key]=value; },
    status(code) { this.code=code; return this; },
    json(body) { this.body=body; return this; },
    end() { return this; }
  };
}

test('desktop sync rejects a queued event owned by a different authenticated user before applying it', async t => {
  const h = loadHandler();
  t.after(h.restore);
  const res = responseRecorder();
  await h.handler({
    method:'POST',
    body:{events:[{
      event_id:'evt_owner_123456789012',
      actor_id:99,
      type:'mesa',
      payload:{accion:'control',centro_codigo:'C01',mesa:'1',constituida:'SI',hora_constitucion:'08:00',testigos_asistieron:'SI'}
    }]}
  },res);
  assert.equal(res.code,200);
  assert.equal(res.body.ok,true);
  assert.equal(res.body.results.length,1);
  assert.equal(res.body.results[0].status,'conflict');
  assert.match(res.body.results[0].error,/no coincide con la sesión autenticada/);
  assert.equal(h.queries.some(q => /^INSERT\b|^UPDATE\b/i.test(q.trim())),false);
});

test('desktop sync rejects expired sessions before accessing the database', async t => {
  const h = loadHandler({session:null});
  t.after(h.restore);
  const res = responseRecorder();
  await h.handler({method:'POST',body:{events:[{event_id:'evt_owner_123456789012',actor_id:5,type:'acta',payload:{}}]}},res);
  assert.equal(res.code,401);
  assert.equal(res.body.ok,false);
  assert.equal(h.queries.length,0);
});

test('desktop sync rejects non-POST requests without touching the database', async t => {
  const h = loadHandler();
  t.after(h.restore);
  const res = responseRecorder();
  await h.handler({method:'GET'},res);
  assert.equal(res.code,405);
  assert.equal(h.queries.length,0);
});

test('desktop sync applies a validated offline table-control event', async t => {
  const h=loadHandler({queryResults:{
    'SELECT codigo,mesas FROM centros':[{codigo:'C01',mesas:20}],
    'SELECT id,estado,hora_constitucion,testigos_asistieron,hora_cierre,observacion FROM mesa_operativa':[],
    'SELECT id FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1':[{id:42}]
  }});
  t.after(h.restore);
  const res=responseRecorder();
  await h.handler({method:'POST',body:{events:[{
    event_id:'evt_mesa_control_123',
    actor_id:5,
    type:'mesa',
    payload:{accion:'control',centro_codigo:'C01',mesa:'2',constituida:'SI',hora_constitucion:'08:00',testigos_asistieron:'SI'}
  }]}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.results[0].status,'synced');
  assert.equal(res.body.results[0].result.mesa_id,42);
  assert.ok(h.queries.some(q=>q.startsWith('INSERT INTO mesa_operativa')));
});

test('desktop sync rejects table control without a constitution time', async t => {
  const h=loadHandler({queryResults:{
    'SELECT codigo,mesas FROM centros':[{codigo:'C01',mesas:20}],
    'SELECT id,estado,hora_constitucion,testigos_asistieron,hora_cierre,observacion FROM mesa_operativa':[]
  }});
  t.after(h.restore);
  const res=responseRecorder();
  await h.handler({method:'POST',body:{events:[{
    event_id:'evt_mesa_control_bad',
    actor_id:5,
    type:'mesa',
    payload:{accion:'control',centro_codigo:'C01',mesa:'2',constituida:'SI',hora_constitucion:'',testigos_asistieron:'NO'}
  }]}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.results[0].status,'conflict');
  assert.match(res.body.results[0].error,/hora de constitución/);
  assert.equal(h.queries.some(q=>q.startsWith('INSERT INTO mesa_operativa')),false);
});
