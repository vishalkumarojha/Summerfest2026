#!/usr/bin/env node
"use strict";
/**
 * Seeds 20 dummy users for testing. 
 * Includes a duplicate UTR pair and various statuses.
 * run: node scripts/seedDummy.js
 */
require("dotenv").config();
const { getDB } = require("../db");

const DUMMY_USERS = [
  { name: "Arjun Sharma",    email: "arjun.sharma@vit.ac.in",    phone: "9876543210", registration_id: "REG001", utr_id: "UTR123456789012" },
  { name: "Priya Patel",     email: "priya.patel@vit.ac.in",     phone: "9876543211", registration_id: "REG002", utr_id: "UTR223456789012" },
  { name: "Rahul Gupta",     email: "rahul.gupta@vit.ac.in",     phone: "9876543212", registration_id: "REG003", utr_id: "UTR323456789012" },
  { name: "Sneha Singh",     email: "sneha.singh@vit.ac.in",     phone: "9876543213", registration_id: "REG004", utr_id: "UTR423456789012" },
  { name: "Amit Kumar",      email: "amit.kumar@vit.ac.in",      phone: "9876543214", registration_id: "REG005", utr_id: "UTR523456789012" },
  { name: "Pooja Mishra",    email: "pooja.mishra@vit.ac.in",    phone: "9876543215", registration_id: "REG006", utr_id: "UTR623456789012" },
  { name: "Rohit Verma",     email: "rohit.verma@vit.ac.in",     phone: "9876543216", registration_id: "REG007", utr_id: "UTR723456789012" },
  { name: "Ananya Joshi",    email: "ananya.joshi@vit.ac.in",    phone: "9876543217", registration_id: "REG008", utr_id: "UTR823456789012" },
  { name: "Vikram Rao",      email: "vikram.rao@vit.ac.in",      phone: "9876543218", registration_id: "REG009", utr_id: "UTR923456789012" },
  { name: "Kavya Nair",      email: "kavya.nair@vit.ac.in",      phone: "9876543219", registration_id: "REG010", utr_id: "UTR023456789012" },
  { name: "Siddharth Iyer",  email: "siddharth.iyer@vit.ac.in",  phone: "9876543220", registration_id: "REG011", utr_id: "UTR113456789012" },
  { name: "Meera Krishnan",  email: "meera.krishnan@vit.ac.in",  phone: "9876543221", registration_id: "REG012", utr_id: "UTR213456789012" },
  // Duplicate UTR pair (should be flagged suspicious)
  { name: "Ravi Desai",      email: "ravi.desai@vit.ac.in",      phone: "9876543222", registration_id: "REG013", utr_id: "DUPUTR99999999" },
  { name: "Sonia Kapoor",    email: "sonia.kapoor@vit.ac.in",    phone: "9876543223", registration_id: "REG014", utr_id: "DUPUTR99999999" },
  // Missing UTR
  { name: "Tarun Mehta",     email: "tarun.mehta@vit.ac.in",     phone: "9876543224", registration_id: "REG015", utr_id: null },
  { name: "Divya Choudhary", email: "divya.c@vit.ac.in",         phone: "9876543225", registration_id: "REG016", utr_id: "UTR316456789012" },
  { name: "Nikhil Agarwal",  email: "nikhil.a@vit.ac.in",        phone: "9876543226", registration_id: "REG017", utr_id: "UTR417456789012" },
  { name: "Ishaan Tiwari",   email: "ishaan.t@vit.ac.in",        phone: "9876543227", registration_id: "REG018", utr_id: "UTR518456789012" },
  { name: "Riya Bhatt",      email: "riya.b@vit.ac.in",          phone: "9876543228", registration_id: "REG019", utr_id: "UTR619456789012" },
  { name: "Aditya Saxena",   email: "aditya.s@vit.ac.in",        phone: "9876543229", registration_id: "REG020", utr_id: "UTR720456789012" },
];

const db = getDB();

// Mark duplicate UTRs
const utrCount = {};
DUMMY_USERS.forEach(u => { if (u.utr_id) utrCount[u.utr_id] = (utrCount[u.utr_id]||0)+1; });

const insert = db.prepare(`
  INSERT OR IGNORE INTO users (name, email, phone, registration_id, utr_id, verification_status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let inserted = 0;
const tx = db.transaction(() => {
  for (const u of DUMMY_USERS) {
    const status = u.utr_id && utrCount[u.utr_id] > 1 ? "suspicious" : "pending";
    const info = insert.run(u.name, u.email, u.phone, u.registration_id, u.utr_id, status);
    if (info.changes) inserted++;
  }
});

tx();
console.log(`\n✅  Seeded ${inserted} dummy users`);
console.log(`   Duplicate UTR pair: DUPUTR99999999 (Ravi Desai & Sonia Kapoor)`);
console.log(`   Login as admin to approve and generate tickets.\n`);
