import type { QueryKind } from "@atlas/core";

import { buildHitRationale } from "../presenters/hit-rationale";
import type {
	RankCandidatesInput,
	RankedHit,
	RankingFactors,
	RetrievalCandidate,
} from "../types";
import { authorityWeight } from "./authority-weight";
import { localityWeight } from "./locality-weight";
import { redundancyPenalty } from "./redundancy-penalty";

/** Ranks raw candidates with explicit authority, locality, redundancy, and query-kind factors. */
export function rankCandidates(input: RankCandidatesInput): RankedHit[] {
	const candidates = dedupeCandidates(input.candidates);
	const baseRanked: RankedHit[] = candidates
		.map((candidate) => {
			const factors = scoreCandidate(
				candidate,
				input.query,
				input.classification.kind,
				input.scopes ?? [],
				input.freshnessByRepo,
				[],
			);
			const score = composeScore(factors);
			return {
				...candidate,
				score,
				rationale: buildHitRationale(candidate, factors),
				factors,
			};
		})
		.sort(sortRankedHits);
	const ranked: RankedHit[] = [];

	for (const candidate of baseRanked) {
		const factors = scoreCandidate(
			candidate,
			input.query,
			input.classification.kind,
			input.scopes ?? [],
			input.freshnessByRepo,
			ranked,
		);
		const score = composeScore(factors);
		ranked.push({
			...candidate,
			score,
			rationale: buildHitRationale(candidate, factors),
			factors,
		});
	}

	return diversifyRankedHits(
		ranked.sort(sortRankedHits),
		input.classification.kind,
	).slice(0, input.limit ?? ranked.length);
}

function scoreCandidate(
	candidate: RetrievalCandidate,
	query: string,
	queryKind: QueryKind,
	scopes: RankCandidatesInput["scopes"],
	freshnessByRepo: RankCandidatesInput["freshnessByRepo"],
	previous: readonly RetrievalCandidate[],
): RankingFactors {
	return {
		lexicalScore: normalizeBaseScore(candidate.score ?? 0),
		authority: authorityWeight({ authority: candidate.authority, queryKind }),
		locality: localityWeight(candidate.provenance, scopes),
		queryKind: queryKindWeight(candidate, queryKind),
		tokenEfficiency: tokenEfficiency(candidate.tokenCount),
		freshness: freshnessByRepo?.get(candidate.provenance.repoId) ?? 0,
		evidenceMatch: evidenceMatchWeight(candidate, query, queryKind),
		redundancyPenalty: redundancyPenalty(candidate, previous),
	};
}

function composeScore(factors: RankingFactors): number {
	const score =
		factors.lexicalScore * 1.25 +
		factors.authority * 0.74 +
		factors.locality * 0.95 +
		factors.queryKind * 0.62 +
		factors.tokenEfficiency * 0.24 +
		factors.freshness * 0.7 +
		factors.evidenceMatch * 1.1 -
		factors.redundancyPenalty;
	return Number(Math.max(0, score).toFixed(4));
}

function normalizeBaseScore(score: number): number {
	if (score <= 0) {
		return 0;
	}
	return Number(Math.min(1, score).toFixed(3));
}

function queryKindWeight(
	candidate: RetrievalCandidate,
	kind: QueryKind,
): number {
	if (kind === "overview") {
		return targetTypeWeight(candidate.targetType, {
			summary: 0.72,
			document: 0.62,
			section: 0.34,
			chunk: 0.34,
			fallback: 0.18,
		});
	}
	if (kind === "usage" || kind === "troubleshooting") {
		return targetTypeWeight(candidate.targetType, {
			section: 0.9,
			chunk: 0.9,
			document: 0.48,
			skill: 0.42,
			summary: 0.38,
			fallback: 0.22,
		});
	}
	if (kind === "skill-invocation") {
		return skillInvocationWeight(candidate);
	}
	if (kind === "exact-lookup" || kind === "location") {
		return lookupWeight(candidate);
	}
	if (kind === "compare") {
		return targetTypeWeight(candidate.targetType, {
			summary: 0.58,
			section: 0.74,
			chunk: 0.74,
			document: 0.5,
			fallback: 0.28,
		});
	}
	if (kind === "diff") {
		return targetTypeWeight(candidate.targetType, {
			document: 0.54,
			section: 0.54,
			chunk: 0.54,
			fallback: 0.22,
		});
	}
	return 0.25;
}

function skillInvocationWeight(candidate: RetrievalCandidate): number {
	if (candidate.targetType === "skill") {
		return 1;
	}
	return candidate.provenance.skillId === undefined ? 0.1 : 0.78;
}

function lookupWeight(candidate: RetrievalCandidate): number {
	if (candidate.source === "path") {
		return 1;
	}
	return targetTypeWeight(candidate.targetType, {
		document: 0.7,
		section: 0.56,
		chunk: 0.56,
		fallback: 0.22,
	});
}

function evidenceMatchWeight(
	candidate: RetrievalCandidate,
	query: string,
	queryKind: QueryKind,
): number {
	const path = normalizePath(candidate.provenance.path);
	const queryText = normalizeQuery(query);
	let weight = 0;

	if (candidate.source === "path") {
		weight += 1;
	}
	if (path.length > 0 && queryText.includes(path)) {
		weight += 0.95;
	} else {
		const basename = path.split("/").at(-1) ?? "";
		if (basename.length > 0 && queryText.includes(basename)) {
			weight += 0.45;
		}
	}

	const heading =
		candidate.provenance.headingPath?.join(" ").toLowerCase() ?? "";
	if (heading.length > 0 && queryText.includes(heading)) {
		weight += 0.35;
	}

	if (isCanonicalDocsPath(path)) {
		weight += canonicalDocsBoost(candidate, queryKind, queryText);
	}
	if (
		candidate.provenance.skillId !== undefined &&
		queryKind !== "skill-invocation"
	) {
		weight -= 0.22;
	}
	return Number(Math.max(0, Math.min(1.4, weight)).toFixed(3));
}

function canonicalDocsBoost(
	candidate: RetrievalCandidate,
	queryKind: QueryKind,
	queryText: string,
): number {
	if (queryKind === "skill-invocation") {
		return 0;
	}
	let boost = 0.12;
	if (candidate.targetType === "section" || candidate.targetType === "chunk") {
		boost += 0.08;
	}
	if (
		/\b(workflow|policy|security|privacy|config|configuration|troubleshoot|diagnostic|artifact|runtime|cli|mcp|retrieval|index|build|publish|import|repo)\b/.test(
			queryText,
		)
	) {
		boost += 0.18;
	}
	return boost;
}

function normalizePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "")
		.replace(/\/+/g, "/")
		.toLowerCase();
}

function normalizeQuery(query: string): string {
	return query
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/+/g, "/")
		.toLowerCase();
}

function isCanonicalDocsPath(path: string): boolean {
	return (
		path === "readme.md" ||
		path.startsWith("docs/") ||
		path === "apps/cli/docs/index.md"
	);
}

function diversifyRankedHits(
	hits: readonly RankedHit[],
	queryKind: QueryKind,
): RankedHit[] {
	if (hits.length <= 1 || queryKind === "skill-invocation") {
		return [...hits];
	}
	const selected: RankedHit[] = [];
	const deferred: RankedHit[] = [];
	const docCounts = new Map<string, number>();
	const dirCounts = new Map<string, number>();
	const typeCounts = new Map<RankedHit["targetType"], number>();
	const protectedWindow = Math.min(5, hits.length);

	for (const hit of hits) {
		if (
			selected.length < protectedWindow &&
			wouldCrowdTopWindow(hit, { docCounts, dirCounts, typeCounts })
		) {
			deferred.push(hit);
			continue;
		}
		selected.push(hit);
		increment(docCounts, hit.provenance.docId);
		increment(dirCounts, parentDir(hit.provenance.path));
		increment(typeCounts, hit.targetType);
	}

	return [...selected, ...deferred.filter((hit) => !selected.includes(hit))];
}

function wouldCrowdTopWindow(
	hit: RankedHit,
	counts: {
		readonly docCounts: ReadonlyMap<string, number>;
		readonly dirCounts: ReadonlyMap<string, number>;
		readonly typeCounts: ReadonlyMap<RankedHit["targetType"], number>;
	},
): boolean {
	if ((counts.docCounts.get(hit.provenance.docId) ?? 0) >= 2) {
		return true;
	}
	if ((counts.dirCounts.get(parentDir(hit.provenance.path)) ?? 0) >= 2) {
		return true;
	}
	if (
		hit.targetType === "summary" &&
		(counts.typeCounts.get("summary") ?? 0) >= 1
	) {
		return true;
	}
	if (
		hit.targetType === "skill" &&
		(counts.typeCounts.get("skill") ?? 0) >= 1
	) {
		return true;
	}
	return false;
}

function parentDir(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf("/");
	return index === -1 ? "" : normalized.slice(0, index);
}

function increment<K>(counts: Map<K, number>, key: K): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

function targetTypeWeight(
	targetType: RetrievalCandidate["targetType"],
	weights: Partial<Record<RetrievalCandidate["targetType"], number>> & {
		fallback: number;
	},
): number {
	return weights[targetType] ?? weights.fallback;
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

function dedupeCandidates(
	candidates: readonly RetrievalCandidate[],
): RetrievalCandidate[] {
	const byKey = new Map<string, RetrievalCandidate>();
	for (const candidate of candidates) {
		const key = `${candidate.targetType}:${candidate.targetId}`;
		const existing = byKey.get(key);
		if (
			existing === undefined ||
			(candidate.score ?? 0) > (existing.score ?? 0)
		) {
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
