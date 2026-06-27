// backend/src/app.ts

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./types";
import authRoutes from "./routes/auth";
import cameraRoutes from "./routes/cameras";
import alertRoutes from "./routes/alerts";
import webrtcRoutes from "./routes/webrtc";

// Pass AppEnv as a generic so c.get/c.set are properly typed throughout
export const app = new Hono<AppEnv>();

// ─── Global Middleware ─────────────────────────────────────────────────────
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_URL || "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Worker-Secret"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────
app.route("/api/auth", authRoutes);
app.route("/api/cameras", cameraRoutes);
app.route("/api/alerts", alertRoutes);
app.route("/api/webrtc", webrtcRoutes);

app.get("/health", (c) => c.json({ status: "ok", service: "sentinel-backend" }));
app.notFound((c) => c.json({ error: "Route not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
