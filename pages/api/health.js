// Basit sağlık kontrolü: GET /api/health → { ok:true, env:"up" }
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Idempotency-Key, X-Shop-Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({ ok: true, env: 'up' });
}
