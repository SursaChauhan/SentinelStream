// backend/src/routes/cameras.ts

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { sql } from "../db/client";
import type { AppEnv } from "../types";

// Pass AppEnv generic — this tells TypeScript what c.get("jwtClaims") returns
const cameras = new Hono<AppEnv>();

cameras.use("*", authMiddleware);

// ─── GET /api/cameras ──────────────────────────────────────────────────────
cameras.get("/", async (c) => {
  const { userId } = c.get("jwtClaims");

  const rows = await sql`
    SELECT id, name, rtsp_url, location, enabled, created_at, updated_at
    FROM cameras
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return c.json({ cameras: rows });
});

// ─── POST /api/cameras ─────────────────────────────────────────────────────
cameras.post("/", async (c) => {
  const { userId } = c.get("jwtClaims");
  const body = await c.req.json().catch(() => null);

  if (!body?.name || !body?.rtsp_url) {
    return c.json({ error: "name and rtsp_url are required" }, 400);
  }

  const [camera] = await sql`
    INSERT INTO cameras (user_id, name, rtsp_url, location, enabled)
    VALUES (
      ${userId},
      ${body.name},
      ${body.rtsp_url},
      ${body.location ?? null},
      ${body.enabled ?? true}
    )
    RETURNING *
  `;

  return c.json({ camera }, 201);
});

// ─── GET /api/cameras/:id ──────────────────────────────────────────────────
cameras.get("/:id", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");

  const [camera] = await sql`
    SELECT * FROM cameras
    WHERE id = ${cameraId} AND user_id = ${userId}
  `;

  if (!camera) return c.json({ error: "Camera not found" }, 404);

  return c.json({ camera });
});

// ─── PUT /api/cameras/:id ──────────────────────────────────────────────────
cameras.put("/:id", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  if (!body) return c.json({ error: "Request body required" }, 400);

  const [camera] = await sql`
    UPDATE cameras
    SET
      name       = COALESCE(${body.name     ?? null}, name),
      rtsp_url   = COALESCE(${body.rtsp_url ?? null}, rtsp_url),
      location   = COALESCE(${body.location ?? null}, location),
      enabled    = COALESCE(${body.enabled  ?? null}, enabled),
      updated_at = NOW()
    WHERE id = ${cameraId} AND user_id = ${userId}
    RETURNING *
  `;

  if (!camera) return c.json({ error: "Camera not found" }, 404);

  return c.json({ camera });
});

// ─── DELETE /api/cameras/:id ───────────────────────────────────────────────
cameras.delete("/:id", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");

  const result = await sql`
    DELETE FROM cameras
    WHERE id = ${cameraId} AND user_id = ${userId}
    RETURNING id
  `;

  if (result.length === 0) return c.json({ error: "Camera not found" }, 404);

  return c.json({ message: "Camera deleted" });
});

// ─── POST /api/cameras/:id/start ──────────────────────────────────────────
cameras.post("/:id/start", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");

  const [camera] = await sql`
    SELECT * FROM cameras WHERE id = ${cameraId} AND user_id = ${userId}
  `;
  if (!camera) return c.json({ error: "Camera not found" }, 404);

  const workerUrl    = process.env.WORKER_URL    || "http://worker:8001";
  const workerSecret = process.env.WORKER_SECRET || "internal_worker_secret";

  try {
    const res = await fetch(`${workerUrl}/cameras/${cameraId}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": workerSecret,
      },
      body: JSON.stringify({ camera_id: cameraId, rtsp_url: camera.rtsp_url }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return c.json({ error: "Worker failed to start stream", detail: errBody }, 502);
    }

    return c.json({ message: "Stream starting", camera_id: cameraId });
  } catch (err) {
    console.error("Worker unreachable:", err);
    return c.json({ error: "Worker service unavailable" }, 503);
  }
});

// ─── POST /api/cameras/:id/stop ───────────────────────────────────────────
cameras.post("/:id/stop", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");

  const [camera] = await sql`
    SELECT id FROM cameras WHERE id = ${cameraId} AND user_id = ${userId}
  `;
  if (!camera) return c.json({ error: "Camera not found" }, 404);

  const workerUrl    = process.env.WORKER_URL    || "http://worker:8001";
  const workerSecret = process.env.WORKER_SECRET || "internal_worker_secret";

  try {
    const res = await fetch(`${workerUrl}/cameras/${cameraId}/stop`, {
      method: "POST",
      headers: { "X-Worker-Secret": workerSecret },
    });

    if (!res.ok) {
      return c.json({ error: "Worker failed to stop stream" }, 502);
    }

    return c.json({ message: "Stream stopped", camera_id: cameraId });
  } catch {
    return c.json({ error: "Worker service unavailable" }, 503);
  }
});

// ─── GET /api/cameras/:id/status ──────────────────────────────────────────
cameras.get("/:id/status", async (c) => {
  const { userId } = c.get("jwtClaims");
  const cameraId = c.req.param("id");

  const [camera] = await sql`
    SELECT id FROM cameras WHERE id = ${cameraId} AND user_id = ${userId}
  `;
  if (!camera) return c.json({ error: "Camera not found" }, 404);

  const workerUrl    = process.env.WORKER_URL    || "http://worker:8001";
  const workerSecret = process.env.WORKER_SECRET || "internal_worker_secret";

  try {
    const res = await fetch(`${workerUrl}/cameras/${cameraId}/status`, {
      method: "GET",
      headers: { "X-Worker-Secret": workerSecret },
    });

    if (!res.ok) {
      return c.json({ error: "Worker failed to fetch stats" }, 502);
    }

    const data = await res.json();
    return c.json(data);
  } catch (err) {
    console.error("Worker unreachable:", err);
    return c.json({ error: "Worker service unavailable" }, 503);
  }
});

export default cameras;
