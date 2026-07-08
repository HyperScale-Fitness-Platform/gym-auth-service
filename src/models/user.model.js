// This is the MODEL layer — the only place that knows how user data is
// actually stored. Right now it's a plain JavaScript array living in
// memory (meaning: it resets every time you restart the service). This is
// intentional for getting started fast with zero database setup.
//
// TODO before this is anything close to production-ready:
// replace this whole file's internals with real queries against Postgres
// (using a library like "pg" or an ORM like Prisma/Knex), WITHOUT changing
// the function names/signatures below — that way nothing else in the
// codebase (controllers, services) needs to change when you do this swap.

const crypto = require("crypto");

// our "database," for now
const users = [];

// Find a user by email. Returns undefined if not found — same behavior
// a real database query would give you (no matching row).
function findByEmail(email) {
  return users.find((u) => u.email === email);
}

// Find a user by id.
function findById(id) {
  return users.find((u) => u.id === id);
}

// Create a new user record and add it to our "database."
// passwordHash is expected to already be hashed (never store plain
// passwords) — hashing happens in the service layer, not here.
function create({ email, passwordHash, role }) {
  const user = {
    id: crypto.randomUUID(), // generates a unique id, built into Node itself
    email,
    passwordHash,
    role,
  };
  users.push(user);
  return user;
}

module.exports = { findByEmail, findById, create };
