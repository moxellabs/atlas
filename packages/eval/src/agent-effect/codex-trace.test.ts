import { describe, expect, test } from "bun:test";

import { traceMcpEvents } from "./codex";

describe("Codex MCP traces", () => {
  test("records successful Atlas MCP calls from Codex JSONL events", () => {
    const trace = traceMcpEvents(
      `${JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", server: "atlas_diffract", tool: "plan_context", error: null } })}\n`,
    );
    expect(trace).toEqual({
      calls: [
        { kind: "tool", name: "plan_context", source: "atlas", ok: true },
      ],
      protocolErrors: 0,
    });
  });

  test("captures evidence-capable activity from both agent arms", () => {
    const stdout = [
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "atlas_diffract",
          tool: "answer_diffract_docs",
          error: null,
        },
      },
      {
        type: "item.completed",
        item: { type: "web_search_call", error: null },
      },
      {
        type: "item.completed",
        item: { type: "command_execution", command: "printf ok", exit_code: 0 },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "cat docs/architecture.md",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "gh api repos/owner/private",
          exit_code: 1,
        },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "/usr/bin/cat docs/private.md",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "/usr/bin/git fetch origin",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "bash -lc 'find /tmp -name answer.json'",
          exit_code: 1,
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const trace = traceMcpEvents(`${stdout}\n`);
    expect(trace.calls).toEqual([
      { kind: "tool", name: "answer_diffract_docs", source: "atlas", ok: true },
      { kind: "web_search", name: "web_search", source: "web", ok: true },
      { kind: "command", name: "printf", source: "shell", ok: true },
      { kind: "command", name: "cat", source: "filesystem", ok: true },
      { kind: "command", name: "gh", source: "github", ok: false },
      { kind: "command", name: "cat", source: "filesystem", ok: true },
      { kind: "command", name: "git", source: "github", ok: true },
      { kind: "command", name: "find", source: "filesystem", ok: false },
    ]);
    expect(trace.protocolErrors).toBe(0);
  });
});
