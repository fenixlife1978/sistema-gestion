const {turso} = require('../lib/auth');

module.exports = async function handler(req, res) {
  // Este endpoint solo debe ser consumido por la aplicación web del sistema.
  // No se usa '*' porque el endpoint es un proxy con capacidad de ejecutar SQL.
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const requestHost = String(req.headers.host || '').replace(/\/$/, '');
  const sameOrigin = origin && requestHost && (() => { try { return new URL(origin).host === requestHost; } catch(e) { return false; } })();
  const allowedOrigins = new Set([
    'https://erp-electoral.vercel.app',
    'https://gestion-erp-electoral.vercel.app',
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

        const data = await turso(stmts);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
