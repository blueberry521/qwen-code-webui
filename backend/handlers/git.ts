import { Context } from "hono";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { AppConfig } from "../types.ts";
import { logger } from "../utils/logger.ts";
import { readTextFile, exists } from "../utils/fs.ts";
import { readProjectPathMapping } from "../utils/projectMapping.ts";

interface FileChange {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
}

function validatePath(workingDirectory: string, filePath: string): string {
  const resolved = resolve(workingDirectory, filePath);
  const base = realpathSync(resolve(workingDirectory));
  if (!resolved.startsWith(base)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

async function validateWorkingDirectory(workingDirectory: string): Promise<boolean> {
  const mapping = await readProjectPathMapping();
  const knownPaths = Object.values(mapping);
  if (knownPaths.length === 0) {
    // No projects registered yet — allow any valid git repo (first-use scenario)
    return true;
  }
  const resolved = resolve(workingDirectory);
  return knownPaths.some((p) => resolve(p) === resolved);
}

async function runGit(
  runtime: AppConfig["runtime"],
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const result = await runtime.runCommand("git", ["-C", cwd, ...args]);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    success: result.success,
  };
}

export async function handleGitStatusRequest(c: Context) {
  const config = c.var.config as AppConfig;
  const workingDirectory = c.req.query("workingDirectory");

  if (!workingDirectory) {
    return c.json({ error: "workingDirectory is required" }, 400);
  }

  try {
    const resolvedWd = resolve(workingDirectory);

    if (!(await validateWorkingDirectory(workingDirectory))) {
      return c.json({ error: "workingDirectory is not a known project" }, 403);
    }

    const gitDirExists = await exists(resolve(resolvedWd, ".git"));
    if (!gitDirExists) {
      return c.json({ files: [] });
    }

    const hasHead = await runGit(config.runtime, ["rev-parse", "HEAD"], resolvedWd);

    const diffArgs = hasHead.success
      ? ["diff", "--numstat", "HEAD"]
      : ["diff", "--cached", "--numstat"];
    const diffStatResult = await runGit(config.runtime, diffArgs, resolvedWd);

    const statusResult = await runGit(
      config.runtime,
      ["status", "--porcelain"],
      resolvedWd,
    );

    const files: Map<string, FileChange> = new Map();

    if (diffStatResult.success && diffStatResult.stdout.trim()) {
      for (const line of diffStatResult.stdout.trim().split("\n")) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
          const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
          const path = parts[2];
          files.set(path, {
            path,
            status: additions > 0 && deletions === 0 ? "added" : "modified",
            additions,
            deletions,
          });
        }
      }
    }

    if (statusResult.success && statusResult.stdout.trim()) {
      for (const line of statusResult.stdout.trim().split("\n")) {
        if (line.length < 4) continue;
        const statusCode = line.substring(0, 2);

        let filePath: string;
        if (statusCode.includes("R") && line.includes(" -> ")) {
          filePath = line.substring(3).split(" -> ")[1];
        } else {
          filePath = line.substring(3);
        }

        if (files.has(filePath)) {
          const existing = files.get(filePath)!;
          if (statusCode.includes("D")) {
            existing.status = "deleted";
          } else if (statusCode.includes("A") || statusCode === "??") {
            existing.status = "added";
          }
        } else if (statusCode === "??") {
          files.set(filePath, {
            path: filePath,
            status: "added",
            additions: 0,
            deletions: 0,
          });
        } else if (statusCode.includes("D")) {
          files.set(filePath, {
            path: filePath,
            status: "deleted",
            additions: 0,
            deletions: 0,
          });
        }
      }
    }

    for (const [path, change] of files) {
      if (change.status === "added" && change.additions === 0) {
        try {
          const fullPath = validatePath(resolvedWd, path);
          const content = await readTextFile(fullPath);
          change.additions = content.split("\n").length;
        } catch {
          // Binary file, unreadable, or path traversal
        }
      }
    }

    return c.json({
      files: Array.from(files.values()).sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
    });
  } catch (error) {
    logger.app.error("Git status error: {error}", { error });
    return c.json({ error: "Failed to get git status" }, 500);
  }
}

export async function handleGitDiffRequest(c: Context) {
  const config = c.var.config as AppConfig;
  const workingDirectory = c.req.query("workingDirectory");
  const file = c.req.query("file");

  if (!workingDirectory || !file) {
    return c.json({ error: "workingDirectory and file are required" }, 400);
  }

  try {
    if (!(await validateWorkingDirectory(workingDirectory))) {
      return c.json({ error: "workingDirectory is not a known project" }, 403);
    }

    const resolvedWd = resolve(workingDirectory);
    validatePath(resolvedWd, file);

    const hasHead = await runGit(config.runtime, ["rev-parse", "HEAD"], resolvedWd);

    const diffArgs = hasHead.success
      ? ["diff", "HEAD", "--", file]
      : ["diff", "--cached", "--", file];
    const diffResult = await runGit(config.runtime, diffArgs, resolvedWd);

    let originalContent = "";
    if (hasHead.success) {
      const showResult = await runGit(
        config.runtime,
        ["show", `HEAD:${file}`],
        resolvedWd,
      );
      if (showResult.success) {
        originalContent = showResult.stdout;
      }
    }

    let modifiedContent = "";
    try {
      const fullPath = resolve(resolvedWd, file);
      modifiedContent = await readTextFile(fullPath);
    } catch {
      // File might be deleted
    }

    return c.json({
      file,
      diff: diffResult.success ? diffResult.stdout : "",
      originalContent,
      modifiedContent,
    });
  } catch (error) {
    logger.app.error("Git diff error: {error}", { error });
    return c.json({ error: "Failed to get git diff" }, 500);
  }
}

export async function handleGitFileRequest(c: Context) {
  const workingDirectory = c.req.query("workingDirectory");
  const file = c.req.query("file");

  if (!workingDirectory || !file) {
    return c.json({ error: "workingDirectory and file are required" }, 400);
  }

  try {
    if (!(await validateWorkingDirectory(workingDirectory))) {
      return c.json({ error: "workingDirectory is not a known project" }, 403);
    }

    const resolvedWd = resolve(workingDirectory);
    const fullPath = validatePath(resolvedWd, file);

    const content = await readTextFile(fullPath);
    return c.json({ file, content });
  } catch (error) {
    logger.app.error("Git file read error: {error}", { error });
    return c.json({ error: "Failed to read file" }, 500);
  }
}
