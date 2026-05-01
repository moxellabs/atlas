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
	ScopeCandidate,
	ScopeContext,
} from "../types";
import { expandSections } from "./expand-sections";
import { finalizeContext } from "./finalize-context";
import { selectSummaries } from "./select-summaries";

const DEFAULT_CANDIDATE_LIMIT = 40;

/** Builds a staged, scope-aware, token-budgeted context plan over persisted ATLAS artifacts. */
export function planContext(input: PlanContextInput): PlannedContext {
	validatePlanInput(input);
	const encoder = input.encoder ?? createTextEncoder();
	const diagnostics: RetrievalDiagnostic[] = [];
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

	const candidates = gatherCandidates(input.db, {
		query: input.query,
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
		classification,
		candidates,
		scopes: scopeResult.scopes,
		freshnessByRepo: freshnessScores(input.db),
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

function freshnessScores(db: StoreDatabase): ReadonlyMap<string, number> {
	const manifests = new ManifestRepository(db);
	return new Map(
		new RepoRepository(db).list().map((repo) => {
			const manifest = manifests.get(repo.repoId);
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

interface GatherContext {
	readonly query: string;
	readonly repoId?: string | undefined;
	readonly scopes: readonly ScopeCandidate[];
	readonly candidateLimit: number;
	readonly countTokens: (text: string) => number;
	readonly filters?: PlanContextInput["filters"];
}

function gatherCandidates(
	db: StoreDatabase,
	context: GatherContext,
): RetrievalCandidate[] {
	try {
		const docRepo = new DocRepository(db);
		const summaryRepo = new SummaryRepository(db);
		const candidates: RetrievalCandidate[] = [];
		const lexicalQuery = toLexicalQuery(context.query);

		if (lexicalQuery.length > 0) {
			for (const hit of lexicalSearch(db, {
				query: lexicalQuery,
				repoId: context.repoId,
				limit: context.candidateLimit,
				filters: context.filters,
			})) {
				const candidate = candidateFromLexicalHit({
					db,
					docRepo,
					hit,
					countTokens: context.countTokens,
				});
				if (candidate !== undefined) {
					candidates.push(candidate);
					candidates.push(
						...documentSummaries(
							docRepo,
							summaryRepo,
							candidate.provenance.docId,
							candidate.score ?? 0.4,
						),
					);
				}
			}
		}

		for (const path of extractPathSignals(context.query)) {
			for (const document of pathSearch(db, {
				path,
				mode: path.includes("/") ? "contains" : "prefix",
				repoId: context.repoId,
				limit: 12,
				filters: context.filters,
			})) {
				candidates.push(
					documentCandidate(
						document,
						"path",
						1,
						[`Matched path signal ${path}.`],
						context.countTokens,
					),
				);
				candidates.push(
					...documentSummaries(docRepo, summaryRepo, document.docId, 0.88),
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
					...documentSummaries(
						docRepo,
						summaryRepo,
						document.docId,
						0.68 * scope.score,
					),
				);
			}
			if (scope.level === "skill" && scope.skillId !== undefined) {
				const skill = new SkillRepository(db).get(scope.skillId);
				if (skill !== undefined) {
					candidates.push(
						skillCandidate(
							docRepo,
							skill,
							0.85 * scope.score,
							context.countTokens,
						),
					);
					candidates.push(
						...documentSummaries(
							docRepo,
							summaryRepo,
							skill.sourceDocId,
							0.7 * scope.score,
						),
					);
				}
			}
		}

		const deduped = dedupeCandidates(candidates);
		if (deduped.length < Math.min(context.candidateLimit, 3)) {
			return dedupeCandidates([
				...deduped,
				...broadFallbackCandidates(db, docRepo, summaryRepo, context, deduped.length),
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
	db: StoreDatabase,
	docRepo: DocRepository,
	summaryRepo: SummaryRepository,
	context: GatherContext,
	existingCount: number,
): RetrievalCandidate[] {
	const terms = queryTerms(context.query);
	if (terms.length === 0) {
		return [];
	}
	const documents = context.repoId === undefined
		? new RepoRepository(db).list().flatMap((repo) => docRepo.listByRepo(repo.repoId))
		: docRepo.listByRepo(context.repoId);
	const scored = documents
		.map((document) => ({
			document,
			score: broadDocumentScore(document, summaryRepo, terms),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path))
		.slice(0, Math.max(0, context.candidateLimit - existingCount));
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
		candidates.push(...documentSummaries(docRepo, summaryRepo, document.docId, 0.34));
	}
	return candidates;
}

function broadDocumentScore(
	document: DocumentRecord,
	summaryRepo: SummaryRepository,
	terms: readonly string[],
): number {
	const summaries = summaryRepo.listForTarget("document", document.docId);
	const weightedText = [
		(document.title ?? "").repeat(3),
		document.path.repeat(2),
		document.description ?? "",
		document.tags.join(" ").repeat(2),
		summaries.map((summary) => summary.text).join(" "),
	]
		.join("\n")
		.toLowerCase();
	return terms.reduce(
		(score, term) => score + (weightedText.includes(term) ? 1 : 0),
		0,
	);
}

function candidateFromLexicalHit(input: {
	readonly db: StoreDatabase;
	readonly docRepo: DocRepository;
	readonly hit: LexicalSearchHit;
	readonly countTokens: (text: string) => number;
}): RetrievalCandidate | undefined {
	const document = input.docRepo.get(input.hit.docId);
	if (document === undefined) {
		return undefined;
	}
	const baseScore = lexicalRankToScore(input.hit.rank);
	if (input.hit.entityType === "chunk" && input.hit.chunkId !== undefined) {
		const chunk = new ChunkRepository(input.db)
			.listByDocument(input.hit.docId)
			.find((record) => record.chunkId === input.hit.chunkId);
		return chunk === undefined
			? undefined
			: chunkCandidate(document, chunk, baseScore);
	}
	if (input.hit.entityType === "section" && input.hit.sectionId !== undefined) {
		const section = new SectionRepository(input.db)
			.listByDocument(input.hit.docId)
			.find((record) => record.sectionId === input.hit.sectionId);
		return section === undefined
			? undefined
			: sectionCandidate(document, section, baseScore, input.countTokens);
	}
	return documentCandidate(
		document,
		"lexical",
		baseScore,
		["Matched document full-text index."],
		input.countTokens,
	);
}

function documentSummaries(
	docRepo: DocRepository,
	summaryRepo: SummaryRepository,
	docId: string,
	score: number,
): RetrievalCandidate[] {
	const document = docRepo.get(docId);
	if (document === undefined) {
		return [];
	}
	return summaryRepo
		.listForTarget("document", docId)
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

function lexicalRankToScore(rank: number): number {
	return Number((1 / (1 + Math.abs(rank))).toFixed(3));
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

function extractPathSignals(query: string): string[] {
	return [
		...query.matchAll(/`([^`]+\.[a-z0-9]+|[^`]+\/[^`]+)`/gi),
		...query.matchAll(/\b[\w@.-]+\/[\w./-]+\b/gi),
		...query.matchAll(/\b[\w.-]+\.(?:md|mdx|ts|tsx|js|jsx|json|yml|yaml)\b/gi),
	]
		.map((match) => (match[1] ?? match[0]).trim())
		.filter((value) => value.length > 0);
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
			(candidate.score ?? 0) > (existing.score ?? 0) ||
			((candidate.score ?? 0) === (existing.score ?? 0) &&
				candidate.source === "path")
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
