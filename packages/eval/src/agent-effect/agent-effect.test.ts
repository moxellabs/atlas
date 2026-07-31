import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentEffectDatasetDigest } from "./dataset";
import { resolveSnapshotFreshness, writeAgentEffectSnapshot } from "./history";
import { runAgentEffectEvaluation } from "./run";
import { atlasMcpServerArgs, codexAgentCommand, traceMcpEvents } from "./codex";
import type { AgentEffectDataset, AgentRun } from "./types";

const dataset: AgentEffectDataset = {
  schemaVersion: 1,
  name: "fixture",
  description: "fixture",
  repoId: "github.com/moxellabs/atlas",
  runner: {
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    trialsPerTask: 2,
    agentTimeoutMs: 100,
    judgeTimeoutMs: 100,
  },
  tasks: [
    {
      id: "task",
      sourceCaseId: "source",
      title: "Task",
      category: "fixture",
      prompt: "Answer the fixture.",
      criteria: [
        {
          id: "completion",
          kind: "completion",
          description: "complete",
          evidencePaths: ["docs/a.md"],
        },
        {
          id: "grounding",
          kind: "grounding",
          description: "grounded",
          evidencePaths: ["docs/a.md"],
        },
      ],
    },
  ],
};

describe("agent effect evaluation", () => {
  test("records successful Atlas MCP calls from Codex JSONL events", () => {
    const trace = traceMcpEvents(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "atlas_eval",
          tool: "plan_context",
          error: null,
        },
      })}\n`,
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
          server: "atlas_eval",
          tool: "plan_context__diffract",
          error: null,
        },
      },
      {
        type: "item.completed",
        item: { type: "web_search_call", error: null },
      },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "printf ok",
          exit_code: 0,
        },
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
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const trace = traceMcpEvents(`${stdout}\n`);

    expect(trace.calls).toEqual([
      {
        kind: "tool",
        name: "plan_context__diffract",
        source: "atlas",
        ok: true,
      },
      { kind: "web_search", name: "web_search", source: "web", ok: true },
      { kind: "command", name: "printf", source: "shell", ok: true },
      { kind: "command", name: "cat", source: "filesystem", ok: true },
      { kind: "command", name: "gh", source: "github", ok: false },
    ]);
    expect(trace.protocolErrors).toBe(0);
  });

  test("builds an isolated treatment command without hiding Atlas in the prompt", () => {
    const command = codexAgentCommand({
      atlasCwd: "/atlas",
      cwd: "/consumer",
      workDir: "/tmp/eval",
      configPath: "/tmp/eval/atlas.config.json",
      useGlobal: false,
      outputSchemaPath: "/tmp/eval/output.schema.json",
      outputPath: "/tmp/eval/output.json",
      runner: dataset.runner,
      arm: "treatment",
      task: dataset.tasks[0]!,
      trial: 1,
    });
    const prompt = command.at(-1);

    expect(command).toContain("--ignore-user-config");
    expect(command).toContain("--ignore-rules");
    expect(command).toContain("web_search");
    expect(command).toContain("standalone_web_search");
    expect(command).toContain("shell_tool");
    expect(command).toContain("unified_exec");
    expect(command).toContain('web_search="disabled"');
    expect(command).toContain("tools.web_search=false");
    expect(command).toContain("sandbox_workspace_write.network_access=false");
    expect(command).toContain('shell_environment_policy.inherit="none"');
    expect(command).toContain(
      `mcp_servers.atlas_eval.command=${JSON.stringify(process.execPath)}`,
    );
    expect(prompt).toContain(dataset.tasks[0]!.prompt);
    expect(prompt).not.toContain("Use Atlas");
    expect(prompt).not.toContain("plan_context");
  });

  test("selects checkout or global Atlas MCP arguments explicitly", () => {
    expect(
      atlasMcpServerArgs({
        atlasCwd: "/atlas",
        configPath: "/tmp/eval.json",
        useGlobal: false,
      }),
    ).toEqual([
      "/atlas/apps/cli/src/index.ts",
      "--config",
      "/tmp/eval.json",
      "mcp",
    ]);
    expect(atlasMcpServerArgs({ atlasCwd: "/atlas", useGlobal: true })).toEqual(
      ["/atlas/apps/cli/src/index.ts", "mcp"],
    );
    expect(() =>
      atlasMcpServerArgs({ atlasCwd: "/atlas", useGlobal: false }),
    ).toThrow("explicit local eval config or global runtime");
  });

  test("aggregates paired baseline and MCP treatment evidence deterministically", async () => {
    const snapshot = await runAgentEffectEvaluation({
      dataset,
      releaseId: "v0.3.0",
      datasetDigest: agentEffectDatasetDigest(dataset),
      provenance: {
        evaluatedRevision: "abc123",
        codexVersion: "codex 1.0",
      },
      executor: {
        runAgent: async ({ arm, task, trial }): Promise<AgentRun> => ({
          arm,
          taskId: task.id,
          trial,
          startedAt: "2026-01-01T00:00:00.000Z",
          durationMs: arm === "treatment" ? 20 : 10,
          status: "completed",
          answer: {
            answer: `${arm} answer`,
            citations: [{ path: "docs/a.md", claim: "fixture" }],
          },
          ...(arm === "treatment"
            ? {
                mcp: {
                  calls: [
                    {
                      kind: "tool",
                      name: "plan_context",
                      source: "atlas",
                      ok: true,
                      durationMs: 5,
                    },
                  ],
                  protocolErrors: 0,
                },
              }
            : {}),
        }),
        judgePair: async () => ({
          baseline: {
            criteria: [
              { id: "completion", passed: true, reason: "ok" },
              { id: "grounding", passed: false, reason: "missing" },
            ],
            unsupportedClaimCount: 1,
          },
          treatment: {
            criteria: [
              { id: "completion", passed: true, reason: "ok" },
              { id: "grounding", passed: true, reason: "ok" },
            ],
            unsupportedClaimCount: 0,
          },
        }),
      },
    });

    expect(snapshot.pairs).toHaveLength(2);
    expect(snapshot.metrics.paired).toEqual({ wins: 2, ties: 0, losses: 0 });
    expect(snapshot.metrics.baseline.groundedAnswerRate).toBe(0);
    expect(snapshot.metrics.treatment.groundedAnswerRate).toBe(1);
    expect(snapshot.metrics.mcp.adoptionRate).toBe(1);
    expect(snapshot.representativeTraces.length).toBeGreaterThan(0);
  });

  test("keeps history-only commits fresh and marks source changes stale", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "atlas-agent-effect-test-"));
    const snapshot = await runAgentEffectEvaluation({
      dataset,
      releaseId: "v0.3.1",
      datasetDigest: agentEffectDatasetDigest(dataset),
      provenance: { evaluatedRevision: "source", codexVersion: "codex 1.0" },
      executor: {
        runAgent: async ({ arm, task, trial }) => ({
          arm,
          taskId: task.id,
          trial,
          startedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 1,
          status: "error",
          error: "/home/example token=secret",
        }),
        judgePair: async () => ({
          baseline: { criteria: [], unsupportedClaimCount: 0 },
          treatment: { criteria: [], unsupportedClaimCount: 0 },
        }),
      },
    });
    await writeAgentEffectSnapshot({ cwd, snapshot });
    const fresh = await resolveSnapshotFreshness({
      cwd,
      targetRevision: "release",
      dataset,
      datasetDigest: agentEffectDatasetDigest(dataset),
      changedPaths: async () => ["evals/history/luna/v0.3.1.json"],
    });
    const stale = await resolveSnapshotFreshness({
      cwd,
      targetRevision: "release",
      dataset,
      datasetDigest: agentEffectDatasetDigest(dataset),
      changedPaths: async () => ["packages/eval/src/index.ts"],
    });
    expect(fresh.status).toBe("fresh");
    expect(stale.status).toBe("stale");
  });
});
