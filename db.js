const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "marketplace.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    balance       REAL    NOT NULL DEFAULT 10000.00,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS holdings (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol   TEXT    NOT NULL,
    shares   INTEGER NOT NULL DEFAULT 0,
    avg_cost REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type      TEXT    NOT NULL CHECK(type IN ('BUY', 'SELL')),
    symbol    TEXT    NOT NULL,
    quantity  INTEGER NOT NULL,
    price     REAL    NOT NULL,
    total     REAL    NOT NULL,
    timestamp TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol   TEXT    NOT NULL,
    added_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, symbol)
  );
`);

module.exports = db;
