// Set up dummy environment variables for testing before importing modules
process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
process.env.JWT_SECRET = "dummy_secret_for_unit_testing_only";

import { mock, test, expect, describe, beforeEach } from "bun:test";

let mockSqlResponse: any[] = [];
const mockSql = mock((strings: TemplateStringsArray, ...values: any[]) => {
  const queryStr = strings.join("");
  if (queryStr.includes("COUNT(*)")) {
    return [{ count: "1" }];
  }
  return mockSqlResponse;
});

// Mock the postgres database client module to prevent actual DB operations during tests
mock.module("../src/db/client", () => {
  return {
    sql: mockSql,
    checkDbConnection: async () => {},
  };
});

import app from "../src/app";
import { signToken } from "../src/middleware/auth";

describe("SentinelStream Backend Routes Tests", () => {
  const workerSecret = "internal_worker_secret";
  let userToken: string;

  beforeEach(async () => {
    // Generate a valid JWT token for auth endpoints
    userToken = await signToken({ userId: "user-123", username: "testuser" });
    mockSqlResponse = [];
  });

  describe("GET /health", () => {
    test("should return status ok", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ok", service: "sentinel-backend" });
    });
  });

  describe("POST /api/alerts (Worker alerts ingestion)", () => {
    const validAlertPayload = {
      event_id: "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
      camera_id: "c8c8c8c8-d9d9-e0e0-f1f1-g2g2g2g2g2g2",
      event_type: "person_detected",
      timestamp: "2026-06-27T13:00:00Z",
      confidence: 0.95,
      bounding_box: { x: 10, y: 20, width: 30, height: 40 },
      frame_number: 120,
    };

    test("should reject request without worker auth secret header", async () => {
      const res = await app.request("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validAlertPayload),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: "Unauthorized" });
    });

    test("should return 400 bad request for missing camera_id or confidence", async () => {
      const res = await app.request("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": workerSecret,
        },
        body: JSON.stringify({ confidence: 0.95 }),
      });
      expect(res.status).toBe(400);
    });

    test("should insert alert successfully and return 201", async () => {
      const dbRow = {
        id: "alert-999",
        ...validAlertPayload,
      };
      mockSqlResponse = [dbRow];

      const res = await app.request("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": workerSecret,
        },
        body: JSON.stringify(validAlertPayload),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.alert).toBeDefined();
      expect(json.alert.id).toBe("alert-999");
    });

    test("should deduplicate alerts with duplicate event_id and return 200 with skipped: true", async () => {
      // Simulate ON CONFLICT returning undefined (no insertion)
      mockSqlResponse = [];

      const res = await app.request("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": workerSecret,
        },
        body: JSON.stringify(validAlertPayload),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.skipped).toBe(true);
      expect(json.alert).toBeNull();
      expect(json.message).toContain("Duplicate alert");
    });
  });

  describe("GET /api/alerts (Fetch alerts)", () => {
    test("should reject request without user authentication", async () => {
      const res = await app.request("/api/alerts");
      expect(res.status).toBe(401);
    });

    test("should fetch alerts and return paginated results when authenticated", async () => {
      const mockAlertList = [
        {
          id: "alert-1",
          camera_id: "cam-1",
          timestamp: "2026-06-27T13:00:00Z",
          confidence: 0.92,
        },
        {
          id: "alert-2",
          camera_id: "cam-1",
          timestamp: "2026-06-27T12:59:00Z",
          confidence: 0.88,
        },
      ];
      mockSqlResponse = mockAlertList;

      const res = await app.request("/api/alerts?page=1&limit=10", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alerts).toBeDefined();
      expect(json.alerts.length).toBe(2);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.total).toBe(1);
    });
  });
});
