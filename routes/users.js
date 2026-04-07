"use strict";
const express   = require("express");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const { getDB } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generateAndSendTicket } = require("../services/ticketService");

const router = express.Router();

// ── Multer config for screenshots ────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `ss_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ── GET /api/users – list with search & filter ───────────────
router.get("/", requireAuth, (req, res) => {
  const db      = getDB();
  const status  = req.query.status  || null;
  const search  = req.query.search  || "";
  const page    = parseInt(req.query.page)  || 1;
  const limit   = parseInt(req.query.limit) || 50;
  const offset  = (page - 1) * limit;

  let where  = "1=1";
  const params = [];

  if (status) { where += " AND u.verification_status = ?"; params.push(status); }
  if (search) {
    where += " AND (u.name LIKE ? OR u.email LIKE ? OR u.utr_id LIKE ? OR u.registration_id LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const users = db.prepare(`
    SELECT u.*, t.ticket_uuid, t.is_used, t.used_at, t.id AS t_id
    FROM users u
    LEFT JOIN tickets t ON t.user_id = u.id
    WHERE ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).get(...params).n;

  // Flag duplicate UTRs inline
  const utrMap = {};
  const allUTRs = db.prepare("SELECT utr_id, COUNT(*) AS cnt FROM users WHERE utr_id IS NOT NULL GROUP BY utr_id HAVING cnt > 1").all();
  allUTRs.forEach(r => { utrMap[r.utr_id] = true; });

  const enriched = users.map(u => ({ ...u, duplicate_utr: !!utrMap[u.utr_id] }));

  res.json({ users: enriched, total, page, limit });
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get("/:id", requireAuth, (req, res) => {
  const db   = getDB();
  const user = db.prepare(`
    SELECT u.*, t.ticket_uuid, t.is_used, t.used_at, t.qr_token, t.pdf_path
    FROM users u LEFT JOIN tickets t ON t.user_id = u.id
    WHERE u.id = ?
  `).get(req.params.id);

  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// ── POST /api/users – create / import single user ─────────────
router.post("/", requireAuth, upload.single("screenshot"), (req, res) => {
  const db = getDB();
  const { name, email, phone, registration_id, utr_id } = req.body;

  if (!name || !email) return res.status(400).json({ error: "name and email required" });

  const screenshot_url = req.file ? `/uploads/${req.file.filename}` : null;

  // Check duplicate UTR
  let status = "pending";
  if (utr_id) {
    const existing = db.prepare("SELECT id FROM users WHERE utr_id = ? AND email != ?").get(utr_id, email);
    if (existing) status = "suspicious";
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO users (name, email, phone, registration_id, utr_id, screenshot_url, verification_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name, email, phone || null, registration_id || null, utr_id || null, screenshot_url, status);
    res.status(201).json({ id: info.lastInsertRowid, status });
  } catch (e) {
    if (e.message.includes("UNIQUE")) return res.status(409).json({ error: "Email already registered" });
    throw e;
  }
});

// ── PATCH /api/users/:id/approve ─────────────────────────────
router.patch("/:id/approve", requireAuth, async (req, res) => {
  const db   = getDB();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.verification_status === "approved" && user.ticket_id) {
    return res.status(409).json({ error: "Already approved and ticket issued" });
  }

  db.prepare("UPDATE users SET verification_status='approved', updated_at=datetime('now') WHERE id=?").run(user.id);

  try {
    const ticket = await generateAndSendTicket(user.id);
    res.json({ message: "Approved and ticket sent", ticket_uuid: ticket.ticket_uuid });
  } catch (e) {
    console.error("Ticket generation failed:", e);
    res.status(500).json({ error: "Approved but ticket generation failed: " + e.message });
  }
});

// ── PATCH /api/users/:id/reject ──────────────────────────────
router.patch("/:id/reject", requireAuth, (req, res) => {
  const db   = getDB();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  db.prepare("UPDATE users SET verification_status='rejected', notes=?, updated_at=datetime('now') WHERE id=?")
    .run(req.body.reason || null, req.params.id);

  res.json({ message: "User rejected" });
});

// ── PATCH /api/users/:id/suspicious ─────────────────────────
router.patch("/:id/suspicious", requireAuth, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE users SET verification_status='suspicious', notes=?, updated_at=datetime('now') WHERE id=?")
    .run(req.body.reason || null, req.params.id);
  res.json({ message: "Marked suspicious" });
});

// ── PATCH /api/users/bulk-approve ────────────────────────────
router.post("/bulk-approve", requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array required" });
  }

  const results = [];
  for (const id of ids) {
    try {
      const db   = getDB();
      const user = db.prepare("SELECT * FROM users WHERE id=? AND verification_status='pending'").get(id);
      if (!user) { results.push({ id, status: "skipped" }); continue; }

      db.prepare("UPDATE users SET verification_status='approved', updated_at=datetime('now') WHERE id=?").run(id);
      const ticket = await generateAndSendTicket(id);
      results.push({ id, status: "approved", ticket_uuid: ticket.ticket_uuid });
    } catch (e) {
      results.push({ id, status: "error", error: e.message });
    }
  }

  res.json({ results });
});

// ── POST /api/users/:id/screenshot – upload / replace screenshot
router.post("/:id/screenshot", requireAuth, upload.single("screenshot"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const db  = getDB();
  const url = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE users SET screenshot_url=?, updated_at=datetime('now') WHERE id=?").run(url, req.params.id);
  res.json({ screenshot_url: url });
});

module.exports = router;
