import { describe, it, expect } from "vitest";
import { normalizeWindowsPath, formatVSCodeFolderPath } from "./pathUtils";

describe("normalizeWindowsPath", () => {
  it("removes leading slash from Windows path", () => {
    expect(normalizeWindowsPath("/C:/workspace")).toBe("C:/workspace");
  });

  it("converts backslashes to forward slashes", () => {
    expect(normalizeWindowsPath("C:\\workspace")).toBe("C:/workspace");
  });

  it("leaves Unix paths unchanged", () => {
    expect(normalizeWindowsPath("/home/user/workspace")).toBe("/home/user/workspace");
  });
});

describe("formatVSCodeFolderPath", () => {
  it("adds leading slash to Windows path with forward slash", () => {
    expect(formatVSCodeFolderPath("C:/workspace")).toBe("/C:/workspace");
  });

  it("converts backslashes to forward slashes", () => {
    expect(formatVSCodeFolderPath("C:\\workspace")).toBe("/C:/workspace");
  });

  it("preserves Unix path unchanged", () => {
    expect(formatVSCodeFolderPath("/home/user/workspace")).toBe("/home/user/workspace");
  });

  it("removes duplicate leading slashes", () => {
    expect(formatVSCodeFolderPath("//C:/workspace")).toBe("/C:/workspace");
  });

  it("returns empty string for empty input", () => {
    expect(formatVSCodeFolderPath("")).toBe("");
  });

  it("handles paths with multiple backslashes", () => {
    expect(formatVSCodeFolderPath("C:\\Users\\test\\workspace")).toBe("/C:/Users/test/workspace");
  });

  it("handles mixed slashes", () => {
    expect(formatVSCodeFolderPath("C:/Users\\test/workspace")).toBe("/C:/Users/test/workspace");
  });
});