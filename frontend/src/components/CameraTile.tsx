import { useState, useEffect } from "react";
import type { Alert, Camera, StreamStatus } from "../api/types";
import { camerasApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import VideoPlayer from "./VideoPlayer";

interface CameraTileProps {
  camera: Camera;
  initialStatus: StreamStatus;
  latestAlert?: Alert | null;
  isHighlighted?: boolean;
  unreadCount?: number;
  onFocus?: () => void;
}

export default function CameraTile({
  camera,
  initialStatus,
  latestAlert,
  isHighlighted = false,
  unreadCount = 0,
  onFocus,
}: CameraTileProps) {
  const { token } = useAuth();
  const [status, setStatus] = useState<StreamStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ fps: number; detections_per_min: number; current_count?: number } | null>(null);

  // Synchronize state with initialStatus prop (from parent/WebSocket)
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  // Check initial stream status on mount
  useEffect(() => {
    async function checkInitialStatus() {
      try {
        const res = await camerasApi.status(camera.id);
        if (res.stats && res.stats.state) {
          setStatus(res.stats.state as StreamStatus);
        }
      } catch (err) {
        console.debug("Failed to fetch initial camera status:", err);
        setStatus("stopped");
      }
    }
    checkInitialStatus();
  }, [camera.id]);

  // Poll camera stats and connection state when stream is live or connecting
  useEffect(() => {
    if (status !== "live" && status !== "connecting") {
      setStats(null);
      return;
    }

    async function fetchStats() {
      try {
        const res = await camerasApi.status(camera.id);
        if (res.stats) {
          setStats({
            fps: res.stats.fps,
            detections_per_min: res.stats.detections_per_min,
            current_count: res.stats.current_count,
          });
          if (res.stats.state && res.stats.state !== status) {
            setStatus(res.stats.state as StreamStatus);
          }
        }
      } catch (err) {
        console.debug("Failed to fetch camera stats:", err);
        if (status === "live") {
          setStatus("error");
        }
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 2000);

    return () => clearInterval(interval);
  }, [camera.id, status]);

  async function handleStart() {
    try {
      setLoading(true);
      setStatus("connecting");
      await camerasApi.start(camera.id);
      setStatus("live");
    } catch (err) {
      console.error(err);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    try {
      setLoading(true);
      await camerasApi.stop(camera.id);
      setStatus("stopped");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const handleTileClick = (e: React.MouseEvent) => {
    // Prevent focus filter if the user clicked one of the operational control buttons
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    onFocus?.();
  };

  return (
    <div 
      className={`camera-tile ${isHighlighted ? "highlighted" : ""}`}
      onClick={handleTileClick}
    >
      <div className="camera-header">
        <div className="camera-title-group">
          <span style={{ fontSize: "16px" }}>🎥</span>
          <div>
            <div className="camera-name">{camera.name}</div>
            {camera.location && <div className="camera-location">{camera.location}</div>}
          </div>
        </div>
         <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {status === "live" && stats && stats.current_count !== undefined && stats.current_count > 0 && (
            <span className="tile-badge" style={{ backgroundColor: "var(--accent-rose)" }}>
              👥 {stats.current_count}
            </span>
          )}
          <span className={`status-badge status-${status}`}>
            {status}
          </span>
          {status === "live" && (
            <button
              onClick={handleStop}
              disabled={loading}
              style={{
                padding: "3px 10px",
                fontSize: "11px",
                background: "rgba(244,63,94,0.2)",
                border: "1px solid rgba(244,63,94,0.6)",
                borderRadius: "6px",
                color: "#f43f5e",
                cursor: "pointer",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      <div className="video-container">
        <VideoPlayer cameraId={camera.id} status={status} token={token} latestAlert={latestAlert} />
      </div>

      <div className="camera-controls">
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "2px" }}>
          <span>{camera.enabled ? "⚡ AI Inference Active" : "⏸️ AI Inference Paused"}</span>
          {status === "live" && stats && (
            <span style={{ color: "var(--accent-cyan)", fontFamily: "monospace" }}>
              FPS: {stats.fps} | Detections/Min: {stats.detections_per_min}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {status === "live" ? (
            <button
              onClick={handleStop}
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              disabled={loading}
            >
              ⏹️ Stop Stream
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="btn btn-primary"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              disabled={loading}
            >
              ▶️ Live Feed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
