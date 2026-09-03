"use strict";

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const db = require("./db");
const config = require("./config");
const payments = require("./payments");
const { t, langOf, SUPPORTED } = require("./messages");
const mailer = require("./mailer");
const { seed, isEmpty, ticketCode } = require("./seed");

const app = express();
app.set("trust proxy", 1);

// ── Güvenlik ────────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// Stripe webhook'unun imzası ham gövde üzerinden doğrulanır, bu yüzden o yolda
// JSON ayrıştırıcı devreye girmemeli.
const WEBHOOK_PATH = "/api/stripe/webhook";
const jsonParser = express.json({ limit: "256kb" });
app.use((req, res, next) => {
  if (req.path === WEBHOOK_PATH) return next();
  jsonParser(req, res, next);
});
app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.use(
  session({
    // Oturumlar veritabanıyla aynı (kalıcı) klasöre yazılır; yoksa her
    // dağıtımdan sonra herkes çıkış yapmış olur.
    store: new SQLiteStore({
      db: "sessions.db",
      dir: config.dataDir,
      table: "sessions",
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "meetapp.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax", // Stripe dönüşü üst seviye yönlendirme olduğu için 'lax'
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimit.authPerQuarterHour,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: t(req, "rate.auth") }),
});

const payLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.payPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: t(req, "rate.pay") }),
});

// ── Yardımcılar ─────────────────────────────────────────────────────────────

function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: t(req, "auth.required") });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: t(req, "auth.sessionMissing") });
  }
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: t(req, "auth.ownerOnly") });
  }
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    city: u.city,
    bio: u.bio,
    payoutsReady: !!(u.stripe_account_id && u.stripe_charges_enabled),
    initials: u.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toLocaleUpperCase("tr-TR"),
  };
}

const attendeeCountStmt = db.prepare(
  "SELECT COUNT(*) AS c FROM registrations WHERE event_id = ? AND status = 'confirmed'",
);

function shapeEvent(row, viewerId) {
  const organizer = db.prepare("SELECT * FROM users WHERE id = ?").get(row.organizer_id);
  const series = row.series_id
    ? db.prepare("SELECT * FROM event_series WHERE id = ?").get(row.series_id)
    : null;
  const attendeeCount = attendeeCountStmt.get(row.id).c;
  const myReg = viewerId
    ? db
        .prepare(
          "SELECT * FROM registrations WHERE event_id = ? AND user_id = ? AND status != 'cancelled'",
        )
        .get(row.id, viewerId)
    : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    cover: row.cover,
    city: row.city,
    venue: row.venue,
    address: row.address,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    priceMinor: row.price_minor,
    currency: row.currency,
    level: row.level,
    status: row.status,
    createdAt: row.created_at,
    attendeeCount,
    spotsLeft: Math.max(row.capacity - attendeeCount, 0),
    isFull: attendeeCount >= row.capacity,
    isPast: new Date(row.starts_at).getTime() < Date.now(),
    series: series
      ? {
          id: series.id,
          frequency: series.frequency,
          index: row.series_index,
          count: series.occurrences,
        }
      : null,
    organizer: publicUser(organizer),
    isOrganizer: viewerId === row.organizer_id,
    myRegistration: myReg
      ? {
          id: myReg.id,
          status: myReg.status,
          ticketCode: myReg.status === "confirmed" ? myReg.ticket_code : null,
          checkedInAt: myReg.checked_in_at,
        }
      : null,
  };
}

const REPEAT_FREQUENCIES = ["weekly", "biweekly", "monthly"];
const MAX_OCCURRENCES = 26;

/**
 * Seri içindeki diğer tarihler için kısa gösterim. Tam shapeEvent'i her tekrar
 * için çalıştırmıyoruz; listede yalnızca tarih ve doluluk gerekiyor.
 */
function shapeOccurrence(row) {
  const attendeeCount = attendeeCountStmt.get(row.id).c;
  return {
    id: row.id,
    startsAt: row.starts_at,
    seriesIndex: row.series_index,
    capacity: row.capacity,
    attendeeCount,
    spotsLeft: Math.max(row.capacity - attendeeCount, 0),
    isFull: attendeeCount >= row.capacity,
  };
}

function uniqueTicketCode() {
  for (let i = 0; i < 25; i++) {
    const code = ticketCode();
    const clash = db
      .prepare("SELECT 1 FROM registrations WHERE ticket_code = ?")
      .get(code);
    if (!clash) return code;
  }
  return "TK" + Date.now().toString(36).toUpperCase();
}

function splitAmount(amountMinor) {
  const commission = Math.round(amountMinor * config.commissionRate);
  return { commission, organizerShare: amountMinor - commission };
}

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Postayı kullanıcının kendi dilinde göndermek için alıcı bilgisi. */
function mailRecipient(user) {
  return {
    email: user.email,
    name: user.name,
    lang: SUPPORTED.includes(user.lang) ? user.lang : config.defaultLang,
  };
}

function formatWhen(iso, lang) {
  try {
    return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  }
}

function formatMoney(minor, currency, lang) {
  try {
    return new Intl.NumberFormat(lang === "en" ? "en-GB" : "tr-TR", {
      style: "currency",
      currency: currency || config.currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch (err) {
    return (minor / 100).toFixed(2) + " " + (currency || config.currency);
  }
}

/** Bilet postası: kayıt onaylandığında ve hatırlatmada kullanılır. */
function sendTicketMail(template, registrationId, baseUrlValue) {
  const row = db
    .prepare(
      `SELECT r.*, e.title, e.starts_at, e.venue, e.city, u.name AS user_name,
              u.email AS user_email, u.lang AS user_lang
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`,
    )
    .get(registrationId);
  if (!row) return Promise.resolve({ sent: false });

  const to = mailRecipient({
    email: row.user_email,
    name: row.user_name,
    lang: row.user_lang,
  });

  return mailer.sendQuietly(
    template,
    to,
    {
      title: row.title,
      when: formatWhen(row.starts_at, to.lang),
      place: row.venue ? row.venue + " · " + row.city : row.city,
      code: row.ticket_code,
      registrationId: row.id,
    },
    baseUrlValue,
  );
}

/** Kullanıcının Connect hesabının para almaya hazır olup olmadığı. */
function payoutState(user) {
  if (!user) return { connected: false, ready: false, accountId: null };
  return {
    connected: !!user.stripe_account_id,
    ready: !!(user.stripe_account_id && user.stripe_charges_enabled),
    accountId: user.stripe_account_id || null,
    chargesEnabled: !!user.stripe_charges_enabled,
    payoutsEnabled: !!user.stripe_payouts_enabled,
    detailsSubmitted: !!user.stripe_details_submitted,
  };
}

/** Etkinliğin organizatörünün payının nereye gideceği. */
function organizerPayoutTarget(event) {
  if (!payments.connectEnabled) return { destination: null };
  const organizer = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(event.organizer_id);
  const state = payoutState(organizer);
  return { destination: state.ready ? state.accountId : null };
}

/**
 * Ödemeyi "ödendi" yapıp kaydı onaylar. Hem tarayıcı dönüşünden hem webhook'tan
 * çağrılabildiği için idempotent: ikinci çağrı hiçbir şeyi bozmaz.
 * @returns {string|null} bilet kodu
 */
function finalizePayment(paymentId, { cardLast4 = null, providerRef = null } = {}) {
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (!row) return null;

    const ticketOf = () =>
      db.prepare("SELECT ticket_code FROM registrations WHERE id = ?").get(
        row.registration_id,
      ).ticket_code;

    if (row.status === "paid") return ticketOf();
    if (row.status !== "pending") return null;

    db.prepare(
      `UPDATE payments
         SET status = 'paid',
             paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             card_last4 = COALESCE(?, card_last4),
             provider_ref = COALESCE(?, provider_ref)
       WHERE id = ? AND status = 'pending'`,
    ).run(cardLast4, providerRef, paymentId);

    db.prepare("UPDATE registrations SET status = 'confirmed' WHERE id = ?").run(
      row.registration_id,
    );
    return ticketOf();
  })();
}

/** Parayı geri verir ve kaydı iptal eder. Connect ödemelerinde pay da geri alınır. */
async function refundPayment(payment) {
  await payments.refund(payment);
  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(payment.id);
    db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(
      payment.registration_id,
    );
  })();
}

// ── Genel ayarlar ───────────────────────────────────────────────────────────

/** Hosting sağlayıcılarının canlılık kontrolü için. */
app.get("/api/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/config", (req, res) => {
  const owner = db.prepare("SELECT name FROM users WHERE role = 'owner' LIMIT 1").get();
  res.json({
    appName: "MeetApp",
    paymentProvider: payments.provider,
    currency: config.currency,
    currencySymbol: config.currencySymbol,
    commissionRate: config.commissionRate,
    ownerName: owner ? owner.name : config.owner.name,
    connectEnabled: payments.connectEnabled,
    languages: SUPPORTED,
    defaultLanguage: config.defaultLang,
    language: langOf(req),
    demoCards: payments.provider === "demo"
      ? {
          success: "4242 4242 4242 4242",
          declined: "4000 0000 0000 0002",
        }
      : null,
  });
});

// ── Kimlik doğrulama ────────────────────────────────────────────────────────

app.post("/api/auth/register", authLimiter, (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const city = String(req.body.city || "").trim() || null;

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: t(req, "auth.nameLength") });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: t(req, "auth.invalidEmail") });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: t(req, "auth.passwordShort") });
  }
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: t(req, "auth.emailTaken") });
  }

  const info = db
    .prepare(
      "INSERT INTO users (name, email, password_hash, city, lang) VALUES (?, ?, ?, ?, ?)",
    )
    .run(name, email, bcrypt.hashSync(password, 10), city, langOf(req));

  req.session.userId = info.lastInsertRowid;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: t(req, "auth.badCredentials") });
  }

  req.session.userId = user.id;
  // Postaları en son kullandığı dilde göndermek için tercihini güncel tut.
  db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(langOf(req), user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("meetapp.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  res.json({ user: publicUser(user) });
});

app.patch("/api/me", requireAuth, (req, res) => {
  const name = req.body.name !== undefined ? String(req.body.name).trim() : req.user.name;
  const city = req.body.city !== undefined ? String(req.body.city).trim() : req.user.city;
  const bio = req.body.bio !== undefined ? String(req.body.bio).trim() : req.user.bio;
  const phone =
    req.body.phone !== undefined ? String(req.body.phone).trim() : req.user.phone;

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: t(req, "auth.nameLength") });
  }

  db.prepare("UPDATE users SET name = ?, city = ?, bio = ?, phone = ? WHERE id = ?").run(
    name,
    city || null,
    bio || null,
    phone || null,
    req.user.id,
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(user) });
});

// ── Etkinlikler ─────────────────────────────────────────────────────────────

app.get("/api/events", (req, res) => {
  const q = String(req.query.q || "").trim().toLocaleLowerCase("tr-TR");
  const category = String(req.query.category || "").trim();
  const city = String(req.query.city || "").trim();
  const scope = String(req.query.scope || "upcoming");

  // Tarih aralığı istemciden kesin zaman damgası olarak gelir. Sebebi: starts_at
  // UTC saklanıyor ama "5 Eylül'deki etkinlikler" kullanıcının yerel gününü
  // kastediyor. Günün sınırlarını, saat dilimini bilen taraf (tarayıcı) hesaplar.
  const from = Date.parse(String(req.query.from || ""));
  const to = Date.parse(String(req.query.to || ""));
  const hasRange = Number.isFinite(from) && Number.isFinite(to) && to > from;

  let sql = "SELECT * FROM events WHERE status = 'published'";
  const params = [];

  if (hasRange) {
    // Belirli bir tarih istendiğinde "yaklaşanlar" kısıtı uygulanmaz; kullanıcı
    // geçmiş bir güne de bakabilmeli.
    sql += " AND datetime(starts_at) >= datetime(?) AND datetime(starts_at) < datetime(?)";
    params.push(new Date(from).toISOString(), new Date(to).toISOString());
  } else if (scope !== "all") {
    sql += " AND datetime(starts_at) >= datetime('now', '-2 hours')";
  }
  if (category && category !== "Tümü") {
    sql += " AND category = ?";
    params.push(category);
  }
  if (city && city !== "Tümü") {
    sql += " AND city = ?";
    params.push(city);
  }
  sql += " ORDER BY datetime(starts_at) ASC LIMIT 200";

  let rows = db.prepare(sql).all(...params);

  if (q) {
    rows = rows.filter((r) =>
      [r.title, r.description, r.venue, r.city, r.category]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(q),
    );
  }

  res.json({
    events: rows.map((r) => shapeEvent(r, req.session.userId)),
    filters: {
      categories: db
        .prepare("SELECT DISTINCT category FROM events ORDER BY category")
        .all()
        .map((r) => r.category),
      cities: db
        .prepare("SELECT DISTINCT city FROM events ORDER BY city")
        .all()
        .map((r) => r.city),
    },
  });
});

app.get("/api/events/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: t(req, "event.notFound") });

  const event = shapeEvent(row, req.session.userId);
  const attendees = db
    .prepare(
      `SELECT u.* FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.status = 'confirmed'
       ORDER BY r.created_at ASC`,
    )
    .all(row.id)
    .map(publicUser)
    .map((u) => ({ id: u.id, name: u.name, initials: u.initials, city: u.city }));

  // Seriye aitse, aynı seriden gelecek diğer tarihler.
  const occurrences = row.series_id
    ? db
        .prepare(
          `SELECT * FROM events
           WHERE series_id = ? AND id != ? AND status = 'published'
             AND datetime(starts_at) >= datetime('now', '-2 hours')
           ORDER BY datetime(starts_at) ASC LIMIT 8`,
        )
        .all(row.series_id, row.id)
        .map(shapeOccurrence)
    : [];

  res.json({ event, attendees, occurrences });
});

app.post("/api/events", requireAuth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  const description = String(b.description || "").trim();
  const category = String(b.category || "Sports").trim();
  const cover = String(b.cover || "🎉").trim().slice(0, 8);
  const city = String(b.city || "").trim();
  const venue = String(b.venue || "").trim();
  const address = String(b.address || "").trim();
  const level = String(b.level || "All").trim();
  const startsAt = String(b.startsAt || "");
  const capacity = Number(b.capacity);
  const priceMinor = Math.round(Number(b.priceMinor));

  if (title.length < 3 || title.length > 120) {
    return res.status(400).json({ error: t(req, "validate.title") });
  }
  if (!city) return res.status(400).json({ error: t(req, "validate.city") });
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: t(req, "validate.date") });
  }
  if (start.getTime() < Date.now() - 60 * 1000) {
    return res.status(400).json({ error: t(req, "validate.futureDate") });
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
    return res.status(400).json({ error: t(req, "validate.capacity") });
  }
  if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > 100000000) {
    return res.status(400).json({ error: t(req, "validate.price") });
  }

  const durationHours = Math.min(Math.max(Number(b.durationHours) || 2, 1), 12);

  /*
   * Tekrar tarihlerini istemci hesaplar, sunucu yalnızca doğrular. Sebebi tarih
   * süzgecindekiyle aynı: yerel saat dilimini bilen taraf tarayıcı. "Her salı
   * 19:00" derken kastedilen duvar saatidir; sunucuda UTC'ye 7×24 saat eklemek
   * yaz saati geçişinden sonra etkinliği 18:00'a ya da 20:00'a kaydırırdı.
   */
  const repeat = b.repeat && typeof b.repeat === "object" ? b.repeat : null;
  const frequency =
    repeat && repeat.frequency && repeat.frequency !== "none"
      ? String(repeat.frequency)
      : null;
  const extraDates = [];

  if (frequency) {
    if (!REPEAT_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: t(req, "validate.repeatFrequency") });
    }
    const rawDates = Array.isArray(repeat.dates) ? repeat.dates : [];
    if (rawDates.length < 1 || rawDates.length > MAX_OCCURRENCES - 1) {
      return res
        .status(400)
        .json({ error: t(req, "validate.repeatCount", { max: MAX_OCCURRENCES }) });
    }
    // Artan sırada ve birbirinden farklı olmalı; ilki zaten startsAt.
    let previous = start.getTime();
    for (const value of rawDates) {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ error: t(req, "validate.repeatDates") });
      }
      if (date.getTime() <= previous) {
        return res.status(400).json({ error: t(req, "validate.repeatOrder") });
      }
      previous = date.getTime();
      extraDates.push(date);
    }
  }

  const insertEvent = db.prepare(
    `INSERT INTO events
      (organizer_id, title, description, category, cover, city, venue, address,
       starts_at, ends_at, capacity, price_minor, currency, level,
       series_id, series_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const created = db.transaction(() => {
    const seriesId = frequency
      ? db
          .prepare(
            "INSERT INTO event_series (organizer_id, frequency, occurrences) VALUES (?,?,?)",
          )
          .run(req.user.id, frequency, extraDates.length + 1).lastInsertRowid
      : null;

    return [start].concat(extraDates).map((date, i) =>
      insertEvent.run(
        req.user.id,
        title,
        description,
        category,
        cover,
        city,
        venue,
        address,
        date.toISOString(),
        new Date(date.getTime() + durationHours * 3600 * 1000).toISOString(),
        capacity,
        priceMinor,
        config.currency,
        level,
        seriesId,
        seriesId ? i + 1 : null,
      ).lastInsertRowid,
    );
  })();

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(created[0]);
  res.status(201).json({
    event: shapeEvent(row, req.user.id),
    series: frequency ? { frequency, count: created.length, eventIds: created } : null,
  });
});

/**
 * Tek bir etkinliği iptal eder, ödemiş herkese parasını geri verir ve haber
 * gönderir. Seri iptalinde bu tekrar tekrar çağrılır.
 *
 * Katılımcının kendi iptalinde geçerli olan "son 6 saatte iade yok" kuralı
 * burada uygulanmaz: etkinliği iptal eden organizatör, kabahat katılımcıda
 * değil. Bir iade başarısız olursa diğerleri yine de yapılır ve o ödeme
 * 'paid' kalır; böylece sahibin panelinde görünüp elle çözülebilir.
 */
async function cancelSingleEvent(row, baseUrlValue) {
  // Kayıtları iptal etmeden önce kime haber vereceğimizi topla.
  const notify = db
    .prepare(
      `SELECT u.email, u.name, u.lang, r.amount_minor
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.status = 'confirmed'`,
    )
    .all(row.id);

  const paidPayments = db
    .prepare(
      `SELECT p.* FROM payments p
       JOIN registrations r ON r.id = p.registration_id
       WHERE p.event_id = ? AND p.status = 'paid' AND r.status = 'confirmed'`,
    )
    .all(row.id);

  let refundedCount = 0;
  let refundedMinor = 0;
  const failedIds = [];

  for (const payment of paidPayments) {
    try {
      await refundPayment(payment);
      refundedCount += 1;
      refundedMinor += payment.amount_minor;
    } catch (err) {
      console.error("Etkinlik iptalinde iade başarısız:", payment.id, err);
      failedIds.push(payment.id);
    }
  }

  db.transaction(() => {
    // Ücretsiz kayıtlar ve iadesi tutmayanlar da katılımcı listesinden düşer.
    db.prepare(
      "UPDATE registrations SET status = 'cancelled' WHERE event_id = ? AND status != 'cancelled'",
    ).run(row.id);
    db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(row.id);
  })();

  for (const person of notify) {
    const to = mailRecipient(person);
    const refunded = person.amount_minor > 0 && failedIds.length === 0;
    mailer.sendQuietly(
      "eventCancelled",
      to,
      {
        title: row.title,
        when: formatWhen(row.starts_at, to.lang),
        refundLine:
          person.amount_minor > 0
            ? refunded
              ? to.lang === "en"
                ? `Your payment of ${formatMoney(person.amount_minor, row.currency, "en")} has been refunded.`
                : `${formatMoney(person.amount_minor, row.currency, "tr")} tutarındaki ödemen iade edildi.`
              : to.lang === "en"
                ? "Your refund is being processed — we will be in touch."
                : "İaden işleme alındı, seninle iletişime geçeceğiz."
            : "",
      },
      baseUrlValue,
    );
  }

  return { refundedCount, refundedMinor, failedCount: failedIds.length };
}

/**
 * Etkinliği — ya da body'de scope:"series" varsa serinin tamamını — iptal eder.
 *
 * Seri iptalinde geçmiş tekrarlar dokunulmadan bırakılır: onlar zaten yapıldı,
 * iptal edilirlerse katılan insanlara haksız yere para iadesi giderdi. Tıklanan
 * etkinlik ise tarihi ne olursa olsun her zaman iptal edilir.
 */
app.post(
  "/api/events/:id/cancel",
  requireAuth,
  asyncRoute(async (req, res) => {
    const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: t(req, "event.notFound") });
    if (row.organizer_id !== req.user.id && req.user.role !== "owner") {
      return res.status(403).json({ error: t(req, "event.notOrganizer") });
    }

    const wholeSeries = String((req.body || {}).scope || "") === "series" && row.series_id;

    const targets = wholeSeries
      ? db
          .prepare(
            `SELECT * FROM events
             WHERE series_id = ? AND status = 'published'
               AND (id = ? OR datetime(starts_at) >= datetime('now'))
             ORDER BY datetime(starts_at) ASC`,
          )
          .all(row.series_id, row.id)
      : row.status === "cancelled"
        ? []
        : [row];

    if (!targets.length) {
      return res.status(409).json({ error: t(req, "event.alreadyCancelled") });
    }

    const base = baseUrl(req);
    let refundedCount = 0;
    let refundedMinor = 0;
    let failedCount = 0;

    for (const target of targets) {
      const result = await cancelSingleEvent(target, base);
      refundedCount += result.refundedCount;
      refundedMinor += result.refundedMinor;
      failedCount += result.failedCount;
    }

    res.json({
      ok: true,
      cancelledCount: targets.length,
      refundedCount,
      refundedMinor,
      currency: row.currency,
      failedCount,
    });
  }),
);

app.get("/api/events/:id/attendees", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: t(req, "event.notFound") });
  if (row.organizer_id !== req.user.id && req.user.role !== "owner") {
    return res.status(403).json({ error: t(req, "event.attendeesOrganizerOnly") });
  }

  const rows = db
    .prepare(
      `SELECT r.id, r.status, r.ticket_code, r.checked_in_at, r.amount_minor, r.created_at,
              u.name, u.email, u.phone,
              p.status AS payment_status
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN payments p ON p.registration_id = r.id
       WHERE r.event_id = ?
       ORDER BY r.created_at ASC`,
    )
    .all(row.id);

  res.json({
    attendees: rows.map((r) => ({
      registrationId: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      status: r.status,
      ticketCode: r.ticket_code,
      checkedInAt: r.checked_in_at,
      amountMinor: r.amount_minor,
      paymentStatus: r.payment_status,
      createdAt: r.created_at,
    })),
  });
});

app.post("/api/events/:id/checkin", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: t(req, "event.notFound") });
  if (row.organizer_id !== req.user.id && req.user.role !== "owner") {
    return res.status(403).json({ error: t(req, "event.checkinOrganizerOnly") });
  }

  const code = String(req.body.code || "").trim().toUpperCase();
  const reg = db
    .prepare("SELECT * FROM registrations WHERE event_id = ? AND ticket_code = ?")
    .get(row.id, code);

  if (!reg) return res.status(404).json({ error: t(req, "ticket.notFound") });
  if (reg.status !== "confirmed") {
    return res.status(409).json({ error: t(req, "ticket.invalid", { status: reg.status }) });
  }
  if (reg.checked_in_at) {
    return res.status(409).json({ error: t(req, "ticket.used") });
  }

  db.prepare(
    "UPDATE registrations SET checked_in_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).run(reg.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(reg.user_id);
  res.json({ ok: true, name: user.name });
});

// ── Katılım ve ödeme ────────────────────────────────────────────────────────

app.post(
  "/api/events/:id/join",
  requireAuth,
  payLimiter,
  asyncRoute(async (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
    if (!event) return res.status(404).json({ error: t(req, "event.notFound") });
    if (event.status !== "published") {
      return res.status(409).json({ error: t(req, "event.cancelled") });
    }
    if (new Date(event.starts_at).getTime() < Date.now()) {
      return res.status(409).json({ error: t(req, "event.past") });
    }
    if (event.organizer_id === req.user.id) {
      return res.status(409).json({ error: t(req, "event.ownEvent") });
    }

    const existing = db
      .prepare("SELECT * FROM registrations WHERE event_id = ? AND user_id = ?")
      .get(event.id, req.user.id);

    if (existing && existing.status === "confirmed") {
      return res.status(409).json({ error: t(req, "event.alreadyJoined") });
    }

    const attendeeCount = attendeeCountStmt.get(event.id).c;
    if (attendeeCount >= event.capacity) {
      return res.status(409).json({ error: t(req, "event.full") });
    }

    // Ücretsiz etkinlik: anında onay
    if (event.price_minor === 0) {
      const reg = db.transaction(() => {
        if (existing) {
          db.prepare(
            "UPDATE registrations SET status = 'confirmed', amount_minor = 0 WHERE id = ?",
          ).run(existing.id);
          return db.prepare("SELECT * FROM registrations WHERE id = ?").get(existing.id);
        }
        const info = db
          .prepare(
            `INSERT INTO registrations (event_id, user_id, status, amount_minor, ticket_code)
             VALUES (?, ?, 'confirmed', 0, ?)`,
          )
          .run(event.id, req.user.id, uniqueTicketCode());
        return db.prepare("SELECT * FROM registrations WHERE id = ?").get(info.lastInsertRowid);
      })();

      sendTicketMail("joinConfirmed", reg.id, baseUrl(req));

      return res.json({
        status: "confirmed",
        registration: { id: reg.id, ticketCode: reg.ticket_code },
      });
    }

    // Ücretli etkinlik: bekleyen kayıt + bekleyen ödeme
    const { commission, organizerShare } = splitAmount(event.price_minor);

    // Organizatörün Stripe hesabı hazırsa payı ödeme anında oraya geçer.
    const target = organizerPayoutTarget(event);
    const payoutMode = target.destination ? "connect" : "platform";

    const created = db.transaction(() => {
      let registrationId;
      if (existing) {
        db.prepare(
          "UPDATE registrations SET status = 'pending', amount_minor = ? WHERE id = ?",
        ).run(event.price_minor, existing.id);
        registrationId = existing.id;
        db.prepare(
          "DELETE FROM payments WHERE registration_id = ? AND status = 'pending'",
        ).run(registrationId);
      } else {
        registrationId = db
          .prepare(
            `INSERT INTO registrations (event_id, user_id, status, amount_minor, ticket_code)
             VALUES (?, ?, 'pending', ?, ?)`,
          )
          .run(event.id, req.user.id, event.price_minor, uniqueTicketCode())
          .lastInsertRowid;
      }

      const paymentId = db
        .prepare(
          `INSERT INTO payments
             (registration_id, event_id, user_id, amount_minor, currency, provider,
              status, commission_minor, organizer_share_minor,
              payout_mode, transfer_destination)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .run(
          registrationId,
          event.id,
          req.user.id,
          event.price_minor,
          event.currency,
          payments.provider,
          commission,
          organizerShare,
          payoutMode,
          target.destination,
        ).lastInsertRowid;

      return { registrationId, paymentId };
    })();

    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(created.paymentId);

    let checkout;
    try {
      checkout = await payments.createCheckout({
        payment,
        event,
        user: req.user,
        baseUrl: baseUrl(req),
        split: target.destination
          ? { destination: target.destination, commissionMinor: commission }
          : null,
      });
    } catch (err) {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
      return res
        .status(502)
        .json({
          error: t(req, "payment.startFailed", {
            reason: err.message || t(req, "common.unknownError"),
          }),
        });
    }

    if (checkout.providerRef) {
      db.prepare("UPDATE payments SET provider_ref = ? WHERE id = ?").run(
        checkout.providerRef,
        payment.id,
      );
    }

    res.json({
      status: "payment_required",
      paymentId: payment.id,
      registrationId: created.registrationId,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
      mode: checkout.mode,
      checkoutUrl: checkout.checkoutUrl || null,
      payoutMode,
    });
  }),
);

app.get("/api/payments/:id", requireAuth, (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment || payment.user_id !== req.user.id) {
    return res.status(404).json({ error: t(req, "payment.notFound") });
  }
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(payment.event_id);
  const reg = db
    .prepare("SELECT * FROM registrations WHERE id = ?")
    .get(payment.registration_id);

  res.json({
    payment: {
      id: payment.id,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
      cardLast4: payment.card_last4,
      createdAt: payment.created_at,
      paidAt: payment.paid_at,
    },
    event: shapeEvent(event, req.user.id),
    registration: reg
      ? {
          id: reg.id,
          status: reg.status,
          ticketCode: reg.status === "confirmed" ? reg.ticket_code : null,
        }
      : null,
  });
});

/** Ödemeyi tamamlar. Demo modunda kart bilgisiyle, Stripe modunda session doğrulamasıyla. */
app.post(
  "/api/payments/:id/confirm",
  requireAuth,
  payLimiter,
  asyncRoute(async (req, res) => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
    if (!payment || payment.user_id !== req.user.id) {
      return res.status(404).json({ error: t(req, "payment.notFound") });
    }
    if (payment.status === "paid") {
      const reg = db
        .prepare("SELECT * FROM registrations WHERE id = ?")
        .get(payment.registration_id);
      return res.json({ status: "paid", ticketCode: reg.ticket_code });
    }
    if (payment.status !== "pending") {
      return res.status(409).json({ error: t(req, "payment.notCompletable") });
    }

    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(payment.event_id);

    let cardLast4 = null;
    let providerRef = payment.provider_ref;

    if (payment.provider === "stripe") {
      const sessionId = String(req.body.sessionId || payment.provider_ref || "");
      if (!sessionId) {
        return res.status(400).json({ error: t(req, "payment.sessionMissing") });
      }
      let verified;
      try {
        verified = await payments.verifyCheckout(sessionId);
      } catch (err) {
        return res
          .status(502)
          .json({ error: t(req, "payment.verifyFailed", { reason: err.message }) });
      }
      if (!verified.paid) {
        return res.status(402).json({ error: t(req, "payment.notPaid") });
      }
      providerRef = verified.providerRef;
    } else {
      // Demo kart doğrulaması — gerçek para hareketi yok.
      const digits = String(req.body.cardNumber || "").replace(/\D/g, "");
      const expiry = String(req.body.expiry || "").trim();
      const cvc = String(req.body.cvc || "").replace(/\D/g, "");
      const holder = String(req.body.holder || "").trim();

      if (digits.length < 15 || digits.length > 19) {
        return res.status(400).json({ error: t(req, "payment.cardInvalid") });
      }
      if (!/^\d{2}\s*\/\s*\d{2}$/.test(expiry)) {
        return res.status(400).json({ error: t(req, "payment.expiryInvalid") });
      }
      if (cvc.length < 3 || cvc.length > 4) {
        return res.status(400).json({ error: t(req, "payment.cvcInvalid") });
      }
      if (holder.length < 3) {
        return res.status(400).json({ error: t(req, "payment.holderRequired") });
      }
      if (digits === "4000000000000002") {
        db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
        return res.status(402).json({ error: t(req, "payment.declined") });
      }
      cardLast4 = digits.slice(-4);
      providerRef = "demo_" + Date.now().toString(36);
    }

    // Kontenjan kontrolü ödeme doğrulandıktan SONRA yapılır: kullanıcı Stripe'ta
    // iken etkinlik dolmuş olabilir ve o durumda para çekilmiş olur.
    const attendeeCount = attendeeCountStmt.get(event.id).c;
    if (attendeeCount >= event.capacity) {
      if (payment.provider === "stripe") {
        try {
          await refundPayment(Object.assign({}, payment, { provider_ref: providerRef }));
        } catch (err) {
          // İade başarısızsa ödemeyi 'pending' bırak: sahibin panelinde
          // görünür kalsın, sessizce kaybolmasın.
          console.error("Kontenjan dolu, iade başarısız:", payment.id, err);
          return res
            .status(502)
            .json({ error: t(req, "reg.refundFailed", { reason: err.message }) });
        }
        return res
          .status(409)
          .json({ error: t(req, "payment.capacityFilledRefunded") });
      }
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
      return res.status(409).json({ error: t(req, "payment.capacityFilled") });
    }

    const ticket = finalizePayment(payment.id, { cardLast4, providerRef });
    sendTicketMail("joinConfirmed", payment.registration_id, baseUrl(req));

    res.json({ status: "paid", ticketCode: ticket, eventId: payment.event_id });
  }),
);

// ── Hatırlatma postaları ────────────────────────────────────────────────────

/**
 * Yaklaşan etkinlikler için hatırlatma gönderir. Saatte bir çalışır ve her
 * kayda en fazla bir kez postalar (reminded_at damgası).
 */
function sendDueReminders(baseUrlValue) {
  const due = db
    .prepare(
      `SELECT r.id
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.status = 'confirmed'
         AND r.reminded_at IS NULL
         AND e.status = 'published'
         AND datetime(e.starts_at) > datetime('now')
         AND datetime(e.starts_at) <= datetime('now', '+' || ? || ' hours')`,
    )
    .all(config.mail.reminderHours);

  for (const row of due) {
    db.prepare(
      "UPDATE registrations SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(row.id);
    sendTicketMail("reminder", row.id, baseUrlValue);
  }

  return due.length;
}

// ── Şifre sıfırlama ─────────────────────────────────────────────────────────

const RESET_TTL_HOURS = 2;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Sıfırlama bağlantısı ister. Hesap var mı yok mu bilgisini sızdırmamak için
 * yanıt her durumda aynıdır.
 */
app.post(
  "/api/auth/forgot",
  authLimiter,
  asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (user) {
      // Eski, kullanılmamış istekleri geçersiz kıl.
      db.prepare(
        "UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND used_at IS NULL",
      ).run(user.id);

      const token = crypto.randomBytes(32).toString("hex");
      db.prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES (?, ?, datetime('now', '+' || ? || ' hours'))`,
      ).run(user.id, hashToken(token), RESET_TTL_HOURS);

      await mailer.sendQuietly(
        "passwordReset",
        mailRecipient(user),
        { token, hours: RESET_TTL_HOURS },
        baseUrl(req),
      );
    }

    res.json({ ok: true });
  }),
);

/** Bağlantıdaki jetonla yeni şifreyi belirler. */
app.post("/api/auth/reset", authLimiter, (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "");

  if (password.length < 8) {
    return res.status(400).json({ error: t(req, "auth.passwordShort") });
  }

  const row = db
    .prepare(
      `SELECT * FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
    )
    .get(hashToken(token));

  if (!row) {
    return res.status(400).json({ error: t(req, "auth.resetInvalid") });
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      bcrypt.hashSync(password, 10),
      row.user_id,
    );
    db.prepare(
      "UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(row.id);
  })();

  res.json({ ok: true });
});

// ── Hesap silme ─────────────────────────────────────────────────────────────

/**
 * Kullanıcının kendi hesabını silmesi (GDPR ve App Store için gerekli).
 *
 * Ödeme geçmişi olan hesap tamamen silinmez, kimliksizleştirilir: muhasebe
 * kayıtlarının tutarlı kalması gerekiyor, ama kişisel veri gidiyor. Hiç ödemesi
 * olmayan hesap doğrudan silinir.
 */
app.post(
  "/api/me/delete",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (req.user.role === "owner") {
      return res.status(403).json({ error: t(req, "auth.ownerCannotDelete") });
    }
    if (!bcrypt.compareSync(String(req.body.password || ""), req.user.password_hash)) {
      return res.status(403).json({ error: t(req, "auth.wrongPassword") });
    }

    // Yayındaki etkinliklerini önce kendisi iptal etmeli — katılımcıların
    // parası ve planı söz konusu, sessizce silinmemeli.
    const hosting = db
      .prepare(
        `SELECT COUNT(*) AS c FROM events
         WHERE organizer_id = ? AND status = 'published'
           AND datetime(starts_at) > datetime('now')`,
      )
      .get(req.user.id).c;
    if (hosting > 0) {
      return res.status(409).json({ error: t(req, "auth.hostHasEvents") });
    }

    // Gelecekteki katılımlarının parasını geri ver.
    const upcoming = db
      .prepare(
        `SELECT p.* FROM payments p
         JOIN registrations r ON r.id = p.registration_id
         JOIN events e ON e.id = r.event_id
         WHERE p.user_id = ? AND p.status = 'paid' AND r.status = 'confirmed'
           AND datetime(e.starts_at) > datetime('now')`,
      )
      .all(req.user.id);

    let refundedCount = 0;
    for (const payment of upcoming) {
      try {
        await refundPayment(payment);
        refundedCount += 1;
      } catch (err) {
        console.error("Hesap silmede iade başarısız:", payment.id, err);
      }
    }

    const hasHistory =
      db.prepare("SELECT COUNT(*) AS c FROM payments WHERE user_id = ?").get(req.user.id)
        .c > 0;

    db.transaction(() => {
      db.prepare(
        `UPDATE registrations SET status = 'cancelled'
         WHERE user_id = ? AND status != 'cancelled'
           AND event_id IN (SELECT id FROM events WHERE datetime(starts_at) > datetime('now'))`,
      ).run(req.user.id);

      if (hasHistory) {
        db.prepare(
          `UPDATE users
             SET name = 'Deleted user',
                 email = 'deleted-' || id || '@deleted.invalid',
                 password_hash = ?,
                 phone = NULL, city = NULL, bio = NULL,
                 stripe_account_id = NULL,
                 stripe_charges_enabled = 0, stripe_payouts_enabled = 0,
                 stripe_details_submitted = 0
           WHERE id = ?`,
        ).run(crypto.randomBytes(32).toString("hex"), req.user.id);
      } else {
        db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
      }
    })();

    req.session.destroy(() => {});
    res.clearCookie("meetapp.sid");
    res.json({ ok: true, anonymized: hasHistory, refundedCount });
  }),
);

// ── Stripe webhook ──────────────────────────────────────────────────────────

/**
 * Kullanıcı ödeme sonrası tarayıcıyı kapatsa bile ödemeyi tamamlar.
 * Ham gövde üzerinden imza doğrulanır; sahte istekler reddedilir.
 */
app.post(
  WEBHOOK_PATH,
  express.raw({ type: "application/json" }),
  asyncRoute(async (req, res) => {
    if (!payments.webhookConfigured) {
      return res.status(503).json({ error: "Webhook is not configured." });
    }

    let event;
    try {
      event = payments.verifyWebhookSignature(req.body, req.get("Stripe-Signature"));
    } catch (err) {
      console.warn("Webhook imzası reddedildi:", err.message);
      return res.status(400).json({ error: "Invalid signature." });
    }

    const handled = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ];

    if (handled.includes(event.type)) {
      const session = event.data && event.data.object;
      const paymentId = Number(
        (session && session.metadata && session.metadata.payment_id) ||
          (session && session.client_reference_id),
      );

      if (session && session.payment_status === "paid" && Number.isFinite(paymentId)) {
        const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);

        if (payment && payment.status === "pending") {
          const eventRow = db
            .prepare("SELECT * FROM events WHERE id = ?")
            .get(payment.event_id);
          const providerRef = session.payment_intent || session.id;
          const attendeeCount = attendeeCountStmt.get(eventRow.id).c;

          if (attendeeCount >= eventRow.capacity) {
            // Kontenjan dolmuşken para çekilmiş: hemen geri ver.
            try {
              await refundPayment(
                Object.assign({}, payment, { provider_ref: providerRef }),
              );
            } catch (err) {
              console.error("Webhook iadesi başarısız:", payment.id, err);
            }
          } else {
            const ticket = finalizePayment(payment.id, { providerRef });
            if (ticket) sendTicketMail("joinConfirmed", payment.registration_id, baseUrl(req));
          }
        }
      }
    }

    // Stripe 2xx görmezse tekrar dener; işlenmeyen türler için de onay veriyoruz.
    res.json({ received: true });
  }),
);

// ── Organizatör ödeme hesabı (Stripe Connect) ───────────────────────────────

app.get("/api/me/payouts", requireAuth, (req, res) => {
  res.json({
    enabled: payments.connectEnabled,
    provider: payments.provider,
    country: config.connect.country,
    commissionRate: config.commissionRate,
    ...payoutState(req.user),
  });
});

/** Hesabı açar (yoksa) ve Stripe'ın kurulum ekranına giden bağlantıyı verir. */
app.post(
  "/api/me/payouts/onboard",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!payments.connectEnabled) {
      return res.status(400).json({ error: t(req, "payouts.disabled") });
    }

    let accountId = req.user.stripe_account_id;
    if (!accountId) {
      const account = await payments.createConnectedAccount({ user: req.user });
      accountId = account.id;
      db.prepare("UPDATE users SET stripe_account_id = ? WHERE id = ?").run(
        accountId,
        req.user.id,
      );
    }

    const base = baseUrl(req);
    const link = await payments.createAccountLink({
      accountId,
      refreshUrl: `${base}/#/profile?payouts=refresh`,
      returnUrl: `${base}/#/profile?payouts=done`,
    });

    // Demo modunda Stripe ekranı yok; hesap anında hazır sayılır.
    if (link.demo) {
      db.prepare(
        `UPDATE users SET stripe_charges_enabled = 1, stripe_payouts_enabled = 1,
                          stripe_details_submitted = 1 WHERE id = ?`,
      ).run(req.user.id);
    }

    res.json({ url: link.url, demo: !!link.demo });
  }),
);

/** Hesabın güncel durumunu Stripe'tan çeker. */
app.post(
  "/api/me/payouts/refresh",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!req.user.stripe_account_id) {
      return res.json(payoutState(req.user));
    }

    const account = await payments.retrieveAccount(req.user.stripe_account_id);
    db.prepare(
      `UPDATE users
         SET stripe_charges_enabled = ?, stripe_payouts_enabled = ?,
             stripe_details_submitted = ?
       WHERE id = ?`,
    ).run(
      account.chargesEnabled ? 1 : 0,
      account.payoutsEnabled ? 1 : 0,
      account.detailsSubmitted ? 1 : 0,
      req.user.id,
    );

    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json(payoutState(fresh));
  }),
);

/** Organizatörü kendi Stripe paneline götüren bağlantı. */
app.get(
  "/api/me/payouts/dashboard",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!req.user.stripe_account_id) {
      return res.status(404).json({ error: t(req, "payouts.notConnected") });
    }
    const link = await payments.createLoginLink(req.user.stripe_account_id);
    res.json({ url: link.url, demo: !!link.demo });
  }),
);

app.post(
  "/api/registrations/:id/cancel",
  requireAuth,
  asyncRoute(async (req, res) => {
    const reg = db.prepare("SELECT * FROM registrations WHERE id = ?").get(req.params.id);
    if (!reg || reg.user_id !== req.user.id) {
      return res.status(404).json({ error: t(req, "reg.notFound") });
    }
    if (reg.status === "cancelled") {
      return res.status(409).json({ error: t(req, "reg.alreadyCancelled") });
    }

    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(reg.event_id);
    const hoursToStart = (new Date(event.starts_at).getTime() - Date.now()) / 3600000;

    const payment = db
      .prepare(
        "SELECT * FROM payments WHERE registration_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1",
      )
      .get(reg.id);

    let refunded = false;
    if (payment) {
      if (hoursToStart < 6) {
        return res.status(409).json({ error: t(req, "reg.refundWindow") });
      }
      try {
        await payments.refund(payment);
      } catch (err) {
        return res
          .status(502)
          .json({ error: t(req, "reg.refundFailed", { reason: err.message }) });
      }
      db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(payment.id);
      refunded = true;
    }

    db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(reg.id);

    const to = mailRecipient(req.user);
    mailer.sendQuietly(
      "registrationCancelled",
      to,
      {
        title: event.title,
        refundLine: refunded
          ? to.lang === "en"
            ? `${formatMoney(reg.amount_minor, event.currency, "en")} has been refunded to your card.`
            : `${formatMoney(reg.amount_minor, event.currency, "tr")} kartına iade edildi.`
          : "",
      },
      baseUrl(req),
    );

    res.json({ ok: true, refunded });
  }),
);

// ── Kullanıcının kendi verisi ───────────────────────────────────────────────

app.get("/api/my/registrations", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, e.title, e.cover, e.starts_at, e.city, e.venue, e.price_minor,
              e.currency, e.status AS event_status
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = ?
       ORDER BY datetime(e.starts_at) ASC`,
    )
    .all(req.user.id);

  res.json({
    registrations: rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      status: r.status,
      ticketCode: r.status === "confirmed" ? r.ticket_code : null,
      checkedInAt: r.checked_in_at,
      amountMinor: r.amount_minor,
      currency: r.currency,
      event: {
        id: r.event_id,
        title: r.title,
        cover: r.cover,
        startsAt: r.starts_at,
        city: r.city,
        venue: r.venue,
        priceMinor: r.price_minor,
        status: r.event_status,
      },
      isPast: new Date(r.starts_at).getTime() < Date.now(),
    })),
  });
});

app.get("/api/my/events", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM events WHERE organizer_id = ? ORDER BY datetime(starts_at) ASC")
    .all(req.user.id);

  const events = rows.map((row) => {
    const shaped = shapeEvent(row, req.user.id);
    const earnings = db
      .prepare(
        `SELECT COALESCE(SUM(amount_minor),0) AS gross,
                COALESCE(SUM(organizer_share_minor),0) AS payable,
                COUNT(*) AS paid_count
         FROM payments WHERE event_id = ? AND status = 'paid'`,
      )
      .get(row.id);
    return { ...shaped, earnings };
  });

  res.json({ events });
});

app.get("/api/my/payments", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, e.title, e.cover FROM payments p
       JOIN events e ON e.id = p.event_id
       WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 100`,
    )
    .all(req.user.id);

  res.json({
    payments: rows.map((p) => ({
      id: p.id,
      eventId: p.event_id,
      eventTitle: p.title,
      cover: p.cover,
      amountMinor: p.amount_minor,
      currency: p.currency,
      status: p.status,
      cardLast4: p.card_last4,
      createdAt: p.created_at,
      paidAt: p.paid_at,
    })),
  });
});

// ── Uygulama sahibi paneli ──────────────────────────────────────────────────

app.get("/api/owner/summary", requireAuth, requireOwner, (req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status='paid' THEN amount_minor END),0)          AS gross,
         COALESCE(SUM(CASE WHEN status='paid' THEN commission_minor END),0)      AS commission,
         COALESCE(SUM(CASE WHEN status='paid' THEN organizer_share_minor END),0) AS organizer_payable,
         COALESCE(SUM(CASE WHEN status='paid' AND payout_mode='connect'
                           THEN organizer_share_minor END),0)                   AS organizer_auto,
         COALESCE(SUM(CASE WHEN status='paid' AND payout_mode='platform'
                           THEN organizer_share_minor END),0)                   AS organizer_manual,
         COALESCE(SUM(CASE WHEN status='refunded' THEN amount_minor END),0)      AS refunded,
         COUNT(CASE WHEN status='paid' THEN 1 END)                               AS paid_count,
         COUNT(CASE WHEN status='pending' THEN 1 END)                            AS pending_count
       FROM payments`,
    )
    .get();

  const byEvent = db
    .prepare(
      `SELECT e.id, e.title, e.cover, e.starts_at, e.city,
              COUNT(p.id) AS paid_count,
              COALESCE(SUM(p.amount_minor),0) AS gross,
              COALESCE(SUM(p.commission_minor),0) AS commission,
              COALESCE(SUM(p.organizer_share_minor),0) AS payable,
              u.name AS organizer_name
       FROM events e
       LEFT JOIN payments p ON p.event_id = e.id AND p.status = 'paid'
       JOIN users u ON u.id = e.organizer_id
       GROUP BY e.id
       HAVING paid_count > 0
       ORDER BY gross DESC`,
    )
    .all();

  const counts = {
    users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
    events: db.prepare("SELECT COUNT(*) AS c FROM events WHERE status='published'").get().c,
    registrations: db
      .prepare("SELECT COUNT(*) AS c FROM registrations WHERE status='confirmed'")
      .get().c,
  };

  res.json({
    totals,
    byEvent,
    counts,
    currency: config.currency,
    commissionRate: config.commissionRate,
    provider: payments.provider,
    connectEnabled: payments.connectEnabled,
  });
});

app.get("/api/owner/payments", requireAuth, requireOwner, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.email AS user_email, e.title AS event_title, e.cover
       FROM payments p
       JOIN users u ON u.id = p.user_id
       JOIN events e ON e.id = p.event_id
       ORDER BY p.id DESC LIMIT 200`,
    )
    .all();

  res.json({
    payments: rows.map((p) => ({
      id: p.id,
      userName: p.user_name,
      userEmail: p.user_email,
      eventTitle: p.event_title,
      cover: p.cover,
      amountMinor: p.amount_minor,
      commissionMinor: p.commission_minor,
      organizerShareMinor: p.organizer_share_minor,
      payoutMode: p.payout_mode,
      currency: p.currency,
      status: p.status,
      provider: p.provider,
      providerRef: p.provider_ref,
      cardLast4: p.card_last4,
      createdAt: p.created_at,
      paidAt: p.paid_at,
    })),
  });
});

// ── SPA fallback ────────────────────────────────────────────────────────────

app.get("/api/*", (req, res) => res.status(404).json({ error: t(req, "common.notFound") }));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Hata yakalayıcı ─────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("Sunucu hatası:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: t(req, "server.error") });
});

// ── Başlat ──────────────────────────────────────────────────────────────────

if (isEmpty()) {
  seed();
  console.log("• Boş veritabanı bulundu, demo verisi yüklendi.");
}

// Testlerin elle tetikleyebilmesi için.
app.locals.sendDueReminders = sendDueReminders;

if (require.main === module) {
  // Yaklaşan etkinlikler için saatte bir hatırlatma taraması.
  const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
  setTimeout(() => {
    sendDueReminders(config.publicUrl);
    setInterval(() => sendDueReminders(config.publicUrl), REMINDER_INTERVAL_MS);
  }, 10 * 1000).unref();

  app.listen(config.port, config.host, () => {
    console.log(`\n  MeetApp  →  http://localhost:${config.port}`);
    console.log(`  Ödeme modu: ${payments.provider}`);
    console.log(`  Uygulama sahibi: ${config.owner.email}\n`);
  });
}

module.exports = app;
