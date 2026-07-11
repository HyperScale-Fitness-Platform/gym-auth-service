// A "pool" manages a set of reusable connections to Postgres rather than opening a new one per query, 
// which is both faster and the standard way to use pg.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = pool;