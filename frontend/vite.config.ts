import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config
// - proxy: forward /api/* and /ws to the Bun backend
//   This way in dev, the frontend calls /api/cameras instead of http://localhost:3000/api/cameras
//   (avoids CORS issues in development)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
