import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentEffectDatasetDigest } from "./dataset";
import { resolveSnapshotFreshness, writeAgentEffectSnapshot } from "./history";
import { runAgentEffectEvaluation } from "./run";
import { dataset } from "./agent-effect.test-fixtures";

describe("agent evaluation history", () => {
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
