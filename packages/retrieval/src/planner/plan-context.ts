import {
	type CanonicalSection,
	computeFreshness,
	type Provenance,
} from "@atlas/core";
import type {
	ChunkRecord,
	DocumentRecord,
	LexicalSearchHit,
	SectionRecord,
	SkillRecord,
	StoreDatabase,
	SummaryRecord,
} from "@atlas/store";
import {
	ChunkRepository,
	DocRepository,
	lexicalSearch,
	ManifestRepository,
	ModuleRepository,
	PackageRepository,
	pathSearch,
	RepoRepository,
	SectionRepository,
	SkillRepository,
	SummaryRepository,
	scopeSearch,
} from "@atlas/store";
import { createTextEncoder } from "@atlas/tokenizer";

import { classifyQuery } from "../classify/classify-query";
import {
	RetrievalConfigurationError,
	RetrievalDependencyError,
} from "../errors";
import { buildAmbiguityResult } from "../presenters/ambiguity-result";
import { expandQuery } from "../query/expand-query";
import { rankCandidates } from "../ranking/rank-candidates";
import { inferScopes } from "../scopes/infer-scopes";
import type {
	ContextPacket,
	PlanContextInput,
	PlannedContext,
	PlannedItem,
	PlanningSelectionState,
	RetrievalCandidate,
	RetrievalDiagnostic,
	RetrievalRepositories,
	ScopeCandidate,
	ScopeContext,
} from "../types";
import { expandSections } from "./expand-sections";
import { finalizeContext } from "./finalize-context";
import { selectSummaries } from "./select-summaries";

const DEFAULT_CANDIDATE_LIMIT = 40;
/** Max documents broad fallback will score before ranking the top slice. */
const BROAD_FALLBACK_SCAN_LIMIT = 120;
/** Max repos scanned when no repoId filter is present. */
const BROAD_FALLBACK_REPO_LIMIT = 8;

/** Builds a staged, scope-aware, token-budgeted context plan over persisted ATLAS artifacts. */
export function planContext(input: PlanContextInput): PlannedContext {
	validatePlanInput(input);
	const encoder = input.encoder ?? createTextEncoder();
	const diagnostics: RetrievalDiagnostic[] = [];
	const repositories = resolveRepositories(input);
	const classification = classifyQuery(input.query);
	diagnostics.push({
		stage: "classification",
		message: `Classified query as ${classification.kind}.`,
		metadata: {
			confidence: classification.confidence,
			signals: classification.signals,
		},
	});

	const scopeResult = inferScopes({
		db: input.db,
		query: input.query,
		classification,
		...(input.repoId === undefined ? {} : { repoId: input.repoId }),
		limit: 10,
	});
	diagnostics.push(...scopeResult.diagnostics);

	const expandedQuery = expandQuery(input.query);
	const candidates = gatherCandidates(input.db, repositories, {
		query: input.query,
		expandedQuery,
		repoId: input.repoId,
		scopes: scopeResult.scopes,
		candidateLimit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
		countTokens: (text) => encoder.count(text),
		filters: input.filters,
	});
	diagnostics.push({
		stage: "candidate-generation",
		message: `Generated ${candidates.length} retrieval candidates.`,
		metadata: {
			...(input.filters === undefined ? {} : { filters: input.filters }),
			byType: countBy(candidates, (candidate) => candidate.targetType),
			bySource: countBy(
				candidates,
				(candidate) => candidate.source ?? "unknown",
			),
		},
	});

	const rankedHits = rankCandidates({
		query: input.query,
		expandedQuery,
		classification,
		candidates,
		scopes: scopeResult.scopes,
		freshnessByRepo: freshnessScores(repositories),
		limit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
	});
	diagnostics.push({
		stage: "ranking",
		message: `Ranked ${rankedHits.length} retrieval hits.`,
		metadata: { topScore: rankedHits[0]?.score ?? 0 },
	});

	const initialState: PlanningSelectionState = {
		budgetTokens: input.budgetTokens,
		usedTokens: 0,
		selected: [],
		omitted: [],
		warnings: [],
	};
	const afterSummaries = selectSummaries({
		rankedHits,
		queryKind: classification.kind,
		query: input.query,
		state: initialState,
		...(input.summaryLimit === undefined ? {} : { limit: input.summaryLimit }),
	});
	const afterExpansion = expandSections({
		rankedHits,
		queryKind: classification.kind,
		query: input.query,
		state: afterSummaries,
		...(input.expansionLimit === undefined
			? {}
			: { limit: input.expansionLimit }),
	});
	const ambiguity = buildAmbiguityResult({
		rankedHits,
		scopes: scopeResult.scopes,
	});

	const planned = finalizeContext({
		query: input.query,
		classification,
		scopes: scopeResult.scopes,
		state: afterExpansion,
		rankedHits,
		diagnostics,
		...(ambiguity === undefined ? {} : { ambiguity }),
	});
	return enrichPlannedContext(input.db, planned);
}

function enrichPlannedContext(
	db: StoreDatabase,
	planned: PlannedContext,
): PlannedContext {
	const selected = planned.selected.map((item) => enrichPlannedItem(db, item));
	const omitted = planned.omitted.map((item) => enrichPlannedItem(db, item));
	return {
		...planned,
		selected,
		omitted,
		contextPacket: buildContextPacket({ ...planned, selected, omitted }),
	};
}

function enrichPlannedItem(db: StoreDatabase, item: PlannedItem): PlannedItem {
	return { ...item, scopeContext: scopeContextForItem(db, item) };
}

function scopeContextForItem(
	db: StoreDatabase,
	item: PlannedItem,
): ScopeContext {
	const repoLabel = item.provenance.repoId;
	const packageRecord =
		item.provenance.packageId === undefined
			? undefined
			: new PackageRepository(db).get(item.provenance.packageId);
	const moduleRecord =
		item.provenance.moduleId === undefined
			? undefined
			: new ModuleRepository(db).get(item.provenance.moduleId);
	const skillRecord =
		item.provenance.skillId === undefined
			? undefined
			: new SkillRepository(db).get(item.provenance.skillId);
	const scopeParts = [
		moduleRecord?.name,
		packageRecord?.name,
		skillRecord?.title,
		item.provenance.path,
	].filter(
		(part): part is string => part !== undefined && part.trim().length > 0,
	);
	return {
		repo: { repoId: item.provenance.repoId, label: repoLabel },
		...(packageRecord === undefined
			? {}
			: {
					package: {
						packageId: packageRecord.packageId,
						name: packageRecord.name,
						path: packageRecord.path,
					},
				}),
		...(moduleRecord === undefined
			? {}
			: {
					module: {
						moduleId: moduleRecord.moduleId,
						name: moduleRecord.name,
						path: moduleRecord.path,
					},
				}),
		...(skillRecord === undefined
			? {}
			: {
					skill: {
						skillId: skillRecord.skillId,
						...(skillRecord.title === undefined
							? {}
							: { title: skillRecord.title }),
						sourceDocPath: skillRecord.sourceDocPath,
					},
				}),
		label: scopeParts[0] ?? item.provenance.path,
	};
}

function buildContextPacket(planned: PlannedContext): ContextPacket {
	return {
		query: planned.query,
		budgetTokens: planned.budgetTokens,
		usedTokens: planned.usedTokens,
		confidence: planned.confidence,
		scopes: planned.scopes,
		evidence: planned.selected.map((item) => ({
			targetType: item.targetType,
			targetId: item.targetId,
			label: item.scopeContext?.label ?? item.provenance.path,
			tokenCount: item.tokenCount,
			...(item.score === undefined ? {} : { score: item.score }),
			provenance: item.provenance,
			...(item.scopeContext === undefined
				? {}
				: { scopeContext: item.scopeContext }),
			...(item.text === undefined ? {} : { text: item.text }),
			rationale: item.rationale,
		})),
		warnings: planned.warnings,
		omitted: planned.omitted.slice(0, 12).map((item) => {
			const diagnostic = planned.omissionDiagnostics.find(
				(omission) => omission.targetId === item.targetId,
			);
			return {
				targetType: item.targetType,
				targetId: item.targetId,
				label: item.scopeContext?.label ?? item.provenance.path,
				reason: item.rationale.at(-1) ?? "Omitted by context planner.",
				...(diagnostic === undefined
					? {}
					: { reasonCategory: diagnostic.reason }),
			};
		}),
		omissionDiagnostics: planned.omissionDiagnostics,
		recommendedNextActions: recommendedNextActions(planned),
	};
}

function recommendedNextActions(planned: PlannedContext): string[] {
	const actions: string[] = [];
	if (planned.ambiguity !== undefined) {
		actions.push(...planned.ambiguity.recommendedNextActions);
	}
	if (planned.omitted.length > 0) {
		actions.push(
			"Use expand_related on a selected target only if more detail is needed.",
		);
	}
	if (planned.confidence === "low") {
		actions.push(
			"Clarify repo, package, module, or path before answering decisively.",
		);
	}
	if (actions.length === 0) {
		actions.push(
			"Answer from contextPacket.evidence and cite provenance paths.",
		);
	}
	return [...new Set(actions)];
}
function freshnessScores(
	repositories: RetrievalRepositories,
): ReadonlyMap<string, number> {
	return new Map(
		repositories.repos.list().map((repo) => {
			const manifest = repositories.manifests.get(repo.repoId);
			const freshness = computeFreshness({
				repoId: repo.repoId,
				repoRevision: repo.revision,
				indexedRevision: manifest?.indexedRevision,
			});
			return [
				repo.repoId,
				freshness.fresh ? 0.2 : freshness.indexed ? -0.35 : -0.55,
			];
		}),
	);
}

function resolveRepositories(input: PlanContextInput): RetrievalRepositories {
	if (input.repositories !== undefined) {
		return input.repositories;
	}
	const db = input.db;
	return {
		docs: new DocRepository(db),
		summaries: new SummaryRepository(db),
		chunks: new ChunkRepository(db),
		sections: new SectionRepository(db),
		skills: new SkillRepository(db),
		repos: new RepoRepository(db),
		manifests: new ManifestRepository(db),
	};
}

interface GatherContext {
	readonly query: string;
	readonly expandedQuery: string;
	readonly repoId?: string | undefined;
	readonly scopes: readonly ScopeCandidate[];
	readonly candidateLimit: number;
	readonly countTokens: (text: string) => number;
	readonly filters?: PlanContextInput["filters"];
}

function gatherCandidates(
	db: StoreDatabase,
	repositories: RetrievalRepositories,
	context: GatherContext,
): RetrievalCandidate[] {
	try {
		const { docs: docRepo, summaries: summaryRepo, skills: skillRepo } =
			repositories;
		const candidates: RetrievalCandidate[] = [];
		const expandedQuery = context.expandedQuery;
		const lexicalQuery = toLexicalQuery(expandedQuery);

		if (lexicalQuery.length > 0) {
			const lexicalHits = lexicalSearch(db, {
				query: lexicalQuery,
				repoId: context.repoId,
				limit: context.candidateLimit,
				filters: context.filters,
			});
			const lexicalScores = normalizedLexicalScores(lexicalHits);
			for (const hit of lexicalHits) {
				const hydrated = candidateFromLexicalHit({
					repositories,
					docRepo,
					hit,
					score: lexicalScores.get(lexicalHitKey(hit)) ?? 0.35,
					countTokens: context.countTokens,
				});
				if (hydrated !== undefined) {
					candidates.push(hydrated.candidate);
					candidates.push(
						...documentSummaries(
							summaryRepo,
							hydrated.document,
							hydrated.candidate.score ?? 0.4,
						),
					);
				}
			}
		}

		for (const signal of pathSignals(context.query, expandedQuery)) {
			for (const document of pathSearch(db, {
				path: signal.path,
				mode: signal.path.includes("/") ? "contains" : "prefix",
				repoId: context.repoId,
				limit: 12,
				filters: context.filters,
			})) {
				const score = signal.expanded ? 0.94 : 1;
				candidates.push(
					documentCandidate(
						document,
						"path",
						score,
						[
							`Matched ${signal.expanded ? "expanded " : ""}path signal ${signal.path}.`,
						],
						context.countTokens,
					),
				);
				candidates.push(
					...documentSummaries(summaryRepo, document, score * 0.72),
				);
			}
		}

		for (const scope of context.scopes.slice(0, 6)) {
			for (const document of documentsForScope(db, scope, context.filters)) {
				candidates.push(
					documentCandidate(
						document,
						"scope",
						0.62 * scope.score,
						[`Matched inferred ${scope.level} scope ${scope.label}.`],
						context.countTokens,
					),
				);
				candidates.push(
					...documentSummaries(summaryRepo, document, 0.68 * scope.score),
				);
			}
			if (scope.level === "skill" && scope.skillId !== undefined) {
				const skill = skillRepo.get(scope.skillId);
				if (skill !== undefined) {
					candidates.push(
						skillCandidate(
							docRepo,
							skill,
							0.85 * scope.score,
							context.countTokens,
						),
					);
					const skillDoc = docRepo.get(skill.sourceDocId);
					if (skillDoc !== undefined) {
						candidates.push(
							...documentSummaries(
								summaryRepo,
								skillDoc,
								0.7 * scope.score,
							),
						);
					}
				}
			}
		}

		const deduped = dedupeCandidates(candidates);
		if (deduped.length < Math.min(context.candidateLimit, 3)) {
			return dedupeCandidates([
				...deduped,
				...broadFallbackCandidates(repositories, context, deduped.length),
			]);
		}
		return deduped;
	} catch (error) {
		throw new RetrievalDependencyError(
			"Candidate generation failed while reading store search artifacts.",
			{
				operation: "gatherCandidates",
				entity: "store",
				cause: error,
			},
		);
	}
}

function broadFallbackCandidates(
	repositories: RetrievalRepositories,
	context: GatherContext,
	existingCount: number,
): RetrievalCandidate[] {
	const terms = queryTerms(context.query);
	if (terms.length === 0) {
		return [];
	}
	const needed = Math.max(0, context.candidateLimit - existingCount);
	if (needed === 0) {
		return [];
	}
	const scanLimit = Math.min(
		BROAD_FALLBACK_SCAN_LIMIT,
		Math.max(needed * 4, needed),
	);
	const documents = collectBroadFallbackDocuments(
		repositories,
		context,
		scanLimit,
	);
	const scored = documents
		.map((document) => ({
			document,
			score: broadDocumentScore(document, repositories.summaries, terms),
		}))
		.filter((item) => item.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score || a.document.path.localeCompare(b.document.path),
		)
		.slice(0, needed);
	const candidates: RetrievalCandidate[] = [];
	for (const { document, score } of scored) {
		candidates.push(
			documentCandidate(
				document,
				"summary",
				Number((0.36 + Math.min(score, 6) * 0.06).toFixed(3)),
				["Matched broad fallback over document metadata and summaries."],
				context.countTokens,
			),
		);
		candidates.push(
			...documentSummaries(repositories.summaries, document, 0.34),
		);
	}
	return candidates;
}

function collectBroadFallbackDocuments(
	repositories: RetrievalRepositories,
	context: GatherContext,
	scanLimit: number,
): DocumentRecord[] {
	if (context.repoId !== undefined) {
		return repositories.docs.listByRepo(context.repoId, { limit: scanLimit });
	}

	// Prefer repos already suggested by scope inference, then fill from the
	// registry. Never scan every document across every configured repo.
	const preferredRepoIds: string[] = [];
	const seen = new Set<string>();
	for (const scope of context.scopes) {
		if (!seen.has(scope.repoId)) {
			seen.add(scope.repoId);
			preferredRepoIds.push(scope.repoId);
		}
		if (preferredRepoIds.length >= BROAD_FALLBACK_REPO_LIMIT) {
			break;
		}
	}
	if (preferredRepoIds.length < BROAD_FALLBACK_REPO_LIMIT) {
		for (const repo of repositories.repos.list()) {
			if (!seen.has(repo.repoId)) {
				seen.add(repo.repoId);
				preferredRepoIds.push(repo.repoId);
			}
			if (preferredRepoIds.length >= BROAD_FALLBACK_REPO_LIMIT) {
				break;
			}
		}
	}

	const perRepo = Math.max(
		1,
		Math.ceil(scanLimit / Math.max(preferredRepoIds.length, 1)),
	);
	const documents: DocumentRecord[] = [];
	for (const repoId of preferredRepoIds) {
		for (const document of repositories.docs.listByRepo(repoId, {
			limit: perRepo,
		})) {
			documents.push(document);
			if (documents.length >= scanLimit) {
				return documents;
			}
		}
	}
	return documents;
}

function broadDocumentScore(
	document: DocumentRecord,
	summaryRepo: SummaryRepository,
	terms: readonly string[],
): number {
	const metadataText = [
		(document.title ?? "").repeat(3),
		document.path.repeat(2),
		document.description ?? "",
		document.tags.join(" ").repeat(2),
	]
		.join("\n")
		.toLowerCase();
	const metadataScore = terms.reduce(
		(score, term) => score + (metadataText.includes(term) ? 1 : 0),
		0,
	);
	// Skip summary loads when title/path/tags already match enough terms.
	if (metadataScore >= Math.min(2, terms.length)) {
		return metadataScore;
	}
	const summaries = summaryRepo.listForTarget("document", document.docId);
	const summaryText = summaries
		.map((summary) => summary.text)
		.join(" ")
		.toLowerCase();
	const summaryScore = terms.reduce(
		(score, term) => score + (summaryText.includes(term) ? 1 : 0),
		0,
	);
	return metadataScore + summaryScore;
}

function candidateFromLexicalHit(input: {
	readonly repositories: RetrievalRepositories;
	readonly docRepo: DocRepository;
	readonly hit: LexicalSearchHit;
	readonly score: number;
	readonly countTokens: (text: string) => number;
}):
	| {
			candidate: RetrievalCandidate;
			document: DocumentRecord;
	  }
	| undefined {
	const document = input.docRepo.get(input.hit.docId);
	if (document === undefined) {
		return undefined;
	}
	const baseScore = input.score;
	if (input.hit.entityType === "chunk" && input.hit.chunkId !== undefined) {
		const chunk = input.repositories.chunks.getById(input.hit.chunkId);
		return chunk === undefined
			? undefined
			: {
					candidate: chunkCandidate(document, chunk, baseScore),
					document,
				};
	}
	if (input.hit.entityType === "section" && input.hit.sectionId !== undefined) {
		const section = input.repositories.sections.getById(input.hit.sectionId);
		return section === undefined
			? undefined
			: {
					candidate: sectionCandidate(
						document,
						section,
						baseScore,
						input.countTokens,
					),
					document,
				};
	}
	return {
		candidate: documentCandidate(
			document,
			"lexical",
			baseScore,
			["Matched document full-text index."],
			input.countTokens,
		),
		document,
	};
}

function documentSummaries(
	summaryRepo: SummaryRepository,
	document: DocumentRecord,
	score: number,
): RetrievalCandidate[] {
	return summaryRepo
		.listForTarget("document", document.docId)
		.map((summary) => summaryCandidate(document, summary, score));
}

function documentsForScope(
	db: StoreDatabase,
	scope: ScopeCandidate,
	filters?: PlanContextInput["filters"],
): DocumentRecord[] {
	return scopeSearch(db, {
		repoId: scope.repoId,
		filters,
		...(scope.packageId === undefined ? {} : { packageId: scope.packageId }),
		...(scope.moduleId === undefined ? {} : { moduleId: scope.moduleId }),
		...(scope.skillId === undefined ? {} : { skillId: scope.skillId }),
		limit: 20,
	});
}

function summaryCandidate(
	document: DocumentRecord,
	summary: SummaryRecord,
	score: number,
): RetrievalCandidate {
	return {
		targetType: "summary",
		targetId: summary.summaryId,
		provenance: provenanceFromDocument(document),
		kind: document.kind,
		authority: document.authority,
		score,
		tokenCount: summary.tokenCount,
		textPreview: summary.text,
		source: "summary",
		rationale: [
			`Selected ${summary.level} summary for ${summary.targetType}:${summary.targetId}.`,
		],
	};
}

function documentCandidate(
	document: DocumentRecord,
	source: RetrievalCandidate["source"],
	score: number,
	rationale: string[],
	countTokens: (text: string) => number,
): RetrievalCandidate {
	const preview = [document.title, document.path, document.tags.join(" ")]
		.filter(Boolean)
		.join("\n");
	return {
		targetType: "document",
		targetId: document.docId,
		provenance: provenanceFromDocument(document),
		kind: document.kind,
		authority: document.authority,
		score,
		tokenCount: countTokens(preview),
		textPreview: preview,
		source,
		rationale,
	};
}

function sectionCandidate(
	document: DocumentRecord,
	section: SectionRecord,
	score: number,
	countTokens: (text: string) => number,
): RetrievalCandidate {
	const text = sectionText(section);
	return {
		targetType: "section",
		targetId: section.sectionId,
		provenance: provenanceFromDocument(document, section.headingPath),
		kind: document.kind,
		authority: document.authority,
		score,
		tokenCount: countTokens(text),
		textPreview: text,
		source: "lexical",
		rationale: [`Matched section ${section.headingPath.join(" > ")}.`],
	};
}

function chunkCandidate(
	document: DocumentRecord,
	chunk: ChunkRecord,
	score: number,
): RetrievalCandidate {
	return {
		targetType: "chunk",
		targetId: chunk.chunkId,
		provenance: provenanceFromDocument(document, chunk.headingPath),
		kind: chunk.kind,
		authority: chunk.authority,
		score,
		tokenCount: chunk.tokenCount,
		textPreview: chunk.text,
		source: "lexical",
		rationale: [`Matched chunk ${chunk.chunkId}.`],
	};
}

function skillCandidate(
	docRepo: DocRepository,
	skill: SkillRecord,
	score: number,
	countTokens: (text: string) => number,
): RetrievalCandidate {
	const document = docRepo.get(skill.sourceDocId);
	const text = [skill.title, skill.description, ...skill.keySections]
		.filter(Boolean)
		.join("\n");
	return {
		targetType: "skill",
		targetId: skill.skillId,
		provenance:
			document === undefined
				? {
						repoId: skill.repoId,
						...(skill.packageId === undefined
							? {}
							: { packageId: skill.packageId }),
						...(skill.moduleId === undefined
							? {}
							: { moduleId: skill.moduleId }),
						skillId: skill.skillId,
						docId: skill.sourceDocId,
						path: skill.sourceDocPath,
						sourceVersion: "unknown",
						authority: "preferred",
					}
				: provenanceFromDocument(document, undefined, skill.skillId),
		kind: "skill-doc",
		authority: document?.authority ?? "preferred",
		score,
		tokenCount: countTokens(text),
		textPreview: text,
		source: "skill",
		rationale: [`Matched skill ${skill.title ?? skill.skillId}.`],
	};
}

function provenanceFromDocument(
	document: DocumentRecord,
	headingPath?: readonly string[],
	skillId?: string,
): Provenance {
	const effectiveSkillId = skillId ?? document.skillId;
	return {
		repoId: document.repoId,
		...(document.packageId === undefined
			? {}
			: { packageId: document.packageId }),
		...(document.moduleId === undefined ? {} : { moduleId: document.moduleId }),
		...(effectiveSkillId === undefined ? {} : { skillId: effectiveSkillId }),
		docId: document.docId,
		path: document.path,
		...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
		sourceVersion: document.sourceVersion,
		authority: document.authority,
	};
}

function sectionText(section: CanonicalSection): string {
	const code = section.codeBlocks
		.map((block) => `\`\`\`${block.lang ?? ""}\n${block.code}\n\`\`\``)
		.join("\n\n");
	return [section.headingPath.join(" > "), section.text, code]
		.filter((part) => part.trim().length > 0)
		.join("\n\n");
}

function normalizedLexicalScores(
	hits: readonly LexicalSearchHit[],
): ReadonlyMap<string, number> {
	const scores = new Map<string, number>();
	if (hits.length === 0) {
		return scores;
	}
	if (hits.length === 1) {
		scores.set(lexicalHitKey(hits[0]!), 1);
		return scores;
	}
	const bestRank = hits[0]?.rank ?? 0;
	const worstRank = hits.at(-1)?.rank ?? bestRank;
	const rankSpan = Math.abs(worstRank - bestRank);
	const denominator = Math.max(1, hits.length - 1);
	for (const [index, hit] of hits.entries()) {
		const positional = 1 - (index / denominator) * 0.65;
		const rankBased =
			rankSpan <= Number.EPSILON
				? positional
				: 1 - (Math.abs(hit.rank - bestRank) / rankSpan) * 0.65;
		const score = Math.max(0.25, Math.min(1, (positional + rankBased) / 2));
		scores.set(lexicalHitKey(hit), Number(score.toFixed(3)));
	}
	return scores;
}

function lexicalHitKey(hit: LexicalSearchHit): string {
	return `${hit.entityType}:${hit.entityId}`;
}

function toLexicalQuery(query: string): string {
	return queryTerms(query).slice(0, 12).join(" ");
}

function queryTerms(query: string): string[] {
	return query
		.replace(/[`"'()[\]{}:*^~+-]/g, " ")
		.split(/[^a-z0-9_]+/i)
		.map((term) => term.toLowerCase())
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

function pathSignals(
	query: string,
	expandedQuery: string,
): Array<{ path: string; expanded: boolean }> {
	const signals = new Map<string, { path: string; expanded: boolean }>();
	for (const path of extractPathSignals(query)) {
		signals.set(normalizePathSignal(path), { path, expanded: false });
	}
	for (const path of extractPathSignals(expandedQuery)) {
		const key = normalizePathSignal(path);
		if (!signals.has(key)) {
			signals.set(key, { path, expanded: true });
		}
	}
	return [...signals.values()];
}

function extractPathSignals(query: string): string[] {
	return [
		...query.matchAll(/`([^`]+\.[a-z0-9]+|[^`]+\/[^`]+)`/gi),
		...query.matchAll(/\b[\w@.-]+\/[\w./-]+\b/gi),
		...query.matchAll(/\b[\w.-]+\.(?:md|mdx|ts|tsx|js|jsx|json|yml|yaml)\b/gi),
	]
		.map((match) => (match[1] ?? match[0]).trim())
		.filter((value) => value.length > 0);
}

function normalizePathSignal(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
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
			candidate.source === "path" ||
			(existing.source !== "path" &&
				(candidate.score ?? 0) > (existing.score ?? 0))
		) {
			byKey.set(key, candidate);
		}
	}
	return [...byKey.values()];
}

function countBy<T>(
	values: readonly T[],
	select: (value: T) => string,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) {
		const key = select(value);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

function validatePlanInput(input: PlanContextInput): void {
	if (input.query.trim().length === 0) {
		throw new RetrievalConfigurationError(
			"Context planning requires a non-empty query.",
			{
				operation: "planContext",
				entity: "query",
			},
		);
	}
	if (!Number.isInteger(input.budgetTokens) || input.budgetTokens <= 0) {
		throw new RetrievalConfigurationError(
			"Context planning requires a positive integer token budget.",
			{
				operation: "planContext",
				entity: "budget",
			},
		);
	}
}
