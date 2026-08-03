import { describe, expect, test } from "bun:test";

import { classifyQuery } from "../classify/classify-query";
import { repoId, sessionDocId } from "../retrieval.test-fixtures";
import type { PlannedItem, RetrievalCandidate } from "../types";
import { rankCandidates } from "../ranking/rank-candidates";
import { expandSections } from "./expand-sections";
import { finalizeContext } from "./finalize-context";
import { selectSummaries } from "./select-summaries";

describe("finalizeContext", () => {
  test("omits negatively scored low-signal paths from planned context", () => {
    const query = "How does wallet security work?";
    const classification = classifyQuery(query);
    const rankedHits = rankCandidates({
      query,
      classification,
      candidates: [
        candidate(
          "summary",
          "security-summary",
          "canonical",
          "docs/security.md",
          0.7,
          "Wallet security overview.",
        ),
        candidate(
          "summary",
          "skill-summary",
          "preferred",
          "tests/skills/security/SKILL.md",
          1,
          "Wallet security overview.",
        ),
        candidate(
          "section",
          "security-detail",
          "canonical",
          "docs/security.md",
          0.7,
          "Keys remain encrypted at rest.",
        ),
        candidate(
          "section",
          "changelog-detail",
          "supplemental",
          "CHANGELOG.md",
          1,
          "Wallet security fix.",
        ),
      ],
    });
    const initialState = {
      budgetTokens: 500,
      usedTokens: 0,
      selected: [],
      omitted: [],
      warnings: [],
    };
    const afterSummaries = selectSummaries({
      rankedHits,
      queryKind: classification.kind,
      query,
      state: initialState,
      limit: 2,
    });
    const afterExpansion = expandSections({
      rankedHits,
      queryKind: classification.kind,
      query,
      state: afterSummaries,
      limit: 4,
    });
    const context = finalizeContext({
      query,
      classification,
      scopes: [],
      state: afterExpansion,
      rankedHits,
      diagnostics: [],
    });

    expect(context.selected.map((item) => item.targetId)).toEqual([
      "security-summary",
      "security-detail",
    ]);
    expect(
      context.omissionDiagnostics
        .filter((item) => item.reason === "quality")
        .map((item) => item.targetId),
    ).toEqual(expect.arrayContaining(["skill-summary", "changelog-detail"]));
  });

  test("emits structured omission diagnostics with reason categories", () => {
    const omitted = [
      plannedItem("budget-item", "Item does not fit remaining token budget."),
      plannedItem(
        "authority-item",
        "Lower authority supplemental candidate omitted.",
      ),
      plannedItem(
        "freshness-item",
        "Candidate was penalized for stale repository freshness.",
      ),
      plannedItem("archive-item", "Archive historical doc excluded."),
      plannedItem(
        "redundancy-item",
        "Skipped redundant expansion from an already selected document.",
      ),
    ];
    const context = finalizeContext({
      query: "session token budget",
      classification: classifyQuery("session token budget"),
      scopes: [],
      state: {
        budgetTokens: 50,
        usedTokens: 0,
        selected: [],
        omitted,
        warnings: [],
      },
      rankedHits: [],
      diagnostics: [],
    });

    expect(context.usedTokens).toBeLessThanOrEqual(context.budgetTokens);
    expect(context.omissionDiagnostics.map((item) => item.reason)).toEqual([
      "budget",
      "authority",
      "freshness",
      "archive",
      "redundancy",
    ]);
    expect(context.contextPacket.omissionDiagnostics).toEqual(
      context.omissionDiagnostics,
    );
  });
});

function plannedItem(targetId: string, reason: string): PlannedItem {
  return {
    targetType: "section",
    targetId,
    tokenCount: 10,
    provenance: {
      repoId,
      docId: sessionDocId,
      path: `packages/auth/docs/${targetId}.md`,
      sourceVersion: "rev_1",
      authority: "preferred",
    },
    rationale: [reason],
  };
}

function candidate(
  targetType: RetrievalCandidate["targetType"],
  targetId: string,
  authority: RetrievalCandidate["authority"],
  path: string,
  score: number,
  textPreview: string,
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
      docId: targetId,
      path,
      sourceVersion: "rev_1",
      authority,
    },
    source: "manual",
    rationale: ["test candidate"],
  };
}
