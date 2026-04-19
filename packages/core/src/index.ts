export type { Authority } from "./enums/authority.enum";
export { AUTHORITIES } from "./enums/authority.enum";
export type { DiagnosticConfidence } from "./enums/diagnostic-confidence.enum";
export { DIAGNOSTIC_CONFIDENCES } from "./enums/diagnostic-confidence.enum";
export type { DocKind } from "./enums/doc-kind.enum";
export { DOC_KINDS } from "./enums/doc-kind.enum";
export type { NormalizedContentChangeKind } from "./enums/normalized-change-kind.enum";
export { NORMALIZED_CONTENT_CHANGE_KINDS } from "./enums/normalized-change-kind.enum";
export type { QueryKind } from "./enums/query-kind.enum";
export { QUERY_KINDS } from "./enums/query-kind.enum";
export type { RawSourceChangeKind } from "./enums/raw-change-kind.enum";
export { RAW_SOURCE_CHANGE_KINDS } from "./enums/raw-change-kind.enum";
export type { SourceMode } from "./enums/source-mode.enum";
export { SOURCE_MODES } from "./enums/source-mode.enum";
export type { TransportMode } from "./enums/transport-mode.enum";
export { TRANSPORT_MODES } from "./enums/transport-mode.enum";
export type { ChunkIdInput } from "./ids/chunk-id";
export { createChunkId } from "./ids/chunk-id";
export type { DocIdInput } from "./ids/doc-id";
export { createDocId } from "./ids/doc-id";
export type { ModuleIdInput } from "./ids/module-id";
export { createModuleId } from "./ids/module-id";
export type { PackageIdInput } from "./ids/package-id";
export { createPackageId } from "./ids/package-id";
export type { SectionIdInput } from "./ids/section-id";
export { createSectionId } from "./ids/section-id";
export type { SkillIdInput } from "./ids/skill-id";
export { createSkillId } from "./ids/skill-id";
export type { SourceChange } from "./types/change.types";
export type { CorpusChunk } from "./types/chunk.types";
export type {
	AtlasDocAudience,
	AtlasDocMetadataProfile,
	AtlasDocPurpose,
	AtlasDocVisibility,
	CanonicalDocument,
	CanonicalSection,
	CodeBlockFragment,
	DocumentMetadata,
	DocumentMetadataFilters,
} from "./types/doc.types";
export {
	BUILT_IN_DOC_METADATA_PROFILES,
	documentMatchesMetadataFilters,
} from "./types/doc.types";
export type {
	FreshnessInput,
	FreshnessSnapshot,
} from "./types/freshness.types";
export { computeFreshness } from "./types/freshness.types";
export type { Provenance, SourceProvenance } from "./types/provenance.types";
export type {
	DocMetadataRule,
	FileEntry,
	ModuleNode,
	PackageNode,
	PathDiff,
	RepoConfig,
	RepoMode,
	RepoRevision,
	RepoSourceAdapter,
	SourceFile,
	WorkspaceConfig,
} from "./types/repo.types";
export type {
	AmbiguousRetrievalResult,
	PlannedContext,
	PlannedContextItem,
	RetrievalHit,
	RetrievalQuery,
} from "./types/retrieval.types";
export type { SummaryArtifact } from "./types/summary.types";
export type {
	ClassificationDiagnostic,
	ClassifiedDoc,
	DocScope,
	RepoTopologyAdapter,
	SkillNode,
	TopologyContext,
	TopologyRule,
} from "./types/topology.types";
export { stableHash } from "./utils/hash";
export { stableJson } from "./utils/stable-json";
export {
	estimateTokenCount,
	fitsWithinTokenBudget,
	sumTokenCounts,
} from "./utils/tokens";
