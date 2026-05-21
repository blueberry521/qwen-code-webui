import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStallDetector } from "./streamStallDetector";

describe("createStallDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts after timeout when no data is received", () => {
    const abortController = new AbortController();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createStallDetector(abortController, 120_000);

    expect(abortController.signal.aborted).toBe(false);

    vi.advanceTimersByTime(120_000);

    expect(abortController.signal.aborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Stream stall] No data for 120s, aborting fetch",
    );
    warnSpy.mockRestore();
  });

  it("resets timer when onData is called", () => {
    const abortController = new AbortController();
    const detector = createStallDetector(abortController, 120_000);

    // Advance 60s, then receive data
    vi.advanceTimersByTime(60_000);
    expect(abortController.signal.aborted).toBe(false);

    detector.onData();

    // Advance another 60s (120s since data, but only 60s since last reset)
    vi.advanceTimersByTime(60_000);
    expect(abortController.signal.aborted).toBe(false);

    // Advance another 60s = 120s since last onData
    vi.advanceTimersByTime(60_000);
    expect(abortController.signal.aborted).toBe(true);

    detector.dispose();
  });

  it("does not abort when tab is hidden", () => {
    const abortController = new AbortController();
    const detector = createStallDetector(abortController, 120_000);

    // Tab goes hidden before timeout
    vi.advanceTimersByTime(100_000);
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
    vi.advanceTimersByTime(20_000); // 120s total — timer fires while hidden

    expect(abortController.signal.aborted).toBe(false);

    // Tab becomes visible again — timer should restart from now
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should abort 120s after visibility change (because lastDataTime is old)
    vi.advanceTimersByTime(120_000);
    expect(abortController.signal.aborted).toBe(true);

    detector.dispose();
  });

  it("cleans up timers and listeners on dispose", () => {
    const abortController = new AbortController();
    const detector = createStallDetector(abortController, 120_000);
    const removeSpy = vi.spyOn(document, "removeEventListener");

    detector.dispose();

    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    // Should NOT abort after timeout if already disposed
    vi.advanceTimersByTime(240_000);
    expect(abortController.signal.aborted).toBe(false);

    removeSpy.mockRestore();
  });

  it("uses 120s default timeout", () => {
    const abortController = new AbortController();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createStallDetector(abortController); // no timeoutMs arg → default

    vi.advanceTimersByTime(119_999);
    expect(abortController.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(abortController.signal.aborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Stream stall] No data for 120s, aborting fetch",
    );
    warnSpy.mockRestore();
  });

  it("does not abort if data keeps arriving within timeout", () => {
    const abortController = new AbortController();
    const detector = createStallDetector(abortController, 120_000);

    // Simulate keepalive every 15s for 5 minutes
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(14_000);
      detector.onData();
    }

    expect(abortController.signal.aborted).toBe(false);
    detector.dispose();
  });
});
