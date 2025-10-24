export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  return res.status(200).json({ ok: true, message: 'CTA recorded (compat)' });
}
