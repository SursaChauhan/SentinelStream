// backend/src/index.ts

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { checkDbConnection } from "./db/client";
import { wsHub } from "./ws/hub";
import type { AppEnv } from "./types";
import authRoutes from "./routes/auth";
import cameraRoutes from "./routes/cameras";
import alertRoutes from "./routes/alerts";
import webrtcRoutes from "./routes/webrtc";

// Pass AppEnv as a generic so c.get/c.set are properly typed throughout
const app = new Hono<AppEnv>();

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

// ─── Start Server ─────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;

// Map: WebSocket instance → connection ID (for cleanup on disconnect)
// Using the URL string as the WS data payload so we can read query params
const wsConnections = new Map<ReturnType<typeof Bun.serve>["upgrade"] extends (req: Request, options?: { data: infer D }) => boolean ? D : unknown, string>();

async function main() {
  await checkDbConnection();

  Bun.serve<string>({
    port: PORT,

    fetch(req, server) {
      const url = new URL(req.url);

      // Upgrade WebSocket connections at /ws
      if (url.pathname === "/ws") {
        // Pass the full URL string as `data` so the `open` handler can read query params
        const success = server.upgrade(req, { data: req.url });
        if (!success) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      return app.fetch(req);
    },

    websocket: {
      async open(ws) {
        // ws.data is the string we passed as `data` in server.upgrade()
        const url   = new URL(ws.data);
        const token = url.searchParams.get("token") || "";

        const connId = await wsHub.handleConnect(ws, token);
        if (connId) {
          // Store connId in ws.data for use in close()
          (ws as unknown as { _connId: string })._connId = connId;
        }
      },
      message(_ws, message) {
        try {
          const data = JSON.parse(message.toString());
          console.log("WS message from client:", data);
        } catch { /* ignore malformed */ }
      },
      close(ws) {
        const connId = (ws as unknown as { _connId?: string })._connId;
        if (connId) {
          wsHub.handleDisconnect(connId);
        }
      },
    },
  });

  console.log(`🚀 SentinelStream backend running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws?token=<jwt>`);
}

main();
