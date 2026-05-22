import { Context } from "hono";
import type { AppConfig } from "../types.ts";
import { logger } from "../utils/logger.ts";

interface VSCodeProcess {
  process: {
    pid: number;
    kill: () => void;
  };
  port: number;
  workingDirectory: string;
}

// In-memory state for code-server process
let vscodeProcess: VSCodeProcess | null = null;

async function findCodeServer(
  runtime: AppConfig["runtime"],
): Promise<string | null> {
  try {
    const paths = await runtime.findExecutable("code-server");
    return paths.length > 0 ? paths[0] : null;
  } catch {
    return null;
  }
}

export async function handleVSCodeStartRequest(c: Context) {
  const config = c.var.config as AppConfig;
  const workingDirectory = c.req.query("workingDirectory");

  if (!workingDirectory) {
    return c.json({ error: "workingDirectory is required" }, 400);
  }

  // Check if already running
  if (vscodeProcess) {
    return c.json({
      port: vscodeProcess.port,
      url: `/vscode/`,
      alreadyRunning: true,
    });
  }

  try {
    // Check if code-server is available
    const codeServerPath = await findCodeServer(config.runtime);
    if (!codeServerPath) {
      return c.json(
        { error: "code-server is not installed. Install with: curl -fsSL https://code-server.dev/install.sh | sh" },
        404,
      );
    }

    // Start code-server with a dynamic port
    const result = await config.runtime.runCommand(codeServerPath, [
      "--port", "0",
      "--auth", "none",
      "--disable-workspace-trust",
      "--disable-getting-started-override",
      workingDirectory,
    ], {
      env: {
        // Prevent code-server from opening browser
        BROWSER: "none",
      },
    });

    // Parse port from stdout
    const portMatch = result.stdout.match(/(?:port|listening on).*?(\d+)/i);
    if (!portMatch) {
      // Fallback: try to parse from stderr
      const stderrMatch = result.stderr.match(/(?:port|listening on).*?(\d+)/i);
      if (!stderrMatch) {
        return c.json({ error: "Failed to determine code-server port" }, 500);
      }
    }

    const port = parseInt(portMatch?.[1] || "0", 10);
    if (!port) {
      return c.json({ error: "Invalid port from code-server" }, 500);
    }

    logger.app.info("VS Code server started on port {port}", { port });

    vscodeProcess = {
      process: {
        pid: 0, // We don't have direct access to the subprocess PID
        kill: () => {
          // Will be handled by stop endpoint
        },
      },
      port,
      workingDirectory,
    };

    return c.json({
      port,
      url: "/vscode/",
    });
  } catch (error) {
    logger.app.error("VS Code start error: {error}", { error });
    return c.json({ error: "Failed to start VS Code" }, 500);
  }
}

export async function handleVSCodeStopRequest(c: Context) {
  if (!vscodeProcess) {
    return c.json({ success: true, message: "Not running" });
  }

  try {
    // Kill the code-server process
    const config = c.var.config as AppConfig;
    await config.runtime.runCommand("pkill", ["-f", `code-server.*--port.*${vscodeProcess.port}`]);

    vscodeProcess = null;
    logger.app.info("VS Code server stopped");
    return c.json({ success: true });
  } catch (error) {
    logger.app.error("VS Code stop error: {error}", { error });
    vscodeProcess = null;
    return c.json({ success: true });
  }
}

export async function handleVSCodeStatusRequest(c: Context) {
  if (!vscodeProcess) {
    return c.json({ running: false });
  }

  return c.json({
    running: true,
    port: vscodeProcess.port,
    url: "/vscode/",
    workingDirectory: vscodeProcess.workingDirectory,
  });
}

// Get the current code-server port for proxying
export function getVSCodePort(): number | null {
  return vscodeProcess?.port ?? null;
}
