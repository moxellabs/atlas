import type {
	AtlasDocAudience,
	AtlasDocPurpose,
	AtlasDocVisibility,
	Authority,
	CanonicalSection,
	CorpusChunk,
	DocKind,
	DocScope,
	DocumentMetadataFilters,
	ModuleNode,
	PackageNode,
	RepoMode,
	SkillNode,
	SummaryArtifact,
} from "@atlas/core";

/** SQLite-backed store client accepted by all repositories. */
export interface StoreDatabase {
	/** Executes one or more SQL statements without returning rows. */
	exec(sql: string): unknown;
	/** Executes a SQL statement without returning rows. */
	run(sql: string, params?: SQLParams): unknown;
	/** Returns the first row for a SQL query. */
	get<T = unknown>(sql: string, params?: SQLParams): T | undefined;
	/** Returns every row for a SQL query. */
	all<T = unknown>(sql: string, params?: SQLParams): T[];
	/** Runs a function inside a transaction. */
	transaction<T>(operation: () => T): T;
	/** Closes the underlying database connection. */
	close(): void;
}

/** SQL parameters supported by the store query wrapper. */
export type SQLParams = Record<
	string,
	string | number | bigint | boolean | null
>;

/** Stored repository metadata. */
export interface RepoRecord {
	repoId: string;
	mode: RepoMode;
	revision: string;
	updatedAt: string;
}

/** Input used to upsert repository metadata. */
export interface UpsertRepoInput {
	repoId: string;
	mode: RepoMode;
	revision: string;
	updatedAt?: string | undefined;
}

/** Stored package node. */
export type PackageRecord = PackageNode;

/** Stored module node. */
export type ModuleRecord = ModuleNode;

/** Stored canonical document metadata. */
export interface DocumentRecord {
	docId: string;
	repoId: string;
	path: string;
	sourceVersion: string;
	kind: DocKind;
	authority: Authority;
	title?: string | undefined;
	contentHash: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	description?: string | undefined;
	audience: AtlasDocAudience[];
	purpose: AtlasDocPurpose[];
	visibility: AtlasDocVisibility;
	order?: number | undefined;
	profile?: string | undefined;
	tags: string[];
	scopes: DocScope[];
}

/** Stored canonical section with code blocks preserved as structured data. */
export type SectionRecord = CanonicalSection & { docId: string };

/** Stored chunk record. */
export type ChunkRecord = CorpusChunk & { sectionId?: string | undefined };

/** Stored summary artifact. */
export type SummaryRecord = SummaryArtifact;

/** Stored skill node plus compiler-extracted fields. */
export interface SkillRecord {
	skillId: string;
	repoId: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	sourceDocId: string;
	sourceDocPath: string;
	title?: string | undefined;
	description?: string | undefined;
	headings: string[][];
	keySections: string[];
	topics: string[];
	aliases: string[];
	tokenCount: number;
}

/** Portable read-only file bundled with a skill directory. */
export interface SkillArtifactRecord {
	skillId: string;
	path: string;
	kind: "script" | "reference" | "agent-profile" | "other";
	contentHash: string;
	sizeBytes: number;
	mimeType?: string | undefined;
	content?: string | undefined;
}

/** Artifact counts summarized for skill discovery surfaces. */
export interface SkillArtifactSummary {
	scripts: number;
	references: number;
	agentProfiles: number;
	other: number;
}

/** Input used to persist a topology skill and optional extracted compiler content. */
export interface UpsertSkillInput {
	node: SkillNode;
	sourceDocId: string;
	description?: string | undefined;
	headings?: string[][] | undefined;
	keySections?: string[] | undefined;
	topics?: string[] | undefined;
	aliases?: string[] | undefined;
	tokenCount?: number | undefined;
	artifacts?: SkillArtifactRecord[] | undefined;
}

/** Stored incremental indexing manifest. */
export interface ManifestRecord {
	repoId: string;
	indexedRevision?: string | undefined;
	buildTimestamp: string;
	schemaVersion: number;
	compilerVersion?: string | undefined;
	partialRevision?: string | undefined;
	partialBuildTimestamp?: string | undefined;
	partialSelector?: PartialBuildSelector | undefined;
}

/** Input used to upsert incremental indexing manifest state. */
export interface UpsertManifestInput {
	repoId: string;
	indexedRevision?: string | undefined;
	buildTimestamp?: string | undefined;
	schemaVersion?: number | undefined;
	compilerVersion?: string | undefined;
	partialRevision?: string | undefined;
	partialBuildTimestamp?: string | undefined;
	partialSelector?: PartialBuildSelector | undefined;
}

/** Persisted selector associated with a partial build. */
export interface PartialBuildSelector {
	docIds?: string[] | undefined;
	packageId?: string | undefined;
	moduleId?: string | undefined;
}

/** Store bootstrap diagnostics useful for inspect and doctor commands. */
export interface StoreDiagnostics {
	dbPath: string;
	schemaVersion: number;
	repoCount: number;
	documentCount: number;
	chunkCount: number;
	summaryCount: number;
	lastMigration?: number | undefined;
	ftsEntryCount: number;
}

/** Lexical full-text hit mapped back to ATLAS entities. */
export interface LexicalSearchHit {
	entityType: "document" | "section" | "chunk";
	entityId: string;
	repoId: string;
	docId: string;
	path: string;
	title?: string | undefined;
	sectionId?: string | undefined;
	chunkId?: string | undefined;
	rank: number;
}

/** Options for lexical full-text search. */
export interface LexicalSearchOptions {
	query: string;
	repoId?: string | undefined;
	limit?: number | undefined;
	filters?: DocumentMetadataFilters | undefined;
}

/** Options for path-oriented document lookup. */
export interface PathSearchOptions {
	repoId?: string | undefined;
	path: string;
	mode: "exact" | "prefix" | "contains";
	limit?: number | undefined;
	filters?: DocumentMetadataFilters | undefined;
}

/** Options for scope-oriented document lookup. */
export interface ScopeSearchOptions {
	repoId: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	kind?: DocKind | undefined;
	limit?: number | undefined;
	filters?: DocumentMetadataFilters | undefined;
}
