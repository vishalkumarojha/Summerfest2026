"use strict";
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env — DB calls will fail");
}

// Service-role client — bypasses RLS, server-side only
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

module.exports = { supabase };
