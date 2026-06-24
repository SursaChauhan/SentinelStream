// backend/src/ws/hub.ts
//
// WebSocket Hub — manages all active browser WebSocket connections.
//
// We intentionally avoid importing Bun-specific types (ServerWebSocket)
// here so this module resolves cleanly in VS Code's TypeScript language server.
// Instead we use a simple interface that matches the parts of the WS API we need.

import { verifyToken } from "../middleware/auth";

// Minimal interface — only the methods we actually call on a WebSocket.
// This avoids depending on Bun-specific `ServerWebSocket<T>` type directly.
interface WsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Client {
  ws: WsSocket;
  userId: string;
  username: string;
}

class WebSocketHub {
  private clients: Map<string, Client> = new Map();
  private nextId = 0;

  // Called from index.ts when a browser opens a WebSocket connection.
  // Verifies the JWT from the query param, then registers the connection.
  async handleConnect(ws: WsSocket, token: string): Promise<string | null> {
    try {
      const claims = await verifyToken(token);
      const connId = String(this.nextId++);

      this.clients.set(connId, {
        ws,
        userId: claims.userId,
        username: claims.username,
      });

      console.log(`WS connected: ${claims.username} (conn: ${connId})`);

      ws.send(JSON.stringify({
        type: "connected",
        payload: { userId: claims.userId, username: claims.username },
      }));

      return connId;
    } catch {
      // JWT invalid or expired — reject and close
      ws.send(JSON.stringify({ type: "error", payload: { message: "Unauthorized" } }));
      ws.close(1008, "Unauthorized");
      return null;
    }
  }

  // Called from index.ts when a browser WebSocket closes.
  handleDisconnect(connId: string): void {
    const client = this.clients.get(connId);
    if (client) {
      console.log(`WS disconnected: ${client.username} (conn: ${connId})`);
      this.clients.delete(connId);
    }
  }

  // Push a message to every connected browser client.
  // Called by alerts.ts whenever the worker posts a new detection event.
  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    const stale: string[] = [];

    for (const [connId, client] of this.clients) {
      try {
        client.ws.send(data);
      } catch {
        // Client gone without a clean close — mark for removal
        stale.push(connId);
      }
    }

    // Clean up stale connections after iteration (avoid mutating Map mid-loop)
    for (const id of stale) {
      this.clients.delete(id);
    }
  }

  // Push to a single user only (e.g. for user-scoped notifications)
  broadcastToUser(userId: string, message: unknown): void {
    const data = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (client.userId === userId) {
        try { client.ws.send(data); } catch { /* ignore */ }
      }
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}

// Singleton — import wsHub wherever you need to broadcast
export const wsHub = new WebSocketHub();
