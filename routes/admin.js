"use strict";
const express  = require("express");
const bcrypt   = require("bcryptjs");
const fs       = require("fs");
const multer   = require("multer");
const jwt      = require("jsonwebtoken");
const { supabase }    = require("../db");
const { requireAuth } = require("../middleware/auth");
const { importCsvFile } = require("../services/csvSyncService");

const uploadCSV = multer({ dest: "/tmp/" });
const router    = express.Router();

// ─── POST /api/admin/login ────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    // Try admins first, then scanners
    let role = "admin";
    let { data: user } = await supabase
      .from("admins").select("*").eq("username", username).single();

    if (!user) {
      role = "scanner";
      ({ data: user } = await supabase
        .from("scanners").select("*").eq("username", username).single());
    }

    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: role === "scanner" ? "2h" : "12h" }
    );
    res.json({ token, username: user.username, role, expiresIn: role === "scanner" ? "2h" : "12h" });
  } catch (error) {
    console.error("Login Route Error:", error);
    res.status(500).json({ error: error.message || "Internal server error during login" });
  }
});

// ─── GET /api/admin/stats ─────────────────────────────────────
router.get("/stats", requireAuth, async (req, res) => {
  const [
    { count: total },
    { count: approved },
    { count: pending },
    { count: rejected },
    { count: suspicious },
    { count: tickets },
    { count: checkedIn },
  ] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("verification_status", "approved"),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("verification_status", "pending"),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("verification_status", "rejected"),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("verification_status", "suspicious"),
    supabase.from("tickets").select("*", { count: "exact", head: true }),
    supabase.from("tickets").select("*", { count: "exact", head: true }).eq("is_used", true),
  ]);
  res.json({ total, approved, pending, rejected, suspicious, tickets, checkedIn });
});

// ─── GET /api/admin/export/users ─────────────────────────────
router.get("/export/users", requireAuth, async (req, res) => {
  const { data: users } = await supabase
    .from("users")
    .select("id, name, email, phone, registration_id, utr_id, verification_status, ticket_id, created_at, tickets(ticket_uuid, is_used, used_at)")
    .order("id");

  const header = "ID,Name,Email,Phone,RegID,UTR,Status,TicketUUID,IsUsed,UsedAt,CreatedAt\n";
  const rows   = (users || []).map(u => {
    const t = u.tickets?.[0] || {};
    return [u.id, u.name, u.email, u.phone||"", u.registration_id||"",
            u.utr_id||"", u.verification_status, t.ticket_uuid||"",
            t.is_used ? 1 : 0, t.used_at||"", u.created_at]
      .map(v => `"${String(v).replace(/"/g,'""')}"`)
      .join(",");
  }).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=summerfest_users.csv");
  res.send(header + rows);
});

// ─── GET /api/admin/export/checkins ──────────────────────────
router.get("/export/checkins", requireAuth, async (req, res) => {
  const { data: logs } = await supabase
    .from("scan_logs")
    .select("id, ticket_uuid, scan_time, status, scanned_by, tickets(ticket_uuid, users(name, email))")
    .order("scan_time", { ascending: false });

  const header = "LogID,TicketUUID,Name,Email,ScanTime,Status,ScannedBy\n";
  const rows   = (logs || []).map(l => {
    const u = l.tickets?.users || {};
    return [l.id, l.ticket_uuid, u.name||"", u.email||"", l.scan_time, l.status, l.scanned_by||""]
      .map(v => `"${String(v).replace(/"/g,'""')}"`)
      .join(",");
  }).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=summerfest_checkins.csv");
  res.send(header + rows);
});

// ─── GET /api/admin/logs ─────────────────────────────────────
router.get("/logs", requireAuth, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 50;
  const from  = (page - 1) * limit;

  const { data: logs, count } = await supabase
    .from("scan_logs")
    .select("id, ticket_uuid, scan_time, status, scanned_by, notes, tickets(users(name, email))", { count: "exact" })
    .order("scan_time", { ascending: false })
    .range(from, from + limit - 1);

  res.json({ logs: logs || [], total: count || 0, page, limit });
});

// ─── POST /api/admin/import/users ────────────────────────────
router.post("/import/users", requireAuth, uploadCSV.single("csv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const stats = await importCsvFile(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, stats });
  } catch (e) {
    if (fs.existsSync(req.file?.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
