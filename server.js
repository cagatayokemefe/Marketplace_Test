const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const db = require("./db");

const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.use(express.json());

// Serve static assets (CSS, JS) but NOT index.html automatically
app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: __dirname,
      table: "sessions",
    }),
    secret:
      process.env.SESSION_SECRET ||
      "change-this-to-a-long-random-string-in-production",
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: false, // set to true in production behind HTTPS
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  }),
);

// Rate limiter — applied only to auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes." },
  skipSuccessfulRequests: true,
});

// Auth guard middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith("/api/"))
    return res.status(401).json({ error: "Not authenticated" });
  return res.redirect("/login");
}

// ── In-memory stock prices ────────────────────────────────────────────────────

const stocks = {
  AAPL: { symbol: 'AAPL', name: 'Apple Inc.',              price: 0, previousClose: 0, description: 'Technology company known for iPhone, Mac, and services.' },
  TSLA: { symbol: 'TSLA', name: 'Tesla Inc.',              price: 0, previousClose: 0, description: 'Electric vehicle and clean energy company.' },
  MSFT: { symbol: 'MSFT', name: 'Microsoft Corp.',         price: 0, previousClose: 0, description: 'Cloud computing, Windows, Office, and Xbox.' },
  GOOGL: { symbol: 'GOOGL', name: 'Alphabet Inc.',         price: 0, previousClose: 0, description: 'Google Search, YouTube, and Google Cloud.' },
  AMZN: { symbol: 'AMZN', name: 'Amazon.com Inc.',         price: 0, previousClose: 0, description: 'E-commerce, AWS cloud, and Prime Video.' },
  META: { symbol: 'META', name: 'Meta Platforms',          price: 0, previousClose: 0, description: 'Facebook, Instagram, WhatsApp, and Reality Labs.' },
  NVDA: { symbol: 'NVDA', name: 'NVIDIA Corp.',            price: 0, previousClose: 0, description: 'GPUs, AI chips, and data center hardware.' },
  NFLX: { symbol: 'NFLX', name: 'Netflix Inc.',            price: 0, previousClose: 0, description: 'Global streaming entertainment service.' },
  AMD:  { symbol: 'AMD',  name: 'Advanced Micro Devices',  price: 0, previousClose: 0, description: 'CPUs, GPUs, and semiconductor solutions.' },
  INTC: { symbol: 'INTC', name: 'Intel Corp.',             price: 0, previousClose: 0, description: 'Semiconductor chips, processors, and networking.' },
  BABA: { symbol: 'BABA', name: 'Alibaba Group',           price: 0, previousClose: 0, description: 'Chinese e-commerce, cloud, and fintech.' },
  DIS:  { symbol: 'DIS',  name: 'The Walt Disney Co.',     price: 0, previousClose: 0, description: 'Media, theme parks, Disney+, and ESPN.' },
  UBER: { symbol: 'UBER', name: 'Uber Technologies',       price: 0, previousClose: 0, description: 'Ride-hailing, food delivery, and freight.' },
  SPOT: { symbol: 'SPOT', name: 'Spotify Technology',      price: 0, previousClose: 0, description: 'Music and podcast streaming platform.' },
  PYPL: { symbol: 'PYPL', name: 'PayPal Holdings',         price: 0, previousClose: 0, description: 'Online payments, Venmo, and digital wallets.' },
  SHOP: { symbol: 'SHOP', name: 'Shopify Inc.',            price: 0, previousClose: 0, description: 'E-commerce platform for merchants worldwide.' },
  COIN: { symbol: 'COIN', name: 'Coinbase Global',         price: 0, previousClose: 0, description: 'Cryptocurrency exchange and wallet services.' },
  SNAP: { symbol: 'SNAP', name: 'Snap Inc.',               price: 0, previousClose: 0, description: 'Snapchat social media and AR technology.' },
  PLTR: { symbol: 'PLTR', name: 'Palantir Technologies',   price: 0, previousClose: 0, description: 'AI-powered data analytics for enterprise and government.' },
  RIVN: { symbol: 'RIVN', name: 'Rivian Automotive',       price: 0, previousClose: 0, description: 'Electric trucks, vans, and adventure vehicles.' },
};

async function fetchRealPrices() {
  for (const symbol of Object.keys(stocks)) {
    try {
      const quote = await yahooFinance.quote(symbol);
      stocks[symbol].price = parseFloat(quote.regularMarketPrice.toFixed(2));
      stocks[symbol].previousClose = parseFloat(
        quote.regularMarketPreviousClose.toFixed(2),
      );
      console.log(`[${symbol}] price updated: $${stocks[symbol].price}`);
    } catch (err) {
      console.error(`Failed to fetch price for ${symbol}:`, err.message);
    }
  }
}

fetchRealPrices();
setInterval(fetchRealPrices, 60_000);

// ── Page routes ───────────────────────────────────────────────────────────────

app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  if (req.session && req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/register", (req, res) => {
  if (req.session && req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.get("/profile", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

app.get("/settings", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settings.html"));
});

// ── Auth API routes ───────────────────────────────────────────────────────────

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (
    !username ||
    typeof username !== "string" ||
    !password ||
    typeof password !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  const trimmed = username.trim();

  if (trimmed.length < 3 || trimmed.length > 30) {
    return res.status(400).json({ error: "Username must be 3–30 characters" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return res
      .status(400)
      .json({
        error: "Username may only contain letters, numbers, and underscores",
      });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }
  if (password.length > 72) {
    return res
      .status(400)
      .json({ error: "Password must be 72 characters or fewer" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(trimmed, passwordHash);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.userId = result.lastInsertRowid;
      req.session.username = trimmed;
      res.status(201).json({ username: trimmed });
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Username already taken" });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (
    !username ||
    typeof username !== "string" ||
    !password ||
    typeof password !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username.trim());

    // Always run bcrypt to prevent timing-based user enumeration
    const dummyHash =
      "$2a$12$invalidhashfortimingprotectionXXXXXXXXXXXXXXXXXXXXXXX";
    const match = await bcrypt.compare(
      password,
      user ? user.password_hash : dummyHash,
    );

    if (!user || !match) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ username: user.username });
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db
    .prepare("SELECT id, username, balance, created_at FROM users WHERE id = ?")
    .get(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "User not found" });
  }

  const holdingsRows = db
    .prepare("SELECT symbol, shares, avg_cost FROM holdings WHERE user_id = ?")
    .all(req.session.userId);
  const txRows = db
    .prepare(
      "SELECT type, symbol, quantity, price, total, timestamp FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50",
    )
    .all(req.session.userId);
  const favRows = db
    .prepare("SELECT symbol FROM favorites WHERE user_id = ? ORDER BY added_at ASC")
    .all(req.session.userId);

  const portfolio = {};
  holdingsRows.forEach((h) => {
    portfolio[h.symbol] = { shares: h.shares, avgCost: h.avg_cost };
  });

  res.json({
    username: user.username,
    balance: user.balance,
    createdAt: user.created_at,
    portfolio,
    favorites: favRows.map((f) => f.symbol),
    transactions: txRows.map((tx) => ({
      time: tx.timestamp,
      type: tx.type,
      symbol: tx.symbol,
      qty: tx.quantity,
      price: tx.price,
      total: tx.total,
    })),
  });
});

// ── Favorites routes ──────────────────────────────────────────────────────────

app.get("/api/favorites", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT symbol FROM favorites WHERE user_id = ? ORDER BY added_at ASC")
    .all(req.session.userId);
  res.json(rows.map((r) => r.symbol));
});

app.post("/api/favorites", requireAuth, (req, res) => {
  const sym = (req.body.symbol || "").toUpperCase();
  if (!stocks[sym]) return res.status(400).json({ error: "Invalid symbol" });
  try {
    db.prepare("INSERT OR IGNORE INTO favorites (user_id, symbol) VALUES (?, ?)").run(req.session.userId, sym);
    res.json({ ok: true });
  } catch (err) {
    console.error("Favorite add error:", err);
    res.status(500).json({ error: "Failed to add favorite" });
  }
});

app.delete("/api/favorites/:symbol", requireAuth, (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND symbol = ?").run(req.session.userId, sym);
  res.json({ ok: true });
});

// ── Listings (P2P marketplace) ────────────────────────────────────────────────

// GET all open listings with seller username
app.get("/api/listings", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.symbol, l.quantity, l.price_per_share, l.created_at,
           u.username AS seller_username, l.seller_id
    FROM listings l
    JOIN users u ON l.seller_id = u.id
    WHERE l.status = 'OPEN'
    ORDER BY l.created_at DESC
  `).all();
  res.json(rows);
});

// POST create a sell listing — shares are deducted immediately
app.post("/api/listings", requireAuth, (req, res) => {
  const sym = ((req.body.symbol || "")).toUpperCase();
  const qty = parseInt(req.body.quantity, 10);
  const price = parseFloat(req.body.price);
  const userId = req.session.userId;

  if (!stocks[sym]) return res.status(400).json({ error: "Invalid symbol" });
  if (!qty || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });
  if (!price || price <= 0) return res.status(400).json({ error: "Price must be greater than 0" });

  const execute = db.transaction(() => {
    const holding = db.prepare(
      "SELECT shares, avg_cost FROM holdings WHERE user_id = ? AND symbol = ?"
    ).get(userId, sym);

    if (!holding || holding.shares < qty) {
      throw Object.assign(
        new Error(`You only own ${holding?.shares || 0} shares of ${sym}`),
        { code: "INSUFFICIENT_SHARES" }
      );
    }

    const avgCostSnapshot = holding.avg_cost;
    const remaining = holding.shares - qty;
    if (remaining === 0) {
      db.prepare("DELETE FROM holdings WHERE user_id = ? AND symbol = ?").run(userId, sym);
    } else {
      db.prepare("UPDATE holdings SET shares = ? WHERE user_id = ? AND symbol = ?").run(remaining, userId, sym);
    }

    const result = db.prepare(
      "INSERT INTO listings (seller_id, symbol, quantity, price_per_share, avg_cost_snapshot) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, sym, qty, price, avgCostSnapshot);

    return { id: result.lastInsertRowid, symbol: sym, quantity: qty, price_per_share: price };
  });

  try {
    res.status(201).json(execute());
  } catch (err) {
    if (err.code === "INSUFFICIENT_SHARES") return res.status(400).json({ error: err.message });
    console.error("Create listing error:", err);
    res.status(500).json({ error: "Failed to create listing" });
  }
});

// DELETE cancel own listing — shares are returned
app.delete("/api/listings/:id", requireAuth, (req, res) => {
  const listingId = parseInt(req.params.id, 10);
  const userId = req.session.userId;

  const execute = db.transaction(() => {
    const listing = db.prepare(
      "SELECT * FROM listings WHERE id = ? AND status = 'OPEN'"
    ).get(listingId);

    if (!listing) throw Object.assign(new Error("Listing not found"), { code: "NOT_FOUND" });
    if (listing.seller_id !== userId) throw Object.assign(new Error("Not your listing"), { code: "FORBIDDEN" });

    // Return shares with accurate avg_cost
    const existing = db.prepare(
      "SELECT shares, avg_cost FROM holdings WHERE user_id = ? AND symbol = ?"
    ).get(userId, listing.symbol);

    if (existing) {
      const totalShares = existing.shares + listing.quantity;
      const restoredAvg = parseFloat(
        ((existing.shares * existing.avg_cost + listing.quantity * listing.avg_cost_snapshot) / totalShares).toFixed(2)
      );
      db.prepare("UPDATE holdings SET shares = ?, avg_cost = ? WHERE user_id = ? AND symbol = ?")
        .run(totalShares, restoredAvg, userId, listing.symbol);
    } else {
      db.prepare("INSERT INTO holdings (user_id, symbol, shares, avg_cost) VALUES (?, ?, ?, ?)")
        .run(userId, listing.symbol, listing.quantity, listing.avg_cost_snapshot);
    }

    db.prepare("UPDATE listings SET status = 'CANCELLED' WHERE id = ?").run(listingId);
    return { ok: true };
  });

  try {
    res.json(execute());
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "FORBIDDEN") return res.status(403).json({ error: err.message });
    console.error("Cancel listing error:", err);
    res.status(500).json({ error: "Failed to cancel listing" });
  }
});

// POST buy from a listing — atomic P2P transfer (supports partial quantity)
app.post("/api/listings/:id/buy", requireAuth, (req, res) => {
  const listingId = parseInt(req.params.id, 10);
  const buyerId = req.session.userId;
  const qty = parseInt(req.body.quantity, 10);

  if (!qty || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

  const execute = db.transaction(() => {
    const listing = db.prepare(`
      SELECT l.*, u.username AS seller_username
      FROM listings l JOIN users u ON l.seller_id = u.id
      WHERE l.id = ? AND l.status = 'OPEN'
    `).get(listingId);

    if (!listing) throw Object.assign(new Error("Listing not found or already filled"), { code: "NOT_FOUND" });
    if (listing.seller_id === buyerId) throw Object.assign(new Error("Cannot buy your own listing"), { code: "OWN_LISTING" });
    if (qty > listing.quantity) throw Object.assign(new Error(`Only ${listing.quantity} share(s) available`), { code: "INVALID_QTY" });

    const total = parseFloat((qty * listing.price_per_share).toFixed(2));
    const buyer = db.prepare("SELECT balance FROM users WHERE id = ?").get(buyerId);

    if (buyer.balance < total) {
      throw Object.assign(
        new Error(`Insufficient funds. Need ${total.toFixed(2)}, have ${buyer.balance.toFixed(2)}`),
        { code: "INSUFFICIENT_FUNDS" }
      );
    }

    // Money: buyer → seller
    db.prepare("UPDATE users SET balance = ROUND(balance - ?, 2) WHERE id = ?").run(total, buyerId);
    db.prepare("UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?").run(total, listing.seller_id);

    // Shares: listing → buyer holdings
    const buyerHolding = db.prepare(
      "SELECT shares, avg_cost FROM holdings WHERE user_id = ? AND symbol = ?"
    ).get(buyerId, listing.symbol);

    if (buyerHolding) {
      const newTotal = buyerHolding.shares + qty;
      const newAvg = parseFloat(
        ((buyerHolding.shares * buyerHolding.avg_cost + total) / newTotal).toFixed(2)
      );
      db.prepare("UPDATE holdings SET shares = ?, avg_cost = ? WHERE user_id = ? AND symbol = ?")
        .run(newTotal, newAvg, buyerId, listing.symbol);
    } else {
      db.prepare("INSERT INTO holdings (user_id, symbol, shares, avg_cost) VALUES (?, ?, ?, ?)")
        .run(buyerId, listing.symbol, qty, parseFloat((total / qty).toFixed(2)));
    }

    // Partial fill: reduce remaining quantity; full fill: mark FILLED
    if (qty < listing.quantity) {
      db.prepare("UPDATE listings SET quantity = ? WHERE id = ?").run(listing.quantity - qty, listingId);
    } else {
      db.prepare("UPDATE listings SET status = 'FILLED' WHERE id = ?").run(listingId);
    }

    // Record transactions for both parties
    db.prepare("INSERT INTO transactions (user_id, type, symbol, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)")
      .run(buyerId, "BUY", listing.symbol, qty, listing.price_per_share, total);
    db.prepare("INSERT INTO transactions (user_id, type, symbol, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)")
      .run(listing.seller_id, "SELL", listing.symbol, qty, listing.price_per_share, total);

    return {
      symbol: listing.symbol,
      quantity: qty,
      price: listing.price_per_share,
      total,
      seller: listing.seller_username,
    };
  });

  try {
    res.json(execute());
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "OWN_LISTING") return res.status(400).json({ error: err.message });
    if (err.code === "INVALID_QTY") return res.status(400).json({ error: err.message });
    if (err.code === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: err.message });
    console.error("Buy listing error:", err);
    res.status(500).json({ error: "Transaction failed" });
  }
});

// ── Stock routes ──────────────────────────────────────────────────────────────

app.get("/api/stocks", requireAuth, (req, res) => {
  const result = Object.values(stocks).map((s) => ({
    ...s,
    change: parseFloat((s.price - s.previousClose).toFixed(2)),
    changePct: parseFloat(
      (((s.price - s.previousClose) / s.previousClose) * 100).toFixed(2),
    ),
  }));
  res.json(result);
});

app.get("/api/stocks/:symbol", requireAuth, (req, res) => {
  const stock = stocks[req.params.symbol.toUpperCase()];
  if (!stock) return res.status(404).json({ error: "Stock not found" });
  res.json({
    ...stock,
    change: parseFloat((stock.price - stock.previousClose).toFixed(2)),
    changePct: parseFloat(
      (
        ((stock.price - stock.previousClose) / stock.previousClose) *
        100
      ).toFixed(2),
    ),
  });
});

// ── Trade routes (server-side, atomic) ───────────────────────────────────────

app.post("/api/buy", requireAuth, (req, res) => {
  const { symbol, quantity } = req.body;
  const sym = (symbol || "").toUpperCase();
  const qty = parseInt(quantity, 10);

  if (!stocks[sym])
    return res.status(400).json({ error: "Invalid stock symbol" });
  if (!qty || qty < 1 || qty > 10000)
    return res
      .status(400)
      .json({ error: "Quantity must be between 1 and 10,000" });
  if (stocks[sym].price === 0)
    return res
      .status(503)
      .json({ error: "Price unavailable — market may be loading" });

  const stock = stocks[sym];
  const cost = parseFloat((stock.price * qty).toFixed(2));
  const userId = req.session.userId;

  const execute = db.transaction(() => {
    const user = db
      .prepare("SELECT balance FROM users WHERE id = ?")
      .get(userId);

    if (user.balance < cost) {
      throw Object.assign(
        new Error(
          `Insufficient funds. Need $${cost.toFixed(2)}, have $${user.balance.toFixed(2)}`,
        ),
        { code: "INSUFFICIENT_FUNDS" },
      );
    }

    db.prepare(
      "UPDATE users SET balance = ROUND(balance - ?, 2) WHERE id = ?",
    ).run(cost, userId);

    const existing = db
      .prepare(
        "SELECT shares, avg_cost FROM holdings WHERE user_id = ? AND symbol = ?",
      )
      .get(userId, sym);

    if (existing) {
      const totalShares = existing.shares + qty;
      const newAvgCost = parseFloat(
        ((existing.shares * existing.avg_cost + cost) / totalShares).toFixed(2),
      );
      db.prepare(
        "UPDATE holdings SET shares = ?, avg_cost = ? WHERE user_id = ? AND symbol = ?",
      ).run(totalShares, newAvgCost, userId, sym);
    } else {
      const avgCost = parseFloat((cost / qty).toFixed(2));
      db.prepare(
        "INSERT INTO holdings (user_id, symbol, shares, avg_cost) VALUES (?, ?, ?, ?)",
      ).run(userId, sym, qty, avgCost);
    }

    db.prepare(
      "INSERT INTO transactions (user_id, type, symbol, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, "BUY", sym, qty, stock.price, cost);

    return { symbol: sym, quantity: qty, price: stock.price, total: cost };
  });

  try {
    const result = execute();
    res.json(result);
  } catch (err) {
    if (err.code === "INSUFFICIENT_FUNDS")
      return res.status(400).json({ error: err.message });
    console.error("Buy error:", err);
    res.status(500).json({ error: "Transaction failed" });
  }
});

app.post("/api/sell", requireAuth, (req, res) => {
  const { symbol, quantity } = req.body;
  const sym = (symbol || "").toUpperCase();
  const qty = parseInt(quantity, 10);

  if (!stocks[sym])
    return res.status(400).json({ error: "Invalid stock symbol" });
  if (!qty || qty < 1 || qty > 10000)
    return res
      .status(400)
      .json({ error: "Quantity must be between 1 and 10,000" });
  if (stocks[sym].price === 0)
    return res
      .status(503)
      .json({ error: "Price unavailable — market may be loading" });

  const stock = stocks[sym];
  const proceeds = parseFloat((stock.price * qty).toFixed(2));
  const userId = req.session.userId;

  const execute = db.transaction(() => {
    const holding = db
      .prepare(
        "SELECT shares, avg_cost FROM holdings WHERE user_id = ? AND symbol = ?",
      )
      .get(userId, sym);
    const owned = holding ? holding.shares : 0;

    if (owned < qty) {
      throw Object.assign(
        new Error(
          `Insufficient shares. You own ${owned}, tried to sell ${qty}`,
        ),
        { code: "INSUFFICIENT_SHARES" },
      );
    }

    db.prepare(
      "UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?",
    ).run(proceeds, userId);

    const remaining = owned - qty;
    if (remaining === 0) {
      db.prepare("DELETE FROM holdings WHERE user_id = ? AND symbol = ?").run(
        userId,
        sym,
      );
    } else {
      db.prepare(
        "UPDATE holdings SET shares = ? WHERE user_id = ? AND symbol = ?",
      ).run(remaining, userId, sym);
    }

    db.prepare(
      "INSERT INTO transactions (user_id, type, symbol, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, "SELL", sym, qty, stock.price, proceeds);

    return { symbol: sym, quantity: qty, price: stock.price, total: proceeds };
  });

  try {
    const result = execute();
    res.json(result);
  } catch (err) {
    if (err.code === "INSUFFICIENT_SHARES")
      return res.status(400).json({ error: err.message });
    console.error("Sell error:", err);
    res.status(500).json({ error: "Transaction failed" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stock Marketplace running at http://localhost:${PORT}`);
});
