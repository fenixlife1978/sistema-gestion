const {parseBody,turso,rowsFrom,verify,getCookie}=require('../../lib/auth');
function c(v){return String(v||'').replace(/\D/g,'').slice(0,20)}
function s(v,n){return String(v??'').trim().slice(0,n)}
function tel(v){return s(v,20).replace(/\D/g,'')}
function rowsAt(batch,index){ return rowsFrom([batch?.statements?.[index]||{}]); }

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return res.status(401).json({error:'Sesión no válida o expirada'});

    const b=parseBody(req), reclutadorId=Number(b.reclutador_id), cedula=c(b.cedula);
    const telefono=tel(b.telefono), calle=s(b.numero_calle,80), casa=s(b.numero_casa,80), direccionPersona=s(b.direccion,500);
    if(!Number.isInteger(reclutadorId)||reclutadorId<1||!/^[0-9]{5,9}$/.test(cedula)) return res.status(400).json({error:'Datos de registro inválidos'});
    if(telefono && !/^0[0-9]{10}$/.test(telefono)) return res.status(400).json({error:'Teléfono inválido'});

    const dupTelSql="SELECT origen FROM (SELECT 'USUARIO' AS origen, telefono FROM usuarios WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'MOVILIZADOR', telefono FROM reclutadores WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'COMPROMETIDO', telefono FROM asignaciones WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'DIRECCIÓN EJECUTIVA', telefono FROM direccion_ejecutiva WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'COMITÉ VECINAL', telefono FROM comite_vecinal WHERE telefono IS NOT NULL AND telefono!='' UNION ALL SELECT 'CARGO DE CENTRO', telefono FROM centro_cargos WHERE telefono IS NOT NULL AND telefono!='') WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefono,'-',''),' ',''),'(',''),')','')=? LIMIT 1";

    /*
     * turso() devuelve una respuesta por sentencia. rowsFrom() aplana todas
     * las filas, por lo que no se pueden usar índices del array aplanado para
     * distinguir qué SELECT encontró datos. Conservamos los límites de cada
     * sentencia con rowsAt(). Esto corrige el falso positivo que bloqueaba
     * cédulas libres como si ya estuvieran asignadas.
     */
    const batch=await turso([
      {q:'SELECT r.id,r.cedula,p.centro_votacion,p.nombre_cv FROM reclutadores r LEFT JOIN padron p ON p.cedula=r.cedula WHERE r.id=? LIMIT 1',params:[reclutadorId]},
      {q:'SELECT cedula,centro_votacion,nombre_cv FROM padron WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id,reclutador_id,posicion FROM asignaciones WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT id FROM asignaciones WHERE reclutador_id=? AND cedula=? LIMIT 1',params:[reclutadorId,cedula]},
      {q:'SELECT COUNT(*) AS n FROM asignaciones WHERE reclutador_id=?',params:[reclutadorId]},
      {q:dupTelSql,params:[telefono]}
    ]);

    const recl=rowsAt(batch,0)[0];
    const pad=rowsAt(batch,1)[0];
    const asignacion=rowsAt(batch,2)[0];
    const asignacionPropia=rowsAt(batch,3)[0];
    const cupos=rowsAt(batch,4)[0];
    const telDup=rowsAt(batch,5)[0];

    if(!recl) return res.status(404).json({error:'Movilizador no encontrado'});
    if(!recl.centro_votacion) return res.status(409).json({error:'No se puede registrar el comprometido porque el movilizador no tiene un centro electoral asociado en el Padrón CNE.'});
    if(!pad) return res.status(409).json({error:'La cédula no existe en el padrón CNE'});
    if(!pad.centro_votacion) return res.status(409).json({error:'Registro rechazado: la persona no tiene un centro electoral CNE asociado.'});
    if(String(pad.centro_votacion)!==String(recl.centro_votacion)) return res.status(409).json({error:'Registro rechazado: el aspirante a comprometido no pertenece al mismo centro electoral de su movilizador.,tipo_conflicto:'CENTRO_ELECTORAL_DIFERENTE',centro_movilizador:String(recl.centro_votacion),centro_persona:String(pad.centro_votacion)});
    if(String(recl.cedula)===cedula) return res.status(409).json({error:'La cédula corresponde al propio movilizador'});
    if(Number(cupos?.n||0)>=10) return res.status(409).json({error:'La lista ya está completa (10/10)'});

    /*
     * Las funciones estructurales son incompatibles con una lista 1x10.
     * No se permite autorización para saltar esta regla.
     */
    const funcionesBatch=await turso([
      {q:'SELECT id,cedula FROM reclutadores WHERE cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT a.id,a.reclutador_id,a.posicion,r.cedula AS reclutador_cedula FROM asignaciones a LEFT JOIN reclutadores r ON r.id=a.reclutador_id WHERE a.cedula=? LIMIT 1',params:[cedula]},
      {q:'SELECT cargo FROM direccion_ejecutiva WHERE cedula=? ORDER BY id',params:[cedula]},
      {q:'SELECT comunidad,cargo FROM comite_vecinal WHERE cedula=? ORDER BY id',params:[cedula]},
      {q:'SELECT centro_codigo,cargo FROM centro_cargos WHERE cedula=? ORDER BY id',params:[cedula]}
    ]);

    const movilizadorExistente=rowsAt(funcionesBatch,0)[0];
    const otraLista=rowsAt(funcionesBatch,1)[0];
    const cargosDireccionEjecutiva=rowsAt(funcionesBatch,2);
    const comite=rowsAt(funcionesBatch,3);
    const cargosCentro=rowsAt(funcionesBatch,4);

    if(asignacionPropia){
      return res.status(409).json({
        error:'La persona ya se encuentra registrada en esta lista.',
        tipo_conflicto:'MISMA_LISTA'
      });
    }

    const conflictos=[];
    if(movilizadorExistente){
      conflictos.push('La persona ya está registrada como MOVILIZADOR.');
    }

    if(otraLista){
      const rp=otraLista.reclutador_cedula
        ? rowsFrom(await turso([{
            q:'SELECT letra,p_apellido,s_apellido,p_nombre,s_nombre FROM padron WHERE cedula=? LIMIT 1',
            params:[otraLista.reclutador_cedula]
          }]))[0]
        : null;
      const nombre=rp
        ? (((rp.p_nombre||'')+' '+(rp.s_nombre||'')).trim()+' '+((rp.p_apellido||'')+' '+(rp.s_apellido||'')).trim()).trim()
        : ('C.I. '+(otraLista.reclutador_cedula||''));
      conflictos.push('La persona ya se encuentra registrada en la lista del movilizador '+nombre+'.');
    }

    cargosDireccionEjecutiva.forEach(x=>conflictos.push('Ya ocupa el cargo "'+String(x.cargo||'')+'" en Dirección Ejecutiva.'));
    comite.forEach(x=>conflictos.push('Ya está asignada a Comité Vecinal en la comunidad "'+String(x.comunidad||'')+'" como "'+String(x.cargo||'')+'".'));
    cargosCentro.forEach(x=>conflictos.push('Ya ocupa el cargo "'+String(x.cargo||'')+'" en el centro electoral "'+String(x.centro_codigo||'')+'".'));

    if(conflictos.length){
      return res.status(409).json({
        error:conflictos.join(' '),
        tipo_conflicto:otraLista?'OTRA_LISTA':(cargosDireccionEjecutiva.length||comite.length||cargosCentro.length||movilizadorExistente?'FUNCION':'DUPLICIDAD'),
        conflictos
      });
    }

    if(asignacion){
      return res.status(409).json({
        error:'La persona ya se encuentra asignada a otra lista o función.',
        tipo_conflicto:'OTRA_LISTA'
      });
    }

    if(telefono && telDup) return res.status(409).json({error:'Teléfono duplicado en '+telDup.origen});

    const pos=Number(cupos?.n||0)+1;
    await turso([{
      q:'INSERT INTO asignaciones(reclutador_id,cedula,posicion,telefono,numero_calle,numero_casa,direccion) VALUES(?,?,?,?,?,?,?)',
      params:[reclutadorId,cedula,pos,telefono||null,calle||null,casa||null,direccionPersona||null]
    }]);
    await turso([{
      q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',
      params:['user','C.I. '+cedula+' registrada en lista de movilizador #'+reclutadorId+' (posición '+pos+')',session.uid]
    }]);
    return res.status(201).json({ok:true,posicion:pos,cedula});
  }catch(e){
    console.error('personas-registrar:',e);
    return res.status(500).json({error:e.message||'No se pudo registrar la persona'});
  }
};
