module.exports = async function handler(req, res) {
  // Este endpoint solo debe ser consumido por la aplicación web del sistema.
  // No se usa '*' porque el endpoint es un proxy con capacidad de ejecutar SQL.
  const origin = String(req.headers.origin || '').replace(/\\/$/, '');
  const allowedOrigins = new Set([
    'https://gestion-erp-electoral.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]);
  const allowed = allowedOrigins.has(origin);
  if (origin && allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!allowed) return res.status(403).json({ error: 'Origen no autorizado' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let rawUrl = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
  if (!rawUrl || !token) return res.status(500).json({ error: 'TURSO_URL y TURSO_TOKEN no configurados en las variables de entorno de Vercel' });

  let url = rawUrl.trim();
  if (url.startsWith('libsql://')) {
    url = url.replace('libsql://', 'https://');
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
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

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ statements: stmts })
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: 'Turso HTTP ' + r.status + ': ' + txt });
    }

    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message || 'Turso error' });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
