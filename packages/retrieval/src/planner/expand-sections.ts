import type { QueryKind } from "@atlas/core";

import type { PlanningSelectionState, RankedHit } from "../types";
import { appendIfBudgetAllows, needsConcreteEvidence, toPlannedItem } from "./select-summaries";

/** Input for detail expansion after summary-first planning. */
export interface ExpandSectionsInput {
  /** Ranked hits available for expansion. */
  rankedHits: readonly RankedHit[];
  /** Query kind used to decide whether deeper evidence is necessary. */
  queryKind: QueryKind;
  /** Raw query text, used to force detail expansion for concrete tokens. */
  query?: string | undefined;
  /** Current planning state. */
  state: PlanningSelectionState;
  /** Maximum expansion items to add. Defaults to 6. */
  limit?: number | undefined;
}

/** Adds section/chunk/detail hits under the remaining budget while avoiding duplicate evidence. */
export function expandSections(input: ExpandSectionsInput): PlanningSelectionState {
  const state = cloneState(input.state);
  const limit = input.limit ?? defaultExpansionLimit(input.queryKind);
  const needsDetail = shouldExpand(input.queryKind, state, input.query);
  if (!needsDetail) {
    for (const hit of input.rankedHits.filter((candidate) => candidate.targetType !== "summary")) {
      state.omitted.push(toPlannedItem(hit, "Summary-first policy did not require deeper expansion."));
    }
    return state;
  }

  let added = 0;
  const seenDocs = new Set(state.selected.map((item) => item.provenance.docId));
  for (const hit of orderExpansionHits(input.rankedHits, input.queryKind)) {
    if (added >= limit) {
      state.omitted.push(toPlannedItem(hit, "Expansion limit reached."));
      continue;
    }
    if (!isExpansionTarget(hit)) {
      continue;
    }
    if (seenDocs.has(hit.provenance.docId) && state.selected.some((item) => item.targetType !== "summary" && item.provenance.docId === hit.provenance.docId)) {
      state.omitted.push(toPlannedItem(hit, "Skipped redundant expansion from an already selected document."));
      continue;
    }
    if (appendIfBudgetAllows(state, hit, "Selected during detail expansion.")) {
      seenDocs.add(hit.provenance.docId);
      added += 1;
    }
  }

  return state;
}

function shouldExpand(queryKind: QueryKind, state: PlanningSelectionState, query: string | undefined): boolean {
  if (needsConcreteEvidence(query)) {
    return true;
  }
  if (queryKind === "overview" && state.selected.length > 0 && state.usedTokens <= state.budgetTokens * 0.55) {
    return false;
  }
  return true;
}

function isExpansionTarget(hit: RankedHit): boolean {
  return hit.targetType === "section" || hit.targetType === "chunk" || hit.targetType === "document" || hit.targetType === "skill";
}

function defaultExpansionLimit(queryKind: QueryKind): number {
  if (queryKind === "exact-lookup" || queryKind === "location") {
    return 3;
  }
  if (queryKind === "usage" || queryKind === "troubleshooting" || queryKind === "skill-invocation") {
    return 6;
  }
  return 4;
}

function orderExpansionHits(hits: readonly RankedHit[], queryKind: QueryKind): RankedHit[] {
  return [...hits].sort((left, right) => {
    const priorityDelta = expansionPriority(right, queryKind) - expansionPriority(left, queryKind);
    return priorityDelta || right.score - left.score || left.targetId.localeCompare(right.targetId);
  });
}

function expansionPriority(hit: RankedHit, queryKind: QueryKind): number {
  if (queryKind === "usage" || queryKind === "troubleshooting") {
    return hit.targetType === "section" || hit.targetType === "chunk" ? 5 : hit.targetType === "skill" ? 4 : hit.targetType === "document" ? 2 : 1;
  }
  if (queryKind === "skill-invocation") {
    return hit.targetType === "skill" ? 5 : hit.targetType === "section" || hit.targetType === "chunk" ? 4 : 2;
  }
  if (queryKind === "exact-lookup" || queryKind === "location") {
    return hit.source === "path" ? 5 : hit.targetType === "document" ? 4 : hit.targetType === "section" || hit.targetType === "chunk" ? 3 : 1;
  }
  return hit.targetType === "section" || hit.targetType === "chunk" ? 4 : hit.targetType === "document" ? 3 : 1;
}

function cloneState(state: PlanningSelectionState): PlanningSelectionState {
  return {
    budgetTokens: state.budgetTokens,
    usedTokens: state.usedTokens,
    selected: [...state.selected],
    omitted: [...state.omitted],
    warnings: [...state.warnings]
  };
}
