const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');

const ci=v=>String(v??'').replace(/\D/g,'').slice(0,20);
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
    const cedula=ci(b.cedula);
    const centro=st(b.centro_codigo,80);
    const mesa=st(b.mesa,30);

    if(!/^[0-9]{5,9}$/.test(cedula)||!centro||!mesa)
      return fail(res,400,'Cédula, centro y mesa son obligatorios');
    if(!/^\d{1,4}$/.test(mesa))
      return fail(res,400,'Número de mesa inválido');

    const centros=rowsFrom(await turso([{
      q:'SELECT codigo,nombre,mesas FROM centros WHERE codigo=? LIMIT 1',
      params:[centro]
    }]));
    const c=centros[0];
    if(!c) return fail(res,404,'Centro electoral no encontrado');

    const nMesa=Number(mesa);
    const maxMesas=Number(c.mesas||0);
    if(maxMesas>0 && (nMesa<1 || nMesa>maxMesas))
      return fail(res,409,'La mesa indicada no pertenece al centro seleccionado');

    const personas=rowsFrom(await turso([
      {q:'SELECT cedula FROM centro_cargos WHERE centro_codigo=? AND cedula=? LIMIT 1',params:[centro,cedula]},
      {q:'SELECT p.cedula FROM padron p WHERE p.cedula=? AND (p.centro_votacion=? OR p.nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']},
      {q:'SELECT a.cedula FROM asignaciones a JOIN padron p ON p.cedula=a.cedula WHERE a.cedula=? AND (p.centro_votacion=? OR p.nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']},
      {q:'SELECT r.cedula FROM reclutadores r JOIN padron p ON p.cedula=r.cedula WHERE r.cedula=? AND (p.centro_votacion=? OR p.nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']},
      {q:'SELECT d.cedula FROM direccion_ejecutiva d JOIN padron p ON p.cedula=d.cedula WHERE d.cedula=? AND (p.centro_votacion=? OR p.nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']},
      {q:'SELECT cv.cedula FROM comite_vecinal cv JOIN padron p ON p.cedula=cv.cedula WHERE cv.cedula=? AND (p.centro_votacion=? OR p.nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']}
    ]));
    if(!personas.length) return fail(res,409,'La persona no tiene un cargo o función registrada en este centro');

    const existing=rowsFrom(await turso([{
      q:'SELECT id,centro_codigo,mesa,estado FROM verificaciones_votacion WHERE cedula=? LIMIT 1',
      params:[cedula]
    }]));

    if(existing.length){
      const v=existing[0];
      await turso([{
        q:'UPDATE verificaciones_votacion SET centro_codigo=?,mesa=?,estado=?,verificado_en=datetime(\'now\'),verificado_por=? WHERE id=?',
        params:[centro,mesa,'VOTO_VERIFICADO',session.uid,v.id]
      }]);
      await turso([{
        q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',
        params:['voto','Verificación individual actualizada: C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa,session.uid]
      }]);
      return res.status(200).json({ok:true,accion:'actualizada',id:v.id,centro_codigo:centro,mesa});
    }

    try{
      await turso([{
        q:'INSERT INTO verificaciones_votacion(cedula,centro_codigo,mesa,estado,verificado_por) VALUES(?,?,?,?,?)',
        params:[cedula,centro,mesa,'VOTO_VERIFICADO',session.uid]
      }]);
    }catch(e){
      const race=rowsFrom(await turso([{q:'SELECT id,centro_codigo,mesa FROM verificaciones_votacion WHERE cedula=? LIMIT 1',params:[cedula]}]));
      if(race.length) return fail(res,409,'La cédula ya tiene una verificación registrada');
      throw e;
    }

    const inserted=rowsFrom(await turso([{q:'SELECT id FROM verificaciones_votacion WHERE cedula=? LIMIT 1',params:[cedula]}]));
    await turso([{
      q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',
      params:['voto','Verificación individual registrada: C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa,session.uid]
    }]);

    return res.status(201).json({ok:true,accion:'registrada',id:inserted[0]?.id||null,centro_codigo:centro,mesa});
  }catch(e){
    return fail(res,500,e.message||'No se pudo guardar la verificación');
  }
};
