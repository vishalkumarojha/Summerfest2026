"use strict";
const express  = require("express");
const multer   = require("multer");
const path     = require("path");
const { supabase }    = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generateAndSendTicket } = require("../services/ticketService");

const router = express.Router();

// ── Multer: buffer in memory, upload to Supabase Storage ──────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

async function uploadScreenshot(file) {
  // Screenshot upload disabled per user request to save on storage/API calls
  return null;
}

// ── GET /api/users ────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const status = req.query.status || null;
  const search = (req.query.search || "").trim();
  const page   = parseInt(req.query.page)  || 1;
  const limit  = parseInt(req.query.limit) || 50;
  const from   = (page - 1) * limit;

  let q = supabase
    .from("users")
    .select("*, tickets(ticket_uuid, is_used, used_at, id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (status) q = q.eq("verification_status", status);
  if (search) q = q.or(
    `name.ilike.%${search}%,email.ilike.%${search}%,utr_id.ilike.%${search}%,registration_id.ilike.%${search}%`
  );

  const { data: users, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Flag duplicate UTRs
  const { data: dupeUTRs } = await supabase.rpc("get_duplicate_utrs");
  const utrMap = {};
  (dupeUTRs || []).forEach(r => { utrMap[r.utr_id] = true; });

  const enriched = (users || []).map(u => ({
    ...u,
    ticket_uuid: u.tickets?.[0]?.ticket_uuid || null,
    is_used:     u.tickets?.[0]?.is_used     || false,
    used_at:     u.tickets?.[0]?.used_at     || null,
    t_id:        u.tickets?.[0]?.id          || null,
    duplicate_utr: !!utrMap[u.utr_id],
  }));

  res.json({ users: enriched, total: count || 0, page, limit });
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("*, tickets(ticket_uuid, is_used, used_at, qr_token, pdf_path)")
    .eq("id", req.params.id)
    .single();
  if (error || !user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// ── POST /api/users – create single user ─────────────────────
router.post("/", requireAuth, upload.single("screenshot"), async (req, res) => {
  const { name, email, phone, registration_id, utr_id } = req.body;
  if (!name || !email) return res.status(400).json({ error: "name and email required" });

  let screenshot_url = null;
  try { screenshot_url = await uploadScreenshot(req.file); } catch (e) { /* ignore */ }

  // Check duplicate UTR
  let status = "pending";
  if (utr_id) {
    const { data: existing } = await supabase
      .from("users").select("id").eq("utr_id", utr_id).neq("email", email).single();
    if (existing) status = "suspicious";
  }

  const { data, error } = await supabase
    .from("users")
    .insert({ name, email, phone: phone||null, registration_id: registration_id||null,
              utr_id: utr_id||null, screenshot_url, verification_status: status })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Email already registered" });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ id: data.id, status });
});

// ── PATCH /api/users/:id/approve ─────────────────────────────
router.patch("/:id/approve", requireAuth, async (req, res) => {
  const { data: user } = await supabase.from("users").select("*").eq("id", req.params.id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.verification_status === "approved" && user.ticket_id)
    return res.status(409).json({ error: "Already approved and ticket issued" });

  await supabase.from("users").update({ verification_status: "approved", updated_at: new Date().toISOString() }).eq("id", user.id);
  try {
    const ticket = await generateAndSendTicket(user.id);
    res.json({ message: "Approved and ticket sent", ticket_uuid: ticket.ticket_uuid });
  } catch (e) {
    res.status(500).json({ error: "Approved but ticket generation failed: " + e.message });
  }
});

// ── PATCH /api/users/:id/reject ──────────────────────────────
router.patch("/:id/reject", requireAuth, async (req, res) => {
  const { error } = await supabase.from("users")
    .update({ verification_status: "rejected", notes: req.body.reason||null, updated_at: new Date().toISOString() })
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "User rejected" });
});

// ── PATCH /api/users/:id/suspicious ─────────────────────────
router.patch("/:id/suspicious", requireAuth, async (req, res) => {
  await supabase.from("users")
    .update({ verification_status: "suspicious", notes: req.body.reason||null, updated_at: new Date().toISOString() })
    .eq("id", req.params.id);
  res.json({ message: "Marked suspicious" });
});

// ── POST /api/users/bulk-approve ─────────────────────────────
router.post("/bulk-approve", requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "ids array required" });

  const results = [];
  for (const id of ids) {
    try {
      const { data: user } = await supabase.from("users").select("*").eq("id", id).eq("verification_status", "pending").single();
      if (!user) { results.push({ id, status: "skipped" }); continue; }
      await supabase.from("users").update({ verification_status: "approved", updated_at: new Date().toISOString() }).eq("id", id);
      const ticket = await generateAndSendTicket(id);
      results.push({ id, status: "approved", ticket_uuid: ticket.ticket_uuid });
    } catch (e) {
      results.push({ id, status: "error", error: e.message });
    }
  }
  res.json({ results });
});

// ── POST /api/users/:id/screenshot ───────────────────────────
router.post("/:id/screenshot", requireAuth, upload.single("screenshot"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const url = await uploadScreenshot(req.file);
    await supabase.from("users").update({ screenshot_url: url, updated_at: new Date().toISOString() }).eq("id", req.params.id);
    res.json({ screenshot_url: url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/users/:id ────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("users").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "User deleted successfully" });
});

module.exports = router;
