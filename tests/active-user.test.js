const test=require('node:test');
const assert=require('node:assert/strict');
const {bindActiveUser}=require('../electron/active-user');

function fakeStore(initialUser=1){
  return {
    activeUser:initialUser,
    cacheClears:0,
    getActiveUserId(){return this.activeUser;},
    setActiveUserId(id){this.activeUser=id;return id;},
    clearCache(){this.cacheClears++;return true;}
  };
}

test('same authenticated user keeps their cache and restores the active marker',async()=>{
  const store=fakeStore(7);
  const result=await bindActiveUser({store,userId:7,isOnline:()=>true,verifyRemoteUser:async()=>({id:7})});
  assert.equal(result,7);
  assert.equal(store.activeUser,7);
  assert.equal(store.cacheClears,0);
});

test('switching accounts clears the previous account cache before binding the new user',async()=>{
  const store=fakeStore(7);
  const result=await bindActiveUser({store,userId:8,isOnline:()=>true,verifyRemoteUser:async()=>({id:8})});
  assert.equal(result,8);
  assert.equal(store.activeUser,8);
  assert.equal(store.cacheClears,1);
});

test('failed account verification never leaves the previous owner active',async()=>{
  const store=fakeStore(7);
  await assert.rejects(()=>bindActiveUser({store,userId:8,isOnline:()=>true,verifyRemoteUser:async()=>({id:7})}),/no confirmó/);
  assert.equal(store.activeUser,null);
  assert.equal(store.cacheClears,1);
});

test('offline account switch clears stale ownership and fails closed',async()=>{
  const store=fakeStore(7);
  await assert.rejects(()=>bindActiveUser({store,userId:8,isOnline:()=>false,verifyRemoteUser:async()=>({id:8})}),/conexión/);
  assert.equal(store.activeUser,null);
  assert.equal(store.cacheClears,1);
});

test('logout clears only the active owner marker; cache clearing is handled by logout flow',async()=>{
  const store=fakeStore(7);
  assert.equal(await bindActiveUser({store,userId:null,isOnline:()=>false,verifyRemoteUser:async()=>null}),null);
  assert.equal(store.activeUser,null);
  assert.equal(store.cacheClears,0);
});
