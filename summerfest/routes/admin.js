"use strict";
const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/admin/login
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const db   = getDB();
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!admin) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = bcrypt.compareSync(password, admin.password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({ token, username: admin.username });
});

// GET /api/admin/stats  – dashboard summary
router.get("/stats", requireAuth, (req, res) => {
  const db = getDB();

  const total     = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const approved  = db.prepare("SELECT COUNT(*) AS n FROM users WHERE verification_status='approved'").get().n;
  const pending   = db.prepare("SELECT COUNT(*) AS n FROM users WHERE verification_status='pending'").get().n;
  const rejected  = db.prepare("SELECT COUNT(*) AS n FROM users WHERE verification_status='rejected'").get().n;
  const suspicious = db.prepare("SELECT COUNT(*) AS n FROM users WHERE verification_status='suspicious'").get().n;
  const tickets   = db.prepare("SELECT COUNT(*) AS n FROM tickets").get().n;
  const checkedIn = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE is_used=1").get().n;

  res.json({ total, approved, pending, rejected, suspicious, tickets, checkedIn });
});

// GET /api/admin/export/users – CSV export
router.get("/export/users", requireAuth, (req, res) => {
  const db    = getDB();
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.registration_id, u.utr_id,
           u.verification_status, t.ticket_uuid, t.is_used, t.used_at, u.created_at
    FROM users u
    LEFT JOIN tickets t ON t.user_id = u.id
    ORDER BY u.id
  `).all();

  const header = "ID,Name,Email,Phone,RegID,UTR,Status,TicketUUID,IsUsed,UsedAt,CreatedAt\n";
  const rows   = users.map(u =>
    [u.id, u.name, u.email, u.phone || "", u.registration_id || "",
     u.utr_id || "", u.verification_status, u.ticket_uuid || "",
     u.is_used || 0, u.used_at || "", u.created_at]
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(",")
  ).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=summerfest_users.csv");
  res.send(header + rows);
});

// GET /api/admin/export/checkins – checked-in users CSV
router.get("/export/checkins", requireAuth, (req, res) => {
  const db   = getDB();
  const logs = db.prepare(`
    SELECT l.id, t.ticket_uuid, u.name, u.email, l.scan_time, l.status, l.scanned_by
    FROM scan_logs l
    JOIN tickets t ON t.id = l.ticket_id
    JOIN users   u ON u.id = t.user_id
    ORDER BY l.scan_time DESC
  `).all();

  const header = "LogID,TicketUUID,Name,Email,ScanTime,Status,ScannedBy\n";
  const rows   = logs.map(l =>
    [l.id, l.ticket_uuid, l.name, l.email, l.scan_time, l.status, l.scanned_by || ""]
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(",")
  ).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=summerfest_checkins.csv");
  res.send(header + rows);
});

// GET /api/admin/logs – scan logs with pagination
router.get("/logs", requireAuth, (req, res) => {
  const db    = getDB();
  const page  = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const logs = db.prepare(`
    SELECT l.id, l.ticket_uuid, u.name, u.email, l.scan_time, l.status, l.scanned_by, l.notes
    FROM scan_logs l
    LEFT JOIN tickets t ON t.id = l.ticket_id
    LEFT JOIN users   u ON u.id = t.user_id
    ORDER BY l.scan_time DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare("SELECT COUNT(*) AS n FROM scan_logs").get().n;
  res.json({ logs, total, page, limit });
});

module.exports = router;
