export * from "./artifact";
export { buildAll } from "./build/build-all";
export { buildRepo } from "./build/build-repo";
export { persistBuildResults } from "./build/persist-build-results";
export { rebuildDocs } from "./build/rebuild-docs";
export type { IndexerErrorContext } from "./errors/indexer-errors";
export {
	IndexerBuildError,
	IndexerConfigurationError,
	IndexerError,
	IndexerIncrementalBuildError,
	IndexerPersistenceError,
	IndexerSyncError,
	serializeIndexerDiagnosticCause,
} from "./errors/indexer-errors";
export { collectAffectedDocs } from "./incremental/collect-affected-docs";
export { planIncrementalBuild } from "./incremental/plan-incremental-build";
export {
	analyzeDocumentationSignal,
	type DocumentationSignal,
	type DocumentationSignalWarning,
	indexLocalOnlyRepo,
} from "./local-only-index";
export {
	createBuildBatchReport,
	createBuildReport,
} from "./reports/build-report";
export { createSyncBatchReport, createSyncReport } from "./reports/sync-report";
export type {
	CreateIndexerServicesOptions,
	IndexerDependencies,
	IndexerSourceDiagnostic,
	IndexerStoreRepositories,
	RepoTopologySnapshot,
} from "./services/create-indexer-services";
export { createIndexerServices } from "./services/create-indexer-services";
export {
	computeSourceDiff,
	computeSourceUpdates,
} from "./sync/compute-source-updates";
export { syncAll } from "./sync/sync-all";
export { syncRepo } from "./sync/sync-repo";
export type {
	AffectedDocs,
	BuildBatchReport,
	BuildOptions,
	BuildReport,
	BuildSelection,
	BuildStrategy,
	IncrementalBuildPlan,
	IndexerChunkingPolicy,
	IndexerDiagnostic,
	IndexerDiagnosticCause,
	IndexerService,
	OperationRecovery,
	OperationTimings,
	PersistBuildResult,
	RebuildArtifacts,
	RebuiltDocument,
	RepoTargetOptions,
	SourceUpdate,
	SyncBatchReport,
	SyncOptions,
	SyncReport,
} from "./types/indexer.types";
