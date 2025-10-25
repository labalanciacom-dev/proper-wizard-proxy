// pages/api/proxy/lead.js
// Next.js (Pages Router) API route
// Görev: tema formundan gelen veriyi alır, Shopify CRM'e yazar (create/update + tag/note/metafield),
// admin + müşteriye e-mail gönderir (Resend). CORS destekli.

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'sales@labalancia.com').split(',').map(s=>s.trim()).filter(Boolean);
const FROM_EMAIL   = process.env.FROM_EMAIL || 'LaBalancia <no-reply@yourdomain.com>';

const SHOP_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN;             // e.g. labalancia.myshopify.com
const SHOP_TOKEN   = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;    // Admin API token (scopes: read_customers, write_customers)

// ---- Shopify helpers ----
async function shopifyFetch(path, opts = {}) {
  if (!SHOP_DOMAIN || !SHOP_TOKEN) throw new Error('Shopify env missing');
  const url = `https://${SHOP_DOMAIN}/admin/api/2023-10${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'X-Shopify-Access-Token': SHOP_TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Shopify ${res.status}: ${txt}`);
  }
  return res.json();
}

async function upsertShopifyCustomer({ name, email, phone, tags = [], note, metafieldPayload }) {
  if (!email) return null;

  // 1) Müşteri ara
  let existing = null;
  try {
    const search = await shopifyFetch(`/customers/search.json?query=${encodeURIComponent('email:'+email)}`);
    existing = Array.isArray(search?.customers) ? search.customers[0] : null;
  } catch (e) {
    // search hata verirse bile create deneyeceğiz
  }

  if (existing) {
    // 2) Update (tag merge + note append)
    const mergedTags = Array.from(new Set([...(existing.tags||'').split(',').map(t=>t.trim()).filter(Boolean), ...tags]));
    const body = {
      customer: {
        id: existing.id,
        phone: phone || existing.phone || undefined,
        tags: mergedTags.join(','),
        note: note ? `${(existing.note||'')}\n${note}`.trim() : existing.note
      }
    };
    const upd = await shopifyFetch(`/customers/${existing.id}.json`, { method:'PUT', body: JSON.stringify(body) });

    // 2b) Metafield (json)
    if (metafieldPayload) {
      try {
        await shopifyFetch(`/customers/${existing.id}/metafields.json`, {
          method:'POST',
          body: JSON.stringify({
            metafield: {
              namespace: 'lb',
              key: 'wizard',
              type: 'json',
              value: JSON.stringify(metafieldPayload)
            }
          })
        });
      } catch (e) {
        // metafield hatası kritik değil
        console.warn('metafield(post) failed', e.message);
      }
    }
    return upd?.customer || existing;
  }

  // 3) Create
  const create = await shopifyFetch(`/customers.json`, {
    method:'POST',
    body: JSON.stringify({
      customer: {
        first_name: name || '',
        email, phone,
        tags: tags.join(','),
        note
      }
    })
  });
  const cust = create?.customer || null;

  // 3b) Metafield
  if (cust && metafieldPayload) {
    try {
      await shopifyFetch(`/customers/${cust.id}/metafields.json`, {
        method:'POST',
        body: JSON.stringify({
          metafield: {
            namespace: 'lb',
            key: 'wizard',
            type: 'json',
            value: JSON.stringify(metafieldPayload)
          }
        })
      });
    } catch (e) {
      console.warn('metafield(post-new) failed', e.message);
    }
  }

  return cust;
}

// ---- Email builders ----
function buildAdminHtml({ answers, summary_html, host }) {
  const safeSummary = summary_html || '<p>(brak podsumowania HTML)</p>';
  return `
    <div style="font-family:Inter,Arial,sans-serif">
      <h2>Nowy lead z B2B Wizard (LaBalancia)</h2>
      <p><b>Host:</b> ${host || '-'}</p>
      <h3>Podsumowanie dla klienta</h3>
      ${safeSummary}
      <h3>Odpowiedzi (JSON)</h3>
      <pre style="padding:12px;background:#f6f8fa;border-radius:8px;white-space:pre-wrap">${JSON.stringify(answers, null, 2)}</pre>
    </div>
  `;
}

function buildCustomerHtml({ summary_html }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif">
      <h2>Dziękujemy za wypełnienie ankiety 🎉</h2>
      <p>Na podstawie Twoich odpowiedzi przygotowaliśmy wstępne rekomendacje. Skontaktujemy się
      <b>najszybciej jak to możliwe</b>, aby potwierdzić kolejne kroki.</p>
      ${summary_html || ''}
      <p style="margin-top:24px;color:#555;font-size:13px">— Zespół LaBalancia</p>
    </div>
  `;
}

// ---- Handler ----
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Idempotency-Key, X-Shop-Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { answers, summary_html } = req.body || {};
    if (!answers) return res.status(400).json({ ok:false, error:'Missing answers' });

    const contact = answers?.contact || {};
    const name  = contact?.name || '';
    const email = contact?.email || '';
    const phone = contact?.phone || '';
    const consent = !!contact?.consent;

    // (Opsiyonel) RODO: eğer consent yoksa e-mail göndermeyi atlamak istersen buradan kesebilirsin:
    // if (!consent) return res.status(400).json({ ok:false, error:'consent_required' });

    // tag & note
    const tags = ['lb_wizard'];
    if (Array.isArray(answers.marketplaces) && answers.marketplaces.some(m=>m && m !== 'Nie')) tags.push('marketplace');
    if (/Dropshipping/i.test(answers.model||'')) tags.push('dropshipping');
    if (/hurt|Tylko hurt/i.test(answers.model||'')) tags.push('hurt');

    const note = `B2B Wizard lead — ${new Date().toISOString()}
Wolumen: ${answers.volume||'-'}
Platforma: ${answers.platform||answers.platform_other||'-'}`;

    const metafieldPayload = { answers, summary_html };

    // Shopify upsert
    let shopifyCustomer = null;
    try {
      shopifyCustomer = await upsertShopifyCustomer({ name, email, phone, tags, note, metafieldPayload });
    } catch (e) {
      console.error('Shopify upsert error', e.message);
    }

    // E-mail
    const host = req.headers['x-shop-origin'] || req.headers.host || '';
    const adminHtml = buildAdminHtml({ answers, summary_html, host });
    const customerHtml = buildCustomerHtml({ summary_html });

    if (resend) {
      // Admin
      await resend.emails.send({
        from: FROM_EMAIL,
        to: ADMIN_EMAILS,
        subject: 'Nowy lead: B2B Wizard (LaBalancia)',
        html: adminHtml
      });
      // Customer
      if (email && consent) {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: 'Twoje rekomendacje – LaBalancia',
          html: customerHtml
        });
      }
    } else {
      console.warn('RESEND_API_KEY not set → email skipped');
    }

    return res.status(200).json({ ok:true, customer_id: shopifyCustomer?.id || null });
  } catch (err) {
    console.error('lead handler error', err);
    return res.status(500).json({ ok:false, error:'internal_error' });
  }
}
