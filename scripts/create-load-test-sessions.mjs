#!/usr/bin/env node
/*
  Creates one real erp_session cookie per virtual user.
  By default it logs in repeatedly with LOAD_TEST_USER/PASSWORD/ROLE.
  For distinct identities, optionally provide LOAD_TEST_USERS_JSON as a
  JSON array of {usuario, clave, rol}; users are selected round-robin.
*/
const fs = require('fs');

const BASE_URL=String(process.env.BASE_URL||'').replace(/\/$/,'');
const USERS=Math.max(1,Number(process.env.USERS||400));
const OUT=process.env.SESSION_COOKIES_FILE||'load-test-sessions.json';
const single={
  usuario:String(process.env.LOGIN_USER||'').trim(),
  clave:String(process.env.LOGIN_PASSWORD||''),
  rol:String(process.env.LOGIN_ROLE||'').trim()
};

if(!BASE_URL) throw new Error('BASE_URL requerido');
let pool=[single];
if(process.env.LOAD_TEST_USERS_JSON){
  pool=JSON.parse(process.env.LOAD_TEST_USERS_JSON);
  if(!Array.isArray(pool)||!pool.length) throw new Error('LOAD_TEST_USERS_JSON debe ser un arreglo no vacío');
}
for(const u of pool){
  if(!u?.usuario||!u?.clave||!['J','A','O'].includes(String(u.rol||'').toUpperCase())){
    throw new Error('Credencial inválida en LOAD_TEST_USERS_JSON');
  }
}

async function login(credentials){
  const r=await fetch(BASE_URL+'/api/auth/login',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({
      usuario:credentials.usuario,
      clave:credentials.clave,
      rol:String(credentials.rol).toUpperCase()
    })
  });
  const setCookie=r.headers.get('set-cookie')||'';
  if(!r.ok){
    const body=await r.text();
    throw new Error('LOGIN_HTTP_STATUS='+r.status+' RESPONSE='+body.slice(0,300));
  }
  const m=setCookie.match(/(?:^|,\s*)(erp_session=[^;,]+)/);
  if(!m) throw new Error('LOGIN_COOKIE_NOT_FOUND');
  return m[1];
}

(async()=>{
  const cookies=[];
  for(let i=0;i<USERS;i++){
    cookies.push(await login(pool[i%pool.length]));
    if(i<USERS-1) await new Promise(r=>setTimeout(r,5));
    if((i+1)%25===0) console.log('sessions_created='+String(i+1));
  }
  fs.writeFileSync(OUT,JSON.stringify(cookies),'utf8');
  console.log(JSON.stringify({users:USERS,sessions:cookies.length,output:OUT}));
})().catch(e=>{console.error(e.message||e);process.exit(1)});
