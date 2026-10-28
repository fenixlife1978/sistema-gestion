const {parseBody,turso,rowsFrom,verify,getCookie}=require('../lib/auth');
const crypto=require('crypto');
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const digits=v=>String(v??'').replace(/\D/g,'').slice(0,20);
const fail=(res,status,error)=>res.status(status).json({ok:false,error});

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return fail(res,405,'Method not allowed');
  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return fail(res,401,'Se requiere una sesión autenticada para sincronizar');
    const users=rowsFrom(await turso([{q:'SELECT id,usuario,rol,activo FROM usuarios WHERE id=? LIMIT 1',params:[session.uid]}]));
    const actor=users[0];
    if(!actor||Number(actor.activo)!==1||actor.usuario!==session.usuario||actor.rol!==session.rol)
      return fail(res,401,'La sesión ya no está activa');
    if(!['J','A','O','C'].includes(actor.rol)) return fail(res,403,'Rol no permitido');
    const body=parseBody(req);
    const events=Array.isArray(body.events)?body.events:[];
    if(!events.length||events.length>50) return fail(res,400,'Se requieren entre 1 y 50 operaciones');
    await turso([{q:`CREATE TABLE IF NOT EXISTS desktop_sync_events (
      event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor_id INTEGER NOT NULL,
      status TEXT NOT NULL, result_json TEXT, claim_token TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,params:[]}]);
    // Compatibilidad con tablas creadas por versiones anteriores del endpoint.
    await turso([{q:'ALTER TABLE desktop_sync_events ADD COLUMN claim_token TEXT',params:[]}]).catch(()=>{});
    const results=[];
    for(const event of events){
      const eventId=clean(event.event_id,100);
      const type=clean(event.type,30);
      const p=event.payload&&typeof event.payload==='object'&&!Array.isArray(event.payload)?event.payload:{};
      if(!/^[a-zA-Z0-9_-]{12,100}$/.test(eventId)||!['verificacion','acta'].includes(type)){
        results.push({event_id:eventId||null,status:'failed',error:'Identificador o tipo de operación inválido'});continue;
      }
      const previous=rowsFrom(await turso([{q:'SELECT status,result_json,actor_id,event_type,claim_token,updated_at FROM desktop_sync_events WHERE event_id=? LIMIT 1',params:[eventId]}]))[0];
      if(previous && (Number(previous.actor_id)!==Number(actor.id) || previous.event_type!==type)){
        results.push({event_id:eventId,status:'failed',error:'El identificador ya pertenece a otra operación o usuario'});continue;
      }
      if(previous?.status==='applied'){
        results.push({event_id:eventId,status:'synced',duplicate:true,result:previous.result_json?JSON.parse(previous.result_json):null});continue;
      }
      if(previous?.status==='processing'){
        const updatedMs=Date.parse(String(previous.updated_at||'').replace(' ','T')+'Z');
        if(Number.isFinite(updatedMs)&&Date.now()-updatedMs<120000){
          results.push({event_id:eventId,status:'failed',error:'Esta operación ya está siendo procesada; se reintentará en el siguiente ciclo'});continue;
        }
        // Si el proceso anterior murió, se permite recuperar el evento tras dos minutos.
      }
      const claimToken=crypto.randomUUID();
      try{
        if(previous){
          await turso([{q:"UPDATE desktop_sync_events SET status='processing',claim_token=?,updated_at=datetime('now') WHERE event_id=? AND status=? AND COALESCE(claim_token,'')=?",params:[claimToken,eventId,previous.status,previous.claim_token||'']}]);
        }else{
          await turso([{q:"INSERT OR IGNORE INTO desktop_sync_events(event_id,event_type,actor_id,status,claim_token,created_at,updated_at) VALUES(?,?,?,'processing',?,datetime('now'),datetime('now'))",params:[eventId,type,actor.id,claimToken]}]);
        }
        const claim=rowsFrom(await turso([{q:'SELECT status,claim_token,actor_id,event_type FROM desktop_sync_events WHERE event_id=? LIMIT 1',params:[eventId]}]))[0];
        if(!claim||claim.status!=='processing'||claim.claim_token!==claimToken||Number(claim.actor_id)!==Number(actor.id)||claim.event_type!==type){
          results.push({event_id:eventId,status:'failed',error:'Otra solicitud reclamó esta operación; se reintentará automáticamente'});continue;
        }
        if(type==='verificacion'){
          const cedula=digits(p.cedula), centro=clean(p.centro_codigo,80), mesa=clean(p.mesa,4);
          if(!/^[0-9]{5,9}$/.test(cedula)||!centro||!/^\d{1,4}$/.test(mesa)) throw Object.assign(new Error('Cédula, centro o mesa inválidos'),{status:400});
          const c=rowsFrom(await turso([{q:'SELECT codigo,nombre,mesas FROM centros WHERE codigo=? LIMIT 1',params:[centro]}]))[0];
          if(!c) throw Object.assign(new Error('Centro no encontrado'),{status:404});
          if(Number(c.mesas||0)>0&&(Number(mesa)<1||Number(mesa)>Number(c.mesas))) throw Object.assign(new Error('La mesa no pertenece al centro'),{status:409});
          const op=rowsFrom(await turso([{q:'SELECT hora_constitucion FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0];
          if(!op?.hora_constitucion) throw Object.assign(new Error('La mesa aún no ha sido constituida'),{status:409});
          const inPadron=rowsFrom(await turso([{q:'SELECT cedula FROM padron WHERE cedula=? AND (centro_votacion=? OR nombre_cv=?) LIMIT 1',params:[cedula,centro,c.nombre||'']}])).length>0;
          if(!inPadron) throw Object.assign(new Error('La persona no pertenece al padrón de este centro'),{status:409});
          const existing=rowsFrom(await turso([{q:'SELECT id,mesa FROM verificaciones_votacion WHERE cedula=? AND centro_codigo=? AND estado=? LIMIT 1',params:[cedula,centro,'VOTO_VERIFICADO']}]))[0];
          if(existing&&String(existing.mesa)!==mesa) throw Object.assign(new Error('La persona ya fue verificada en otra mesa de este centro'),{status:409});
          let id=existing?.id;
          if(!existing){
            await turso([{q:'INSERT INTO verificaciones_votacion(cedula,centro_codigo,mesa,estado,verificado_por) VALUES(?,?,?,?,?)',params:[cedula,centro,mesa,'VOTO_VERIFICADO',actor.id]}]);
            id=rowsFrom(await turso([{q:'SELECT id FROM verificaciones_votacion WHERE cedula=? AND centro_codigo=? AND estado=? LIMIT 1',params:[cedula,centro,'VOTO_VERIFICADO']}]))[0]?.id;
          }
          event.result={id,centro_codigo:centro,mesa};
        }else{
          if(!['J','A'].includes(actor.rol)) throw Object.assign(new Error('Solo Jefe o Administrador puede sincronizar actas'),{status:403});
          const centro=clean(p.centro_codigo,80), mesa=clean(p.mesa,4), votos=Number(p.votos_partido);
          if(!centro||!/^\d{1,4}$/.test(mesa)||!Number.isInteger(votos)||votos<0) throw Object.assign(new Error('Datos del acta inválidos'),{status:400});
          const c=rowsFrom(await turso([{q:'SELECT codigo,mesas FROM centros WHERE codigo=? LIMIT 1',params:[centro]}]))[0];
          if(!c) throw Object.assign(new Error('Centro no encontrado'),{status:404});
          if(Number(c.mesas||0)>0&&(Number(mesa)<1||Number(mesa)>Number(c.mesas))) throw Object.assign(new Error('La mesa no pertenece al centro'),{status:409});
          const state=rowsFrom(await turso([{q:'SELECT estado FROM mesa_operativa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0];
          if(state?.estado==='CERRADA') throw Object.assign(new Error('La mesa está cerrada'),{status:409});
          const existing=rowsFrom(await turso([{q:'SELECT id,votos_partido FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0];
          if(existing&&Number(existing.votos_partido)!==votos) throw Object.assign(new Error('Ya existe un acta con otro resultado; requiere resolución manual de conflicto'),{status:409});
          let id=existing?.id;
          if(!existing){
            const now=new Date().toISOString();
            await turso([{q:'INSERT INTO actas_mesa(centro_codigo,mesa,cantidad_acta,votos_partido,actualizado_en,actualizado_por) VALUES(?,?,?,?,?,?)',params:[centro,mesa,votos,votos,now,actor.id]}]);
            id=rowsFrom(await turso([{q:'SELECT id FROM actas_mesa WHERE centro_codigo=? AND mesa=? LIMIT 1',params:[centro,mesa]}]))[0]?.id;
          }
          event.result={id,centro_codigo:centro,mesa,votos_partido:votos};
        }
        const resultJson=JSON.stringify(event.result||{ok:true});
        await turso([{q:"UPDATE desktop_sync_events SET status='applied',result_json=?,updated_at=datetime('now') WHERE event_id=? AND claim_token=? AND status='processing'",params:[resultJson,eventId,claimToken]}]);
        await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['desktop-sync','Operación local sincronizada: '+type+' • evento '+eventId,actor.id]}]);
        results.push({event_id:eventId,status:'synced',result:event.result});
      }catch(e){
        const status=e.status===409?'conflict':'failed';
        await turso([{q:"UPDATE desktop_sync_events SET status=?,updated_at=datetime('now') WHERE event_id=? AND claim_token=? AND status='processing'",params:[status,eventId,claimToken]}]).catch(()=>{});
        results.push({event_id:eventId,status,error:e.message||'No se pudo aplicar la operación'});
      }
    }
    return res.status(200).json({ok:true,results,server_time:new Date().toISOString()});
  }catch(e){console.error('[desktop-sync]',e);return fail(res,500,'No se pudo sincronizar con el servidor');}
};
