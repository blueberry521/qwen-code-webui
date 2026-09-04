import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";

const mockQuery = vi.fn();

vi.mock("../utils/qwenSdk.ts", () => ({
  loadQwenQuery: vi.fn(async () => mockQuery),
}));

vi.mock("../utils/logger.ts", () => ({
  logger: {
    chat: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

vi.mock("../utils/sessionBridge.ts", () => ({
  bridgeSession: vi.fn((_cwd: string, sessionId: string | undefined) =>
    Promise.resolve(sessionId),
  ),
}));

import {
  getOpenAceSessionApi,
  handleChatRequest,
  isIntegratedMode,
  registerWithOpenAce,
} from "./chat.ts";

function createContext(
  config: Record<string, unknown>,
  requestSignal?: AbortSignal,
): Context {
  return {
    req: {
      json: vi.fn().mockResolvedValue({
        message: "hello",
        requestId: "request-1",
        workingDirectory: "/workspace/project",
      }),
      header: vi.fn((name: string) =>
        name === "Authorization" ? "Bearer test-token" : undefined,
      ),
      query: vi.fn(),
      raw: requestSignal ? { signal: requestSignal } : undefined,
    },
    var: {
      config: {
        cliPath: "/path/to/qwen",
        ...config,
      },
    },
  } as unknown as Context;
}

function mockSuccessfulQuery(): void {
  mockQuery.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
        session_id: "unused",
        parent_tool_use_id: null,
      };
    },
    interrupt: vi.fn(),
    next: vi.fn(),
    return: vi.fn(),
    throw: vi.fn(),
  });
}

describe("Open-ACE session pre-registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENACE_API_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.OPENACE_API_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  it("uses the plural sessions route and normalizes a trailing slash", () => {
    expect(
      getOpenAceSessionApi({
        openaceApiUrl: "https://openace.example/",
      } as never),
    ).toBe("https://openace.example/api/workspace/sessions");
  });

  it("does not treat a standalone OPENAI_BASE_URL as Open-ACE integration", () => {
    process.env.OPENAI_BASE_URL = "https://compatible.example/v1";
    expect(isIntegratedMode({} as never)).toBe(false);
  });

  it("requires a successful response that confirms the requested session ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { session_id: "session-1" } }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      registerWithOpenAce(
        "session-1",
        "/workspace/project",
        { openaceApiUrl: "https://openace.example/" } as never,
        "test-token",
      ),
    ).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openace.example/api/workspace/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({ session_id: "session-1" }),
    );
  });

  it("rejects a successful HTTP response that confirms a different session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { session_id: "different" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await registerWithOpenAce(
      "session-1",
      "/workspace/project",
      { openaceApiUrl: "https://openace.example" } as never,
    );
    expect(result.success).toBe(false);
  });

  it("does not invoke the SDK when registration fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
    );

    const response = await handleChatRequest(
      createContext({ openaceApiUrl: "https://openace.example" }),
      new Map(),
      new Map(),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(mockQuery).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: "Unable to register this session with Open-ACE. Please retry.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("times out a stalled registration request", async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (url.endsWith("/session-1") && init.method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        fetchSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          fetchSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    );

    const resultPromise = registerWithOpenAce(
      "session-1",
      "/workspace/project",
      { openaceApiUrl: "https://openace.example" } as never,
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      error: "Open-ACE registration was cancelled or timed out",
    });
    expect(fetchSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels registration when the incoming chat request is aborted", async () => {
    const requestController = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (
          url.includes("/api/workspace/sessions/") &&
          init.method === "DELETE"
        ) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        fetchSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          fetchSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    );

    const response = await handleChatRequest(
      createContext(
        { openaceApiUrl: "https://openace.example" },
        requestController.signal,
      ),
      new Map(),
      new Map(),
    );
    requestController.abort();
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(fetchSignal?.aborted).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("uses the same registered ID for the first SDK request", async () => {
    mockSuccessfulQuery();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { session_id: string };
        return new Response(
          JSON.stringify({
            success: true,
            data: { session_id: body.session_id },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleChatRequest(
      createContext({ openaceApiUrl: "https://openace.example" }),
      new Map(),
      new Map(),
    );
    await response.text();

    const registrationRequest = fetchMock.mock.calls[0][1] as RequestInit;
    const registeredId = JSON.parse(
      registrationRequest.body as string,
    ).session_id;
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "hello",
      options: expect.objectContaining({ sessionId: registeredId }),
    });
  });

  it("removes a possibly committed session when the registration response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection reset after commit"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleChatRequest(
      createContext({ openaceApiUrl: "https://openace.example/" }),
      new Map(),
      new Map(),
    );
    await response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const registrationBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { session_id: string };
    expect(fetchMock.mock.calls[1]).toEqual([
      `https://openace.example/api/workspace/sessions/${registrationBody.session_id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    ]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
