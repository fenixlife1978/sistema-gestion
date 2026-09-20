const {parseBody,turso,rowsFrom,verifyHash,modernHash,sign,cookieOptions,publicUser}=require('../../lib/auth');

async function ensureInitialized(req,res){
  const schema=rowsFrom(await turso([{q:"SELECT name FROM sqlite_master WHERE type='table' AND name='usuarios' LIMIT 1",params:[]}]));
  if(!schema.length){
    const bootstrap=require('../bootstrap');
    const originalMethod=req.method;
    req.method='POST';
    try{
      await bootstrap(req,res);
    } finally {
      req.method=originalMethod;
    }
    return true;
  }
  const count=rowsFrom(await turso([{q:'SELECT COUNT(*) AS n FROM usuarios',params:[]}]));
  if(Number(count[0]?.n||0)===0){
    const bootstrap=require('../bootstrap');
    const originalMethod=req.method;
    req.method='POST';
    try{
      await bootstrap(req,res);
    } finally {
      req.method=originalMethod;
    }
    return true;
  }
  return false;
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const body=parseBody(req);
    const usuario=String(body.usuario||'').trim();
    const clave=String(body.clave||'');
    const rol=String(body.rol||'').trim().toUpperCase();
    if(!usuario||!clave||!['J','A','O'].includes(rol)) return res.status(400).json({error:'Credenciales incompletas'});
    if(usuario.length>120||clave.length>512) return res.status(400).json({error:'Credenciales inválidas'});
    const initialized=await ensureInitialized(req,res);
    if(initialized && res.writableEnded) return;
    const rows=rowsFrom(await turso([{q:'SELECT id,usuario,clave_hash,nombre,rol,cargo,telefono,activo FROM usuarios WHERE usuario=? AND activo=1 LIMIT 1',params:[usuario]}]));
    if(!rows.length||!verifyHash(clave,String(rows[0].clave_hash||''))) return res.status(401).json({error:'Usuario o clave incorrectos'});
    const user=rows[0];
    const roleOk=(rol==='J'&&user.rol==='J')||(rol==='A'&&['J','A'].includes(user.rol))||(rol==='O'&&user.rol==='O');
    if(!roleOk) return res.status(403).json({error:'El rol seleccionado no corresponde al usuario'});
    if(!String(user.clave_hash||'').startsWith('pbkdf2$')){
      const upgraded=modernHash(clave);
      await turso([{q:'UPDATE usuarios SET clave_hash=? WHERE id=? AND clave_hash=?',params:[upgraded,user.id,user.clave_hash]}]);
    }
    const exp=Date.now()+8*60*60*1000;
    const token=sign({uid:user.id,usuario:user.usuario,rol:user.rol,exp});
    res.setHeader('Set-Cookie','erp_session='+encodeURIComponent(token)+'; '+cookieOptions(8*60*60));
    return res.status(200).json({ok:true,user:publicUser(user),expires_at:new Date(exp).toISOString()});
  }catch(e){
    return res.status(500).json({error:e.message||'Error de autenticación'});
  }
};
