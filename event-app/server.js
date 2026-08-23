"use strict";

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");

const db = require("./db");
const config = require("./config");
const payments = require("./payments");
const { t, langOf, SUPPORTED } = require("./messages");
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

app.use(express.json({ limit: "256kb" }));
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
    name: "bulus.sid",
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
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: t(req, "rate.auth") }),
});

const payLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
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
    appName: "Buluş",
    paymentProvider: payments.provider,
    currency: config.currency,
    currencySymbol: config.currencySymbol,
    commissionRate: config.commissionRate,
    ownerName: owner ? owner.name : config.owner.name,
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
      "INSERT INTO users (name, email, password_hash, city) VALUES (?, ?, ?, ?)",
    )
    .run(name, email, bcrypt.hashSync(password, 10), city);

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
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("bulus.sid");
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

  let sql = "SELECT * FROM events WHERE status = 'published'";
  const params = [];

  if (scope !== "all") {
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

  res.json({ event, attendees });
});

app.post("/api/events", requireAuth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  const description = String(b.description || "").trim();
  const category = String(b.category || "Spor").trim();
  const cover = String(b.cover || "🎉").trim().slice(0, 8);
  const city = String(b.city || "").trim();
  const venue = String(b.venue || "").trim();
  const address = String(b.address || "").trim();
  const level = String(b.level || "Herkes").trim();
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
  const endsAt = new Date(start.getTime() + durationHours * 3600 * 1000).toISOString();

  const info = db
    .prepare(
      `INSERT INTO events
        (organizer_id, title, description, category, cover, city, venue, address,
         starts_at, ends_at, capacity, price_minor, currency, level)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      req.user.id,
      title,
      description,
      category,
      cover,
      city,
      venue,
      address,
      start.toISOString(),
      endsAt,
      capacity,
      priceMinor,
      config.currency,
      level,
    );

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ event: shapeEvent(row, req.user.id) });
});

app.post("/api/events/:id/cancel", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: t(req, "event.notFound") });
  if (row.organizer_id !== req.user.id && req.user.role !== "owner") {
    return res.status(403).json({ error: t(req, "event.notOrganizer") });
  }
  db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

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

      return res.json({
        status: "confirmed",
        registration: { id: reg.id, ticketCode: reg.ticket_code },
      });
    }

    // Ücretli etkinlik: bekleyen kayıt + bekleyen ödeme
    const { commission, organizerShare } = splitAmount(event.price_minor);

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
              status, commission_minor, organizer_share_minor)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
    const attendeeCount = attendeeCountStmt.get(event.id).c;
    if (attendeeCount >= event.capacity) {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
      return res.status(409).json({ error: t(req, "payment.capacityFilled") });
    }

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

    const ticket = db.transaction(() => {
      db.prepare(
        `UPDATE payments
           SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               card_last4 = ?, provider_ref = ?
         WHERE id = ?`,
      ).run(cardLast4, providerRef, payment.id);

      db.prepare("UPDATE registrations SET status = 'confirmed' WHERE id = ?").run(
        payment.registration_id,
      );

      return db
        .prepare("SELECT ticket_code FROM registrations WHERE id = ?")
        .get(payment.registration_id).ticket_code;
    })();

    res.json({ status: "paid", ticketCode: ticket, eventId: payment.event_id });
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

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`\n  Buluş  →  http://localhost:${config.port}`);
    console.log(`  Ödeme modu: ${payments.provider}`);
    console.log(`  Uygulama sahibi: ${config.owner.email}\n`);
  });
}

module.exports = app;
