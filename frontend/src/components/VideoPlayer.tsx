// frontend/src/components/VideoPlayer.tsx
import { useEffect, useRef, useState } from "react";
import type { StreamStatus } from "../api/types";

interface VideoPlayerProps {
  cameraId: string;
  status: StreamStatus;
  token: string | null;
}

export default function VideoPlayer({ cameraId, status, token }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [internalStatus, setInternalStatus] = useState<string>("");
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  useEffect(() => {
    // If the camera is not live or we don't have auth, clear the peer connection
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

        // 1. Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        // 2. Track connection state
        pc.onconnectionstatechange = () => {
          console.log(`WebRTC State: ${pc.connectionState}`);
          setInternalStatus(`WebRTC: ${pc.connectionState}`);
          if (pc.connectionState === "failed") {
            setWebrtcError("WebRTC Connection Failed. Check server logs.");
          }
        };

        // 3. Receive remote stream track
        pc.ontrack = (event) => {
          console.log("WebRTC track received ✅");
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          }
        };

        // WebRTC requires a video track or transceiver to start negotiation
        pc.addTransceiver("video", { direction: "recvonly" });

        // 4. Create local offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete so localDescription includes all ICE candidates
        setInternalStatus("Gathering ICE candidates...");
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") {
            resolve();
          } else {
            const checkState = () => {
              if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", checkState);
                resolve();
              }
            };
            pc.addEventListener("icegatheringstatechange", checkState);
          }
        });

        // 5. Send offer to backend
        setInternalStatus("Sending SDP offer...");
        const response = await fetch(`/api/webrtc/${cameraId}/offer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sdp: pc.localDescription?.sdp, type: pc.localDescription?.type }),
        });

        if (!response.ok) {
          throw new Error(`Offer failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.sdp) {
          throw new Error("Invalid SDP answer received from server");
        }

        // 6. Set remote description (SDP Answer)
        setInternalStatus("Setting remote description...");
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: data.sdp })
        );

        setInternalStatus("Connected to stream");
      } catch (err) {
        console.error("WebRTC Setup Error:", err);
        setWebrtcError(err instanceof Error ? err.message : "WebRTC error");
        setInternalStatus("WebRTC Setup Failed");
      }
    }

    startWebRTC();

    return () => {
      cleanup();
    };
  }, [cameraId, status, token]);

  function cleanup() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  if (status === "idle" || status === "stopped") {
    return (
      <div className="video-placeholder">
        <span style={{ fontSize: "32px" }}>💤</span>
        <span>Stream is offline</span>
        <span style={{ fontSize: "12px", opacity: 0.6 }}>Click Start in the controls below</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="video-placeholder">
        <span className="brand-icon" style={{ animation: "spin 2s linear infinite" }}>🔄</span>
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
      />

      {/* Floating status & error messages */}
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
