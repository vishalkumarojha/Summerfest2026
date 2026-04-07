"use strict";
const express = require("express");
const jwt     = require("jsonwebtoken");
const { supabase }              = require("../db");
const { requireScannerOrAdmin } = require("../middleware/auth");

const router = express.Router();

// ── GET /api/verify/:token ────────────────────────────────────
router.get("/verify/:token", requireScannerOrAdmin, async (req, res) => {
  let ticketUuid = null;

  try {
    const payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
    ticketUuid = payload.ticket_uuid;
  } catch (e) {
    if (/^SF26-[A-Z0-9]+$/i.test(req.params.token)) {
      ticketUuid = req.params.token;
    } else {
      await logScan(null, req.params.token.slice(0, 50), "INVALID", req.admin.username, "JWT verification failed");
      return res.json({ status: "INVALID", message: "Invalid or tampered QR code" });
    }
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*, users(name, email, phone)")
    .eq("ticket_uuid", ticketUuid)
    .single();

  if (!ticket) {
    await logScan(null, ticketUuid, "INVALID", req.admin.username, "Ticket not found in DB");
    return res.json({ status: "INVALID", message: "Ticket not found" });
  }

  if (ticket.is_used) {
    return res.json({
      status:      "ALREADY_USED",
      message:     "This ticket has already been used",
      name:        ticket.users?.name,
      ticket_uuid: ticket.ticket_uuid,
      used_at:     ticket.used_at,
    });
  }

  res.json({
    status:      "VALID",
    message:     "Ticket is valid",
    name:        ticket.users?.name,
    email:       ticket.users?.email,
    ticket_uuid: ticket.ticket_uuid,
    ticket_id:   ticket.id,
  });
});

// ── POST /api/check-in/:ticket_id ────────────────────────────
// Uses Postgres stored procedure do_checkin() for atomic race-safe check-in
router.post("/check-in/:ticket_id", requireScannerOrAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("do_checkin", {
      p_uuid:       req.params.ticket_id,
      p_scanned_by: req.admin.username,
    });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error("Check-in error:", e);
    res.status(500).json({ status: "ERROR", message: "Server error during check-in" });
  }
});

// ── GET /api/search-ticket?q= ────────────────────────────────
router.get("/search-ticket", requireScannerOrAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Query required" });

  const { data: results } = await supabase
    .from("tickets")
    .select("ticket_uuid, is_used, used_at, users(name, email, phone)")
    .or(`users.name.ilike.%${q}%,users.email.eq.${q},ticket_uuid.eq.${q}`)
    .limit(5);

  res.json({ results: (results || []).map(t => ({
    ticket_uuid: t.ticket_uuid,
    is_used:     t.is_used,
    used_at:     t.used_at,
    name:        t.users?.name,
    email:       t.users?.email,
    phone:       t.users?.phone,
  }))});
});

// ── helper ────────────────────────────────────────────────────
async function logScan(ticketId, uuid, status, scannedBy, notes) {
  try {
    await supabase.from("scan_logs").insert({ ticket_id: ticketId, ticket_uuid: uuid, status, scanned_by: scannedBy, notes });
  } catch (_) {}
}

module.exports = router;
