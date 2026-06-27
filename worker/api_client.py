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

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import httpx
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# Load .env manually if running locally outside of Docker
for dotenv_path in ["../.env", ".env"]:
    if os.path.exists(dotenv_path):
        with open(dotenv_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key] = val.strip()

API_URL       = os.getenv("API_URL", "http://backend:3000")
WORKER_SECRET = os.getenv("WORKER_SECRET", "internal_worker_secret")

# Minimum seconds between alerts for the same camera
# Prevents flooding the DB with duplicate detections
COOLDOWN_SECONDS = float(os.getenv("ALERT_COOLDOWN_SECONDS", "15"))


class ApiClient:
    """
    Async client for posting detection events to the backend.
    Supports publishing to Redis Pub/Sub MQ with a fallback to direct HTTP POST.

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

        # Redis configuration (MQ)
        self.redis_url = os.getenv("REDIS_URL")
        self._redis = None

        if self.redis_url:
            # If running on host, replace 'redis' container name with 'localhost' in REDIS_URL
            # (since Docker exposes Redis port 6379 to the host).
            if "redis:6379" in self.redis_url and not os.path.exists("/.dockerenv"):
                self.redis_url = self.redis_url.replace("redis:6379", "localhost:6379")
            
            try:
                self._redis = aioredis.from_url(self.redis_url)
                logger.info(f"🔌 Redis MQ configured at {self.redis_url}")
            except Exception as e:
                logger.error(f"❌ Failed to initialize Redis client: {e}")

    async def post_alert(
        self,
        camera_id: str,
        confidence: float,
        bounding_box: dict,
        frame_number: int,
        event_type: str = "person_detected",
    ) -> bool:
        """
        Post a detection alert to the backend.
        Publishes to Redis MQ if available, otherwise falls back to direct HTTP POST.

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

        # --- Publish to Redis MQ (if enabled) ---
        if self._redis:
            try:
                # Test connection / ping to check if Redis is actually up
                await self._redis.ping()
                await self._redis.publish("sentinel:alerts", json.dumps(payload))
                logger.info(
                    f"Alert published to Redis MQ: camera={camera_id} "
                    f"conf={confidence:.2f} frame={frame_number} event_id={payload['event_id']}"
                )
                return True
            except Exception as e:
                logger.warning(f"⚠️ Redis Pub/Sub failed, falling back to HTTP POST: {e}")

        # --- Fallback: POST to HTTP API ---
        try:
            response = await self._http.post("/api/alerts", json=payload)
            if response.status_code in (200, 201):
                logger.info(
                    f"Alert posted (HTTP): camera={camera_id} "
                    f"conf={confidence:.2f} frame={frame_number} response={response.status_code}"
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
        """Close clients on shutdown."""
        await self._http.aclose()
        if self._redis:
            await self._redis.close()


# Singleton instance — shared across all camera streams
api_client = ApiClient()
