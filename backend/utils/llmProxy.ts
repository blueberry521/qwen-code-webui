/**
 * Local LLM Proxy Server
 *
 * Intercepts LLM API requests from CLI subprocesses and injects the
 * X-Session-Id header before forwarding to the upstream LLM Proxy.
 *
 * This solves the session attribution problem in Open-ACE integration mode
 * where multiple Qwen sessions share the same user-level proxy token.
 *
 * Architecture:
 *   CLI subprocess → http://127.0.0.1:<port>/<sessionId>/v1/... → this proxy
 *   → upstream LLM Proxy (OPENAI_BASE_URL) with X-Session-Id header added
 *
 * @see https://github.com/ivycomputing/qwen-code-webui/issues/220
 */

import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { logger } from "./logger.ts";

let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
let upstreamBaseUrl: string | null = null;

/**
 * Start the local LLM proxy server.
 *
 * @param upstreamUrl - The real LLM Proxy URL (from OPENAI_BASE_URL env var)
 * @returns The port number the proxy is listening on
 */
export function startLlmProxy(upstreamUrl: string): Promise<number> {
  if (proxyServer) {
    logger.chat.warn("LLM proxy already running on port {port}", { port: proxyPort });
    return Promise.resolve(proxyPort!);
  }

  return new Promise((resolve, reject) => {
    proxyServer = http.createServer((clientReq, clientRes) => {
      handleProxyRequest(clientReq, clientRes);
    });

    // Listen on a random available port, localhost only (secure)
    proxyServer.listen(0, "127.0.0.1", () => {
      const addr = proxyServer!.address();
      if (addr && typeof addr === "object") {
        proxyPort = addr.port;
        upstreamBaseUrl = upstreamUrl;
        logger.chat.info(
          "LLM proxy started on port {port}, upstream: {upstream}",
          { port: proxyPort, upstream: upstreamUrl },
        );
        resolve(proxyPort);
      } else {
        reject(new Error("Failed to get proxy server address"));
      }
    });

    proxyServer.on("error", (err) => {
      logger.chat.error("LLM proxy server error: {error}", { error: err.message });
      proxyServer = null;
      proxyPort = null;
      upstreamBaseUrl = null;
      reject(err);
    });
  });
}

/**
 * Handle a single proxy request:
 * 1. Extract session ID from URL path: /<sessionId>/v1/...
 * 2. Strip session ID from the forwarded path
 * 3. Add X-Session-Id header
 * 4. Forward to upstream
 * 5. Stream the response back
 */
function handleProxyRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): void {
  const reqUrl = clientReq.url || "";

  // Parse URL: /<sessionId>/v1/...
  // Split on '/' - first element is empty (leading /)
  const pathSegments = reqUrl.split("/");
  // pathSegments[0] = '' (before leading /)
  // pathSegments[1] = sessionId
  // pathSegments[2+] = remaining path (v1/...)

  const sessionId = pathSegments[1];
  const remainingPath = "/" + pathSegments.slice(2).join("/");

  if (!sessionId || !remainingPath || remainingPath === "/") {
    logger.chat.warn("LLM proxy: invalid request URL: {url}", { url: reqUrl });
    clientRes.writeHead(400, { "Content-Type": "text/plain" });
    clientRes.end("Invalid proxy URL format. Expected: /<sessionId>/v1/...");
    return;
  }

  if (!upstreamBaseUrl) {
    clientRes.writeHead(503, { "Content-Type": "text/plain" });
    clientRes.end("Proxy upstream not configured");
    return;
  }

  // Build upstream URL
  const upstreamUrl = new URL(remainingPath, upstreamBaseUrl);
  // Preserve query string from original request
  const queryIdx = reqUrl.indexOf("?");
  if (queryIdx !== -1) {
    upstreamUrl.search = reqUrl.substring(queryIdx);
  }

  // Build headers for upstream request
  const upstreamHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(clientReq.headers)) {
    // Skip 'host' - it will be set correctly for the upstream
    if (key.toLowerCase() === "host") continue;
    // Skip 'connection' - not relevant for upstream
    if (key.toLowerCase() === "connection") continue;
    upstreamHeaders[key] = value;
  }

  // Add X-Session-Id header
  upstreamHeaders["x-session-id"] = sessionId;

  logger.chat.debug(
    "LLM proxy: {method} {path} → {upstream} (session: {sessionId})",
    {
      method: clientReq.method,
      path: remainingPath,
      upstream: upstreamUrl.toString(),
      sessionId,
    },
  );

  // Determine whether to use http or https for upstream
  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  const proxyReq = transport.request(
    upstreamUrl,
    {
      method: clientReq.method,
      headers: upstreamHeaders as Record<string, string>,
    },
    (proxyRes) => {
      // Forward response headers to client
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      // Stream response body back to client
      proxyRes.pipe(clientRes);
    },
  );

  proxyReq.on("error", (err) => {
    logger.chat.error(
      "LLM proxy upstream error: {error} (session: {sessionId})",
      { error: err.message, sessionId },
    );
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
    }
    clientRes.end("Proxy upstream error: " + err.message);
  });

  // Stream request body to upstream
  clientReq.pipe(proxyReq);
}

/**
 * Get the proxy port. Returns null if proxy is not running.
 */
export function getProxyPort(): number | null {
  return proxyPort;
}

/**
 * Check if the proxy is running.
 */
export function isProxyRunning(): boolean {
  return proxyServer !== null && proxyPort !== null;
}

/**
 * Get the proxy base URL for a given session ID.
 * Returns null if proxy is not running.
 *
 * @param sessionId - The Qwen session ID
 * @returns The proxy base URL (e.g., http://127.0.0.1:12345/<sessionId>/v1)
 */
export function getProxyBaseUrl(sessionId: string): string | null {
  if (!proxyPort) return null;
  return `http://127.0.0.1:${proxyPort}/${sessionId}/v1`;
}

/**
 * Stop the LLM proxy server.
 */
export function stopLlmProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (proxyServer) {
      const server = proxyServer;
      proxyServer = null;
      proxyPort = null;
      upstreamBaseUrl = null;
      server.close(() => {
        logger.chat.info("LLM proxy stopped");
        resolve();
      });
      // Force close after 5 seconds if connections are still open
      setTimeout(() => {
        server.closeAllConnections?.();
      }, 5000);
    } else {
      resolve();
    }
  });
}
