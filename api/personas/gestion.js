const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');

const rolesPermitidos=['J','A','O'];
const CED=/^\d{5,9}$/;
const TEL=/^0\d{3}-\d{7}$/;

function s(v){ return v===undefined||v===null?'':String(v).trim(); }
function n(v){ const x=Number(v); return Number.isInteger(x)?x:0; }
function edad(fecha){
  if(!fecha) return 0;
  const d=new Date(String(fecha)+'T00:00:00');
  if(Number.isNaN(d.getTime())) return 0;
  const now=new Date(); let e=now.getFullYear()-d.getFullYear();
  const m=now.getMonth()-d.getMonth();
  if(m<0 || (m===0 && now.getDate()<d.getDate())) e--;
  return e>=0&&e<=130?e:0;
}
function normTel(v){ const x=s(v).replace(/\D/g,''); return x ? x.slice(0,4)+'-'+x.slice(4) : ''; }

async function actor(req){
  const session=verify(getCookie(req,'erp_session'));
  if(!session) return null;
  const rows=rowsFrom(await turso([{q:'SELECT id,usuario,rol,activo FROM usuarios WHERE id=? AND activo=1 LIMIT 1',params:[session.uid]}]));
  const a=rows[0];
  if(!a || a.usuario!==session.usuario || !rolesPermitidos.includes(a.rol)) return null;
  return a;
}
async function log(a,texto){
  try{ await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user',texto,a.id]}]); }catch(e){ console.error('actividad:',e); }
}
async function exec(statements){ return turso(statements); }

module.exports=async function(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const a=await actor(req);
  if(!a) return res.status(401).json({error:'Sesión no válida o permisos insuficientes'});
  const b=parseBody(req), action=s(b.action);
  try{
    if(action==='crear_reclutador'){
      const ced=s(b.cedula), tel=s(b.telefono), estructura=s(b.estructura), numero_calle=s(b.numero_calle), numero_casa=s(b.numero_casa), direccion=s(b.direccion);
      if(!CED.test(ced)) return res.status(400).json({error:'Cédula inválida'});
      if(tel && !TEL.test(tel.replace(/\D/g,''))) return res.status(400).json({error:'Teléfono inválido'});
      const p=rowsFrom(await exec([{q:'SELECT * FROM padron WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(!p) return res.status(404).json({error:'La persona no existe en el padrón'});
      const dup=rowsFrom(await exec([{q:'SELECT id,cedula FROM reclutadores WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(dup) return res.status(409).json({error:'La persona ya es movilizador'});

      // Una persona puede ejercer varios cargos simultáneamente. Solo bloqueamos
      // el nuevo cargo si existe otro cargo y no hay una autorización vigente para
      // el destino MOVILIZADOR.
      const cross=rowsFrom(await exec([{
        q:`SELECT tipo FROM (
          SELECT 'COMPROMETIDO' AS tipo FROM asignaciones WHERE cedula=? LIMIT 1
          UNION ALL SELECT 'DIRECCIÓN EJECUTIVA' FROM direccion_ejecutiva WHERE cedula=? LIMIT 1
          UNION ALL SELECT 'COMITÉ VECINAL' FROM comite_vecinal WHERE cedula=? LIMIT 1
          UNION ALL SELECT 'CARGO DE CENTRO' FROM centro_cargos WHERE cedula=? LIMIT 1
        )`,params:[ced,ced,ced,ced]
      }]));
      let autorizacionId=null;
      if(cross.length){
        const auth=rowsFrom(await exec([{
          q:'SELECT id FROM autorizaciones_duplicidad_persona WHERE cedula=? AND contexto_destino=? AND consumida_en IS NULL ORDER BY id DESC LIMIT 1',
          params:[ced,'MOVILIZADOR']
        }]))[0];
        if(!auth) return res.status(409).json({error:'La persona ya tiene otro cargo y requiere autorización para ser registrada como movilizador'});
        autorizacionId=Number(auth.id);
      }

      const now=new Date().toISOString();
      const statements=[];
      if(autorizacionId){
        statements.push({q:'BEGIN',params:[]});
        statements.push({q:'UPDATE autorizaciones_duplicidad_persona SET consumida_en=?, consumida_por=? WHERE id=? AND consumida_en IS NULL',params:[now,a.id,autorizacionId]});
        statements.push({q:'INSERT INTO reclutadores(cedula,telefono,estructura,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?)',params:[ced,tel?normTel(tel):null,estructura||null,numero_calle||null,numero_casa||null,direccion||null]});
        statements.push({q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Nuevo movilizador creado: '+ced+' • autorización #'+autorizacionId+' consumida',a.id]});
        statements.push({q:'COMMIT',params:[]});
      }else{
        statements.push({q:'INSERT INTO reclutadores(cedula,telefono,estructura,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?)',params:[ced,tel?normTel(tel):null,estructura||null,numero_calle||null,numero_casa||null,direccion||null]});
      }
      const out=await exec(statements);
      const row=rowsFrom(out).find(x=>x.id!==undefined)||{};
      if(!autorizacionId) await log(a,'Nuevo movilizador creado: '+ced);
      return res.json({ok:true,id:row.id||null});
    }

    if(action==='crear_reclutador_manual'){
      const ced=s(b.cedula), letra=s(b.letra)||'V', pa=s(b.p_apellido), sa=s(b.s_apellido), pn=s(b.p_nombre), sn=s(b.s_nombre);
      const sexo=s(b.sexo), fecha=s(b.fecha_nac), tel=s(b.telefono), estructura=s(b.estructura), numero_calle=s(b.numero_calle), numero_casa=s(b.numero_casa), direccion=s(b.direccion);
      const cv= b.centro || {};
      if(!CED.test(ced)||!pa||!pn) return res.status(400).json({error:'Datos personales incompletos'});
      if(!['V','E'].includes(letra)||!['M','F'].includes(sexo)) return res.status(400).json({error:'Datos de identidad inválidos'});
      if(tel && !TEL.test(tel.replace(/\D/g,''))) return res.status(400).json({error:'Teléfono inválido'});
      const exists=rowsFrom(await exec([{q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(exists) return res.status(409).json({error:'La cédula ya existe en el padrón'});
      if(!s(cv.codigo)) return res.status(400).json({error:'Centro electoral requerido'});
      const centro=rowsFrom(await exec([{q:'SELECT * FROM centros WHERE codigo=? LIMIT 1',params:[s(cv.codigo)]}]))[0];
      if(!centro) return res.status(400).json({error:'Centro electoral no existe'});
      const sql=[
        {q:'INSERT INTO padron(cedula,letra,p_apellido,s_apellido,p_nombre,s_nombre,sexo,fecha_nac,edad,codigo_estado,estado,codigo_municipio,municipio,codigo_parroquia,parroquia,centro_votacion,nombre_cv,es_manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
         params:[ced,letra,pa,sa,pn,sn,sexo,fecha,edad(fecha),centro.cod_estado,centro.estado,centro.cod_municipio,centro.municipio,centro.cod_parroquia,centro.parroquia,centro.codigo,centro.nombre]},
        {q:'INSERT INTO reclutadores(cedula,telefono,estructura,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?)',params:[ced,tel?normTel(tel):null,estructura||null,numero_calle||null,numero_casa||null,direccion||null]}
      ];
      const out=await exec(sql);
      await log(a,'Movilizador creado manual: '+letra+'-'+ced);
      const rr=rowsFrom(out).pop()||{};
      return res.json({ok:true,id:rr.id||null});
    }

    if(action==='crear_comprometido_manual'){
      const ced=s(b.cedula), letra=s(b.letra)||'V', pa=s(b.p_apellido), sa=s(b.s_apellido), pn=s(b.p_nombre), sn=s(b.s_nombre);
      const sexo=s(b.sexo), fecha=s(b.fecha_nac), tel=s(b.telefono), calle=s(b.numero_calle), casa=s(b.numero_casa), dir=s(b.direccion);
      const rid=n(b.reclutador_id), cv=b.centro||{};
      if(!CED.test(ced)||!pa||!pn||!rid) return res.status(400).json({error:'Datos del comprometido incompletos'});
      if(!['V','E'].includes(letra)||!['M','F'].includes(sexo)) return res.status(400).json({error:'Datos de identidad inválidos'});
      if(tel && !TEL.test(tel.replace(/\D/g,''))) return res.status(400).json({error:'Teléfono inválido'});
      const r=rowsFrom(await exec([{q:'SELECT id,cedula FROM reclutadores WHERE id=? LIMIT 1',params:[rid]}]))[0];
      if(!r) return res.status(404).json({error:'Movilizador no existe'});
      const cnt=Number(rowsFrom(await exec([{q:'SELECT COUNT(*) n FROM asignaciones WHERE reclutador_id=?',params:[rid]}]))[0]?.n||0);
      if(cnt>=10) return res.status(409).json({error:'El movilizador ya tiene 10 compromisos'});
      const exists=rowsFrom(await exec([{q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(exists) return res.status(409).json({error:'La cédula ya existe en el padrón'});
      const any=rowsFrom(await exec([{q:'SELECT reclutador_id FROM asignaciones WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(any) return res.status(409).json({error:'La persona ya está asignada a otro movilizador'});
      if(!s(cv.codigo)) return res.status(400).json({error:'Centro electoral requerido'});
      const centro=rowsFrom(await exec([{q:'SELECT * FROM centros WHERE codigo=? LIMIT 1',params:[s(cv.codigo)]}]))[0];
      if(!centro) return res.status(400).json({error:'Centro electoral no existe'});
      const max=Number(rowsFrom(await exec([{q:'SELECT COALESCE(MAX(posicion),0) m FROM asignaciones WHERE reclutador_id=?',params:[rid]}]))[0]?.m||0);
      const pos=max+1;
      await exec([
        {q:'INSERT INTO padron(cedula,letra,p_apellido,s_apellido,p_nombre,s_nombre,sexo,fecha_nac,edad,codigo_estado,estado,codigo_municipio,municipio,codigo_parroquia,parroquia,centro_votacion,nombre_cv,es_manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',params:[ced,letra,pa,sa,pn,sn,sexo,fecha,edad(fecha),centro.cod_estado,centro.estado,centro.cod_municipio,centro.municipio,centro.cod_parroquia,centro.parroquia,centro.codigo,centro.nombre]},
        {q:'INSERT INTO asignaciones(reclutador_id,cedula,posicion,telefono,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?,?)',params:[rid,ced,pos,tel?normTel(tel):null,calle||null,casa||null,dir||null]}
      ]);
      await log(a,'Alta manual CNE y asignación: '+letra+'-'+ced+' en lista #'+rid);
      return res.json({ok:true,posicion:pos});
    }

    if(action==='agregar_asignacion'){
      const rid=n(b.reclutador_id), ced=s(b.cedula), tel=s(b.telefono), calle=s(b.numero_calle), casa=s(b.numero_casa), dir=s(b.direccion);
      if(!rid||!CED.test(ced)) return res.status(400).json({error:'Datos de asignación inválidos'});
      if(tel && !TEL.test(tel.replace(/\D/g,''))) return res.status(400).json({error:'Teléfono inválido'});
      const r=rowsFrom(await exec([{q:'SELECT id,cedula FROM reclutadores WHERE id=? LIMIT 1',params:[rid]}]))[0];
      if(!r) return res.status(404).json({error:'Movilizador no existe'});
      if(r.cedula===ced) return res.status(409).json({error:'La cédula corresponde al propio movilizador'});
      const p=rowsFrom(await exec([{q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(!p) return res.status(404).json({error:'La persona no existe en el padrón'});
      const cnt=Number(rowsFrom(await exec([{q:'SELECT COUNT(*) n FROM asignaciones WHERE reclutador_id=?',params:[rid]}]))[0]?.n||0);
      if(cnt>=10) return res.status(409).json({error:'El movilizador ya tiene 10 compromisos'});
      const own=rowsFrom(await exec([{q:'SELECT id FROM asignaciones WHERE reclutador_id=? AND cedula=? LIMIT 1',params:[rid,ced]}]))[0];
      if(own) return res.status(409).json({error:'La persona ya está en esta lista'});
      const any=rowsFrom(await exec([{q:'SELECT reclutador_id FROM asignaciones WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
      if(any) return res.status(409).json({error:'La persona ya está asignada a otro movilizador'});
      const max=Number(rowsFrom(await exec([{q:'SELECT COALESCE(MAX(posicion),0) m FROM asignaciones WHERE reclutador_id=?',params:[rid]}]))[0]?.m||0);
      const pos=max+1;
      await exec([{q:'INSERT INTO asignaciones(reclutador_id,cedula,posicion,telefono,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?,?)',params:[rid,ced,pos,tel?normTel(tel):null,calle||null,casa||null,dir||null]}]);
      await log(a,'C.I. '+ced+' agregada a lista #'+rid+' posición #'+pos);
      return res.json({ok:true,posicion:pos});
    }

    if(action==='actualizar_asignacion'){
      const rid=n(b.reclutador_id), ced=s(b.cedula), tel=s(b.telefono), calle=s(b.numero_calle), casa=s(b.numero_casa), dir=s(b.direccion);
      if(!rid||!CED.test(ced)) return res.status(400).json({error:'Datos inválidos'});
      if(tel && !TEL.test(tel.replace(/\D/g,''))) return res.status(400).json({error:'Teléfono inválido'});
      const hit=rowsFrom(await exec([{q:'SELECT id FROM asignaciones WHERE reclutador_id=? AND cedula=? LIMIT 1',params:[rid,ced]}]))[0];
      if(!hit) return res.status(404).json({error:'Asignación no encontrada'});
      await exec([{q:'UPDATE asignaciones SET telefono=?,numero_calle=?,numero_casa=?,direccion=? WHERE id=?',params:[tel?normTel(tel):null,calle||null,casa||null,dir||null,hit.id]}]);
      await log(a,'Datos de contacto actualizados en asignación #'+hit.id);
      return res.json({ok:true});
    }

    if(action==='eliminar_asignacion'){
      const rid=n(b.reclutador_id), ced=s(b.cedula);
      if(!rid||!CED.test(ced)) return res.status(400).json({error:'Datos inválidos'});
      const hit=rowsFrom(await exec([{q:'SELECT id FROM asignaciones WHERE reclutador_id=? AND cedula=? LIMIT 1',params:[rid,ced]}]))[0];
      if(!hit) return res.status(404).json({error:'Asignación no encontrada'});
      await exec([{q:'DELETE FROM asignaciones WHERE id=?',params:[hit.id]}]);
      await log(a,'C.I. '+ced+' retirada de lista #'+rid);
      return res.json({ok:true});
    }

    if(action==='eliminar_reclutador'){
      const id=n(b.id);
      if(!id) return res.status(400).json({error:'Movilizador inválido'});
      const hit=rowsFrom(await exec([{q:'SELECT id,cedula FROM reclutadores WHERE id=? LIMIT 1',params:[id]}]))[0];
      if(!hit) return res.status(404).json({error:'Movilizador no encontrado'});
      await exec([{q:'DELETE FROM reclutadores WHERE id=?',params:[id]}]);
      await log(a,'Movilizador #'+id+' eliminado');
      return res.json({ok:true});
    }
    return res.status(400).json({error:'Acción no permitida'});
  }catch(e){
    console.error('personas-gestion:',e);
    const msg=String(e.message||'Error de base de datos');
    if(/unique|constraint/i.test(msg)) return res.status(409).json({error:'La operación entra en conflicto con un registro existente'});
    return res.status(500).json({error:msg});
  }
};
