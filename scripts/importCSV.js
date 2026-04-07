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
const { importCsvFile } = require("../services/csvSyncService");

const csvFile = process.argv[2];
if (!csvFile) {
  console.error("Usage: node scripts/importCSV.js <file.csv>");
  process.exit(1);
}

const stats = importCsvFile(csvFile);

console.log("\nImport complete");
console.log(`   Inserted:    ${stats.inserted}`);
console.log(`   Updated:     ${stats.updated}`);
console.log(`   Skipped:     ${stats.skipped}`);
console.log(`   Suspicious:  ${stats.suspicious} (duplicate UTR)\n`);
