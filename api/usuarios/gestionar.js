const {parseBody,turso,rowsFrom,verifyHash,modernHash,verify,getCookie}=require('../../lib/auth');

module.exports=async function(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const session=verify(getCookie(req,'erp_session'));
  if(!session) return res.status(401).json({error:'Sesión requerida'});
  const actor=rowsFrom(await turso([{q:'SELECT id,usuario,rol,activo FROM usuarios WHERE id=? AND activo=1 LIMIT 1',params:[session.uid]}]))[0];
  if(!actor || actor.usuario!==session.usuario || !['J','A'].includes(actor.rol)) return res.status(403).json({error:'Se requiere Jefe o Administrador activo'});
  const b=parseBody(req), action=String(b.action||'');
  try{
    if(action==='save'){
      const id=Number(b.id||0), usuario=String(b.usuario||'').trim(), nombre=String(b.nombre||'').trim();
      const rol=String(b.rol||'').trim(), cargo=String(b.cargo||'').trim(), telefono=b.telefono?String(b.telefono):null, clave=String(b.clave||'');
      if(!usuario||!nombre||!['J','A','O'].includes(rol)) return res.status(400).json({error:'Datos de usuario inválidos'});
      if(id){
        if(clave){
          await turso([{q:'UPDATE usuarios SET nombre=?,rol=?,cargo=?,telefono=?,clave_hash=? WHERE id=?',params:[nombre,rol,cargo,telefono,modernHash(clave),id]}]);
        }else{
          await turso([{q:'UPDATE usuarios SET nombre=?,rol=?,cargo=?,telefono=? WHERE id=?',params:[nombre,rol,cargo,telefono,id]}]);
        }
      }else{
        if(!clave) return res.status(400).json({error:'La clave es obligatoria al crear'});
        await turso([{q:'INSERT INTO usuarios(usuario,clave_hash,nombre,rol,cargo,telefono) VALUES(?,?,?,?,?,?)',params:[usuario,modernHash(clave),nombre,rol,cargo,telefono]}]);
      }
      return res.json({ok:true});
    }
    if(action==='toggle'){
      const id=Number(b.id), activo=Number(b.activo)?1:0;
      if(!id) return res.status(400).json({error:'Usuario inválido'});
      await turso([{q:'UPDATE usuarios SET activo=? WHERE id=?',params:[activo,id]}]);
      return res.json({ok:true});
    }
    if(action==='delete'){
      const id=Number(b.id);
      if(!id || id===actor.id) return res.status(400).json({error:'No puede eliminar este usuario'});
      const target=rowsFrom(await turso([{q:'SELECT id,usuario,rol FROM usuarios WHERE id=? LIMIT 1',params:[id]}]))[0];
      if(!target) return res.status(404).json({error:'Usuario no encontrado'});
      const counts=rowsFrom(await turso([{q:"SELECT rol,COUNT(*) n FROM usuarios WHERE activo=1 GROUP BY rol",params:[]}]));
      const nJ=Number(counts.find(x=>x.rol==='J')?.n||0), nA=Number(counts.find(x=>x.rol==='A')?.n||0);
      if(target.rol==='J' && nJ<=1) return res.status(409).json({error:'No puede eliminar el último Jefe de Comando'});
      if(target.rol==='A' && nA<=1 && nJ<=1) return res.status(409).json({error:'No puede eliminar el último Administrador'});
      await turso([{q:'DELETE FROM usuarios WHERE id=?',params:[id]}]);
      return res.json({ok:true});
    }
    return res.status(400).json({error:'Acción no permitida'});
  }catch(e){
    console.error('usuarios:',e);
    return res.status(500).json({error:e.message||'No se pudo modificar el usuario'});
  }
};