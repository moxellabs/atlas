import type { RankedHit, RankingFactors, RetrievalCandidate } from "../types";

/** Builds compact deterministic rationale lines from a candidate and score factors. */
export function buildHitRationale(candidate: RetrievalCandidate, factors: RankingFactors): string[] {
  const rationale = [...(candidate.rationale ?? [])];

  if (candidate.source !== undefined) {
    rationale.push(`Candidate came from ${candidate.source} retrieval.`);
  }
  if (factors.lexicalScore > 0) {
    rationale.push(`Search substrate contributed ${format(factors.lexicalScore)}.`);
  }
  if (factors.authority >= 1) {
    rationale.push("Candidate is canonical authority.");
  } else if (factors.authority >= 0.7) {
    rationale.push("Candidate has preferred authority.");
  }
  if (factors.locality >= 0.7) {
    rationale.push("Candidate belongs to a highly relevant inferred scope.");
  } else if (factors.locality > 0) {
    rationale.push("Candidate has partial scope locality.");
  }
  if (factors.queryKind > 0) {
    rationale.push(`Query-kind policy contributed ${format(factors.queryKind)}.`);
  }
  if (factors.tokenEfficiency > 0) {
    rationale.push("Candidate has a low token cost for its evidence value.");
  }
  if (factors.freshness > 0) {
    rationale.push("Candidate belongs to a fresh indexed repository.");
  } else if (factors.freshness < 0) {
    rationale.push(`Candidate was penalized ${format(Math.abs(factors.freshness))} for stale repository freshness.`);
  }
  if (factors.redundancyPenalty > 0) {
    rationale.push(`Candidate was penalized ${format(factors.redundancyPenalty)} for redundancy.`);
  }

  return unique(rationale);
}

/** Creates a short stable rationale summary suitable for inspect surfaces. */
export function summarizeHitRationale(hit: RankedHit): string {
  return hit.rationale.slice(0, 4).join(" ");
}

function format(value: number): string {
  return value.toFixed(2);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
