import { describe, expect, it, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { promises as fs } from "node:fs";

// Mock os module with vi.fn to allow per-test overrides
vi.mock("./os.ts", () => ({
  getHomeDir: vi.fn(() => "/mock/home"),
}));

// Mock logger
vi.mock("./logger.ts", () => ({
  logger: {
    chat: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Import after mocks are set up
import { bridgeSession, encodeProjectPath } from "./sessionBridge.ts";

// Helpers to construct expected paths using the production encoding
const QWEN_BASE = "/mock/home/.qwen/projects";
const CLAUDE_BASE = "/mock/home/.claude/projects";

function qwenSessionPath(cwd: string, sid: string) {
  return join(QWEN_BASE, encodeProjectPath(cwd), "chats", `${sid}.jsonl`);
}

function claudeSessionPath(cwd: string, sid: string) {
  return join(CLAUDE_BASE, encodeProjectPath(cwd), `${sid}.jsonl`);
}

describe("encodeProjectPath", () => {
  it("replaces all non-alphanumeric chars with dash (matches CLI sanitizeCwd)", () => {
    expect(encodeProjectPath("/Users/dev/my project@v2"))
      .toBe("-Users-dev-my-project-v2");
    expect(encodeProjectPath("/Users/dev/open-ace"))
      .toBe("-Users-dev-open-ace");
    expect(encodeProjectPath("/path/with.dots_and:colons"))
      .toBe("-path-with-dots-and-colons");
  });

  it("strips trailing slash before encoding", () => {
    expect(encodeProjectPath("/Users/dev/")).toBe("-Users-dev");
  });
});

describe("bridgeSession", () => {
  const mockCwd = "/Users/dev/project";
  const mockSid = "abc-123-def";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns sessionId unchanged when no workingDirectory", async () => {
    const result = await bridgeSession(undefined, mockSid);
    expect(result).toBe(mockSid);
  });

  it("returns sessionId unchanged when no sessionId", async () => {
    const result = await bridgeSession(mockCwd, undefined);
    expect(result).toBe(undefined);
  });

  it("returns sessionId when session exists in qwen directory", async () => {
    vi.spyOn(fs, "access").mockResolvedValueOnce(undefined); // qwen path exists

    const result = await bridgeSession(mockCwd, mockSid);
    expect(result).toBe(mockSid);
  });

  it("copies session from claude to qwen when only in claude directory", async () => {
    const qwenPath = qwenSessionPath(mockCwd, mockSid);
    const claudePath = claudeSessionPath(mockCwd, mockSid);

    vi.spyOn(fs, "access")
      .mockRejectedValueOnce(new Error("not found")) // qwen
      .mockResolvedValueOnce(undefined); // claude

    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
    vi.spyOn(fs, "readdir").mockRejectedValue(new Error("no dir"));

    const result = await bridgeSession(mockCwd, mockSid);

    expect(result).toBe(mockSid);
    expect(fs.copyFile).toHaveBeenCalledWith(claudePath, qwenPath);
  });

  it("returns undefined when session not found in either directory", async () => {
    vi.spyOn(fs, "access")
      .mockRejectedValueOnce(new Error("not found")) // qwen
      .mockRejectedValueOnce(new Error("not found")); // claude

    const result = await bridgeSession(mockCwd, mockSid);
    expect(result).toBe(undefined);
  });

  it("returns original sessionId when outer catch handles unexpected error", async () => {
    // Trigger outer catch by making getHomeDir return undefined, causing
    // getQwenSessionPath to throw "Home directory not found"
    const os = await import("./os.ts");
    vi.mocked(os.getHomeDir).mockReturnValueOnce(undefined);

    const result = await bridgeSession(mockCwd, mockSid);
    // Outer catch returns original sessionId to avoid blocking the request
    expect(result).toBe(mockSid);
  });

  it("copies subdirectories when they exist", async () => {
    vi.spyOn(fs, "access")
      .mockRejectedValueOnce(new Error("not found")) // qwen
      .mockResolvedValueOnce(undefined); // claude

    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

    vi.spyOn(fs, "readdir")
      .mockResolvedValueOnce([
        { name: "subagents", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
        { name: "tool-results", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      ] as fs.Dirent[])
      .mockResolvedValue([] as fs.Dirent[])
      .mockResolvedValue([] as fs.Dirent[]);

    const result = await bridgeSession(mockCwd, mockSid);
    expect(result).toBe(mockSid);
    expect(fs.mkdir).toHaveBeenCalledTimes(3);
  });

  it("skips symlinks when copying subdirectories", async () => {
    vi.spyOn(fs, "access")
      .mockRejectedValueOnce(new Error("not found")) // qwen
      .mockResolvedValueOnce(undefined); // claude

    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

    vi.spyOn(fs, "readdir").mockResolvedValueOnce([
      { name: "symlink-dir", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => true },
    ] as fs.Dirent[]);

    const result = await bridgeSession(mockCwd, mockSid);
    expect(result).toBe(mockSid);
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
  });

  it("uses production encodeProjectPath for path construction", async () => {
    const specialCwd = "/Users/dev/my project";
    const encoded = encodeProjectPath(specialCwd);

    // Verify spaces are encoded (the production function handles this)
    expect(encoded).not.toContain(" ");

    const qwenPath = qwenSessionPath(specialCwd, mockSid);
    expect(qwenPath).toContain(encoded);
  });
});
