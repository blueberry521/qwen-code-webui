#!/usr/bin/env node

import fs from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("fake-qwen-cli 0.0.1");
  process.exit(0);
}

process.on("SIGTERM", () => {
  // Intentionally ignore SIGTERM so the WebUI watchdog must escalate to SIGKILL.
  fs.appendFileSync(process.env.FAKE_QWEN_TRACE_FILE, `sigterm:${Date.now()}\n`);
});

const traceFile = process.env.FAKE_QWEN_TRACE_FILE;
let sessionId = "fake-session";
let writer = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function startWriter() {
  if (writer) return;
  writer = setInterval(() => {
    fs.appendFileSync(traceFile, `tick:${Date.now()}\n`);
  }, 250);
}

const chunks = [];

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
  const content = chunks.join("");
  const lines = content.split("\n");
  chunks.length = 0;
  chunks.push(lines.pop() || "");

  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);

    if (message.type === "control_request") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: message.request_id,
          response: {},
        },
      });
      continue;
    }

    if (message.type === "user") {
      sessionId = message.session_id || sessionId;
      send({
        type: "assistant",
        uuid: "fake-assistant-1",
        session_id: sessionId,
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "text",
              text: "fake cli working",
            },
          ],
        },
      });
      startWriter();
    }
  }
});

process.stdin.on("end", () => {
  // Keep running even after stdin closes so abort verification can confirm
  // that the WebUI forcibly reaps the CLI process.
});
