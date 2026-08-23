"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const config = require("./config");

// Konum DB_PATH ile değiştirilebilir (test ve dağıtım için).
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Tüm para alanları "minor unit" (kuruş) olarak tam sayı tutulur.
 * 150.00 TL  ->  15000
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    phone         TEXT,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('user','owner')),
    city          TEXT,
    bio           TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT 'Sports',
    cover        TEXT    NOT NULL DEFAULT '🎉',
    city         TEXT    NOT NULL DEFAULT 'İstanbul',
    venue        TEXT    NOT NULL DEFAULT '',
    address      TEXT    NOT NULL DEFAULT '',
    starts_at    TEXT    NOT NULL,
    ends_at      TEXT,
    capacity     INTEGER NOT NULL DEFAULT 20 CHECK(capacity > 0),
    price_minor  INTEGER NOT NULL DEFAULT 0 CHECK(price_minor >= 0),
    currency     TEXT    NOT NULL DEFAULT 'TRY',
    level        TEXT    NOT NULL DEFAULT 'All',
    status       TEXT    NOT NULL DEFAULT 'published'
                         CHECK(status IN ('published','cancelled')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
  CREATE INDEX IF NOT EXISTS idx_events_organizer ON events(organizer_id);

  CREATE TABLE IF NOT EXISTS registrations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','cancelled')),
    amount_minor  INTEGER NOT NULL DEFAULT 0,
    ticket_code   TEXT    NOT NULL UNIQUE,
    checked_in_at TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id       INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    event_id              INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_minor          INTEGER NOT NULL,
    currency              TEXT    NOT NULL DEFAULT 'TRY',
    provider              TEXT    NOT NULL DEFAULT 'demo',
    provider_ref          TEXT,
    status                TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','paid','refunded','failed')),
    commission_minor      INTEGER NOT NULL DEFAULT 0,
    organizer_share_minor INTEGER NOT NULL DEFAULT 0,
    card_last4            TEXT,
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    paid_at               TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
`);

module.exports = db;
