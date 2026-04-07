#!/usr/bin/env node
"use strict";
/**
 * run: node scripts/setup.js
 * Creates the default admin account and validates environment.
 */
require("dotenv").config();
const readline = require("readline");
const bcrypt   = require("bcryptjs");
const { getDB } = require("../db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const q  = (prompt) => new Promise(r => rl.question(prompt, r));

async function main() {
  console.log("\n🎉  Summer Fest 2026 – First-Time Setup\n");

  // Env checks
  const missing = ["JWT_SECRET", "SMTP_USER", "SMTP_PASS"].filter(k => !process.env[k]);
  if (missing.length) {
    console.warn("⚠️  Missing .env keys:", missing.join(", "));
    console.warn("   Copy .env.example to .env and fill them in.\n");
  }

  const db = getDB();

  // Check if admin already exists
  const existing = db.prepare("SELECT COUNT(*) AS n FROM admins").get();
  if (existing.n > 0) {
    const yn = await q("Admin already exists. Create another? (y/N): ");
    if (yn.trim().toLowerCase() !== "y") { rl.close(); return; }
  }

  const username = (await q("Admin username [admin]: ")).trim() || "admin";
  const password = await q("Admin password: ");
  if (!password || password.length < 8) {
    console.error("❌ Password must be at least 8 characters"); rl.close(); process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare("INSERT OR REPLACE INTO admins (username, password) VALUES (?,?)").run(username, hash);

  console.log(`\n✅  Admin '${username}' created successfully!`);
  console.log(`\n🚀  Start the server: npm start`);
  console.log(`   Admin UI → http://localhost:${process.env.PORT || 3000}/\n`);
  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
