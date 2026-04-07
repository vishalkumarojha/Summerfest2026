"use strict";
const nodemailer = require("nodemailer");
const fs         = require("fs");
const path       = require("path");
const { getDB }  = require("../db");

let _transport = null;

function getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,          // connection pool
      maxConnections: 5,
      rateDelta: 1000,     // 1 message per second per connection
      rateLimit: 5,        // max 5 messages/s total
    });
  }
  return _transport;
}

/**
 * Send ticket email to a single user with PDF attachment.
 * Retries up to 3 times on failure.
 */
async function sendTicketEmail(user, ticket, retries = 3) {
  const db       = getDB();
  const pdfPath  = ticket.pdf_path;

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error("PDF file not found: " + pdfPath);
  }

  const ev = {
    name:  process.env.EVENT_NAME  || "Summer Fest 2026",
    date:  process.env.EVENT_DATE  || "8th April 2026",
    time:  process.env.EVENT_TIME  || "6:00 PM – 10:00 PM",
    venue: process.env.EVENT_VENUE || "Cricket Ground, VIT Bhopal",
  };

  const mailOptions = {
    from:    process.env.EMAIL_FROM || `"${ev.name}" <${process.env.SMTP_USER}>`,
    to:      user.email,
    subject: `🎉 Your Ticket for ${ev.name} | ${ticket.ticket_uuid}`,
    html:    buildEmailHTML(user, ticket, ev),
    attachments: [
      {
        filename: `SummerFest2026_${ticket.ticket_uuid}.pdf`,
        path:     pdfPath,
        contentType: "application/pdf",
      },
    ],
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await getTransport().sendMail(mailOptions);
      logEmail(db, user.id, ticket.id, "sent", null);
      console.log(`✉️  Email sent to ${user.email} [${info.messageId}]`);
      return info;
    } catch (e) {
      console.error(`Email attempt ${attempt} failed for ${user.email}:`, e.message);
      if (attempt === retries) {
        logEmail(db, user.id, ticket.id, "failed", e.message);
        throw e;
      }
      // Exponential backoff
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

/**
 * Batch-send emails with rate limiting (for bulk operations).
 * Processes in chunks with delay between chunks.
 */
async function batchSendEmails(userTicketPairs, { chunkSize = 10, delayMs = 2000 } = {}) {
  const results = [];

  for (let i = 0; i < userTicketPairs.length; i += chunkSize) {
    const chunk = userTicketPairs.slice(i, i + chunkSize);
    const promises = chunk.map(({ user, ticket }) =>
      sendTicketEmail(user, ticket).then(() => ({ email: user.email, status: "sent" }))
        .catch(e => ({ email: user.email, status: "failed", error: e.message }))
    );
    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
    console.log(`📧 Batch ${Math.floor(i / chunkSize) + 1}: sent ${chunkResults.filter(r => r.status === "sent").length}/${chunk.length}`);

    if (i + chunkSize < userTicketPairs.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

// ── HTML email template ──────────────────────────────────────
function buildEmailHTML(user, ticket, ev) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a0533,#7c3aed);padding:40px 40px 30px;text-align:center;">
            <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,215,0,0.8);">VIT Bhopal Presents</p>
            <h1 style="margin:8px 0 0;font-size:36px;font-weight:900;color:#fff;letter-spacing:-0.5px;">${ev.name}</h1>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.7);">Bolly-Tech Experience · International DJ · Dance Performances</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="font-size:18px;font-weight:700;color:#1a0533;margin:0 0 8px;">Hey ${escapeHTML(user.name.split(" ")[0])}! 🎉</p>
            <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
              Your ticket is confirmed! Find your <strong>official entry pass</strong> attached to this email as a PDF. 
              Present the QR code at the entry gate for quick check-in.
            </p>

            <!-- Event card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7ff;border:1px solid #e8e0ff;border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="50%" style="padding-bottom:12px;">
                        <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7c3aed;">📅 Date</p>
                        <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1a0533;white-space:nowrap;">${ev.date}</p>
                      </td>
                      <td width="50%" style="padding-bottom:12px;">
                        <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7c3aed;">🕕 Time</p>
                        <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1a0533;white-space:nowrap;">${ev.time}</p>
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2">
                        <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7c3aed;">📍 Venue</p>
                        <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1a0533;">${ev.venue}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Ticket ID -->
            <div style="text-align:center;background:linear-gradient(135deg,#1a0533,#4c1d95);border-radius:10px;padding:16px;margin-bottom:24px;">
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,215,0,0.7);">Your Ticket ID</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:900;color:#ffd700;font-family:monospace;letter-spacing:2px;">${ticket.ticket_uuid}</p>
            </div>

            <!-- Instructions -->
            <p style="font-size:13px;font-weight:700;color:#1a0533;margin:0 0 8px;">📋 Entry Instructions:</p>
            <ol style="font-size:13px;color:#555;line-height:1.8;padding-left:18px;margin:0 0 24px;">
              <li>Download the attached PDF ticket</li>
              <li>Show the <strong>QR code</strong> at the entry gate</li>
              <li>Each ticket allows <strong>one-time entry only</strong></li>
              <li>You must have university ID card</li>
              <li>Gates open at <strong>5:30 PM</strong></li>
            </ol>

            <p style="font-size:12px;color:#999;margin:0;border-top:1px solid #eee;padding-top:16px;">
              ⚠️ <strong>Do not share your QR code.</strong> Forwarded/screenshotted QR codes will be rejected.<br/><br/>
              For queries contact:<br/>
              Abhishek Kumar (General Secretary, Student Council) - 7541942222<br/>
              Arpan Aggarwal (Joint Secretary, Student Council) - 8278713869<br/>
              Priyanshu Jha (Coordinator) - 9234686190<br/>
              Or mail at studentcouncil@vitbhopal.ac.in
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1a0533;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">Office of Student's Welfare, VIT Bhopal University</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHTML(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function logEmail(db, userId, ticketId, status, errorMsg) {
  try {
    db.prepare("INSERT INTO email_logs (user_id, ticket_id, status, error_msg) VALUES (?,?,?,?)")
      .run(userId, ticketId, status, errorMsg);
  } catch (_) {}
}

module.exports = { sendTicketEmail, batchSendEmails };
