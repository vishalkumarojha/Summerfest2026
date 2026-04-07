"use strict";
const express  = require("express");
const { supabase }    = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generateAndSendTicket } = require("../services/ticketService");
const { sendTicketEmail }       = require("../services/emailService");

const router = express.Router();

// ── POST /api/tickets/generate ───────────────────────────────
router.post("/generate", requireAuth, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });
  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  try {
    const ticket = await generateAndSendTicket(user_id);
    res.json({ message: "Ticket generated", ticket });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/tickets ─────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 50;
  const from  = (page - 1) * limit;

  const { data: tickets, count } = await supabase
    .from("tickets")
    .select("*, users(name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  res.json({ tickets: tickets || [], total: count || 0, page, limit });
});

// ── GET /api/tickets/:id ─────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const { data: t } = await supabase
    .from("tickets")
    .select("*, users(name, email, phone)")
    .or(`id.eq.${req.params.id},ticket_uuid.eq.${req.params.id}`)
    .single();
  if (!t) return res.status(404).json({ error: "Ticket not found" });
  res.json(t);
});

// ── POST /api/tickets/resend ─────────────────────────────────
router.post("/resend", requireAuth, async (req, res) => {
  const { ticket_id } = req.body;
  if (!ticket_id) return res.status(400).json({ error: "ticket_id required" });
  const { data: t } = await supabase
    .from("tickets").select("*").or(`id.eq.${ticket_id},ticket_uuid.eq.${ticket_id}`).single();
  if (!t) return res.status(404).json({ error: "Ticket not found" });
  const { data: user } = await supabase.from("users").select("*").eq("id", t.user_id).single();
  try {
    await sendTicketEmail(user, t);
    res.json({ message: "Email resent to " + user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/tickets/:uuid/download ──────────────────────────
// Returns a redirect to a Supabase Storage signed URL (60-min expiry)
router.get("/:uuid/download", async (req, res) => {
  const { data: t } = await supabase
    .from("tickets").select("pdf_path").eq("ticket_uuid", req.params.uuid).single();
  if (!t?.pdf_path) return res.status(404).json({ error: "PDF not found" });

  // pdf_path is now a Storage object path like "SF26-XXXX.pdf"
  const { data, error } = await supabase.storage
    .from("tickets")
    .createSignedUrl(t.pdf_path, 3600);

  if (error) return res.status(500).json({ error: error.message });
  res.redirect(data.signedUrl);
});

module.exports = router;
