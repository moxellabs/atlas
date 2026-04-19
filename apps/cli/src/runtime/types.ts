import type { ResolvedAtlasConfig } from "@atlas/config";
import type { IndexerService } from "@atlas/indexer";
import type { AtlasSourceDiffProvider } from "@atlas/mcp";
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

/** Shared command context passed to every CLI command. */
export interface CliCommandContext {
	argv: readonly string[];
	args?: Record<string, string | undefined> | undefined;
	options?: Record<string, unknown> | undefined;
	cwd: string;
	output: CliOutputOptions;
	identityRoot?: string | undefined;
	mcpName?: string | undefined;
	mcpTitle?: string | undefined;
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
	sourceDiffProvider: AtlasSourceDiffProvider;
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
