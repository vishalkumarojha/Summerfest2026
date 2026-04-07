"use strict";
const express   = require("express");
const path      = require("path");
const fs        = require("fs");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generateAndSendTicket } = require("../services/ticketService");
const { sendTicketEmail } = require("../services/emailService");

const router = express.Router();

// POST /api/tickets/generate – manually trigger for a user
router.post("/generate", requireAuth, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const db   = getDB();
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(user_id);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const ticket = await generateAndSendTicket(user_id);
    res.json({ message: "Ticket generated", ticket });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tickets – list all tickets (admin)
router.get("/", requireAuth, (req, res) => {
  const db    = getDB();
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const tickets = db.prepare(`
    SELECT t.*, u.name, u.email
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare("SELECT COUNT(*) AS n FROM tickets").get().n;
  res.json({ tickets, total, page, limit });
});

// GET /api/tickets/:id – single ticket (admin)
router.get("/:id", requireAuth, (req, res) => {
  const db = getDB();
  const t  = db.prepare(`
    SELECT t.*, u.name, u.email, u.phone
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.id = ? OR t.ticket_uuid = ?
  `).get(req.params.id, req.params.id);

  if (!t) return res.status(404).json({ error: "Ticket not found" });
  res.json(t);
});

// POST /api/tickets/resend – resend email with PDF
router.post("/resend", requireAuth, async (req, res) => {
  const { ticket_id } = req.body;
  if (!ticket_id) return res.status(400).json({ error: "ticket_id required" });

  const db   = getDB();
  const t    = db.prepare("SELECT * FROM tickets WHERE id=? OR ticket_uuid=?").get(ticket_id, ticket_id);
  if (!t)    return res.status(404).json({ error: "Ticket not found" });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(t.user_id);

  try {
    await sendTicketEmail(user, t);
    res.json({ message: "Email resent to " + user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tickets/:uuid/download – stream PDF by public ticket UUID
router.get("/:uuid/download", (req, res) => {
  const db = getDB();
  const t  = db.prepare("SELECT pdf_path FROM tickets WHERE ticket_uuid=?").get(req.params.uuid);
  if (!t || !t.pdf_path) return res.status(404).json({ error: "PDF not found" });

  const abs = path.resolve(t.pdf_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "PDF file missing" });

  res.download(abs, `SF26_${req.params.uuid}.pdf`);
});

module.exports = router;
