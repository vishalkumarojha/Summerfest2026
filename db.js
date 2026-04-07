"use strict";
const Database = require("better-sqlite3");
const path = require("path");
require("dotenv").config();

const DB_PATH = process.env.DB_PATH || "./summerfest.db";
let db;

function getDB() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma("journal_mode = WAL");   // faster concurrent reads
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- ── Admins ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS admins (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT UNIQUE NOT NULL,
      password  TEXT NOT NULL,           -- bcrypt hash
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Scanners ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scanners (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT UNIQUE NOT NULL,
      password  TEXT NOT NULL,           -- bcrypt hash (cost 12)
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Users / Registrations ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL,
      email               TEXT NOT NULL,
      phone               TEXT,
      registration_id     TEXT,          -- from Google Form
      utr_id              TEXT,          -- UPI Transaction Reference
      screenshot_url      TEXT,          -- path to uploaded screenshot
      verification_status TEXT NOT NULL DEFAULT 'pending'
                            CHECK(verification_status IN
                              ('pending','approved','rejected','suspicious')),
      ticket_id           INTEGER REFERENCES tickets(id),
      notes               TEXT,          -- admin notes
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(verification_status);
    CREATE INDEX IF NOT EXISTS idx_users_utr ON users(utr_id);

    -- ── Tickets ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tickets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      ticket_uuid TEXT UNIQUE NOT NULL,  -- e.g. SF26-XXXX-XXXX
      qr_token    TEXT NOT NULL,         -- JWT signed payload
      pdf_path    TEXT,
      is_used     INTEGER NOT NULL DEFAULT 0,
      used_at     TEXT,
      scanned_by  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_uuid ON tickets(ticket_uuid);
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

    -- ── Scan Logs ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scan_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  INTEGER REFERENCES tickets(id),
      ticket_uuid TEXT,
      scan_time  TEXT DEFAULT (datetime('now')),
      status     TEXT NOT NULL
                   CHECK(status IN ('VALID','ALREADY_USED','INVALID')),
      scanned_by TEXT,   -- IP or device ID of scanner
      notes      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_ticket ON scan_logs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_logs_time   ON scan_logs(scan_time);

    -- ── Email Logs ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS email_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id),
      ticket_id  INTEGER REFERENCES tickets(id),
      sent_at    TEXT DEFAULT (datetime('now')),
      status     TEXT NOT NULL CHECK(status IN ('sent','failed')),
      error_msg  TEXT
    );
  `);

  // ── Auto-seed scanners with unique per-account bcrypt hashes (cost 12) ──────
  // Each hash was generated independently so no two scanners share a hash.
  // Plaintext passwords are kept in .scanner-credentials (gitignored).
  const SCANNER_SEEDS = [
    { u: "scanner1",  h: "$2a$12$9eSPrU9dBk8nRNZSA9LnW.Gtv3Vr5gngbyZVdphRcmiIfn7lz0Buq" },
    { u: "scanner2",  h: "$2a$12$mIMDEKXnjtB8g4UvWTrdL.JbfquI2a0gqTXbG6HeFyQ3jDPFj6Bf." },
    { u: "scanner3",  h: "$2a$12$CQEyWUP5e3HPzXWR5BFOZOrSC5/trozkTRfnWyfYL34lUZYGxcLVW" },
    { u: "scanner4",  h: "$2a$12$yE9rjpExo14WjYeSG4vX.eWtozvXjk5nWP22rKOJGtCJMzZe7cf3G" },
    { u: "scanner5",  h: "$2a$12$L6o7z2v/akLdmP1FLVOf2OCEMEOP/.OeMVS1ayS7ww0u3iDfg63ea" },
    { u: "scanner6",  h: "$2a$12$76p3V3iiiy5xkXl..OT7iOuNFM5t46py7c8k0mqA7awF2y11epZ/2" },
    { u: "scanner7",  h: "$2a$12$ucgtDofzOVNsqerICn/vuuSgHyntml71JC2Zd5CzO.cgfI8o1XiIq" },
    { u: "scanner8",  h: "$2a$12$hcc274H04hy//CDCPzumaufA0RhDG7YjRD6c5hvEHBzIGmqBM6Fty" },
    { u: "scanner9",  h: "$2a$12$pvkXieVjRpkJP4jWa3KMWuOdv0FMRyLOiumnHW5jzdxb6v0NpVrgC" },
    { u: "scanner10", h: "$2a$12$SIZ8M8fmFz5apKVmH0fma.oNCdqmPeF0RpjIsL6o4mxNYC7gt3i0i" },
    { u: "scanner11", h: "$2a$12$qUuczBsrmhClWpp/7irpNO5Y238Vf6ZzoIk0P7N2YITqnQ.8tUy66" },
    { u: "scanner12", h: "$2a$12$Ls0vHIwdvJi4ARc1KRwgqeiRgrrZWUlnEGVkArGoxG0iSEBxTwaWe" },
    { u: "scanner13", h: "$2a$12$doq.0fc9ew3KPgcQumdn5O6NrUebNiH2a3zYL7yPWxtNiHJAGCqWm" },
    { u: "scanner14", h: "$2a$12$jntByz.ZFrNplqVYwCE5LOTofYxhqRF45Wfw9omGpkpEkcDTFRuZm" },
    { u: "scanner15", h: "$2a$12$Tt2MPY1mWlLrpEYV2vkRouuNVPDrMeU9pGPy0ZG/tYo6E5wD1iBIa" },
    { u: "scanner16", h: "$2a$12$N2aHld89SZBZD2jd20tRXexJzDcoDuhpB7ZQPoySo7yuv0QbzMbhu" },
  ];
  for (const { u, h } of SCANNER_SEEDS) {
    try {
      db.prepare("INSERT OR IGNORE INTO scanners (username, password) VALUES (?, ?)").run(u, h);
    } catch (_) {}
  }
}

module.exports = { getDB };
