"use strict";
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");
const QRCode = require("qrcode");
const { supabase } = require("../db");

// ── Colour palette ────────────────────────────────────────────
const C = {
  // dark purple background
  bg:       rgb(0.051, 0.0,   0.102),  // #0d001a
  bgMid:    rgb(0.102, 0.012, 0.2),    // #1a0333
  // accent gold
  gold:     rgb(1.0,   0.843, 0.0),    // #ffd700
  goldDim:  rgb(0.9,   0.76,  0.0),
  // accent purple/pink
  violet:   rgb(0.486, 0.231, 0.929),  // #7c3aed
  pink:     rgb(0.929, 0.302, 0.6),    // ed4d99
  // right stub
  stubBg:   rgb(0.961, 0.941, 1.0),    // #f5f0ff
  stubPurp: rgb(0.486, 0.231, 0.929),
  stubDark: rgb(0.298, 0.114, 0.584),
  // text
  white:    rgb(1, 1, 1),
  offWhite: rgb(0.9, 0.88, 0.96),
  gray:     rgb(0.65, 0.60, 0.72),
};

/**
 * Generates a premium A5-landscape PDF ticket using pdf-lib (no browser needed),
 * uploads it to Supabase Storage, and returns the storage file path.
 *
 * @param {object} user   – user row from Supabase
 * @param {object} ticket – ticket row from Supabase (must have ticket_uuid, qr_token)
 * @returns {string} Supabase Storage path, e.g. "SF26-XXXX.pdf"
 */
async function generateTicketPDF(user, ticket) {
  // ── 1. Generate QR code PNG from qr_token (the JWT) ─────────
  const qrDataURL = await QRCode.toDataURL(ticket.qr_token || ticket.ticket_uuid, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 300,
    color: { dark: "#1a0533", light: "#ffffff" },
  });
  const qrImageBytes = Buffer.from(qrDataURL.split(",")[1], "base64");

  // ── 2. Build PDF ─────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();

  // A5 landscape: 210mm × 148mm → 595 × 420 pt (approx)
  const W = 595, H = 420;
  const page = pdfDoc.addPage([W, H]);

  // Embed fonts & QR image
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg    = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const qrImage    = await pdfDoc.embedPng(qrImageBytes);

  // ── 3. Left panel (dark gradient style via filled rects) ─────
  const STUB_W = 130;  // right stub width
  const LEFT_W = W - STUB_W;

  // Background
  drawRect(page, 0, 0, LEFT_W, H, C.bg);

  // Decorative purple overlay bands
  drawRect(page, 0, H * 0.55, LEFT_W * 0.6, H * 0.45, C.bgMid, 0.5);
  drawRect(page, LEFT_W * 0.3, 0, LEFT_W * 0.7, H * 0.45, C.bgMid, 0.3);

  // Dashed separator line (drawn as alternating dashes)
  drawDashedLine(page, LEFT_W, 0, LEFT_W, H, C.gold, 0.4, 6, 5);

  // ── Event badge row ──────────────────────────────────────────
  const badgeY = H - 32;
  drawRoundRect(page, 28, badgeY - 8, 170, 18, 9, rgb(1,0.843,0), 0.12);
  // Badge border line (top)
  page.drawLine({ start:{x:28,y:badgeY+10}, end:{x:198,y:badgeY+10}, thickness:0.8, color:C.goldDim, opacity:0.5 });
  page.drawLine({ start:{x:28,y:badgeY-8}, end:{x:198,y:badgeY-8}, thickness:0.8, color:C.goldDim, opacity:0.5 });

  // Gold dot
  page.drawCircle({ x:42, y:badgeY+1, size:3, color:C.gold });

  // Badge text
  page.drawText("VIT BHOPAL · OFFICIAL TICKET", {
    x: 52, y: badgeY - 2,
    size: 6.5, font: fontBold, color: C.gold, opacity: 0.9,
  });

  // ── Event Name ───────────────────────────────────────────────
  const ev = {
    name:        process.env.EVENT_NAME        || "Summer Fest 2026",
    date:        process.env.EVENT_DATE        || "8th April 2026",
    time:        process.env.EVENT_TIME        || "6PM - 10PM",
    venue:       process.env.EVENT_VENUE       || "Cricket Ground, VIT Bhopal",
    description: process.env.EVENT_DESCRIPTION || "Bolly-Tech · International DJ · Dance Performances",
    price:       process.env.TICKET_PRICE      || "₹299",
  };

  page.drawText(ev.name.toUpperCase(), {
    x: 28, y: H - 70,
    size: 26, font: fontBold, color: C.white,
  });
  page.drawText(ev.description, {
    x: 28, y: H - 88,
    size: 7, font: fontReg, color: C.gray,
  });

  // ── Thin gold divider ────────────────────────────────────────
  page.drawLine({ start:{x:28, y:H-100}, end:{x:LEFT_W-18, y:H-100}, thickness:0.5, color:C.gold, opacity:0.3 });

  // ── Attendee section ─────────────────────────────────────────
  page.drawText("ATTENDEE", {
    x: 28, y: H - 118,
    size: 6.5, font: fontBold, color: C.gold, opacity: 0.75,
  });

  // Avatar circle
  page.drawCircle({ x: 50, y: H - 148, size: 20, color: C.violet });
  const initials = (user.name || "??").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  page.drawText(initials, {
    x: initials.length === 1 ? 44 : 40,
    y: H - 153,
    size: 12, font: fontBold, color: C.white,
  });

  // Name & reg
  const displayName = truncate(user.name || "Unknown", 32).toUpperCase();
  page.drawText(displayName, {
    x: 80, y: H - 141,
    size: 15, font: fontBold, color: C.white,
  });
  page.drawText(`Reg No: ${user.registration_id || "N/A"}`, {
    x: 80, y: H - 157,
    size: 8.5, font: fontReg, color: rgb(0.654, 0.545, 0.792),
  });

  // ── Details grid ─────────────────────────────────────────────
  const gridY = H - 195;
  const col2  = 220;

  renderDetailCell(page, fontBold, fontReg, 28, gridY, "DATE", ev.date);
  renderDetailCell(page, fontBold, fontReg, col2, gridY, "TIME", ev.time);
  renderDetailCell(page, fontBold, fontReg, 28, gridY - 36, "VENUE", truncate(ev.venue, 35));
  renderDetailCell(page, fontBold, fontReg, col2, gridY - 36, "EMAIL", truncate(user.email || "", 28));

  // ── Bottom bar ───────────────────────────────────────────────
  const bottomY = 28;
  page.drawLine({ start:{x:28,y:bottomY+40}, end:{x:LEFT_W-18, y:bottomY+40}, thickness:0.5, color:C.white, opacity:0.12 });

  page.drawText("TICKET ID", { x:28, y:bottomY+28, size:6, font:fontBold, color:C.gold, opacity:0.7 });
  page.drawText(ticket.ticket_uuid, { x:28, y:bottomY+12, size:11, font:fontBold, color:C.gold });

  // Reg badge (pill)
  const regLabel = user.registration_id || "REG-NA";
  drawRoundRect(page, LEFT_W - 100, bottomY + 6, 82, 22, 11, C.violet, 1.0);
  page.drawText(regLabel, { x: LEFT_W - 96, y: bottomY + 12, size: 8, font: fontBold, color: C.white });

  // Footer
  page.drawText("© 2026 Summer Fest · VIT Bhopal University · All Rights Reserved", {
    x: 28, y: 10,
    size: 5.5, font: fontReg, color: C.white, opacity: 0.25,
  });

  // ── 4. Right stub (QR panel) ─────────────────────────────────
  drawRect(page, LEFT_W, 0, STUB_W, H, C.stubBg);

  // Decorative circles (notch markers)
  page.drawCircle({ x: LEFT_W, y: H + 9, size: 10, color: C.bg });
  page.drawCircle({ x: LEFT_W, y: -9, size: 10, color: C.bg });

  // "Scan to Enter" label
  page.drawText("SCAN TO", { x: LEFT_W + 18, y: H - 30, size: 6, font: fontBold, color: C.violet });
  page.drawText("ENTER", { x: LEFT_W + 22, y: H - 40, size: 6, font: fontBold, color: C.violet });

  // QR Code image
  const qrSize = 115;
  const qrX = LEFT_W + (STUB_W - qrSize) / 2;
  const qrY = (H - qrSize) / 2 - 10;
  // White QR border
  drawRect(page, qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, C.white);
  page.drawLine({ start:{x:qrX-5, y:qrY+qrSize+5}, end:{x:qrX+qrSize+5, y:qrY+qrSize+5}, thickness:2.5, color:C.violet });
  page.drawLine({ start:{x:qrX-5, y:qrY-5},         end:{x:qrX-5,         y:qrY+qrSize+5}, thickness:2.5, color:C.violet });
  page.drawLine({ start:{x:qrX+qrSize+5, y:qrY-5},  end:{x:qrX+qrSize+5, y:qrY+qrSize+5}, thickness:2.5, color:C.violet });
  page.drawLine({ start:{x:qrX-5, y:qrY-5},         end:{x:qrX+qrSize+5, y:qrY-5},        thickness:2.5, color:C.violet });

  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // Below QR text
  page.drawText("One-time entry only", { x: LEFT_W + 10, y: qrY - 18, size: 6, font: fontBold, color: C.stubDark });
  page.drawText(ticket.ticket_uuid, {
    x: LEFT_W + 8, y: qrY - 32,
    size: 5.5, font: fontBold, color: C.violet,
  });

  // Vertical rotated text on left edge of stub
  page.drawText("SUMMER FEST 2026", {
    x: LEFT_W + 10, y: H / 2 - 40,
    size: 6.5, font: fontBold, color: rgb(0.486, 0.231, 0.929),
    opacity: 0.35, rotate: degrees(90),
  });

  // ── 5. Save & upload to Supabase Storage ─────────────────────
  const pdfBytes = await pdfDoc.save();
  const filename = `${ticket.ticket_uuid}.pdf`;

  const { error } = await supabase.storage
    .from("tickets")
    .upload(filename, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (error) throw new Error("PDF Storage upload failed: " + error.message);

  console.log(`🎟️  PDF generated & uploaded: ${filename}`);
  return filename;
}

// ── Helpers ───────────────────────────────────────────────────

function drawRect(page, x, y, w, h, color, opacity = 1.0) {
  page.drawRectangle({ x, y, width: w, height: h, color, opacity });
}

/** Very basic rounded-rect approximation using overlapping rects + circles */
function drawRoundRect(page, x, y, w, h, r, color, opacity = 1.0) {
  page.drawRectangle({ x: x+r, y, width: w-2*r, height: h, color, opacity });
  page.drawRectangle({ x, y: y+r, width: w, height: h-2*r, color, opacity });
  page.drawCircle({ x: x+r,   y: y+r,   size: r, color, opacity });
  page.drawCircle({ x: x+w-r, y: y+r,   size: r, color, opacity });
  page.drawCircle({ x: x+r,   y: y+h-r, size: r, color, opacity });
  page.drawCircle({ x: x+w-r, y: y+h-r, size: r, color, opacity });
}

function drawDashedLine(page, x1, y1, x2, y2, color, opacity, dashLen, gapLen) {
  const totalLen = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
  const steps = Math.floor(totalLen / (dashLen + gapLen));
  const dx = (x2 - x1) / totalLen;
  const dy = (y2 - y1) / totalLen;
  for (let i = 0; i < steps; i++) {
    const startDist = i * (dashLen + gapLen);
    const endDist   = startDist + dashLen;
    page.drawLine({
      start: { x: x1 + dx * startDist, y: y1 + dy * startDist },
      end:   { x: x1 + dx * endDist,   y: y1 + dy * endDist },
      thickness: 1.2, color, opacity,
    });
  }
}

function renderDetailCell(page, fontBold, fontReg, x, y, label, value) {
  page.drawText(label, { x, y, size: 6, font: fontBold, color: C.gold, opacity: 0.65 });
  page.drawText(value || "—", { x, y: y - 14, size: 8.5, font: fontBold, color: C.white });
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

module.exports = { generateTicketPDF };
