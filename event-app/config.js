"use strict";

/**
 * Merkezi yapılandırma.
 *
 * Ödeme sağlayıcısı iki modda çalışır:
 *   - "stripe": STRIPE_SECRET_KEY tanımlıysa gerçek Stripe Checkout kullanılır.
 *               Para doğrudan uygulama sahibinin Stripe hesabına geçer.
 *   - "demo"  : Anahtar yoksa uygulama, uçtan uca akışı bozmadan sahte bir
 *               kart ekranıyla çalışır (geliştirme / demo için).
 */

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const path = require("path");

const stripeSecret = (process.env.STRIPE_SECRET_KEY || "").trim();

// Veritabanı ve oturum dosyaları aynı klasörde durur. Sunucuda bu klasör
// kalıcı diske (volume) bağlanmalıdır; yoksa her dağıtımda veri silinir.
const dbPath = process.env.DB_PATH || path.join(__dirname, "meetapp.db");

const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",

  dbPath: dbPath,
  dataDir: path.dirname(dbPath),

  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),

  sessionSecret:
    process.env.SESSION_SECRET ||
    "meetapp-dev-secret-change-me-in-production-please",

  // Uygulama sahibi (tüm ödemelerin toplandığı hesap)
  owner: {
    name: process.env.OWNER_NAME || "MeetApp",
    email: (process.env.OWNER_EMAIL || "owner@meetapp.app").toLowerCase(),
    password: process.env.OWNER_PASSWORD || "owner1234",
  },

  // Sunucu mesajlarının ve ilk açılışın varsayılan dili.
  // İstemci kendi seçimini X-Lang başlığıyla gönderir.
  defaultLang: (process.env.DEFAULT_LANG || "tr").toLowerCase(),

  currency: process.env.CURRENCY || "TRY",
  currencySymbol: process.env.CURRENCY_SYMBOL || "₺",

  // Uygulama sahibinin aldığı komisyon oranı (0–1).
  // Ödemenin tamamı sahibin hesabına geçer; bu oran sadece
  // "organizatöre ne kadar borçluyum" hesabını yapmak için kullanılır.
  commissionRate: Math.min(Math.max(num(process.env.COMMISSION_RATE, 0.1), 0), 1),

  payments: {
    provider: stripeSecret ? "stripe" : "demo",
    stripeSecretKey: stripeSecret,
    stripeApiBase: "https://api.stripe.com/v1",
  },
};

module.exports = config;
