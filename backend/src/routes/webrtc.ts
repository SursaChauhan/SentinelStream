// backend/src/routes/webrtc.ts
//
// WebRTC Signaling Proxy
//
// WHY a proxy here?
//   The browser needs to exchange SDP offers/answers with the Python worker
//   to set up a WebRTC connection. But the browser doesn't talk to the worker
//   directly (the worker has no auth system). All traffic goes through the
//   backend, which validates the JWT, then forwards to the worker.
//
// SIGNALING FLOW:
//   Browser → POST /api/webrtc/:cameraId/offer  → Backend → Worker
//   Worker  → SDP answer                        → Backend → Browser
//   Browser → POST /api/webrtc/:cameraId/ice    → Backend → Worker
//   Worker  → ICE candidates                    → Backend → Browser

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { sql } from "../db/client";
import type { AppEnv } from "../types";

const webrtc = new Hono<AppEnv>();

webrtc.use("*", authMiddleware);

const WORKER_URL    = process.env.WORKER_URL    || "http://worker:8001";
const WORKER_SECRET = process.env.WORKER_SECRET || "internal_worker_secret";

// ─── Helper: forward a request to the worker ──────────────────────────────
async function forwardToWorker(path: string, body: unknown) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Secret": WORKER_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Worker returned ${res.status}`);
  }

  return res.json();
}

// ─── POST /api/webrtc/:cameraId/offer ─────────────────────────────────────
// Browser sends its SDP offer. We forward it to the worker and return the answer.
webrtc.post("/:cameraId/offer", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId   = c.req.param("cameraId");
  const body       = await c.req.json().catch(() => null);

  if (!body?.sdp) return c.json({ error: "sdp is required" }, 400);

  // Verify camera belongs to this user
  const [camera] = await sql`
    SELECT id FROM cameras WHERE id = ${cameraId} AND user_id = ${userId}
  `;
  if (!camera) return c.json({ error: "Camera not found" }, 404);

  try {
    const answer = await forwardToWorker(`/webrtc/${cameraId}/offer`, {
      sdp: body.sdp,
      type: body.type || "offer",
    });
    return c.json(answer);
  } catch (err) {
    console.error("WebRTC offer forwarding failed:", err);
    return c.json({ error: "Worker WebRTC error" }, 502);
  }
});

// ─── POST /api/webrtc/:cameraId/ice ───────────────────────────────────────
// Browser sends ICE candidates. Forward to the worker.
webrtc.post("/:cameraId/ice", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId   = c.req.param("cameraId");
  const body       = await c.req.json().catch(() => null);

  if (!body?.candidate) return c.json({ error: "candidate is required" }, 400);

  const [camera] = await sql`
    SELECT id FROM cameras WHERE id = ${cameraId} AND user_id = ${userId}
  `;
  if (!camera) return c.json({ error: "Camera not found" }, 404);

  try {
    await forwardToWorker(`/webrtc/${cameraId}/ice`, body);
    return c.json({ ok: true });
  } catch (err) {
    console.error("ICE forwarding failed:", err);
    return c.json({ error: "Worker ICE error" }, 502);
  }
});

export default webrtc;
