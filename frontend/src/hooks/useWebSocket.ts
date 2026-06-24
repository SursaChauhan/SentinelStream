// frontend/src/hooks/useWebSocket.ts
//
// Custom hook that manages the WebSocket connection to the backend.
//
// WHY a custom hook?
//   React hooks let you extract stateful logic into reusable functions.
//   This hook handles: connect, auto-reconnect, cleanup on unmount.
//   Any component that needs real-time alerts just calls useWebSocket().
//
// HOW THE WS FLOW WORKS:
//   1. User logs in → we have a JWT token
//   2. We connect: ws://localhost/ws?token=<jwt>
//   3. Backend verifies JWT, sends { type: "connected" }
//   4. Worker detects person → backend broadcasts { type: "alert", payload: {...} }
//   5. Hook calls onMessage(alert) → parent updates state → UI shows alert

import { useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "../api/types";

interface UseWebSocketOptions {
  token:      string | null;
  onMessage:  (msg: WsMessage) => void;
  enabled?:   boolean;
}

export function useWebSocket({ token, onMessage, enabled = true }: UseWebSocketOptions) {
  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef   = useRef(onMessage);

  // Keep the callback ref fresh so we don't need it as a dep
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!token || !enabled) return;

    // Use the same host/port as the page (Vite proxy forwards /ws to backend)
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?token=${token}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected ✅");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        onMessageRef.current(msg);
      } catch {
        console.warn("WS: invalid JSON received");
      }
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed (code: ${event.code})`);
      if (event.code !== 1000) {
        // Abnormal close — reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
    };
  }, [token, enabled]);

  useEffect(() => {
    connect();

    // Cleanup: close WS and cancel pending reconnect timer when component unmounts
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000, "unmount");
    };
  }, [connect]);

  // Expose a way for components to send messages to the backend (optional)
  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
