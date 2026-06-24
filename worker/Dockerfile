# worker/Dockerfile
#
# Python worker with OpenCV + YOLOv8 + FastAPI.
#
# WHY python:3.11-slim (not 3.13)?
#   Some scientific packages (torch, opencv) don't have pre-built wheels for 3.13 yet.
#   3.11 has excellent compatibility with all our deps.
#
# WHY --no-install-recommends?
#   Keeps the image smaller by skipping optional packages we don't need.
#
# WHY pre-download the YOLOv8 model?
#   Without this, the first camera start would trigger a ~6MB download
#   inside the container at runtime. Pre-downloading in the build step
#   means the model is baked into the image — faster startup, works offline.

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed by OpenCV
# libglib2.0-0   — required by OpenCV
# libgomp1       — required by PyTorch (OpenMP for multi-threading)
# ffmpeg         — used by OpenCV for RTSP/H264 decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
# Separate COPY so Docker caches this layer when only source files change
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the YOLOv8n model weights so we don't need internet at runtime.
# The model downloads to /root/.cache/ultralytics/
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Copy source files
COPY . .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
