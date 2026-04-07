"use strict";
const puppeteer = require("puppeteer");
const QRCode    = require("qrcode");
const { supabase } = require("../db");

/**
 * Generates a premium A5-landscape PDF ticket, uploads to Supabase Storage.
 * @returns {string} storage object path (e.g. "SF26-XXXX.pdf")
 */
async function generateTicketPDF(user, ticket) {
  const qrDataURL = await QRCode.toDataURL(ticket.ticket_uuid, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 360,
    color: { dark: "#1a0533", light: "#ffffff" },
  });

  const html = buildTicketHTML(user, ticket, qrDataURL);

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    || puppeteer.executablePath();

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",          // important for Render free tier (limited memory)
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      width:  "210mm",
      height: "148mm",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    // Upload to Supabase Storage (tickets bucket - private)
    const filename = `${ticket.ticket_uuid}.pdf`;
    const { error } = await supabase.storage
      .from("tickets")
      .upload(filename, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (error) throw new Error("PDF Storage upload failed: " + error.message);
    return filename;   // storage path, not a local fs path
  } finally {
    await browser.close();
  }
}

// ── HTML template (unchanged, kept in full) ───────────────────
function buildTicketHTML(user, ticket, qrDataURL) {
  const ev = {
    name:        process.env.EVENT_NAME        || "Summer Fest 2026",
    date:        process.env.EVENT_DATE        || "8th April 2026",
    time:        process.env.EVENT_TIME        || "6PM - 10PM",
    venue:       process.env.EVENT_VENUE       || "Cricket Ground, VIT Bhopal",
    description: process.env.EVENT_DESCRIPTION || "Bolly-Tech Experience · International DJ · Dance Performances",
    price:       process.env.TICKET_PRICE      || "₹299",
  };

  const displayName = user.name.toUpperCase();
  const initials    = user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Raleway:wght@400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 210mm; height: 148mm; overflow: hidden; }
  body { font-family: 'Montserrat', sans-serif; background: #0d001a; display: flex; width: 210mm; height: 148mm; }
  .left { flex: 1; background: linear-gradient(135deg, #0d001a 0%, #1a0533 40%, #2d0a5e 70%, #0d001a 100%); position: relative; overflow: hidden; padding: 22px 24px 18px 24px; display: flex; flex-direction: column; justify-content: space-between; border-right: 2px dashed rgba(255,215,0,0.35); }
  .left::before { content: ''; position: absolute; top: -40px; right: -40px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(147,51,234,0.5) 0%, transparent 70%); border-radius: 50%; }
  .left::after  { content: ''; position: absolute; bottom: -30px; left: 60px; width: 160px; height: 160px; background: radial-gradient(circle, rgba(255,165,0,0.3) 0%, transparent 70%); border-radius: 50%; }
  .stars { position: absolute; inset: 0; background-image: radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.5) 0%, transparent 100%), radial-gradient(1px 1px at 80px 60px, rgba(255,255,255,0.4) 0%, transparent 100%), radial-gradient(1px 1px at 150px 20px, rgba(255,255,255,0.3) 0%, transparent 100%), radial-gradient(1px 1px at 250px 80px, rgba(255,255,255,0.5) 0%, transparent 100%), radial-gradient(1px 1px at 320px 40px, rgba(255,255,255,0.3) 0%, transparent 100%); pointer-events: none; }
  .header { position: relative; z-index: 1; }
  .event-badge { display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(90deg, rgba(255,215,0,0.15), rgba(147,51,234,0.15)); border: 1px solid rgba(255,215,0,0.4); border-radius: 20px; padding: 3px 10px; margin-bottom: 6px; }
  .event-badge span { font-size: 7px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #ffd700; }
  .dot { width: 5px; height: 5px; background: #ffd700; border-radius: 50%; }
  .event-name { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; background: linear-gradient(135deg, #ffffff 0%, #e879f9 40%, #ffd700 80%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1.1; margin-bottom: 2px; }
  .event-tagline { font-size: 8px; font-weight: 600; letter-spacing: 2px; color: rgba(255,255,255,0.55); text-transform: uppercase; margin-bottom: 14px; }
  .attendee-section { position: relative; z-index: 1; }
  .attendee-label { font-size: 7px; font-weight: 700; letter-spacing: 2px; color: rgba(255,215,0,0.7); text-transform: uppercase; margin-bottom: 4px; }
  .attendee-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #7c3aed, #ec4899); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #fff; border: 2px solid rgba(255,215,0,0.5); }
  .attendee-name { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; position: relative; z-index: 1; margin-bottom: 14px; }
  .detail-label { font-size: 6.5px; font-weight: 700; letter-spacing: 1.5px; color: rgba(255,215,0,0.6); text-transform: uppercase; margin-bottom: 2px; }
  .detail-value { font-size: 9px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .detail-value.highlight { color: #e879f9; }
  .bottom-bar { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; }
  .ticket-id-label { font-size: 6px; font-weight: 700; letter-spacing: 1.5px; color: rgba(255,215,0,0.6); text-transform: uppercase; margin-bottom: 2px; }
  .ticket-id-value { font-size: 10px; font-weight: 800; color: #ffd700; letter-spacing: 1px; font-family: 'Courier New', monospace; }
  .price-badge { background: linear-gradient(135deg, #7c3aed, #ec4899); border-radius: 20px; padding: 4px 14px; font-size: 12px; font-weight: 800; color: #fff; }
  .organizer { font-size: 7px; color: rgba(255,255,255,0.35); font-weight: 600; letter-spacing: 0.5px; text-align: center; margin-top: 6px; }
  .right { width: 108px; background: linear-gradient(180deg, #f5f0ff 0%, #ede8ff 100%); display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 14px 10px 12px; position: relative; flex-shrink: 0; }
  .right::before, .right::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #0d001a; }
  .right::before { top: -8px; left: 50%; transform: translateX(-50%); }
  .right::after  { bottom: -8px; left: 50%; transform: translateX(-50%); }
  .right-label { font-size: 6px; font-weight: 800; letter-spacing: 1.5px; color: #7c3aed; text-transform: uppercase; text-align: center; }
  .qr-frame { border: 3px solid #7c3aed; border-radius: 8px; padding: 4px; background: #fff; }
  .qr-frame img { width: 82px; height: 82px; display: block; }
  .scan-text { font-size: 5.5px; font-weight: 700; letter-spacing: 1px; color: #4c1d95; text-align: center; text-transform: uppercase; line-height: 1.4; }
  .vertical-text { writing-mode: vertical-rl; text-orientation: mixed; font-size: 7px; font-weight: 800; letter-spacing: 2px; color: rgba(124,58,237,0.5); text-transform: uppercase; position: absolute; left: 5px; top: 50%; transform: translateY(-50%) rotate(180deg); }
</style>
</head>
<body>
  <div class="left">
    <div class="stars"></div>
    <div class="header">
      <div class="event-badge"><div class="dot"></div><span>VIT Bhopal · Official Ticket</span></div>
      <div class="event-name">${ev.name}</div>
      <div class="event-tagline">${ev.description}</div>
    </div>
    <div class="attendee-section">
      <div class="attendee-label">Attendee</div>
      <div class="attendee-row">
        <div class="avatar">${initials}</div>
        <div>
          <div class="attendee-name">${escapeHTML(displayName)}</div>
          <div style="font-size:10px;color:#a78bca;margin-top:2px;font-weight:600;letter-spacing:1px;">Reg No: ${escapeHTML(user.registration_id||'N/A')}</div>
        </div>
      </div>
    </div>
    <div class="details-grid">
      <div><div class="detail-label">📅 Date</div><div class="detail-value">${ev.date}</div></div>
      <div><div class="detail-label">🕕 Time</div><div class="detail-value">${ev.time}</div></div>
      <div><div class="detail-label">📍 Venue</div><div class="detail-value">${ev.venue}</div></div>
      <div><div class="detail-label">✉️ Email</div><div class="detail-value highlight">${escapeHTML(user.email)}</div></div>
    </div>
    <div class="bottom-bar">
      <div><div class="ticket-id-label">🎟 Ticket ID</div><div class="ticket-id-value">${ticket.ticket_uuid}</div></div>
      <div class="price-badge">${escapeHTML(user.registration_id||'REG-NA')}</div>
    </div>
    <div class="organizer">© 2026 Summer Fest · VIT Bhopal · All Rights Reserved</div>
  </div>
  <div class="right">
    <div class="vertical-text">Summer Fest 2026</div>
    <div class="right-label">Scan to<br>Enter</div>
    <div class="qr-frame"><img src="${qrDataURL}" alt="QR Code"/></div>
    <div class="scan-text">One-time<br>entry only<br>· ${ticket.ticket_uuid}</div>
  </div>
</body>
</html>`;
}

function escapeHTML(str) {
  return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

module.exports = { generateTicketPDF };
