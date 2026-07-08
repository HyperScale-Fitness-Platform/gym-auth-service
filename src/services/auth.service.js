// This is the SERVICE layer — the actual business logic. Controllers
// (which handle HTTP requests) call into these functions rather than
// containing this logic themselves. This separation means: if you ever
// add a way to call this same logic from somewhere other than HTTP (say,
// a Kafka event, or a CLI script), you can reuse these functions directly
// without duplicating any logic.

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRY = "1h";

// SALT_ROUNDS controls how computationally expensive password hashing is.
// Higher = more secure but slower. 10 is a reasonable default for now.
const SALT_ROUNDS = 10;

async function register({ email, password, role }) {
  if (!email || !password || !role) {
    // Throwing an object with a "status" property lets our error handler
    // middleware later respond with the right HTTP status code.
    throw { status: 400, message: "email, password, and role are required" };
  }

  const existing = userModel.findByEmail(email);
  if (existing) {
    throw { status: 409, message: "user already exists" };
  }

  // NEVER store a plain-text password. bcrypt.hash() turns it into a
  // one-way hash — even if your database were leaked, the original
  // passwords couldn't be recovered from what's stored.
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = userModel.create({ email, passwordHash, role });

  // Return only safe-to-expose fields — never send passwordHash back,
  // even hashed, to the client.
  return { id: user.id, email: user.email, role: user.role };
}

async function login({ email, password }) {
  const user = userModel.findByEmail(email);
  if (!user) {
    // Deliberately vague error message — don't reveal whether the email
    // exists or the password was wrong; that distinction helps attackers.
    throw { status: 401, message: "invalid credentials" };
  }

  // bcrypt.compare hashes the incoming password the same way and checks
  // if it matches the stored hash — you can never "unhash" to compare directly.
  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw { status: 401, message: "invalid credentials" };
  }

  // Create a JWT — a signed token containing the user's identity. Any
  // service holding JWT_SECRET can verify this token wasn't tampered with,
  // without needing to call back to a database.
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role }, // the "payload"
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  return { token };
}

function verifyToken(token) {
  try {
    // jwt.verify both checks the signature (was this really signed by us?)
    // AND checks expiry (has this token expired?). Throws if either fails.
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false };
  }
}

module.exports = { register, login, verifyToken };
