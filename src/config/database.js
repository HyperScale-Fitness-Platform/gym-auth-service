// A "pool" manages a set of reusable connections to Postgres rather than opening a new one per query, 
// which is both faster and the standard way to use pg.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = pool;