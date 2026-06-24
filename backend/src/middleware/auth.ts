// backend/src/middleware/auth.ts
//
// JWT Authentication Middleware for Hono.
//
// HOW JWT WORKS (quick reminder):
//   1. User logs in → server creates a JWT signed with JWT_SECRET
//   2. JWT = base64(header) + "." + base64(payload) + "." + signature
//   3. Client stores the JWT and sends it in every request:
//      Authorization: Bearer <token>
//   4. Server verifies the signature — if valid, trusts the payload
//   5. We store { userId, username } in the payload (the "claims")
//
// WHY `jose`?
//   - Works in Bun, Node, Deno, browsers — truly universal
//   - Supports modern algorithms (ES256, HS256)
//   - We use HS256 (HMAC-SHA256) — symmetric key, simpler for our use case

import { createMiddleware } from "hono/factory";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_in_production";

// Encode the secret as bytes (jose requires a Uint8Array for HS256)
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

// Shape of our JWT payload
export interface JwtClaims extends JWTPayload {
  userId: string;
  username: string;
}

// ─── Sign (create) a JWT ──────────────────────────────────────────────────
// Called during login/signup. Returns a signed token string.
export async function signToken(claims: {
  userId: string;
  username: string;
}): Promise<string> {
  const jwt = await new SignJWT({
    userId: claims.userId,
    username: claims.username,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET_KEY);

  return jwt;
}

// ─── Verify a JWT ─────────────────────────────────────────────────────────
// Returns the decoded payload, or throws if invalid/expired.
export async function verifyToken(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, SECRET_KEY, { algorithms: ["HS256"] });
  return payload as JwtClaims;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────
// Use this on any route that requires authentication:
//   app.get('/api/cameras', authMiddleware, handler)
//
// It reads the Authorization header, verifies the token,
// and stores the user claims in Hono's context for downstream handlers.
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7); // remove "Bearer " prefix

  try {
    const claims = await verifyToken(token);
    // Store claims in context so route handlers can access them:
    // const { userId } = c.get('jwtClaims')
    c.set("jwtClaims", claims);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

// ─── Internal Worker Auth ─────────────────────────────────────────────────
// The Python worker calls our API to POST alerts.
// It uses a shared secret instead of a JWT (simpler for service-to-service).
export const workerAuthMiddleware = createMiddleware(async (c, next) => {
  const workerSecret = c.req.header("X-Worker-Secret");
  const expectedSecret = process.env.WORKER_SECRET || "internal_worker_secret";

  if (workerSecret !== expectedSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
