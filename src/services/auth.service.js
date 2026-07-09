const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY;
// SALT_ROUNDS controls how computationally expensive password hashing is.
// Higher = more secure but slower. 10 is a reasonable default for now.
const PASSWORD_SALT_ROUNDS = parseInt(process.env.PASSWORD_SALT_ROUNDS, 10);

async function register({ email, password, role, phone }) {
  if (!email || !password || !role) {
    throw { status: 400, message: "email, password, and role are required" };
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    throw { status: 409, message: "user already exists" };
  }

  // bcrypt.hash() turns it into a one-way hash — even if your database were leaked, the original
  // passwords couldn't be recovered from what's stored.
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const user = await userModel.create({ email, passwordHash, role, phone });

  return { id: user.id, email: user.email, role: user.role };
}


async function login({ email, password }) {
  const user = await userModel.findByEmail(email);
  if (!user) {
    throw { status: 401, message: "invalid credentials" };
  }

  // bcrypt.compare hashes the incoming password the same way and checks
  // if it matches the stored hash — you can never "unhash" to compare directly.
  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw { status: 401, message: "invalid credentials" };
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  return { token };
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false };
  }
}

module.exports = { register, login, verifyToken };
