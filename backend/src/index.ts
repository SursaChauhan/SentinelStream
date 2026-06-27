// backend/src/index.ts

import { app } from "./app";
import { checkDbConnection } from "./db/client";
import { startRedisSubscriber } from "./db/redis";
import { wsHub } from "./ws/hub";

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // 1. Verify database connection & run startup migrations
  await checkDbConnection();

  // 2. Start the Redis Pub/Sub subscriber (Message Queue)
  await startRedisSubscriber();

  // 3. Start the Bun HTTP + WebSocket server
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

  console.log(`SentinelStream backend running on port ${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws?token=<jwt>`);
}

main();
