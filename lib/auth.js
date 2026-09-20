const crypto = require('crypto');

function dbUrl() {
  const raw = String(process.env.TURSO_URL || '').trim();
  if (!raw) throw new Error('TURSO_URL no configurado');
  return raw.startsWith('libsql://') ? raw.replace('libsql://','https://')
    : (/^https?:\/\//.test(raw) ? raw : 'https://' + raw);
}
function parseBody(req) {
  let body=req.body||{};
  if(typeof body==='string'){ try{body=JSON.parse(body)}catch(e){body={}} }
  return body||{};
}
async function turso(statements){
  const token=process.env.TURSO_TOKEN;
  if(!token) throw new Error('TURSO_TOKEN no configurado');
  const r=await fetch(dbUrl(),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({statements})});
  if(!r.ok) throw new Error('Turso HTTP '+r.status+': '+await r.text());
  const data=await r.json();
  if(data.error) throw new Error(data.error.message||'Turso error');
  return data;
}
function rowsFrom(data){
  const list=Array.isArray(data)?data:(data.statements||[]);
  return list.map(x=>{
    const rr=x.results||x, cols=rr.columns||[], rows=rr.rows||[];
    return rows.map(row=>Object.fromEntries(cols.map((c,i)=>[c,row[i]])));
  }).flat();
}
function legacyHash(password){
  return crypto.createHash('sha256').update('c1x10_v1_'+password,'utf8').digest('hex');
}
function modernHash(password){
  const salt=crypto.randomBytes(16).toString('base64url');
  const derived=crypto.pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url');
  return 'pbkdf2$210000$'+salt+'$'+derived;
}
function verifyHash(password, stored){
  if(!stored) return false;
  if(stored.startsWith('pbkdf2$')){
    const [,iters,salt,expected]=stored.split('$');
    const actual=crypto.pbkdf2Sync(password,salt,Number(iters),32,'sha256').toString('base64url');
    return crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
  }
  const actual=legacyHash(password);
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(stored,'hex'));
}
function sign(payload){
  const secret=process.env.SESSION_SECRET;
  if(!secret) throw new Error('SESSION_SECRET no configurado');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return body+'.'+sig;
}
function verify(token){
  const secret=process.env.SESSION_SECRET;
  if(!secret||!token) return null;
  const [body,sig]=String(token).split('.');
  if(!body||!sig) return null;
  const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
  try{
    const p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(!p.exp||p.exp<Date.now()) return null;
    return p;
  }catch(e){return null}
}
function cookieOptions(maxAge){
  return 'HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age='+maxAge;
}
function getCookie(req,name){
  const raw=String(req.headers.cookie||'');
  const part=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return part ? decodeURIComponent(part.slice(name.length+1)) : '';
}
function publicUser(row){
  return {id:row.id,usuario:row.usuario,nombre:row.nombre,rol:row.rol,cargo:row.cargo,telefono:row.telefono,activo:row.activo};
}
module.exports={parseBody,turso,rowsFrom,verifyHash,modernHash,sign,verify,cookieOptions,getCookie,publicUser};
