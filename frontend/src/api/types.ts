// frontend/src/api/types.ts
// Shared TypeScript types that mirror the DB schema and API responses.
// Keep these in sync with the backend schema.sql

export interface Camera {
  id:         string;
  name:       string;
  rtsp_url:   string;
  location:   string | null;
  enabled:    boolean;
  created_at: string;
  updated_at: string;
}

export type StreamStatus = "idle" | "connecting" | "live" | "stopped" | "error";

export interface Alert {
  id:           string;
  camera_id:    string;
  event_type:   string;
  timestamp:    string;
  confidence:   number;
  bounding_box: { x: number; y: number; width: number; height: number; frame_width?: number; frame_height?: number } | null;
  frame_number: number | null;
  created_at:   string;
}

export interface User {
  id:       string;
  username: string;
}

// WebSocket message from the backend hub
export interface WsMessage {
  type:    "connected" | "alert" | "error" | "stream_status";
  payload: Alert | { userId: string; username: string } | { message: string } | StreamStatusPayload;
}

export interface StreamStatusPayload {
  camera_id: string;
  status:    StreamStatus;
}

// API response shapes
export interface PaginatedAlerts {
  alerts: Alert[];
  pagination: {
    page:        number;
    limit:       number;
    total:       number;
    total_pages: number;
  };
}
