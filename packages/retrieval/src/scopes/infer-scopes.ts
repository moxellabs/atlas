import {
	ModuleRepository,
	PackageRepository,
	RepoRepository,
	SkillRepository,
	type StoreDatabase,
} from "@atlas/store";

import { RetrievalDependencyError } from "../errors";
import type {
	QueryClassification,
	RetrievalDiagnostic,
	ScopeCandidate,
	ScopeInferenceResult,
} from "../types";

/** Input for conservative store-backed scope inference. */
export interface InferScopesInput {
	/** Initialized ATLAS store database. */
	db: StoreDatabase;
	/** Raw query text. */
	query: string;
	/** Query classification from the classifier stage. */
	classification: QueryClassification;
	/** Optional repository constraint. */
	repoId?: string | undefined;
	/** Maximum scopes to return. Defaults to 8. */
	limit?: number | undefined;
}

/** Infers likely repo/package/module/skill scopes from query text and persisted topology metadata. */
export function inferScopes(input: InferScopesInput): ScopeInferenceResult {
	const limit = input.limit ?? 8;
	const diagnostics: RetrievalDiagnostic[] = [];
	const normalizedQuery = normalize(input.query);
	const queryTerms = terms(normalizedQuery);

	try {
		const repos =
			input.repoId === undefined
				? new RepoRepository(input.db).list()
				: maybeOne(new RepoRepository(input.db).get(input.repoId));
		const packages = new PackageRepository(input.db);
		const modules = new ModuleRepository(input.db);
		const skills = new SkillRepository(input.db);
		const candidates = collectScopeCandidates({
			repos,
			packages,
			modules,
			skills,
			normalizedQuery,
			queryTerms,
			skillBoost: input.classification.kind === "skill-invocation" ? 0.18 : 0,
		});

		const scopes = mergeScopeCandidates(candidates)
			.filter((candidate) => candidate.score > 0)
			.sort(sortScopes)
			.slice(0, limit);

		diagnostics.push({
			stage: "scope-inference",
			message: `Inferred ${scopes.length} candidate scopes.`,
			metadata: {
				candidateCount: candidates.length,
				returnedCount: scopes.length,
			},
		});

		return { query: input.query, scopes, diagnostics };
	} catch (error) {
		throw new RetrievalDependencyError(
			"Scope inference failed while reading store metadata.",
			{
				operation: "inferScopes",
				entity: "store",
				cause: error,
			},
		);
	}
}

interface ScopeCandidateCollectionInput {
	repos: ReturnType<RepoRepository["list"]>;
	packages: PackageRepository;
	modules: ModuleRepository;
	skills: SkillRepository;
	normalizedQuery: string;
	queryTerms: readonly string[];
	skillBoost: number;
}

function collectScopeCandidates(
	input: ScopeCandidateCollectionInput,
): ScopeCandidate[] {
	return input.repos.flatMap((repo) => [
		repoScopeCandidate(repo.repoId, input.normalizedQuery, input.queryTerms),
		...packageScopeCandidates(
			input.packages,
			repo.repoId,
			input.normalizedQuery,
			input.queryTerms,
		),
		...moduleScopeCandidates(
			input.modules,
			repo.repoId,
			input.normalizedQuery,
			input.queryTerms,
		),
		...skillScopeCandidates(
			input.skills,
			repo.repoId,
			input.normalizedQuery,
			input.queryTerms,
			input.skillBoost,
		),
	]);
}

function repoScopeCandidate(
	repoId: string,
	normalizedQuery: string,
	queryTerms: readonly string[],
): ScopeCandidate {
	return {
		level: "repo",
		id: repoId,
		repoId,
		label: repoId,
		score: scoreLabel(normalizedQuery, queryTerms, [repoId]),
		rationale: [`Repository ${repoId} considered for query scope.`],
	};
}

function packageScopeCandidates(
	packages: PackageRepository,
	repoId: string,
	normalizedQuery: string,
	queryTerms: readonly string[],
): ScopeCandidate[] {
	return packages.listByRepo(repoId).flatMap((pkg) => {
		const score = scoreLabel(normalizedQuery, queryTerms, [
			pkg.name,
			pkg.packageId,
			pkg.path,
			pkg.manifestPath,
		]);
		if (score <= 0) {
			return [];
		}
		return [
			{
				level: "package",
				id: pkg.packageId,
				repoId: pkg.repoId,
				packageId: pkg.packageId,
				label: pkg.name,
				score,
				rationale: [`Matched package metadata for ${pkg.name}.`],
			},
		];
	});
}

function moduleScopeCandidates(
	modules: ModuleRepository,
	repoId: string,
	normalizedQuery: string,
	queryTerms: readonly string[],
): ScopeCandidate[] {
	return modules.listByRepo(repoId).flatMap((module) => {
		const score = scoreLabel(normalizedQuery, queryTerms, [
			module.name,
			module.moduleId,
			module.path,
		]);
		if (score <= 0) {
			return [];
		}
		return [
			{
				level: "module",
				id: module.moduleId,
				repoId: module.repoId,
				...(module.packageId === undefined
					? {}
					: { packageId: module.packageId }),
				moduleId: module.moduleId,
				label: module.name,
				score,
				rationale: [`Matched module metadata for ${module.name}.`],
			},
		];
	});
}

function skillScopeCandidates(
	skills: SkillRepository,
	repoId: string,
	normalizedQuery: string,
	queryTerms: readonly string[],
	skillBoost: number,
): ScopeCandidate[] {
	return skills.listByRepo(repoId).flatMap((skill) => {
		const score = scoreLabel(normalizedQuery, queryTerms, [
			skill.title ?? "",
			skill.skillId,
			skill.sourceDocPath,
			skill.description ?? "",
		]);
		if (score + skillBoost <= 0) {
			return [];
		}
		return [
			{
				level: "skill",
				id: skill.skillId,
				repoId: skill.repoId,
				...(skill.packageId === undefined
					? {}
					: { packageId: skill.packageId }),
				...(skill.moduleId === undefined ? {} : { moduleId: skill.moduleId }),
				skillId: skill.skillId,
				label: skill.title ?? skill.skillId,
				score: clampScore(score + skillBoost),
				rationale: [
					`Matched skill metadata for ${skill.title ?? skill.skillId}.`,
					...(skillBoost === 0
						? []
						: ["Skill-invocation query boosted skill scope."]),
				],
			},
		];
	});
}

function maybeOne<T>(value: T | undefined): T[] {
	return value === undefined ? [] : [value];
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[`"'()[\]{}]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function terms(value: string): string[] {
	return value
		.split(/[^a-z0-9@._/-]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"do",
	"does",
	"for",
	"how",
	"i",
	"in",
	"is",
	"of",
	"the",
	"to",
	"what",
	"where",
]);

function scoreLabel(
	query: string,
	queryTerms: readonly string[],
	values: readonly string[],
): number {
	let score = 0;
	for (const rawValue of values) {
		const value = normalize(rawValue);
		if (value.length === 0) {
			continue;
		}
		if (query === value) {
			score += 1;
		} else if (query.includes(value) || value.includes(query)) {
			score += 0.72;
		}
		const valueTerms = new Set(terms(value));
		const overlap = queryTerms.filter(
			(term) => valueTerms.has(term) || value.includes(term),
		);
		score += Math.min(0.42, overlap.length * 0.14);
	}
	return clampScore(score);
}

function clampScore(score: number): number {
	return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function mergeScopeCandidates(
	candidates: readonly ScopeCandidate[],
): ScopeCandidate[] {
	const merged = new Map<string, ScopeCandidate>();
	for (const candidate of candidates) {
		const key = `${candidate.level}:${candidate.id}`;
		const existing = merged.get(key);
		if (existing === undefined || candidate.score > existing.score) {
			merged.set(key, candidate);
		} else if (candidate.score === existing.score) {
			merged.set(key, {
				...existing,
				rationale: [...existing.rationale, ...candidate.rationale],
			});
		}
	}
	return [...merged.values()];
}

function sortScopes(left: ScopeCandidate, right: ScopeCandidate): number {
	return (
		right.score - left.score ||
		scopePriority(right.level) - scopePriority(left.level) ||
		left.id.localeCompare(right.id)
	);
}

function scopePriority(level: ScopeCandidate["level"]): number {
	if (level === "skill") {
		return 4;
	}
	if (level === "module") {
		return 3;
	}
	if (level === "package") {
		return 2;
	}
	return 1;
}
