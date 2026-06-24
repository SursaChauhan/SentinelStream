# worker/webrtc_peer.py
import asyncio
import logging
import queue
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame

logger = logging.getLogger(__name__)

class CameraVideoTrack(VideoStreamTrack):
    """
    A custom VideoStreamTrack that receives OpenCV BGR frames 
    via a thread-safe Queue and feeds them to WebRTC.
    """
    def __init__(self):
        super().__init__()
        # Queue capacity is kept small to avoid latency/buffer build-up.
        self.frame_queue = queue.Queue(maxsize=2)

    async def recv(self):
        """
        Called by aiortc to get the next video frame.
        """
        pts, time_base = await self.next_timestamp()
        
        # Pull from the queue. If empty, sleep briefly to yield control.
        while True:
            try:
                frame = self.frame_queue.get_nowait()
                break
            except queue.Empty:
                await asyncio.sleep(0.005)

        # Convert numpy BGR frame to PyAV VideoFrame
        video_frame = VideoFrame.from_ndarray(frame, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def put_frame(self, frame):
        """
        Push a new frame into the queue. Safe to call from a worker thread.
        """
        try:
            if self.frame_queue.full():
                # Drop oldest frame to maintain real-time low latency
                self.frame_queue.get_nowait()
            self.frame_queue.put_nowait(frame)
        except Exception as e:
            logger.debug(f"Error putting frame into WebRTC track: {e}")
