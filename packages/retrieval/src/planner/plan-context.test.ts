import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createSeededRetrievalFixture,
  authPackageId,
  invoiceDocId,
  repoId,
  sessionDocId,
  sessionModuleId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
import type { RankedHit } from "../types";
import { expandSections } from "./expand-sections";
import { planContext } from "./plan-context";

describe("planContext", () => {
  let fixture: SeededRetrievalFixture | undefined;

  beforeEach(async () => {
    fixture = await createSeededRetrievalFixture();
  });

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  test("plans overview context with summary plus concrete evidence when budget allows", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "what is the auth architecture overview?",
      budgetTokens: 160,
    });

    expect(plan.classification.kind).toBe("overview");
    expect(plan.selected.some((item) => item.targetType === "summary")).toBe(
      true,
    );
    expect(plan.selected.some((item) => item.targetType !== "summary")).toBe(
      true,
    );
    expect(plan.usedTokens).toBeLessThanOrEqual(plan.budgetTokens);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.stage)).toContain(
      "candidate-generation",
    );
  });

  test("forces detail evidence for overview queries with commands tools and path-like tokens", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query:
        "overview of auth docs for `rotateSessionToken` in packages/auth/docs/session.md",
      budgetTokens: 220,
    });

    expect(plan.selected.some((item) => item.targetType === "summary")).toBe(
      true,
    );
    expect(plan.selected.some((item) => item.targetType !== "summary")).toBe(
      true,
    );
  });

  test("expands into local sections and chunks for usage queries", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "how do I rotate session tokens?",
      budgetTokens: 220,
    });

    expect(plan.classification.kind).toBe("usage");
    expect(
      plan.selected.some(
        (item) => item.targetType === "section" || item.targetType === "chunk",
      ),
    ).toBe(true);
    expect(plan.selected[0]?.provenance.moduleId).toBe(sessionModuleId);
    expect(plan.usedTokens).toBeLessThanOrEqual(220);
    expect(plan.confidence).not.toBe("low");
  });

  test("uses path candidates for location lookup and preserves omitted budget decisions", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "where is packages/auth/docs/session.md",
      budgetTokens: 24,
      summaryLimit: 0,
      expansionLimit: 2,
    });

    expect(plan.classification.kind).toBe("location");
    expect(plan.rankedHits[0]?.source).toBe("path");
    expect(plan.usedTokens).toBeLessThanOrEqual(24);
    expect(plan.omitted.length).toBeGreaterThan(0);
  });

  test("returns answer-ready section text for natural-language exact lookups", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "What does `rotateSessionToken` do during renewal?",
      budgetTokens: 2_000,
    });

    expect(plan.classification.kind).toBe("exact-lookup");
    expect(plan.selected.some((item) => item.targetType === "summary")).toBe(
      false,
    );
    expect(plan.contextPacket.evidence[0]?.targetType).toBe("section");
    const exactEvidence = plan.contextPacket.evidence.find(
      (item) => item.targetType === "section",
    );
    expect(exactEvidence?.text).toContain("Session > Rotation");
    expect(exactEvidence?.text).toContain(
      "Rotate session tokens by calling rotateSessionToken during renewal.",
    );
    expect(plan.contextPacket.recommendedNextActions).toEqual([
      "Answer now from context.evidence and cite provenance paths. Do not call another retrieval tool.",
    ]);
  });

  test("keeps distinct evidence headings from the same document", () => {
    const state = expandSections({
      rankedHits: [
        rankedHit("section-rotation", ["Session", "Rotation"], 3),
        rankedHit("chunk-rotation", ["Session", "Rotation"], 2.9, "chunk"),
        rankedHit("section-recovery", ["Session", "Recovery"], 2.8),
      ],
      queryKind: "usage",
      query: "How do session rotation and recovery work?",
      state: {
        budgetTokens: 200,
        usedTokens: 0,
        selected: [],
        omitted: [],
        warnings: [],
      },
      limit: 3,
    });

    expect(state.selected.map((item) => item.targetId)).toEqual([
      "section-rotation",
      "section-recovery",
    ]);
    expect(state.omitted).toEqual([
      expect.objectContaining({ targetId: "chunk-rotation" }),
    ]);
  });

  test("recovers candidates for natural-language queries with no strict lexical AND match", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query:
        "How should operators renew session credentials with nonexistent jargon?",
      budgetTokens: 220,
    });

    expect(plan.rankedHits.length).toBeGreaterThan(0);
    expect(
      plan.rankedHits.some((hit) => hit.provenance.docId === sessionDocId),
    ).toBe(true);
  });

  test("adds broad fallback candidates from document metadata when lexical search is sparse", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "How do payment ledger aliases work?",
      budgetTokens: 220,
    });

    expect(
      plan.rankedHits.some((hit) => hit.provenance.docId === invoiceDocId),
    ).toBe(true);
    expect(
      plan.rankedHits.some((hit) =>
        hit.rationale.some((item) => item.includes("broad fallback")),
      ),
    ).toBe(true);
  });

  test("surfaces low-confidence ambiguity for no-result queries", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "where is the quantum cache scheduler?",
      budgetTokens: 120,
    });

    expect(plan.selected).toEqual([]);
    expect(plan.confidence).toBe("low");
    expect(plan.ambiguity).toMatchObject({
      status: "ambiguous",
      reason: "No retrieval candidates matched the query.",
    });
  });

  test("applies exact repository package and module constraints before ranking", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      packageId: authPackageId,
      moduleId: sessionModuleId,
      query: "How does renewal work?",
      budgetTokens: 220,
    });

    expect(plan.rankedHits.length).toBeGreaterThan(0);
    expect(
      plan.rankedHits.every(
        (hit) =>
          hit.provenance.repoId === repoId &&
          hit.provenance.packageId === authPackageId &&
          hit.provenance.moduleId === sessionModuleId,
      ),
    ).toBe(true);
    expect(
      plan.diagnostics.some(
        (diagnostic) =>
          diagnostic.stage === "scope-inference" &&
          diagnostic.metadata?.exact === true,
      ),
    ).toBe(true);
  });

  test("rejects exact scope identifiers that do not belong to their parent", () => {
    expect(() =>
      planContext({
        store: fixture!.retrievalStore,
        repoId,
        packageId: authPackageId,
        moduleId: "missing_module",
        query: "Explain the module.",
        budgetTokens: 220,
      }),
    ).toThrow("Unknown moduleId: missing_module");
  });
});

function rankedHit(
  targetId: string,
  headingPath: readonly string[],
  score: number,
  targetType: RankedHit["targetType"] = "section",
): RankedHit {
  return {
    targetType,
    targetId,
    authority: "preferred",
    score,
    tokenCount: 20,
    textPreview: `${headingPath.join(" ")} evidence`,
    provenance: {
      repoId,
      docId: sessionDocId,
      path: "packages/auth/docs/session.md",
      headingPath: [...headingPath],
      sourceVersion: "rev_1",
      authority: "preferred",
    },
    source: "lexical",
    rationale: ["test candidate"],
    factors: {
      lexicalScore: 1,
      authority: 0,
      locality: 0,
      queryKind: 0,
      tokenEfficiency: 0,
      freshness: 0,
      evidenceMatch: 0,
      qualityAdjustment: 0,
      redundancyPenalty: 0,
    },
  };
}
