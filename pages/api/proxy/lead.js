export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*"); // istersen env ile kısıtlayabiliriz
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key, X-Shop-Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // --- burada payload'ı alıp kaydedebilirsin ---
  // const body = req.body || {};
  // örnek davranış: wizard'daki "finish-send" ile aynı sonucu ver
  return res.status(200).json({
    ok: true,
    message: "Lead saved (compat)",
    redirectUrl: "/pages/dziekujemy"
  });
}
