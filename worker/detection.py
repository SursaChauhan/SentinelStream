# worker/detection.py
#
# Person detection using YOLOv8n (nano) from the Ultralytics library.
#
# WHY YOLOv8n?
#   - "nano" is the smallest, fastest variant — runs on CPU in ~100-300ms/frame
#   - Class 0 in COCO dataset = "person" — exactly what we need
#   - Ultralytics auto-downloads the weights (~6MB) on first run
#   - 3 lines of inference code vs hundreds in Go with ONNX runtime
#
# HOW YOLO DETECTION WORKS (simplified):
#   1. Input: a video frame (numpy array, shape HxWx3, BGR color)
#   2. YOLO divides the frame into a grid and predicts:
#      - Is there an object in each cell?
#      - What class is it? (person, car, dog, etc.)
#      - Where exactly is its bounding box?
#   3. Output: list of detections, each with:
#      - class id (0 = person)
#      - confidence score (0.0 to 1.0)
#      - bounding box [x1, y1, x2, y2] in pixels

import logging
from dataclasses import dataclass
import numpy as np

logger = logging.getLogger(__name__)

# Lazy import — only load torch/ultralytics when first needed
# This keeps startup fast and errors isolated
_model = None


def get_model():
    """Load the YOLOv8n model once and cache it (singleton pattern)."""
    global _model
    if _model is None:
        from ultralytics import YOLO  # type: ignore[import-untyped]
        logger.info("Loading YOLOv8n model...")
        # Downloads yolov8n.pt (~6MB) to ~/.cache/ultralytics/ on first run
        _model = YOLO("yolov8n.pt")
        logger.info("YOLOv8n model loaded ✅")
    return _model


@dataclass
class Detection:
    """A single object detection result."""
    confidence: float
    bounding_box: dict  # {x, y, width, height} in pixels
    class_id: int
    class_name: str


def detect_persons(frame: np.ndarray, confidence_threshold: float = 0.5) -> list[Detection]:
    """
    Run YOLOv8 inference on a single frame and return person detections.

    Args:
        frame: OpenCV frame (numpy array, BGR, shape HxWx3)
        confidence_threshold: minimum confidence to include a detection (0-1)

    Returns:
        List of Detection objects for class 0 (person) above the threshold
    """
    model = get_model()

    # Run inference
    # verbose=False suppresses per-frame console output
    results = model(frame, verbose=False)

    detections: list[Detection] = []

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            cls_id    = int(box.cls[0].item())
            conf      = float(box.conf[0].item())

            # Class 0 = "person" in the COCO dataset YOLOv8 is trained on
            if cls_id != 0:
                continue
            if conf < confidence_threshold:
                continue

            # Box format from YOLO: [x1, y1, x2, y2] (top-left, bottom-right)
            x1, y1, x2, y2 = box.xyxy[0].tolist()

            # Convert to {x, y, width, height} — more useful for drawing on UI
            detections.append(Detection(
                confidence=round(conf, 4),
                bounding_box={
                    "x":      int(x1),
                    "y":      int(y1),
                    "width":  int(x2 - x1),
                    "height": int(y2 - y1),
                    "frame_width": int(frame.shape[1]),
                    "frame_height": int(frame.shape[0]),
                },
                class_id=cls_id,
                class_name="person",
            ))

    return detections
