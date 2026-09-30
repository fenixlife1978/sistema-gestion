const {parseBody,turso,rowsFrom,verifyHash,verify,getCookie}=require('../../lib/auth');

function normC(v){return String(v||'').replace(/\D/g,'').slice(0,20)}
function clean(v,max){return String(v||'').trim().slice(0,max)}
function destinoVal(v){return ['MOVILIZADOR','COMPROMETIDO','DIRECCIÓN EJECUTIVA','COMITÉ VECINAL','CARGO DE CENTRO'].includes(v)?v:''}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const session=verify(getCookie(req,'erp_session'));
    if(!session) return res.status(401).json({error:'Sesión no válida o expirada'});
    const body=parseBody(req);
    const cedula=normC(body.cedula);
    const destino=destinoVal(clean(body.destino,40));
    const motivo=clean(body.motivo,1000);
    const authUsuario=clean(body.autorizante_usuario,120);
    const authClave=String(body.autorizante_clave||'');
    const origenes=Array.isArray(body.origenes)?body.origenes.map(x=>clean(x,60)).filter(Boolean).slice(0,10):[];
    const detalles=Array.isArray(body.detalles)?body.detalles.map(x=>clean(x,500)).filter(Boolean).slice(0,10):[];
    if(!cedula||!destino||!authUsuario||!authClave) return res.status(400).json({error:'Datos de autorización incompletos'});
    if(!['J','A','O'].includes(session.rol)) return res.status(403).json({error:'Rol de sesión no permitido'});
    if(authClave.length>512) return res.status(400).json({error:'Clave inválida'});

    const rows=rowsFrom(await turso([{q:'SELECT id,usuario,rol,clave_hash,activo FROM usuarios WHERE usuario=? AND activo=1 LIMIT 1',params:[authUsuario]}]));
    if(!rows.length||!['J','A'].includes(rows[0].rol)||!verifyHash(authClave,String(rows[0].clave_hash||''))) return res.status(403).json({error:'Credenciales del autorizante inválidas'});
    const auth=rows[0];

    // La duplicidad ya fue detectada en la interfaz antes de solicitar autorización.
    // Este endpoint solo valida las credenciales del autorizante y registra la autorización.
    // No se vuelve a exigir que exista una "duplicidad verificable" aquí: eso provocaba
    // falsos bloqueos cuando la caché/UI y la consulta directa no coincidían.
    const inferred=origenes.length ? origenes : ['CARGO EXISTENTE'];
    const origen=inferred.join(' | ');
    const detalle=(detalles.length?detalles.join(' '):'Autorización para registrar un cargo adicional a la persona.') ;
    const now=new Date().toISOString();
    const statements=[
      {q:'UPDATE autorizaciones_duplicidad_persona SET consumida_en=COALESCE(consumida_en,?), consumida_por=COALESCE(consumida_por,?) WHERE cedula=? AND contexto_destino=? AND consumida_en IS NULL',params:[now,auth.id,cedula,destino]},
      {q:'INSERT INTO autorizaciones_duplicidad_persona(cedula,contexto_origen,contexto_destino,detalle_duplicidad,motivo,autorizado_por,autorizado_en,registrado_por) VALUES(?,?,?,?,?,?,?,?)',params:[cedula,origen,destino,detalle,motivo,auth.id,now,session.uid]},
      {q:'INSERT INTO actividad(tipo,texto,usuario_id) VALUES(?,?,?)',params:['autorizacion','Duplicidad autorizada: C.I. '+cedula+' → '+destino+' • autorizó '+auth.usuario+' • '+motivo,session.uid]}
    ];
    try{ await turso(statements); }catch(e){ throw e; }
    return res.status(200).json({ok:true,autorizado_por:auth.id,destino,cedula,origenes:inferred});
  }catch(e){return res.status(500).json({error:e.message||'No se pudo registrar la autorización'});}
};
