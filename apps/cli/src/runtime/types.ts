import type { ResolvedAtlasConfig } from "@atlas/config";
import type { IndexerService } from "@atlas/indexer";
import type {
	PlannedContext,
	QueryClassification,
	ScopeInferenceResult,
} from "@atlas/retrieval";
import type { RepoCacheService } from "@atlas/source-git";
import type { AtlasStoreClient } from "@atlas/store";
import type { AtlasRunningServer } from "../../../server/src/start-server";

/** Stable output mode derived from global CLI flags. */
export interface CliOutputOptions {
	json: boolean;
	verbose: boolean;
	quiet: boolean;
}

/** Commander option values accepted by Atlas command handlers. */
export interface AtlasCliKnownOptions {
	json?: boolean | undefined;
	verbose?: boolean | undefined;
	quiet?: boolean | undefined;
	cwd?: string | undefined;
	config?: string | readonly string[] | undefined;
	atlasIdentityRoot?: string | undefined;
	atlasMcpName?: string | undefined;
	atlasMcpTitle?: string | undefined;
	discoveryPolicy?: string | undefined;
	toolProfile?: string | undefined;
	remoteUrl?: string | undefined;
	authTokenEnv?: string | undefined;
	authTokenFile?: string | undefined;
	scope?: string | undefined;
	mode?: string | undefined;
	dryRun?: boolean | undefined;
	all?: boolean | undefined;
	serverCommand?: string | undefined;
	serverArg?: string | readonly string[] | undefined;
	detected?: boolean | undefined;
	nonInteractive?: boolean | undefined;
	interactive?: boolean | undefined;
	repo?: string | undefined;
	force?: boolean | undefined;
	check?: boolean | undefined;
	cacheDir?: string | undefined;
	host?: string | undefined;
	repoId?: string | undefined;
	webUrl?: string | undefined;
	apiUrl?: string | undefined;
	protocol?: string | undefined;
	priority?: string | undefined;
	ref?: string | undefined;
	refMode?: string | undefined;
	remote?: string | undefined;
	localPath?: string | undefined;
	baseUrl?: string | undefined;
	owner?: string | undefined;
	name?: string | undefined;
	tokenEnvVar?: string | undefined;
	packageGlob?: string | readonly string[] | undefined;
	packageManifestFile?: string | readonly string[] | undefined;
	template?: string | undefined;
	missingArtifactAction?: string | undefined;
	localOnly?: boolean | undefined;
	skipMissingArtifact?: boolean | undefined;
	maintainerInstructions?: boolean | undefined;
	issuePrInstructions?: boolean | undefined;
	issueOnly?: boolean | undefined;
	prOnly?: boolean | undefined;
	maintainerOnly?: boolean | undefined;
	path?: string | undefined;
	fresh?: boolean | undefined;
	default?: boolean | undefined;
	yes?: boolean | undefined;
	package?: string | undefined;
	module?: string | undefined;
	kind?: string | undefined;
	doc?: string | undefined;
	docId?: string | readonly string[] | undefined;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	port?: string | undefined;
	open?: boolean | undefined;
	live?: boolean | undefined;
	query?: string | undefined;
	target?: string | undefined;
	workspace?: string | undefined;
	overwrite?: boolean | undefined;
	olderThan?: string | undefined;
	profile?: string | undefined;
	allProfiles?: boolean | undefined;
	audience?: string | readonly string[] | undefined;
	purpose?: string | readonly string[] | undefined;
	visibility?: string | readonly string[] | undefined;
	dataset?: string | undefined;
	trace?: string | undefined;
	budgetTokens?: string | undefined;
}

/** Typed Commander options plus host-mounted options unknown to Atlas. */
export type CliCommandOptions = Readonly<AtlasCliKnownOptions> &
	Readonly<Record<string, unknown>>;

export type CliOptionName = keyof AtlasCliKnownOptions;

/** Shared command context passed to every CLI command. */
export interface CliCommandContext {
	/** Positional arguments only. Commander owns all option parsing. */
	positionals: readonly string[];
	options: CliCommandOptions;
	cwd: string;
	output: CliOutputOptions;
	identityRoot?: string | undefined;
	mcpName?: string | undefined;
	mcpTitle?: string | undefined;
	mcpResourcePrefix?: string | undefined;
	stdin: NodeJS.ReadStream;
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
	env: NodeJS.ProcessEnv;
}

/** Shared package/service graph used by CLI commands. */
export interface AtlasCliDependencies {
	config: ResolvedAtlasConfig;
	db: AtlasStoreClient;
	indexer: IndexerService;
	repoCache: RepoCacheService;
	retrieval: {
		classifyQuery(query: string): QueryClassification;
		inferScopes(input: {
			query: string;
			classification: QueryClassification;
			repoId?: string | undefined;
		}): ScopeInferenceResult;
		planContext(input: {
			query: string;
			repoId?: string | undefined;
			budgetTokens: number;
		}): PlannedContext;
	};
	server: {
		start(options?: {
			host?: string | undefined;
			port?: number | undefined;
		}): Promise<AtlasRunningServer>;
	};
	close(): void;
}

/** Successful command outcome. */
export interface CliCommandSuccess<T = unknown> {
	ok: true;
	command: string;
	data: T;
	exitCode?: number | undefined;
}

/** Failed command outcome. */
export interface CliCommandFailure {
	ok: false;
	command: string;
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
	exitCode: number;
}

/** Unified command result returned to the top-level runner. */
export type CliCommandResult<T = unknown> =
	| CliCommandSuccess<T>
	| CliCommandFailure;
