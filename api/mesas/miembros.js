const {parseBody,turso,rowsFrom,verify,getCookie,verifyHash}=require('../../lib/auth');
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const ci=v=>String(v||'').replace(/\D/g,'').slice(0,20);
const fail=(res,c,e)=>res.status(c).json({error:e});
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return fail(res,405,'Method not allowed');
  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return fail(res,401,'Sesión no válida o expirada');
    if(!['J','A','O'].includes(session.rol)) return fail(res,403,'Rol de sesión no permitido');
    const b=parseBody(req), accion=clean(b.accion,20).toLowerCase();
    const centro=clean(b.centro_codigo,80), mesa=clean(b.mesa,30);
    if(!centro||!mesa) return fail(res,400,'Centro y mesa son obligatorios');
    const cen=rowsFrom(await turso([{q:'SELECT codigo FROM centros WHERE codigo=? LIMIT 1',params:[centro]}]));
    if(!cen.length) return fail(res,404,'Centro electoral no encontrado');
    const mo=rowsFrom(await turso([{q:'SELECT id FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]));
    let mesaId=mo[0]?.id;
    if(accion==='constituir'){
      const hc=clean(b.hora_constitucion,10), hi=clean(b.hora_inicio_votacion,10), test=Number(b.testigos_asistieron);
      if((hc&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hc))||(hi&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hi))||!Number.isInteger(test)||test<0) return fail(res,400,'Datos de constitución inválidos');
      const afectos=Array.isArray(b.afectos)?b.afectos.slice(0,100):[];
      const cargos=rowsFrom(await turso([{q:'SELECT cedula,cargo FROM centro_cargos WHERE centro_codigo=? AND cedula IS NOT NULL',params:[centro]}]));
      const allowed=new Map(cargos.map(x=>[ci(x.cedula),clean(x.cargo,120)]));
      const selected=[];
      for(const a of afectos){
        const c=ci(a.cedula), cargo=clean(a.cargo,120);
        if(!c||!allowed.has(c)||allowed.get(c)!==cargo) return fail(res,403,'Miembro afecto no corresponde a un cargo registrado en el centro');
        selected.push({cedula:c,cargo});
      }
      if(mesaId) await turso([{q:'UPDATE mesa_operativa SET hora_constitucion=?,hora_inicio_votacion=?,testigos_asistieron=?,actualizado_en=datetime(\'now\'),actualizado_por=? WHERE id=?',params:[hc||null,hi||null,test,session.uid,mesaId]}]);
      else {
        await turso([{q:'INSERT INTO mesa_operativa(centro_codigo,mesa,hora_constitucion,hora_inicio_votacion,testigos_asistieron,actualizado_por) VALUES(?,?,?,?,?,?)',params:[centro,mesa,hc||null,hi||null,test,session.uid]}]);
        mesaId=rowsFrom(await turso([{q:'SELECT id FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0]?.id;
      }
      if(!mesaId) return fail(res,500,'No se pudo identificar la mesa constituida');
      await turso([{q:'DELETE FROM mesa_miembros WHERE mesa_operativa_id=? AND tipo=?',params:[mesaId,'AFECTO']}]);
      for(const s of selected) await turso([{q:'INSERT OR IGNORE INTO mesa_miembros(mesa_operativa_id,cedula,cargo,tipo,origen,autorizado,registrado_por) VALUES(?,?,?,?,?,?,?)',params:[mesaId,s.cedula,s.cargo,'AFECTO','CENTRO',1,session.uid]}]);
      await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['mesa','Constitución Mesa '+mesa+' • Centro '+centro+' • Hora constitución '+(hc||'N/D')+' • Inicio '+(hi||'N/D')+' • Testigos '+test,session.uid]}]);
      return res.status(200).json({ok:true,mesa_id:mesaId});
    }
    if(accion==='accidental'){
      if(!mesaId) return fail(res,409,'Primero debe constituirse la mesa');
      const cedula=ci(b.cedula), cargo=clean(b.cargo,120), authUsuario=clean(b.authUsuario,160), authClave=String(b.authClave||'');
      if(!cedula||!cargo||!authUsuario||!authClave) return fail(res,400,'Datos de reemplazo y autorización incompletos');
      const ar=rowsFrom(await turso([{q:'SELECT id,usuario,rol,clave_hash,activo,nombre FROM usuarios WHERE usuario=? AND activo=1 LIMIT 1',params:[authUsuario]}]));
      const au=ar[0];
      if(!au||!['J','A'].includes(au.rol)||!verifyHash(authClave,au.clave_hash)) return fail(res,403,'Credenciales del autorizante inválidas');
      const exists=rowsFrom(await turso([
        {q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[cedula]},
        {q:'SELECT cedula FROM reclutadores WHERE cedula=? LIMIT 1',params:[cedula]},
        {q:'SELECT cedula FROM asignaciones WHERE cedula=? LIMIT 1',params:[cedula]},
        {q:'SELECT cedula FROM direccion_ejecutiva WHERE cedula=? LIMIT 1',params:[cedula]},
        {q:'SELECT cedula FROM centro_cargos WHERE cedula=? LIMIT 1',params:[cedula]},
        {q:'SELECT cedula FROM comite_vecinal WHERE cedula=? LIMIT 1',params:[cedula]}
      ]));
      if(!exists.some(Boolean)) return fail(res,409,'La persona debe estar registrada previamente en el sistema');
      const dup=rowsFrom(await turso([{q:'SELECT id FROM mesa_miembros WHERE mesa_operativa_id=? AND cedula=? AND cargo=? LIMIT 1',params:[mesaId,cedula,cargo]}]));
      if(dup.length) return fail(res,409,'El reemplazo ya está registrado en esta mesa');
      await turso([
        {q:'INSERT INTO mesa_miembros(mesa_operativa_id,cedula,cargo,tipo,origen,autorizado,autorizado_por,autorizado_en,registrado_por) VALUES(?,?,?,?,?,?,?,?,?)',params:[mesaId,cedula,cargo,'ACCIDENTAL','AUTORIZACION_JA',1,au.id,new Date().toISOString(),session.uid]},
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['autorizacion','Reemplazo accidental autorizado • C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa+' • Cargo '+cargo+' • Autorizó '+au.nombre,session.uid]}
      ]);
      return res.status(201).json({ok:true,autorizado_por:{id:au.id,nombre:au.nombre}});
    }
    return fail(res,400,'Acción de mesa inválida');
  }catch(e){return fail(res,500,e.message||'No se pudo actualizar la mesa')}
};