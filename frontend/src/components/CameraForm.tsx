// frontend/src/components/CameraForm.tsx
import { useState, useEffect } from "react";
import type { Camera } from "../api/types";

interface CameraFormProps {
  camera: Camera | null;
  onSave: (data: { name: string; rtsp_url: string; location: string; enabled: boolean }) => Promise<void>;
  onClose: () => void;
}

export default function CameraForm({ camera, onSave, onClose }: CameraFormProps) {
  const [name, setName] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const [location, setLocation] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (camera) {
      setName(camera.name);
      setRtspUrl(camera.rtsp_url);
      setLocation(camera.location || "");
      setEnabled(camera.enabled);
    } else {
      setName("");
      setRtspUrl("");
      setLocation("");
      setEnabled(true);
    }
  }, [camera]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSave({ name, rtsp_url: rtspUrl, location, enabled });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save camera");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{camera ? "Edit Camera Configuration" : "Register New Camera"}</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="login-form">
              {error && <div className="form-error">⚠️ {error}</div>}

              <div className="form-group">
                <label htmlFor="camera-name">Camera Name</label>
                <input
                  id="camera-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Front Door Office"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="camera-rtsp">RTSP Stream URL</label>
                <input
                  id="camera-rtsp"
                  type="text"
                  value={rtspUrl}
                  onChange={e => setRtspUrl(e.target.value)}
                  placeholder="rtsp://username:password@ip:port/stream"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="camera-location">Location / Zone</label>
                <input
                  id="camera-location"
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. Ground Floor, Exit Corridor"
                />
              </div>

              <div className="form-group" style={{ flexDirection: "row", alignItems: "center", gap: "10px" }}>
                <input
                  id="camera-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  style={{ width: "auto", cursor: "pointer" }}
                />
                <label htmlFor="camera-enabled" style={{ cursor: "pointer", textTransform: "none" }}>
                  Enable Real-Time AI Inference
                </label>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving..." : camera ? "Save Changes" : "Register Camera"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
