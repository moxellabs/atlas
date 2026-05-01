import type { QueryKind } from "@atlas/core";

import { buildHitRationale } from "../presenters/hit-rationale";
import type { RankedHit, RankCandidatesInput, RankingFactors, RetrievalCandidate } from "../types";
import { authorityWeight } from "./authority-weight";
import { localityWeight } from "./locality-weight";
import { redundancyPenalty } from "./redundancy-penalty";

/** Ranks raw candidates with explicit authority, locality, redundancy, and query-kind factors. */
export function rankCandidates(input: RankCandidatesInput): RankedHit[] {
  const candidates = dedupeCandidates(input.candidates);
  const baseRanked: RankedHit[] = candidates
    .map((candidate) => {
      const factors = scoreCandidate(candidate, input.classification.kind, input.scopes ?? [], input.freshnessByRepo, []);
      const score = composeScore(factors);
      return {
        ...candidate,
        score,
        rationale: buildHitRationale(candidate, factors),
        factors
      };
    })
    .sort(sortRankedHits);
  const ranked: RankedHit[] = [];

  for (const candidate of baseRanked) {
    const factors = scoreCandidate(candidate, input.classification.kind, input.scopes ?? [], input.freshnessByRepo, ranked);
    const score = composeScore(factors);
    ranked.push({
      ...candidate,
      score,
      rationale: buildHitRationale(candidate, factors),
      factors
    });
  }

  return ranked.sort(sortRankedHits).slice(0, input.limit ?? ranked.length);
}

function scoreCandidate(
  candidate: RetrievalCandidate,
  queryKind: QueryKind,
  scopes: RankCandidatesInput["scopes"],
  freshnessByRepo: RankCandidatesInput["freshnessByRepo"],
  previous: readonly RetrievalCandidate[]
): RankingFactors {
  return {
    lexicalScore: normalizeBaseScore(candidate.score ?? 0),
    authority: authorityWeight({ authority: candidate.authority, queryKind }),
    locality: localityWeight(candidate.provenance, scopes),
    queryKind: queryKindWeight(candidate, queryKind),
    tokenEfficiency: tokenEfficiency(candidate.tokenCount),
    freshness: freshnessByRepo?.get(candidate.provenance.repoId) ?? 0,
    redundancyPenalty: redundancyPenalty(candidate, previous)
  };
}

function composeScore(factors: RankingFactors): number {
  const score =
    factors.lexicalScore * 1.1 +
    factors.authority * 0.9 +
    factors.locality * 1.35 +
    factors.queryKind * 0.72 +
    factors.tokenEfficiency * 0.3 +
    factors.freshness * 0.8 -
    factors.redundancyPenalty;
  return Number(Math.max(0, score).toFixed(4));
}

function normalizeBaseScore(score: number): number {
  if (score <= 0) {
    return 0;
  }
  return Number(Math.min(1, score).toFixed(3));
}

function queryKindWeight(candidate: RetrievalCandidate, kind: QueryKind): number {
  if (kind === "overview") {
    return candidate.targetType === "summary" ? 1 : candidate.targetType === "document" ? 0.58 : 0.2;
  }
  if (kind === "usage" || kind === "troubleshooting") {
    return candidate.targetType === "section" || candidate.targetType === "chunk" ? 0.86 : candidate.targetType === "skill" ? 0.72 : 0.28;
  }
  if (kind === "skill-invocation") {
    return candidate.targetType === "skill" ? 1 : candidate.provenance.skillId !== undefined ? 0.78 : 0.1;
  }
  if (kind === "exact-lookup" || kind === "location") {
    return candidate.source === "path" ? 1 : candidate.targetType === "document" ? 0.66 : 0.24;
  }
  if (kind === "compare") {
    return candidate.targetType === "summary" || candidate.targetType === "section" ? 0.7 : 0.32;
  }
  if (kind === "diff") {
    return candidate.targetType === "document" || candidate.targetType === "section" ? 0.5 : 0.24;
  }
  return 0.25;
}

function tokenEfficiency(tokenCount: number | undefined): number {
  if (tokenCount === undefined) {
    return 0;
  }
  if (tokenCount <= 80) {
    return 1;
  }
  if (tokenCount <= 240) {
    return 0.62;
  }
  if (tokenCount <= 640) {
    return 0.28;
  }
  return 0;
}

function dedupeCandidates(candidates: readonly RetrievalCandidate[]): RetrievalCandidate[] {
  const byKey = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.targetType}:${candidate.targetId}`;
    const existing = byKey.get(key);
    if (existing === undefined || (candidate.score ?? 0) > (existing.score ?? 0)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function sortRankedHits(left: RankedHit, right: RankedHit): number {
  return (
    right.score - left.score ||
    targetPriority(right.targetType) - targetPriority(left.targetType) ||
    left.provenance.path.localeCompare(right.provenance.path) ||
    left.targetId.localeCompare(right.targetId)
  );
}

function targetPriority(targetType: RetrievalCandidate["targetType"]): number {
  if (targetType === "skill") {
    return 5;
  }
  if (targetType === "summary") {
    return 4;
  }
  if (targetType === "section") {
    return 3;
  }
  if (targetType === "chunk") {
    return 2;
  }
  return 1;
}
