// frontend/src/pages/CamerasPage.tsx
import { useState, useEffect } from "react";
import { camerasApi } from "../api/client";
import type { Camera } from "../api/types";
import CameraForm from "../components/CameraForm";

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);

  async function fetchCameras() {
    try {
      setLoading(true);
      const res = await camerasApi.list();
      setCameras(res.cameras);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cameras");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCameras();
  }, []);

  async function handleSave(data: { name: string; rtsp_url: string; location: string; enabled: boolean }) {
    if (editingCamera) {
      const res = await camerasApi.update(editingCamera.id, data);
      setCameras(prev => prev.map(c => c.id === editingCamera.id ? res.camera : c));
    } else {
      const res = await camerasApi.create(data);
      setCameras(prev => [...prev, res.camera]);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this camera? All associated alert histories will be deleted.")) return;
    try {
      await camerasApi.delete(id);
      setCameras(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete camera");
    }
  }

  return (
    <div>
      <div className="header-actions">
        <div>
          <h1>Camera Inventory</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Add, update, or delete your RTSP camera connections.
          </p>
        </div>
        <button
          onClick={() => { setEditingCamera(null); setIsFormOpen(true); }}
          className="btn btn-primary"
        >
          ➕ Register Camera
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Loading camera configuration...
        </div>
      ) : error ? (
        <div className="form-error">⚠️ {error}</div>
      ) : cameras.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "60px 40px",
          background: "var(--bg-card)",
          borderRadius: "12px",
          border: "1px dashed var(--border-color)"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px", display: "block" }}>🎥</span>
          <h3>No Cameras Registered</h3>
          <p style={{ color: "var(--text-secondary)", margin: "8px 0 20px" }}>
            Get started by adding your first RTSP stream.
          </p>
          <button
            onClick={() => { setEditingCamera(null); setIsFormOpen(true); }}
            className="btn btn-primary"
          >
            Register Camera
          </button>
        </div>
      ) : (
        <div className="cameras-table-container">
          <table className="cameras-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location / Zone</th>
                <th>RTSP Destination URL</th>
                <th>Inference State</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cameras.map(camera => (
                <tr key={camera.id}>
                  <td style={{ fontWeight: 600 }}>{camera.name}</td>
                  <td>
                    {camera.location ? (
                      <span style={{
                        background: "rgba(255,255,255,0.05)",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "12px"
                      }}>
                        {camera.location}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Not set</span>
                    )}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)" }}>
                    {camera.rtsp_url.length > 50 ? camera.rtsp_url.substring(0, 50) + "..." : camera.rtsp_url}
                  </td>
                  <td>
                    <span className={`status-badge ${camera.enabled ? "status-live" : "status-idle"}`}>
                      {camera.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="camera-action-btns" style={{ justifyContent: "flex-end" }}>
                      <button
                        onClick={() => { setEditingCamera(camera); setIsFormOpen(true); }}
                        className="btn btn-secondary"
                        style={{ padding: "6px 12px" }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDelete(camera.id)}
                        className="btn btn-danger"
                        style={{ padding: "6px 12px" }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <CameraForm
          camera={editingCamera}
          onSave={handleSave}
          onClose={() => { setIsFormOpen(false); setEditingCamera(null); }}
        />
      )}
    </div>
  );
}
