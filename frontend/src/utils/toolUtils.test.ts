import { describe, it, expect } from "vitest";
import {
  extractToolInfo,
  generateToolPatterns,
  generateToolPattern,
} from "./toolUtils";
import { TOOL_NAMES } from "./toolNames";

describe("toolUtils", () => {
  describe("extractToolInfo", () => {
    it("should extract single command from simple bash command", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, { command: "ls -la" });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["ls"]);
    });

    it("should extract multiple commands from compound bash command with &&", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "cd venv && pwd && ls -la",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["ls"]); // cd and pwd are builtins, filtered out
    });

    it("should extract multiple commands and filter out bash builtins", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "cd dir && find . && grep pattern",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["find", "grep"]);
    });

    it("should handle commands with semicolon separator", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "echo hello; ls; pwd",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["echo", "ls"]); // pwd is builtin, echo and ls require permission
    });

    it("should handle commands with pipe separator", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, { command: "ls | grep .txt" });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["ls", "grep"]);
    });

    it("should handle multi-word commands", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "git log && cargo build",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["git log", "cargo build"]);
    });

    it("should return unique commands when duplicated", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "ls && find . && ls -la",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["ls", "find"]);
    });

    it("should handle non-Bash tools with wildcard", () => {
      const result = extractToolInfo(TOOL_NAMES.WRITE, { file_path: "/path/to/file" });
      expect(result.toolName).toBe(TOOL_NAMES.WRITE);
      expect(result.commands).toEqual(["*"]);
    });

    it("should extract echo command (no longer a builtin)", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "cd dir && pwd && echo hello",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["echo"]); // cd and pwd are builtins, echo requires permission
    });

    it("should handle command -v (no longer a builtin)", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "command -v ls",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["command"]); // command now requires permission
    });

    it("should handle type command (no longer a builtin)", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "type -t ls",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["type"]); // type now requires permission
    });

    it("should use fallback when all commands are builtins", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "cd /tmp && pwd && which git",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["cd", "pwd", "which"]); // All are builtins, use fallback
    });

    it("should handle find command with complex arguments", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "find . -name '*.txt'",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["find"]);
    });

    it("should handle grep command with pattern and files", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "grep -r 'pattern' /path/to/files",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["grep"]);
    });

    it("should handle complex compound command with find, grep, and ls", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "find . -name '*.txt' | grep pattern && ls -la",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["find", "grep", "ls"]);
    });

    it("should handle commands with arguments before options", () => {
      const result = extractToolInfo(TOOL_NAMES.BASH, {
        command: "tar -czf archive.tar.gz /path/to/files",
      });
      expect(result.toolName).toBe(TOOL_NAMES.BASH);
      expect(result.commands).toEqual(["tar"]);
    });
  });

  describe("generateToolPatterns", () => {
    it("should generate single pattern for non-Bash tools", () => {
      const patterns = generateToolPatterns(TOOL_NAMES.WRITE, ["*"]);
      expect(patterns).toEqual([TOOL_NAMES.WRITE]);
    });

    it("should generate multiple patterns for Bash commands", () => {
      const patterns = generateToolPatterns(TOOL_NAMES.BASH, ["ls", "grep"]);
      expect(patterns).toEqual([`${TOOL_NAMES.BASH}(ls:*)`, `${TOOL_NAMES.BASH}(grep:*)`]);
    });

    it("should handle wildcard commands", () => {
      const patterns = generateToolPatterns(TOOL_NAMES.BASH, ["*"]);
      expect(patterns).toEqual([TOOL_NAMES.BASH]);
    });

    it("should handle mixed commands", () => {
      const patterns = generateToolPatterns(TOOL_NAMES.BASH, ["ls", "*", "grep"]);
      expect(patterns).toEqual([`${TOOL_NAMES.BASH}(ls:*)`, TOOL_NAMES.BASH, `${TOOL_NAMES.BASH}(grep:*)`]);
    });
  });

  describe("generateToolPattern (backward compatibility)", () => {
    it("should generate single pattern for Bash command", () => {
      const pattern = generateToolPattern(TOOL_NAMES.BASH, "ls");
      expect(pattern).toBe(`${TOOL_NAMES.BASH}(ls:*)`);
    });

    it("should return tool name for wildcard", () => {
      const pattern = generateToolPattern(TOOL_NAMES.BASH, "*");
      expect(pattern).toBe(TOOL_NAMES.BASH);
    });

    it("should return tool name for non-Bash tools", () => {
      const pattern = generateToolPattern(TOOL_NAMES.WRITE, "anything");
      expect(pattern).toBe(TOOL_NAMES.WRITE);
    });
  });
});
