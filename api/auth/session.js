const {turso,rowsFrom,verify,getCookie,publicUser}=require('../../lib/auth');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  try{
    const p=verify(getCookie(req,'erp_session'));
    if(!p) return res.status(401).json({authenticated:false});
    const rows=rowsFrom(await turso([{q:'SELECT id,usuario,nombre,rol,cargo,telefono,activo FROM usuarios WHERE id=? AND activo=1 LIMIT 1',params:[p.uid]}]));
    if(!rows.length||rows[0].usuario!==p.usuario||rows[0].rol!==p.rol) return res.status(401).json({authenticated:false});
    return res.status(200).json({authenticated:true,user:publicUser(rows[0]),expires_at:new Date(p.exp).toISOString()});
  }catch(e){return res.status(500).json({error:e.message||'Error de sesión'});}
};
