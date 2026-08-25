import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  handlePermissionRespond,
  validateAskUserQuestionAnswers,
  MAX_ANSWER_LENGTH,
  MAX_TOTAL_ANSWERS_LENGTH,
  type PendingPermission,
} from "./permission.ts";
import type { PermissionRespondRequest } from "../../shared/types.ts";

// Mock Hono context
function createMockContext(body: PermissionRespondRequest) {
  return {
    req: {
      json: vi.fn().mockResolvedValue(body),
    },
    json: vi.fn().mockImplementation((data, status?: number) => {
      return { data, status };
    }),
  } as unknown as Parameters<typeof handlePermissionRespond>[0];
}

// A minimal valid single-question input, reused across ask_user_question tests.
function singleQuestion() {
  return [
    { question: "Framework?", header: "Framework", options: [{ label: "React" }, { label: "Vue" }], multiSelect: false },
  ];
}

describe("handlePermissionRespond", () => {
  const pendingPermissions = new Map<string, PendingPermission>();
  let mockResolve: Mock<PendingPermission["resolve"]>;
  let mockAbortSignal: AbortSignal;

  beforeEach(() => {
    pendingPermissions.clear();
    // Typed mock: vitest 4's `vi.fn()` returns the broad `Mock<Procedure | Constructable>`
    // which is no longer assignable to `PendingPermission["resolve"]` without a type arg.
    mockResolve = vi.fn<PendingPermission["resolve"]>();
    mockAbortSignal = new AbortController().signal;
  });

  describe("Basic functionality", () => {
    it("returns 400 for missing permissionId", async () => {
      const ctx = createMockContext({
        permissionId: "",
        behavior: "allow",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(
        { error: "Missing permissionId or behavior" },
        400,
      );
    });

    it("returns 400 for missing behavior", async () => {
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "invalid" as "allow" | "deny",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(
        { error: "Invalid behavior" },
        400,
      );
    });

    it("returns 404 for unknown permissionId", async () => {
      const ctx = createMockContext({
        permissionId: "unknown-id",
        behavior: "allow",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(
        { error: "Permission request not found or expired" },
        404,
      );
    });

    it("returns 410 for aborted request", async () => {
      const abortController = new AbortController();
      abortController.abort();

      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: abortController.signal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(
        { error: "Request was aborted" },
        410,
      );
    });
  });

  describe("Allow behavior", () => {
    it("resolves with allow for basic allow request", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: {} },
        undefined,
      );
      expect(ctx.json).toHaveBeenCalledWith({ success: true });
      expect(pendingPermissions.has("test-id")).toBe(false);
    });

    it("resolves with updatedInput for allow request", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
        originalInput: { command: "original" },
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        updatedInput: { command: "ls" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { command: "ls" } },
        undefined,
      );
    });

    it("resolves with scope for shell command", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        scope: "specific",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: {} },
        "specific",
      );
    });
  });

  describe("Deny behavior", () => {
    it("resolves with deny and default message", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "deny",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith({
        behavior: "deny",
        message: "User denied this tool call [proactive]",
      });
      expect(pendingPermissions.has("test-id")).toBe(false);
    });

    it("resolves with deny and custom message", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "deny",
        message: "Custom rejection reason",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith({
        behavior: "deny",
        message: "Custom rejection reason [proactive]",
      });
    });
  });

  describe("AskUserQuestion answers support", () => {
    it("includes answers in updatedInput for allow request", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput: { questions: singleQuestion() },
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { questions: singleQuestion(), answers: { "0": "React" } } },
        undefined,
      );
    });

    it("combines updatedInput and answers", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput: { questions: [{ question: "Test?", header: "Test", options: [{ label: "A" }, { label: "B" }], multiSelect: false }] },
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        updatedInput: { command: "test" },
        answers: { "0": "Option A" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { questions: [{ question: "Test?", header: "Test", options: [{ label: "A" }, { label: "B" }], multiSelect: false }], command: "test", answers: { "0": "Option A" } } },
        undefined,
      );
    });

    it("does not include answers in deny request", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput: { questions: singleQuestion() },
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "deny",
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith({
        behavior: "deny",
        message: "User denied this tool call [proactive]",
      });
    });

    it("preserves originalInput questions when answers provided", async () => {
      const originalQuestions = [
        { question: "Framework?", header: "Framework", options: [{ label: "React" }, { label: "Vue" }], multiSelect: false },
        { question: "Theme?", header: "Theme", options: [{ label: "Dark mode" }, { label: "Light mode" }], multiSelect: false },
      ];
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput: { questions: originalQuestions },
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "React", "1": "Dark mode" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { questions: originalQuestions, answers: { "0": "React", "1": "Dark mode" } } },
        undefined,
      );
    });

    it("prevents client from tampering with original questions", async () => {
      const originalQuestions = [
        { question: "Framework?", header: "Framework", options: [{ label: "React" }, { label: "Vue" }], multiSelect: false },
      ];
      const maliciousQuestions = [
        { question: "Malicious?", header: "Malicious", options: [{ label: "Hacked" }], multiSelect: false },
      ];
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput: { questions: originalQuestions },
      });

      // Client attempts to override questions with malicious data
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        updatedInput: { questions: maliciousQuestions, extra: "data" },
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      // Original questions should be preserved, malicious questions ignored
      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { questions: originalQuestions, extra: "data", answers: { "0": "React" } } },
        undefined,
      );
    });

    it("works without originalInput for non-ask tools (backward compatibility)", async () => {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "test_tool",
      });

      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        updatedInput: { command: "ls" },
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(mockResolve).toHaveBeenCalledWith(
        { behavior: "allow", updatedInput: { command: "ls", answers: { "0": "React" } } },
        undefined,
      );
    });
  });

  describe("AskUserQuestion answer validation (endpoint)", () => {
    function setPending(originalInput: Record<string, unknown>) {
      pendingPermissions.set("test-id", {
        resolve: mockResolve,
        requestId: "test-id",
        abortSignal: mockAbortSignal,
        toolName: "ask_user_question",
        originalInput,
      });
    }

    it("accepts a valid single-select answer", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith({ success: true });
      expect(mockResolve).toHaveBeenCalledTimes(1);
      expect(pendingPermissions.has("test-id")).toBe(false);
    });

    it("accepts a valid multi-select (joined labels) answer", async () => {
      setPending({
        questions: [
          { question: "Pick?", header: "Pick", options: [{ label: "A" }, { label: "B" }, { label: "C" }], multiSelect: true },
        ],
      });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "A, C" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith({ success: true });
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "allow", updatedInput: expect.objectContaining({ answers: { "0": "A, C" } }) }),
        undefined,
      );
    });

    it("accepts free-text 'Other' answers", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "Some custom framework I typed myself" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith({ success: true });
      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("rejects missing answers (no answers field) and keeps pending", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects a missing index within the answers object", async () => {
      setPending({
        questions: [
          { question: "Q1?", header: "Q1", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
          { question: "Q2?", header: "Q2", options: [{ label: "C" }, { label: "D" }], multiSelect: false },
        ],
      });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        // "1" missing, "5" out of range
        answers: { "0": "A", "5": "D" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects out-of-range / extra indices", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "React", "1": "extra" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects an array as answers", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: ["React"] as unknown as Record<string, string>,
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects a non-string (nested object) answer value", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": { nested: "obj" } } as unknown as Record<string, string>,
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects an over-length free-text answer", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "x".repeat(MAX_ANSWER_LENGTH + 1) },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("rejects when preserved questions are unavailable (snapshot degraded)", async () => {
      setPending({}); // no questions preserved
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "allow",
        answers: { "0": "React" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(pendingPermissions.has("test-id")).toBe(true);
    });

    it("does not validate answers on deny", async () => {
      setPending({ questions: singleQuestion() });
      const ctx = createMockContext({
        permissionId: "test-id",
        behavior: "deny",
        // structurally invalid answers, but deny path ignores them
        answers: { "0": "A", "9": "B" },
      });
      await handlePermissionRespond(ctx, pendingPermissions);

      expect(ctx.json).toHaveBeenCalledWith({ success: true });
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "deny" }),
      );
      expect(pendingPermissions.has("test-id")).toBe(false);
    });
  });
});

describe("validateAskUserQuestionAnswers", () => {
  const oneQuestion = [
    { question: "Q?", header: "Q", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
  ];
  const twoQuestions = [...oneQuestion, { question: "Q2?", header: "Q2", options: [{ label: "C" }, { label: "D" }], multiSelect: true }];

  it("accepts an exact 0..n-1 cover of string answers", () => {
    expect(validateAskUserQuestionAnswers({ "0": "A", "1": "C, D" }, twoQuestions)).toEqual({
      ok: true,
      answers: { "0": "A", "1": "C, D" },
    });
  });

  it("rejects when questions are not an array", () => {
    expect(validateAskUserQuestionAnswers({ "0": "A" }, undefined).ok).toBe(false);
  });

  it("rejects null / array / primitive answers", () => {
    expect(validateAskUserQuestionAnswers(null, oneQuestion).ok).toBe(false);
    expect(validateAskUserQuestionAnswers(["A"], oneQuestion).ok).toBe(false);
    expect(validateAskUserQuestionAnswers("A", oneQuestion).ok).toBe(false);
  });

  it("rejects the wrong number of entries", () => {
    expect(validateAskUserQuestionAnswers({ "0": "A" }, twoQuestions).ok).toBe(false);
    expect(validateAskUserQuestionAnswers({ "0": "A", "1": "C", "2": "extra" }, twoQuestions).ok).toBe(false);
  });

  it("rejects a missing 0..n-1 index (correct count, wrong keys)", () => {
    expect(validateAskUserQuestionAnswers({ "0": "A", "2": "C" }, twoQuestions).ok).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(validateAskUserQuestionAnswers({ "0": 123 as unknown as string }, oneQuestion).ok).toBe(false);
  });

  it("rejects a spurious __proto__ own-key (as JSON.parse would produce)", () => {
    // JSON.parse turns "__proto__" into a real own property; it must count as an
    // extra key and push the required index out, so validation fails.
    const parsed = JSON.parse('{"__proto__":"x","0":"A"}') as Record<string, unknown>;
    expect(validateAskUserQuestionAnswers(parsed, oneQuestion).ok).toBe(false);
  });

  it("enforces the per-answer length limit", () => {
    expect(
      validateAskUserQuestionAnswers({ "0": "x".repeat(MAX_ANSWER_LENGTH + 1) }, oneQuestion).ok,
    ).toBe(false);
  });

  it("enforces the total-size limit across answers within per-answer caps", () => {
    // Spread the payload across enough answers that each stays under the
    // per-answer cap while the sum exceeds the total cap.
    const count = Math.floor(MAX_TOTAL_ANSWERS_LENGTH / MAX_ANSWER_LENGTH) + 1;
    const perAnswer = "x".repeat(MAX_ANSWER_LENGTH); // exactly at the per-answer cap (allowed)
    const questions = Array.from({ length: count }, (_v, i) => ({
      question: `Q${i}?`, header: `Q${i}`, options: [{ label: "A" }, { label: "B" }], multiSelect: false,
    }));
    const answers: Record<string, string> = {};
    for (let i = 0; i < count; i++) answers[String(i)] = perAnswer;

    expect(count * MAX_ANSWER_LENGTH).toBeGreaterThan(MAX_TOTAL_ANSWERS_LENGTH);
    expect(validateAskUserQuestionAnswers(answers, questions).ok).toBe(false);
  });
});
