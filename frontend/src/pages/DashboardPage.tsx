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
  const [latestAlerts, setLatestAlerts] = useState<Record<string, Alert>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Layout & Filter UX States
  const [gridSize, setGridSize] = useState<"adaptive" | "1" | "2" | "3">("adaptive");
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [hoveredCameraId, setHoveredCameraId] = useState<string | null>(null);
  const [unreadAlertCounts, setUnreadAlertCounts] = useState<Record<string, number>>({});

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback((msg: WsMessage) => {
    console.log("WebSocket Message Received:", msg);
    if (msg.type === "alert") {
      const alertPayload = msg.payload as Alert;
      setAlerts((prev) => [alertPayload, ...prev].slice(0, 100));
      // Track latest alert per camera for bounding box overlay
      setLatestAlerts((prev) => ({ ...prev, [alertPayload.camera_id]: alertPayload }));

      // Increment unread count if the user is not currently viewing only this camera's timeline
      setSelectedCameraId((currentSelected) => {
        if (currentSelected !== alertPayload.camera_id) {
          setUnreadAlertCounts((prev) => ({
            ...prev,
            [alertPayload.camera_id]: (prev[alertPayload.camera_id] || 0) + 1,
          }));
        }
        return currentSelected;
      });
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

  // Handlers for dynamic actions
  const handleSelectCamera = useCallback((cameraId: string | null) => {
    setSelectedCameraId(cameraId);
    if (cameraId) {
      // Clear alert counter when selecting/focusing camera filter
      setUnreadAlertCounts((prev) => ({ ...prev, [cameraId]: 0 }));
    }
  }, []);

  const handleFocusCamera = useCallback((cameraId: string) => {
    // Toggle: if clicked again, reset filter to All. Otherwise, set filter.
    setSelectedCameraId((prev) => (prev === cameraId ? null : cameraId));
    setUnreadAlertCounts((prev) => ({ ...prev, [cameraId]: 0 }));
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

        {/* Layout Preset Controls */}
        {cameras.length > 0 && (
          <div className="layout-selector">
            <button
              className={`layout-btn ${gridSize === "adaptive" ? "active" : ""}`}
              onClick={() => setGridSize("adaptive")}
              title="Automatic responsive grid columns"
            >
              Auto-Grid
            </button>
            <button
              className={`layout-btn ${gridSize === "1" ? "active" : ""}`}
              onClick={() => setGridSize("1")}
              title="1x1 single camera focus"
            >
              1x1 Detail
            </button>
            <button
              className={`layout-btn ${gridSize === "2" ? "active" : ""}`}
              onClick={() => setGridSize("2")}
              title="2x2 grid view"
            >
              2x2 Grid
            </button>
            <button
              className={`layout-btn ${gridSize === "3" ? "active" : ""}`}
              onClick={() => setGridSize("3")}
              title="3x3 high-density grid view"
            >
              3x3 Grid
            </button>
          </div>
        )}
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
            <div className={`cameras-grid cols-${gridSize}`}>
              {cameras.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  initialStatus={cameraStatuses[camera.id] || "stopped"}
                  latestAlert={latestAlerts[camera.id] ?? null}
                  isHighlighted={hoveredCameraId === camera.id}
                  unreadCount={unreadAlertCounts[camera.id] || 0}
                  onFocus={() => handleFocusCamera(camera.id)}
                />
              ))}
            </div>
          </div>

          {/* Live Alert Feed */}
          <AlertFeed
            alerts={alerts}
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCamera={handleSelectCamera}
            onHoverCamera={setHoveredCameraId}
            onLeaveCamera={() => setHoveredCameraId(null)}
          />
        </div>
      )}
    </div>
  );
}
