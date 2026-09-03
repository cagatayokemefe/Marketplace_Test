"use strict";

/**
 * Arayüzde kullanılan her çeviri anahtarının sözlükte bulunduğunu doğrular.
 * Sunucu sözlüğündeki bir anahtarı istemcide kullanmak kolay bir hata; o zaman
 * ekranda çevirinin yerine "auth.resetInvalid" gibi ham anahtar görünür.
 *
 *   node tools/check-i18n.js
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

global.window = {};
// navigator Node'da salt okunur; zaten dili aşağıda elle seçiyoruz.
global.localStorage = { getItem: () => null, setItem: () => {} };
global.document = { documentElement: { setAttribute: () => {} } };
require(path.join(root, "public/i18n.js"));
const I18N = global.window.I18N;

// t("anahtar") ve t('anahtar') çağrılarını topla; değişkenle çağrılanlar
// (t(variantKey) gibi) burada yakalanamaz, onları elle kontrol ediyoruz.
const used = new Set();
const callPattern = /\bt\(\s*["']([\w.]+)["']/g;
let match;
while ((match = callPattern.exec(appSource))) {
  // Nokta ile biten yakalamalar t("pay." + status) gibi ön eklerdir; bunların
  // tam hâlleri aşağıda elle listeleniyor.
  if (!match[1].endsWith(".")) used.add(match[1]);
}

// Dinamik olarak kurulan anahtar öbekleri.
for (const status of ["paid", "pending", "refunded", "failed"]) used.add("pay." + status);
for (const mode of ["connect", "platform"]) used.add("payout." + mode);
for (const c of I18N.categories) used.add("category." + c);
for (const l of I18N.levels) used.add("level." + l);
for (const base of [
  "card.spotsLeft",
  "detail.attendeeCount",
  "host.payments",
  "time.inDays",
  "time.inHours",
  "time.inMinutes",
]) {
  used.add(base + "_one");
  used.add(base + "_other");
  used.delete(base);
}

const langs = I18N.langs.map((l) => l.code);
const missing = [];

for (const key of [...used].sort()) {
  for (const lang of langs) {
    I18N.set(lang);
    // Sözlükte yoksa t() anahtarın kendisini döndürür.
    if (I18N.t(key) === key) missing.push(lang + " → " + key);
  }
}

if (missing.length) {
  console.error("✗ Eksik çeviri anahtarı (" + missing.length + "):");
  for (const m of missing) console.error("   " + m);
  process.exit(1);
}

console.log(
  "✓ " + used.size + " anahtarın hepsi " + langs.join(" ve ") + " sözlüklerinde var.",
);
