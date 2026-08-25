import { logger } from "../utils/logger.ts";

/**
 * Maximum size for tool input that will be preserved in pending permissions.
 * Inputs larger than this limit are not stored to prevent memory issues.
 * 1 MB limit provides plenty of room for reasonable tool inputs.
 */
export const MAX_TOOL_INPUT_SIZE = 1_000_000; // 1 MB

/**
 * Preserve a snapshot of a tool's input so it can be merged back when the user
 * responds to the permission prompt (see handlePermissionRespond).
 *
 * For most tools the snapshot is a defensive deep clone, skipped when the input
 * is too large or not cloneable — losing the snapshot only means the client's
 * updatedInput is used verbatim, which is acceptable.
 *
 * `ask_user_question` is different: permission.ts strips the client-supplied
 * `questions` to prevent tampering, so the server-side snapshot is the ONLY
 * source of the original questions. If it were dropped, the SDK would receive
 * answers with no questions — the exact regression of #217. We therefore never
 * silently drop the snapshot for `ask_user_question`: when cloning is not
 * possible we fall back to referencing the original object (already retained by
 * the surrounding closure, so this adds no memory).
 */
export function preserveToolInput(
  input: Record<string, unknown> | undefined,
  toolName: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!input) return undefined;

  const mustPreserve = toolName === "ask_user_question";

  try {
    const inputSize = JSON.stringify(input).length;
    if (inputSize <= MAX_TOOL_INPUT_SIZE) {
      return structuredClone(input) as Readonly<Record<string, unknown>>;
    }
    if (mustPreserve) {
      logger.chat.warn(
        "ask_user_question input exceeds size limit ({size} bytes); preserving original reference to keep questions, toolName={toolName}",
        { size: inputSize, toolName },
      );
      return input as Readonly<Record<string, unknown>>;
    }
    logger.chat.warn(
      "Tool input too large to preserve, size={size} bytes, toolName={toolName}",
      { size: inputSize, toolName },
    );
    return undefined;
  } catch {
    // JSON.stringify (circular refs) or structuredClone (non-cloneable values
    // like functions) may throw. For ask_user_question we still must keep the
    // questions, so fall back to the original reference.
    if (mustPreserve) {
      logger.chat.warn(
        "Failed to clone ask_user_question input; preserving original reference for toolName={toolName}",
        { toolName },
      );
      return input as Readonly<Record<string, unknown>>;
    }
    logger.chat.warn("Failed to clone tool input for toolName={toolName}", { toolName });
    return undefined;
  }
}
