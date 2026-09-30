const {turso,verify,getCookie}=require('../lib/auth');

module.exports = async function handler(req, res) {
  // Este endpoint es un proxy SQL de alto privilegio. El origen CORS por sí
  // solo no constituye autenticación: exigimos una sesión válida antes de
  // aceptar cualquier sentencia.
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const requestHost = String(req.headers.host || '').replace(/\/$/, '');
  const sameOrigin = origin && requestHost && (() => { try { return new URL(origin).host === requestHost; } catch(e) { return false; } })();
  const allowedOrigins = new Set([
    'https://erp-electoral.vercel.app',
    'https://gestion-erp-electoral.vercel.app',
    'https://sistema-gestion-beta.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]);
  const allowed = sameOrigin || allowedOrigins.has(origin);
  if (origin && allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!allowed) return res.status(403).json({ error: 'Origen no autorizado' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = verify(getCookie(req,'erp_session'));
    if (!session) return res.status(401).json({ error: 'Sesión requerida' });
    if (!['J','A','O'].includes(session.rol)) {
      return res.status(403).json({ error: 'Rol de sesión no permitido' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }
    const statements = body.statements;
    if (!statements) return res.status(400).json({ error: 'No se enviaron sentencias SQL' });

    const rawStmts = Array.isArray(statements) ? statements : [statements];
    if (rawStmts.length > 100) return res.status(413).json({ error: 'Demasiadas sentencias en una sola petición' });

    const stmts = rawStmts.map(s => ({ q: s?.q || s?.sql, params: s?.params || s?.args || [] }));
    if (stmts.some(s => typeof s.q !== 'string' || !s.q.trim())) {
      return res.status(400).json({ error: 'Cada sentencia debe contener SQL válido' });
    }
    if (stmts.some(s => s.q.length > 50000)) {
      return res.status(413).json({ error: 'Sentencia SQL demasiado grande' });
    }

    // Este endpoint se usa desde el cliente para consultas de lectura.
    // Las mutaciones pasan por endpoints de negocio autenticados y nunca deben
    // exponerse como SQL arbitrario desde el navegador.
    const readonly = stmts.every(({ q }) => {
      const normalized = q.trim().replace(/^\uFEFF/, '');
      return /^(SELECT|PRAGMA)\b/i.test(normalized);
    });
    if (!readonly) {
      return res.status(403).json({ error: 'El proxy Turso solo permite consultas de lectura' });
    }

    // Usar exactamente el mismo cliente Turso que las demás rutas del sistema.
    // Así TURSO_URL/TURSO_DATABASE_URL y TURSO_TOKEN/TURSO_AUTH_TOKEN
    // siempre apuntan al mismo origen de datos.
    const data = await turso(stmts);
    // El cliente del navegador mantiene el contrato histórico: para una
    // sentencia devuelve un objeto {results:{columns,rows}} y para varias,
    // un arreglo de esos objetos. No exponer directamente la envoltura del
    // pipeline HTTP de Turso porque el frontend espera poder recorrerla.
    const out = Array.isArray(data?.statements) ? data.statements : [];
    return res.status(200).json(Array.isArray(statements) ? out : (out[0] || {results:{columns:[],rows:[]}}));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
