// frontend/src/components/AlertFeed.tsx
import type { Alert, Camera } from "../api/types";

interface AlertFeedProps {
  alerts: Alert[];
  cameras: Camera[];
}

export default function AlertFeed({ alerts, cameras }: AlertFeedProps) {
  const cameraMap = new Map(cameras.map(c => [c.id, c.name]));

  function formatTime(timestamp: string) {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return timestamp;
    }
  }

  return (
    <div className="alerts-section">
      <div className="alerts-header">
        <h2>Live Security Feed</h2>
        <span style={{
          backgroundColor: "rgba(244, 63, 94, 0.15)",
          color: "var(--accent-rose)",
          fontSize: "11px",
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: "20px",
          border: "1px solid rgba(244, 63, 94, 0.3)"
        }}>
          ● Alerts
        </span>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "var(--text-muted)",
            fontSize: "13px"
          }}>
            No security events detected. Watching streams...
          </div>
        ) : (
          alerts.map((alert) => {
            const cameraName = cameraMap.get(alert.camera_id) || "Unknown Camera";
            return (
              <div key={alert.id} className="alert-item unread">
                <div className="alert-meta">
                  <span className="alert-camera">🚨 {cameraName}</span>
                  <span className="alert-time">{formatTime(alert.timestamp)}</span>
                </div>
                <div className="alert-message">
                  Person detected!
                </div>
                <div className="alert-confidence">
                  {(alert.confidence * 100).toFixed(0)}% Match
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
