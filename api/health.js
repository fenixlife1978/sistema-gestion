const {turso,rowsFrom}=require('../lib/auth');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const started=Date.now();
  try{
    const rows=rowsFrom(await turso([{q:'SELECT 1 AS ok',params:[]}]));
    if(Number(rows?.[0]?.ok)!==1) throw new Error('Database health check failed');
    return res.status(200).json({
      ok:true,
      database:true,
      latency_ms:Date.now()-started,
      timestamp:new Date().toISOString()
    });
  }catch(e){
    return res.status(503).json({
      ok:false,
      database:false,
      latency_ms:Date.now()-started,
      error:e.message||'Database unavailable'
    });
  }
};
