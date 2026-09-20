const {parseBody,turso,rowsFrom,verify,getCookie}=require('../lib/auth');

const st=(v,n)=>String(v??'').trim().slice(0,n);
const fail=(res,c,e)=>res.status(c).json({error:e});

module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return fail(res,405,'Method not allowed');

  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return fail(res,401,'Sesión no válida o expirada');
    if(!['J','A','O'].includes(session.rol)) return fail(res,403,'Rol de sesión no permitido');

    const b=parseBody(req);
    const centro=st(b.centro_codigo,80);
    const mesa=st(b.mesa,30);
    const votos=Number(b.votos_partido);

    if(!centro||!/^[0-9]{1,4}$/.test(mesa)||!Number.isInteger(votos)||votos<0)
      return fail(res,400,'Centro, mesa y cantidad de votos son inválidos');

    const pre=await turso([
      {q:'SELECT codigo,nombre,mesas FROM centros WHERE codigo=? LIMIT 1',params:[centro]},
      {q:'SELECT estado FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]},
      {q:'SELECT id,votos_partido FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}
    ]);
    const c=rowsFrom(pre[0] || {})[0];
    if(!c) return fail(res,404,'Centro electoral no encontrado');

    const maxMesas=Number(c.mesas||0);
    const nMesa=Number(mesa);
    const mesaEstado=rowsFrom(pre[1] || {})[0];
    if(mesaEstado?.estado==='CERRADA') return fail(res,409,'La mesa está cerrada; no se pueden modificar sus resultados');
    if(maxMesas>0&&(nMesa<1||nMesa>maxMesas))
      return fail(res,409,'La mesa indicada no pertenece al centro seleccionado');

    const existente=rowsFrom(pre[2] || {});

    const now=new Date().toISOString();
    if(existente.length){
      await turso([
        {q:'UPDATE actas_mesa SET votos_partido=?,cantidad_acta=?,actualizado_en=?,actualizado_por=? WHERE id=?',params:[votos,votos,now,session.uid,existente[0].id]},
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['acta','Acta CNE actualizada: votos del partido • Centro '+centro+' • Mesa '+mesa+' • '+votos,session.uid]}
      ]);
      return res.status(200).json({ok:true,accion:'actualizada',id:existente[0].id,centro_codigo:centro,mesa,votos_partido:votos});
    }

    try{
      await turso([{
        q:'INSERT INTO actas_mesa(centro_codigo,mesa,cantidad_acta,votos_partido,actualizado_en,actualizado_por) VALUES(?,?,?,?,?,?)',
        params:[centro,mesa,votos,votos,now,session.uid]
      }]);
    }catch(e){
      const race=rowsFrom(await turso([{q:'SELECT id FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]));
      if(race.length) return fail(res,409,'El acta de esta mesa ya fue registrada; vuelva a consultar antes de modificarla');
      throw e;
    }

    const post=await turso([
      {q:'SELECT id FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]},
      {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['acta','Acta CNE registrada: votos del partido • Centro '+centro+' • Mesa '+mesa+' • '+votos,session.uid]}
    ]);
    const inserted=rowsFrom(post[0] || {});

    return res.status(201).json({ok:true,accion:'registrada',id:inserted[0]?.id||null,centro_codigo:centro,mesa,votos_partido:votos});
  }catch(e){
    return fail(res,500,e.message||'No se pudo guardar el acta');
  }
};
