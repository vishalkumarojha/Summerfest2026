"use strict";
require("dotenv").config();
const express      = require("express");
const helmet       = require("helmet");
const cors         = require("cors");
const morgan       = require("morgan");
const path         = require("path");
const rateLimit    = require("express-rate-limit");
const { getDB }    = require("./db");

// ── Init DB on startup ────────────────────────────────────────
getDB();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // relax for inline scripts in admin UI
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Static assets ─────────────────────────────────────────────
app.use("/public",   express.static(path.join(__dirname, "public")));
app.use("/uploads",  express.static(path.join(__dirname, "uploads")));  // screenshots
app.use("/tickets",  express.static(path.join(__dirname, "tickets")));  // PDF downloads

// ── Admin UI ─────────────────────────────────────────────────
app.get("/",         (_, res) => res.sendFile(path.join(__dirname, "public/admin/index.html")));
app.get("/scanner",  (_, res) => res.sendFile(path.join(__dirname, "public/scanner/index.html")));

// ── API Rate limiters ─────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const scanLimiter = rateLimit({ windowMs: 60_000, max: parseInt(process.env.SCAN_RATE_LIMIT || "60"), standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: "Too many login attempts" } });

app.use("/api/", apiLimiter);
app.use("/api/check-in", scanLimiter);
app.use("/api/admin/login", authLimiter);

// ── Routes ────────────────────────────────────────────────────
app.use("/api/admin",   require("./routes/admin"));
app.use("/api/users",   require("./routes/users"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api",         require("./routes/verify"));

// ── Health check ─────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// ── 404 & Error handlers ──────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`\n🎉 Summer Fest 2026 Ticketing System`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Admin UI  → http://localhost:${PORT}/`);
  console.log(`   Scanner   → http://localhost:${PORT}/scanner\n`);
});

module.exports = app;
