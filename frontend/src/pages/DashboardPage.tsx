// frontend/src/pages/DashboardPage.tsx
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { camerasApi, alertsApi } from "../api/client";
import type { Camera, Alert, StreamStatus, WsMessage } from "../api/types";
import { useWebSocket } from "../hooks/useWebSocket";
import CameraTile from "../components/CameraTile";
import AlertFeed from "../components/AlertFeed";

export default function DashboardPage() {
  const { token } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cameraStatuses, setCameraStatuses] = useState<Record<string, StreamStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback((msg: WsMessage) => {
    console.log("WebSocket Message Received:", msg);
    if (msg.type === "alert") {
      const alertPayload = msg.payload as Alert;
      setAlerts((prev) => [alertPayload, ...prev].slice(0, 100)); // Limit to last 100 alerts in state
    } else if (msg.type === "stream_status") {
      const statusPayload = msg.payload as { camera_id: string; status: StreamStatus };
      if (statusPayload && statusPayload.camera_id) {
        setCameraStatuses((prev) => ({
          ...prev,
          [statusPayload.camera_id]: statusPayload.status,
        }));
      }
    }
  }, []);

  // Initialize WebSocket connection
  useWebSocket({
    token,
    onMessage: handleWsMessage,
    enabled: !!token,
  });

  useEffect(() => {
    async function initDashboard() {
      try {
        setLoading(true);
        // Load cameras and initial historical alerts parallelly
        const [camerasRes, alertsRes] = await Promise.all([
          camerasApi.list(),
          alertsApi.list({ limit: 30 }),
        ]);

        setCameras(camerasRes.cameras);
        setAlerts(alertsRes.alerts);

        // Initialize statuses of all cameras (start as idle/stopped by default or whatever we prefer)
        const initialStatuses: Record<string, StreamStatus> = {};
        camerasRes.cameras.forEach((camera) => {
          initialStatuses[camera.id] = "stopped";
        });
        setCameraStatuses(initialStatuses);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }

    initDashboard();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px", color: "var(--text-secondary)" }}>
        Initializing dashboard systems...
      </div>
    );
  }

  if (error) {
    return <div className="form-error">⚠️ {error}</div>;
  }

  return (
    <div>
      <div className="header-actions">
        <div>
          <h1>Surveillance Hub</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Real-time feed ingestion & YOLOv8-powered person detection.
          </p>
        </div>
      </div>

      {cameras.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "60px 40px",
          background: "var(--bg-card)",
          borderRadius: "12px",
          border: "1px dashed var(--border-color)",
          marginTop: "20px"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px", display: "block" }}>📊</span>
          <h3>No Camera Streams Configured</h3>
          <p style={{ color: "var(--text-secondary)", margin: "8px 0 20px" }}>
            To view the real-time feed and receive alerts, first register your cameras in the manager.
          </p>
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Cameras Grid */}
          <div className="video-section">
            <div className="cameras-grid">
              {cameras.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  initialStatus={cameraStatuses[camera.id] || "stopped"}
                />
              ))}
            </div>
          </div>

          {/* Live Alert Feed */}
          <AlertFeed alerts={alerts} cameras={cameras} />
        </div>
      )}
    </div>
  );
}
