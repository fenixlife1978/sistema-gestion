const {turso,rowsFrom,verify,getCookie}=require('../lib/auth');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.setHeader('X-Content-Type-Options','nosniff');

  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});

  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return res.status(401).json({authenticated:false});

    const user=rowsFrom(await turso([{
      q:'SELECT id,usuario,nombre,rol,activo FROM usuarios WHERE id=? AND activo=1 LIMIT 1',
      params:[session.uid]
    }]))[0];
    if(!user || user.usuario!==session.usuario || user.rol!==session.rol){
      return res.status(401).json({authenticated:false});
    }

    const rows=rowsFrom(await turso([{
      q:'SELECT COALESCE(MAX(id),0) AS latest_id FROM actividad',
      params:[]
    }]));
    const latestId=Number(rows[0]?.latest_id||0);
    const since=Math.max(0,Number(req.query?.since||0));

    return res.status(200).json({
      ok:true,
      changed: latestId>since,
      latest_id: latestId,
      server_time:new Date().toISOString()
    });
  }catch(e){
    console.error('[api-sync] failed:',e);
    return res.status(500).json({ok:false,error:e.message||'No se pudo consultar la sincronización'});
  }
};
