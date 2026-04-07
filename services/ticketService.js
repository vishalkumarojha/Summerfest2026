"use strict";
const { v4: uuidv4 } = require("uuid");
const jwt            = require("jsonwebtoken");
const { getDB }      = require("../db");
const { generateTicketPDF } = require("./pdfGenerator");
const { sendTicketEmail }   = require("./emailService");

/**
 * Master function: generate ticket + PDF + send email for a user.
 * Idempotent: if ticket already exists, returns existing one.
 */
async function generateAndSendTicket(userId) {
  const db   = getDB();
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  if (!user) throw new Error("User not found: " + userId);

  // Idempotency – don't double-issue
  const existing = db.prepare("SELECT * FROM tickets WHERE user_id=?").get(userId);
  if (existing && existing.pdf_path) {
    await sendTicketEmail(user, existing);
    return existing;
  }

  // ── 1. Generate unique human-readable Ticket UUID ─────────
  const shortId     = uuidv4().split("-")[0].toUpperCase();   // e.g. A3F7C2B1
  const ticket_uuid = `SF26-${shortId}`;

  // ── 2. Sign QR payload with JWT ──────────────────────────
  const qr_token = jwt.sign(
    {
      ticket_uuid,
      user_id:  userId,
      name:     user.name,
      email:    user.email,
      event:    "SF26",
      iss:      "summerfest-ticketing",
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }                // long enough for event
  );

  // ── 3. Insert ticket record ───────────────────────────────
  const info = db.prepare(`
    INSERT INTO tickets (user_id, ticket_uuid, qr_token)
    VALUES (?, ?, ?)
  `).run(userId, ticket_uuid, qr_token);

  const ticketId = info.lastInsertRowid;
  db.prepare("UPDATE users SET ticket_id=? WHERE id=?").run(ticketId, userId);

  const ticket = db.prepare("SELECT * FROM tickets WHERE id=?").get(ticketId);

  // ── 4. Generate PDF ───────────────────────────────────────
  const pdfPath = await generateTicketPDF(user, ticket);
  db.prepare("UPDATE tickets SET pdf_path=? WHERE id=?").run(pdfPath, ticketId);
  ticket.pdf_path = pdfPath;

  // ── 5. Send email ─────────────────────────────────────────
  await sendTicketEmail(user, ticket);

  return ticket;
}

module.exports = { generateAndSendTicket };
