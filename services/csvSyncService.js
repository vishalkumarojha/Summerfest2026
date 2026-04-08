"use strict";
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { parse }    = require("csv-parse/sync");
const { supabase } = require("../db");

function normalizeHeaders(header) {
  return header.map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
}

function loadRecords(csvFile) {
  const raw = fs.readFileSync(path.resolve(csvFile), "utf8");
  return parse(raw, { columns: normalizeHeaders, skip_empty_lines: true, trim: true });
}

function buildUtrFrequency(records) {
  const seen = {};
  for (const r of records) {
    const utr = r.utr_id || r.utr || r.transaction_id || r.payment_id || r["itr_id_/_transaction_id"] || null;
    if (utr) seen[utr] = (seen[utr] || 0) + 1;
  }
  return seen;
}

async function importCsvFile(csvFile) {
  const records = loadRecords(csvFile);
  const utrSeen = buildUtrFrequency(records);
  const stats   = { inserted: 0, updated: 0, skipped: 0, suspicious: 0 };

  for (const r of records) {
    let name             = r.name || r.full_name || "";
    const email          = r.email || r.email_address || "";
    const phone          = r.phone || r.phone_number || null;
    const registrationId = r.registration_id || r.registration_number || r.reg_id || r.response_id || null;
    const utr            = r.utr_id || r.utr || r.transaction_id || r.payment_id || r["itr_id_/_transaction_id"] || null;

    if (!name && email) {
      name = registrationId || email.split("@")[0];
    }

    if (!name || !email) { stats.skipped++; continue; }

    let nextStatus = "pending";
    if (utr && utrSeen[utr] > 1) { nextStatus = "suspicious"; stats.suspicious++; }

    // Check if user exists
    const { data: existing } = await supabase
      .from("users").select("id, name, phone, registration_id, utr_id, verification_status")
      .eq("email", email).single();

    if (!existing) {
      const { error } = await supabase.from("users")
        .insert({ name, email, phone, registration_id: registrationId, utr_id: utr, verification_status: nextStatus });
      if (!error) stats.inserted++;
      else console.error("Insert error:", error.message);
      continue;
    }

    // Preserve non-pending status
    const preservedStatus = existing.verification_status === "pending" ? nextStatus : existing.verification_status;
    const changed = existing.name !== name
      || (existing.phone||null) !== phone
      || (existing.registration_id||null) !== registrationId
      || (existing.utr_id||null) !== utr
      || existing.verification_status !== preservedStatus;

    if (!changed) { stats.skipped++; continue; }

    await supabase.from("users")
      .update({ name, phone, registration_id: registrationId, utr_id: utr, verification_status: preservedStatus, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    stats.updated++;
  }
  return stats;
}

// File watcher removed — not needed in cloud deployment
// Call importCsvFile() directly from the admin route
module.exports = { importCsvFile };
