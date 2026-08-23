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
  fs.mkdtempSync(path.join(os.tmpdir(), "bulus-smoke-")),
  "test.db",
);
process.env.DB_PATH = tmpDb;
process.env.SESSION_SECRET = "smoke-test-secret";
delete process.env.STRIPE_SECRET_KEY;

const app = require("../server");

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
function client(baseUrl) {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: Object.assign(
        { Accept: "application/json" },
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

  console.log("\nBuluş — duman testi (" + baseUrl + ")\n");

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
      email: "owner@bulus.app",
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

    // ── 12. Yetkisiz erişim ─────────────────────────────────────────────────
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
