const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');

module.exports=async function(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const s=verify(getCookie(req,'erp_session'));
  if(!s) return res.status(401).json({error:'Sesión requerida'});
  if(!['J','A','O'].includes(s.rol)) return res.status(403).json({error:'Rol no permitido'});
  const b=parseBody(req), action=String(b.action||''), codigo=String(b.codigo||'').trim();
  try{
    if(action==='actualizar_mesas'){
      const mesas=Number(b.mesas);
      if(!codigo||!Number.isInteger(mesas)||mesas<1||mesas>999) return res.status(400).json({error:'Cantidad de mesas inválida'});
      const cen=rowsFrom(await turso([{q:'SELECT codigo FROM centros WHERE codigo=? LIMIT 1',params:[codigo]}]))[0];
      if(!cen) return res.status(404).json({error:'Centro no encontrado'});
      await turso([{q:'UPDATE centros SET mesas=? WHERE codigo=?',params:[mesas,codigo]},{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Mesas actualizadas en centro '+codigo+' → '+mesas,s.uid]}]);
      return res.json({ok:true});
    }
    if(action==='eliminar_cargo'){
      const id=Number(b.id);
      if(!id) return res.status(400).json({error:'Cargo inválido'});
      const row=rowsFrom(await turso([{q:'SELECT id,centro_codigo,cargo,cedula FROM centro_cargos WHERE id=? LIMIT 1',params:[id]}]))[0];
      if(!row) return res.status(404).json({error:'Cargo no encontrado'});
      await turso([{q:'DELETE FROM centro_cargos WHERE id=?',params:[id]},{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user',row.cargo+' removido del centro '+row.centro_codigo+' • C.I. '+row.cedula,s.uid]}]);
      return res.json({ok:true});
    }
    return res.status(400).json({error:'Acción no permitida'});
  }catch(e){ console.error('centros:',e); return res.status(500).json({error:e.message||'No se pudo modificar el centro'}); }
};
