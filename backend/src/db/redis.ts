// backend/src/db/redis.ts

import { createClient } from "redis";
import { saveAndBroadcastAlert } from "../routes/alerts";

let client: ReturnType<typeof createClient> | null = null;

export async function startRedisSubscriber() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("⚠️ REDIS_URL not configured. Skipping MQ subscriber.");
    return;
  }

  try {
    // If running in Bun, we can connect directly using the official npm package
    client = createClient({ url: redisUrl });
    client.on("error", (err) => console.error("❌ Redis Subscriber Error:", err));
    
    await client.connect();
    console.log(`🔌 Redis MQ Subscriber connected to ${redisUrl}`);

    await client.subscribe("sentinel:alerts", async (message) => {
      try {
        const payload = JSON.parse(message);
        console.log(`📥 MQ: Received alert for camera ${payload.camera_id}, event_id ${payload.event_id}`);
        const alert = await saveAndBroadcastAlert(payload);
        if (alert) {
          console.log(`✅ MQ: Processed and broadcasted alert: ${alert.id}`);
        } else {
          console.log(`⚠️ MQ: Ignored duplicate alert: ${payload.event_id}`);
        }
      } catch (err: any) {
        console.error("❌ MQ: Error processing subscription message:", err.message || err);
      }
    });
  } catch (err) {
    console.error("❌ Failed to start Redis subscriber:", err);
  }
}

export async function closeRedis() {
  if (client) {
    await client.disconnect();
    console.log("🔌 Redis Subscriber disconnected");
  }
}
