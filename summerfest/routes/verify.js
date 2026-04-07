"use strict";
const express   = require("express");
const jwt       = require("jsonwebtoken");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/verify/:token
 * Used by scanner to check a QR code token BEFORE marking as used.
 * Returns status without consuming the ticket.
 */
router.get("/verify/:token", (req, res) => {
  const db = getDB();
  let payload;

  try {
    payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
  } catch (e) {
    logScan(db, null, req.params.token.slice(0, 50), "INVALID", req.ip, "JWT verification failed");
    return res.json({ status: "INVALID", message: "Invalid or tampered QR code" });
  }

  const ticket = db.prepare(`
    SELECT t.*, u.name, u.email, u.phone
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.ticket_uuid = ?
  `).get(payload.ticket_uuid);

  if (!ticket) {
    logScan(db, null, payload.ticket_uuid, "INVALID", req.ip, "Ticket not found in DB");
    return res.json({ status: "INVALID", message: "Ticket not found" });
  }

  if (ticket.is_used) {
    return res.json({
      status: "ALREADY_USED",
      message: "This ticket has already been used",
      name:    ticket.name,
      ticket_uuid: ticket.ticket_uuid,
      used_at: ticket.used_at,
    });
  }

  res.json({
    status:      "VALID",
    message:     "Ticket is valid",
    name:        ticket.name,
    email:       ticket.email,
    ticket_uuid: ticket.ticket_uuid,
    ticket_id:   ticket.id,
  });
});

/**
 * POST /api/check-in/:ticket_id
 * Atomically marks ticket as USED (one-time gate operation).
 * Accepts ticket UUID as :ticket_id.
 */
router.post("/check-in/:ticket_id", (req, res) => {
  const db = getDB();

  // Use a transaction to prevent race conditions with multiple scanners
  const checkIn = db.transaction((uuid) => {
    const ticket = db.prepare(`
      SELECT t.*, u.name, u.email
      FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.ticket_uuid = ?
    `).get(uuid);

    if (!ticket) {
      logScan(db, null, uuid, "INVALID", req.ip, "Ticket not found");
      return { status: "INVALID", message: "Ticket not found" };
    }

    if (ticket.is_used) {
      logScan(db, ticket.id, uuid, "ALREADY_USED", req.ip, "Already used at " + ticket.used_at);
      return {
        status:      "ALREADY_USED",
        message:     "Already used",
        name:        ticket.name,
        ticket_uuid: uuid,
        used_at:     ticket.used_at,
      };
    }

    // Mark as used
    db.prepare("UPDATE tickets SET is_used=1, used_at=datetime('now') WHERE id=?").run(ticket.id);
    logScan(db, ticket.id, uuid, "VALID", req.ip, "Checked in successfully");

    return {
      status:      "VALID",
      message:     "Entry granted ✓",
      name:        ticket.name,
      email:       ticket.email,
      ticket_uuid: uuid,
    };
  });

  try {
    const result = checkIn(req.params.ticket_id);
    res.json(result);
  } catch (e) {
    console.error("Check-in error:", e);
    res.status(500).json({ status: "ERROR", message: "Server error during check-in" });
  }
});

/**
 * GET /api/search-ticket?q=name_or_email_or_uuid
 * Manual lookup for entry gate (fallback if QR fails)
 */
router.get("/search-ticket", (req, res) => {
  const q  = (req.query.q || "").trim();
  if (!q)  return res.status(400).json({ error: "Query required" });

  const db = getDB();
  const results = db.prepare(`
    SELECT t.ticket_uuid, t.is_used, t.used_at, u.name, u.email, u.phone
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE u.name LIKE ? OR u.email = ? OR t.ticket_uuid = ?
    LIMIT 5
  `).all(`%${q}%`, q, q);

  res.json({ results });
});

// ── helper ────────────────────────────────────────────────────
function logScan(db, ticketId, uuid, status, ip, notes) {
  try {
    db.prepare(`
      INSERT INTO scan_logs (ticket_id, ticket_uuid, status, scanned_by, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(ticketId, uuid, status, ip, notes);
  } catch (_) {}
}

module.exports = router;
