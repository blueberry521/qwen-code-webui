import { Context } from "hono";
import type { PermissionRespondRequest } from "../../shared/types.ts";
import type { PermissionResult } from "@qwen-code/sdk";
import { logger } from "../utils/logger.ts";

export interface PendingPermission {
  resolve: (result: PermissionResult, scope?: "specific" | "all") => void;
  abortSignal: AbortSignal;
  requestId: string; // 关联的请求 ID，用于延迟 abort 检测
  toolName: string; // 工具名称，用于特定工具的处理逻辑
  originalInput?: Readonly<Record<string, unknown>>; // 原始工具输入，用于合并 answers
}

/** Maximum length of a single answer string (covers free-text "Other"). */
export const MAX_ANSWER_LENGTH = 10_000;
/** Maximum combined length of all answer strings for one request. */
export const MAX_TOTAL_ANSWERS_LENGTH = 40_000;

type AnswersValidation =
  | { ok: true; answers: Record<string, string> }
  | { ok: false; error: string };

/**
 * Validate client-submitted answers for the ask_user_question tool.
 *
 * The request body type is only a compile-time contract; a caller can POST
 * arbitrary JSON. Without this check, arrays, nested objects, missing/extra/
 * out-of-range indices, and unbounded free text would be forwarded straight to
 * the SDK while the endpoint still reported success. We validate structurally
 * against the authoritative questions preserved server-side:
 *   - answers is a plain object (not null, not an array)
 *   - keys are exactly the string indices 0..questions.length-1
 *   - every value is a string within length / total-size limits
 * Value contents are intentionally not checked against option labels: multi-
 * select answers are joined labels and "Other" is arbitrary free text.
 */
export function validateAskUserQuestionAnswers(
  answers: unknown,
  originalQuestions: unknown,
): AnswersValidation {
  if (!Array.isArray(originalQuestions)) {
    // Questions must have been preserved (see toolInputSnapshot). If they are
    // missing we cannot safely validate, so reject rather than forward blindly.
    return { ok: false, error: "Original questions unavailable; cannot validate answers" };
  }
  const expectedCount = originalQuestions.length;

  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { ok: false, error: "answers must be an object mapping question index to answer" };
  }

  const record = answers as Record<string, unknown>;
  const keyCount = Object.keys(record).length;
  if (keyCount !== expectedCount) {
    return {
      ok: false,
      error: `answers must contain exactly ${expectedCount} entr${expectedCount === 1 ? "y" : "ies"}, got ${keyCount}`,
    };
  }

  let totalLength = 0;
  for (let i = 0; i < expectedCount; i++) {
    const key = String(i);
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return { ok: false, error: `Missing answer for question index ${i}` };
    }
    const value = record[key];
    if (typeof value !== "string") {
      return { ok: false, error: `Answer for question index ${i} must be a string` };
    }
    if (value.length > MAX_ANSWER_LENGTH) {
      return { ok: false, error: `Answer for question index ${i} exceeds maximum length` };
    }
    totalLength += value.length;
  }
  // keyCount === expectedCount and every index 0..n-1 is present, so there are
  // no extra keys — the pigeonhole guarantees an exact 0..n-1 cover.
  if (totalLength > MAX_TOTAL_ANSWERS_LENGTH) {
    return { ok: false, error: "Total answers size exceeds maximum" };
  }

  return { ok: true, answers: record as Record<string, string> };
}

export async function handlePermissionRespond(
  c: Context,
  pendingPermissions: Map<string, PendingPermission>,
) {
  const body = await c.req.json<PermissionRespondRequest>();
  if (!body?.permissionId || !body?.behavior) {
    return c.json({ error: "Missing permissionId or behavior" }, 400);
  }
  if (body.behavior !== "allow" && body.behavior !== "deny") {
    return c.json({ error: "Invalid behavior" }, 400);
  }

  const pending = pendingPermissions.get(body.permissionId);
  if (!pending) {
    logger.chat.warn("Permission response for unknown ID: {permissionId}", {
      permissionId: body.permissionId,
    });
    return c.json({ error: "Permission request not found or expired" }, 404);
  }
  if (pending.abortSignal.aborted) {
    pendingPermissions.delete(body.permissionId);
    return c.json({ error: "Request was aborted" }, 410);
  }

  // For ask_user_question, validate the client-submitted answers BEFORE
  // consuming the pending permission. On invalid input we return 4xx and leave
  // the pending permission intact so the client can retry (and so bad input is
  // never forwarded to the SDK).
  let validatedAnswers: Record<string, string> | undefined;
  if (body.behavior === "allow" && pending.toolName === "ask_user_question") {
    const validation = validateAskUserQuestionAnswers(
      body.answers,
      pending.originalInput?.questions,
    );
    if (!validation.ok) {
      logger.chat.warn("Rejected ask_user_question answers for {permissionId}: {error}", {
        permissionId: body.permissionId,
        error: validation.error,
      });
      return c.json({ error: validation.error }, 400);
    }
    validatedAnswers = validation.answers;
  }

  pendingPermissions.delete(body.permissionId);

  if (body.behavior === "allow") {
    // Merge original input with user-provided updatedInput
    // For ask_user_question, preserve original questions to prevent client tampering
    const clientUpdatedInput = body.updatedInput || {};
    const originalInput = pending.originalInput || {};

    // For ask_user_question tool, exclude 'questions' from client-submitted updatedInput
    // to prevent client tampering with original questions
    let safeClientInput: Record<string, unknown>;
    if (pending.toolName === "ask_user_question") {
      const { questions: _clientQuestions, ...rest } = clientUpdatedInput;
      safeClientInput = rest;
    } else {
      safeClientInput = clientUpdatedInput;
    }

    const updatedInput = {
      ...originalInput,
      ...safeClientInput,
    };

    // Add answers if provided. For ask_user_question these are the validated
    // answers; for other tools the raw body value is forwarded as before.
    if (pending.toolName === "ask_user_question") {
      if (validatedAnswers) {
        updatedInput.answers = validatedAnswers;
      }
    } else if (body.answers) {
      updatedInput.answers = body.answers;
    }

    pending.resolve({
      behavior: "allow",
      updatedInput,
    }, body.scope);
  } else {
    const message = body.message
      ? `${body.message} [proactive]`
      : `User denied this tool call [proactive]`;
    pending.resolve({
      behavior: "deny",
      message,
    });
  }

  logger.chat.debug("Permission {behavior} for {permissionId}", {
    behavior: body.behavior,
    permissionId: body.permissionId,
  });
  return c.json({ success: true });
}
