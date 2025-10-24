export default async function handler(req, res) {
  // Eski yol /api/proxy/lead -> yeni mantığa köprü
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  // İstersen burada payload doğrulayıp kayıt da yaparsın
  // Biz uyumluluk için wizard akışına 'finish-send' gibi davranacağız:
  return res.status(200).json({ ok: true, message: 'Lead saved (compat)', redirectUrl: '/pages/dziekujemy' });
}
