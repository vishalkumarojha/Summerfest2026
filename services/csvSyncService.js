"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { getDB } = require("../db");

const DEFAULT_SYNC_FILE = process.env.CSV_SYNC_FILE || "./registration.csv";

function normalizeHeaders(header) {
  return header.map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
}

function loadRecords(csvFile) {
  const raw = fs.readFileSync(path.resolve(csvFile), "utf8");
  return parse(raw, {
    columns: normalizeHeaders,
    skip_empty_lines: true,
    trim: true,
  });
}

function buildUtrFrequency(records) {
  const seen = {};
  for (const r of records) {
    const utr = r.utr_id || r.utr || r.transaction_id || r.payment_id || null;
    if (utr) seen[utr] = (seen[utr] || 0) + 1;
  }
  return seen;
}

function importCsvFile(csvFile) {
  const records = loadRecords(csvFile);
  const utrSeen = buildUtrFrequency(records);
  const db = getDB();
  const stats = { inserted: 0, updated: 0, skipped: 0, suspicious: 0 };

  const findByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, registration_id, utr_id, verification_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateUser = db.prepare(`
    UPDATE users
    SET name = ?, phone = ?, registration_id = ?, utr_id = ?, verification_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const importAll = db.transaction(() => {
    for (const r of records) {
      const name = r.name || r.full_name || "";
      const email = r.email || r.email_address || "";
      const phone = r.phone || r.phone_number || null;
      const registrationId = r.registration_id || r.reg_id || r.response_id || null;
      const utr = r.utr_id || r.utr || r.transaction_id || r.payment_id || null;

      if (!name || !email) {
        stats.skipped++;
        continue;
      }

      let nextStatus = "pending";
      if (utr && utrSeen[utr] > 1) {
        nextStatus = "suspicious";
        stats.suspicious++;
      }

      const existing = findByEmail.get(email);
      if (!existing) {
        insertUser.run(name, email, phone, registrationId, utr, nextStatus);
        stats.inserted++;
        continue;
      }

      const preservedStatus = existing.verification_status === "pending"
        ? nextStatus
        : existing.verification_status;

      const changed =
        existing.name !== name ||
        (existing.phone || null) !== phone ||
        (existing.registration_id || null) !== registrationId ||
        (existing.utr_id || null) !== utr ||
        existing.verification_status !== preservedStatus;

      if (!changed) {
        stats.skipped++;
        continue;
      }

      updateUser.run(name, phone, registrationId, utr, preservedStatus, existing.id);
      stats.updated++;
    }
  });

  importAll();
  return stats;
}

function formatStats(stats) {
  return [
    `Inserted: ${stats.inserted}`,
    `Updated: ${stats.updated}`,
    `Skipped: ${stats.skipped}`,
    `Suspicious: ${stats.suspicious}`,
  ].join(" | ");
}

function startCsvWatcher(csvFile = DEFAULT_SYNC_FILE) {
  const resolved = path.resolve(csvFile);
  let syncTimer = null;

  const syncNow = (reason) => {
    if (!fs.existsSync(resolved)) return;
    try {
      const stats = importCsvFile(resolved);
      console.log(`[csv-sync] ${reason}: ${path.basename(resolved)} -> ${formatStats(stats)}`);
    } catch (err) {
      console.error(`[csv-sync] Failed to sync ${path.basename(resolved)}:`, err.message);
    }
  };

  syncNow("startup");

  if (!fs.existsSync(resolved)) return;

  fs.watch(resolved, () => {
    clearTimeout(syncTimer);
    // Debounce editor save bursts so we import only once per change.
    syncTimer = setTimeout(() => syncNow("change detected"), 500);
  });
}

module.exports = { importCsvFile, startCsvWatcher };
