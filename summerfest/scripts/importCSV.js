#!/usr/bin/env node
"use strict";
/**
 * Import registrations from a CSV file.
 * 
 * CSV columns (case-insensitive headers):
 *   name, email, phone, registration_id, utr_id
 * 
 * Usage: node scripts/importCSV.js registrations.csv
 */
require("dotenv").config();
const fs    = require("fs");
const path  = require("path");
const { parse } = require("csv-parse/sync");
const { getDB } = require("../db");

const csvFile = process.argv[2];
if (!csvFile) {
  console.error("Usage: node scripts/importCSV.js <file.csv>");
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(csvFile), "utf8");
const records = parse(raw, {
  columns: header => header.map(h => h.trim().toLowerCase().replace(/\s+/g, "_")),
  skip_empty_lines: true,
  trim: true,
});

const db = getDB();

// Detect duplicate UTRs in the import file itself
const utrSeen = {};
records.forEach(r => {
  if (r.utr_id) {
    utrSeen[r.utr_id] = (utrSeen[r.utr_id] || 0) + 1;
  }
});

const insert = db.prepare(`
  INSERT OR IGNORE INTO users (name, email, phone, registration_id, utr_id, verification_status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stats = { inserted: 0, skipped: 0, suspicious: 0 };

const importAll = db.transaction(() => {
  for (const r of records) {
    const name  = r.name  || r.full_name || "";
    const email = r.email || r.email_address || "";
    if (!name || !email) { stats.skipped++; continue; }

    let status = "pending";
    const utr  = r.utr_id || r.utr || r.transaction_id || r.payment_id || null;

    if (utr && utrSeen[utr] > 1) {
      status = "suspicious";
      stats.suspicious++;
    }

    const info = insert.run(
      name, email,
      r.phone || r.phone_number || null,
      r.registration_id || r.reg_id || r.response_id || null,
      utr,
      status
    );
    if (info.changes > 0) stats.inserted++;
    else stats.skipped++;
  }
});

importAll();

console.log(`\n✅  Import complete`);
console.log(`   Inserted:    ${stats.inserted}`);
console.log(`   Skipped:     ${stats.skipped} (duplicates)`);
console.log(`   Suspicious:  ${stats.suspicious} (duplicate UTR)\n`);
