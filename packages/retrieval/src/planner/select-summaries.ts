import type { QueryKind } from "@atlas/core";

import type { PlannedItem, PlanningSelectionState, RankedHit } from "../types";

/** Input for summary-first selection. */
export interface SelectSummariesInput {
  /** Ranked hits to inspect. */
  rankedHits: readonly RankedHit[];
  /** Query kind that controls summary-first aggressiveness. */
  queryKind: QueryKind;
  /** Raw query text, used to detect detail-oriented concrete evidence requests. */
  query?: string | undefined;
  /** Current planning state. */
  state: PlanningSelectionState;
  /** Maximum summary items to select. Defaults to 4. */
  limit?: number | undefined;
}

/** Selects low-cost summaries and outlines before deeper evidence when policy allows it. */
export function selectSummaries(input: SelectSummariesInput): PlanningSelectionState {
  const limit = input.limit ?? (needsConcreteEvidence(input.query) ? 2 : input.queryKind === "overview" || input.queryKind === "compare" ? 5 : 2);
  const state = cloneState(input.state);
  const summaryHits = input.rankedHits.filter((hit) => hit.targetType === "summary");

  for (const hit of summaryHits) {
    if (state.selected.length >= limit) {
      state.omitted.push(toPlannedItem(hit, "Summary limit reached."));
      continue;
    }
    appendIfBudgetAllows(state, hit, "Selected during summary-first planning.");
  }

  return state;
}

/** Returns true when an overview-ish query still asks for command/tool/path-level evidence. */
export function needsConcreteEvidence(query: string | undefined): boolean {
  if (query === undefined) {
    return false;
  }
  return /`[^`]+`|\b[\w.-]+\/[\w./-]+\b|\b(?:bun|npm|pnpm|yarn|npx|node|git|atlas|mcp|sqlite|fts5?|import|build|publish|init|sync|upload|token|credentials?|tools?)\b/i.test(query);
}

/** Appends a ranked hit if the current budget permits it; otherwise records it as omitted. */
export function appendIfBudgetAllows(state: PlanningSelectionState, hit: RankedHit, reason: string): boolean {
  const item = toPlannedItem(hit, reason);
  if (item.tokenCount > state.budgetTokens) {
    state.omitted.push({ ...item, rationale: [...item.rationale, "Item exceeds entire context budget."] });
    state.warnings.push(`Omitted ${item.targetType}:${item.targetId} because it exceeds the context budget.`);
    return false;
  }
  if (state.usedTokens + item.tokenCount > state.budgetTokens) {
    state.omitted.push({ ...item, rationale: [...item.rationale, "Item does not fit remaining token budget."] });
    return false;
  }
  if (state.selected.some((selected) => selected.targetType === item.targetType && selected.targetId === item.targetId)) {
    return false;
  }
  state.selected.push(item);
  state.usedTokens += item.tokenCount;
  return true;
}

/** Converts a ranked hit into a planned item preserving provenance, score, text, and rationale. */
export function toPlannedItem(hit: RankedHit, plannerReason: string): PlannedItem {
  return {
    targetType: hit.targetType,
    targetId: hit.targetId,
    tokenCount: hit.tokenCount ?? estimatePreviewTokens(hit.textPreview),
    provenance: hit.provenance,
    rationale: [...hit.rationale, plannerReason],
    ...(hit.textPreview === undefined ? {} : { text: hit.textPreview }),
    score: hit.score
  };
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

function estimatePreviewTokens(text: string | undefined): number {
  if (text === undefined || text.length === 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length * 1.35));
}
