# SentinelStream

SentinelStream is a real-time Video Management System (VMS) with AI-powered person detection. It uses a modern event-driven architecture, streaming video to browsers with low-latency **WebRTC** and relaying metadata via **WebSockets**.

---

## 🏗️ Architecture Overview

The system consists of four isolated services orchestrated by Docker Compose:

```
                  ┌──────────────────────────────────────────────┐
                  │                Browser (React)               │
                  │   ┌───────────────┐      ┌───────────────┐   │
                  │   │  Live Video   │      │  Alert Feed   │   │
                  │   └───────▲───────┘      └───────▲───────┘   │
                  └───────────┼──────────────────────┼───────────┘
                    WebRTC    │                      │ WebSocket
                (Media Stream)│                      │ (Metadata)
                              │                      │
                      ┌───────┴──────┐        ┌──────┴───────┐
                      │    Worker    │        │   Backend    │
                      │   (Python)   ├───────►│ (Bun + Hono) │
                      └───────▲──────┘  HTTP  └──────▲───────┘
                        RTSP  │                      │ PostgreSQL
                              │                      │ (Persistent Store)
                      ┌───────┴──────┐        ┌──────┴───────┐
                      │   MediaMTX   │        │  PostgreSQL  │
                      │ (Simulator)  │        │   Database   │
                      └──────────────┘        └──────────────┘
```

1. **Frontend (React + Vite + TS)**: A premium dashboard with a responsive multi-camera layout, camera control switches, and real-time security alert cards.
2. **Backend (Bun + Hono + TS)**: Manages authentication (JWT), camera configurations, alerts persistence, and WebSocket client connections.
3. **Worker (FastAPI + OpenCV + YOLOv8 + aiortc)**: Ingests RTSP streams, executes YOLOv8 object detection, encodes frames, and streams WebRTC feeds directly to authorized client browsers.
4. **MediaMTX (RTSP Simulator)**: Loops a test video file inside Docker to simulate real security cameras without requiring external hardware.

---

## ⚡ Tech Stack Details & Decisions

### 1. WebRTC for Live Streaming
* **aiortc (Python)** & **Pion (specification)**: Standard H.264 video track packetization ensures sub-second latency compared to HLS/DASH.
* **Non-Trickle ICE**: Both sides wait for candidate gathering to finish before completing the SDP handshake, simplifying signaling logic across container network boundaries.

### 2. AI Person Detection
* **YOLOv8n (Nano)**: The smallest variant of YOLOv8 is used to keep inference under 150ms on standard CPUs.
* **Frame Skipping**: Detection runs every 10th frame (`DETECT_EVERY_N_FRAMES=10`) to optimize CPU usage while maintaining frame buffer reading.

### 3. Backend & Database
* **Bun**: Used for fast execution times and built-in SQLite/PostgreSQL drivers.
* **PostgreSQL**: Selected for ACID compliant transactional storage of alert histories and configurations.

---

## 🚀 How to Run the System

### Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ensure it is running)

### Running the Stack
1. Clone the repository and navigate to the project root.
2. Build and start the services:
   ```bash
   docker compose up --build
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:5173
   ```

### Quick Verification Steps
1. **Create Account**: Go to the "Create Account" tab, enter credentials, and log in.
2. **Register Camera**: Go to the **Camera Manager** page and click **Register Camera**:
   * **Name**: `Main Warehouse Gate`
   * **RTSP URL**: `rtsp://mediamtx:8554/test`
3. **View Dashboard**: Return to the **Dashboard** page, locate the camera, and click **▶️ Live Feed**. The player will negotiate a connection and play the live video.

---

## 🔒 Security Measures
* **Centralized Auth**: All endpoints on the backend require a validated JSON Web Token (JWT) in the `Authorization` header.
* **Worker Isolation**: The Python worker resides behind the backend proxy, requiring a shared `WORKER_SECRET` header for backend-to-worker communication.
* **mDNS WebRTC Resolution**: On macOS, Docker VM bridge routing cannot resolve browser-side `.local` mDNS candidates. Ensure **"Anonymize local IPs exposed by WebRTC"** is disabled in `chrome://flags` to allow local loopback connection during testing.
