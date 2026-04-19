import type {
	CompilerDiagnostic,
	ExtractedSkillContent,
} from "@atlas/compiler";
import type {
	CanonicalDocument,
	ClassifiedDoc,
	ModuleNode,
	PackageNode,
	SkillNode,
	SourceChange,
	SummaryArtifact,
} from "@atlas/core";
import type { ManifestRecord, SkillArtifactRecord } from "@atlas/store";
import type {
	ChunkingDiagnostics,
	ChunkingOptions,
	TokenizedChunk,
} from "@atlas/tokenizer";

/** Repo target selector used by sync and build entrypoints. */
export interface RepoTargetOptions {
	/** Specific repository IDs to operate on. */
	repoIds?: string[] | undefined;
	/** Operate on every configured repository. */
	all?: boolean | undefined;
}

/** Targeted build selector for partial repo rebuilds. */
export type BuildSelection = {
	docIds?: string[] | undefined;
	packageId?: string | undefined;
	moduleId?: string | undefined;
};

/** Options for sync orchestration. */
export type SyncOptions = RepoTargetOptions;

/** Options for build orchestration. */
export interface BuildOptions extends RepoTargetOptions {
	/** Forces a rebuild even when the planner would no-op. */
	force?: boolean | undefined;
	/** Restricts the build to a specific subset of documents. */
	selection?: BuildSelection | undefined;
}

/** Timing fields emitted by orchestration reports. */
export interface OperationTimings {
	startedAt: string;
	completedAt: string;
	durationMs: number;
}

/** Structured warning or error attached to sync/build reports. */
export interface IndexerDiagnostic {
	severity: "warning" | "error";
	stage: string;
	message: string;
	code?: string | undefined;
	path?: string | undefined;
	details?: Record<string, string | number | boolean | undefined> | undefined;
}

/** Recovery state attached to sync/build reports after an operation completes or fails. */
export interface OperationRecovery {
	/** True when a failed operation left the previously indexed corpus untouched. */
	previousCorpusPreserved: boolean;
	/** True when current persisted state is known to require a follow-up build/sync. */
	stale: boolean;
	/** Operator-facing next action. */
	nextAction: string;
}

/** Normalized source update payload produced by sync orchestration. */
export interface SourceUpdate {
	repoId: string;
	mode: "local-git" | "ghes-api";
	previousRevision?: string | undefined;
	currentRevision: string;
	changed: boolean;
	changes: SourceChange[];
	relevantChanges: SourceChange[];
	relevantDocPaths: string[];
	topologySensitivePaths: string[];
	packageManifestPaths: string[];
	fullRebuildRequired?: boolean | undefined;
	fullRebuildReason?: string | undefined;
	timings: OperationTimings;
}

/** High-level source-to-corpus impact computed during sync. */
export type CorpusImpact =
	| "none"
	| "docs"
	| "topology"
	| "package-manifest"
	| "full-rebuild"
	| "missing-manifest"
	| "incompatible-manifest";

/** Deterministic sync status for one repo. */
export type SyncStatus = "unchanged" | "updated" | "failed";

/** Report emitted for one repo sync operation. */
export interface SyncReport {
	repoId: string;
	mode: "local-git" | "ghes-api";
	status: SyncStatus;
	previousRevision?: string | undefined;
	currentRevision?: string | undefined;
	sourceChanged: boolean;
	corpusAffected: boolean;
	corpusImpact: CorpusImpact;
	changedPathCount: number;
	relevantChangedPathCount: number;
	relevantDocPathCount: number;
	topologySensitivePathCount: number;
	packageManifestPathCount: number;
	diagnostics: IndexerDiagnostic[];
	recovery: OperationRecovery;
	timings: OperationTimings;
}

/** Aggregate sync result across many repos. */
export interface SyncBatchReport {
	requestedRepoIds: string[];
	reports: SyncReport[];
	successCount: number;
	failureCount: number;
	timings: OperationTimings;
}

/** Build strategy chosen by the incremental planner. */
export type BuildStrategy = "noop" | "incremental" | "full" | "targeted";

/** Stable machine-readable reason for build strategy selection. */
export type BuildReasonCode =
	| "noop_current"
	| "force"
	| "missing_manifest"
	| "schema_mismatch"
	| "compiler_mismatch"
	| "source_full_rebuild"
	| "topology_changed"
	| "package_manifest_changed"
	| "doc_changes"
	| "targeted_doc"
	| "targeted_package"
	| "targeted_module"
	| "verification_only";

/** Explicit incremental build plan emitted before compilation. */
export interface IncrementalBuildPlan {
	repoId: string;
	strategy: BuildStrategy;
	reasonCode: BuildReasonCode;
	reason: string;
	currentRevision: string;
	manifest?: ManifestRecord | undefined;
	selection?: BuildSelection | undefined;
	affectedPaths: string[];
	affectedDocPaths: string[];
	deletedDocPaths: string[];
	partial: boolean;
}

/** Selected and deleted doc sets derived from changes or selectors. */
export interface AffectedDocs {
	repoId: string;
	packages: PackageNode[];
	modules: ModuleNode[];
	docsByPath: Map<string, ClassifiedDoc>;
	skillsBySourceDocPath: Map<string, SkillNode>;
	allDocs: ClassifiedDoc[];
	allSkills: SkillNode[];
	selectedDocs: ClassifiedDoc[];
	deletedStoredDocIds: string[];
	deletedStoredSkillIds: string[];
	affectedModuleIds: string[];
}

/** In-memory rebuild artifact for one canonical document. */
export interface RebuiltDocument {
	classifiedDoc: ClassifiedDoc;
	document: CanonicalDocument;
	chunks: TokenizedChunk[];
	documentSummaries: SummaryArtifact[];
	outlineSummary: SummaryArtifact;
	skillNode?: SkillNode | undefined;
	extractedSkill?: ExtractedSkillContent | undefined;
	skillSummary?: SummaryArtifact | undefined;
	skillArtifacts: SkillArtifactRecord[];
	compilerDiagnostics: CompilerDiagnostic[];
	chunkingDiagnostics: ChunkingDiagnostics;
}

/** In-memory rebuild output for one repo before persistence. */
export interface RebuildArtifacts {
	repoId: string;
	packages: PackageNode[];
	modules: ModuleNode[];
	selectedDocs: RebuiltDocument[];
	deletedStoredDocIds: string[];
	deletedStoredSkillIds: string[];
	moduleSummaries: SummaryArtifact[];
}

/** Durable persistence result for one repo build. */
export interface PersistBuildResult {
	manifest: ManifestRecord;
	docsPersisted: number;
	docsDeleted: number;
	chunksPersisted: number;
	skillsUpdated: number;
	summariesUpdated: number;
}

/** Report emitted for one repo build operation. */
export interface BuildReport {
	repoId: string;
	strategy: BuildStrategy;
	reasonCode: BuildReasonCode;
	partial: boolean;
	reason: string;
	currentRevision?: string | undefined;
	docsConsidered: number;
	docsRebuilt: number;
	docsDeleted: number;
	chunksPersisted: number;
	skillsUpdated: number;
	summariesUpdated: number;
	manifestUpdated: boolean;
	changedPaths: string[];
	affectedDocPaths: string[];
	deletedDocPaths: string[];
	skippedDocPaths: string[];
	diagnostics: IndexerDiagnostic[];
	recovery: OperationRecovery;
	timings: OperationTimings;
}

/** Aggregate build result across many repos. */
export interface BuildBatchReport {
	requestedRepoIds: string[];
	reports: BuildReport[];
	successCount: number;
	failureCount: number;
	timings: OperationTimings;
}

/** Stable service API for consumers such as the server and future CLI. */
export interface IndexerService {
	syncRepo(repoId: string): Promise<SyncReport>;
	syncAll(options?: SyncOptions): Promise<SyncBatchReport>;
	buildRepo(
		repoId: string,
		options?: Omit<BuildOptions, "repoIds" | "all">,
	): Promise<BuildReport>;
	buildAll(options?: Omit<BuildOptions, "repoIds">): Promise<BuildBatchReport>;
}

/** Factory options controlling tokenizer defaults used during rebuild. */
export interface IndexerChunkingPolicy {
	chunking: ChunkingOptions;
}
