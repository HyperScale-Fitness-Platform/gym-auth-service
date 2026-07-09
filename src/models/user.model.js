const pool = require("../config/database");


async function findByEmail(email) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [id]
  );
  return result.rows[0];
}

// Postgres generate the id automatically via the DEFAULT gen_random_uuid()
// We also don't pass created_at or is_active — their DEFAULT values in the schema handle that.
async function create({ email, passwordHash, role, phone }) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role, phone)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, passwordHash, role, phone || null]
  );
  // RETURNING * gives us back the full row Postgres just inserted,
  // including the auto-generated id and created_at.
  return result.rows[0];
}

module.exports = { findByEmail, findById, create };