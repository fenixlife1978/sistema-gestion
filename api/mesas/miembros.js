const {parseBody,turso,rowsFrom,verify,getCookie,verifyHash}=require('../../lib/auth');
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const ci=v=>String(v||'').replace(/\D/g,'').slice(0,20);
const ESTADOS_MAQUINA=['OPERATIVA','DEFECTUOSA','DAÑADA','EN REPARACIÓN','REEMPLAZADA','OTRO'];
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
    const mo=rowsFrom(await turso([{q:'SELECT id,estado,estado_maquina,observacion_maquina,hora_cierre FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]));
    let mesaId=mo[0]?.id;
    if(mo[0]?.estado==='CERRADA' && accion!=='cerrar') return fail(res,409,'La mesa ya está cerrada y no admite modificaciones');
    if(accion==='historial_maquina'){
      if(!mesaId) return res.status(200).json({ok:true,historial:[]});
      const hist=rowsFrom(await turso([{q:'SELECT h.id,h.estado_anterior,h.estado_nuevo,h.observacion,h.cambiado_en,h.cambiado_por,u.nombre AS operador_nom FROM mesa_maquina_historial h LEFT JOIN usuarios u ON u.id=h.cambiado_por WHERE h.mesa_operativa_id=? ORDER BY h.cambiado_en ASC,h.id ASC',params:[mesaId]}]));
      return res.status(200).json({ok:true,historial:hist});
    }
    if(accion==='cambiar_estado_maquina'){
      if(!mesaId) return fail(res,409,'Primero debe constituirse la mesa');
      if(mo[0]?.estado==='CERRADA') return fail(res,409,'La mesa está cerrada');
      const maquina=clean(b.estado_maquina,30).toUpperCase(), observacion=clean(b.observacion_maquina,500);
      if(!ESTADOS_MAQUINA.includes(maquina)) return fail(res,400,'Estado de máquina inválido');
      if(maquina==='OPERATIVA' && !observacion && mo[0]?.estado_maquina!=='OPERATIVA') return fail(res,400,'Debe indicar cómo se resolvió la incidencia antes de activar la máquina');
      if(maquina!=='OPERATIVA' && !observacion) return fail(res,400,'Debe registrar una observación para el estado seleccionado');
      const anterior=mo[0]?.estado_maquina||'OPERATIVA';
      const now=new Date().toISOString();
      await turso([
        {q:'UPDATE mesa_operativa SET estado_maquina=?,observacion_maquina=?,actualizado_en=?,actualizado_por=? WHERE id=?',params:[maquina,observacion||null,now,session.uid,mesaId]},
        {q:'INSERT INTO mesa_maquina_historial(mesa_operativa_id,estado_anterior,estado_nuevo,observacion,cambiado_en,cambiado_por) VALUES(?,?,?,?,?,?)',params:[mesaId,anterior,maquina,observacion||null,now,session.uid]},
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['mesa','Cambio de estado de máquina • Centro '+centro+' • Mesa '+mesa+' • '+anterior+' → '+maquina+(observacion?' • '+observacion:''),session.uid]}
      ]);
      return res.status(200).json({ok:true,estado_maquina:maquina,observacion_maquina:observacion,cambiado_en:now});
    }
    if(accion==='constituir'){
      const hc=clean(b.hora_constitucion,10), hi=clean(b.hora_inicio_votacion,10), test=Number(b.testigos_asistieron), maquina=clean(b.estado_maquina,30).toUpperCase(), observacionMaquina=clean(b.observacion_maquina,500);
      const estadosMaquina=ESTADOS_MAQUINA;
      if((hc&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hc))||(hi&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(hi))||!Number.isInteger(test)||test<0||!estadosMaquina.includes(maquina)) return fail(res,400,'Datos de constitución inválidos');
      if(maquina==='OPERATIVA' && observacionMaquina) return fail(res,400,'No se requiere observación cuando la máquina está operativa');
      if(maquina!=='OPERATIVA' && !observacionMaquina) return fail(res,400,'Debe registrar una observación para el estado de máquina seleccionado');
      const afectos=Array.isArray(b.afectos)?b.afectos.slice(0,100):[];
      const cargos=rowsFrom(await turso([{q:'SELECT cedula,cargo FROM centro_cargos WHERE centro_codigo=? AND cedula IS NOT NULL',params:[centro]}]));
      const allowed=new Map(cargos.map(x=>[ci(x.cedula),clean(x.cargo,120)]));
      const selected=[];
      for(const a of afectos){
        const c=ci(a.cedula), cargo=clean(a.cargo,120);
        if(!c||!allowed.has(c)||allowed.get(c)!==cargo) return fail(res,403,'Miembro afecto no corresponde a un cargo registrado en el centro');
        selected.push({cedula:c,cargo});
      }
      if(mesaId) await turso([{q:'UPDATE mesa_operativa SET hora_constitucion=?,hora_inicio_votacion=?,testigos_asistieron=?,estado_maquina=?,observacion_maquina=?,actualizado_en=datetime(\'now\'),actualizado_por=? WHERE id=?',params:[hc||null,hi||null,test,maquina,observacionMaquina||null,session.uid,mesaId]}]);
      else {
        await turso([{q:'INSERT INTO mesa_operativa(centro_codigo,mesa,hora_constitucion,hora_inicio_votacion,testigos_asistieron,estado_maquina,observacion_maquina,actualizado_por) VALUES(?,?,?,?,?,?,?,?)',params:[centro,mesa,hc||null,hi||null,test,maquina,observacionMaquina||null,session.uid]}]);
        mesaId=rowsFrom(await turso([{q:'SELECT id FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0]?.id;
      }
      if(!mesaId) return fail(res,500,'No se pudo identificar la mesa constituida');
      const histPrev=mo[0]?.estado_maquina||null;
      if(!histPrev || histPrev!==maquina){ await turso([{q:'INSERT INTO mesa_maquina_historial(mesa_operativa_id,estado_anterior,estado_nuevo,observacion,cambiado_en,cambiado_por) VALUES(?,?,?,?,?,?)',params:[mesaId,histPrev,maquina,observacionMaquina||null,new Date().toISOString(),session.uid]}]); }

      await turso([{q:'DELETE FROM mesa_miembros WHERE mesa_operativa_id=? AND tipo=?',params:[mesaId,'AFECTO']}]);
      for(const s of selected) await turso([{q:'INSERT OR IGNORE INTO mesa_miembros(mesa_operativa_id,cedula,cargo,tipo,origen,autorizado,registrado_por) VALUES(?,?,?,?,?,?,?)',params:[mesaId,s.cedula,s.cargo,'AFECTO','CENTRO',1,session.uid]}]);
      await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['mesa','Constitución Mesa '+mesa+' • Centro '+centro+' • Hora constitución '+(hc||'N/D')+' • Inicio '+(hi||'N/D')+' • Testigos '+test+' • Máquina '+maquina,session.uid]}]);
      return res.status(200).json({ok:true,mesa_id:mesaId});
    }
    if(accion==='cerrar'){
      if(!mesaId) return fail(res,409,'Primero debe constituirse la mesa');
      if(mo[0]?.estado==='CERRADA') return fail(res,409,'La mesa ya está cerrada');
      const acta=rowsFrom(await turso([{q:'SELECT id,votos_partido,cantidad_acta FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0];
      if(!acta) return fail(res,409,'No se puede cerrar la mesa sin registrar primero los resultados del acta');
      const now=new Date().toISOString();
      const miembrosCierre=rowsFrom(await turso([{q:'SELECT cedula,cargo,tipo,origen,autorizado,autorizado_por,autorizado_en FROM mesa_miembros WHERE mesa_operativa_id=? ORDER BY id',params:[mesaId]}]));
      const estadoObs=rowsFrom(await turso([{q:'SELECT estado_maquina,observacion_maquina FROM mesa_operativa WHERE id=? LIMIT 1',params:[mesaId]}]))[0]||{};
      const resultado={votos_partido:Number(acta.votos_partido||0),cantidad_acta:Number(acta.cantidad_acta||0),estado_maquina:estadoObs.estado_maquina||'OPERATIVA',observacion_maquina:estadoObs.observacion_maquina||'',cerrada_en:now,miembros:miembrosCierre};
      await turso([{q:'UPDATE mesa_operativa SET estado=?,hora_cierre=?,cierre_por=?,resultados_cierre_json=?,actualizado_en=?,actualizado_por=? WHERE id=?',params:['CERRADA',now,session.uid,JSON.stringify(resultado),now,session.uid,mesaId]}]);
      await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['mesa','Cierre de Mesa '+mesa+' • Centro '+centro+' • Hora '+now+' • Votos '+Number(acta.votos_partido||0),session.uid]}]);
      return res.status(200).json({ok:true,estado:'CERRADA',hora_cierre:now,resultados:resultado});
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
      const cargoCentro=rowsFrom(await turso([{q:'SELECT id,cedula FROM centro_cargos WHERE centro_codigo=? AND cargo=? LIMIT 1',params:[centro,cargo]}]));
      if(!cargoCentro.length) return fail(res,409,'El cargo a reemplazar no está registrado en este centro');
      const titular=String(cargoCentro[0].cedula||'').replace(/\\D/g,'');
      const titularPresente=rowsFrom(await turso([{q:'SELECT id FROM mesa_miembros WHERE mesa_operativa_id=? AND cedula=? AND cargo=? AND tipo=? LIMIT 1',params:[mesaId,titular,cargo,'AFECTO']}])).length;
      if(titularPresente) return fail(res,409,'El titular de ese cargo fue ratificado; el reemplazo accidental solo procede cuando el titular no se presenta');
      const dup=rowsFrom(await turso([{q:'SELECT id FROM mesa_miembros WHERE mesa_operativa_id=? AND cedula=? AND cargo=? LIMIT 1',params:[mesaId,cedula,cargo]}]));
      if(dup.length) return fail(res,409,'El reemplazo ya está registrado en esta mesa');
      const yaReemplazado=rowsFrom(await turso([{q:'SELECT id FROM mesa_miembros WHERE mesa_operativa_id=? AND cargo=? AND tipo=? LIMIT 1',params:[mesaId,cargo,'ACCIDENTAL']}]))
      if(yaReemplazado.length) return fail(res,409,'Ese cargo ya tiene un reemplazo accidental registrado');
      const now=new Date().toISOString();
      await turso([
        {q:'INSERT INTO autorizaciones_duplicidad_persona(cedula,contexto_origen,contexto_destino,detalle_duplicidad,motivo,autorizado_por,autorizado_en,registrado_por) VALUES(?,?,?,?,?,?,?,?)',params:[cedula,'CARGO DE CENTRO','MESA', 'Reemplazo de '+cargo+' en centro '+centro+' mesa '+mesa,'Reemplazo accidental de mesa',au.id,now,session.uid]},
        {q:'INSERT INTO mesa_miembros(mesa_operativa_id,cedula,cargo,tipo,origen,autorizado,autorizado_por,autorizado_en,registrado_por) VALUES(?,?,?,?,?,?,?,?,?)',params:[mesaId,cedula,cargo,'ACCIDENTAL','AUTORIZACION_JA',1,au.id,now,session.uid]},
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['autorizacion','Reemplazo accidental autorizado • C.I. '+cedula+' • Centro '+centro+' • Mesa '+mesa+' • Cargo '+cargo+' • Autorizó '+au.nombre,session.uid]}
      ]);
      return res.status(201).json({ok:true,autorizado_por:{id:au.id,nombre:au.nombre}});
    }
    return fail(res,400,'Acción de mesa inválida');
  }catch(e){return fail(res,500,e.message||'No se pudo actualizar la mesa')}
};