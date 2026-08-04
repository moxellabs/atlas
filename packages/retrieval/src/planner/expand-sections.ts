import type { QueryKind } from "@atlas/core";

import type { PlanningSelectionState, RankedHit } from "../types";
import {
	appendIfBudgetAllows,
	needsConcreteEvidence,
	toPlannedItem,
} from "./select-summaries";

const MAX_DETAIL_ITEMS_PER_DOCUMENT = 2;

/** Input for detail expansion after summary-first planning. */
export interface ExpandSectionsInput {
	/** Ranked hits available for expansion. */
	rankedHits: readonly RankedHit[];
	/** Query kind used to decide whether deeper evidence is necessary. */
	queryKind: QueryKind;
	/** Raw query text, used to force detail expansion for concrete tokens. */
	query?: string | undefined;
	/** Current planning state. */
	state: PlanningSelectionState;
	/** Maximum expansion items to add. Defaults to 6. */
	limit?: number | undefined;
}

/** Adds section/chunk/detail hits under the remaining budget while avoiding duplicate evidence. */
export function expandSections(
	input: ExpandSectionsInput,
): PlanningSelectionState {
	const state = cloneState(input.state);
	const limit = input.limit ?? defaultExpansionLimit(input.queryKind);
	const needsDetail = shouldExpand(input.queryKind, state, input.query);
	if (!needsDetail) {
		for (const hit of input.rankedHits.filter(
			(candidate) => candidate.targetType !== "summary",
		)) {
			state.omitted.push(
				toPlannedItem(
					hit,
					"Summary-first policy did not require deeper expansion.",
				),
			);
		}
		return state;
	}

	let added = 0;
	const selectedDetailCounts = new Map<string, number>();
	const seenEvidence = new Set<string>();
	for (const item of state.selected) {
		if (item.targetType === "summary") {
			continue;
		}
		const docId = item.provenance.docId;
		selectedDetailCounts.set(docId, (selectedDetailCounts.get(docId) ?? 0) + 1);
		seenEvidence.add(evidenceKey(item));
	}
	for (const hit of orderExpansionHits(
		input.rankedHits,
		input.queryKind,
		input.query,
	)) {
    if (!isExpansionTarget(hit)) {
			continue;
		}
    if (hit.factors.qualityAdjustment < 0) {
      state.omitted.push(
        toPlannedItem(hit, "Omitted by low-signal path quality policy."),
      );
      continue;
    }
    if (added >= limit) {
      state.omitted.push(toPlannedItem(hit, "Expansion limit reached."));
			continue;
		}
		const key = evidenceKey(hit);
		if (seenEvidence.has(key)) {
			state.omitted.push(
				toPlannedItem(
					hit,
					"Skipped redundant expansion for an already selected evidence heading.",
				),
			);
			continue;
		}
		const docId = hit.provenance.docId;
		if (
			(selectedDetailCounts.get(docId) ?? 0) >=
			MAX_DETAIL_ITEMS_PER_DOCUMENT
		) {
			state.omitted.push(
				toPlannedItem(
					hit,
					"Skipped redundant expansion after selecting two distinct passages from the document.",
				),
			);
			continue;
		}
		if (appendIfBudgetAllows(state, hit, "Selected during detail expansion.")) {
			seenEvidence.add(key);
			selectedDetailCounts.set(
				docId,
				(selectedDetailCounts.get(docId) ?? 0) + 1,
			);
			added += 1;
		}
	}

	return state;
}

function shouldExpand(
	queryKind: QueryKind,
	state: PlanningSelectionState,
	query: string | undefined,
): boolean {
	if (needsConcreteEvidence(query)) {
		return true;
	}
	if (queryKind === "overview" && state.selected.length > 0) {
		return state.usedTokens <= state.budgetTokens * 0.82;
	}
	return true;
}

function isExpansionTarget(hit: RankedHit): boolean {
	return (
		hit.targetType === "section" ||
		hit.targetType === "chunk" ||
		hit.targetType === "document" ||
		hit.targetType === "skill"
	);
}

function defaultExpansionLimit(queryKind: QueryKind): number {
	if (queryKind === "exact-lookup" || queryKind === "location") {
		return 3;
	}
	if (
		queryKind === "usage" ||
		queryKind === "troubleshooting" ||
		queryKind === "skill-invocation"
	) {
		return 6;
	}
	return 4;
}

function orderExpansionHits(
	hits: readonly RankedHit[],
	queryKind: QueryKind,
	query: string | undefined,
): RankedHit[] {
	return [...hits].sort((left, right) => {
		const priorityDelta =
			expansionPriority(right, queryKind, query) -
			expansionPriority(left, queryKind, query);
		return (
			priorityDelta ||
			right.score - left.score ||
			left.targetId.localeCompare(right.targetId)
		);
	});
}

function expansionPriority(
	hit: RankedHit,
	queryKind: QueryKind,
	query: string | undefined,
): number {
	const targetType = hit.targetType;
	if (queryKind === "usage" || queryKind === "troubleshooting") {
		return usageExpansionPriority(targetType);
	}
	if (queryKind === "skill-invocation") {
		return skillExpansionPriority(targetType);
	}
	if (queryKind === "exact-lookup" && isNaturalLanguageQuery(query)) {
		return naturalLanguageLookupPriority(targetType);
	}
	if (queryKind === "exact-lookup" || queryKind === "location") {
		return lookupExpansionPriority(hit);
	}
	return defaultTargetExpansionPriority(targetType);
}

function usageExpansionPriority(targetType: RankedHit["targetType"]): number {
	return targetTypePriority(targetType, {
		section: 5,
		chunk: 5,
		skill: 4,
		document: 2,
		fallback: 1,
	});
}

function skillExpansionPriority(targetType: RankedHit["targetType"]): number {
	return targetTypePriority(targetType, {
		skill: 5,
		section: 4,
		chunk: 4,
		fallback: 2,
	});
}

function naturalLanguageLookupPriority(
	targetType: RankedHit["targetType"],
): number {
	return targetTypePriority(targetType, {
		section: 5,
		chunk: 5,
		skill: 4,
		document: 3,
		fallback: 1,
	});
}

function lookupExpansionPriority(hit: RankedHit): number {
	if (hit.source === "path") {
		return 5;
	}
	return targetTypePriority(hit.targetType, {
		document: 4,
		section: 3,
		chunk: 3,
		fallback: 1,
	});
}

function defaultTargetExpansionPriority(
	targetType: RankedHit["targetType"],
): number {
	return targetTypePriority(targetType, {
		section: 5,
		chunk: 5,
		document: 3,
		skill: 2,
		fallback: 1,
	});
}

function targetTypePriority(
	targetType: RankedHit["targetType"],
	weights: Partial<Record<RankedHit["targetType"], number>> & {
		fallback: number;
	},
): number {
	return weights[targetType] ?? weights.fallback;
}

function isNaturalLanguageQuery(query: string | undefined): boolean {
	return query !== undefined && query.trim().split(/\s+/).length > 1;
}

function evidenceKey(
	item: Pick<RankedHit, "targetType" | "targetId" | "provenance">,
): string {
	const headingPath = item.provenance.headingPath;
	if (headingPath !== undefined && headingPath.length > 0) {
		return `${item.provenance.docId}:heading:${headingPath
			.map((heading) => heading.trim().toLowerCase())
			.join("\u001f")}`;
	}
	return `${item.provenance.docId}:${item.targetType}:${item.targetId}`;
}

function cloneState(state: PlanningSelectionState): PlanningSelectionState {
	return {
		budgetTokens: state.budgetTokens,
		usedTokens: state.usedTokens,
		selected: [...state.selected],
		omitted: [...state.omitted],
		warnings: [...state.warnings],
	};
}
