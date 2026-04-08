#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { supabase } = require("../db");
const { batchSendEmails } = require("../services/emailService");

async function main() {
  console.log("🚀 Starting Mass Mailer Tool...\n");

  // Basic argument parsing
  const args = Object.fromEntries(
    process.argv.slice(2).map(arg => {
      const [key, val] = arg.split('=');
      return [key.replace(/^--/, ''), Number(val) || true];
    })
  );

  const chunkSize = args.chunk || 10;
  const limit = args.limit || Infinity;

  console.log(`📦 Configuration: Chunk Size = ${chunkSize}, Total Limit = ${limit === Infinity ? 'Unlimited' : limit}`);

  console.log("🔍 Fetching database for verified tickets...");
  const { data: users, error } = await supabase
    .from("users")
    .select("*, tickets(*), email_logs(*)")
    .eq("verification_status", "approved");

  if (error) {
    console.error("❌ Database Error:", error.message);
    process.exit(1);
  }

  const pendingPairs = [];

  for (const u of users) {
    if (!u.tickets || u.tickets.length === 0) continue; 
    const ticket = u.tickets[0];

    // Check if successful log already exists
    const hasSentLog = (u.email_logs || []).some(log => log.status === "sent" && log.ticket_id === ticket.id);
    if (hasSentLog) continue;

    // Reject if no PDF is linked
    if (!ticket.pdf_path) continue;

    pendingPairs.push({ user: u, ticket: ticket });
  }

  console.log(`🎯 Found ${pendingPairs.length} students who possess a PDF but haven't been emailed yet.`);
  
  if (pendingPairs.length === 0) {
    console.log("✅ All caught up. No emails to send.");
    process.exit(0);
  }

  const targets = pendingPairs.slice(0, limit);
  console.log(`⏳ Commencing robust delivery for ${targets.length} students...`);
  console.log(`⚠️  Press CTRL+C anytime to stop. All sent logs are saved dynamically.\n`);

  // Run the batch pace algorithm
  await batchSendEmails(targets, { chunkSize, delayMs: 2000 });

  console.log("\n🎉 Mass Mailing Sequence Completed!");
  process.exit(0);
}

main().catch(e => {
  console.error("Fatal Error:", e);
  process.exit(1);
});
