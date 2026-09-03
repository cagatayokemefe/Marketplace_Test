"use strict";

/**
 * Ödeme sağlayıcısı.
 *
 * İki mod var:
 *  - "stripe": STRIPE_SECRET_KEY tanımlıysa gerçek Stripe kullanılır.
 *  - "demo"  : Anahtar yoksa her şey taklit edilir; uçtan uca akış çalışır
 *              ama para hareketi olmaz.
 *
 * Paranın bölünmesi iki şekilde olabilir:
 *
 *  1. Connect (organizatörün Stripe hesabı bağlıysa) — "destination charge".
 *     Katılımcı öder, Stripe tutarın tamamını organizatörün hesabına geçirir,
 *     application_fee_amount kadarını da platforma (uygulama sahibine) geri
 *     alır. Yani komisyon otomatik ayrılır, elle transfer gerekmez.
 *
 *  2. Platform (organizatörün hesabı yoksa) — para tamamen sahibin hesabında
 *     toplanır ve organizatöre olan borç raporlanır; transferi sahip yapar.
 */

const crypto = require("crypto");
const config = require("./config");

const isStripe = config.payments.provider === "stripe";

// ── Stripe REST yardımcıları (SDK bağımlılığı yok) ──────────────────────────

/** Nesneleri Stripe'ın beklediği a[b][c] biçimine düzleştirir. */
function formEncode(params) {
  const body = new URLSearchParams();

  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => append(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    } else {
      body.append(key, String(value));
    }
  };

  for (const [k, v] of Object.entries(params || {})) append(k, v);
  return body.toString();
}

async function stripeRequest(path, params, options) {
  const headers = {
    Authorization: "Bearer " + config.payments.stripeSecretKey,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Aynı isteğin iki kez çalışmasını önler (ağ tekrar denerse para iki kez gitmesin).
  if (options && options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const res = await fetch(config.payments.stripeApiBase + path, {
    method: "POST",
    headers,
    body: formEncode(params),
  });

  const json = await res.json();
  if (!res.ok) {
    const message = (json && json.error && json.error.message) || "Stripe hatası";
    const err = new Error(message);
    err.statusCode = res.status;
    throw err;
  }
  return json;
}

async function stripeGet(path) {
  const res = await fetch(config.payments.stripeApiBase + path, {
    headers: { Authorization: "Bearer " + config.payments.stripeSecretKey },
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error((json.error && json.error.message) || "Stripe hatası");
    err.statusCode = res.status;
    throw err;
  }
  return json;
}

// ── Connect: organizatör hesapları ──────────────────────────────────────────

const connectEnabled = config.connect.enabled;

/**
 * Organizatör için bağlı bir hesap açar (Express tipi: doğrulamayı,
 * vergi formlarını ve banka bilgisini Stripe'ın kendi ekranları yürütür).
 */
async function createConnectedAccount({ user }) {
  if (!isStripe) {
    return { id: "acct_demo_" + user.id };
  }
  const account = await stripeRequest(
    "/accounts",
    {
      type: "express",
      country: config.connect.country,
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: { name: user.name },
      metadata: { app_user_id: user.id },
    },
    { idempotencyKey: "acct_user_" + user.id },
  );
  return { id: account.id };
}

/**
 * Organizatörü Stripe'ın barındırdığı kurulum akışına götüren tek kullanımlık
 * bağlantı. Süresi dolarsa yenisi üretilir.
 */
async function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  if (!isStripe) {
    // Demo modunda kurulum anında tamamlanmış sayılır.
    return { url: returnUrl, demo: true };
  }
  const link = await stripeRequest("/account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url };
}

/** Hesabın gerçekten para alabilir/alabilir hâle gelip gelmediğini sorar. */
async function retrieveAccount(accountId) {
  if (!isStripe) {
    return {
      id: accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    };
  }
  const account = await stripeGet("/accounts/" + encodeURIComponent(accountId));
  return {
    id: account.id,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
  };
}

/** Organizatörün kendi Stripe panelini açan tek kullanımlık bağlantı. */
async function createLoginLink(accountId) {
  if (!isStripe) return { url: null, demo: true };
  const link = await stripeRequest(
    "/accounts/" + encodeURIComponent(accountId) + "/login_links",
    {},
  );
  return { url: link.url };
}

// ── Ödeme oturumu ───────────────────────────────────────────────────────────

/**
 * Ödeme oturumu başlatır.
 *
 * @param {object} split - { destination, commissionMinor } · destination varsa
 *        destination charge kurulur ve komisyon otomatik ayrılır.
 * @returns {Promise<{mode:'demo'|'stripe', checkoutUrl?:string, providerRef?:string}>}
 */
async function createCheckout({ payment, event, user, baseUrl, split }) {
  if (!isStripe) {
    return { mode: "demo", providerRef: null };
  }

  const params = {
    mode: "payment",
    success_url: `${baseUrl}/#/checkout/${payment.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/#/event/${event.id}?canceled=1`,
    customer_email: user.email,
    client_reference_id: String(payment.id),
    metadata: {
      payment_id: payment.id,
      event_id: event.id,
      user_id: user.id,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (event.currency || config.currency).toLowerCase(),
          unit_amount: payment.amount_minor,
          product_data: {
            name: event.title,
            description: `${event.venue || event.city} · ${new Date(
              event.starts_at,
            ).toLocaleString("tr-TR")}`,
          },
        },
      },
    ],
  };

  // Organizatörün hesabı bağlıysa payı Stripe kendisi ayırsın.
  if (split && split.destination) {
    params.payment_intent_data = {
      application_fee_amount: split.commissionMinor,
      transfer_data: { destination: split.destination },
      metadata: { payment_id: payment.id },
    };
  } else {
    params.payment_intent_data = { metadata: { payment_id: payment.id } };
  }

  const session = await stripeRequest("/checkout/sessions", params, {
    idempotencyKey: "checkout_payment_" + payment.id,
  });

  return { mode: "stripe", checkoutUrl: session.url, providerRef: session.id };
}

/** Stripe Checkout oturumunun gerçekten ödendiğini doğrular. */
async function verifyCheckout(sessionId) {
  if (!isStripe) {
    return { paid: true, cardLast4: null, providerRef: sessionId || null };
  }
  const session = await stripeGet(
    "/checkout/sessions/" + encodeURIComponent(sessionId),
  );
  return {
    paid: session.payment_status === "paid",
    providerRef: session.payment_intent || session.id,
    cardLast4: null,
  };
}

/** Bir referanstan ödeme niyetini (payment intent) çözer. */
async function resolvePaymentIntent(ref) {
  if (!ref) return null;
  if (ref.startsWith("pi_")) return ref;
  if (ref.startsWith("cs_")) {
    const session = await stripeGet("/checkout/sessions/" + encodeURIComponent(ref));
    return session.payment_intent || null;
  }
  return null;
}

/**
 * İadeyi çalıştırır.
 *
 * Connect ödemelerinde para hem organizatörden hem platformdan geri alınır:
 * reverse_transfer organizatörün payını, refund_application_fee komisyonu
 * geri çeker. Aksi hâlde iade tamamen platformun cebinden çıkardı.
 */
async function refund(payment) {
  if (!isStripe || !payment.provider_ref) {
    return { refunded: true, providerRef: payment.provider_ref };
  }

  const paymentIntent = await resolvePaymentIntent(payment.provider_ref);
  if (!paymentIntent) {
    throw new Error("İade için ödeme referansı bulunamadı.");
  }

  const params = { payment_intent: paymentIntent };
  if (payment.payout_mode === "connect") {
    params.reverse_transfer = true;
    params.refund_application_fee = true;
  }

  const result = await stripeRequest("/refunds", params, {
    idempotencyKey: "refund_payment_" + payment.id,
  });
  return { refunded: result.status !== "failed", providerRef: result.id };
}

// ── Webhook imza doğrulaması ────────────────────────────────────────────────

/**
 * Stripe'tan gelen isteğin gerçekten Stripe'tan geldiğini doğrular.
 * İmza `t=<zaman>,v1=<hmac>` biçimindedir; imzalanan metin `<zaman>.<gövde>`.
 *
 * @param {Buffer|string} rawBody - Gövdenin ham hâli (JSON'a çevrilmemiş)
 * @throws imza geçersizse
 */
function verifyWebhookSignature(rawBody, signatureHeader, toleranceSeconds = 300) {
  const secret = config.payments.webhookSecret;
  if (!secret) throw new Error("Webhook gizli anahtarı tanımlı değil.");
  if (!signatureHeader) throw new Error("İmza başlığı yok.");

  const parts = {};
  for (const item of String(signatureHeader).split(",")) {
    const [key, value] = item.split("=");
    if (!key || !value) continue;
    if (key === "v1") (parts.v1 = parts.v1 || []).push(value);
    else parts[key] = value;
  }

  if (!parts.t || !parts.v1) throw new Error("İmza başlığı okunamadı.");

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    throw new Error("İmza zaman aşımına uğramış.");
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts.t + "." + payload, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const matches = parts.v1.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, "utf8");
    return (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    );
  });

  if (!matches) throw new Error("İmza doğrulanamadı.");
  return JSON.parse(payload);
}

module.exports = {
  provider: config.payments.provider,
  connectEnabled,
  webhookConfigured: !!config.payments.webhookSecret,

  createCheckout,
  verifyCheckout,
  refund,

  createConnectedAccount,
  createAccountLink,
  retrieveAccount,
  createLoginLink,

  verifyWebhookSignature,
};
