# worker/api_client.py
#
# HTTP client that posts detection events to the backend API.
#
# WHY httpx (not requests)?
#   - httpx supports async/await natively — so posting alerts doesn't block the frame loop
#   - requests is synchronous — would freeze the camera thread while waiting for the API
#
# DEDUPLICATION LOGIC:
#   We don't want 30 alerts per second when a person is standing still.
#   Simple rate limit: only post one alert per camera every COOLDOWN_SECONDS.
#   Alert deduplication (by event_id) is also handled by the API.

import logging
import os
import time
import uuid
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

API_URL       = os.getenv("API_URL", "http://backend:3000")
WORKER_SECRET = os.getenv("WORKER_SECRET", "internal_worker_secret")

# Minimum seconds between alerts for the same camera
# Prevents flooding the DB with duplicate detections
COOLDOWN_SECONDS = float(os.getenv("ALERT_COOLDOWN_SECONDS", "5"))


class ApiClient:
    """
    Async HTTP client for posting detection events to the backend.

    Usage:
        client = ApiClient()
        await client.post_alert(camera_id="...", confidence=0.92, bounding_box={...})
    """

    def __init__(self):
        # Tracks last alert time per camera_id to enforce cooldown
        self._last_alert_time: dict[str, float] = {}
        # Shared async HTTP client (connection pooling, keep-alive)
        self._http = httpx.AsyncClient(
            base_url=API_URL,
            headers={"X-Worker-Secret": WORKER_SECRET},
            timeout=5.0,
        )

    async def post_alert(
        self,
        camera_id: str,
        confidence: float,
        bounding_box: dict,
        frame_number: int,
        event_type: str = "person_detected",
    ) -> bool:
        """
        Post a detection alert to the backend API.

        Returns True if the alert was sent, False if skipped (cooldown).
        """
        # --- Rate limiting (deduplication) ---
        now = time.monotonic()
        last = self._last_alert_time.get(camera_id, 0)

        if now - last < COOLDOWN_SECONDS:
            return False  # Too soon since last alert for this camera

        self._last_alert_time[camera_id] = now

        # --- Build the unified event payload ---
        # This is the EXACT format defined in the implementation plan.
        # Same shape used in: worker → API → DB → WebSocket → browser.
        payload = {
            "event_id":    str(uuid.uuid4()),      # unique ID for deduplication
            "camera_id":   camera_id,
            "event_type":  event_type,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
            "confidence":  confidence,
            "bounding_box": bounding_box,
            "frame_number": frame_number,
            "thumbnail_url": None,                 # Future: save frame crop to S3
        }

        try:
            response = await self._http.post("/api/alerts", json=payload)
            if response.status_code == 201:
                logger.info(
                    f"Alert posted: camera={camera_id} "
                    f"conf={confidence:.2f} frame={frame_number}"
                )
                return True
            else:
                logger.warning(
                    f"Alert POST failed: {response.status_code} {response.text}"
                )
                return False

        except httpx.RequestError as e:
            logger.error(f"Failed to reach backend API: {e}")
            return False

    async def close(self):
        """Close the HTTP client (call on shutdown)."""
        await self._http.aclose()


# Singleton instance — shared across all camera streams
api_client = ApiClient()
