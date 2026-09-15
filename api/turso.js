module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

    const stmts = Array.isArray(statements)
      ? statements.map(s => ({ q: s.q || s.sql, params: s.params || s.args || [] }))
      : [{ q: statements.q || statements.sql, params: statements.params || statements.args || [] }];

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
