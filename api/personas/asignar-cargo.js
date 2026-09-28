const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');
function ci(v){return String(v||'').replace(/\D/g,'').slice(0,20)}
function st(v,n){return String(v??'').trim().slice(0,n)}
function tel(v){return st(v,20).replace(/\D/g,'')}
function fail(res,code,error){return res.status(code).json({error})}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return fail(res,405,'Method not allowed');
  try{
    const session=verify(getCookie(req,'erp_session')); if(!session) return fail(res,401,'Sesión no válida o expirada');
    if(!['J','A','O'].includes(session.rol)) return fail(res,403,'Rol de sesión no permitido');
    const b=parseBody(req), tipo=st(b.tipo,20).toLowerCase(), cedula=ci(b.cedula), cargo=st(b.cargo,120), centro=st(b.centro_codigo,80);
    const telefono=tel(b.telefono), numero_calle=st(b.numero_calle,80), numero_casa=st(b.numero_casa,80), direccion=st(b.direccion,500), nombre=st(b.nombre,250), padron=b.padron&&typeof b.padron==='object'?b.padron:null;
    if(!['direccion','centro'].includes(tipo)||!/^[0-9]{5,9}$/.test(cedula)||!cargo) return fail(res,400,'Datos de asignación inválidos');
    if(tipo==='centro'&&!centro) return fail(res,400,'Centro electoral obligatorio');
    if(telefono&&!/^0[0-9]{10}$/.test(telefono)) return fail(res,400,'Teléfono inválido');
    // No usar posiciones de rowsFrom() para representar cada consulta: rowsFrom()
    // aplana los resultados y una consulta sin filas desplaza las siguientes.
    const roles=rowsFrom(await turso([{
      q:`SELECT tipo,id,cargo,centro_codigo FROM (
        SELECT 'MOVILIZADOR' AS tipo,id,NULL AS cargo,NULL AS centro_codigo FROM reclutadores WHERE cedula=? LIMIT 1
        UNION ALL SELECT 'COMPROMETIDO',id,NULL,NULL FROM asignaciones WHERE cedula=? LIMIT 1
        UNION ALL SELECT 'DIRECCIÓN EJECUTIVA',id,cargo,NULL FROM direccion_ejecutiva WHERE cedula=? LIMIT 1
        UNION ALL SELECT 'COMITÉ VECINAL',id,cargo,NULL FROM comite_vecinal WHERE cedula=? LIMIT 1
        UNION ALL SELECT 'CARGO DE CENTRO',id,cargo,centro_codigo FROM centro_cargos WHERE cedula=? LIMIT 1
      )`,params:[cedula,cedula,cedula,cedula,cedula]
    }]));
    const padronRows=rowsFrom(await turso([{q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[cedula]}]));
    const destino=tipo==='direccion'?'DIRECCIÓN EJECUTIVA':'CARGO DE CENTRO';
    const conflicts=roles.map(x=>String(x.tipo||'')).filter(Boolean);
    const sameTarget=roles.some(x=>
      (tipo==='direccion'&&x.tipo==='DIRECCIÓN EJECUTIVA'&&String(x.cargo||'')===cargo) ||
      (tipo==='centro'&&x.tipo==='CARGO DE CENTRO'&&String(x.centro_codigo||'')===centro&&String(x.cargo||'')===cargo)
    );
    if(sameTarget) return fail(res,409,'La persona ya ocupa ese cargo');
    if(conflicts.filter(x=>x!==destino).length){
      const a=rowsFrom(await turso([{q:'SELECT id FROM autorizaciones_duplicidad_persona WHERE cedula=? AND contexto_destino=? AND consumida_en IS NULL ORDER BY id DESC LIMIT 1',params:[cedula,destino]}]));
      if(!a.length) return fail(res,409,'La persona ya figura en otra función y requiere autorización J/A para este destino');
    }
    if(tipo==='centro'){
      const cen=rowsFrom(await turso([{q:'SELECT codigo FROM centros WHERE codigo=? LIMIT 1',params:[centro]}])); if(!cen.length) return fail(res,404,'Centro electoral no encontrado');
      const occupied=rowsFrom(await turso([{q:'SELECT id,cedula FROM centro_cargos WHERE centro_codigo=? AND cargo=? LIMIT 1',params:[centro,cargo]}]));
      if(occupied.length&&String(occupied[0].cedula||'')!==cedula) return fail(res,409,'El cargo ya está ocupado en ese centro');
    }else{
      const occupied=rowsFrom(await turso([{q:'SELECT id,cedula FROM direccion_ejecutiva WHERE cargo=? LIMIT 1',params:[cargo]}]));
      if(occupied.length&&String(occupied[0].cedula||'')!==cedula) return fail(res,409,'El cargo de Dirección Ejecutiva ya está ocupado');
    }
    if(!padronRows.length&&!padron) return fail(res,409,'La cédula no existe en el padrón; envíe los datos para registro manual');
    if(!padronRows.length&&padron){
      const pa=st(padron.p_apellido,80),pn=st(padron.p_nombre,80); if(ci(padron.cedula||cedula)!==cedula||!pa||!pn) return fail(res,400,'Datos de padrón inválidos');
      await turso([{q:'INSERT INTO padron(cedula,letra,p_apellido,s_apellido,p_nombre,s_nombre,sexo,fecha_nac,edad,codigo_estado,estado,codigo_municipio,municipio,codigo_parroquia,parroquia,centro_votacion,nombre_cv,es_manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',params:[cedula,st(padron.letra||'V',2),pa,st(padron.s_apellido,80),pn,st(padron.s_nombre,80),st(padron.sexo,1),st(padron.fecha_nac,30),padron.edad??null,st(padron.codigo_estado,30),st(padron.estado,100),st(padron.codigo_municipio,30),st(padron.municipio,120),st(padron.codigo_parroquia,30),st(padron.parroquia,120),st(padron.centro_votacion,80),st(padron.nombre_cv,250)]}]);
    }
    const now=new Date().toISOString();
    let autorizacionId=null;
    if(conflicts.filter(x=>x!==destino).length){
      const authRow=rowsFrom(await turso([{q:'SELECT id FROM autorizaciones_duplicidad_persona WHERE cedula=? AND contexto_destino=? AND consumida_en IS NULL ORDER BY id DESC LIMIT 1',params:[cedula,destino]}]))[0];
      if(authRow) autorizacionId=Number(authRow.id);
    }
    if(tipo==='direccion'){
      const guard=autorizacionId
        ? ' AND EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)'
        : '';
      const guardParams=autorizacionId?[autorizacionId,now,session.uid]:[];
      const statements=[];
      if(autorizacionId){
        statements.push({q:'BEGIN',params:[]});
        statements.push({q:'UPDATE autorizaciones_duplicidad_persona SET consumida_en=?, consumida_por=? WHERE id=? AND consumida_en IS NULL',params:[now,session.uid,autorizacionId]});
      }
      statements.push({q:'DELETE FROM direccion_ejecutiva WHERE cargo=?'+guard,params:[cargo,...guardParams]});
      if(autorizacionId){
        statements.push({q:'INSERT INTO direccion_ejecutiva(cargo,cedula,nombre,telefono,numero_calle,numero_casa,direccion) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)',params:[cargo,cedula,nombre||cedula,telefono||null,numero_calle||null,numero_casa||null,direccion||null,autorizacionId,now,session.uid]});
      }else{
        statements.push({q:'INSERT INTO direccion_ejecutiva(cargo,cedula,nombre,telefono,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?,?)',params:[cargo,cedula,nombre||cedula,telefono||null,numero_calle||null,numero_casa||null,direccion||null]});
      }
      if(autorizacionId){
        statements.push({q:'INSERT INTO actividad(tipo,texto,usuario_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)',params:['user','Dirección Ejecutiva asignada: C.I. '+cedula+' → '+cargo+' • autorización #'+autorizacionId+' consumida',session.uid,autorizacionId,now,session.uid]});
        statements.push({q:'COMMIT',params:[]});
      }else{
        statements.push({q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Dirección Ejecutiva asignada: C.I. '+cedula+' → '+cargo,session.uid]});
      }
      await turso(statements);
    }else{
      const ex=rowsFrom(await turso([{q:'SELECT id FROM centro_cargos WHERE centro_codigo=? AND cargo=? LIMIT 1',params:[centro,cargo]}]));
      const statements=[];
      const guard=autorizacionId
        ? ' AND EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)'
        : '';
      const guardParams=autorizacionId?[autorizacionId,now,session.uid]:[];
      if(autorizacionId){
        statements.push({q:'BEGIN',params:[]});
        statements.push({q:'UPDATE autorizaciones_duplicidad_persona SET consumida_en=?, consumida_por=? WHERE id=? AND consumida_en IS NULL',params:[now,session.uid,autorizacionId]});
      }
      if(ex.length) statements.push({q:'UPDATE centro_cargos SET cedula=?,telefono=COALESCE(?,telefono),direccion=COALESCE(?,direccion),asignado_en=? WHERE id=?'+guard,params:[cedula,telefono||null,direccion||null,now,ex[0].id,...guardParams]});
      else if(autorizacionId) statements.push({q:'INSERT INTO centro_cargos(centro_codigo,cargo,cedula,telefono,direccion,asignado_en) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)',params:[centro,cargo,cedula,telefono||null,direccion||null,now,autorizacionId,now,session.uid]});
      else statements.push({q:'INSERT INTO centro_cargos(centro_codigo,cargo,cedula,telefono,direccion,asignado_en) VALUES(?,?,?,?,?,?)',params:[centro,cargo,cedula,telefono||null,direccion||null,now]});
      if(autorizacionId){
        statements.push({q:'INSERT INTO actividad(tipo,texto,usuario_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM autorizaciones_duplicidad_persona WHERE id=? AND consumida_en=? AND consumida_por=?)',params:['user',cargo+' asignado en centro '+centro+' • C.I. '+cedula+' • autorización #'+autorizacionId+' consumida',session.uid,autorizacionId,now,session.uid]});
        statements.push({q:'COMMIT',params:[]});
      }else{
        statements.push({q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user',cargo+' asignado en centro '+centro+' • C.I. '+cedula,session.uid]});
      }
      await turso(statements);
    }
    return res.status(201).json({ok:true,tipo,cedula,cargo,centro_codigo:centro||null});
  }catch(e){return fail(res,500,e.message||'No se pudo asignar el cargo')}
};