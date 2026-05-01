import { join, resolve } from "node:path";
import {
	type AtlasConfig,
	AtlasConfigNotFoundError,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	type LoadConfigOptions,
	loadConfig,
	mutateAtlasConfigFile,
	resolveAtlasConfigTarget,
	resolveIdentityProfile,
} from "@atlas/config";
import {
	computeSourceDiff,
	createIndexerServices,
	type IndexerDependencies,
} from "@atlas/indexer";
import type { AtlasSourceDiffProvider } from "@atlas/mcp";
import { classifyQuery, inferScopes, planContext } from "@atlas/retrieval";
import { RepoCacheService } from "@atlas/source-git";
import { openStore } from "@atlas/store";

import { loadServerEnv } from "../../../server/src/env";
import { startAtlasServer } from "../../../server/src/start-server";
import { fileExists } from "../utils/node-runtime";
import type { AtlasCliDependencies } from "./types";

/** Loads the shared CLI dependency graph from config and local runtime state. */
export async function buildCliDependencies(
	options: LoadConfigOptions,
): Promise<AtlasCliDependencies> {
	let config: Awaited<ReturnType<typeof loadConfig>>;
	try {
		config = await loadConfig(options);
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError) || options.configPath) {
			throw error;
		}
		const identity = resolveIdentityProfile({
			envIdentityRoot: options.env?.ATLAS_IDENTITY_ROOT,
		});
		const home = options.env?.HOME ?? process.env.HOME ?? "~";
		const defaultConfigPath = join(
			home,
			identity.runtimeRoot.startsWith("~/")
				? identity.runtimeRoot.slice(2)
				: identity.runtimeRoot,
			DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
		);
		if (!(await fileExists(defaultConfigPath))) throw error;
		config = await loadConfig({ ...options, configPath: defaultConfigPath });
	}
	const db = openStore({ path: config.config.corpusDbPath, migrate: true });
	const { deps: indexerDeps, service: indexer } = createIndexerServices({
		config,
		db,
	});
	const repoCache = new RepoCacheService();

	return {
		config,
		db,
		indexer,
		sourceDiffProvider: createSourceDiffProvider(indexerDeps),
		repoCache,
		retrieval: {
			classifyQuery,
			inferScopes(input: {
				query: string;
				classification: ReturnType<typeof classifyQuery>;
				repoId?: string | undefined;
			}) {
				return inferScopes({
					db,
					query: input.query,
					classification: input.classification,
					...(input.repoId === undefined ? {} : { repoId: input.repoId }),
				});
			},
			planContext(input: {
				query: string;
				repoId?: string | undefined;
				budgetTokens: number;
			}) {
				return planContext({
					db,
					query: input.query,
					budgetTokens: input.budgetTokens,
					...(input.repoId === undefined ? {} : { repoId: input.repoId }),
				});
			},
		},
		server: {
			async start(startOptions = {}) {
				return startAtlasServer({
					env: {
						...loadServerEnv({
							...process.env,
							ATLAS_HOST: startOptions.host,
							ATLAS_PORT:
								startOptions.port === undefined
									? undefined
									: String(startOptions.port),
						}),
					},
					config,
				});
			},
		},
		close(): void {
			db.close();
		},
	};
}

/** Creates source diff support for MCP runtimes without coupling MCP to indexer internals. */
export function createSourceDiffProvider(
	indexerDeps: IndexerDependencies,
): AtlasSourceDiffProvider {
	return {
		async diff(request) {
			const repo = indexerDeps.resolveRepo(request.repoId);
			const diff = await computeSourceDiff(
				repo,
				indexerDeps,
				request.fromRevision,
				request.toRevision,
			);
			return {
				repoId: diff.repoId,
				fromRevision: request.fromRevision,
				toRevision: request.toRevision,
				changes: diff.changes,
				relevantChanges: diff.relevantChanges,
				relevantDocPaths: diff.relevantDocPaths,
				topologySensitivePaths: diff.topologySensitivePaths,
				packageManifestPaths: diff.packageManifestPaths,
				...(diff.fullRebuildRequired === undefined
					? {}
					: { fullRebuildRequired: diff.fullRebuildRequired }),
				...(diff.fullRebuildReason === undefined
					? {}
					: { fullRebuildReason: diff.fullRebuildReason }),
			};
		},
	};
}

/** Returns the config source path if it exists, otherwise the default creation target. */
export async function resolveCliConfigTarget(
	options: LoadConfigOptions,
): Promise<string> {
	try {
		return await resolveAtlasConfigTarget(options);
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) {
			throw error;
		}
		const cwd = resolve(options.cwd ?? process.cwd());
		if (options.configPath) {
			return resolve(cwd, options.configPath);
		}
		const profile = resolveIdentityProfile({
			envIdentityRoot: options.env?.ATLAS_IDENTITY_ROOT,
		});
		return join(
			options.env?.HOME ?? process.env.HOME ?? "~",
			profile.runtimeRoot.startsWith("~/")
				? profile.runtimeRoot.slice(2)
				: profile.runtimeRoot,
			DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
		);
	}
}

/** Reads, mutates, validates, and atomically writes the CLI-owned ATLAS config file. */
export async function mutateAtlasConfig(
	options: LoadConfigOptions & { createDefault?: AtlasConfig | undefined },
	mutate: (config: AtlasConfig) => AtlasConfig,
) {
	return mutateAtlasConfigFile(options, mutate);
}

/** Returns a managed local-git cache root for CLI defaults and pruning. */
export function managedRepoCacheRoot(cacheDir: string): string {
	return join(resolveHome(cacheDir), "repos");
}

export function repoCheckoutDir(cacheDir: string, repoId: string): string {
	return join(resolveHome(cacheDir), "checkouts", repoId);
}

function resolveHome(path: string): string {
	if (path === "~") {
		return process.env.HOME ?? path;
	}
	if (path.startsWith("~/")) {
		return join(process.env.HOME ?? "~", path.slice(2));
	}
	return path;
}
