import { describe, expect, test } from "bun:test";

import type { AgentEffectSnapshot } from "../../agent-effect";
import { moxelBandedFieldScript } from "@atlas/presentation-assets/banded-field";
import {
  moxelEvalExplorerScript,
  moxelEvalReportCss,
} from "@atlas/presentation-assets/eval-report";
import { buildReport } from "../report";
import { partialRetrieval, result } from "../report/test-fixtures";
import { renderHtml } from "./html";

describe("retrieval report rendering", () => {
  test("renders Moxel report markers, explorer controls, health tags, and safe embedded JSON", () => {
    const report = buildReport(
      { name: "dataset <script>", cases: [] },
      [
        result({
          id: "case-danger",
          category: "security",
          query: "<script>alert(1)</script>",
          claim: "Claim <img src=x>",
          riskArea: "privacy",
          topPaths: ["docs/<unsafe>.md"],
          retrieval: partialRetrieval({
            expectedPathRanks: [8],
            bestExpectedPathRank: 8,
            recallAt1: 0,
            recallAt3: 0,
            recallAt5: 0,
            reciprocalRank: 0.125,
          }),
        }),
      ],
      { cli: "bun run cli", source: "cli-default" },
      {},
    );

    const html = renderHtml(report);

    expect(html).toContain("moxel-atlas-eval-report-theme");
    expect(html).toContain("MOXEL ATLAS EVALS");
    expect(html).toContain('id="banded-field"');
    expect(html).toContain(`<style>${moxelEvalReportCss}</style>`);
    expect(html).toContain(`<script>${moxelBandedFieldScript}</script>`);
    expect(html).toContain(`<script>${moxelEvalExplorerScript}</script>`);
    expect(html).toContain('id="case-explorer"');
    expect(html).toContain('id="case-search"');
    expect(html).toContain(
      'id="atlas-eval-report-data" type="application/json"',
    );
    expect(html).toContain("Methodology");
    expect(html).toContain("Reproducibility");
    expect(html).toContain('data-report-tab="overview"');
    expect(html).toContain("case-workspace");
    expect(html).toContain("pipeline-steps");
    expect(html).toContain("repro-meta-grid");
    expect(html).not.toContain("Demo data");
    expect(html).toContain("Not collected");
    for (const section of [
      "overview",
      "quality-gates",
      "cross-layer-summary",
      "retrieval",
      "answer-quality",
      "mcp-agent",
      "failure-analysis",
      "case-explorer",
      "coverage-analysis",
      "trends-baselines",
      "methodology",
      "reproducibility",
    ]) {
      expect(html).toContain(`href="#${section}"`);
      expect(html).toContain(`id="${section}"`);
    }
    expect(html).not.toContain("Atlas finds the required docs");
    expect(html).not.toContain("Known-good evidence is present");
    expect(html).not.toContain("Perfect pass rate can coexist");
    expect(html).toContain('data-health="bad"');
    expect(html).toContain("\\u003cscript");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("renders stale Luna evidence without fabricating a demo fallback", () => {
    const report = buildReport(
      { name: "dataset", cases: [] },
      [result({ id: "one", category: "a" })],
      { cli: "bun run cli", source: "cli-default" },
      {},
    );
    const snapshot: AgentEffectSnapshot = {
      schemaVersion: 1,
      releaseId: "v0.3.0",
      generatedAt: "2026-01-01T00:00:00.000Z",
      provenance: {
        evaluatedRevision: "abc123def456",
        datasetDigest: "digest",
        codexVersion: "codex 1.0",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      },
      dataset: {
        name: "fixture",
        repoId: "github.com/moxellabs/atlas",
        runner: {
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
          trialsPerTask: 3,
          agentTimeoutMs: 480000,
          judgeTimeoutMs: 180000,
        },
      },
      pairs: [],
      metrics: {
        pairs: 0,
        baseline: {
          runs: 0,
          completionRate: 0,
          groundedAnswerRate: 0,
          citationCoverageRate: 0,
          unsupportedClaimRate: 0,
          abstentionCorrectRate: null,
          averageDurationMs: 0,
          p95DurationMs: 0,
        },
        treatment: {
          runs: 0,
          completionRate: 0,
          groundedAnswerRate: 0,
          citationCoverageRate: 0,
          unsupportedClaimRate: 0,
          abstentionCorrectRate: null,
          averageDurationMs: 0,
          p95DurationMs: 0,
        },
        paired: { wins: 0, ties: 0, losses: 0 },
        mcp: {
          adoptionRate: 0,
          atlasFirstRate: 0,
          localOnlyRate: 0,
          fallbackRate: 0,
          averageCalls: 0,
          protocolErrorRate: 0,
        },
      },
      representativeTraces: [],
    };
    const html = renderHtml(report, {
      agentEffect: { status: "stale", snapshot },
    });
    expect(html).toContain("Stale");
    expect(html).toContain("Luna + Atlas MCP");
    expect(html).not.toContain("Demo data");
  });
});
