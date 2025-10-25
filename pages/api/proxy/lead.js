// LaBalancia — B2B Wizard lead endpoint (pages/api, JS)
// - CORS
// - Shopify Admin: müşteri bul/oluştur + note/tags ekle
// - E-posta: Resend (ENV varsa; yoksa atlanır)
// - Dönen payload: { ok, customer_id, customer_created, mail_user, mail_admin }

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // örn: my-shop.myshopify.com
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION  = process.env.SHOPIFY_API_VERSION || "2024-07";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM      = process.env.MAIL_FROM || "no-reply@labalancia.com";
const MAIL_TO_ADMIN  = process.env.MAIL_TO_ADMIN || "b2b@labalancia.com";

// ---- Yardımcılar ----
function sendJson(res, status, data) {
  res.status(status).json(data);
}
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key, X-Shop-Origin");
}
function escapeHtml(s) {
  return (s || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

// ---- Shopify REST helpers ----
async function shopifyFetch(path, init) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error("SHOPIFY env eksik (SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN)");
  }
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Shopify ${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

async function findCustomerByEmail(email) {
  const q = encodeURIComponent(`email:${email}`);
  const data = await shopifyFetch(`/customers/search.json?query=${q}`, { method: "GET" });
  const customers = (data && data.customers) || [];
  return customers.length ? customers[0] : null;
}

async function createCustomer(payload) {
  const body = {
    customer: {
      first_name: payload.first_name,
      last_name:  payload.last_name,
      email:      payload.email,
      phone:      payload.phone,
      tags:       (payload.tags || []).join(", "),
      note:       payload.note || "",
      verified_email: true,
      accepts_marketing: false
    }
  };
  const data = await shopifyFetch("/customers.json", { method: "POST", body: JSON.stringify(body) });
  return data.customer;
}

async function updateCustomerNoteAndTags(customerId, addNote, addTags) {
  const cur = await shopifyFetch(`/customers/${customerId}.json`, { method: "GET" });
  const current = cur.customer;

  const mergedTags = new Set();
  (current.tags || "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean)
    .forEach(t => mergedTags.add(t));
  (addTags || []).forEach(t => mergedTags.add(t));

  const body = {
    customer: {
      id: customerId,
      note: (current.note ? current.note + "\n" : "") + (addNote || ""),
      tags: Array.from(mergedTags).join(", ")
    }
  };
  await shopifyFetch(`/customers/${customerId}.json`, { method: "PUT", body: JSON.stringify(body) });
}

// ---- E-posta (Resend) ----
async function sendEmailResend(to, subject, html) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "RESEND_API_KEY missing" };
  const recipients = Array.isArray(to) ? to : [to];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: recipients, subject, html })
  });
  let j = {};
  try { j = await res.json(); } catch (_) {}
  return { ok: res.ok, response: j };
}

// ---- Not/Etiket & Mail HTML ----
function buildSnapshotTag(answers) {
  const parts = [];
  if (answers?.model)   parts.push(`${answers.model}`);
  if (answers?.platform)parts.push(`${answers.platform}`);
  if (answers?.volume)  parts.push(`${answers.volume}`);
  return `B2B-QUIZ: ${parts.join(", ")}`;
}
function buildNote(answers) {
  const a = answers || {};
  const L = [];
  L.push("B2B Wizard — podsumowanie odpowiedzi:");
  if (a.partner)       L.push(`Partner: ${a.partner}`);
  if (a.sales_channel) L.push(`Kanał sprzedaży: ${a.sales_channel}`);
  if (a.company)       L.push(`Firma: ${a.company}${a.company_other ? " / " + a.company_other : ""}`);
  if (a.has_store)     L.push(`Sklep internetowy: ${a.has_store}${a.website_url ? " (" + a.website_url + ")" : ""}`);
  if (a.platform)      L.push(`Platforma: ${a.platform}${a.platform_other ? " / " + a.platform_other : ""}`);
  if (a.baselinker)    L.push(`BaseLinker: ${a.baselinker}`);
  if (a.marketplaces)  L.push(`Marketplace: ${Array.isArray(a.marketplaces) ? a.marketplaces.join(", ") : a.marketplaces}`);
  if (a.model)         L.push(`Model: ${a.model}`);
  if (a.volume)        L.push(`Wolumen: ${a.volume}`);
  if (a.courier)       L.push(`Kurier: ${Array.isArray(a.courier) ? a.courier.join(", ") : a.courier}`);
  return L.join("\n");
}
function buildUserEmailHtml(name, summaryHtml) {
  const hello = name ? `Szanowny/a ${escapeHtml(name)},` : "Dziękujemy,";
  return `
  <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#111">
    <p>${hello}</p>
    <p>Dziękujemy za wypełnienie ankiety B2B. Poniżej przesyłamy podsumowanie rekomendacji oraz
       kolejny krok. Skontaktujemy się z Tobą <strong>najszybciej jak to możliwe</strong>.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
    ${summaryHtml || "<p>(Brak podsumowania HTML)</p>"}
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
    <p>Masz pytania? Odpowiedz na tego maila — zespół LaBalancia.</p>
  </div>`;
}
function buildAdminEmailHtml(payload) {
  const { name, email, phone, answers, summary_html, shopifyCustomerId, isNew } = payload;
  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Nowe zgłoszenie — B2B Wizard</h2>
      <p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt; — tel. ${escapeHtml(phone)}</p>
      <p>Shopify customer: ${shopifyCustomerId ?? "-"} ${isNew ? "(utworzony)" : ""}</p>
      <h3>Odpowiedzi</h3>
      <pre style="white-space:pre-wrap;background:#f7f7f8;border:1px solid #eee;padding:10px;border-radius:8px">${escapeHtml(JSON.stringify(answers, null, 2))}</pre>
      <h3>Podsumowanie HTML</h3>
      ${summary_html || "<p>(brak)</p>"}
    </div>`;
}

// ---- Handler ----
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { answers = {}, summary_html = "" } = (req.body || {});
    const contact = answers.contact || {};
    const name    = (contact.name  || "").toString().trim();
    const email   = (contact.email || "").toString().trim().toLowerCase();
    const phone   = (contact.phone || "").toString().trim();
    const consent = !!contact.consent;

    if (!name || !email || !phone || !consent) {
      sendJson(res, 400, { ok: false, error: "missing-contact" });
      return;
    }

    const parts = name.split(" ");
    const first_name = parts.shift() || "";
    const last_name  = parts.join(" ");

    // Shopify upsert (hata süreci durdurmaz)
    let shopifyCustomerId = null;
    let created = false;
    try {
      const existing = await findCustomerByEmail(email);
      if (existing) {
        shopifyCustomerId = existing.id;
      } else {
        const createdCust = await createCustomer({
          first_name, last_name, email, phone,
          tags: ["B2B-QUIZ"],
          note: "Zgłoszenie z ankiety B2B Wizard (LaBalancia)"
        });
        shopifyCustomerId = createdCust.id;
        created = true;
      }
      const tag  = buildSnapshotTag(answers);
      const note = buildNote(answers);
      if (shopifyCustomerId) {
        await updateCustomerNoteAndTags(shopifyCustomerId, note, ["B2B-QUIZ", tag].filter(Boolean));
      }
    } catch (err) {
      console.error("Shopify error:", err?.message || err);
    }

    // Mail (opsiyonel)
    const mailUser  = await sendEmailResend(email, "LaBalancia — Twoje rekomendacje i kolejny krok", buildUserEmailHtml(name, summary_html));
    const mailAdmin = await sendEmailResend(
      MAIL_TO_ADMIN.split(",").map(s => s.trim()).filter(Boolean),
      "Nowe zgłoszenie: B2B Wizard (LaBalancia)",
      buildAdminEmailHtml({ name, email, phone, answers, summary_html, shopifyCustomerId, isNew: created })
    );

    sendJson(res, 200, {
      ok: true,
      customer_id: shopifyCustomerId,
      customer_created: created,
      mail_user: mailUser,
      mail_admin: mailAdmin
    });
  } catch (e) {
    console.error("lead error:", e?.message || e);
    sendJson(res, 500, { ok: false, error: "internal" });
  }
}
