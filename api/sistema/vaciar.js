const {parseBody,turso,rowsFrom,verify,getCookie,modernHash}=require('../../lib/auth');
module.exports=async(req,res)=>{
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const se=verify(getCookie(req,'erp_session')); if(!se||!['J','A'].includes(se.rol))return res.status(403).json({error:'Se requiere autorización J/A'});
 const b=parseBody(req); if(String(b.confirm||'')!=='VACIAR_SISTEMA')return res.status(400).json({error:'Confirmación requerida'});
 try{
  const tables=['comite_problemas','verificaciones_votacion','actas_mesa','comite_vecinal','direccion_ejecutiva','centro_cargos','asignaciones','reclutadores','actividad','padron','centros'];
  for(const t of tables)await turso([{q:'DELETE FROM '+t}]);
  await turso([{q:'DELETE FROM usuarios WHERE usuario != ?',params:['admin@comando.com']}]);
  let u=rowsFrom(await turso([{q:'SELECT id FROM usuarios WHERE usuario=? LIMIT 1',params:['admin@comando.com']}]))[0];
  if(!u){await turso([{q:'INSERT INTO usuarios(usuario,clave_hash,nombre,rol,cargo) VALUES(?,?,?,?,?)',params:['admin@comando.com',modernHash('admin123'),'Administrador del Sistema','A','Administrador']}]);}
  const seeds=[['jefe','jefe123','Gualberto Martinez','J','Jefe de Comando'],['operador','operador123','Pedro Rivas','O','Operador de Sala'],['cdiaz','operador123','Carmen Díaz','O','Operadora Territorial']];
  for(const [u0,p,n,r,c] of seeds)await turso([{q:'INSERT OR IGNORE INTO usuarios(usuario,clave_hash,nombre,rol,cargo) VALUES(?,?,?,?,?)',params:[u0,modernHash(p),n,r,c]}]);
  await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['sys','Sistema reiniciado por usuario #'+se.uid,se.uid]}]);
  return res.json({ok:true});
 }catch(e){console.error(e);return res.status(500).json({error:e.message||'No se pudo reiniciar el sistema'});}
};