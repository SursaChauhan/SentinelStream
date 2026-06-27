// backend/src/db/client.ts
//
// This module creates ONE shared Postgres connection pool.
// We import `db` from here everywhere we need to query the DB.
//
// Why `postgres` package (not `pg`)?
//   - Modern, TypeScript-native, no callback hell
//   - Tagged template literals make queries safe from SQL injection:
//     sql`SELECT * FROM users WHERE id = ${id}`  ← safe, parameterized
//     (never do: `SELECT * FROM users WHERE id = '${id}'` ← unsafe!)

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create the connection pool.
// `postgres()` manages a pool of connections automatically.
export const sql = postgres(DATABASE_URL, {
  max: 10,          // max 10 concurrent connections in the pool
  idle_timeout: 30, // close idle connections after 30s
  connect_timeout: 10,
});

// Quick health-check export — call this on startup to verify DB connection
export async function checkDbConnection() {
  try {
    await sql`SELECT 1`;
    console.log("✅ Database connected");
    // Auto-migration for event_id column
    await sql`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS event_id UUID UNIQUE`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alerts_event_id ON alerts(event_id)`;
    console.log("✅ Database schema auto-migration complete");
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }
}
