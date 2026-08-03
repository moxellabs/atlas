import { computeFreshness } from "@atlas/core";
import { createTextEncoder } from "@atlas/tokenizer";

import { classifyQuery } from "../classify/classify-query";
import { RetrievalConfigurationError } from "../errors";
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
	RetrievalDiagnostic,
  RetrievalStore,
	ScopeContext,
} from "../types";
import { expandSections } from "./expand-sections";
import { finalizeContext } from "./finalize-context";
import { selectSummaries } from "./select-summaries";
import { gatherCandidates } from "./gather-candidates";

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
    store: input.store,
		query: input.query,
		classification,
		...(input.repoId === undefined ? {} : { repoId: input.repoId }),
		limit: 10,
	});
	diagnostics.push(...scopeResult.diagnostics);

	const expandedQuery = expandQuery(input.query);
  const candidates = gatherCandidates(input.store, {
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
    freshnessByRepo: freshnessScores(input.store),
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
  return enrichPlannedContext(input.store, planned);
}

function enrichPlannedContext(
  store: RetrievalStore,
	planned: PlannedContext,
): PlannedContext {
  const selected = planned.selected.map((item) =>
    enrichPlannedItem(store, item),
  );
  const omitted = planned.omitted.map((item) => enrichPlannedItem(store, item));
	return {
		...planned,
		selected,
		omitted,
		contextPacket: buildContextPacket({ ...planned, selected, omitted }),
	};
}

function enrichPlannedItem(
  store: RetrievalStore,
  item: PlannedItem,
): PlannedItem {
  return { ...item, scopeContext: scopeContextForItem(store, item) };
}

function scopeContextForItem(
  store: RetrievalStore,
	item: PlannedItem,
): ScopeContext {
	const repoLabel = item.provenance.repoId;
	const packageRecord =
		item.provenance.packageId === undefined
			? undefined
      : store.getPackage(item.provenance.packageId);
	const moduleRecord =
		item.provenance.moduleId === undefined
			? undefined
      : store.getModule(item.provenance.moduleId);
	const skillRecord =
		item.provenance.skillId === undefined
			? undefined
      : store.getSkill(item.provenance.skillId);
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

function freshnessScores(store: RetrievalStore): ReadonlyMap<string, number> {
	return new Map(
    store.listRepos().map((repo) => {
      const manifest = store.getManifest(repo.repoId);
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
