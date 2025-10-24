export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key, X-Shop-Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const { action, step } = req.body || {};
  if (action === "show-results") {
    return res.status(200).json({ ok: true, message: "Wyniki gotowe.", nextStep: (Number(step) || 1) + 1 });
  }
  if (action === "finish-send") {
    return res.status(200).json({ ok: true, message: "Zgłoszenie zapisane.", redirectUrl: "/pages/dziekujemy" });
  }
  res.status(400).json({ ok: false, error: "Invalid action" });
}
