# Stock Marketplace

A full-stack stock trading simulator with real-time market prices, user authentication, and per-user wallets.

## Features

- **Real market prices** — AAPL and TSLA prices fetched live from Yahoo Finance, refreshed every 60 seconds
- **User accounts** — register, login, logout with secure session management
- **Per-user wallet** — each user starts with $10,000; balance and portfolio are stored server-side
- **Buy & sell shares** — atomic database transactions ensure no partial state
- **Portfolio tracking** — real-time market value and gain/loss per holding
- **Transaction history** — full record of all buy/sell activity per user

## Stocks Available

| Symbol | Company    |
|--------|------------|
| AAPL   | Apple Inc. |
| TSLA   | Tesla Inc. |

## Getting Started

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to the login page. Create an account to start trading.

## Project Structure

```
├── server.js          # Express server — auth, stock, and trade routes
├── db.js              # SQLite database setup and schema
├── marketplace.db     # SQLite data file (auto-created on first run)
├── sessions.db        # Session store (auto-created on first run)
├── public/
│   ├── index.html     # Main trading interface
│   ├── login.html     # Login page
│   ├── register.html  # Registration page
│   ├── app.js         # Frontend logic
│   └── style.css      # Dark theme styles
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
| HTTP header attacks     | `helmet` sets CSP, X-Frame-Options, HSTS, and more      |

## API Endpoints

### Auth
| Method | Route                  | Description                     |
|--------|------------------------|---------------------------------|
| GET    | `/login`               | Login page                      |
| GET    | `/register`            | Registration page               |
| POST   | `/api/auth/register`   | Create account                  |
| POST   | `/api/auth/login`      | Login (rate limited)            |
| POST   | `/api/auth/logout`     | Logout and destroy session      |
| GET    | `/api/auth/me`         | Get current user state          |

### Stocks & Trades (require authentication)
| Method | Route               | Description                          |
|--------|---------------------|--------------------------------------|
| GET    | `/api/stocks`       | List all stocks with current prices  |
| GET    | `/api/stocks/:symbol` | Single stock detail                |
| POST   | `/api/buy`          | Buy shares `{ symbol, quantity }`    |
| POST   | `/api/sell`         | Sell shares `{ symbol, quantity }`   |

## Environment Variables

| Variable         | Default                                    | Description               |
|------------------|--------------------------------------------|---------------------------|
| `SESSION_SECRET` | insecure default string                    | Secret for signing cookies |
| `PORT`           | `3000`                                     | Port to listen on          |

For production, always set `SESSION_SECRET` to a long random string and enable `secure: true` on the session cookie (requires HTTPS).

```bash
SESSION_SECRET=your-long-random-secret-here npm start
```
