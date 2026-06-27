// backend/src/routes/alerts.ts

import { Hono } from "hono";
import { authMiddleware, workerAuthMiddleware } from "../middleware/auth";
import { sql } from "../db/client";
import { wsHub } from "../ws/hub";
import type { AppEnv } from "../types";

const alerts = new Hono<AppEnv>();

// Helper to save and broadcast an alert, used by HTTP route and Redis subscriber
export async function saveAndBroadcastAlert(body: any) {
  if (!body?.camera_id || !body?.confidence || !body?.timestamp) {
    throw new Error("camera_id, confidence, and timestamp are required");
  }

  const [alert] = await sql`
    INSERT INTO alerts (
      camera_id, event_type, timestamp, confidence,
      bounding_box, frame_number, thumbnail_url, raw_payload, event_id
    )
    VALUES (
      ${body.camera_id},
      ${body.event_type ?? "person_detected"},
      ${body.timestamp},
      ${body.confidence},
      ${JSON.stringify(body.bounding_box ?? {})}::jsonb,
      ${body.frame_number ?? null},
      ${body.thumbnail_url ?? null},
      ${JSON.stringify(body)}::jsonb,
      ${body.event_id ?? null}
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING *
  `;

  if (alert) {
    // Push real-time to all connected browser WebSocket clients
    wsHub.broadcast({ type: "alert", payload: alert });
  }

  return alert;
}

// ─── POST /api/alerts ─── Worker posts a detection event ───────────────────
alerts.post("/", workerAuthMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body?.camera_id || !body?.confidence || !body?.timestamp) {
    return c.json({ error: "camera_id, confidence, and timestamp are required" }, 400);
  }

  try {
    const alert = await saveAndBroadcastAlert(body);
    if (!alert) {
      return c.json({ alert: null, message: "Duplicate alert, skipped", skipped: true }, 200);
    }
    return c.json({ alert }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to process alert" }, 500);
  }
});

// ─── GET /api/alerts ─── Frontend fetches alerts with filters ──────────────
alerts.get("/", authMiddleware, async (c) => {
  const { userId } = c.get("jwtClaims");

  const cameraId = c.req.query("camera_id");
  const from     = c.req.query("from");
  const to       = c.req.query("to");
  const page     = Math.max(1, Number(c.req.query("page"))  || 1);
  const limit    = Math.min(100, Number(c.req.query("limit")) || 20);
  const offset   = (page - 1) * limit;

  const rows = await sql`
    SELECT a.*
    FROM alerts a
    INNER JOIN cameras cam ON cam.id = a.camera_id
    WHERE cam.user_id = ${userId}
      ${cameraId ? sql`AND a.camera_id = ${cameraId}` : sql``}
      ${from     ? sql`AND a.timestamp >= ${from}`    : sql``}
      ${to       ? sql`AND a.timestamp <= ${to}`      : sql``}
    ORDER BY a.timestamp DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  // COUNT(*) returns a bigint-like string from postgres driver — cast explicitly
  const countResult = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM alerts a
    INNER JOIN cameras cam ON cam.id = a.camera_id
    WHERE cam.user_id = ${userId}
      ${cameraId ? sql`AND a.camera_id = ${cameraId}` : sql``}
      ${from     ? sql`AND a.timestamp >= ${from}`    : sql``}
      ${to       ? sql`AND a.timestamp <= ${to}`      : sql``}
  `;

  const total = Number(countResult[0]?.count ?? 0);

  return c.json({
    alerts: rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  });
});

export default alerts;
