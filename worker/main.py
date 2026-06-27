# worker/main.py
#
# FastAPI application — the HTTP server the backend talks to.
#
# ENDPOINTS:
#   POST /cameras/{camera_id}/start   — backend calls this to start a stream
#   POST /cameras/{camera_id}/stop    — backend calls this to stop a stream
#   GET  /cameras/{camera_id}/status  — get live stats for a camera
#   GET  /cameras                     — list all active cameras
#   GET  /health                      — service health check
#
# WebRTC signaling endpoints (Phase 4 — stubbed here):
#   POST /webrtc/{camera_id}/offer    — browser SDP offer forwarded from backend
#   POST /webrtc/{camera_id}/ice      — ICE candidate exchange
#
# AUTH:
#   All endpoints require the X-Worker-Secret header.
#   This matches the workerAuthMiddleware in the Bun backend.

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from camera_manager import CameraManager
from api_client import api_client

# ─── Logging ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Load .env manually if running locally outside of Docker
import os
for dotenv_path in ["../.env", ".env"]:
    if os.path.exists(dotenv_path):
        with open(dotenv_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key] = val.strip()

WORKER_SECRET = os.getenv("WORKER_SECRET", "internal_worker_secret")

# Global manager instance (initialized in lifespan)
manager: Optional[CameraManager] = None


# ─── Lifespan (startup / shutdown) ────────────────────────────────────────
# FastAPI's modern way to run code on startup and shutdown.
# Replaces the old @app.on_event("startup") pattern.
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize resources on startup, clean up on shutdown."""
    global manager

    # Get the running event loop — streams need this to post alerts asynchronously
    loop = asyncio.get_running_loop()
    manager = CameraManager(event_loop=loop)

    # Pre-load the YOLOv8 model now so the first camera start isn't slow
    logger.info("Pre-loading YOLOv8n model...")
    from detection import get_model
    get_model()

    logger.info("Worker started and ready")

    yield  # Application runs here

    # Shutdown: stop all cameras and close HTTP client
    logger.info("Shutting down worker...")
    if manager:
        manager.stop_all()
    await api_client.close()
    logger.info("Worker shutdown complete")


# ─── App ──────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SentinelStream Worker",
    description="Camera RTSP ingestion + person detection service",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow the backend to call us (CORS not strictly needed for server-to-server,
# but useful if you ever add a dev UI to the worker)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Auth Dependency ──────────────────────────────────────────────────────
# FastAPI "dependency" — a function that runs before each request handler.
# If the header is wrong, FastAPI returns 401 automatically.
async def verify_worker_secret(x_worker_secret: str = Header(...)):
    """Verify the shared secret so only the backend can call this API."""
    if x_worker_secret != WORKER_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ─── Request / Response Models ─────────────────────────────────────────────
class StartCameraRequest(BaseModel):
    camera_id: str
    rtsp_url:  str

class SdpRequest(BaseModel):
    sdp:  str
    type: str = "offer"

class IceCandidateRequest(BaseModel):
    candidate:     str
    sdpMid:        Optional[str] = None
    sdpMLineIndex: Optional[int] = None


# ─── Camera Routes ─────────────────────────────────────────────────────────
@app.post(
    "/cameras/{camera_id}/start",
    dependencies=[Depends(verify_worker_secret)],
)
async def start_camera(camera_id: str, body: StartCameraRequest):
    """
    Start RTSP ingestion and detection for a camera.
    Called by the Bun backend when the user clicks "Start" on the dashboard.
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Manager not initialized")

    result = manager.start_camera(
        camera_id=camera_id,
        rtsp_url=body.rtsp_url,
    )
    return result


@app.post(
    "/cameras/{camera_id}/stop",
    dependencies=[Depends(verify_worker_secret)],
)
async def stop_camera(camera_id: str):
    """Stop streaming for a camera."""
    if not manager:
        raise HTTPException(status_code=503, detail="Manager not initialized")

    result = manager.stop_camera(camera_id)
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail="Camera not running")

    return result


@app.get(
    "/cameras/{camera_id}/status",
    dependencies=[Depends(verify_worker_secret)],
)
async def get_camera_status(camera_id: str):
    """Get live stats for a camera (FPS, detections, state)."""
    if not manager:
        raise HTTPException(status_code=503, detail="Manager not initialized")

    stats = manager.get_status(camera_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Camera not found")

    return {"camera_id": camera_id, "stats": stats}


@app.get(
    "/cameras",
    dependencies=[Depends(verify_worker_secret)],
)
async def list_cameras():
    """List all active camera streams and their stats."""
    if not manager:
        return {"cameras": {}}
    return {"cameras": manager.get_all_statuses()}


# ─── WebRTC Routes (Phase 4) ──────────────────────────────────────────────
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
from webrtc_peer import CameraVideoTrack

@app.post(
    "/webrtc/{camera_id}/offer",
    dependencies=[Depends(verify_worker_secret)],
)
async def webrtc_offer(camera_id: str, body: SdpRequest):
    """
    Handle WebRTC SDP offer and return SDP answer.
    Creates a new RTCPeerConnection, registers a CameraVideoTrack to feed
    frames from the OpenCV camera thread, and returns the generated answer.
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Manager not initialized")

    stream = manager._cameras.get(camera_id)
    if not stream:
        raise HTTPException(status_code=404, detail="Camera stream not running")

    try:
        # Create peer connection with Google STUN configuration
        config = RTCConfiguration(
            iceServers=[RTCIceServer(urls="stun:stun.l.google.com:19302")]
        )
        pc = RTCPeerConnection(configuration=config)
        stream._pcs.add(pc)

        # Create custom video track and add to stream and pc
        track = CameraVideoTrack()
        stream.add_webrtc_track(track)
        pc.addTrack(track)

        # Clean up connection when closed or failed
        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            logger.info(f"WebRTC connection state for camera {camera_id}: {pc.connectionState}")
            if pc.connectionState in ["failed", "closed"]:
                stream.remove_webrtc_track(track)
                stream._pcs.discard(pc)
                try:
                    await pc.close()
                except Exception:
                    pass

        # Set remote offer description
        offer = RTCSessionDescription(sdp=body.sdp, type=body.type)
        await pc.setRemoteDescription(offer)

        # Create local answer description
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        # Wait for ICE candidate gathering to finish so the SDP answer
        # contains all candidates (no trickle ICE needed).
        if pc.iceGatheringState != "complete":
            gathering_future = asyncio.Future()

            @pc.on("icegatheringstatechange")
            def on_icegatheringstatechange():
                if pc.iceGatheringState == "complete":
                    if not gathering_future.done():
                        gathering_future.set_result(None)

            if pc.iceGatheringState == "complete":
                gathering_future.set_result(None)

            try:
                await asyncio.wait_for(gathering_future, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning(f"ICE gathering timed out for camera {camera_id}")

        return {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type,
        }
    except Exception as e:
        logger.error(f"Error establishing WebRTC connection for camera {camera_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"WebRTC offer failed: {str(e)}")


@app.post(
    "/webrtc/{camera_id}/ice",
    dependencies=[Depends(verify_worker_secret)],
)
async def webrtc_ice(camera_id: str, body: IceCandidateRequest):
    """Handle ICE candidate — stubbed as non-trickle ICE is used."""
    return {"ok": True}


# ─── Health Check ─────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    active = len(manager.get_all_statuses()) if manager else 0
    return {
        "status": "ok",
        "service": "sentinel-worker",
        "active_cameras": active,
    }
