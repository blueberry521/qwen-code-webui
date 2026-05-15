/**
 * Session bridge between Claude Code and qwen CLI session storage.
 *
 * Claude Code stores sessions in ~/.claude/projects/<project>/, while the
 * qwen CLI stores them in ~/.qwen/projects/<project>/chats/. When the webui
 * loads a Claude Code session from history and the user sends a new message,
 * the qwen CLI cannot find the session file. This module bridges the gap by
 * copying the session file (and its subdirectories) to the qwen directory.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { getHomeDir } from "./os.ts";
import { logger } from "./logger.ts";

/**
 * Encode a project path to match the directory naming convention.
 * Both Claude Code and qwen replace '/', '\', ':', '.', '_' with '-'.
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\/$/, "").replace(/[/\\:._]/g, "-");
}

/**
 * Get the qwen session file path.
 * qwen stores: ~/.qwen/projects/<encodedProject>/chats/<sessionId>.jsonl
 */
function getQwenSessionPath(workingDirectory: string, sessionId: string): string {
  const homeDir = getHomeDir();
  if (!homeDir) throw new Error("Home directory not found");
  const encoded = encodeProjectPath(workingDirectory);
  return join(homeDir, ".qwen", "projects", encoded, "chats", `${sessionId}.jsonl`);
}

/**
 * Get the Claude Code session file path.
 * Claude stores: ~/.claude/projects/<encodedProject>/<sessionId>.jsonl
 */
function getClaudeSessionPath(workingDirectory: string, sessionId: string): string {
  const homeDir = getHomeDir();
  if (!homeDir) throw new Error("Home directory not found");
  const encoded = encodeProjectPath(workingDirectory);
  return join(homeDir, ".claude", "projects", encoded, `${sessionId}.jsonl`);
}

/**
 * Recursively copy a directory.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Ensure a qwen session file exists for resume. If the session only exists in
 * the Claude Code directory, copy it (and its subdirectories) to the qwen
 * directory. Returns the effective sessionId or undefined if not found anywhere.
 */
export async function bridgeSession(
  workingDirectory: string | undefined,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId || !workingDirectory) return sessionId;

  try {
    const qwenPath = getQwenSessionPath(workingDirectory, sessionId);

    // Fast path: session already exists in qwen directory
    try {
      await fs.access(qwenPath);
      return sessionId;
    } catch {
      // Not found in qwen, continue to check Claude Code
    }

    const claudePath = getClaudeSessionPath(workingDirectory, sessionId);

    // Check if session exists in Claude Code directory
    try {
      await fs.access(claudePath);
    } catch {
      // Not found anywhere — let the CLI handle the missing session
      logger.chat.warn(
        "Session {sessionId} not found in qwen or claude directories, clearing for fresh start",
        { sessionId },
      );
      return undefined;
    }

    // Copy session JSONL file to qwen directory
    await fs.mkdir(dirname(qwenPath), { recursive: true });
    await fs.copyFile(claudePath, qwenPath);

    logger.chat.info(
      "Bridged session {sessionId} from claude to qwen directory",
      { sessionId },
    );

    // Copy subdirectories (subagents, tool-results) if they exist
    const claudeSessionDir = claudePath.replace(/\.jsonl$/, "");
    const qwenSessionDir = qwenPath.replace(/\.jsonl$/, "");
    try {
      const entries = await fs.readdir(claudeSessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const srcDir = join(claudeSessionDir, entry.name);
          const destDir = join(qwenSessionDir, entry.name);
          await copyDir(srcDir, destDir);
          logger.chat.debug(
            "Bridged session subdirectory {subdir} for session {sessionId}",
            { subdir: entry.name, sessionId },
          );
        }
      }
    } catch {
      // Session directory doesn't exist or is empty — that's fine
    }

    return sessionId;
  } catch (error) {
    logger.chat.error(
      "Error bridging session {sessionId}: {error}",
      { sessionId, error },
    );
    return sessionId; // Don't block the request on bridge errors
  }
}
