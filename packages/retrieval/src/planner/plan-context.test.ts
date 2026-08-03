import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createSeededRetrievalFixture,
  invoiceDocId,
  repoId,
  sessionDocId,
  sessionModuleId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
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

  test("uses path candidates for exact lookup and preserves omitted budget decisions", () => {
    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "where is packages/auth/docs/session.md",
      budgetTokens: 24,
      summaryLimit: 0,
      expansionLimit: 2,
    });

    expect(plan.classification.kind).toBe("exact-lookup");
    expect(plan.rankedHits[0]?.source).toBe("path");
    expect(plan.usedTokens).toBeLessThanOrEqual(24);
    expect(plan.omitted.length).toBeGreaterThan(0);
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
});
