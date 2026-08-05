import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { classifyQuery } from "../classify/classify-query";
import {
  authPackageId,
  createSeededRetrievalFixture,
  repoDocId,
  repoId,
  sessionModuleId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
import { inferScopes } from "../scopes/infer-scopes";
import type { RetrievalCandidate } from "../types";
import { finalizeContext } from "../planner/finalize-context";
import { toPlannedItem } from "../planner/select-summaries";
import { authorityWeight } from "./authority-weight";
import { localityWeight } from "./locality-weight";
import { rankCandidates } from "./rank-candidates";
import { redundancyPenalty } from "./redundancy-penalty";

describe("rankCandidates", () => {
  let fixture: SeededRetrievalFixture | undefined;

  beforeEach(async () => {
    fixture = await createSeededRetrievalFixture();
  });

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  test("scores authority, locality, redundancy, and final rank rationales explicitly", () => {
    const classification = classifyQuery("session rotation usage");
    const scopes = inferScopes({
      store: fixture!.retrievalStore,
      query: "session rotation usage",
      classification,
      repoId,
    }).scopes;
    const canonical = candidate(
      "document",
      repoDocId,
      "canonical",
      "docs/architecture.md",
      0.6,
      "Session overview architecture.",
    );
    const local = candidate(
      "section",
      "session-section",
      "preferred",
      "packages/auth/docs/session.md",
      0.7,
      "Session rotation usage examples.",
      {
        packageId: authPackageId,
        moduleId: sessionModuleId,
      },
    );
    const duplicate = candidate(
      "section",
      "session-section-copy",
      "preferred",
      "packages/auth/docs/session-copy.md",
      0.65,
      "Session rotation usage examples.",
      {
        packageId: authPackageId,
        moduleId: sessionModuleId,
      },
    );

    expect(
      authorityWeight({ authority: "canonical", queryKind: "overview" }),
    ).toBeGreaterThan(
      authorityWeight({ authority: "supplemental", queryKind: "overview" }),
    );
    expect(localityWeight(local.provenance, scopes)).toBeGreaterThan(
      localityWeight(canonical.provenance, scopes),
    );
    expect(redundancyPenalty(duplicate, [local])).toBeGreaterThan(0);

    const ranked = rankCandidates({
      query: "session rotation usage",
      classification,
      scopes,
      candidates: [canonical, local, duplicate],
    });
    expect(ranked[0]?.targetId).toBe("session-section");
    expect(ranked[0]?.rationale.length).toBeGreaterThan(2);
    expect(ranked[0]?.factors.locality).toBeGreaterThan(0);

    const staleRanked = rankCandidates({
      query: "session rotation usage",
      classification,
      scopes,
      candidates: [local],
      freshnessByRepo: new Map([[repoId, -0.35]]),
    });
    expect(staleRanked[0]?.factors.freshness).toBeLessThan(0);
    expect(staleRanked[0]?.rationale).toContain(
      "Candidate was penalized 0.35 for stale repository freshness.",
    );
  });

  test("prefers an exact heading over higher-authority generic evidence", () => {
    const direct = candidate(
      "section",
      "security-guidance",
      "preferred",
      "AGENTS.md",
      0.7,
      "Encrypted key management requirements.",
    );
    const directWithHeading: RetrievalCandidate = {
      ...direct,
      provenance: { ...direct.provenance, headingPath: ["Security"] },
    };
    const generic = candidate(
      "section",
      "generic-canonical",
      "canonical",
      "docs/perps/whitepaper.md",
      0.7,
      "General product overview.",
    );

    const ranked = rankCandidates({
      query: "How does wallet security work?",
      classification: classifyQuery("How does wallet security work?"),
      candidates: [generic, directWithHeading],
    });
    expect(ranked[0]?.targetId).toBe("security-guidance");
    const context = finalizeContext({
      query: "How does wallet security work?",
      classification: classifyQuery("How does wallet security work?"),
      scopes: [],
      state: {
        budgetTokens: 100,
        usedTokens: 24,
        selected: [
          toPlannedItem(ranked[1]!, "Selected for test."),
          toPlannedItem(ranked[0]!, "Selected for test."),
        ],
        omitted: [],
        warnings: [],
      },
      rankedHits: ranked,
      diagnostics: [],
    });
    expect(context.selected[0]?.targetId).toBe("security-guidance");
  });

  test("prefers coherent sections over fragments for exact claims", () => {
    const query = "state the exact default MCP server identity";
    const section = candidate(
      "section",
      "identity-section",
      "preferred",
      "packages/mcp/docs/index.md",
      0.55,
      "Default MCP server identity is atlas-mcp.",
    );
    const chunk = candidate(
      "chunk",
      "identity-chunk",
      "preferred",
      "packages/mcp/docs/index.md",
      0.83,
      "MCP server identity override settings.",
    );

    const ranked = rankCandidates({
      query,
      classification: classifyQuery(query),
      candidates: [chunk, section],
    });

    expect(ranked[0]?.targetId).toBe("identity-section");
  });

  test("applies redundancy penalties after base ranking regardless of candidate order", () => {
    const classification = classifyQuery("session rotation usage");
    const stronger = candidate(
      "section",
      "session-stronger",
      "preferred",
      "packages/auth/docs/session.md",
      0.9,
      "Session rotation usage examples.",
      { packageId: authPackageId, moduleId: sessionModuleId },
    );
    const weakerDuplicate = candidate(
      "section",
      "session-weaker",
      "preferred",
      "packages/auth/docs/session-copy.md",
      0.5,
      "Session rotation usage examples.",
      { packageId: authPackageId, moduleId: sessionModuleId },
    );
    const rank = (candidates: RetrievalCandidate[]) =>
      rankCandidates({
        query: "session rotation usage",
        classification,
        candidates,
      }).map((hit) => ({
        id: hit.targetId,
        penalty: hit.factors.redundancyPenalty,
      }));

    const ordered = rank([stronger, weakerDuplicate]);
    expect(rank([weakerDuplicate, stronger])).toEqual(ordered);
    expect(ordered[0]).toEqual({ id: "session-stronger", penalty: 0 });
    expect(ordered[1]?.id).toBe("session-weaker");
    expect(ordered[1]?.penalty).toBeGreaterThan(0);
  });

  test("diversifies high-ranked window and boosts canonical evidence paths", () => {
    const classification = classifyQuery(
      "How do build and publish artifact workflows work?",
    );
    const summaryA = candidate(
      "summary",
      "skill-summary-a",
      "preferred",
      "skills/atlas-contributor/SKILL.md",
      1,
      "Build artifact workflow summary.",
    );
    const summaryB = candidate(
      "summary",
      "skill-summary-b",
      "preferred",
      "skills/document-codebase/SKILL.md",
      0.99,
      "Build artifact workflow summary.",
    );
    const skill = candidate(
      "skill",
      "skill-hit",
      "preferred",
      "skills/skill-creator/SKILL.md",
      0.94,
      "Skill workflow helper.",
    );
    const canonicalEvidence = candidate(
      "section",
      "ingestion-evidence",
      "canonical",
      "docs/ingestion-build-flow.md",
      0.55,
      "Build and publish public .moxel/atlas artifacts.",
    );
    const runtimeEvidence = candidate(
      "section",
      "runtime-evidence",
      "canonical",
      "docs/runtime-surfaces.md",
      0.52,
      "Runtime artifact import paths.",
    );
    const packageEvidence = candidate(
      "section",
      "package-evidence",
      "preferred",
      "packages/indexer/docs/index.md",
      0.5,
      "Indexer writes artifact outputs.",
    );

    const ranked = rankCandidates({
      query: "How do build and publish artifact workflows work?",
      classification,
      candidates: [
        summaryA,
        summaryB,
        skill,
        canonicalEvidence,
        runtimeEvidence,
        packageEvidence,
      ],
      limit: 5,
    });

    expect(
      ranked.filter((hit) => hit.targetType === "summary").length,
    ).toBeLessThanOrEqual(1);
    expect(ranked.map((hit) => hit.provenance.path)).toContain(
      "docs/ingestion-build-flow.md",
    );
    expect(
      ranked.find((hit) => hit.targetId === "ingestion-evidence")?.factors
        .evidenceMatch,
    ).toBeGreaterThan(0);
  });
  test("prefers answer-bearing passages and package-level evidence for precise package questions", () => {
    const query = "retrieve one precise documented rule";
    const ranked = rankCandidates({
      query,
      classification: classifyQuery(query),
      candidates: [
        candidate(
          "document",
          "thin-document",
          "canonical",
          "docs/rules.md",
          1,
          "Rules\ndocs/rules.md",
        ),
        candidate(
          "section",
          "supporting-section",
          "canonical",
          "docs/rules.md",
          0.7,
          "Rules > Selection\n\nUse the precise passage.",
        ),
      ],
    });
    expect(ranked[0]?.targetId).toBe("supporting-section");

    const packageScope = {
      level: "package" as const,
      id: authPackageId,
      label: "@atlas/auth",
      repoId,
      packageId: authPackageId,
      score: 1,
      rationale: ["test package scope"],
    };
    const packageEvidence = candidate(
      "section",
      "package-evidence",
      "preferred",
      "packages/auth/docs/index.md",
      0.8,
      "Auth package responsibilities.",
      { packageId: authPackageId },
    );
    const nestedModuleEvidence = candidate(
      "section",
      "nested-module-evidence",
      "preferred",
      "packages/auth/src/session/docs/index.md",
      0.8,
      "Session module responsibilities.",
      { packageId: authPackageId, moduleId: sessionModuleId },
    );
    expect(
      localityWeight(packageEvidence.provenance, [packageScope]),
    ).toBeGreaterThan(
      localityWeight(nestedModuleEvidence.provenance, [packageScope]),
    );
  });
});

function candidate(
  targetType: RetrievalCandidate["targetType"],
  targetId: string,
  authority: RetrievalCandidate["authority"],
  path: string,
  score: number,
  textPreview: string,
  scope: { packageId?: string; moduleId?: string } = {},
): RetrievalCandidate {
  return {
    targetType,
    targetId,
    authority,
    score,
    tokenCount: 12,
    textPreview,
    provenance: {
      repoId,
      ...(scope.packageId === undefined ? {} : { packageId: scope.packageId }),
      ...(scope.moduleId === undefined ? {} : { moduleId: scope.moduleId }),
      docId: targetId,
      path,
      sourceVersion: "rev_1",
      authority,
    },
    source: "manual",
    rationale: ["test candidate"],
  };
}
