const fs = require("fs").promises;
const path = require("path");
const pool = require("../config/database");

const migrationsPath = path.join(__dirname, "migrations");
// Kept distinct from other services because advisory locks are database-wide.
const LOCK_KEY = 2088451001;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function loadMigrations() {
  const files = await fs.readdir(migrationsPath);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

async function runMigration(client, filename) {
  const sql = await fs.readFile(path.join(migrationsPath, filename), "utf8");

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [filename],
    );
    await client.query("COMMIT");
    console.log(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureMigrationsTable(client);

    const appliedResult = await client.query(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));
    const pending = (await loadMigrations()).filter(
      (filename) => !applied.has(filename),
    );

    if (pending.length === 0) {
      console.log("No pending migrations. Database is up to date.");
      return;
    }

    for (const filename of pending) {
      await runMigration(client, filename);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch {
      // The connection may already be closed after a failed migration.
    }
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
