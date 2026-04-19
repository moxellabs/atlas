export type { OpenStoreOptions } from "./db/client";
export { AtlasStoreClient, getStoreDiagnostics, openStore } from "./db/client";
export type { StoreMigration } from "./db/migrate";
export {
	getCurrentSchemaVersion,
	migrateStore,
	STORE_MIGRATIONS,
	STORE_SCHEMA_VERSION,
} from "./db/migrate";
export { applyStorePragmas, STORE_PRAGMAS } from "./db/pragmas";
export { ChunkRepository } from "./docs/chunk.repository";
export { DocRepository } from "./docs/doc.repository";
export { SectionRepository } from "./docs/section.repository";
export { SummaryRepository } from "./docs/summary.repository";
export type { StoreErrorContext } from "./errors";
export {
	StoreError,
	StoreInitializationError,
	StoreMigrationError,
	StoreRepositoryError,
	StoreSearchError,
	StoreTransactionError,
} from "./errors";
export { ManifestRepository } from "./manifests/manifest.repository";
export type {
	DeleteRepoCorpusResult,
	RepoCorpusCounts,
} from "./repos/delete-repo-corpus";
export {
	countRepoCorpusRows,
	deleteRepoCorpus,
} from "./repos/delete-repo-corpus";
export { ModuleRepository } from "./repos/module.repository";
export { PackageRepository } from "./repos/package.repository";
export { RepoRepository } from "./repos/repo.repository";
export {
	deleteFtsEntriesForDocument,
	reindexChunks,
	reindexDocumentText,
} from "./search/fts";
export { lexicalSearch } from "./search/lexical-search";
export { pathSearch } from "./search/path-search";
export { scopeSearch } from "./search/scope-search";
export { SkillRepository } from "./skills/skill.repository";
export type {
	ChunkRecord,
	DocumentRecord,
	LexicalSearchHit,
	LexicalSearchOptions,
	ManifestRecord,
	ModuleRecord,
	PackageRecord,
	PartialBuildSelector,
	PathSearchOptions,
	RepoRecord,
	ScopeSearchOptions,
	SectionRecord,
	SkillArtifactRecord,
	SkillArtifactSummary,
	SkillRecord,
	SQLParams,
	StoreDatabase,
	StoreDiagnostics,
	SummaryRecord,
	UpsertManifestInput,
	UpsertRepoInput,
	UpsertSkillInput,
} from "./types";
