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
    const telefono=tel(b.telefono), direccion=st(b.direccion,500), nombre=st(b.nombre,250), padron=b.padron&&typeof b.padron==='object'?b.padron:null;
    if(!['direccion','centro'].includes(tipo)||!/^[0-9]{5,9}$/.test(cedula)||!cargo) return fail(res,400,'Datos de asignación inválidos');
    if(tipo==='centro'&&!centro) return fail(res,400,'Centro electoral obligatorio');
    if(telefono&&!/^0[0-9]{10}$/.test(telefono)) return fail(res,400,'Teléfono inválido');
    const d=rowsFrom(await turso([
      {q:'SELECT id,cedula FROM reclutadores WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id,cedula FROM asignaciones WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id,cargo,cedula FROM direccion_ejecutiva WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id,comunidad,cedula FROM comite_vecinal WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id,centro_codigo,cargo,cedula FROM centro_cargos WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[cedula]}
    ]));
    const destino=tipo==='direccion'?'DIRECCIÓN EJECUTIVA':'CARGO DE CENTRO', conflicts=[];
    if(d[0]) conflicts.push('MOVILIZADOR'); if(d[1]) conflicts.push('COMPROMETIDO'); if(d[2]) conflicts.push('DIRECCIÓN EJECUTIVA'); if(d[3]) conflicts.push('COMITÉ VECINAL'); if(d[4]) conflicts.push('CARGO DE CENTRO');
    const sameTarget=(tipo==='direccion'&&d[2]&&String(d[2].cargo||'')===cargo)||(tipo==='centro'&&d[4]&&String(d[4].centro_codigo||'')===centro&&String(d[4].cargo||'')===cargo);
    if(sameTarget) return fail(res,409,'La persona ya ocupa ese cargo');
    if(conflicts.filter(x=>x!==destino).length){
      const a=rowsFrom(await turso([{q:'SELECT id FROM autorizaciones_duplicidad_persona WHERE cedula=? AND contexto_destino=? ORDER BY id DESC LIMIT 1',params:[cedula,destino]}]));
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
    if(!d[5]&&!padron) return fail(res,409,'La cédula no existe en el padrón; envíe los datos para registro manual');
    if(!d[5]&&padron){
      const pa=st(padron.p_apellido,80),pn=st(padron.p_nombre,80); if(ci(padron.cedula||cedula)!==cedula||!pa||!pn) return fail(res,400,'Datos de padrón inválidos');
      await turso([{q:'INSERT INTO padron(cedula,letra,p_apellido,s_apellido,p_nombre,s_nombre,sexo,fecha_nac,edad,codigo_estado,estado,codigo_municipio,municipio,codigo_parroquia,parroquia,centro_votacion,nombre_cv,es_manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',params:[cedula,st(padron.letra||'V',2),pa,st(padron.s_apellido,80),pn,st(padron.s_nombre,80),st(padron.sexo,1),st(padron.fecha_nac,30),padron.edad??null,st(padron.codigo_estado,30),st(padron.estado,100),st(padron.codigo_municipio,30),st(padron.municipio,120),st(padron.codigo_parroquia,30),st(padron.parroquia,120),st(padron.centro_votacion,80),st(padron.nombre_cv,250)]}]);
    }
    const now=new Date().toISOString();
    if(tipo==='direccion'){
      await turso([{q:'DELETE FROM direccion_ejecutiva WHERE cargo=? OR cedula=?',params:[cargo,cedula]},{q:'INSERT INTO direccion_ejecutiva(cargo,cedula,nombre,telefono,direccion) VALUES(?,?,?,?,?)',params:[cargo,cedula,nombre||cedula,telefono||null,direccion||null]},{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Dirección Ejecutiva asignada: C.I. '+cedula+' → '+cargo,session.uid]}]);
    }else{
      const ex=rowsFrom(await turso([{q:'SELECT id FROM centro_cargos WHERE centro_codigo=? AND cargo=? LIMIT 1',params:[centro,cargo]}]));
      if(ex.length) await turso([{q:'UPDATE centro_cargos SET cedula=?,telefono=COALESCE(?,telefono),direccion=COALESCE(?,direccion),asignado_en=? WHERE id=?',params:[cedula,telefono||null,direccion||null,now,ex[0].id]}]);
      else await turso([{q:'INSERT INTO centro_cargos(centro_codigo,cargo,cedula,telefono,direccion,asignado_en) VALUES(?,?,?,?,?,?)',params:[centro,cargo,cedula,telefono||null,direccion||null,now]}]);
      await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user',cargo+' asignado en centro '+centro+' • C.I. '+cedula,session.uid]}]);
    }
    return res.status(201).json({ok:true,tipo,cedula,cargo,centro_codigo:centro||null});
  }catch(e){return fail(res,500,e.message||'No se pudo asignar el cargo')}
};