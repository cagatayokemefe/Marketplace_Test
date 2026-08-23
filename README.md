> **Also in this repo:** [`event-app/`](event-app/) — **MeetApp**, a Meetup-style event
> app (web + installable PWA + Capacitor native shell) where users join events such
> as a volleyball match and pay the participation fee in-app, with all payments
> collected by the app owner. See [`event-app/README.md`](event-app/README.md).

---

# Stock Marketplace

A full-stack stock trading simulator with real-time market prices, user authentication, per-user wallets, a P2P marketplace, favorites, and a settings system.

## Features

- **20 live stocks** — prices fetched from Yahoo Finance every 5 seconds, including AAPL, TSLA, NVDA, MSFT, GOOGL, and 15 more
- **User accounts** — register, login, logout with secure session management
- **Per-user wallet** — each user starts with $10,000; balance and portfolio stored server-side
- **Buy & sell shares** — trade directly against live market prices; atomic database transactions ensure no partial state
- **P2P Marketplace** — list your shares for sale at any price; other users can browse open listings and buy any amount (1 share up to the full listing); shares are locked at listing time and released on cancel
- **Partial fills** — when buying from a listing, choose exactly how many shares you want; the listing stays open with the remaining quantity until fully filled
- **Price comparison badge** — each listing shows `+X%` or `-X% vs market` so buyers can instantly see if a listing is above or below the live price
- **Portfolio tracking** — real-time market value and gain/loss per holding
- **Transaction history** — full record of all buy/sell activity per user, including P2P trades
- **Favorites** — star any stock to pin it to a dedicated section at the top of the market page; stored in the database per user
- **Stock search** — filter the market list by symbol or company name
- **Compact market list** — stocks show as rows by default; clicking a row expands it to a full card with description, direct trade controls, and a P2P listing form
- **Wallet / Profile page** — dedicated page with account stats, full portfolio table, and filterable transaction history (All / BUY / SELL)
- **Settings page** — dark/light theme toggle (moon/sun switch) and auto-refresh on/off; preferences saved in `localStorage`
- **Username dropdown** — hover the username in the header to reveal Wallet and Settings links

## Stocks Available

| Symbol | Company                  | Symbol | Company               |
|--------|--------------------------|--------|-----------------------|
| AAPL   | Apple Inc.               | INTC   | Intel Corp.           |
| TSLA   | Tesla Inc.               | BABA   | Alibaba Group         |
| MSFT   | Microsoft Corp.          | DIS    | The Walt Disney Co.   |
| GOOGL  | Alphabet Inc.            | UBER   | Uber Technologies     |
| AMZN   | Amazon.com Inc.          | SPOT   | Spotify Technology    |
| META   | Meta Platforms           | PYPL   | PayPal Holdings       |
| NVDA   | NVIDIA Corp.             | SHOP   | Shopify Inc.          |
| NFLX   | Netflix Inc.             | COIN   | Coinbase Global       |
| AMD    | Advanced Micro Devices   | SNAP   | Snap Inc.             |
|        |                          | PLTR   | Palantir Technologies |
|        |                          | RIVN   | Rivian Automotive     |

## Getting Started

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to the login page. Create an account to start trading.

## Project Structure

```
├── server.js            # Express server — auth, stock, trade, favorites, and listings routes
├── db.js                # SQLite database setup and schema
├── marketplace.db       # SQLite data file (auto-created on first run)
├── sessions.db          # Session store (auto-created on first run)
├── public/
│   ├── index.html       # Main trading interface
│   ├── login.html       # Login page
│   ├── register.html    # Registration page
│   ├── profile.html     # Wallet / profile page
│   ├── settings.html    # Settings page (theme, auto-refresh)
│   ├── app.js           # Frontend logic
│   └── style.css        # Dark + light theme styles
└── package.json
```

## Tech Stack

| Layer     | Technology                               |
|-----------|------------------------------------------|
| Server    | Node.js, Express                         |
| Database  | SQLite via `better-sqlite3`              |
| Auth      | `express-session` + `bcryptjs` (12 rounds) |
| Prices    | `yahoo-finance2`                         |
| Security  | `helmet`, `express-rate-limit`           |

## Security

| Threat                  | Protection                                              |
|-------------------------|---------------------------------------------------------|
| Weak passwords          | bcrypt with 12 salt rounds                              |
| Brute force login       | Rate limit: 10 attempts per 15 minutes per IP           |
| Session hijacking       | `httpOnly` + `sameSite: strict` cookie                  |
| CSRF                    | `sameSite: strict` blocks cross-origin requests         |
| SQL injection           | Parameterized queries (`better-sqlite3`)                |
| Fake balance / cheating | Server is the sole source of truth — no client storage  |
| Session fixation        | `session.regenerate()` called on every login            |
| User enumeration        | Dummy bcrypt hash runs even when username doesn't exist |
| Partial transactions    | `db.transaction()` — full atomic commit or rollback     |
| P2P double-spend        | Shares deducted from seller at listing creation time    |
| HTTP header attacks     | `helmet` sets CSP, X-Frame-Options, HSTS, and more      |
| Inline script injection | No `onclick` / inline handlers — all listeners use `addEventListener` |

## API Endpoints

### Auth
| Method | Route                  | Description                     |
|--------|------------------------|---------------------------------|
| GET    | `/login`               | Login page                      |
| GET    | `/register`            | Registration page               |
| POST   | `/api/auth/register`   | Create account                  |
| POST   | `/api/auth/login`      | Login (rate limited)            |
| POST   | `/api/auth/logout`     | Logout and destroy session      |
| GET    | `/api/auth/me`         | Get current user state (balance, portfolio, favorites, transactions) |

### Pages (require authentication)
| Method | Route        | Description              |
|--------|--------------|--------------------------|
| GET    | `/`          | Main trading interface   |
| GET    | `/profile`   | Wallet / profile page    |
| GET    | `/settings`  | Settings page            |

### Stocks & Trades (require authentication)
| Method | Route                  | Description                          |
|--------|------------------------|--------------------------------------|
| GET    | `/api/stocks`          | List all 20 stocks with current prices |
| GET    | `/api/stocks/:symbol`  | Single stock detail                  |
| POST   | `/api/buy`             | Buy shares `{ symbol, quantity }`    |
| POST   | `/api/sell`            | Sell shares `{ symbol, quantity }`   |

### Favorites (require authentication)
| Method | Route                     | Description              |
|--------|---------------------------|--------------------------|
| GET    | `/api/favorites`          | List user's favorites    |
| POST   | `/api/favorites`          | Add favorite `{ symbol }` |
| DELETE | `/api/favorites/:symbol`  | Remove favorite          |

### P2P Marketplace (require authentication)
| Method | Route                     | Description                                              |
|--------|---------------------------|----------------------------------------------------------|
| GET    | `/api/listings`           | List all open sell orders with seller username           |
| POST   | `/api/listings`           | Create a sell listing `{ symbol, quantity, price_per_share }` |
| DELETE | `/api/listings/:id`       | Cancel own listing (returns shares to portfolio)         |
| POST   | `/api/listings/:id/buy`   | Buy from a listing `{ quantity }` — supports partial fills |

## Environment Variables

| Variable         | Default                 | Description                |
|------------------|-------------------------|----------------------------|
| `SESSION_SECRET` | insecure default string | Secret for signing cookies |
| `PORT`           | `3000`                  | Port to listen on          |

For production, always set `SESSION_SECRET` to a long random string and enable `secure: true` on the session cookie (requires HTTPS).

```bash
SESSION_SECRET=your-long-random-secret-here npm start
```
