import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Type describing the fake EventSource instances the test controls.
interface FakeEventSource {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  readyState: number;
  url: string;
  close: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}

// createRemoteSessionStreamWithReconnect is imported after the global
// EventSource stub is wired up in beforeEach.
import { createRemoteSessionStreamWithReconnect } from "./openace";

const OPEN = 1; // EventSource.OPEN

describe("createRemoteSessionStreamWithReconnect", () => {
  let instances: FakeEventSource[];

  // A class so that `new EventSource(url)` works in the code under test.
  // The constructor records each instance so tests can fire events on it.
  class FakeEventSourceImpl {
    // Static constants the code under test reads (EventSource.OPEN etc.).
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    readyState: number = OPEN;
    url: string;
    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as FakeEventSource);
    }
    close = vi.fn(function (this: FakeEventSourceImpl) {
      this.readyState = FakeEventSourceImpl.CLOSED;
    });
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    dispatchEvent = vi.fn(() => true);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    instances = [];
    vi.stubGlobal("EventSource", FakeEventSourceImpl);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Open the (latest) EventSource instance and reset its retry counter. */
  function fireOpen(idx = -1) {
    const inst = instances.at(idx)!;
    inst.readyState = OPEN;
    inst.onopen?.(new Event("open"));
  }

  /** Trigger an error on the (latest) EventSource instance. */
  function fireError(idx = -1) {
    instances.at(idx)!.onerror?.(new Event("error"));
  }

  it("reconnects with increasing backoff on consecutive errors", () => {
    const onError = vi.fn();
    const onStateChange = vi.fn();
    createRemoteSessionStreamWithReconnect("sid", {
      onLine: vi.fn(),
      onError,
      onDone: vi.fn(),
      onStateChange,
      maxRetries: 5,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
    });
    // Initial connect creates the first EventSource.
    expect(instances).toHaveLength(1);

    // 1st error → schedule reconnect after 1000ms.
    fireError();
    expect(onStateChange).toHaveBeenLastCalledWith("reconnecting");
    // advancing less than the delay must NOT reconnect yet.
    vi.advanceTimersByTime(999);
    expect(instances).toHaveLength(1);
    vi.advanceTimersByTime(1); // reach 1000ms → reconnect
    expect(instances).toHaveLength(2);

    // 2nd error → backoff doubles to 2000ms.
    fireError();
    vi.advanceTimersByTime(1999);
    expect(instances).toHaveLength(2);
    vi.advanceTimersByTime(1); // 2000ms
    expect(instances).toHaveLength(3);

    // 3rd error → backoff 4000ms.
    fireError();
    vi.advanceTimersByTime(3999);
    expect(instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(4);
  });

  it("fires onError exactly once when maxRetries is exhausted", () => {
    const onError = vi.fn();
    const onStateChange = vi.fn();
    createRemoteSessionStreamWithReconnect("sid", {
      onLine: vi.fn(),
      onError,
      onDone: vi.fn(),
      onStateChange,
      maxRetries: 2,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
    });

    // Error 1 → reconnect (retryCount 1). Error 2 → reconnect (retryCount 2).
    fireError();
    vi.advanceTimersByTime(1000);
    fireError();
    vi.advanceTimersByTime(2000);
    // retryCount(2) is not < maxRetries(2) → disconnect, single onError.
    fireError();
    expect(onStateChange).toHaveBeenLastCalledWith("disconnected");
    expect(onError).toHaveBeenCalledTimes(1);
    // Advancing time well past any backoff must not create more connections.
    vi.advanceTimersByTime(120000);
    expect(instances).toHaveLength(3);
  });

  it("resets retryCount and delay on successful reconnect (onopen)", () => {
    const onError = vi.fn();
    createRemoteSessionStreamWithReconnect("sid", {
      onLine: vi.fn(),
      onError,
      onDone: vi.fn(),
      maxRetries: 5,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
    });

    // Error → reconnect after 1s.
    fireError();
    vi.advanceTimersByTime(1000);
    expect(instances).toHaveLength(2);
    // The new connection opens successfully → retryCount resets to 0.
    fireOpen();
    // Now an error should reconnect after 1s again (not 2s), proving reset.
    fireError();
    vi.advanceTimersByTime(1000);
    expect(instances).toHaveLength(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("treats stall (no data) as a reconnect trigger", () => {
    const onLine = vi.fn();
    createRemoteSessionStreamWithReconnect("sid", {
      onLine,
      onError: vi.fn(),
      onDone: vi.fn(),
      maxRetries: 5,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
      stallTimeout: 35000,
    });
    // Connection opens, starting the stall timer.
    fireOpen();

    // No data for 35s → stall detected → close + reconnect scheduled.
    vi.advanceTimersByTime(35000);
    // First instance closed, reconnect scheduled after initialRetryDelay.
    expect(instances[0].close).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(instances).toHaveLength(2);
  });

  it("keepalive messages reset the stall timer and are not forwarded to onLine", () => {
    const onLine = vi.fn();
    createRemoteSessionStreamWithReconnect("sid", {
      onLine,
      onError: vi.fn(),
      onDone: vi.fn(),
      maxRetries: 5,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
      stallTimeout: 35000,
    });
    fireOpen();

    // Backend sends a keepalive every ~10s. Feed several over 40s total; if the
    // keepalive resets the stall timer, no reconnect occurs (no 2nd instance).
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10000);
      instances.at(-1)!.onmessage?.({ data: '{"type":"keepalive"}' } as MessageEvent);
    }
    expect(instances).toHaveLength(1); // no stall reconnect
    expect(onLine).not.toHaveBeenCalled(); // keepalive never forwarded
  });

  it("manual close clears timers so no reconnect happens afterwards", () => {
    const onError = vi.fn();
    const es = createRemoteSessionStreamWithReconnect("sid", {
      onLine: vi.fn(),
      onError,
      onDone: vi.fn(),
      maxRetries: 5,
      initialRetryDelay: 1000,
      maxRetryDelay: 30000,
    });
    fireOpen();

    // Close manually, then advance well past stall + reconnect delays.
    es.close();
    vi.advanceTimersByTime(120000);
    expect(instances).toHaveLength(1); // no reconnect
    expect(onError).not.toHaveBeenCalled();
  });
});
