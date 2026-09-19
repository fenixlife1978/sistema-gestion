const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');
const CED=/^\d{5,9}$/, TEL=/^0\d{3}-\d{7}$/;
const s=v=>v==null?'':String(v).trim();
const ci=v=>s(v).replace(/\D/g,'');
const normTel=v=>{const x=ci(v);return x?x.slice(0,4)+'-'+x.slice(4):''};
const edad=f=>{if(!f)return 0;const d=new Date(s(f)+'T00:00:00');if(Number.isNaN(d.getTime()))return 0;const n=new Date();let e=n.getFullYear()-d.getFullYear();const m=n.getMonth()-d.getMonth();if(m<0||(m===0&&n.getDate()<d.getDate()))e--;return e>=0&&e<=130?e:0};
async function actor(req){const se=verify(getCookie(req,'erp_session'));if(!se)return null;const a=rowsFrom(await turso([{q:'SELECT id,usuario,rol FROM usuarios WHERE id=? AND activo=1 LIMIT 1',params:[se.uid]}]))[0];return a&&a.usuario===se.usuario&&['J','A','O'].includes(a.rol)?a:null}
async function conflict(ced){const q=await turso([
 {q:'SELECT 1 FROM reclutadores WHERE cedula=? LIMIT 1',params:[ced]},
 {q:'SELECT 1 FROM asignaciones WHERE cedula=? LIMIT 1',params:[ced]},
 {q:'SELECT 1 FROM direccion_ejecutiva WHERE cedula=? LIMIT 1',params:[ced]},
 {q:'SELECT 1 FROM centro_cargos WHERE cedula=? LIMIT 1',params:[ced]}
]);return q.map((r,i)=>rowsFrom(r).length?['MOVILIZADOR','COMPROMETIDO','DIRECCIÓN EJECUTIVA','CARGO DE CENTRO'][i]:null).filter(Boolean)}
module.exports=async function(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const a=await actor(req);if(!a)return res.status(401).json({error:'Sesión requerida'});
 const b=parseBody(req), action=s(b.action);
 try{
  if(action==='guardar'){
   const comunidad=s(b.comunidad),ced=ci(b.cedula),letra=s(b.letra)||'V',pa=s(b.p_apellido),sa=s(b.s_apellido),pn=s(b.p_nombre),sn=s(b.s_nombre),sexo=s(b.sexo),fecha=s(b.fecha_nac),tel=s(b.telefono),dir=s(b.direccion),calle=s(b.numero_calle),casa=s(b.numero_casa),prob=s(b.problematica),cv=s(b.centro_codigo);
   if(!comunidad||!CED.test(ced)||!pa||!pn||!['V','E'].includes(letra)||!['M','F'].includes(sexo))return res.status(400).json({error:'Datos de comité inválidos'});
   if(tel&&!TEL.test(tel.replace(/\D/g,'')))return res.status(400).json({error:'Teléfono inválido'});
   const cen=rowsFrom(await turso([{q:'SELECT * FROM centros WHERE codigo=? LIMIT 1',params:[cv]}]))[0];if(!cen)return res.status(400).json({error:'Centro electoral no existe'});
   const p=rowsFrom(await turso([{q:'SELECT * FROM padron WHERE cedula=? LIMIT 1',params:[ced]}]))[0];
   if(p&&p.centro_votacion&&(p.centro_votacion!==cv&&p.nombre_cv!==cen.nombre))return res.status(409).json({error:'La persona pertenece a otro centro electoral'});
   if(!p){
    const cs=await conflict(ced);
    if(cs.length){const auth=rowsFrom(await turso([{q:'SELECT id FROM autorizaciones_duplicidad_persona WHERE cedula=? AND contexto_destino=? ORDER BY id DESC LIMIT 1',params:[ced,'COMITÉ VECINAL']}]))[0];if(!auth)return res.status(409).json({error:'La persona ya figura en '+cs.join(', ')+' y requiere autorización J/A para Comité Vecinal'});}
    await turso([{q:'INSERT INTO padron(cedula,letra,p_apellido,s_apellido,p_nombre,s_nombre,sexo,fecha_nac,edad,codigo_estado,estado,codigo_municipio,municipio,codigo_parroquia,parroquia,centro_votacion,nombre_cv,es_manual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',params:[ced,letra,pa,sa,pn,sn,sexo,fecha,edad(fecha),cen.cod_estado,cen.estado,cen.cod_municipio,cen.municipio,cen.cod_parroquia,cen.parroquia,cen.codigo,cen.nombre]}]);
   }
   await turso([{q:'DELETE FROM comite_vecinal WHERE comunidad=? OR cedula=?',params:[comunidad,ced]},{q:'INSERT INTO comite_vecinal(comunidad,cedula,nombre,telefono,direccion,numero_calle,numero_casa,problematica_actual) VALUES(?,?,?,?,?,?,?,?)',params:[comunidad,ced,pa+(sa?' '+sa:'')+', '+pn+(sn?' '+sn:''),tel?normTel(tel):null,dir||null,calle||null,casa||null,prob||null]}]);
   const row=rowsFrom(await turso([{q:'SELECT id FROM comite_vecinal WHERE comunidad=? AND cedula=? ORDER BY id DESC LIMIT 1',params:[comunidad,ced]}]))[0];
   await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Alta Comité Vecinal: C.I. '+ced+' → '+comunidad,a.id]}]);
   return res.json({ok:true,id:row?.id||null});
  }
  if(action==='editar'){
   const id=Number(b.id),tel=s(b.telefono),dir=s(b.direccion),calle=s(b.numero_calle),casa=s(b.numero_casa),prob=s(b.problematica);
   if(!id)return res.status(400).json({error:'Registro inválido'});if(tel&&!TEL.test(tel.replace(/\D/g,'')))return res.status(400).json({error:'Teléfono inválido'});
   const hit=rowsFrom(await turso([{q:'SELECT id FROM comite_vecinal WHERE id=? LIMIT 1',params:[id]}]))[0];if(!hit)return res.status(404).json({error:'Registro no encontrado'});
   await turso([{q:'UPDATE comite_vecinal SET telefono=?,direccion=?,numero_calle=?,numero_casa=?,problematica_actual=? WHERE id=?',params:[tel?normTel(tel):null,dir||null,calle||null,casa||null,prob||null,id]},{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Comité Vecinal actualizado #'+id,a.id]}]);
   return res.json({ok:true});
  }
  if(action==='eliminar'){
   const id=Number(b.id);if(!id)return res.status(400).json({error:'Registro inválido'});
   await turso([{q:'DELETE FROM comite_vecinal WHERE id=?',params:[id]},{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Comité Vecinal eliminado #'+id,a.id]}]);return res.json({ok:true});
  }
  if(action==='problemas'){
   const id=Number(b.comite_id),ids=Array.isArray(b.problema_ids)?b.problema_ids.map(Number).filter(x=>Number.isInteger(x)&&x>0):[];
   if(!id)return res.status(400).json({error:'Comité inválido'});
   const hit=rowsFrom(await turso([{q:'SELECT id FROM comite_vecinal WHERE id=? LIMIT 1',params:[id]}]))[0];if(!hit)return res.status(404).json({error:'Comité no encontrado'});
   await turso([{q:'DELETE FROM comite_problemas WHERE comite_id=?',params:[id]},...ids.map(pid=>({q:'INSERT OR IGNORE INTO comite_problemas(comite_id,problema_id) VALUES(?,?)',params:[id,pid]})),{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','Problemáticas actualizadas en Comité #'+id,a.id]}]);return res.json({ok:true});
  }
  return res.status(400).json({error:'Acción no permitida'});
 }catch(e){console.error('comite:',e);return res.status(500).json({error:e.message||'No se pudo modificar el comité'});}
};
