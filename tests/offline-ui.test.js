const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('offline fallback inline script parses and exposes supported forms and read-only cache',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../electron/offline.html'),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1,'expected one inline script in offline fallback');
  assert.doesNotThrow(()=>new vm.Script(scripts[0][1]));
  for(const id of ['verification','acta','mesaControl','mesaObservacion','mesaCierre','sync','cachedQueries','cachedDetail','refreshCached']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.doesNotMatch(html,/maxlength="80><label/);
  assert.match(html,/Datos consultados anteriormente/);
  assert.match(html,/solo lectura/i);
});

test('offline mesa forms enqueue only the supported generic mesa action type',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../electron/offline.html'),'utf8');
  assert.match(html,/type:'mesa',payload:\{accion:'control'/);
  assert.match(html,/type:'mesa',payload:\{accion:'observacion'/);
  assert.match(html,/type:'mesa',payload:\{accion:'cerrar'/);
});
