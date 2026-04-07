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
}

module.exports = { getDB };
