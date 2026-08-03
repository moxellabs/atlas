import { describe, expect, test } from "bun:test";

import { agentEffectDatasetDigest } from "./dataset";
import { assertHermeticAtlasDiscovery, runAgentEffectEvaluation } from "./run";
import { dataset } from "./agent-effect.test-fixtures";
import type { AgentEffectDataset, AgentRun } from "./types";

describe("agent evaluation runs", () => {
  test("aggregates paired baseline and MCP treatment evidence deterministically", async () => {
    const snapshot = await runAgentEffectEvaluation({
      dataset,
      releaseId: "v0.3.0",
      datasetDigest: agentEffectDatasetDigest(dataset),
      provenance: { evaluatedRevision: "abc123", codexVersion: "codex 1.0" },
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
      provenance: { evaluatedRevision: "abc123", codexVersion: "codex 1.0" },
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
});
