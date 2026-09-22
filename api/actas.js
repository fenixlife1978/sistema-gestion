const {parseBody,turso,rowsFrom,verify,getCookie}=require('../lib/auth');

const st=(v,n)=>String(v??'').trim().slice(0,n);
const normCentro=(v)=>String(v??'').trim().replace(/\s+/g,'');
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
    const centro=normCentro(st(b.centro_codigo,80));
    const centroNombre=st(b.centro_nombre,180);
    const mesa=st(b.mesa,30);
    const votos=Number(b.votos_partido);

    if(!centro||!/^[0-9]{1,4}$/.test(mesa)||!Number.isInteger(votos)||votos<0)
      return fail(res,400,'Centro, mesa y cantidad de votos son inválidos');

    // El código de centro llega desde la misma selección de Control Electoral.
    // Normalizamos espacios para evitar que una representación visual del código
    // provoque falsamente "Centro electoral no encontrado".
    console.log('[ACTAS_DEBUG] entrada', { centro, centroNombre, mesa, votos });
    const pre=await turso([
      {q:'SELECT codigo,nombre,mesas FROM centros WHERE TRIM(codigo)=? LIMIT 1',params:[centro]},
      {q:'SELECT estado FROM mesa_operativa WHERE TRIM(centro_codigo)=? AND mesa=? LIMIT 1',params:[centro,mesa]},
      {q:'SELECT id,votos_partido FROM actas_mesa WHERE TRIM(centro_codigo)=? AND mesa=? LIMIT 1',params:[centro,mesa]}
    ]);
    console.log('[ACTAS_DEBUG] consultas_pre', { r0: rowsFrom(pre[0] || {}), r1: rowsFrom(pre[1] || {}), r2: rowsFrom(pre[2] || {}) });
    let c=rowsFrom(pre[0] || {})[0];
    // Los códigos CNE pueden conservar ceros a la izquierda en la tabla. Si la
    // selección del frontend los transporta como número/string equivalente,
    // el cotejo textual anterior no encuentra el centro aunque sea el mismo.
    if(!c){
      console.log('[ACTAS_DEBUG] fallback_numerico', { centro });
      const alt=await turso([{
        q:'SELECT codigo,nombre,mesas FROM centros WHERE CAST(TRIM(codigo) AS INTEGER)=CAST(? AS INTEGER) LIMIT 1',
        params:[centro]
      }]);
      c=rowsFrom(alt[0] || {})[0];
      console.log('[ACTAS_DEBUG] resultado_numerico', { c });
    }
    if(!c && centroNombre){
      console.log('[ACTAS_DEBUG] fallback_nombre', { centroNombre });
      const altNombre=await turso([{
        q:'SELECT codigo,nombre,mesas FROM centros WHERE TRIM(nombre)=TRIM(?) LIMIT 1',
        params:[centroNombre]
      }]);
      c=rowsFrom(altNombre[0] || {})[0];
      console.log('[ACTAS_DEBUG] resultado_nombre', { c });
    }
    if(!c){
      console.error('[ACTAS_DEBUG] CENTRO_NO_ENCONTRADO', { centro, centroNombre, mesa });
      return fail(res,404,'Centro electoral no encontrado');
    }

    const centroReal=String(c.codigo).trim();
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
        {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['acta','Acta CNE actualizada: votos del partido • Centro '+centroReal+' • Mesa '+mesa+' • '+votos,session.uid]}
      ]);
      return res.status(200).json({ok:true,accion:'actualizada',id:existente[0].id,centro_codigo:centroReal,mesa,votos_partido:votos});
    }

    try{
      await turso([{
        q:'INSERT INTO actas_mesa(centro_codigo,mesa,cantidad_acta,votos_partido,actualizado_en,actualizado_por) VALUES(?,?,?,?,?,?)',
        params:[centroReal,mesa,votos,votos,now,session.uid]
      }]);
    }catch(e){
      const race=rowsFrom(await turso([{q:'SELECT id FROM actas_mesa WHERE TRIM(centro_codigo)=? AND mesa=? LIMIT 1',params:[centroReal,mesa]}]));
      if(race.length) return fail(res,409,'El acta de esta mesa ya fue registrada; vuelva a consultar antes de modificarla');
      throw e;
    }

    const post=await turso([
      {q:'SELECT id FROM actas_mesa WHERE TRIM(centro_codigo)=? AND mesa=? LIMIT 1',params:[centroReal,mesa]},
      {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['acta','Acta CNE registrada: votos del partido • Centro '+centroReal+' • Mesa '+mesa+' • '+votos,session.uid]}
    ]);
    const inserted=rowsFrom(post[0] || {});

    return res.status(201).json({ok:true,accion:'registrada',id:inserted[0]?.id||null,centro_codigo:centroReal,mesa,votos_partido:votos});
  }catch(e){
    return fail(res,500,e.message||'No se pudo guardar el acta');
  }
};
