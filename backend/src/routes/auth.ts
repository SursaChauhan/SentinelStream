// backend/src/routes/auth.ts
//
// Authentication routes: signup and login.
//
// FLOW:
//   POST /api/auth/signup  → hash password → insert user → return JWT
//   POST /api/auth/login   → look up user → verify password → return JWT

import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { sql } from "../db/client";
import { signToken } from "../middleware/auth";

const auth = new Hono();

// ─── POST /api/auth/signup ─────────────────────────────────────────────────
auth.post("/signup", async (c) => {
  // 1. Parse and validate the request body
  const body = await c.req.json().catch(() => null);

  if (!body?.username || !body?.password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const { username, password } = body;

  if (username.length < 3) {
    return c.json({ error: "Username must be at least 3 characters" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  // 2. Check if username is already taken
  const existing = await sql`
    SELECT id FROM users WHERE username = ${username}
  `;
  if (existing.length > 0) {
    return c.json({ error: "Username already taken" }, 409);
  }

  // 3. Hash the password
  // bcrypt automatically generates a salt and hashes the password.
  // NEVER store plain-text passwords. bcrypt is intentionally slow
  // (cost factor 10) to make brute-force attacks impractical.
  const passwordHash = await bcrypt.hash(password, 10);

  // 4. Insert the new user into the DB
  const [user] = await sql`
    INSERT INTO users (username, password_hash)
    VALUES (${username}, ${passwordHash})
    RETURNING id, username, created_at
  `;

  // 4. Create and return a JWT
  if (!user) {
    // This shouldn't happen since we just inserted, but satisfies TypeScript
    return c.json({ error: "Failed to create user" }, 500);
  }

  const token = await signToken({ userId: user.id, username: user.username });

  return c.json({
    token,
    user: { id: user.id, username: user.username },
  }, 201);
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────
auth.post("/login", async (c) => {
  // 1. Parse request body
  const body = await c.req.json().catch(() => null);

  if (!body?.username || !body?.password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const { username, password } = body;

  // 2. Find the user by username
  const [user] = await sql`
    SELECT id, username, password_hash FROM users WHERE username = ${username}
  `;

  // 3. Validate — use a generic message to avoid username enumeration
  // (don't say "username not found" — that leaks which usernames exist)
  if (!user) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  // 4. Verify the password against the stored hash
  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  // 5. Issue a JWT
  const token = await signToken({ userId: user.id, username: user.username });

  return c.json({
    token,
    user: { id: user.id, username: user.username },
  });
});

export default auth;
