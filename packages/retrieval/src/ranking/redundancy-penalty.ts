import type { RetrievalCandidate } from "../types";

/** Calculates a deterministic redundancy penalty against already-ranked candidates. */
export function redundancyPenalty(candidate: RetrievalCandidate, previous: readonly RetrievalCandidate[]): number {
  let penalty = 0;
  for (const existing of previous) {
    if (existing.targetId === candidate.targetId && existing.targetType === candidate.targetType) {
      penalty = Math.max(penalty, 1);
      continue;
    }
    if (existing.provenance.docId === candidate.provenance.docId && existing.targetType === candidate.targetType) {
      penalty = Math.max(penalty, 0.22);
    }
    if (textSimilarity(existing.textPreview, candidate.textPreview) >= 0.82) {
      penalty = Math.max(penalty, 0.36);
    }
  }
  return Number(penalty.toFixed(3));
}

function textSimilarity(left?: string, right?: string): number {
  if (left === undefined || right === undefined || left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftTerms = new Set(tokenize(left));
  const rightTerms = new Set(tokenize(right));
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(leftTerms.size, rightTerms.size);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .filter((term) => term.length >= 3);
}
