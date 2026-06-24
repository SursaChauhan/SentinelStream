// frontend/src/api/client.ts
//
// Thin wrapper around fetch() that:
//   1. Automatically adds the JWT Authorization header
//   2. Centralizes the base URL
//   3. Throws meaningful errors on non-2xx responses
//
// WHY not axios?
//   fetch() is built into browsers — no extra dependency needed.
//   For our use case it's plenty powerful.

const BASE = "";  // empty = same origin (Vite proxy handles routing to backend)

// Read the JWT from localStorage.
// We store it there after login (see AuthContext).
function getToken(): string | null {
  return localStorage.getItem("sentinel_token");
}

// Generic request helper
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────
export const authApi = {
  signup: (username: string, password: string) =>
    request<{ token: string; user: { id: string; username: string } }>(
      "/api/auth/signup",
      { method: "POST", body: JSON.stringify({ username, password }) }
    ),

  login: (username: string, password: string) =>
    request<{ token: string; user: { id: string; username: string } }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) }
    ),
};

// ─── Cameras ───────────────────────────────────────────────────────────────
import type { Camera, PaginatedAlerts } from "./types";

export const camerasApi = {
  list: () =>
    request<{ cameras: Camera[] }>("/api/cameras"),

  create: (data: { name: string; rtsp_url: string; location?: string; enabled?: boolean }) =>
    request<{ camera: Camera }>("/api/cameras", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Pick<Camera, "name" | "rtsp_url" | "location" | "enabled">>) =>
    request<{ camera: Camera }>(`/api/cameras/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/api/cameras/${id}`, { method: "DELETE" }),

  start: (id: string) =>
    request<{ message: string }>(`/api/cameras/${id}/start`, { method: "POST" }),

  stop: (id: string) =>
    request<{ message: string }>(`/api/cameras/${id}/stop`, { method: "POST" }),

  status: (id: string) =>
    request<{
      camera_id: string;
      stats: {
        fps: number;
        frames_processed: number;
        detections_total: number;
        detections_per_min: number;
        state: string;
        error: string | null;
      };
    }>(`/api/cameras/${id}/status`),
};

// ─── Alerts ────────────────────────────────────────────────────────────────
export const alertsApi = {
  list: (params?: { camera_id?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.camera_id) qs.set("camera_id", params.camera_id);
    if (params?.page)      qs.set("page", String(params.page));
    if (params?.limit)     qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs}` : "";
    return request<PaginatedAlerts>(`/api/alerts${query}`);
  },
};
