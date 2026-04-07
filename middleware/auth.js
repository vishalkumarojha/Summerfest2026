"use strict";
const jwt = require("jsonwebtoken");

/**
 * Express middleware – validates the Bearer JWT in Authorization header.
 * Attaches decoded payload to req.admin.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  let token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    
    if (req.admin.role === 'scanner') {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
function requireScannerOrAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  let token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token && req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth, requireScannerOrAdmin };
