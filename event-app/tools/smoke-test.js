"use strict";

/**
 * Uçtan uca duman testi: kayıt → etkinlik bulma → ödeme → bilet → giriş
 * kontrolü → iade → uygulama sahibinin gelir raporu.
 *
 *   npm run smoke
 *
 * Geçici bir veritabanı kullanır, gerçek veriye dokunmaz.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");

const tmpDb = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "meetapp-smoke-")),
  "test.db",
);
process.env.DB_PATH = tmpDb;
process.env.SESSION_SECRET = "smoke-test-secret";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_smoke_test";
// Test, insan hızının çok üstünde istek atıyor; hız sınırları onu engellemesin.
process.env.RATE_LIMIT_AUTH = "1000";
process.env.RATE_LIMIT_PAY = "1000";
delete process.env.STRIPE_SECRET_KEY;

const crypto = require("crypto");
const app = require("../server");
const db = require("../db");
const mailer = require("../mailer");

/** Konsola düşen son postayı bulur (SMTP kapalıyken outbox'a yazılıyor). */
function lastMail(template) {
  for (let i = mailer.outbox.length - 1; i >= 0; i--) {
    if (!template || mailer.outbox[i].template === template) return mailer.outbox[i];
  }
  return null;
}

let failures = 0;
let checks = 0;

function ok(condition, label, detail) {
  checks++;
  if (condition) {
    console.log("  ✓ " + label);
  } else {
    failures++;
    console.log("  ✗ " + label + (detail ? "\n      → " + detail : ""));
  }
}

/** Basit çerez taşıyan istemci — her kullanıcı için ayrı bir örnek. */
function client(baseUrl, lang) {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: Object.assign(
        { Accept: "application/json" },
        lang ? { "X-Lang": lang } : {},
        body ? { "Content-Type": "application/json" } : {},
        cookie ? { Cookie: cookie } : {},
      ),
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookie = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    if (setCookie.length) {
      cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

(async function run() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = "http://127.0.0.1:" + server.address().port;

  console.log("\nMeetApp — duman testi (" + baseUrl + ")\n");

  try {
    // ── 1. Genel ayarlar ────────────────────────────────────────────────────
    const guest = client(baseUrl);
    let r = await guest("GET", "/api/config");
    ok(r.status === 200, "GET /api/config yanıt veriyor");
    ok(r.data.paymentProvider === "demo", "Anahtar yokken demo moda düşüyor");

    // ── 2. Kayıt ────────────────────────────────────────────────────────────
    const irfan = client(baseUrl);
    r = await irfan("POST", "/api/auth/register", {
      name: "İrfan Test",
      email: "irfan.test@example.com",
      password: "irfan1234",
      city: "İstanbul",
    });
    ok(r.status === 201, "Yeni kullanıcı kaydı", JSON.stringify(r.data));

    r = await irfan("POST", "/api/auth/register", {
      name: "Kısa",
      email: "kisa@example.com",
      password: "123",
    });
    ok(r.status === 400, "Kısa şifre reddediliyor");

    // ── 3. Etkinlik listesi ─────────────────────────────────────────────────
    r = await irfan("GET", "/api/events?q=voleybol");
    ok(r.status === 200 && r.data.events.length > 0, "Voleybol araması sonuç veriyor");

    const volleyball = r.data.events.find((e) => e.priceMinor > 0);
    ok(!!volleyball, "Ücretli voleybol etkinliği bulundu");

    // ── 4. Katılım → ödeme gerekiyor ────────────────────────────────────────
    r = await irfan("POST", "/api/events/" + volleyball.id + "/join");
    ok(
      r.status === 200 && r.data.status === "payment_required",
      "Ücretli etkinlikte ödeme isteniyor",
      JSON.stringify(r.data),
    );
    ok(
      r.data.amountMinor === volleyball.priceMinor,
      "Ödenecek tutar etkinlik ücretiyle aynı",
    );
    let paymentId = r.data.paymentId;

    // ── 5. Reddedilen kart ──────────────────────────────────────────────────
    r = await irfan("POST", "/api/payments/" + paymentId + "/confirm", {
      holder: "Irfan Test",
      cardNumber: "4000 0000 0000 0002",
      expiry: "12/29",
      cvc: "123",
    });
    ok(r.status === 402, "Reddedilen test kartı 402 döndürüyor");

    r = await irfan("GET", "/api/my/registrations");
    ok(
      r.data.registrations.every((x) => x.status !== "confirmed"),
      "Ödeme başarısızken kayıt onaylanmıyor",
    );

    // ── 6. Başarılı ödeme ───────────────────────────────────────────────────
    r = await irfan("POST", "/api/events/" + volleyball.id + "/join");
    paymentId = r.data.paymentId;

    r = await irfan("POST", "/api/payments/" + paymentId + "/confirm", {
      holder: "Irfan Test",
      cardNumber: "4242 4242 4242 4242",
      expiry: "12/29",
      cvc: "123",
    });
    ok(r.status === 200 && r.data.status === "paid", "Ödeme başarıyla alınıyor");
    const ticketCode = r.data.ticketCode;
    ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ticketCode), "Bilet kodu üretildi: " + ticketCode);

    r = await irfan("GET", "/api/events/" + volleyball.id);
    ok(
      r.data.event.myRegistration &&
        r.data.event.myRegistration.status === "confirmed",
      "Etkinlik detayında katılım onaylı görünüyor",
    );
    ok(
      r.data.event.attendeeCount === volleyball.attendeeCount + 1,
      "Katılımcı sayısı arttı",
    );

    // Aynı etkinliğe ikinci kez katılım engellenmeli
    r = await irfan("POST", "/api/events/" + volleyball.id + "/join");
    ok(r.status === 409, "Aynı etkinliğe iki kez katılım engelleniyor");

    // ── 7. Ücretsiz etkinlik anında onaylanmalı ─────────────────────────────
    r = await irfan("GET", "/api/events?scope=upcoming");
    const freeEvent = r.data.events.find((e) => e.priceMinor === 0 && !e.isOrganizer);
    r = await irfan("POST", "/api/events/" + freeEvent.id + "/join");
    ok(r.data.status === "confirmed", "Ücretsiz etkinlik anında onaylanıyor");

    // ── 8. Organizatör: katılımcı listesi ve giriş kontrolü ─────────────────
    const zeynep = client(baseUrl);
    r = await zeynep("POST", "/api/auth/login", {
      email: "zeynep@example.com",
      password: "zeynep1234",
    });
    ok(r.status === 200, "Organizatör girişi");

    r = await zeynep("GET", "/api/events/" + volleyball.id + "/attendees");
    ok(
      r.status === 200 && r.data.attendees.some((a) => a.ticketCode === ticketCode),
      "Organizatör katılımcı listesinde bileti görüyor",
    );

    r = await zeynep("POST", "/api/events/" + volleyball.id + "/checkin", {
      code: ticketCode,
    });
    ok(r.status === 200, "Bilet kodu ile giriş yapıldı");

    r = await zeynep("POST", "/api/events/" + volleyball.id + "/checkin", {
      code: ticketCode,
    });
    ok(r.status === 409, "Aynı bilet ikinci kez kullanılamıyor");

    // Yetkisiz kullanıcı katılımcı listesini görememeli
    r = await irfan("GET", "/api/events/" + volleyball.id + "/attendees");
    ok(r.status === 403, "Katılımcı listesi yalnızca organizatöre açık");

    // ── 9. Uygulama sahibinin geliri ────────────────────────────────────────
    const owner = client(baseUrl);
    r = await owner("POST", "/api/auth/login", {
      email: "owner@meetapp.app",
      password: "owner1234",
    });
    ok(r.status === 200 && r.data.user.role === "owner", "Uygulama sahibi girişi");

    r = await irfan("GET", "/api/owner/summary");
    ok(r.status === 403, "Normal kullanıcı gelir panelini göremiyor");

    r = await owner("GET", "/api/owner/summary");
    ok(r.status === 200, "Gelir özeti geliyor");
    const totals = r.data.totals;
    ok(
      totals.gross >= volleyball.priceMinor,
      "Tahsilat toplamı ödemeyi içeriyor (" + totals.gross + " kuruş)",
    );
    ok(
      totals.commission + totals.organizer_payable === totals.gross,
      "Komisyon + organizatör payı = tahsilat",
    );

    r = await owner("GET", "/api/owner/payments");
    ok(
      r.data.payments.some((p) => p.status === "paid" && p.cardLast4 === "4242"),
      "Ödeme kaydı sahibin listesinde görünüyor",
    );

    // ── 10. İade ────────────────────────────────────────────────────────────
    const ayse = client(baseUrl);
    await ayse("POST", "/api/auth/register", {
      name: "Ayşe Test",
      email: "ayse.test@example.com",
      password: "ayse1234",
    });

    r = await ayse("GET", "/api/events");
    const beach = r.data.events.find(
      (e) => e.priceMinor > 0 && e.id !== volleyball.id,
    );
    r = await ayse("POST", "/api/events/" + beach.id + "/join");
    r = await ayse("POST", "/api/payments/" + r.data.paymentId + "/confirm", {
      holder: "Ayse Test",
      cardNumber: "4242424242424242",
      expiry: "01/30",
      cvc: "999",
    });
    ok(r.status === 200, "İkinci kullanıcı ödemesi alındı");

    r = await ayse("GET", "/api/my/registrations");
    const beachReg = r.data.registrations.find((x) => x.eventId === beach.id);
    r = await ayse("POST", "/api/registrations/" + beachReg.id + "/cancel");
    ok(r.status === 200 && r.data.refunded === true, "İptalde ücret iade edildi");

    r = await owner("GET", "/api/owner/summary");
    ok(
      r.data.totals.refunded === beach.priceMinor,
      "İade tutarı gelir raporuna yansıdı",
    );

    // ── 11. Etkinlik oluşturma doğrulaması ──────────────────────────────────
    r = await irfan("POST", "/api/events", {
      title: "Ge",
      city: "İstanbul",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      capacity: 10,
      priceMinor: 5000,
    });
    ok(r.status === 400, "Çok kısa başlık reddediliyor");

    r = await irfan("POST", "/api/events", {
      title: "Test Voleybol Maçı",
      description: "Duman testi etkinliği",
      city: "İstanbul",
      venue: "Test Salonu",
      cover: "🏐",
      startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      durationHours: 2,
      capacity: 10,
      priceMinor: 20000,
    });
    ok(r.status === 201, "Etkinlik oluşturuldu", JSON.stringify(r.data));

    r = await irfan("POST", "/api/events", {
      title: "Geçmişte Kalan Etkinlik",
      city: "İstanbul",
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      capacity: 10,
      priceMinor: 0,
    });
    ok(r.status === 400, "Geçmiş tarihli etkinlik reddediliyor");

    // ── 12. Dil desteği ─────────────────────────────────────────────────────
    r = await guest("GET", "/api/config");
    ok(
      Array.isArray(r.data.languages) && r.data.languages.includes("en"),
      "Desteklenen diller /api/config ile bildiriliyor",
    );

    const english = client(baseUrl, "en");
    r = await english("GET", "/api/my/registrations");
    ok(
      r.status === 401 && /sign in/i.test(r.data.error || ""),
      "X-Lang: en ile hata mesajı İngilizce geliyor",
      r.data.error,
    );

    r = await guest("GET", "/api/my/registrations?lang=en");
    ok(/sign in/i.test(r.data.error || ""), "?lang=en sorgusu da dili değiştiriyor");

    r = await guest("GET", "/api/my/registrations");
    ok(
      /giriş yapmalısın/i.test(r.data.error || ""),
      "Başlık yokken varsayılan dil (tr) kullanılıyor",
      r.data.error,
    );

    const german = client(baseUrl, "de");
    r = await german("GET", "/api/my/registrations");
    ok(
      /giriş yapmalısın/i.test(r.data.error || ""),
      "Desteklenmeyen dil varsayılana düşüyor",
    );

    r = await english("POST", "/api/auth/register", {
      name: "Language Test",
      email: "lang.test@example.com",
      password: "123",
    });
    ok(
      r.status === 400 && /at least 8 characters/i.test(r.data.error || ""),
      "Doğrulama mesajları da çevriliyor",
      r.data.error,
    );

    // ── 13. Organizatör ödeme hesabı (Connect) ──────────────────────────────
    r = await zeynep("GET", "/api/me/payouts");
    ok(r.status === 200 && r.data.enabled === true, "Connect açık olarak bildiriliyor");
    ok(r.data.connected === false, "Hesap başlangıçta bağlı değil");

    r = await zeynep("POST", "/api/me/payouts/onboard");
    ok(r.status === 200 && r.data.demo === true, "Demo modunda kurulum anında tamamlanıyor");

    r = await zeynep("GET", "/api/me/payouts");
    ok(r.data.connected && r.data.ready, "Kurulumdan sonra hesap para almaya hazır");

    // Hesabı bağlı organizatörün etkinliğinde pay otomatik ayrılmalı
    r = await zeynep("POST", "/api/events", {
      title: "Connect Test Etkinliği",
      city: "İstanbul",
      cover: "🏐",
      startsAt: new Date(Date.now() + 4 * 86400000).toISOString(),
      capacity: 10,
      priceMinor: 30000,
    });
    ok(r.status === 201, "Bağlı organizatör etkinlik oluşturdu");
    const connectEvent = r.data.event;

    r = await irfan("POST", "/api/events/" + connectEvent.id + "/join");
    ok(
      r.data.payoutMode === "connect",
      "Hesap bağlıyken ödeme otomatik bölüşüme ayarlanıyor",
      JSON.stringify(r.data),
    );
    const connectPaymentId = r.data.paymentId;

    r = await irfan("POST", "/api/payments/" + connectPaymentId + "/confirm", {
      holder: "Irfan Test",
      cardNumber: "4242424242424242",
      expiry: "12/29",
      cvc: "123",
    });
    ok(r.status === 200, "Otomatik bölüşümlü ödeme alındı");

    r = await owner("GET", "/api/owner/summary");
    ok(
      r.data.totals.organizer_auto >= 27000,
      "Organizatör payı 'otomatik ödenen' olarak raporlanıyor (" +
        r.data.totals.organizer_auto +
        ")",
    );
    ok(
      r.data.totals.organizer_auto + r.data.totals.organizer_manual ===
        r.data.totals.organizer_payable,
      "Otomatik + elle = toplam organizatör payı",
    );

    // ── 14. Webhook ─────────────────────────────────────────────────────────
    function signedWebhook(payload) {
      const body = JSON.stringify(payload);
      const ts = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
        .update(ts + "." + body)
        .digest("hex");
      return { body, header: "t=" + ts + ",v1=" + signature };
    }

    async function postWebhook(payload, headerOverride) {
      const signed = signedWebhook(payload);
      const res = await fetch(baseUrl + "/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": headerOverride || signed.header,
        },
        body: signed.body,
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    }

    const freshTs = Math.floor(Date.now() / 1000);
    r = await postWebhook(
      { type: "checkout.session.completed" },
      "t=" + freshTs + ",v1=" + "0".repeat(64),
    );
    ok(r.status === 400, "Yanlış imzalı webhook reddediliyor");

    // Doğru imza ama eski zaman damgası: tekrar saldırısına karşı
    const staleBody = JSON.stringify({ type: "checkout.session.completed" });
    const staleTs = Math.floor(Date.now() / 1000) - 3600;
    const staleSig = crypto
      .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
      .update(staleTs + "." + staleBody)
      .digest("hex");
    const staleRes = await fetch(baseUrl + "/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": "t=" + staleTs + ",v1=" + staleSig,
      },
      body: staleBody,
    });
    ok(staleRes.status === 400, "Zamanı geçmiş webhook reddediliyor");

    // Bekleyen bir ödeme oluştur, webhook onu tamamlasın
    const ayseWebhook = client(baseUrl);
    await ayseWebhook("POST", "/api/auth/register", {
      name: "Webhook Test",
      email: "webhook.test@example.com",
      password: "webhook1234",
    });
    r = await ayseWebhook("POST", "/api/events/" + connectEvent.id + "/join");
    const pendingId = r.data.paymentId;

    r = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          payment_intent: "pi_smoke_test",
          metadata: { payment_id: String(pendingId) },
        },
      },
    });
    ok(r.status === 200, "Geçerli webhook kabul ediliyor");

    r = await ayseWebhook("GET", "/api/my/registrations");
    ok(
      r.data.registrations.some(
        (x) => x.eventId === connectEvent.id && x.status === "confirmed",
      ),
      "Webhook, tarayıcı dönmeden ödemeyi tamamlıyor",
    );

    // Aynı webhook ikinci kez gelirse bozulmamalı
    r = await postWebhook({
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          payment_intent: "pi_smoke_test",
          metadata: { payment_id: String(pendingId) },
        },
      },
    });
    ok(r.status === 200, "Tekrarlanan webhook sorun çıkarmıyor (idempotent)");

    // ── 15. Kontenjan yarışı ────────────────────────────────────────────────
    r = await zeynep("POST", "/api/events", {
      title: "Tek Kişilik Etkinlik",
      city: "İstanbul",
      startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      capacity: 1,
      priceMinor: 5000,
    });
    const tinyEvent = r.data.event;

    const racerA = client(baseUrl);
    const racerB = client(baseUrl);
    await racerA("POST", "/api/auth/register", {
      name: "Racer A",
      email: "racer.a@example.com",
      password: "racer1234",
    });
    await racerB("POST", "/api/auth/register", {
      name: "Racer B",
      email: "racer.b@example.com",
      password: "racer1234",
    });

    // İkisi de yer ayırıyor (ikisi de 'pending'), sonra A önce ödüyor
    r = await racerA("POST", "/api/events/" + tinyEvent.id + "/join");
    const payA = r.data.paymentId;
    r = await racerB("POST", "/api/events/" + tinyEvent.id + "/join");
    const payB = r.data.paymentId;

    const card = { holder: "Racer", cardNumber: "4242424242424242", expiry: "12/29", cvc: "123" };
    r = await racerA("POST", "/api/payments/" + payA + "/confirm", card);
    ok(r.status === 200, "Yarışı kazanan ödeme tamamlanıyor");

    // B'nin ödemesini Stripe ödemesiymiş gibi işaretle ki iade yolu çalışsın
    db.prepare("UPDATE payments SET provider = 'stripe', provider_ref = ? WHERE id = ?").run(
      "pi_race_test",
      payB,
    );

    r = await racerB("POST", "/api/payments/" + payB + "/confirm", { sessionId: "cs_race" });
    ok(r.status === 409, "Kontenjan dolduysa ödeme onaylanmıyor");
    ok(
      /iade edildi|refunded/i.test(r.data.error || ""),
      "Kullanıcıya ücretin iade edildiği söyleniyor",
      r.data.error,
    );

    const racerBPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(payB);
    ok(racerBPayment.status === "refunded", "Ödeme kaydı 'refunded' olarak işaretlendi");

    r = await racerB("GET", "/api/my/registrations");
    ok(
      r.data.registrations.every(
        (x) => x.eventId !== tinyEvent.id || x.status === "cancelled",
      ),
      "İade edilen kayıt iptal edildi",
    );

    // ── 16. Etkinlik iptali herkese iade etmeli ─────────────────────────────
    r = await zeynep("POST", "/api/events", {
      title: "İptal Edilecek Etkinlik",
      city: "İstanbul",
      startsAt: new Date(Date.now() + 6 * 86400000).toISOString(),
      capacity: 10,
      priceMinor: 20000,
    });
    const doomed = r.data.event;

    // İki kişi katılıp ödesin
    const payer1 = client(baseUrl);
    const payer2 = client(baseUrl);
    await payer1("POST", "/api/auth/register", {
      name: "Payer One",
      email: "payer.one@example.com",
      password: "payer1234",
    });
    await payer2("POST", "/api/auth/register", {
      name: "Payer Two",
      email: "payer.two@example.com",
      password: "payer1234",
    });

    const payCard = {
      holder: "Payer",
      cardNumber: "4242424242424242",
      expiry: "12/29",
      cvc: "123",
    };
    for (const payer of [payer1, payer2]) {
      const join = await payer("POST", "/api/events/" + doomed.id + "/join");
      await payer("POST", "/api/payments/" + join.data.paymentId + "/confirm", payCard);
    }

    r = await payer1("GET", "/api/events/" + doomed.id);
    ok(r.data.event.attendeeCount === 2, "İki katılımcı da onaylandı");

    const beforeCancel = await owner("GET", "/api/owner/summary");

    r = await zeynep("POST", "/api/events/" + doomed.id + "/cancel");
    ok(r.status === 200, "Organizatör etkinliği iptal edebiliyor");
    ok(r.data.refundedCount === 2, "İki ödemenin ikisi de iade edildi", JSON.stringify(r.data));
    ok(r.data.refundedMinor === 40000, "İade tutarı doğru (" + r.data.refundedMinor + ")");
    ok(r.data.failedCount === 0, "İadelerin hiçbiri başarısız olmadı");

    r = await payer1("GET", "/api/my/registrations");
    const doomedReg = r.data.registrations.find((x) => x.eventId === doomed.id);
    ok(
      doomedReg && doomedReg.status === "cancelled",
      "Katılımcının kaydı iptal edildi",
      JSON.stringify(doomedReg),
    );

    const afterCancel = await owner("GET", "/api/owner/summary");
    ok(
      afterCancel.data.totals.refunded - beforeCancel.data.totals.refunded === 40000,
      "İadeler gelir raporuna yansıdı",
    );
    ok(
      afterCancel.data.totals.gross === beforeCancel.data.totals.gross - 40000,
      "İade edilen tutar tahsilattan düştü",
    );

    r = await zeynep("POST", "/api/events/" + doomed.id + "/cancel");
    ok(r.status === 409, "Aynı etkinlik iki kez iptal edilemiyor");

    // Ücretsiz etkinlikte de kayıtlar düşmeli
    r = await zeynep("POST", "/api/events", {
      title: "Ücretsiz İptal Testi",
      city: "İstanbul",
      startsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      capacity: 10,
      priceMinor: 0,
    });
    const freeDoomed = r.data.event;
    await payer1("POST", "/api/events/" + freeDoomed.id + "/join");

    r = await zeynep("POST", "/api/events/" + freeDoomed.id + "/cancel");
    ok(r.data.refundedCount === 0, "Ücretsiz etkinlikte iade edilecek bir şey yok");

    r = await payer1("GET", "/api/my/registrations");
    ok(
      r.data.registrations.find((x) => x.eventId === freeDoomed.id).status === "cancelled",
      "Ücretsiz etkinlikte de kayıt iptal edildi",
    );

    // ── 17. E-posta bildirimleri ────────────────────────────────────────────
    ok(
      mailer.outbox.some((m) => m.template === "joinConfirmed"),
      "Katılım onaylanınca bilet postası hazırlanıyor",
    );
    ok(
      mailer.outbox.some((m) => m.template === "eventCancelled"),
      "Etkinlik iptalinde katılımcılara posta gidiyor",
    );
    ok(
      mailer.outbox.some((m) => m.template === "registrationCancelled"),
      "Katılım iptalinde posta gidiyor",
    );

    // Dil tercihi postaya yansımalı
    const englishUser = client(baseUrl, "en");
    await englishUser("POST", "/api/auth/register", {
      name: "Mail Lang",
      email: "mail.lang@example.com",
      password: "maillang1234",
    });
    r = await englishUser("GET", "/api/events");
    const freeForMail = r.data.events.find((e) => e.priceMinor === 0);
    await englishUser("POST", "/api/events/" + freeForMail.id + "/join");
    ok(
      /you're going/i.test((lastMail("joinConfirmed") || {}).subject || ""),
      "Posta kullanıcının dilinde gidiyor",
      (lastMail("joinConfirmed") || {}).subject,
    );

    // ── 18. Şifre sıfırlama ─────────────────────────────────────────────────
    r = await guest("POST", "/api/auth/forgot", { email: "yok@example.com" });
    ok(r.status === 200, "Olmayan adres için de 200 dönüyor (hesap sızdırılmıyor)");
    ok(
      (lastMail() || {}).template !== "passwordReset",
      "Olmayan adrese sıfırlama postası gönderilmiyor",
    );

    r = await guest("POST", "/api/auth/forgot", { email: "irfan.test@example.com" });
    ok(r.status === 200, "Kayıtlı adres için sıfırlama istendi");
    ok(
      (lastMail() || {}).template === "passwordReset",
      "Sıfırlama postası hazırlandı",
    );

    // Jetonu veritabanından değil, gönderilen bağlantıdan alamayız (hash'li);
    // bu yüzden akışı doğrulamak için geçersiz jeton denenir.
    r = await guest("POST", "/api/auth/reset", {
      token: "gecersiz-jeton",
      password: "yenisifre123",
    });
    ok(r.status === 400, "Geçersiz jeton reddediliyor");

    r = await guest("POST", "/api/auth/reset", { token: "x", password: "kisa" });
    ok(r.status === 400, "Kısa yeni şifre reddediliyor");

    // Gerçek jetonla uçtan uca: jetonu doğrudan üretip veritabanına yazalım
    const resetUser = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get("irfan.test@example.com");
    const rawToken = crypto.randomBytes(16).toString("hex");
    db.prepare(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES (?, ?, datetime('now', '+2 hours'))`,
    ).run(resetUser.id, crypto.createHash("sha256").update(rawToken).digest("hex"));

    r = await guest("POST", "/api/auth/reset", {
      token: rawToken,
      password: "bambaskasifre1",
    });
    ok(r.status === 200, "Geçerli jetonla şifre güncelleniyor");

    const afterReset = client(baseUrl);
    r = await afterReset("POST", "/api/auth/login", {
      email: "irfan.test@example.com",
      password: "bambaskasifre1",
    });
    ok(r.status === 200, "Yeni şifreyle giriş yapılabiliyor");

    r = await guest("POST", "/api/auth/reset", {
      token: rawToken,
      password: "birdahaolmaz1",
    });
    ok(r.status === 400, "Aynı jeton ikinci kez kullanılamıyor");

    // ── 19. Hatırlatma postaları ────────────────────────────────────────────
    r = await zeynep("POST", "/api/events", {
      title: "Yarınki Etkinlik",
      city: "İstanbul",
      startsAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      capacity: 10,
      priceMinor: 0,
    });
    const soonEvent = r.data.event;
    await payer2("POST", "/api/events/" + soonEvent.id + "/join");

    let sentCount = app.locals.sendDueReminders(baseUrl);
    ok(sentCount >= 1, "Yaklaşan etkinlik için hatırlatma gönderiliyor (" + sentCount + ")");
    ok(
      (lastMail() || {}).template === "reminder",
      "Gönderilen posta hatırlatma şablonu",
    );

    sentCount = app.locals.sendDueReminders(baseUrl);
    ok(sentCount === 0, "Aynı kişiye ikinci hatırlatma gitmiyor");

    // ── 20. Hesap silme ─────────────────────────────────────────────────────
    const doomedUser = client(baseUrl);
    await doomedUser("POST", "/api/auth/register", {
      name: "Silinecek Kullanıcı",
      email: "silinecek@example.com",
      password: "silinecek1234",
    });

    r = await doomedUser("POST", "/api/me/delete", { password: "yanlissifre" });
    ok(r.status === 403, "Yanlış şifreyle hesap silinemiyor");

    r = await owner("POST", "/api/me/delete", { password: "owner1234" });
    ok(r.status === 403, "Uygulama sahibi hesabı silinemiyor");

    // Yayında etkinliği olan kullanıcı önce onu iptal etmeli
    r = await zeynep("POST", "/api/me/delete", { password: "zeynep1234" });
    ok(r.status === 409, "Yayında etkinliği olan organizatör önce iptal etmeli");

    r = await doomedUser("POST", "/api/me/delete", { password: "silinecek1234" });
    ok(r.status === 200, "Şifre doğruysa hesap siliniyor", JSON.stringify(r.data));
    ok(r.data.anonymized === false, "Ödemesi olmayan hesap tamamen siliniyor");

    const gone = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?")
      .get("silinecek@example.com").c;
    ok(gone === 0, "Kullanıcı kaydı veritabanından gitti");

    r = await doomedUser("GET", "/api/me");
    ok(!r.data.user, "Silinen hesabın oturumu kapandı");

    // Ödeme geçmişi olan kullanıcı kimliksizleştirilmeli
    r = await payer2("POST", "/api/me/delete", { password: "payer1234" });
    ok(r.status === 200 && r.data.anonymized === true, "Ödeme geçmişi olan hesap kimliksizleştiriliyor");

    const anon = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(
        db.prepare("SELECT user_id FROM payments ORDER BY id DESC LIMIT 1").get().user_id,
      );
    ok(
      !db.prepare("SELECT 1 FROM users WHERE email = ?").get("payer.two@example.com"),
      "Kişisel e-posta adresi silindi",
    );

    // ── 21. Tarihe göre süzme ───────────────────────────────────────────────
    // İstemcinin yaptığı gibi: yerel günün sınırlarını hesaplayıp aralık gönder.
    function dayRangeParams(iso) {
      const d = new Date(iso);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return (
        "from=" +
        encodeURIComponent(start.toISOString()) +
        "&to=" +
        encodeURIComponent(end.toISOString())
      );
    }

    r = await guest("GET", "/api/events");
    const allUpcoming = r.data.events;
    ok(allUpcoming.length > 1, "Süzgeçsiz listede birden çok etkinlik var");

    const sample = allUpcoming[0];
    r = await guest("GET", "/api/events?" + dayRangeParams(sample.startsAt));
    ok(
      r.data.events.length >= 1 && r.data.events.every((e) => {
        const a = new Date(e.startsAt);
        const b = new Date(sample.startsAt);
        return a.toDateString() === b.toDateString();
      }),
      "Tarih aralığı yalnızca o günün etkinliklerini döndürüyor",
      JSON.stringify(r.data.events.map((e) => e.startsAt)),
    );
    ok(
      r.data.events.some((e) => e.id === sample.id),
      "Aranan etkinlik sonuçta var",
    );
    ok(
      r.data.events.length < allUpcoming.length,
      "Tarih süzgeci listeyi daraltıyor (" +
        r.data.events.length +
        " / " +
        allUpcoming.length +
        ")",
    );

    // Hiç etkinlik olmayan bir gün boş dönmeli
    const emptyDay = new Date(Date.now() + 300 * 86400000).toISOString();
    r = await guest("GET", "/api/events?" + dayRangeParams(emptyDay));
    ok(r.data.events.length === 0, "Etkinliksiz gün boş liste döndürüyor");

    // Geçmiş bir gün: aralık verildiğinde "yaklaşanlar" kısıtı devre dışı kalmalı
    const pastEvent = db
      .prepare(
        "INSERT INTO events (organizer_id, title, starts_at, capacity, price_minor, city) VALUES (?,?,?,?,?,?)",
      )
      .run(
        db.prepare("SELECT id FROM users WHERE email='zeynep@example.com'").get().id,
        "Geçmiş Etkinlik",
        new Date(Date.now() - 10 * 86400000).toISOString(),
        10,
        0,
        "İstanbul",
      );
    const pastRow = db
      .prepare("SELECT starts_at FROM events WHERE id = ?")
      .get(pastEvent.lastInsertRowid);

    r = await guest("GET", "/api/events?" + dayRangeParams(pastRow.starts_at));
    ok(
      r.data.events.some((e) => e.title === "Geçmiş Etkinlik"),
      "Geçmiş bir tarih seçilince o günün etkinlikleri görünüyor",
    );

    r = await guest("GET", "/api/events");
    ok(
      !r.data.events.some((e) => e.title === "Geçmiş Etkinlik"),
      "Tarih verilmediğinde geçmiş etkinlikler listede yok",
    );

    // Bozuk aralık yok sayılmalı, hata vermemeli
    r = await guest("GET", "/api/events?from=abc&to=def");
    ok(
      r.status === 200 && r.data.events.length === allUpcoming.length,
      "Geçersiz tarih aralığı yok sayılıyor",
    );

    // Tarih süzgeci kategori süzgeciyle birlikte çalışmalı
    r = await guest(
      "GET",
      "/api/events?category=Sports&" + dayRangeParams(sample.startsAt),
    );
    ok(
      r.data.events.every((e) => e.category === "Sports"),
      "Tarih ve kategori süzgeçleri birlikte uygulanıyor",
    );

    // ── 22. Yetkisiz erişim ─────────────────────────────────────────────────
    r = await guest("POST", "/api/events/" + volleyball.id + "/join");
    ok(r.status === 401, "Giriş yapmadan katılım engelleniyor");

    r = await guest("GET", "/api/my/registrations");
    ok(r.status === 401, "Giriş yapmadan kişisel veri okunamıyor");
  } catch (err) {
    failures++;
    console.log("\n  ✗ Beklenmeyen hata: " + err.stack);
  }

  server.close();

  console.log(
    "\n" +
      (failures === 0
        ? "✓ " + checks + " kontrolün hepsi geçti.\n"
        : "✗ " + failures + " / " + checks + " kontrol başarısız.\n"),
  );
  process.exit(failures === 0 ? 0 : 1);
})();
