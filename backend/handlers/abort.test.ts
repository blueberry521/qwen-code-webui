import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleAbortRequest } from "./abort.ts";
import { signalTrackedCliAbort } from "../utils/cliProcessRegistry.ts";

vi.mock("../utils/logger.ts", () => ({
  logger: {
    api: {
      debug: vi.fn(),
    },
  },
}));

vi.mock("../utils/cliProcessRegistry.ts", () => ({
  signalTrackedCliAbort: vi.fn(),
}));

function createMockContext(requestId: string | undefined) {
  return {
    req: {
      param: vi.fn().mockReturnValue(requestId),
    },
    json: vi.fn().mockImplementation((data, status?: number) => ({ data, status })),
  } as unknown as Parameters<typeof handleAbortRequest>[0];
}

describe("handleAbortRequest", () => {
  let requestAbortControllers: Map<string, AbortController>;

  beforeEach(() => {
    requestAbortControllers = new Map();
    vi.clearAllMocks();
  });

  it("aborts the request without eagerly deleting controller state", () => {
    const ctx = createMockContext("req-1");
    const abortController = new AbortController();
    requestAbortControllers.set("req-1", abortController);
    const spy = vi.spyOn(abortController, "abort");

    handleAbortRequest(ctx, requestAbortControllers);

    expect(signalTrackedCliAbort).toHaveBeenCalledWith("req-1", "user");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signalTrackedCliAbort).mock.invocationCallOrder[0])
      .toBeLessThan(spy.mock.invocationCallOrder[0]);
    expect(abortController.signal.aborted).toBe(true);
    expect(requestAbortControllers.has("req-1")).toBe(true);
    expect(ctx.json).toHaveBeenCalledWith({ success: true, message: "Request aborted" });
  });

  it("returns 404 for unknown requests", () => {
    const ctx = createMockContext("missing");

    handleAbortRequest(ctx, requestAbortControllers);

    expect(ctx.json).toHaveBeenCalledWith(
      { error: "Request not found or already completed" },
      404,
    );
  });
});
