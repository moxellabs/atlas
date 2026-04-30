export type {
	AtlasConfig,
	AtlasGhesRepoSourceConfig,
	AtlasGitRepoSourceConfig,
	AtlasHostConfig,
	AtlasIdentityConfig,
	AtlasMcpIdentityConfig,
	AtlasRepoConfig,
	AtlasServerConfig,
	AtlasTopologyRule,
	AtlasWorkspaceConfig,
} from "./atlas-config.schema";
export {
	atlasConfigSchema,
	atlasDocAudienceSchema,
	atlasDocPurposeSchema,
	atlasDocVisibilitySchema,
	atlasGhesRepoSourceConfigSchema,
	atlasGitRepoSourceConfigSchema,
	atlasHostConfigSchema,
	atlasIdentityConfigSchema,
	atlasMcpIdentityConfigSchema,
	atlasRepoConfigSchema,
	atlasServerConfigSchema,
	atlasTopologyRuleSchema,
	atlasWorkspaceConfigSchema,
	authoritySchema,
	defaultHost,
	docKindSchema,
	parseCanonicalRepoId,
	repoIdSchema,
	repoPathSegments,
	sortHostsByPriority,
} from "./atlas-config.schema";
export {
	buildDefaultConfig,
	buildDefaultCorpusDbPath,
	DEFAULT_CACHE_DIR,
	DEFAULT_CORPUS_DB_RELATIVE_PATH,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	DEFAULT_MOXEL_ATLAS_CORPUS_DB_RELATIVE_PATH,
	DEFAULT_MOXEL_ATLAS_HOME,
	DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
	DEFAULT_REPO_ARTIFACT_RELATIVE_PATH,
	DEFAULT_SERVER_HOST,
	DEFAULT_SERVER_PORT,
	defaultConfig,
	defaultGithubHostConfig,
	defaultHttpServerConfig,
} from "./defaults/default-config";
export type { AtlasEnv } from "./env.schema";
export {
	atlasEnvSchema,
	logLevelSchema,
	normalizeEnvInput,
} from "./env.schema";
export type {
	GhesCommandRunner,
	GhesCredentialSource,
	ResolvedGhesToken,
	ResolveGhesTokenOptions,
} from "./loaders/ghes-auth";
export {
	ghesHostname,
	resolveGhesAuth,
	resolveGhesToken,
} from "./loaders/ghes-auth";
export type {
	LoadConfigOptions,
	ResolvedAtlasConfig,
} from "./loaders/load-config";
export {
	AtlasConfigError,
	AtlasConfigNotFoundError,
	AtlasConfigParseError,
	AtlasConfigPathError,
	AtlasConfigReadError,
	AtlasConfigValidationError,
	loadConfig,
	resolveAtlasConfig,
} from "./loaders/load-config";
export { AtlasEnvValidationError, loadEnv } from "./loaders/load-env";
export {
	mutateAtlasConfigFile,
	resolveAtlasConfigTarget,
} from "./loaders/mutate-config";
export type {
	ArtifactRootValidationResult,
	IdentityRootValidationResult,
	ResolvedArtifactRoot,
	ResolvedIdentityRoot,
} from "./white-label/artifact-root";
export {
	ARTIFACT_ROOT_ERROR,
	DEFAULT_ATLAS_ARTIFACT_ROOT,
	DEFAULT_ATLAS_IDENTITY_ROOT,
	DEFAULT_ATLAS_RUNTIME_ROOT,
	IDENTITY_ROOT_ERROR,
	normalizeArtifactRoot,
	normalizeIdentityRoot,
	resolveArtifactRoot,
	resolveIdentityRoot,
	runtimeRootFromIdentityRoot,
	validateArtifactRoot,
	validateIdentityRoot,
} from "./white-label/artifact-root";
export type {
	IdentityProfile,
	McpIdentityProfile,
	ResolveMcpIdentityInput,
} from "./white-label/profile";
export {
	DEFAULT_MCP_IDENTITY,
	resolveIdentityProfile,
	resolveMcpIdentity,
	validateMcpIdentifier,
} from "./white-label/profile";
