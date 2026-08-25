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
      expect(baseUrl).toBe(`http://127.0.0.1:${port}/my-session-123`);
    });
  });

  describe("request forwarding", () => {
    it("extracts session ID from URL and adds X-Session-Id header", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const sessionId = "test-session-abc-123";

      const response = await makeProxyRequest(
        port,
        `/${sessionId}/chat/completions`,
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
      expect(upstreamReq.url).toBe("/chat/completions");

      // Method should be preserved
      expect(upstreamReq.method).toBe("POST");

      // Authorization should be passed through
      expect(upstreamReq.headers["authorization"]).toBe("Bearer test-token");
    });

    it("handles multiple sessions concurrently", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);

      const responses = await Promise.all([
        makeProxyRequest(port, "/session-A/chat/completions", { body: "{}" }),
        makeProxyRequest(port, "/session-B/chat/completions", { body: "{}" }),
        makeProxyRequest(port, "/session-C/chat/completions", { body: "{}" }),
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
        "/session-1/models?limit=10",
        { method: "GET" },
      );

      expect(response.status).toBe(200);
      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].url).toBe("/models?limit=10");
    });

    it("forwards request body correctly", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);
      const body = JSON.stringify({
        model: "qwen-max",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      });

      await makeProxyRequest(port, "/session-x/chat/completions", { body });

      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].body).toBe(body);
    });
  });

  describe("upstream path prefix preservation", () => {
    it("preserves upstream URL path prefix (string concatenation, not URL resolution)", async () => {
      // When OPENAI_BASE_URL has a path prefix like /custom/prefix,
      // the proxy must preserve it when forwarding to upstream.
      // new URL("/chat/completions", "http://host/custom/prefix") would LOSE /custom/prefix,
      // but string concatenation "http://host/custom/prefix" + "/chat/completions" preserves it.
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}/custom/prefix`);

      const response = await makeProxyRequest(
        port,
        "/session-prefix/chat/completions",
        { body: "{}" },
      );

      expect(response.status).toBe(200);
      expect(upstream.receivedRequests).toHaveLength(1);
      // Upstream should receive the path with the prefix preserved
      expect(upstream.receivedRequests[0].url).toBe("/custom/prefix/chat/completions");
      // Session ID should still be injected
      expect(upstream.receivedRequests[0].headers["x-session-id"]).toBe("session-prefix");
    });

    it("works with upstream URL ending in /v1", async () => {
      // Common case: OPENAI_BASE_URL = http://host/v1
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}/v1`);

      await makeProxyRequest(port, "/session-v1/chat/completions", { body: "{}" });

      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].url).toBe("/v1/chat/completions");
    });

    it("works with upstream URL without path", async () => {
      // Edge case: OPENAI_BASE_URL = http://host (no path)
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}`);

      await makeProxyRequest(port, "/session-nopath/chat/completions", { body: "{}" });

      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].url).toBe("/chat/completions");
    });
  });

  describe("error handling", () => {
    it("returns 502 when upstream is unreachable", async () => {
      // Start proxy pointing to a non-existent upstream
      const port = await startLlmProxy("http://127.0.0.1:1");

      const response = await makeProxyRequest(
        port,
        "/session-err/chat/completions",
        { body: "{}" },
      );

      expect(response.status).toBe(502);
    });
  });

  describe("streaming and connection lifecycle", () => {
    it("streams a chunked/SSE response back to the client", async () => {
      const streamer = http.createServer((_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write("data: one\n\n");
        setTimeout(() => {
          res.write("data: two\n\n");
          res.end();
        }, 10);
      });
      await new Promise<void>((r) => streamer.listen(0, "127.0.0.1", () => r()));
      const streamerPort = (streamer.address() as { port: number }).port;

      try {
        const port = await startLlmProxy(`http://127.0.0.1:${streamerPort}`);
        const resp = await makeProxyRequest(port, "/sess-stream/chat/completions", {
          body: "{}",
        });
        expect(resp.status).toBe(200);
        expect(resp.body).toContain("data: one");
        expect(resp.body).toContain("data: two");
      } finally {
        await new Promise<void>((r) => streamer.close(() => r()));
      }
    });

    it("does not crash the proxy when the upstream resets mid-stream", async () => {
      // Upstream writes headers + a partial body, then destroys the socket to
      // simulate a connection reset during a streaming response. Without an
      // 'error' listener on the upstream response stream this would surface as
      // an unhandled 'error' and crash the whole backend.
      const flaky = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("data: partial\n\n");
        res.socket?.destroy();
      });
      await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", () => r()));
      const flakyPort = (flaky.address() as { port: number }).port;

      try {
        const port = await startLlmProxy(`http://127.0.0.1:${flakyPort}`);
        // The client request terminates abnormally (socket hang up); we only
        // care that the proxy itself survives.
        await makeProxyRequest(port, "/sess-flaky/chat/completions", {
          body: "{}",
        }).catch(() => {});
        // If the proxy had crashed on an unhandled error, this worker would be
        // dead and the assertion would never run.
        expect(isProxyRunning()).toBe(true);
      } finally {
        await new Promise<void>((r) => flaky.close(() => r()));
      }
    });

    it("aborts the upstream request when the client disconnects early", async () => {
      let upstreamClosedEarly = false;
      let resolveClosed: (() => void) | undefined;
      const closedPromise = new Promise<void>((r) => (resolveClosed = r));

      // Upstream that never responds; it records when its inbound connection
      // closes (which happens when the proxy aborts the upstream request).
      const hanging = http.createServer((req, _res) => {
        req.on("close", () => {
          upstreamClosedEarly = true;
          resolveClosed?.();
        });
      });
      await new Promise<void>((r) => hanging.listen(0, "127.0.0.1", () => r()));
      const hangingPort = (hanging.address() as { port: number }).port;

      try {
        const port = await startLlmProxy(`http://127.0.0.1:${hangingPort}`);

        const clientReq = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/sess-abort/chat/completions",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        clientReq.on("error", () => {});
        clientReq.end("{}");

        // Give the request time to reach the upstream, then disconnect.
        await new Promise<void>((r) => setTimeout(r, 50));
        clientReq.destroy();

        // The proxy should abort the upstream request in response.
        await Promise.race([
          closedPromise,
          new Promise<void>((_r, reject) =>
            setTimeout(() => reject(new Error("upstream was not aborted in time")), 2000),
          ),
        ]);
        expect(upstreamClosedEarly).toBe(true);
      } finally {
        await new Promise<void>((r) => hanging.close(() => r()));
      }
    });

    it("does not double the slash when the upstream base has a trailing slash", async () => {
      const port = await startLlmProxy(`http://127.0.0.1:${upstream.port}/v1/`);

      await makeProxyRequest(port, "/sess-slash/chat/completions", { body: "{}" });

      expect(upstream.receivedRequests).toHaveLength(1);
      expect(upstream.receivedRequests[0].url).toBe("/v1/chat/completions");
    });
  });
});
