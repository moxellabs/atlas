import type {
	AmbiguityResult,
	ContextOmissionDiagnostic,
	ContextOmissionReason,
	PlannedContext,
	PlanningSelectionState,
	QueryClassification,
	RankedHit,
	RetrievalDiagnostic,
	ScopeCandidate,
} from "../types";

/** Input used to assemble the immutable planned context result. */
export interface FinalizeContextInput {
	/** Original query text. */
	query: string;
	/** Classification result. */
	classification: QueryClassification;
	/** Inferred scopes. */
	scopes: readonly ScopeCandidate[];
	/** Final planning selection state. */
	state: PlanningSelectionState;
	/** Ranked hits considered by planning. */
	rankedHits: readonly RankedHit[];
	/** Structured diagnostics accumulated across stages. */
	diagnostics: readonly RetrievalDiagnostic[];
	/** Optional ambiguity result. */
	ambiguity?: AmbiguityResult | undefined;
}

/** Assembles the final planned context with confidence, warnings, omissions, and diagnostics. */
export function finalizeContext(input: FinalizeContextInput): PlannedContext {
	const warnings = collectWarnings(input);
	const confidence = computeConfidence(input, warnings);
	const omissionDiagnostics = input.state.omitted.map(toOmissionDiagnostic);
	return {
		query: input.query,
		classification: input.classification,
		scopes: [...input.scopes],
		budgetTokens: input.state.budgetTokens,
		usedTokens: input.state.usedTokens,
		selected: [...input.state.selected],
		omitted: [...input.state.omitted],
		omissionDiagnostics,
		confidence,
		warnings,
		...(input.ambiguity === undefined ? {} : { ambiguity: input.ambiguity }),
		rankedHits: [...input.rankedHits],
		contextPacket: {
			query: input.query,
			budgetTokens: input.state.budgetTokens,
			usedTokens: input.state.usedTokens,
			confidence,
			scopes: [...input.scopes],
			evidence: [],
			warnings,
			omitted: [],
			omissionDiagnostics,
			recommendedNextActions: [],
		},
		diagnostics: [
			...input.diagnostics,
			{
				stage: "planning",
				message: `Final context uses ${input.state.usedTokens}/${input.state.budgetTokens} tokens.`,
				metadata: {
					selectedCount: input.state.selected.length,
					omittedCount: input.state.omitted.length,
					confidence,
				},
			},
		],
	};
}

function toOmissionDiagnostic(
	item: PlanningSelectionState["omitted"][number],
): ContextOmissionDiagnostic {
	const reason = omissionReason(item.rationale);
	return {
		reason,
		targetType: item.targetType,
		targetId: item.targetId,
		docId: item.provenance.docId,
		path: item.provenance.path,
		explanation: item.rationale.at(-1) ?? "Omitted by context planner.",
	};
}

function omissionReason(rationale: readonly string[]): ContextOmissionReason {
	const text = rationale.join(" ").toLowerCase();
	if (text.includes("budget")) {
		return "budget";
	}
	if (text.includes("stale") || text.includes("freshness")) {
		return "freshness";
	}
	if (text.includes("archive") || text.includes("historical")) {
		return "archive";
	}
	if (text.includes("redundant") || text.includes("duplicate")) {
		return "redundancy";
	}
	if (
		text.includes("authority") ||
		text.includes("canonical") ||
		text.includes("supplemental")
	) {
		return "authority";
	}
	return "budget";
}

function computeConfidence(
	input: FinalizeContextInput,
	warnings: readonly string[],
): PlannedContext["confidence"] {
	if (
		input.ambiguity !== undefined ||
		input.state.selected.length === 0 ||
		warnings.length >= 2
	) {
		return "low";
	}
	if (
		input.classification.confidence === "low" &&
		input.scopes.length === 0 &&
		input.rankedHits.every((hit) => hit.source !== "path")
	) {
		return "low";
	}
	if (
		input.classification.confidence === "high" &&
		input.rankedHits[0] !== undefined &&
		input.rankedHits[0].score >= 1.65
	) {
		return "high";
	}
	return "medium";
}

function collectWarnings(input: FinalizeContextInput): string[] {
	const warnings = [...input.state.warnings];
	if (input.rankedHits.length === 0) {
		warnings.push("No retrieval candidates were available.");
	}
	if (input.state.selected.length === 0) {
		warnings.push("No context items fit the requested budget.");
	}
	if (input.ambiguity !== undefined) {
		warnings.push(input.ambiguity.reason);
	}
	return [...new Set(warnings)];
}
