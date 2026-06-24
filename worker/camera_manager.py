# worker/camera_manager.py
#
# CameraManager — manages ALL active camera streams in the worker.
#
# Think of this as a registry: it maps camera_id → CameraStream.
# The FastAPI routes call manager.start() and manager.stop().
# Each camera is fully independent — stopping one doesn't affect others.

import asyncio
import logging
from typing import Optional

from stream import CameraStream, StreamState, StreamStats

logger = logging.getLogger(__name__)


class CameraManager:
    """
    Manages the lifecycle of all camera streams.
    
    One instance of this is created at app startup and shared across all requests.
    (FastAPI dependency injection via app.state)
    """

    def __init__(self, event_loop: asyncio.AbstractEventLoop):
        # The event loop is passed in from main.py so stream threads
        # can schedule async tasks on it (for posting alerts)
        self._loop = event_loop
        self._cameras: dict[str, CameraStream] = {}

    def start_camera(self, camera_id: str, rtsp_url: str) -> dict:
        """
        Start streaming for a camera. Creates a new CameraStream if needed.
        
        Returns a status dict so the API can respond to the frontend.
        """
        if camera_id in self._cameras:
            existing = self._cameras[camera_id]
            if existing.stats.state == StreamState.LIVE:
                return {"status": "already_running", "camera_id": camera_id}
            # If it's in a stopped/error state, remove it and restart
            del self._cameras[camera_id]

        stream = CameraStream(
            camera_id=camera_id,
            rtsp_url=rtsp_url,
            event_loop=self._loop,
        )
        self._cameras[camera_id] = stream
        stream.start()

        logger.info(f"Started camera: {camera_id} → {rtsp_url}")
        return {"status": "starting", "camera_id": camera_id}

    def stop_camera(self, camera_id: str) -> dict:
        """
        Stop streaming for a camera and remove it from the registry.
        """
        stream = self._cameras.get(camera_id)
        if not stream:
            return {"status": "not_found", "camera_id": camera_id}

        stream.stop()
        del self._cameras[camera_id]

        logger.info(f"Stopped camera: {camera_id}")
        return {"status": "stopped", "camera_id": camera_id}

    def get_status(self, camera_id: str) -> Optional[StreamStats]:
        """Get live stats for a specific camera."""
        stream = self._cameras.get(camera_id)
        return stream.stats if stream else None

    def get_all_statuses(self) -> dict[str, StreamStats]:
        """Get stats for all cameras. Used for health checks."""
        return {cid: s.stats for cid, s in self._cameras.items()}

    def stop_all(self):
        """Graceful shutdown — stop all cameras (called on app shutdown)."""
        logger.info(f"Stopping all {len(self._cameras)} camera(s)...")
        for camera_id, stream in list(self._cameras.items()):
            stream.stop()
        self._cameras.clear()
        logger.info("All cameras stopped")
