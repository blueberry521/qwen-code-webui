/**
 * Tests for the loop detection preview (raw error snippet next to the
 * opaque hash fingerprint) — review feedback on #224/#227.
 */
import { describe, it, expect } from "vitest";
import { extractErrorFingerprint, checkLoop } from "../../utils/loopDetector.js";

function sdkError(text: string) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text, is_error: true }],
    },
  };
}

describe("loopDetector preview", () => {
  it("returns a preview of the normalized error content on detection", () => {
    const longError = "FAILED test_auth.py::test_login - AssertionError: expected 200, got 401";
    const state = { errorCount: 0, lastFingerprint: "", firstErrorTime: 0 };
    let result: ReturnType<typeof checkLoop> = null;
    for (let i = 0; i < 3 && !result; i++) {
      result = checkLoop(sdkError(longError), state);
    }
    expect(result).not.toBeNull();
    expect(result!.fingerprint).toMatch(/^[0-9a-z]+$/);
    expect(result!.preview).toBe(longError.toLowerCase().slice(0, 60));
  });

  it("caps the preview at 60 characters and collapses whitespace", () => {
    const spaced = Array(20).fill("line of   output").join("\n");
    const state = { errorCount: 0, lastFingerprint: "", firstErrorTime: 0 };
    let result: ReturnType<typeof checkLoop> = null;
    for (let i = 0; i < 3 && !result; i++) {
      result = checkLoop(sdkError(spaced), state);
    }
    expect(result!.preview.length).toBe(60);
    expect(result!.preview).not.toMatch(/\s{2,}|\n/);
  });

  it("keeps the canonical fingerprint for known patterns with a readable preview", () => {
    const state = { errorCount: 0, lastFingerprint: "", firstErrorTime: 0 };
    const result = checkLoop(
      sdkError("Error: Input closed while reading stdin"),
      state,
    );
    // Fatal fingerprint aborts on first occurrence
    expect(result).toEqual({
      detected: true,
      fingerprint: "input_closed",
      count: 1,
      preview: "error: input closed while reading stdin".slice(0, 60),
    });
  });

  it("extractErrorFingerprint still returns the hash string only", () => {
    expect(extractErrorFingerprint(sdkError("boom"))).toMatch(/^[0-9a-z]+$/);
    expect(extractErrorFingerprint({ type: "assistant" })).toBeNull();
  });
});
