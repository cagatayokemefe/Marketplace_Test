# MeetApp — find an event, join, pay

*[Türkçe sürüm →](README.tr.md)*

A Meetup-style event app. Someone opens a volleyball game, whoever wants to
play reserves a spot, pays the participation fee inside the app, and gets a
ticket code the host validates at the door. **Every payment is collected by the
app owner**; the host's share is tracked separately as an amount payable.

One codebase runs in three places:

| Where | How |
| --- | --- |
| **Web (desktop)** | In the browser at `http://localhost:3000` |
| **Phone — like a real app** | PWA: "Add to Home Screen" in Safari/Chrome → full screen, its own icon, opens offline |
| **Native iOS / Android** | An App Store / Play Store build via Capacitor (`capacitor.config.json` is ready) |

The interface is mobile-first: a bottom tab bar and a sticky pay button on
phones, a top nav and a two-column detail page on desktop. Light/dark theme and
**Turkish / English language support** are built in.

---

## Quick start

```bash
cd event-app
npm install
npm start
```

Open `http://localhost:3000`. If the database is empty, demo data (volleyball,
five-a-side football, yoga, a forest hike) is loaded automatically.

### Demo accounts

| Account | Email | Password | What they see |
| --- | --- | --- | --- |
| Attendee | `irfan@example.com` | `irfan1234` | Joins events, pays, gets a ticket |
| Host | `zeynep@example.com` | `zeynep1234` | Attendee list and door check-in for their own events |
| **App owner** | `owner@meetapp.app` | `owner1234` | Revenue dashboard: everything collected, commission, amounts owed to hosts |

### Language

Switch with the **TR / EN** button in the top bar, or from the language section
on the profile page. See [Language support](#language-support) below.

Useful commands:

```bash
npm run seed     # add demo data (leaves existing data alone)
npm run reset    # wipe the database and re-create demo data
npm run smoke    # end-to-end smoke test (against a temporary database)
npm run icons    # regenerate the app icons
```

---

## Walkthrough: İrfan joins a volleyball game

1. **Discover** — İrfan opens the app and searches for "volleyball", or picks
   the Sports/İstanbul filters. Each card shows the date, venue, how full it is
   (1/12) and the price (₺150).
2. **Detail** — He opens the event: description, address, host and who is going.
   A bar pinned to the bottom shows "₺150 · per person" and **Join and pay**.
3. **Holding the spot** — On tap, the server checks capacity and opens a
   registration and a payment, both `pending`.
4. **Payment** — The checkout screen shows the amount and an event summary. Once
   the payment succeeds the registration becomes `confirmed` and the amount is
   credited to the app owner.
5. **Ticket** — İrfan gets an entry code like `ABCD-1234`. At the venue the host
   types it into **Attendees → Check-in**; the same code is refused the second time.
6. **Cancelling** — More than 6 hours before the event İrfan can cancel and is
   refunded. Inside the last 6 hours refunds are closed.

---

## How the money flows

```
İrfan's card ──► App owner's account ──► (after the event) the host
                 ▲                        ▲
                 │                        │
        the full amount            share minus commission
```

- **All** of what the attendee pays goes to the app owner.
- Each payment records `commission_minor` (the owner's cut) and
  `organizer_share_minor` (owed to the host) separately.
- The commission rate is set with `COMMISSION_RATE` (default `0.10` = 10%).
- On `#/dashboard` the owner sees total collected, commission, what is owed to
  hosts, refunds and a full payment breakdown.

Amounts are stored as integers in **minor units** (cents) — no floating-point
rounding drift. ₺150 → `15000`.

### Payment provider

| Mode | When | Behaviour |
| --- | --- | --- |
| `demo` | `STRIPE_SECRET_KEY` is not set (default) | An in-app card form. No real money moves. Test card `4242 4242 4242 4242`, declined card `4000 0000 0000 0002`. |
| `stripe` | `STRIPE_SECRET_KEY` is set | Real Stripe Checkout. The user is redirected to Stripe and the payment is verified server-side on the way back. The money lands in the Stripe account the key belongs to — the app owner's. Cancellations are refunded through Stripe. |

To go live, copy `.env.example` to `.env` and fill in `STRIPE_SECRET_KEY` and
`PUBLIC_URL` — no code changes needed. The Stripe SDK is not installed; the app
calls the REST API directly.

> Card details are never written to the database in either mode; only the last
> four digits are kept (in demo mode) for the receipt.

---

## Language support

The app runs in Turkish and English. The language is switched from the
**TR / EN** button in the top bar or from the profile page; the choice is saved
to `localStorage` and remembered on the next visit. With no saved choice the
browser language is used, and if that is unsupported `DEFAULT_LANG` takes over.

Translation happens in two layers:

| Layer | File | Covers |
| --- | --- | --- |
| Interface | `public/i18n.js` | Every screen string, button, empty state and toast |
| Server | `messages.js` | Error and validation messages returned by the API |

The client sends the selected language in an `X-Lang` header on every API
request; the server resolves it in order from the `?lang=` query, the `X-Lang`
header, `Accept-Language`, and finally `DEFAULT_LANG`. That way messages like
"Password must be at least 8 characters" also arrive in the reader's language.

Locale-dependent formatting goes through `Intl`: dates
(`25 Ağustos 2026 Salı` ↔ `Tuesday 25 August 2026`), times and currency. Amounts
use the narrow symbol in every language (`₺150`).

Event category and level are stored in the database in a single canonical form
(English: `Sports`, `Outdoors`, `All`, `Beginner`, …) and translated only for
display, so switching language never breaks the filters. Event titles and
descriptions are content written by the host and are deliberately **not**
machine-translated — they appear in whatever language they were written in.

### Adding a language

1. Add a row to `LANGS` in `public/i18n.js` (`{ code, label, flag, locale }`).
2. Add a translation object with the same keys to `DICT` in that file.
3. Add the server messages to `DICT` in `messages.js`.

Any key you leave out falls back to the default language; nothing breaks.

> Source comments and the demo seed data are in Turkish. That is deliberate, not
> an oversight — the code the machine reads is English, the notes the author
> reads are Turkish.

---

## Installing on a phone

### 1. PWA (fastest route, no store needed)

Deploy the server behind HTTPS, then open it on a phone:

- **iOS:** Safari → Share → *Add to Home Screen*
- **Android:** Chrome → menu → *Install app*

You get an icon on the home screen, a full-screen view with no address bar, and
a shell that opens offline. `public/manifest.webmanifest` and `public/sw.js`
handle this; the icons are generated from code by `tools/make-icons.js`.

### 2. Native iOS / Android (App Store / Play Store)

```bash
cd event-app
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios       # opens Xcode
npx cap open android   # opens Android Studio
```

The native shell has to reach the API over HTTP, so point
`capacitor.config.json` at your server:

```json
"server": { "url": "https://meetapp.example.com", "androidScheme": "https" }
```

The interface is already written for touch target sizes, `safe-area-inset`
values and 16px form text (so iOS does not zoom on focus).

> App Store note: on iOS a **fee for a physical, real-world event** may be
> charged through an external payment method (App Store Review Guidelines
> 3.1.3(e), services consumed outside the app). In-app purchase would only be
> mandatory if the app sold digital content.

---

## Deployment

The app is a single Node process and a single SQLite file, so it runs on any
host that gives it a **persistent disk**. Serverless platforms such as
Vercel/Netlify are not suitable — their filesystem is ephemeral, so the database
would be wiped on every deploy.

A ready-made `Dockerfile` is included: it writes data to `/data`, reports
liveness on `/api/health`, and listens on `0.0.0.0`.

```bash
docker build -t meetapp .
docker run -p 3000:3000 -v meetapp-data:/data \
  -e SESSION_SECRET="a-long-random-string" \
  -e PUBLIC_URL="https://your-domain.com" \
  -e OWNER_EMAIL="you@example.com" -e OWNER_PASSWORD="a-strong-password" \
  meetapp
```

Must be set in production:

| Variable | Why |
| --- | --- |
| `NODE_ENV=production` | Marks the session cookie `secure` (HTTPS only) |
| `SESSION_SECRET` | Long and random; changing it signs everyone out |
| `PUBLIC_URL` | Where Stripe returns the user after payment |
| `DB_PATH` | Must point at the persistent disk (e.g. `/data/meetapp.db`) |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | The owner account created on first boot |
| `STRIPE_SECRET_KEY` | For real payments; without it the app stays in demo mode |

> On first boot an empty database is filled with demo data (sample events and
> test accounts such as `irfan@example.com`). Clear these from `#/dashboard` or
> from the database before letting real users in.

---

## Architecture

```
event-app/
├── server.js                 Express API + serves the SPA
├── db.js                     SQLite schema (users, events, registrations, payments)
├── payments.js               Payment provider (Stripe REST / demo)
├── messages.js               Translations for server messages (tr / en)
├── config.js                 Configuration from environment variables
├── seed.js                   Demo data
├── capacitor.config.json     Native packaging
├── Dockerfile                Production image (data in /data)
├── tools/
│   ├── make-icons.js         PNG icon generator (no dependencies)
│   └── smoke-test.js         End-to-end test
└── public/
    ├── index.html            App shell
    ├── app.js                Hash router + every screen
    ├── i18n.js               Interface translations and language handling
    ├── style.css             Design tokens, light/dark theme, responsive layout
    ├── manifest.webmanifest  PWA definition
    ├── sw.js                 Service worker
    └── icons/                Generated icons
```

There is no build step. The files in `public/` go to the browser as they are,
which is also why Capacitor can package that same folder.

### Data model

- **users** — name, email, bcrypt password hash, role (`user` / `owner`)
- **events** — host, date, venue, capacity, price in minor units, status
- **registrations** — event + user (unique pair), status, ticket code, check-in time
- **payments** — registration, amount, provider, provider reference, status, commission split

The capacity check, the registration and the payment are created inside a single
SQLite transaction, so no half-finished state can survive.

### API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe (for hosting providers) |
| `GET` | `/api/config` | App name, currency, payment mode, supported languages |
| `POST` | `/api/auth/register` · `/login` · `/logout` | Session handling |
| `GET` `PATCH` | `/api/me` | Profile |
| `GET` | `/api/events` | Search + category/city filters |
| `GET` | `/api/events/:id` | Detail + attendees |
| `POST` | `/api/events` | Create an event |
| `POST` | `/api/events/:id/cancel` | Cancel an event (host) |
| `POST` | `/api/events/:id/join` | Reserve a spot → confirmed if free, otherwise start payment |
| `GET` | `/api/payments/:id` | Payment status |
| `POST` | `/api/payments/:id/confirm` | Complete a payment (demo card or Stripe verification) |
| `POST` | `/api/registrations/:id/cancel` | Cancel + refund |
| `GET` | `/api/events/:id/attendees` | Attendee list (host) |
| `POST` | `/api/events/:id/checkin` | Validate a ticket code (host) |
| `GET` | `/api/my/registrations` · `/my/events` · `/my/payments` | The user's own data |
| `GET` | `/api/owner/summary` · `/owner/payments` | Revenue dashboard (owner only) |

### Security

- Passwords are hashed with bcrypt; sessions travel in an `httpOnly` cookie and
  are stored in SQLite.
- Helmet plus a content security policy; rate limits on the auth and payment
  endpoints.
- Authorization is enforced server-side: the attendee list and check-in are open
  only to the host, the revenue dashboard only to the `owner` role.
- Every user-supplied string is escaped before rendering (XSS), including values
  interpolated into translation placeholders.
- In production `NODE_ENV=production` makes the cookie `secure`, and
  `SESSION_SECRET` must be changed.

---

## Testing

```bash
npm run smoke
```

41 checks: signup validation, search, payment required for paid events, declined
card, successful payment and ticket generation, duplicate-join guard, instant
confirmation for free events, host check-in and its reuse guard, authorization
boundaries, refunds and how they land in the revenue report, language
negotiation (`X-Lang`, `?lang=`, falling back to the default) and translated
validation messages.
