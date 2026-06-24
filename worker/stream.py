# worker/stream.py
#
# CameraStream — manages ONE camera's RTSP ingestion + detection loop.
#
# DESIGN: each camera runs in its own background thread.
# WHY threads (not asyncio)?
#   - cv2.VideoCapture.read() is BLOCKING — it waits for the next frame.
#   - Blocking calls inside asyncio would freeze the entire event loop.
#   - Running each camera in a thread lets blocking I/O happen independently.
#   - We bridge back to asyncio only when posting alerts (via asyncio.run_coroutine_threadsafe).
#
# ISOLATION: if one camera crashes, it only kills that thread.
# The other cameras keep running. The manager can restart the failed one.
#
# FRAME SKIPPING:
#   Detection is slow (~100-300ms on CPU). Reading RTSP at 25fps means
#   a new frame every 40ms. We can't process every frame.
#   Solution: only run detection every DETECT_EVERY_N_FRAMES frames.
#   Between detections, frames are still read (to keep the buffer clear)
#   but not processed.

import asyncio
import logging
import threading
import time
import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import cv2

from detection import detect_persons
from api_client import api_client

logger = logging.getLogger(__name__)

# Run detection every N frames (tune based on CPU speed)
DETECT_EVERY_N_FRAMES = int(os.getenv("DETECT_EVERY_N_FRAMES", "10"))

# Seconds to wait before reconnecting after a stream failure
RECONNECT_DELAY = float(os.getenv("RECONNECT_DELAY_SECONDS", "3"))


class StreamState(str, Enum):
    IDLE        = "idle"
    CONNECTING  = "connecting"
    LIVE        = "live"
    STOPPED     = "stopped"
    ERROR       = "error"


@dataclass
class StreamStats:
    """Live stats for a camera stream — sent to frontend via WebSocket."""
    fps:                float = 0.0
    frames_processed:   int   = 0
    detections_total:   int   = 0
    detections_per_min: float = 0.0
    state:              StreamState = StreamState.IDLE
    error:              Optional[str] = None


class CameraStream:
    """
    Manages the full lifecycle of one RTSP camera:
      1. Connect to RTSP URL via OpenCV
      2. Read frames in a loop
      3. Run YOLOv8 detection every N frames
      4. Post alerts to backend when a person is detected
    """

    def __init__(self, camera_id: str, rtsp_url: str, event_loop: asyncio.AbstractEventLoop):
        self.camera_id  = camera_id
        self.rtsp_url   = rtsp_url
        self._loop      = event_loop          # the main asyncio event loop
        self._stop_event = threading.Event()  # set this to signal the thread to stop
        self._thread: Optional[threading.Thread] = None
        self.stats = StreamStats()
        self._webrtc_tracks = []
        self._tracks_lock = threading.Lock()
        self._pcs = set()

    def add_webrtc_track(self, track):
        with self._tracks_lock:
            self._webrtc_tracks.append(track)
            logger.info(f"Added WebRTC track to camera {self.camera_id}. Total: {len(self._webrtc_tracks)}")

    def remove_webrtc_track(self, track):
        with self._tracks_lock:
            if track in self._webrtc_tracks:
                self._webrtc_tracks.remove(track)
                logger.info(f"Removed WebRTC track from camera {self.camera_id}. Total: {len(self._webrtc_tracks)}")


    def start(self):
        """Start the camera stream in a background thread."""
        if self._thread and self._thread.is_alive():
            logger.warning(f"Camera {self.camera_id} is already running")
            return

        self._stop_event.clear()
        self.stats.state = StreamState.CONNECTING

        self._thread = threading.Thread(
            target=self._run,
            name=f"camera-{self.camera_id}",
            daemon=True,  # thread dies when main process dies
        )
        self._thread.start()
        logger.info(f"Camera {self.camera_id} thread started")

    def stop(self):
        """Signal the stream to stop and wait for the thread to finish."""
        logger.info(f"Stopping camera {self.camera_id}...")
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)  # wait up to 10s for clean shutdown
        
        # Close all active WebRTC peer connections
        for pc in list(self._pcs):
            asyncio.run_coroutine_threadsafe(pc.close(), self._loop)
        self._pcs.clear()
        with self._tracks_lock:
            self._webrtc_tracks.clear()

        self.stats.state = StreamState.STOPPED
        logger.info(f"Camera {self.camera_id} stopped")

    def _run(self):
        """
        Main loop running in a background thread.
        Connects to RTSP, reads frames, runs detection.
        Auto-reconnects on failure.
        """
        frame_count   = 0
        fps_frame_count = 0
        fps_timer_start = time.monotonic()
        detection_times: list[float] = []

        while not self._stop_event.is_set():
            # --- Connect to RTSP ---
            logger.info(f"Connecting to RTSP: {self.rtsp_url}")
            self.stats.state = StreamState.CONNECTING

            cap = cv2.VideoCapture(self.rtsp_url)

            if not cap.isOpened():
                logger.error(f"Failed to open RTSP stream: {self.rtsp_url}")
                self.stats.state = StreamState.ERROR
                self.stats.error = "Failed to connect to RTSP stream"
                # Wait before retrying, but check stop_event frequently
                for _ in range(int(RECONNECT_DELAY * 10)):
                    if self._stop_event.is_set():
                        break
                    time.sleep(0.1)
                continue

            self.stats.state = StreamState.LIVE
            self.stats.error = None
            logger.info(f"Camera {self.camera_id} is LIVE ✅")

            # --- Frame loop ---
            while not self._stop_event.is_set():
                ret, frame = cap.read()

                if not ret:
                    logger.warning(f"Camera {self.camera_id}: frame read failed, reconnecting...")
                    break  # exit inner loop → reconnect

                frame_count += 1
                fps_frame_count += 1
                self.stats.frames_processed = frame_count

                # Push frame to active WebRTC tracks
                with self._tracks_lock:
                    for track in list(self._webrtc_tracks):
                        track.put_frame(frame)

                # --- FPS calculation (every second) ---
                elapsed = time.monotonic() - fps_timer_start
                if elapsed >= 1.0:
                    self.stats.fps = round(fps_frame_count / elapsed, 1)
                    fps_frame_count = 0
                    fps_timer_start = time.monotonic()

                # --- Detection (every N frames to manage CPU) ---
                if frame_count % DETECT_EVERY_N_FRAMES != 0:
                    continue

                detections = detect_persons(frame)

                if detections:
                    self.stats.detections_total += len(detections)
                    detection_times.append(time.monotonic())

                    # Keep only detections within the last 60 seconds (for per-min stats)
                    cutoff = time.monotonic() - 60
                    detection_times = [t for t in detection_times if t > cutoff]
                    self.stats.detections_per_min = round(len(detection_times), 1)

                    # Post each person detection as an alert
                    for det in detections:
                        # Schedule async coroutine from this sync thread
                        asyncio.run_coroutine_threadsafe(
                            api_client.post_alert(
                                camera_id    = self.camera_id,
                                confidence   = det.confidence,
                                bounding_box = det.bounding_box,
                                frame_number = frame_count,
                            ),
                            self._loop,
                        )
                        # Only post one alert per detection batch (cooldown handles dedup)
                        break

            cap.release()

            # If stop was requested, don't reconnect
            if self._stop_event.is_set():
                break

            logger.info(f"Camera {self.camera_id}: reconnecting in {RECONNECT_DELAY}s...")
            time.sleep(RECONNECT_DELAY)

        self.stats.state = StreamState.STOPPED
        logger.info(f"Camera {self.camera_id} thread exited cleanly")
