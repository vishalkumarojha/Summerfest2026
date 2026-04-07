"use strict";
const { v4: uuidv4 } = require("uuid");
const jwt            = require("jsonwebtoken");
const { supabase }   = require("../db");
const { generateTicketPDF } = require("./pdfGenerator");
const { sendTicketEmail }   = require("./emailService");

/**
 * Master function: generate ticket + PDF + send email for a user.
 * Idempotent: if ticket already exists, resends email.
 */
async function generateAndSendTicket(userId) {
  const { data: user } = await supabase.from("users").select("*").eq("id", userId).single();
  if (!user) throw new Error("User not found: " + userId);

  // Idempotency – don't double-issue
  const { data: existing } = await supabase.from("tickets").select("*").eq("user_id", userId).single();
  if (existing?.pdf_path) {
    await sendTicketEmail(user, existing);
    return existing;
  }

  // 1. Generate unique ticket UUID
  const shortId     = uuidv4().split("-")[0].toUpperCase();
  const ticket_uuid = `SF26-${shortId}`;

  // 2. Sign QR payload
  const qr_token = jwt.sign(
    { ticket_uuid, user_id: userId, name: user.name, email: user.email, event: "SF26", iss: "summerfest-ticketing" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  // 3. Insert ticket record
  const { data: ticket, error: insertErr } = await supabase
    .from("tickets")
    .insert({ user_id: userId, ticket_uuid, qr_token })
    .select()
    .single();
  if (insertErr) throw new Error("Ticket insert failed: " + insertErr.message);

  // 4. Update user.ticket_id
  await supabase.from("users").update({ ticket_id: ticket.id }).eq("id", userId);

  // 5. Generate PDF → upload to Supabase Storage
  const pdfPath = await generateTicketPDF(user, ticket);  // returns storage path
  await supabase.from("tickets").update({ pdf_path: pdfPath }).eq("id", ticket.id);
  ticket.pdf_path = pdfPath;

  // 6. Send email
  await sendTicketEmail(user, ticket);

  return ticket;
}

module.exports = { generateAndSendTicket };
