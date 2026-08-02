import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocId, createSectionId } from "@atlas/core";
import {
  DocRepository,
  countRepoCorpusRows,
  ManifestRepository,
  openStore,
  RepoRepository,
} from "@atlas/store";
import { agentEffectDatasetDigest } from "./dataset";
import { resolveSnapshotFreshness, writeAgentEffectSnapshot } from "./history";
import { isolateCorpusSnapshot, readCorpusEvidence } from "./corpus-snapshot";
import { assertHermeticAtlasDiscovery, runAgentEffectEvaluation } from "./run";
import {
  atlasMcpServerArgs,
  atlasMcpServerName,
  codexAgentCommand,
  judgePrompt,
  traceMcpEvents,
} from "./codex";
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
          server: "atlas_diffract",
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
      {
        kind: "tool",
        name: "answer_diffract_docs",
        source: "atlas",
        ok: true,
      },
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

  test("builds an isolated treatment command without hiding Atlas in the prompt", () => {
    const common = {
      atlasCwd: "/atlas",
      repoId: dataset.repoId,
      cwd: "/consumer",
      workDir: "/tmp/eval",
      configPath: "/tmp/eval/atlas.config.json",
      useGlobal: false,
      outputSchemaPath: "/tmp/eval/output.schema.json",
      outputPath: "/tmp/eval/output.json",
      runner: dataset.runner,
      task: dataset.tasks[0]!,
      trial: 1,
    };
    const command = codexAgentCommand({ ...common, arm: "treatment" });
    const prompt = command.at(-1);

    expect(command).toContain("--ignore-user-config");
    expect(command).toContain("--ignore-rules");
    expect(command).toContain("deferred_tool_world_state");
    expect(command).toContain("web_search");
    expect(command).toContain("standalone_web_search");
    expect(command).toContain("shell_tool");
    expect(command).toContain("unified_exec");
    expect(command).toContain('web_search="disabled"');
    expect(command).toContain("tools.web_search=false");
    expect(command).toContain('default_permissions="atlas_eval"');
    expect(command).toContain(
      'permissions.atlas_eval={ filesystem = { ":minimal" = "read", ":workspace_roots" = { "." = "write" } }, network = { enabled = false } }',
    );
    expect(command).toContain('shell_environment_policy.inherit="none"');
    expect(command).toContain(
      `mcp_servers.atlas_atlas.command=${JSON.stringify(process.execPath)}`,
    );
    expect(command).toContain(
      'mcp_servers.atlas_atlas.default_tools_approval_mode="writes"',
    );
    expect(command).toContain(
      'features.code_mode.direct_only_tool_namespaces=["atlas_atlas"]',
    );
    expect(command.join(" ")).not.toContain("--discovery-policy");
    expect(command).toContain("mcp_servers.atlas_atlas.required=true");
    expect(command).not.toContain("--sandbox");
    expect(prompt).toContain(dataset.tasks[0]!.prompt);
    expect(prompt).not.toContain("Use Atlas");
    expect(prompt).not.toContain("plan_context");
    const baselineCommand = codexAgentCommand({ ...common, arm: "baseline" });
    expect(
      baselineCommand.some((argument) =>
        argument.startsWith("mcp_servers.atlas_atlas."),
      ),
    ).toBe(false);
    expect(
      baselineCommand.some((argument) =>
        argument.startsWith("features.code_mode.direct_only_tool_namespaces="),
      ),
    ).toBe(false);
    expect(baselineCommand.at(-1)).toBe(prompt);
    const evidence = [
      {
        path: "docs/a.md",
        text: "AUTHORITATIVE_JUDGE_ONLY_EVIDENCE",
      },
    ];
    expect(
      judgePrompt(
        dataset.tasks[0]!,
        { answer: "left", citations: [] },
        { answer: "right", citations: [] },
        evidence,
      ),
    ).toContain("AUTHORITATIVE_JUDGE_ONLY_EVIDENCE");
    expect(prompt).not.toContain("AUTHORITATIVE_JUDGE_ONLY_EVIDENCE");
  });

  test("exposes normal competing tools without weakening workspace isolation", () => {
    const command = codexAgentCommand({
      atlasCwd: "/atlas",
      repoId: dataset.repoId,
      cwd: "/consumer",
      workDir: "/tmp/eval",
      configPath: "/tmp/eval/atlas.config.json",
      useGlobal: false,
      competitiveTools: true,
      outputSchemaPath: "/tmp/eval/output.schema.json",
      outputPath: "/tmp/eval/output.json",
      runner: dataset.runner,
      arm: "treatment",
      task: dataset.tasks[0]!,
      trial: 1,
    });

    expect(command).toContain("--enable");
    expect(command).toContain("deferred_tool_world_state");
    expect(command).toContain("web_search");
    expect(command).toContain('web_search="live"');
    expect(command).toContain("tools.web_search=true");
    expect(command).not.toContain("shell_tool");
    expect(command).not.toContain("unified_exec");
    expect(command).toContain('default_permissions="atlas_eval"');
    expect(command).toContain('shell_environment_policy.inherit="none"');
    expect(command.at(-1)).toContain(dataset.tasks[0]!.prompt);
  });

  test("selects checkout or global Atlas MCP arguments explicitly", () => {
    expect(atlasMcpServerName("github.com/justmrmendez/diffract")).toBe(
      "atlas_diffract",
    );
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

  test("isolates one complete repository into a valid corpus snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-corpus-snapshot-"));
    const sourcePath = join(directory, "source.db");
    const targetPath = join(directory, "isolated", "corpus.db");
    const targetRepoId = "github.com/justmrmendez/diffract";
    const excludedRepoId = "github.com/example/other";
    const source = openStore({ path: sourcePath, migrate: true });
    for (const [repoId, revision] of [
      [targetRepoId, "diffract-revision"],
      [excludedRepoId, "other-revision"],
    ] as const) {
      new RepoRepository(source).upsert({
        repoId,
        mode: "local-git",
        revision,
      });
      new ManifestRepository(source).upsert({
        repoId,
        indexedRevision: revision,
        compilerVersion: "compiler-v1",
      });
    }
    const evidencePath = "docs/architecture/recovery.md";
    const docId = createDocId({ repoId: targetRepoId, path: evidencePath });
    const headingPath = ["Recovery"];
    new DocRepository(source).replaceCanonicalDocument({
      docId,
      repoId: targetRepoId,
      path: evidencePath,
      sourceVersion: "diffract-revision",
      title: "Recovery",
      kind: "repo-doc",
      authority: "canonical",
      scopes: [{ level: "repo", repoId: targetRepoId }],
      sections: [
        {
          sectionId: createSectionId({ docId, headingPath, ordinal: 0 }),
          headingPath,
          ordinal: 0,
          text: "Recovery repairs only the interrupted append.",
          codeBlocks: [
            {
              lang: "text",
              code: "scene-session-manifest.json\nscene-frames.jsonl\nscene-index.bin",
            },
          ],
        },
      ],
      metadata: { tags: ["recovery", "append"] },
    });
    source.close();

    const provenance = await isolateCorpusSnapshot({
      sourcePath,
      targetPath,
      repoId: targetRepoId,
    });
    const snapshot = openStore({ path: targetPath, readOnly: true });
    try {
      expect(
        new RepoRepository(snapshot).list().map((repo) => repo.repoId),
      ).toEqual([targetRepoId]);
      expect(countRepoCorpusRows(snapshot, excludedRepoId)).toEqual({
        repos: 0,
        packages: 0,
        modules: 0,
        documents: 0,
        sections: 0,
        chunks: 0,
        summaries: 0,
        skills: 0,
        manifests: 0,
        ftsRows: 0,
      });
      expect(
        snapshot.get<{ integrity_check: string }>("PRAGMA integrity_check"),
      ).toEqual({ integrity_check: "ok" });
    } finally {
      snapshot.close();
    }
    expect(provenance).toEqual({
      indexedRevision: "diffract-revision",
      corpusDigest: createHash("sha256")
        .update(await readFile(targetPath))
        .digest("hex"),
    });
    expect(
      readCorpusEvidence({
        corpusPath: targetPath,
        repoId: targetRepoId,
        paths: [evidencePath, evidencePath],
      }),
    ).toEqual([
      {
        path: evidencePath,
        text: "Recovery repairs only the interrupted append.\n\n```text\nscene-session-manifest.json\nscene-frames.jsonl\nscene-index.bin\n```",
      },
    ]);
    expect(() =>
      readCorpusEvidence({
        corpusPath: targetPath,
        repoId: targetRepoId,
        paths: ["docs/architecture/missing.md"],
      }),
    ).toThrow("is absent from the isolated");
    const unchangedSource = openStore({ path: sourcePath, readOnly: true });
    try {
      expect(
        new RepoRepository(unchangedSource)
          .list()
          .map((repo) => repo.repoId)
          .sort(),
      ).toEqual([excludedRepoId, targetRepoId].sort());
    } finally {
      unchangedSource.close();
    }
  });

  test("rejects unavailable and incomplete source corpora", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-corpus-errors-"));
    await expect(
      isolateCorpusSnapshot({
        sourcePath: join(directory, "missing.db"),
        targetPath: join(directory, "target.db"),
        repoId: "github.com/example/missing",
      }),
    ).rejects.toThrow("corpus is unavailable");

    const sourcePath = join(directory, "incomplete.db");
    const source = openStore({ path: sourcePath, migrate: true });
    new RepoRepository(source).upsert({
      repoId: "github.com/example/incomplete",
      mode: "local-git",
      revision: "revision",
    });
    source.close();
    await expect(
      isolateCorpusSnapshot({
        sourcePath,
        targetPath: join(directory, "isolated.db"),
        repoId: "github.com/example/incomplete",
      }),
    ).rejects.toThrow("does not contain a complete index");
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

  test("requires repeated grounded Atlas-only discovery for every task", async () => {
    const discoveryDataset: AgentEffectDataset = {
      ...dataset,
      runner: { ...dataset.runner, trialsPerTask: 3 },
    };
    const snapshot = await runAgentEffectEvaluation({
      dataset: discoveryDataset,
      releaseId: "local",
      datasetDigest: agentEffectDatasetDigest(discoveryDataset),
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
          durationMs: 1,
          status: "completed",
          answer: {
            answer: arm === "baseline" ? "No evidence." : "Grounded answer.",
            citations:
              arm === "baseline"
                ? []
                : [{ path: "docs/a.md", claim: "fixture" }],
          },
          mcp: {
            calls:
              arm === "baseline"
                ? [
                    {
                      kind: "web_search",
                      name: "web_search",
                      source: "web",
                      ok: true,
                    },
                  ]
                : [
                    {
                      kind: "command",
                      name: "rg",
                      source: "filesystem",
                      ok: false,
                    },
                    {
                      kind: "tool",
                      name: "answer_fixture_docs",
                      source: "atlas",
                      ok: true,
                    },
                  ],
            protocolErrors: 0,
          },
        }),
        judgePair: async () => ({
          baseline: {
            criteria: [
              { id: "completion", passed: false, reason: "abstained" },
              { id: "grounding", passed: true, reason: "grounded" },
            ],
            unsupportedClaimCount: 0,
          },
          treatment: {
            criteria: [
              { id: "completion", passed: true, reason: "complete" },
              { id: "grounding", passed: true, reason: "grounded" },
            ],
            unsupportedClaimCount: 0,
          },
        }),
      },
    });

    expect(snapshot.metrics.mcp).toMatchObject({
      adoptionRate: 1,
      atlasFirstRate: 1,
      localOnlyRate: 1,
      fallbackRate: 0,
      protocolErrorRate: 0,
    });
    expect(() => assertHermeticAtlasDiscovery(snapshot)).not.toThrow();
    expect(() => assertHermeticAtlasDiscovery(snapshot, 4)).toThrow("trials=");

    const secondTaskPairs = snapshot.pairs.map((pair) => ({
      ...pair,
      taskId: "second-task",
      baseline: { ...pair.baseline, taskId: "second-task" },
      treatment: { ...pair.treatment, taskId: "second-task" },
    }));
    expect(() =>
      assertHermeticAtlasDiscovery({
        ...snapshot,
        pairs: [...snapshot.pairs, ...secondTaskPairs],
      }),
    ).not.toThrow();

    const first = snapshot.pairs[0]!;
    const withFallback = {
      ...snapshot,
      pairs: [
        {
          ...first,
          treatment: {
            ...first.treatment,
            mcp: {
              calls: [
                ...(first.treatment.mcp?.calls ?? []),
                {
                  kind: "web_search" as const,
                  name: "web_search",
                  source: "web" as const,
                  ok: true,
                },
              ],
              protocolErrors: 0,
            },
          },
        },
        ...snapshot.pairs.slice(1),
      ],
    };
    expect(() => assertHermeticAtlasDiscovery(withFallback)).toThrow(
      "failed=task:1",
    );
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
