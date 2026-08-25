import { describe, it, expect, vi } from "vitest";
import { preserveToolInput, MAX_TOOL_INPUT_SIZE } from "./toolInputSnapshot.ts";

// Silence the warn logs the degradation paths emit.
vi.mock("../utils/logger.ts", () => ({
  logger: { chat: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } },
}));

describe("preserveToolInput", () => {
  it("returns undefined for missing input", () => {
    expect(preserveToolInput(undefined, "ask_user_question")).toBeUndefined();
  });

  it("deep-clones normal input (not the same reference)", () => {
    const input = { questions: [{ question: "Q?" }] };
    const snapshot = preserveToolInput(input, "ask_user_question");
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    // Mutating the original must not affect the snapshot.
    input.questions[0].question = "changed";
    expect((snapshot as { questions: Array<{ question: string }> }).questions[0].question).toBe("Q?");
  });

  describe("over the size limit", () => {
    // A questions payload whose serialized size exceeds MAX_TOOL_INPUT_SIZE.
    const huge = { questions: [{ question: "x".repeat(MAX_TOOL_INPUT_SIZE + 100) }] };

    it("drops the snapshot for ordinary tools", () => {
      expect(preserveToolInput(huge, "run_shell_command")).toBeUndefined();
    });

    it("still preserves questions for ask_user_question (by reference)", () => {
      const snapshot = preserveToolInput(huge, "ask_user_question");
      expect(snapshot).toBeDefined();
      expect(snapshot).toBe(huge); // falls back to original reference, never dropped
      expect((snapshot as typeof huge).questions).toHaveLength(1);
    });
  });

  describe("non-cloneable input (structuredClone throws)", () => {
    // A function value makes structuredClone throw a DataCloneError.
    const withFn = { questions: [{ question: "Q?" }], cb: () => 1 } as unknown as Record<string, unknown>;

    it("drops the snapshot for ordinary tools", () => {
      expect(preserveToolInput(withFn, "some_tool")).toBeUndefined();
    });

    it("preserves the original reference for ask_user_question", () => {
      const snapshot = preserveToolInput(withFn, "ask_user_question");
      expect(snapshot).toBe(withFn);
    });
  });
});
