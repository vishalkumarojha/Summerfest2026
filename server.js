"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const rateLimit = require("express-rate-limit");

// ── Init Supabase (validates env on startup) ──────────────────
require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://summerfest2026.vercel.app",
  "https://summerfest-scanner.vercel.app",
  "https://summerfest2026.onrender.com",
  ...(process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(",").map(o => o.trim().replace(/\/$/, ""))
    : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalized = origin.trim().replace(/\/$/, "");
    if (ALLOWED_ORIGINS.includes(normalized)) return cb(null, true);
    console.warn("CORS Blocked Origin:", normalized);
    cb(null, false);
  },
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Authorization", "Content-Type"],
}));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Static assets (scanner + admin UI) ───────────────────────
app.use("/public", express.static(path.join(__dirname, "public")));

// ── Admin UI ─────────────────────────────────────────────────
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public/admin/index.html")));
app.get("/scanner", (_, res) => res.sendFile(path.join(__dirname, "public/scanner/index.html")));

// ── Rate limiters ─────────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const scanLimiter = rateLimit({ windowMs: 60_000, max: parseInt(process.env.SCAN_RATE_LIMIT || "60"), standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: "Too many login attempts" } });

app.use("/api/", apiLimiter);
app.use("/api/check-in", scanLimiter);
app.use("/api/admin/login", authLimiter);

// ── Routes ────────────────────────────────────────────────────
app.use("/api/admin", require("./routes/admin"));
app.use("/api/users", require("./routes/users"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api", require("./routes/verify"));

// ── Health check ─────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", ts: new Date().toISOString(), db: "supabase" }));

// ── 404 & Error handlers ──────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🎉 Summer Fest 2026 Ticketing System`);
  console.log(`   Running on port ${PORT}`);
});

module.exports = app;
