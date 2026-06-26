# worker/Dockerfile
#
# Python worker with OpenCV + YOLOv8 + FastAPI + aiortc WebRTC.
#
# WHY python:3.11-slim?
#   Torch/ultralytics have pre-built wheels for 3.11. Using 3.13 inside Docker
#   would require building many C-extension wheels from source.
#
# WHY torch installed as a separate RUN layer?
#   torch + CUDA support packages on linux/arm64 (Apple Silicon Docker) can
#   total ~1 GB. Separating it as its own layer lets Docker cache the result
#   so code changes don't re-download a gigabyte of packages.
#
# WHY PIP_DEFAULT_TIMEOUT=600?
#   Default pip timeout is 15s per read. Large CUDA packages (100-200 MB each)
#   take far longer on typical connections and will timeout without this.

FROM python:3.11-slim

WORKDIR /app

# System deps
# libglib2.0-0     — required by OpenCV (GLib runtime)
# libgomp1         — OpenMP multi-threading, required by PyTorch on ARM
# ffmpeg           — RTSP/H264 decoding via OpenCV
# libavformat-dev  — needed by PyAV (aiortc dependency)
# libavcodec-dev   — needed by PyAV
# libavdevice-dev  — needed by PyAV
# libavutil-dev    — needed by PyAV
# libswscale-dev   — needed by PyAV
# libswresample-dev— needed by PyAV
# libavfilter-dev  — needed by PyAV
# pkg-config       — required to build PyAV from source (finds ffmpeg libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    ffmpeg \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    libavfilter-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Increase pip read timeout to 10 minutes.
# CUDA packages are 100–200 MB each — they will hit the default 15s timeout.
ENV PIP_DEFAULT_TIMEOUT=600

# Install PyTorch as its own cached layer.
# WHY separate? torch pulls ~1 GB of CUDA/Triton packages on linux/arm64.
# As a separate layer it's cached after the first successful build, so
# subsequent rebuilds (when only app code changes) are instant.
RUN pip install --no-cache-dir \
    "torch>=2.6.0" \
    "torchvision>=0.21.0"

# Install remaining dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the YOLOv8n model weights so the first camera start is instant.
# Model is cached in /root/.cache/ultralytics/
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" 2>&1 | tail -3

# Copy application source
COPY . .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
