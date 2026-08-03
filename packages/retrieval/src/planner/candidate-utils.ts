import type { RetrievalCandidate } from "../types";

/** Stable identity used wherever retrieval candidates are merged. */
export function candidateKey(candidate: RetrievalCandidate): string {
  return `${candidate.targetType}:${candidate.targetId}`;
}

/**
 * Merges duplicate candidates while preserving path matches and otherwise
 * selecting the strongest score for each stable target.
 */
export function dedupeCandidates(
  candidates: readonly RetrievalCandidate[],
): RetrievalCandidate[] {
  const byKey = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = byKey.get(key);
    if (
      existing === undefined ||
      candidate.source === "path" ||
      (existing.source !== "path" &&
        (candidate.score ?? 0) > (existing.score ?? 0))
    ) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}
