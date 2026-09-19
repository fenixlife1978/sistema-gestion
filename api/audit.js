module.exports = async function handler(req, res) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const allowedOrigins = new Set([
    'https://gestion-erp-electoral.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]);
  if (!allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origen no autorizado' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Audit-Key');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auditKey = process.env.AUDIT_KEY;
  if (!auditKey) return res.status(503).json({ error: 'AUDIT_KEY no configurada' });
  if (String(req.headers['x-audit-key'] || '') !== auditKey) {
    return res.status(401).json({ error: 'Clave de auditoría inválida' });
  }

  const rawUrl = String(process.env.TURSO_URL || '').trim();
  const token = process.env.TURSO_TOKEN;
  if (!rawUrl || !token) return res.status(500).json({ error: 'TURSO_URL/TURSO_TOKEN no configurados' });
  const url = rawUrl.startsWith('libsql://')
    ? rawUrl.replace('libsql://', 'https://')
    : (/^https?:\/\//.test(rawUrl) ? rawUrl : 'https://' + rawUrl);

  const statements = [
    { name:'integrity', q:'PRAGMA integrity_check' },
    { name:'duplicados_reclutadores', q:'SELECT cedula, COUNT(*) n FROM reclutadores GROUP BY cedula HAVING COUNT(*) > 1' },
    { name:'duplicados_asignaciones', q:'SELECT cedula, COUNT(*) n FROM asignaciones GROUP BY cedula HAVING COUNT(*) > 1' },
    { name:'duplicados_direccion', q:'SELECT cedula, COUNT(*) n FROM direccion_ejecutiva GROUP BY cedula HAVING COUNT(*) > 1' },
    { name:'duplicados_comite', q:'SELECT cedula, COUNT(*) n FROM comite_vecinal GROUP BY cedula HAVING COUNT(*) > 1' },
    { name:'duplicados_cargos', q:'SELECT cedula, COUNT(*) n FROM centro_cargos WHERE cedula IS NOT NULL AND TRIM(cedula) <> \'\' GROUP BY cedula HAVING COUNT(*) > 1' },
    { name:'duplicados_comunidades', q:'SELECT comunidad, COUNT(*) n FROM comite_vecinal GROUP BY comunidad HAVING COUNT(*) > 1' },
    { name:'cargos_centro_duplicados', q:'SELECT centro_codigo, cargo, COUNT(*) n FROM centro_cargos GROUP BY centro_codigo, cargo HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_usuarios', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM usuarios WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_reclutadores', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM reclutadores WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_asignaciones', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM asignaciones WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_direccion', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM direccion_ejecutiva WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_comite', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM comite_vecinal WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'telefonos_duplicados_cargos', q:'SELECT replace(replace(replace(replace(replace(COALESCE(telefono,\'\'),\' \',\'\'),\'-\',\'\'),\'(\',\'\'),\')\',\'\'),\'+\',\'\') telefono, COUNT(*) n FROM centro_cargos WHERE TRIM(COALESCE(telefono,\'\')) <> \'\' GROUP BY telefono HAVING COUNT(*) > 1' },
    { name:'cne_centro_inconsistente_reclutadores', q:'SELECT r.cedula, r.id FROM reclutadores r JOIN padron p ON p.cedula=r.cedula WHERE TRIM(COALESCE(p.centro_votacion,\'\')) <> TRIM(COALESCE(p.centro_votacion,\'\'))' },
    { name:'asignaciones_sin_reclutador', q:'SELECT a.id FROM asignaciones a LEFT JOIN reclutadores r ON r.id=a.reclutador_id WHERE r.id IS NULL' },
    { name:'cargos_sin_centro', q:'SELECT cc.id FROM centro_cargos cc LEFT JOIN centros c ON c.codigo=cc.centro_codigo WHERE c.codigo IS NULL' }
  ];

  try {
    const r = await fetch(url, {
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({statements:statements.map(s=>({q:s.q,params:[]}))})
    });
    if (!r.ok) return res.status(r.status).json({error:'Turso HTTP '+r.status+': '+await r.text()});
    const data=await r.json();
    const rows=(Array.isArray(data)?data:(data.statements||data)).map((x,i)=>({name:statements[i].name,results:x.results||x}));
    return res.status(200).json({ok:true,generated_at:new Date().toISOString(),audit:rows});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
};
