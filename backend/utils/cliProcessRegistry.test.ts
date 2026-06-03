import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __cliProcessRegistryTestUtils,
  finalizeTrackedCliRequest,
  registerTrackedCliRequest,
  signalTrackedCliAbort,
} from "./cliProcessRegistry.ts";

vi.mock("./logger.ts", () => ({
  logger: {
    chat: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

class FakeChildProcess extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

describe("cliProcessRegistry", () => {
  let alivePids: Set<number>;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    alivePids = new Set<number>();
    __cliProcessRegistryTestUtils.reset();

    killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 || signal === undefined) {
        if (!alivePids.has(pid)) {
          throw new Error(`process ${pid} missing`);
        }
        return true;
      }

      if (!alivePids.has(pid)) {
        throw new Error(`process ${pid} missing`);
      }

      if (signal === "SIGKILL") {
        alivePids.delete(pid);
      }
      return true;
    }) as typeof process.kill);
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
    __cliProcessRegistryTestUtils.reset();
  });

  it("escalates to SIGKILL when a tracked CLI survives SIGTERM", () => {
    registerTrackedCliRequest("req-1", { sessionId: "session-1" });

    const child = new FakeChildProcess(4242);
    alivePids.add(child.pid);
    __cliProcessRegistryTestUtils.attachChildToRequest("req-1", child as unknown as import("node:child_process").ChildProcess);

    signalTrackedCliAbort("req-1", "user");

    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");

    vi.advanceTimersByTime(5_000);

    expect(killSpy).toHaveBeenCalledWith(4242, "SIGKILL");
  });

  it("clears abort timers when the tracked CLI exits before escalation", () => {
    registerTrackedCliRequest("req-2");

    const child = new FakeChildProcess(5252);
    alivePids.add(child.pid);
    __cliProcessRegistryTestUtils.attachChildToRequest("req-2", child as unknown as import("node:child_process").ChildProcess);

    signalTrackedCliAbort("req-2", "user");
    alivePids.delete(child.pid);
    child.emit("close");

    vi.advanceTimersByTime(5_000);

    expect(killSpy).toHaveBeenCalledTimes(1);
    finalizeTrackedCliRequest("req-2");
  });
});
