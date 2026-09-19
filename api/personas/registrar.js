const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');
function c(v){return String(v||'').replace(/\D/g,'').slice(0,20)}
function s(v,n){return String(v??'').trim().slice(0,n)}
function tel(v){return s(v,20).replace(/\D/g,'')}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return res.status(401).json({error:'Sesión no válida o expirada'});
    const b=parseBody(req), reclutadorId=Number(b.reclutador_id), cedula=c(b.cedula);
    const telefono=tel(b.telefono), calle=s(b.numero_calle,80), casa=s(b.numero_casa,80), direccion=s(b.direccion,500);
    if(!Number.isInteger(reclutadorId)||reclutadorId<1||!/^[0-9]{5,9}$/.test(cedula)) return res.status(400).json({error:'Datos de registro inválidos'});
    if(telefono && !/^0[0-9]{10}$/.test(telefono)) return res.status(400).json({error:'Teléfono inválido'});
    const dupTelSql="SELECT origen FROM (SELECT 'USUARIO' AS origen, telefono FROM usuarios WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'MOVILIZADOR', telefono FROM reclutadores WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'COMPROMETIDO', telefono FROM asignaciones WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'DIRECCIÓN EJECUTIVA', telefono FROM direccion_ejecutiva WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'COMITÉ VECINAL', telefono FROM comite_vecinal WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'CARGO DE CENTRO', telefono FROM centro_cargos WHERE telefono IS NOT NULL AND telefono!='') WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefono,'-',''),' ',''),'(',''),')','')=? LIMIT 1";
    const found=rowsFrom(await turso([
      {q:'SELECT id,cedula FROM reclutadores WHERE id=? LIMIT 1',params:[reclutadorId]},
      {q:'SELECT cedula FROM padron WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id FROM asignaciones WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id FROM asignaciones WHERE reclutador_id=? AND cedula=? LIMIT 1',params:[reclutadorId,cedula]},
      {q:'SELECT COUNT(*) AS n FROM asignaciones WHERE reclutador_id=?',params:[reclutadorId]},
      {q:dupTelSql,params:[telefono]}
    ]));
    const recl=found[0], pad=found[1];
    if(!recl) return res.status(404).json({error:'Movilizador no encontrado'});
    if(!pad) return res.status(409).json({error:'La cédula no existe en el padrón'});
    if(String(recl.cedula)===cedula) return res.status(409).json({error:'La cédula corresponde al propio movilizador'});
    if(Number(found[4]?.n||0)>=10) return res.status(409).json({error:'La lista ya está completa (10/10)'});
    if(found[2]) return res.status(409).json({error:'La cédula ya está asignada a otra lista o función'});
    if(found[3]) return res.status(409).json({error:'La cédula ya figura en esta lista'});
    if(telefono && found[5]) return res.status(409).json({error:'Teléfono duplicado en '+found[5].origen});
    const pos=Number(found[4]?.n||0)+1;
    await turso([{q:'INSERT INTO asignaciones(reclutador_id,cedula,posicion,telefono,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?,?)',params:[reclutadorId,cedula,pos,telefono||null,calle||null,casa||null,direccion||null]}]);
    await turso([{q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['user','C.I. '+cedula+' registrada en lista de movilizador #'+reclutadorId+' (posición '+pos+')',session.uid]}]);
    return res.status(201).json({ok:true,posicion:pos,cedula});
  }catch(e){return res.status(500).json({error:e.message||'No se pudo registrar la persona'});}
};