/**
 * Tests for the LLM proxy server.
 *
 * Verifies that the proxy correctly:
 * 1. Extracts session ID from URL path
 * 2. Adds X-Session-Id header to upstream requests
 * 3. Forwards request bodies and streams responses
 * 4. Handles errors gracefully
 *
 * @see https://github.com/ivycomputing/qwen-code-webui/issues/220
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import {
  startLlmProxy,
  stopLlmProxy,
  getProxyPort,
  getProxyBaseUrl,
  isProxyRunning,
} from "./llmProxy.ts";

/**
 * Create a simple upstream HTTP server that echoes back the received headers
 * and request body as JSON.
 */
function createUpstreamServer(): Promise<{
  server: http.Server;
  port: number;
  receivedRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>;
}> {
  const receivedRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        receivedRequests.push({
          method: req.method || "GET",
          url: req.url || "/",
          headers: { ...req.headers },
          body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            sessionId: req.headers["x-session-id"],
            bodyLength: body.length,
          }),
        );
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, receivedRequests });
    });
  });
}

/**
 * Make an HTTP request to the proxy and return the response body as text.
 */
function makeProxyRequest(
  proxyPort: number,
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path,
        method: options?.method || "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
          ...options?.headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode || 500,
            body,
            headers: res.headers,
          });
        });
      },
    );

    req.on("error", reject);

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("llmProxy", () => {
  let upstream: Awaited<ReturnType<typeof createUpstreamServer>>;

  beforeAll(async () => {
    upstream = await createUpstreamServer();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
  });

  beforeEach(async () => {
    upstream.receivedRequests.length = 0;
  });

  afterEach(async () => {
    await stopLlmProxy();
  });

  describe("startLlmProxy / stopLlmProxy", () => {
    it("starts on a random port and reports running state", async () => {
      expect(isProxyRunning()).toBe(false);
      expect(getProxyPort()).toBeNull();

      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      expect(port).toBeGreaterThan(0);
      expect(isProxyRunning()).toBe(true);
      expect(getProxyPort()).toBe(port);
    });

    it("stops cleanly", async () => {
      await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      expect(isProxyRunning()).toBe(true);

      await stopLlmProxy();
      expect(isProxyRunning()).toBe(false);
      expect(getProxyPort()).toBeNull();
    });

    it("returns existing port when called twice", async () => {
      const port1 = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const port2 = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      expect(port1).toBe(port2);
    });
  });

  describe("getProxyBaseUrl", () => {
    it("returns null when proxy is not running", () => {
      expect(getProxyBaseUrl("test-session")).toBeNull();
    });

    it("returns correct URL format when running", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const baseUrl = getProxyBaseUrl("my-session-123");
      expect(baseUrl).toBe(`http://127.0.0.1:${port}/my-session-123/v1`);
    });
  });

  describe("request forwarding", () => {
    it("extracts session ID from URL and adds X-Session-Id header", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const sessionId = "test-session-abc-123";

      const response = await makeProxyRequest(
        port,
        `/${sessionId}/v1/chat/completions`,
        {
          method: "POST",
          body: JSON.stringify({ model: "test", messages: [] }),
        },
      );

      expect(response.status).toBe(200);

      // Verify the upstream received the request
      expect(upstream.receivedRequests).toHaveLength(1);
      const upstreamReq = upstream.receivedRequests[0];

      // Session ID should be in the X-Session-Id header
      expect(upstreamReq.headers["x-session-id"]).toBe(sessionId);

      // URL should have the session ID stripped
      expect(upstreamReq.url).toBe("/v1/chat/completions");

      // Method should be preserved
      expect(upstreamReq.method).toBe("POST");

      // Authorization should be passed through
      expect(upstreamReq.headers["authorization"]).toBe("Bearer test-token");
    });

    it("handles multiple sessions concurrently", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);

      const responses = await Promise.all([
        makeProxyRequest(port, "/session-A/v1/chat/completions", { body: "{}" }),
        makeProxyRequest(port, "/session-B/v1/chat/completions", { body: "{}" }),
        makeProxyRequest(port, "/session-C/v1/chat/completions", { body: "{}" }),
      ]);

      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(upstream.receivedRequests).toHaveLength(3);

      const sessionIds = upstream.receivedRequests.map(
        (r) => r.headers["x-session-id"],
      );
      expect(sessionIds).toContain("session-A");
      expect(sessionIds).toContain("session-B");
      expect(sessionIds).toContain("session-C");
    });

    it("returns 400 for invalid URL format", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);

      const response = await makeProxyRequest(port, "/");
      expect(response.status).toBe(400);
    });

    it("preserves query string", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);

      const response = await makeProxyRequest(
        port,
        "/session-1/v1/models?limit=10",
        { method: "GET" },
      );

      expect(response.status).toBe(200);
      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].url).toBe("/v1/models?limit=10");
    });

    it("forwards request body correctly", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const body = JSON.stringify({
        model: "qwen-max",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      });

      await makeProxyRequest(port, "/session-x/v1/chat/completions", { body });

      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].body).toBe(body);
    });
  });

  describe("error handling", () => {
    it("returns 502 when upstream is unreachable", async () => {
      // Start proxy pointing to a non-existent upstream
      const port = await startLlmProxy("http://127.0.0.1:1");

      const response = await makeProxyRequest(
        port,
        "/session-err/v1/chat/completions",
        { body: "{}" },
      );

      expect(response.status).toBe(502);
    });
  });
});
