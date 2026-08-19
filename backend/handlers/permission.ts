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

    // Add answers if provided
    if (body.answers) {
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
