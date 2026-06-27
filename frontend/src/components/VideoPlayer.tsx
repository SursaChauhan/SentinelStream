// frontend/src/components/VideoPlayer.tsx
import { useEffect, useRef, useState } from "react";
import type { Alert, StreamStatus } from "../api/types";

interface VideoPlayerProps {
  cameraId: string;
  status: StreamStatus;
  token: string | null;
  latestAlert?: Alert | null;
}

export default function VideoPlayer({ cameraId, status, token, latestAlert }: VideoPlayerProps) {
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const pcRef     = useRef<RTCPeerConnection | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [internalStatus, setInternalStatus] = useState<string>("");
  const [webrtcError, setWebrtcError]       = useState<string | null>(null);
  const [showBox, setShowBox]               = useState(false);
  const [activeAlert, setActiveAlert]       = useState<Alert | null>(null);

  // Show the bounding box overlay for 10 seconds when a new detection arrives
  useEffect(() => {
    if (!latestAlert?.bounding_box) return;
    let bb = latestAlert.bounding_box;
    if (typeof bb === "string") {
      try {
        bb = JSON.parse(bb);
      } catch (err) {
        console.error("Failed to parse bounding_box string:", err);
        return;
      }
    }
    if (!bb || !bb.width || !bb.height) return;

    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setActiveAlert({
      ...latestAlert,
      bounding_box: bb,
    });
    setShowBox(true);

    fadeTimer.current = setTimeout(() => {
      setShowBox(false);
    }, 10000);

    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [latestAlert]);

  // WebRTC connection lifecycle
  useEffect(() => {
    if (status !== "live" || !token) {
      cleanup();
      setInternalStatus("");
      return;
    }

    async function startWebRTC() {
      try {
        cleanup();
        setInternalStatus("Negotiating WebRTC...");
        setWebrtcError(null);

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          setInternalStatus(`WebRTC: ${pc.connectionState}`);
          if (pc.connectionState === "failed") {
            setWebrtcError("WebRTC connection failed. Check server logs.");
          }
        };

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          }
        };

        pc.addTransceiver("video", { direction: "recvonly" });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        setInternalStatus("Gathering ICE candidates...");
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") {
            resolve();
          } else {
            const check = () => {
              if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", check);
                resolve();
              }
            };
            pc.addEventListener("icegatheringstatechange", check);
          }
        });

        setInternalStatus("Sending SDP offer...");
        const response = await fetch(`/api/webrtc/${cameraId}/offer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sdp: pc.localDescription?.sdp, type: pc.localDescription?.type }),
        });

        if (!response.ok) throw new Error(`Offer failed: ${response.statusText}`);

        const data = await response.json();
        if (!data.sdp) throw new Error("Invalid SDP answer received from server");

        setInternalStatus("Setting remote description...");
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
        setInternalStatus("WebRTC: connected");
      } catch (err) {
        console.error("WebRTC Setup Error:", err);
        setWebrtcError(err instanceof Error ? err.message : "WebRTC error");
        setInternalStatus("WebRTC Setup Failed");
      }
    }

    startWebRTC();
    return () => { cleanup(); };
  }, [cameraId, status, token]);

  function cleanup() {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowBox(false);
  }

  if (status === "idle" || status === "stopped") {
    return (
      <div className="video-placeholder">
        <span style={{ fontSize: "32px" }}>💤</span>
        <span>Stream is offline</span>
        <span style={{ fontSize: "12px", opacity: 0.6 }}>Click Live Feed to start</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="video-placeholder">
        <span style={{ animation: "spin 2s linear infinite" }}>🔄</span>
        <span>Connecting to camera...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="video-placeholder" style={{ color: "var(--accent-rose)" }}>
        <span style={{ fontSize: "32px" }}>⚠️</span>
        <span>Camera stream error</span>
        <span style={{ fontSize: "11px", opacity: 0.8 }}>Verify RTSP URL and worker logs</span>
      </div>
    );
  }



  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <video
        ref={videoRef}
        className="video-player"
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: "contain",
          objectPosition: "center",
        }}
      />

      {/* Connection status badge */}
      <div className="video-overlay" style={{ left: "12px", right: "auto" }}>
        <div
          className="overlay-stat"
          style={{
            backgroundColor: webrtcError ? "rgba(244,63,94,0.8)" : "rgba(0,0,0,0.6)",
            color: "#fff",
            fontSize: "10px",
          }}
        >
          {webrtcError ? `⚠️ ${webrtcError}` : internalStatus}
        </div>
      </div>
    </div>
  );
}
