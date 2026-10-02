const {parseBody,turso,rowsFrom,verify,getCookie}=require('../lib/auth');

const st=(v,n)=>String(v??'').trim().slice(0,n);
// Hora oficial de Venezuela (UTC-04:00), persistida con zona para que el corte
// conserve la hora exacta aunque el servidor de Vercel opere en UTC.
const ahoraVenezuela=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).reduce((o,p)=>(o[p.type]=p.value,o),{});
const timestampVenezuela=()=>{const p=ahoraVenezuela();return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'-04:00';};
const fail=(res,c,e)=>res.status(c).json({error:e});

async function calcularCorte(centro_codigo){
  const centros=rowsFrom(await turso([{
    q:'SELECT codigo,nombre,mesas FROM centros WHERE codigo=? LIMIT 1',
    params:[centro_codigo]
  }]));
  const centro=centros[0];
  if(!centro) return null;

  // El universo del corte debe ser exactamente el mismo que muestra
  // Control Electoral: todo elector del padrón CNE perteneciente al centro,
  // independientemente de que tenga 1x10, cargo o función en el sistema.
  const personas=rowsFrom(await turso([{
    q:`SELECT cedula,sexo
        FROM padron
        WHERE centro_votacion=? OR nombre_cv=?`,
    params:[centro_codigo,centro.nombre||'']
  }]));

  const verificados=rowsFrom(await turso([{
    q:`SELECT v.cedula,v.mesa,p.sexo
        FROM verificaciones_votacion v
        JOIN padron p ON p.cedula=v.cedula
        WHERE (p.centro_votacion=? OR p.nombre_cv=?)`,
    params:[centro_codigo,centro.nombre||'']
  }]));

  const universo=new Set(personas.map(x=>String(x.cedula)));
  const vs=verificados.filter(x=>universo.has(String(x.cedula)));
  const mM=personas.filter(x=>String(x.sexo||'').toUpperCase()==='M').length;
  const mF=personas.filter(x=>String(x.sexo||'').toUpperCase()==='F').length;
  const vM=vs.filter(x=>String(x.sexo||'').toUpperCase()==='M').length;
  const vF=vs.filter(x=>String(x.sexo||'').toUpperCase()==='F').length;

  const mesas=Math.max(1,Number(centro.mesas||1));
  // Solo las actas de mesas CERRADAS entran en la conciliación del corte.
  // Un acta cargada pero todavía abierta no representa el resultado definitivo.
  const actas=rowsFrom(await turso([{
    q:'SELECT a.mesa,a.votos_partido FROM actas_mesa a JOIN mesa_operativa m ON m.centro_codigo=a.centro_codigo AND m.mesa=a.mesa WHERE a.centro_codigo=? AND m.estado=\'CERRADA\' ORDER BY CAST(a.mesa AS INTEGER),a.mesa',
    params:[centro_codigo]
  }]));
  const actaByMesa=new Map(actas.map(a=>[String(a.mesa),Number(a.votos_partido||0)]));
  const detalle=[];
  for(let i=1;i<=mesas;i++){
    const mesa=String(i);
    const vv=vs.filter(x=>String(x.mesa||'')===mesa).length;
    const tiene=actaByMesa.has(mesa);
    const votos=tiene?actaByMesa.get(mesa):null;
    detalle.push({mesa,verificados:vv,votos_partido:votos,diferencia:tiene?vv-votos:null});
  }
  const mesasConActa=detalle.filter(x=>x.votos_partido!==null).length;
  const votosPartido=detalle.reduce((a,x)=>a+(x.votos_partido===null?0:x.votos_partido),0);
  const verifConActa=detalle.filter(x=>x.votos_partido!==null).reduce((a,x)=>a+x.verificados,0);
  const personasUniverso=personas.length;
  const verificadosCount=vs.length;
  return {
    personas_universo:personasUniverso,
    verificados:verificadosCount,
    pendientes:Math.max(0,personasUniverso-verificadosCount),
    porcentaje_verificado:personasUniverso?verificadosCount/personasUniverso*100:0,
    masculinos_universo:mM,
    femeninos_universo:mF,
    masculinos_verificados:vM,
    femeninos_verificados:vF,
    mesas_total:mesas,
    mesas_con_acta:mesasConActa,
    votos_partido_acta:votosPartido,
    // Brecha positiva = votos CNE por encima de los verificados del centro.
    // Sin mesas cerradas, la brecha permanece neutra.
    diferencia_acta:mesasConActa?votosPartido-verificadosCount:null,
    detalle_json:JSON.stringify(detalle)
  };
}

module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return fail(res,405,'Method not allowed');

  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return fail(res,401,'Sesión no válida o expirada');
    if(!['J','A','O','C'].includes(session.rol)) return fail(res,403,'Rol de sesión no permitido');

    const b=parseBody(req);
    const centro=st(b.centro_codigo,80);
    const etiqueta=st(b.etiqueta,160);
    if(!centro) return fail(res,400,'Centro electoral obligatorio');

    const met=await calcularCorte(centro);
    if(!met) return fail(res,404,'Centro electoral no encontrado');

    const insert=await turso([{
      q:`INSERT INTO cortes_electorales
        (centro_codigo,etiqueta,tomado_en,tomado_por,personas_universo,verificados,pendientes,
         porcentaje_verificado,masculinos_universo,femeninos_universo,masculinos_verificados,
         femeninos_verificados,mesas_total,mesas_con_acta,votos_partido_acta,diferencia_acta,detalle_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params:[
        centro,etiqueta||null,timestampVenezuela(),session.uid,met.personas_universo,met.verificados,met.pendientes,
        met.porcentaje_verificado,met.masculinos_universo,met.femeninos_universo,
        met.masculinos_verificados,met.femeninos_verificados,met.mesas_total,
        met.mesas_con_acta,met.votos_partido_acta,met.diferencia_acta,met.detalle_json
      ]
    }]);

    const row=rowsFrom(await turso([{
      q:'SELECT id,centro_codigo,etiqueta,tomado_en,tomado_por,personas_universo,verificados,pendientes,porcentaje_verificado,masculinos_universo,femeninos_universo,masculinos_verificados,femeninos_verificados,mesas_total,mesas_con_acta,votos_partido_acta,diferencia_acta,detalle_json FROM cortes_electorales WHERE centro_codigo=? AND tomado_por=? ORDER BY id DESC LIMIT 1',
      params:[centro,session.uid]
    }]))[0]||null;

    if(!row?.id) return fail(res,500,'Turso no confirmó el corte después del alta');

    // El corte ya está confirmado en la tabla principal. La actividad alimenta
    // la sincronización global, pero un fallo secundario no debe convertir un
    // corte válido en un falso error para el operador.
    let syncAdvertencia=null;
    try{
      await turso([{
        q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',
        params:['corte','Corte de métricas • Centro '+centro+' • '+(row.etiqueta||'Sin etiqueta'),session.uid]
      }]);
    }catch(e){
      syncAdvertencia='El corte quedó guardado, pero la actividad de sincronización no pudo registrarse.';
      console.error('actividad_corte',e);
    }

    return res.status(201).json({ok:true,corte:row,sync_advertencia:syncAdvertencia});
  }catch(e){
    return fail(res,500,e.message||'No se pudo guardar el corte');
  }
};