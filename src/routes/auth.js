const asyncHandler = require("../middleware/asyncHandler");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const router = express.Router();

// A single admin account, hashed at boot from env vars. Swap this for a
// Mongo-backed Users collection if multi-admin login is needed later.
let adminHash = null;
async function getAdminHash() {
  if (!adminHash) {
    adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 10);
  }
  return adminHash;
}

router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const expectedEmail = process.env.ADMIN_EMAIL || "admin@scholarzzone.dev";
  const hash = await getAdminHash();

  if (email !== expectedEmail || !(await bcrypt.compare(password || "", hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ email, role: "admin" }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "8h",
  });
  res.json({ token });
}));

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "dev-secret", { algorithms: ["HS256"] });
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
