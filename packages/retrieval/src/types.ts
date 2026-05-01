import type {
	Authority,
	DiagnosticConfidence,
	DocKind,
	DocumentMetadataFilters,
	Provenance,
	QueryKind,
} from "@atlas/core";
import type { StoreDatabase } from "@atlas/store";
import type { TextEncoder } from "@atlas/tokenizer";

/** Retrieval target kinds that can be ranked and placed into planned context. */
export type RetrievalTargetType =
	| "summary"
	| "document"
	| "section"
	| "chunk"
	| "skill";

/** Scope levels understood by query scope inference. */
export type RetrievalScopeLevel = "repo" | "package" | "module" | "skill";

/** Stable diagnostic event emitted by retrieval stages. */
export interface RetrievalDiagnostic {
	/** Stage that produced the diagnostic. */
	stage:
		| "classification"
		| "scope-inference"
		| "candidate-generation"
		| "ranking"
		| "planning"
		| "ambiguity";
	/** Human-readable diagnostic message. */
	message: string;
	/** Optional machine-readable metadata for inspect tools. */
	metadata?: Record<string, unknown> | undefined;
}

/** Deterministic query classification result. */
export interface QueryClassification {
	/** Original user query. */
	query: string;
	/** Classified retrieval intent. */
	kind: QueryKind;
	/** Coarse confidence in the classification. */
	confidence: DiagnosticConfidence;
	/** Normalized score in the range 0..1. */
	score: number;
	/** Deterministic reasons that explain the selected kind. */
	rationale: string[];
	/** Query signal labels observed by the classifier. */
	signals: string[];
}

/** Candidate scope inferred from query text and persisted topology metadata. */
export interface ScopeCandidate {
	/** Scope granularity. */
	level: RetrievalScopeLevel;
	/** Stable scope identifier. */
	id: string;
	/** Human-readable scope label. */
	label: string;
	/** Repository that owns this scope. */
	repoId: string;
	/** Package identifier for package/module/skill scopes. */
	packageId?: string | undefined;
	/** Module identifier for module/skill scopes. */
	moduleId?: string | undefined;
	/** Skill identifier for skill scopes. */
	skillId?: string | undefined;
	/** Normalized confidence score in the range 0..1. */
	score: number;
	/** Deterministic scope inference reasons. */
	rationale: string[];
}

/** Scope inference result with diagnostics. */
export interface ScopeInferenceResult {
	/** Query text used for inference. */
	query: string;
	/** Scored scope candidates in descending relevance order. */
	scopes: ScopeCandidate[];
	/** Diagnostic events useful for inspect/eval flows. */
	diagnostics: RetrievalDiagnostic[];
}

/** Raw candidate before final ranking. */
export interface RetrievalCandidate {
	/** Artifact type represented by this candidate. */
	targetType: RetrievalTargetType;
	/** Stable target identifier. */
	targetId: string;
	/** Exact source provenance for the target. */
	provenance: Provenance;
	/** Documentation kind, when known. */
	kind?: DocKind | undefined;
	/** Authority copied from provenance for simpler scoring. */
	authority: Authority;
	/** Optional substrate score. Higher is better. */
	score?: number | undefined;
	/** Token cost when known. */
	tokenCount?: number | undefined;
	/** Compact candidate text used for rationale and redundancy checks. */
	textPreview?: string | undefined;
	/** Search/planning source that produced the candidate. */
	source?:
		| "lexical"
		| "path"
		| "scope"
		| "summary"
		| "skill"
		| "manual"
		| undefined;
	/** Existing rationale inherited from candidate generation. */
	rationale?: string[] | undefined;
}

/** Individual score contributions retained for explainability. */
export interface RankingFactors {
	/** Score supplied by store search or candidate generation. */
	lexicalScore: number;
	/** Authority contribution. */
	authority: number;
	/** Scope/locality contribution. */
	locality: number;
	/** Query-kind-specific contribution. */
	queryKind: number;
	/** Low-token-cost contribution. */
	tokenEfficiency: number;
	/** Freshness contribution for the owning repository. */
	freshness: number;
	/** Exact path, heading, or canonical-doc evidence contribution. */
	evidenceMatch: number;
	/** Redundancy subtraction. */
	redundancyPenalty: number;
}

/** Ranked retrieval hit with deterministic rationale. */
export interface RankedHit extends RetrievalCandidate {
	/** Final composed score. */
	score: number;
	/** Non-empty rationale explaining score contributions. */
	rationale: string[];
	/** Numeric score contributions used to derive the final score. */
	factors: RankingFactors;
}

/** Item selected for final context. */
export interface PlannedItem {
	/** Artifact type represented by this item. */
	targetType: RetrievalTargetType;
	/** Stable target identifier. */
	targetId: string;
	/** Token cost charged to the context budget. */
	tokenCount: number;
	/** Exact source provenance for the selected item. */
	provenance: Provenance;
	/** Human-readable scope context for agents; IDs remain in provenance for deterministic follow-up. */
	scopeContext?: ScopeContext | undefined;
	/** Rationale inherited from ranking and planner decisions. */
	rationale: string[];
	/** Optional text payload for consumers that want an immediately usable context packet. */
	text?: string | undefined;
	/** Final ranking score when selected from ranked candidates. */
	score?: number | undefined;
}

/** Human-readable labels and paths for provenance scopes. */
export interface ScopeContext {
	repo: { repoId: string; label: string };
	package?: { packageId: string; name: string; path: string } | undefined;
	module?: { moduleId: string; name: string; path: string } | undefined;
	skill?:
		| { skillId: string; title?: string | undefined; sourceDocPath: string }
		| undefined;
	/** Compact label suitable for MCP agents and human-readable rationale. */
	label: string;
}

/** One evidence entry in an answer-ready context packet. */
export interface ContextPacketEvidence {
	targetType: RetrievalTargetType;
	targetId: string;
	label: string;
	tokenCount: number;
	score?: number | undefined;
	provenance: Provenance;
	scopeContext?: ScopeContext | undefined;
	text?: string | undefined;
	rationale: string[];
}

/** Compact answer-ready packet designed to reduce MCP round trips. */
export type ContextOmissionReason =
	| "budget"
	| "authority"
	| "freshness"
	| "archive"
	| "redundancy";

export interface ContextOmissionDiagnostic {
	reason: ContextOmissionReason;
	targetType: RetrievalTargetType;
	targetId: string;
	docId: string;
	path: string;
	explanation: string;
}

export interface ContextPacket {
	query: string;
	budgetTokens: number;
	usedTokens: number;
	confidence: DiagnosticConfidence;
	scopes: ScopeCandidate[];
	evidence: ContextPacketEvidence[];
	warnings: string[];
	omitted: Array<{
		targetType: RetrievalTargetType;
		targetId: string;
		label: string;
		reason: string;
		reasonCategory?: ContextOmissionReason | undefined;
	}>;
	omissionDiagnostics: ContextOmissionDiagnostic[];
	recommendedNextActions: string[];
}

/** Structured ambiguity output used when retrieval should not pretend confidence is high. */
export interface AmbiguityResult {
	/** Fixed status marker. */
	status: "ambiguous";
	/** Deterministic reason for ambiguity. */
	reason: string;
	/** Alternative hits that explain the ambiguity. */
	candidates: RankedHit[];
	/** Concrete caller actions that can resolve ambiguity. */
	recommendedNextActions: string[];
}

/** Final token-budgeted context plan. */
export interface PlannedContext {
	/** Original query text. */
	query: string;
	/** Classified query metadata. */
	classification: QueryClassification;
	/** Scopes considered most likely for the query. */
	scopes: ScopeCandidate[];
	/** Maximum budget requested by the caller. */
	budgetTokens: number;
	/** Tokens consumed by selected items. */
	usedTokens: number;
	/** Context items selected for the caller/model. */
	selected: PlannedItem[];
	/** High-ranking items omitted because of budget, redundancy, or planning policy. */
	omitted: PlannedItem[];
	/** Overall confidence after ranking and planning. */
	confidence: DiagnosticConfidence;
	/** Non-fatal issues that callers may surface or log. */
	warnings: string[];
	/** Optional ambiguity result when evidence is weak or spread across plausible scopes. */
	ambiguity?: AmbiguityResult | undefined;
	/** Ordered ranked hits considered by the planner. */
	rankedHits: RankedHit[];
	/** Answer-ready packet optimized for MCP agents and fewer follow-up tool calls. */
	contextPacket: ContextPacket;
	/** Structured omission diagnostics for skipped context candidates. */
	omissionDiagnostics: ContextOmissionDiagnostic[];
	/** Structured diagnostics for inspect/eval flows. */
	diagnostics: RetrievalDiagnostic[];
}

/** Store-backed dependencies required by retrieval orchestration. */
export interface RetrievalStore {
	/** Initialized ATLAS store database. */
	db: StoreDatabase;
}

/** Input accepted by end-to-end context planning. */
export interface PlanContextInput extends RetrievalStore {
	/** Raw user query. */
	query: string;
	/** Optional repository constraint. */
	repoId?: string | undefined;
	/** Maximum context budget in tokens. */
	budgetTokens: number;
	/** Optional exact text encoder used when candidate token counts are absent. */
	encoder?: TextEncoder | undefined;
	/** Maximum lexical/path/scope candidates to gather before ranking. */
	candidateLimit?: number | undefined;
	/** Maximum summaries to choose before section expansion. */
	summaryLimit?: number | undefined;
	/** Maximum section/chunk expansions to select. */
	expansionLimit?: number | undefined;
	/** Optional document metadata filters. */
	filters?: DocumentMetadataFilters | undefined;
}

/** Options for ranking raw retrieval candidates. */
export interface RankCandidatesInput {
	/** Raw user query. */
	query: string;
	/** Query classification used for query-kind boosts. */
	classification: QueryClassification;
	/** Raw candidates to rank. */
	candidates: readonly RetrievalCandidate[];
	/** Inferred scope candidates used for locality scoring. */
	scopes?: readonly ScopeCandidate[] | undefined;
	/** Freshness by repository ID. Missing entries are treated as neutral for standalone ranking. */
	freshnessByRepo?: ReadonlyMap<string, number> | undefined;
	/** Maximum ranked hits to return. Defaults to all candidates. */
	limit?: number | undefined;
}

/** Selection state shared by planner stages. */
export interface PlanningSelectionState {
	/** Original budget. */
	budgetTokens: number;
	/** Tokens already selected. */
	usedTokens: number;
	/** Selected planned items. */
	selected: PlannedItem[];
	/** Items omitted so far. */
	omitted: PlannedItem[];
	/** Planner warnings accumulated so far. */
	warnings: string[];
}
