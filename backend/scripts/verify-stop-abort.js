#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, "..");
const fakeCliPath = resolve(backendRoot, "test-fixtures/fake-qwen-cli.mjs");

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countTraceLines(traceFile) {
  if (!existsSync(traceFile)) return 0;
  const content = readFileSync(traceFile, "utf8").trim();
  if (!content) return 0;
  return content.split("\n").length;
}

function findFakeCliProcesses(sessionId) {
  const output = execFileSync("ps", ["-Ao", "pid=,command="], {
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry) => entry !== null)
    .filter((entry) =>
      entry.command.includes(fakeCliPath)
      && entry.command.includes(`--session-id ${sessionId}`)
    );
}

async function waitForServer(port, backendProcess) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (backendProcess.exitCode !== null) {
      throw new Error(`Backend exited early with code ${backendProcess.exitCode}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/version`);
      if (response.ok) return;
    } catch {
      // Keep polling until the server is reachable.
    }

    await sleep(250);
  }

  throw new Error("Timed out waiting for backend server to start");
}

async function terminateBackend(processHandle) {
  if (processHandle.exitCode !== null) return;

  processHandle.kill("SIGINT");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) return;
    await sleep(100);
  }

  processHandle.kill("SIGKILL");
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "qwen-stop-abort-"));
  const traceFile = join(tempDir, "trace.log");
  writeFileSync(traceFile, "");

  const port = 3200 + Math.floor(Math.random() * 500);
  const requestId = `verify-stop-${Date.now()}`;
  let backendProcess = null;

  try {
    backendProcess = spawn(
      "./node_modules/.bin/tsx",
      [
        "cli/node.ts",
        "--debug",
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--qwen-path",
        fakeCliPath,
      ],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          FAKE_QWEN_TRACE_FILE: traceFile,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let backendStdout = "";
    let backendStderr = "";
    backendProcess.stdout.on("data", (chunk) => {
      backendStdout += chunk.toString();
    });
    backendProcess.stderr.on("data", (chunk) => {
      backendStderr += chunk.toString();
    });

    await waitForServer(port, backendProcess);

    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "verify stop behavior",
        requestId,
        permissionMode: "default",
      }),
    });

    assert(response.ok, `Chat request failed with ${response.status}`);
    assert(response.body, "Chat response did not include a body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let abortSent = false;
    let sawAborted = false;
    let sawDone = false;
    let sessionId = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);

        if (message.type === "claude_json" && message.data?.session_id) {
          sessionId = message.data.session_id;
          if (!abortSent) {
            await sleep(1_000);
            const linesBeforeAbort = countTraceLines(traceFile);
            assert(linesBeforeAbort > 0, "Fake CLI never started writing to the trace file");

            const cliProcesses = findFakeCliProcesses(sessionId);
            assert(cliProcesses.length > 0, "Fake CLI process was not running before abort");

            const abortResponse = await fetch(
              `http://127.0.0.1:${port}/api/abort/${requestId}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              },
            );
            assert(abortResponse.ok, `Abort request failed with ${abortResponse.status}`);
            abortSent = true;
          }
        } else if (message.type === "aborted") {
          sawAborted = true;
        } else if (message.type === "done") {
          sawDone = true;
        }
      }
    }

    assert(abortSent, "Abort endpoint was never triggered during the integration run");
    assert(sessionId, "Did not observe a CLI session id in the stream");
    assert(sawAborted, "Stream did not emit an aborted terminal message");
    assert(sawDone, "Stream did not emit a done terminal message");

    await sleep(6_500);
    const traceAfterAbort = countTraceLines(traceFile);
    await sleep(2_000);
    const traceStableCheck = countTraceLines(traceFile);

    assert(
      traceAfterAbort === traceStableCheck,
      `Trace file kept growing after abort (${traceAfterAbort} -> ${traceStableCheck})`,
    );
    assert(
      findFakeCliProcesses(sessionId).length === 0,
      "Fake CLI process still exists after watchdog escalation window",
    );

    console.log("Stop abort integration verification passed.");
  } catch (error) {
    console.error("Stop abort integration verification failed.");
    if (backendProcess) {
      console.error("Backend exit code:", backendProcess.exitCode);
    }
    throw error;
  } finally {
    if (backendProcess) {
      await terminateBackend(backendProcess);
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
