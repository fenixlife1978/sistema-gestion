const {parseBody,turso,rowsFrom,verify,getCookie}=require('../lib/auth');

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

    const centros=rowsFrom(await turso([{q:'SELECT codigo,nombre,mesas FROM centros WHERE codigo=? LIMIT 1',params:[centro]}]));
    const c=centros[0];
    if(!c) return fail(res,404,'Centro electoral no encontrado');

    const nMesa=Number(mesa);
    const maxMesas=Number(c.mesas||0);
    if(maxMesas>0 && (nMesa<1 || nMesa>maxMesas))
      return fail(res,409,'La mesa indicada no pertenece al centro seleccionado');

    // La verificación electoral se basa exclusivamente en el padrón CNE
    // del centro seleccionado. Tener o no tener cargos/funciones en el
    // sistema no es un requisito para marcar VOTÓ.
    const padronCentro=rowsFrom(await turso([{
      q:'SELECT cedula FROM padron WHERE cedula=? AND (centro_votacion=? OR nombre_cv=?) LIMIT 1',
      params:[cedula,centro,c.nombre||'']
    }]));
    if(!padronCentro.length)
      return fail(res,409,'La persona no aparece en el padrón CNE del centro seleccionado');

    // Solo una verificación VOTÓ existente en este mismo centro bloquea
    // una nueva marcación. Los cargos/funciones del sistema no intervienen.
    const existing=rowsFrom(await turso([{
      q:'SELECT id,centro_codigo,mesa,estado FROM verificaciones_votacion WHERE cedula=? AND centro_codigo=? AND estado=? LIMIT 1',
      params:[cedula,centro,'VOTO_VERIFICADO']
    }]));

    if(existing.length){
      const v=existing[0];
      await turso([
        {q:'UPDATE verificaciones_votacion SET mesa=?,estado=?,verificado_en=datetime(\'now\'),verificado_por=? WHERE id=?',params:[mesa,'VOTO_VERIFICADO',session.uid,v.id]},
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['voto','Verificación individual actualizada: C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa,session.uid]}
      ]);
      return res.status(200).json({ok:true,accion:'actualizada',id:v.id,centro_codigo:centro,mesa});
    }

    try{
      await turso([{
        q:'INSERT INTO verificaciones_votacion(cedula,centro_codigo,mesa,estado,verificado_por) VALUES(?,?,?,?,?)',
        params:[cedula,centro,mesa,'VOTO_VERIFICADO',session.uid]
      }]);
    }catch(e){
      const race=rowsFrom(await turso([{
        q:'SELECT id,centro_codigo,mesa,estado FROM verificaciones_votacion WHERE cedula=? AND centro_codigo=? AND estado=? LIMIT 1',
        params:[cedula,centro,'VOTO_VERIFICADO']
      }]));
      if(race.length) return fail(res,409,'La persona ya aparece como VOTÓ en este centro');
      throw e;
    }

    const post=await turso([
      {q:'SELECT id FROM verificaciones_votacion WHERE cedula=? AND centro_codigo=? LIMIT 1',params:[cedula,centro]},
      {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['voto','Verificación individual registrada: C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa,session.uid]}
    ]);
    const inserted=rowsFrom(post[0] || {});

    return res.status(201).json({ok:true,accion:'registrada',id:inserted[0]?.id||null,centro_codigo:centro,mesa});
  }catch(e){
    return fail(res,500,e.message||'No se pudo guardar la verificación');
  }
};
