import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchWithTokenRefresh is module-private, so we exercise it through the
// exported fetchOpenAceProjects() with global fetch + the token module mocked.

const state = vi.hoisted(() => ({ token: "old-token" }));

vi.mock("../utils/token", () => ({
  // Only the symbols openace.ts imports need to be provided.
  getToken: vi.fn(() => state.token),
  getOpenAceUrl: vi.fn(() => "https://openace.example"),
  notifyAndWaitForTokenRefresh: vi.fn(async () => {
    // Simulate the parent delivering a fresh token while the request waits.
    state.token = "new-token";
  }),
  setupTokenRefreshListener: vi.fn(),
  replaceTokenInUrl: vi.fn(
    (url: string, newToken: string) => `${url.split("token=")[0]}token=${newToken}`
  ),
}));

import { fetchOpenAceProjects } from "./openace";
import * as tokenUtils from "../utils/token";

describe("fetchWithTokenRefresh (via fetchOpenAceProjects)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    state.token = "old-token";
    // The factory-created token mocks persist call history across tests, so
    // clear them here (and restore default implementations) before each run.
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(tokenUtils.getToken).mockImplementation(() => state.token);
    vi.mocked(tokenUtils.notifyAndWaitForTokenRefresh).mockImplementation(async () => {
      state.token = "new-token";
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries once with the refreshed token on 401", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ success: true, projects: [] }),
      });

    await fetchOpenAceProjects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("token=old-token");
    expect(fetchMock.mock.calls[1][0]).toContain("token=new-token");
    expect(tokenUtils.notifyAndWaitForTokenRefresh).toHaveBeenCalledTimes(1);
  });

  it("returns the response directly on non-401 errors (no retry)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchOpenAceProjects()).rejects.toThrow(/Failed to fetch projects/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenUtils.notifyAndWaitForTokenRefresh).not.toHaveBeenCalled();
  });

  it("does not attempt refresh in standalone mode (no token)", async () => {
    vi.mocked(tokenUtils.getToken).mockReturnValue(undefined);
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(fetchOpenAceProjects()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenUtils.notifyAndWaitForTokenRefresh).not.toHaveBeenCalled();
  });

  it("does not retry more than once even if the retry is also 401", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(fetchOpenAceProjects()).rejects.toThrow(/Failed to fetch projects/);
    // Original call + exactly one retry, then the 401 is surfaced to the caller.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
