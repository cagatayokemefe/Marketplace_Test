"use strict";

/**
 * Ödeme sağlayıcısı.
 *
 * Para her zaman UYGULAMA SAHİBİNİN hesabına geçer:
 *  - stripe modunda STRIPE_SECRET_KEY hangi hesaba aitse oraya,
 *  - demo modunda ise sahibin uygulama içi kasasına (payments tablosu).
 *
 * Organizatörün payı ayrı bir "borç" kalemi olarak tutulur; ödemeyi
 * organizatöre uygulama sahibi aktarır.
 */

const config = require("./config");

/** Stripe REST API'sine form-encoded istek (SDK bağımlılığı olmadan). */
async function stripeRequest(path, params) {
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

  const res = await fetch(config.payments.stripeApiBase + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.payments.stripeSecretKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
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

/**
 * Ödeme oturumu başlatır.
 * @returns {Promise<{mode:'demo'|'stripe', checkoutUrl?:string, providerRef?:string}>}
 */
async function createCheckout({ payment, event, user, baseUrl }) {
  if (config.payments.provider !== "stripe") {
    return { mode: "demo", providerRef: null };
  }

  const session = await stripeRequest("/checkout/sessions", {
    mode: "payment",
    success_url: `${baseUrl}/#/odeme/${payment.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/#/etkinlik/${event.id}?iptal=1`,
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
  });

  return {
    mode: "stripe",
    checkoutUrl: session.url,
    providerRef: session.id,
  };
}

/** Stripe Checkout oturumunun gerçekten ödendiğini doğrular. */
async function verifyCheckout(sessionId) {
  if (config.payments.provider !== "stripe") {
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

/** İadeyi çalıştırır. Demo modunda sadece kaydı işaretler. */
async function refund(payment) {
  if (config.payments.provider !== "stripe" || !payment.provider_ref) {
    return { refunded: true, providerRef: payment.provider_ref };
  }
  const ref = payment.provider_ref;
  const params = ref.startsWith("cs_")
    ? { payment_intent: (await stripeGet("/checkout/sessions/" + ref)).payment_intent }
    : { payment_intent: ref };

  const result = await stripeRequest("/refunds", params);
  return { refunded: result.status !== "failed", providerRef: result.id };
}

module.exports = { createCheckout, verifyCheckout, refund, provider: config.payments.provider };
