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
    // Fall back: if the token looks like a ticket UUID, use it directly
    if (/^SF26-[A-Z0-9]+$/i.test(req.params.token)) {
      ticketUuid = req.params.token.toUpperCase();
    } else {
      await logScan(null, (req.params.token || "").slice(0, 50), "INVALID", req.admin?.username, "JWT verification failed: " + e.message);
      return res.json({ status: "INVALID", message: "Invalid or tampered QR code" });
    }
  }

  try {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("*, users(name, email, phone)")
      .eq("ticket_uuid", ticketUuid)
      .single();

    if (error || !ticket) {
      await logScan(null, ticketUuid, "INVALID", req.admin?.username, "Ticket not found in DB");
      return res.json({ status: "INVALID", message: "Ticket not found" });
    }

    if (ticket.is_used) {
      return res.json({
        status:      "ALREADY_USED",
        message:     "This ticket has already been used",
        name:        ticket.users?.name,
        email:       ticket.users?.email,
        ticket_uuid: ticket.ticket_uuid,
        used_at:     ticket.used_at,
        scanned_by:  ticket.scanned_by,
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
  } catch (e) {
    console.error("Verify error:", e.message);
    res.status(500).json({ status: "ERROR", message: "Server error during verification" });
  }
});

// ── POST /api/check-in/:ticket_id ────────────────────────────
// Directly marks ticket as used + logs the scan (no RPC dependency)
router.post("/check-in/:ticket_id", requireScannerOrAdmin, async (req, res) => {
  const ticketIdentifier = req.params.ticket_id;
  const scannedBy = req.admin?.username || "unknown";

  try {
    // Look up the ticket by UUID or ID
    let query = supabase.from("tickets").select("*, users(name, email)");
    if (/^SF26-/i.test(ticketIdentifier)) {
      query = query.eq("ticket_uuid", ticketIdentifier.toUpperCase());
    } else {
      query = query.or(`id.eq.${ticketIdentifier},ticket_uuid.eq.${ticketIdentifier}`);
    }
    const { data: ticket, error: fetchErr } = await query.single();

    if (fetchErr || !ticket) {
      await logScan(null, ticketIdentifier, "INVALID", scannedBy, "Ticket not found");
      return res.json({ status: "INVALID", message: "Ticket not found" });
    }

    // Already used?
    if (ticket.is_used) {
      await logScan(ticket.id, ticket.ticket_uuid, "ALREADY_USED", scannedBy, `Previously used at ${ticket.used_at}`);
      return res.json({
        status:      "ALREADY_USED",
        message:     "This ticket has already been used",
        name:        ticket.users?.name,
        ticket_uuid: ticket.ticket_uuid,
        used_at:     ticket.used_at,
        scanned_by:  ticket.scanned_by,
      });
    }

    // Mark as used
    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("tickets")
      .update({ is_used: true, used_at: now, scanned_by: scannedBy })
      .eq("id", ticket.id)
      .eq("is_used", false);  // optimistic lock — prevents race condition

    if (updateErr) {
      console.error("Check-in update error:", updateErr.message);
      return res.status(500).json({ status: "ERROR", message: "Failed to mark ticket as used" });
    }

    // Log successful check-in
    await logScan(ticket.id, ticket.ticket_uuid, "VALID", scannedBy, "Check-in successful");

    console.log(`🎟 CHECK-IN: ${ticket.ticket_uuid} | ${ticket.users?.name} | by ${scannedBy}`);

    res.json({
      status:      "VALID",
      message:     "Check-in successful",
      name:        ticket.users?.name,
      email:       ticket.users?.email,
      ticket_uuid: ticket.ticket_uuid,
      used_at:     now,
      scanned_by:  scannedBy,
    });
  } catch (e) {
    console.error("Check-in error:", e);
    res.status(500).json({ status: "ERROR", message: "Server error during check-in" });
  }
});

// ── GET /api/search-ticket?q= ────────────────────────────────
router.get("/search-ticket", requireScannerOrAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Query required" });

  try {
    let ticketResults = [];

    // 1. Direct ticket UUID match
    if (/^SF26-/i.test(q)) {
      const { data } = await supabase
        .from("tickets")
        .select("ticket_uuid, is_used, used_at, users(name, email, phone)")
        .ilike("ticket_uuid", `%${q}%`)
        .limit(10);
      if (data) ticketResults = data;
    }

    // 2. Search users by name, email, phone, or registration_id
    if (ticketResults.length === 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, name, email, phone, registration_id, verification_status, tickets(ticket_uuid, is_used, used_at)")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,registration_id.ilike.%${q}%`)
        .limit(10);

      if (users) {
        ticketResults = users
          .filter(u => u.tickets && u.tickets.length > 0)
          .map(u => ({
            ticket_uuid: u.tickets[0].ticket_uuid,
            is_used:     u.tickets[0].is_used,
            used_at:     u.tickets[0].used_at,
            users:       { name: u.name, email: u.email, phone: u.phone },
          }));
      }
    }

    res.json({
      results: ticketResults.map(t => ({
        ticket_uuid: t.ticket_uuid,
        is_used:     t.is_used,
        used_at:     t.used_at,
        name:        t.users?.name  || "",
        email:       t.users?.email || "",
        phone:       t.users?.phone || "",
      }))
    });
  } catch (e) {
    console.error("search-ticket error:", e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── helper ────────────────────────────────────────────────────
async function logScan(ticketId, uuid, status, scannedBy, notes) {
  try {
    await supabase.from("scan_logs").insert({
      ticket_id:  ticketId,
      ticket_uuid: uuid,
      status,
      scanned_by: scannedBy || "unknown",
      notes,
      scan_time: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log scan:", e.message);
  }
}

module.exports = router;

