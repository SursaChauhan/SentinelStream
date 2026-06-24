import { useState, useEffect } from "react";
import type { Camera, StreamStatus } from "../api/types";
import { camerasApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import VideoPlayer from "./VideoPlayer";

interface CameraTileProps {
  camera: Camera;
  initialStatus: StreamStatus;
}

export default function CameraTile({ camera, initialStatus }: CameraTileProps) {
  const { token } = useAuth();
  const [status, setStatus] = useState<StreamStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ fps: number; detections_per_min: number } | null>(null);

  // Poll camera stats when stream is live
  useEffect(() => {
    if (status !== "live") {
      setStats(null);
      return;
    }

    async function fetchStats() {
      try {
        const res = await camerasApi.status(camera.id);
        setStats({
          fps: res.stats.fps,
          detections_per_min: res.stats.detections_per_min,
        });
      } catch (err) {
        console.debug("Failed to fetch camera stats:", err);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 3000);

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

  return (
    <div className="camera-tile">
      <div className="camera-header">
        <div className="camera-title-group">
          <span style={{ fontSize: "16px" }}>🎥</span>
          <div>
            <div className="camera-name">{camera.name}</div>
            {camera.location && <div className="camera-location">{camera.location}</div>}
          </div>
        </div>
        <span className={`status-badge status-${status}`}>
          {status}
        </span>
      </div>

      <div className="video-container">
        <VideoPlayer cameraId={camera.id} status={status} token={token} />
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
              ⏹️ Stop
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
