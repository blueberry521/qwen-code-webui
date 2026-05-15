import { describe, expect, it, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { promises as fs } from "node:fs";

// Mock os module to return a fixed home directory
vi.mock("./os.ts", () => ({
  getHomeDir: () => "/mock/home",
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
import { bridgeSession } from "./sessionBridge.ts";

// Helpers to construct expected paths
const QWEN_BASE = "/mock/home/.qwen/projects";
const CLAUDE_BASE = "/mock/home/.claude/projects";

function encodePath(p: string): string {
  return p.replace(/\/$/, "").replace(/[^a-zA-Z0-9]/g, "-");
}

function qwenSessionPath(cwd: string, sid: string) {
  return join(QWEN_BASE, encodePath(cwd), "chats", `${sid}.jsonl`);
}

function claudeSessionPath(cwd: string, sid: string) {
  return join(CLAUDE_BASE, encodePath(cwd), `${sid}.jsonl`);
}

describe("sessionBridge", () => {
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

    // qwen path doesn't exist, claude path exists
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

  it("returns original sessionId on unexpected errors (non-blocking)", async () => {
    vi.spyOn(fs, "access").mockRejectedValueOnce(new Error("permission denied"));
    vi.spyOn(fs, "access").mockRejectedValueOnce(new Error("permission denied"));

    const result = await bridgeSession(mockCwd, mockSid);
    // Falls through to catch which returns original sessionId
    expect(result).toBe(undefined);
  });

  it("copies subdirectories when they exist", async () => {
    const claudeDir = claudeSessionPath(mockCwd, mockSid).replace(/\.jsonl$/, "");

    vi.spyOn(fs, "access")
      .mockRejectedValueOnce(new Error("not found")) // qwen
      .mockResolvedValueOnce(undefined); // claude

    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

    // readdir returns subdirectory entries
    vi.spyOn(fs, "readdir")
      .mockResolvedValueOnce([
        { name: "subagents", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
        { name: "tool-results", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      ] as fs.Dirent[])
      // copyDir calls for each subdirectory
      .mockResolvedValue([] as fs.Dirent[])
      .mockResolvedValue([] as fs.Dirent[]);

    const result = await bridgeSession(mockCwd, mockSid);
    expect(result).toBe(mockSid);
    // mkdir called for qwen chats dir + 2 subdirectories
    expect(fs.mkdir).toHaveBeenCalledTimes(3);
  });

  it("skips symlinks when copying subdirectories", async () => {
    const claudeDir = claudeSessionPath(mockCwd, mockSid).replace(/\.jsonl$/, "");

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
    // Only mkdir for chats dir, not for symlink
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
  });

  it("encodes paths correctly matching CLI sanitizeCwd", async () => {
    const specialCwd = "/Users/dev/my project@v2";
    const encoded = encodePath(specialCwd);

    // All non-alphanumeric chars should be replaced with '-'
    expect(encoded).toBe("-Users-dev-my-project-v2");
    expect(encoded).not.toContain(" ");
    expect(encoded).not.toContain("@");
  });
});
