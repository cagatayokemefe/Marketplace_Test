"use strict";

/**
 * Demo verisi. `npm run seed` ile çalışır, `npm run reset` ile önce temizler.
 * Sunucu ilk açılışta boş veritabanı görürse bunu otomatik çağırır.
 */

const bcrypt = require("bcryptjs");
const db = require("./db");
const config = require("./config");

function daysFromNow(days, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function plusHours(iso, hours) {
  const d = new Date(iso);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function ticketCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3) out += "-";
  }
  return out;
}

function reset() {
  db.exec(`
    DELETE FROM payments;
    DELETE FROM registrations;
    DELETE FROM events;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('payments','registrations','events','users');
  `);
}

function upsertUser({ name, email, password, role = "user", city, bio, phone }) {
  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, phone, role, city, bio)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      email,
      bcrypt.hashSync(password, 10),
      phone || null,
      role,
      city || null,
      bio || null,
    );
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

function seed() {
  const owner = upsertUser({
    name: config.owner.name,
    email: config.owner.email,
    password: config.owner.password,
    role: "owner",
    city: "İstanbul",
    bio: "Bu uygulamanın sahibi. Tüm ödemeler bu hesapta toplanır.",
  });

  const irfan = upsertUser({
    name: "İrfan Yılmaz",
    email: "irfan@example.com",
    password: "irfan1234",
    city: "İstanbul",
    bio: "Voleybol ve doğa yürüyüşü seviyorum.",
    phone: "+90 555 000 00 01",
  });

  const zeynep = upsertUser({
    name: "Zeynep Kaya",
    email: "zeynep@example.com",
    password: "zeynep1234",
    city: "İstanbul",
    bio: "Haftada iki gün voleybol organizasyonu yapıyorum.",
  });

  const mehmet = upsertUser({
    name: "Mehmet Demir",
    email: "mehmet@example.com",
    password: "mehmet1234",
    city: "Ankara",
  });

  if (db.prepare("SELECT COUNT(*) AS c FROM events").get().c > 0) {
    return { owner, irfan };
  }

  const insertEvent = db.prepare(`
    INSERT INTO events
      (organizer_id, title, description, category, cover, city, venue, address,
       starts_at, ends_at, capacity, price_minor, currency, level)
    VALUES
      (@organizer_id, @title, @description, @category, @cover, @city, @venue, @address,
       @starts_at, @ends_at, @capacity, @price_minor, @currency, @level)
  `);

  const events = [
    {
      organizer_id: zeynep.id,
      title: "Salı Akşamı Voleybol",
      description:
        "Kapalı salonda 6v6 voleybol. Her seviyeye açık, karışık takımlar kuruyoruz. " +
        "Salon ücreti kişi başına bölünüyor, ödemeni uygulamadan yaptığında yerin garanti. " +
        "File, top ve skorboard bizden; sen sadece spor ayakkabınla gel.",
      category: "Spor",
      cover: "🏐",
      city: "İstanbul",
      venue: "Kadıköy Spor Salonu",
      address: "Caferağa Mah. Spor Cad. No:12, Kadıköy",
      starts_at: daysFromNow(2, 20, 0),
      ends_at: plusHours(daysFromNow(2, 20, 0), 2),
      capacity: 12,
      price_minor: 15000,
      currency: config.currency,
      level: "Herkes",
    },
    {
      organizer_id: zeynep.id,
      title: "Plaj Voleybolu — Caddebostan",
      description:
        "Sahilde 4v4 plaj voleybolu. Antrenman değil, keyif maçı. Sonrasında sahilde çay içiyoruz.",
      category: "Spor",
      cover: "🏖️",
      city: "İstanbul",
      venue: "Caddebostan Sahil Sahaları",
      address: "Caddebostan Sahil Yolu, Kadıköy",
      starts_at: daysFromNow(5, 18, 30),
      ends_at: plusHours(daysFromNow(5, 18, 30), 2),
      capacity: 16,
      price_minor: 10000,
      currency: config.currency,
      level: "Başlangıç",
    },
    {
      organizer_id: mehmet.id,
      title: "Halı Saha Futbol — Perşembe",
      description:
        "Perşembe akşamı 7v7 halı saha. Kaleci aranıyor! Ücrete saha kirası ve su dahil.",
      category: "Spor",
      cover: "⚽",
      city: "Ankara",
      venue: "Çankaya Halı Saha",
      address: "Çankaya Mah. Stadyum Sok. No:3",
      starts_at: daysFromNow(3, 21, 0),
      ends_at: plusHours(daysFromNow(3, 21, 0), 1),
      capacity: 14,
      price_minor: 12000,
      currency: config.currency,
      level: "Orta",
    },
    {
      organizer_id: irfan.id,
      title: "Belgrad Ormanı Sabah Yürüyüşü",
      description:
        "8 km'lik keyifli bir parkur. Ücretsiz, sadece katılımcı sayısını bilmek için kayıt alıyoruz.",
      category: "Doğa",
      cover: "🌲",
      city: "İstanbul",
      venue: "Belgrad Ormanı Neşet Suyu Girişi",
      address: "Bahçeköy, Sarıyer",
      starts_at: daysFromNow(6, 9, 0),
      ends_at: plusHours(daysFromNow(6, 9, 0), 3),
      capacity: 30,
      price_minor: 0,
      currency: config.currency,
      level: "Herkes",
    },
    {
      organizer_id: mehmet.id,
      title: "Başlangıç Seviyesi Yoga Atölyesi",
      description:
        "Nefes ve temel duruşlar üzerine 90 dakikalık atölye. Mat salonda mevcut.",
      category: "Sağlık",
      cover: "🧘",
      city: "İzmir",
      venue: "Alsancak Yoga Stüdyo",
      address: "Alsancak Mah. Kıbrıs Şehitleri Cad. No:44",
      starts_at: daysFromNow(4, 19, 0),
      ends_at: plusHours(daysFromNow(4, 19, 0), 2),
      capacity: 18,
      price_minor: 25000,
      currency: config.currency,
      level: "Başlangıç",
    },
    {
      organizer_id: zeynep.id,
      title: "Kod & Kahve: JavaScript Buluşması",
      description:
        "Kısa sunumlar, sonrasında serbest sohbet. Kahve ve kurabiye ücrete dahil.",
      category: "Teknoloji",
      cover: "💻",
      city: "İstanbul",
      venue: "Levent Coworking",
      address: "Levent Mah. Büyükdere Cad. No:120",
      starts_at: daysFromNow(9, 19, 30),
      ends_at: plusHours(daysFromNow(9, 19, 30), 3),
      capacity: 40,
      price_minor: 8000,
      currency: config.currency,
      level: "Herkes",
    },
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertEvent.run(row);
  });
  insertMany(events);

  // Örnek: birkaç kişi çoktan katılmış olsun ki etkinlikler boş görünmesin.
  const volleyball = db
    .prepare("SELECT * FROM events WHERE title = ?")
    .get("Salı Akşamı Voleybol");

  const insertReg = db.prepare(`
    INSERT INTO registrations (event_id, user_id, status, amount_minor, ticket_code)
    VALUES (?, ?, 'confirmed', ?, ?)
  `);
  const insertPay = db.prepare(`
    INSERT INTO payments
      (registration_id, event_id, user_id, amount_minor, currency, provider,
       provider_ref, status, commission_minor, organizer_share_minor, card_last4, paid_at)
    VALUES (?, ?, ?, ?, ?, 'demo', ?, 'paid', ?, ?, '4242',
            strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `);

  for (const attendee of [mehmet]) {
    const reg = insertReg.run(
      volleyball.id,
      attendee.id,
      volleyball.price_minor,
      ticketCode(),
    );
    const commission = Math.round(volleyball.price_minor * config.commissionRate);
    insertPay.run(
      reg.lastInsertRowid,
      volleyball.id,
      attendee.id,
      volleyball.price_minor,
      volleyball.currency,
      "demo_seed_" + reg.lastInsertRowid,
      commission,
      volleyball.price_minor - commission,
    );
  }

  return { owner, irfan };
}

function isEmpty() {
  return db.prepare("SELECT COUNT(*) AS c FROM users").get().c === 0;
}

if (require.main === module) {
  if (process.argv.includes("--reset")) {
    reset();
    console.log("• Veritabanı temizlendi.");
  }
  seed();
  console.log("✓ Demo verisi hazır.");
  console.log("  Uygulama sahibi :", config.owner.email, "/", config.owner.password);
  console.log("  Demo kullanıcı  : irfan@example.com / irfan1234");
}

module.exports = { seed, reset, isEmpty, ticketCode };
