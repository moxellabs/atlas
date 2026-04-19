import { AsyncLocalStorage } from "node:async_hooks";
import { dirname } from "node:path";
import { ATLAS_COMPILER_VERSION } from "@atlas/compiler";
import type { ResolvedAtlasConfig } from "@atlas/config";
import type {
	ClassifiedDoc,
	ModuleNode,
	PackageNode,
	RepoConfig,
	RepoSourceAdapter,
	SkillNode,
	TopologyContext,
} from "@atlas/core";
import {
	type GhesAuthConfig,
	type GhesFetch,
	GhesSourceAdapter,
	type GhesSourceDiagnosticEvent,
} from "@atlas/source-ghes";
import {
	LocalGitSourceAdapter,
	RepoCacheService,
	type SourceGitDiagnosticEvent,
} from "@atlas/source-git";
import {
	type AtlasStoreClient,
	ChunkRepository,
	DocRepository,
	ManifestRepository,
	ModuleRepository,
	PackageRepository,
	RepoRepository,
	SectionRepository,
	SkillRepository,
	STORE_SCHEMA_VERSION,
	SummaryRepository,
} from "@atlas/store";
import { type ChunkingOptions, DEFAULT_ENCODING } from "@atlas/tokenizer";
import { selectTopologyAdapter } from "@atlas/topology";

import { buildAll } from "../build/build-all";
import { buildRepo } from "../build/build-repo";
import { IndexerConfigurationError } from "../errors/indexer-errors";
import { syncAll } from "../sync/sync-all";
import { syncRepo } from "../sync/sync-repo";
import type {
	IndexerChunkingPolicy,
	IndexerService,
} from "../types/indexer.types";

/** Concrete repository dependencies used by persistence orchestration. */
export interface IndexerStoreRepositories {
	repos: RepoRepository;
	manifests: ManifestRepository;
	packages: PackageRepository;
	modules: ModuleRepository;
	docs: DocRepository;
	sections: SectionRepository;
	chunks: ChunkRepository;
	skills: SkillRepository;
	summaries: SummaryRepository;
}

/** Resolved topology snapshot for a repo build or sync pass. */
export interface RepoTopologySnapshot {
	packages: PackageNode[];
	modules: ModuleNode[];
	docs: ClassifiedDoc[];
	skills: SkillNode[];
}

/** Stable dependency contract consumed by indexer internals. */
export interface IndexerDependencies {
	config: ResolvedAtlasConfig;
	db: AtlasStoreClient;
	store: IndexerStoreRepositories;
	chunking: ChunkingOptions;
	compilerVersion: string;
	storeSchemaVersion: number;
	resolveRepo(repoId: string): RepoConfig;
	listRepos(): RepoConfig[];
	getSourceAdapter(repo: RepoConfig): RepoSourceAdapter;
	getManagedSourceAdapter(
		repo: RepoConfig,
	): RepoSourceAdapter | RepoCacheService;
	resolveTopology(
		repo: RepoConfig,
		adapter: RepoSourceAdapter,
	): Promise<RepoTopologySnapshot>;
	withDiagnostics<T>(
		operation: () => Promise<T>,
	): Promise<{ result: T; diagnostics: IndexerSourceDiagnostic[] }>;
}

/** Source adapter diagnostic event captured for one indexer operation. */
export type IndexerSourceDiagnostic =
	| ({ source: "local-git" } & SourceGitDiagnosticEvent)
	| ({ source: "ghes-api" } & GhesSourceDiagnosticEvent);

/** Options for constructing the shared indexer service graph. */
export interface CreateIndexerServicesOptions {
	config: ResolvedAtlasConfig;
	db: AtlasStoreClient;
	chunkingPolicy?: Partial<IndexerChunkingPolicy> | undefined;
	ghesFetch?: GhesFetch | undefined;
}

/** Creates the shared indexer dependency graph and service entrypoints. */
export function createIndexerServices(options: CreateIndexerServicesOptions): {
	deps: IndexerDependencies;
	service: IndexerService;
} {
	const repoById = new Map(
		options.config.config.repos.map(
			(repo) => [repo.repoId, toCoreRepoConfig(repo, options.config)] as const,
		),
	);
	const diagnostics = new AsyncLocalStorage<IndexerSourceDiagnostic[]>();
	const localGitCache = new RepoCacheService({
		onDiagnostic: (event) =>
			diagnostics.getStore()?.push({ source: "local-git", ...event }),
	});
	const localGitAdapter = new LocalGitSourceAdapter({
		cacheService: localGitCache,
		onDiagnostic: (event) =>
			diagnostics.getStore()?.push({ source: "local-git", ...event }),
	});
	const ghesAdapter = new GhesSourceAdapter({
		authByRepoId: buildGhesAuthByRepoId(options.config),
		...(options.ghesFetch === undefined ? {} : { fetch: options.ghesFetch }),
		onDiagnostic: (event) =>
			diagnostics.getStore()?.push({ source: "ghes-api", ...event }),
	});
	const chunking = {
		encoding: DEFAULT_ENCODING,
		maxTokens: 800,
		overlapTokens: 80,
		preserveSectionBoundaries: true,
		includeTokenIds: false,
		...options.chunkingPolicy?.chunking,
	} satisfies ChunkingOptions;

	const deps: IndexerDependencies = {
		config: options.config,
		db: options.db,
		store: {
			repos: new RepoRepository(options.db),
			manifests: new ManifestRepository(options.db),
			packages: new PackageRepository(options.db),
			modules: new ModuleRepository(options.db),
			docs: new DocRepository(options.db),
			sections: new SectionRepository(options.db),
			chunks: new ChunkRepository(options.db),
			skills: new SkillRepository(options.db),
			summaries: new SummaryRepository(options.db),
		},
		chunking,
		compilerVersion: ATLAS_COMPILER_VERSION,
		storeSchemaVersion: STORE_SCHEMA_VERSION,
		resolveRepo(repoId: string): RepoConfig {
			const repo = repoById.get(repoId);
			if (!repo) {
				throw new IndexerConfigurationError(
					`Repository ${repoId} is not configured.`,
					{
						operation: "resolveRepo",
						stage: "targeting",
						repoId,
					},
				);
			}
			return repo;
		},
		listRepos(): RepoConfig[] {
			return [...repoById.values()];
		},
		getSourceAdapter(repo: RepoConfig): RepoSourceAdapter {
			if (repo.mode === "local-git") {
				return localGitAdapter;
			}
			if (repo.mode === "ghes-api") {
				return ghesAdapter;
			}
			throw new IndexerConfigurationError(
				`Repository mode ${repo.mode} is not supported by the current indexer runtime.`,
				{
					operation: "resolveSourceAdapter",
					stage: "source",
					repoId: repo.repoId,
					entity: repo.mode,
				},
			);
		},
		getManagedSourceAdapter(
			repo: RepoConfig,
		): RepoSourceAdapter | RepoCacheService {
			if (repo.mode === "local-git") {
				return localGitCache;
			}
			if (repo.mode === "ghes-api") {
				return ghesAdapter;
			}
			throw new IndexerConfigurationError(
				`Repository mode ${repo.mode} is not supported by the current indexer runtime.`,
				{
					operation: "resolveSourceAdapter",
					stage: "source",
					repoId: repo.repoId,
					entity: repo.mode,
				},
			);
		},
		async resolveTopology(
			repo: RepoConfig,
			adapter: RepoSourceAdapter,
		): Promise<RepoTopologySnapshot> {
			const files = await adapter.listFiles(repo);
			const ctx: TopologyContext = {
				repoId: repo.repoId,
				rootPath:
					repo.mode === "local-git"
						? (repo.git?.localPath ?? repo.workspace.rootPath)
						: repo.workspace.rootPath,
				files,
				workspace: {
					rootPath: repo.workspace.rootPath,
					packageGlobs: repo.workspace.packageGlobs,
					packageManifestFiles: repo.workspace.packageManifestFiles,
				},
				rules: repo.topology,
			};
			const selectedAdapter = await selectTopologyAdapter(ctx);
			const packages = await selectedAdapter.discoverPackages(ctx);
			const modules = await selectedAdapter.discoverModules(ctx, packages);
			const docs = await selectedAdapter.classifyDocs(ctx, files);
			const skills = selectedAdapter.classifySkills
				? await selectedAdapter.classifySkills(ctx, files)
				: [];
			return { packages, modules, docs, skills };
		},
		async withDiagnostics<T>(
			operation: () => Promise<T>,
		): Promise<{ result: T; diagnostics: IndexerSourceDiagnostic[] }> {
			const events: IndexerSourceDiagnostic[] = [];
			const result = await diagnostics.run(events, operation);
			return { result, diagnostics: events };
		},
	};

	return {
		deps,
		service: {
			syncRepo: (repoId: string) => syncRepo(repoId, deps),
			syncAll: (syncOptions) => syncAll(syncOptions ?? {}, deps),
			buildRepo: (repoId: string, buildOptions) =>
				buildRepo(repoId, buildOptions ?? {}, deps),
			buildAll: (buildOptions) => buildAll(buildOptions ?? {}, deps),
		},
	};
}

function buildGhesAuthByRepoId(
	config: ResolvedAtlasConfig,
): Record<string, GhesAuthConfig> {
	return Object.fromEntries(
		Object.entries(config.ghesAuth ?? {}).map(([repoId, auth]) => [
			repoId,
			{
				kind: "token",
				token: auth.token,
			} satisfies GhesAuthConfig,
		]),
	);
}

function toCoreRepoConfig(
	repo: ResolvedAtlasConfig["config"]["repos"][number],
	config: ResolvedAtlasConfig,
): RepoConfig {
	const topology = repo.topology.map((rule) => ({
		id: rule.id,
		kind: rule.kind,
		match: {
			include: [...rule.match.include],
			...(rule.match.exclude === undefined
				? {}
				: { exclude: [...rule.match.exclude] }),
		},
		ownership: {
			attachTo: rule.ownership.attachTo,
			...(rule.ownership.deriveFromPath === undefined
				? {}
				: { deriveFromPath: rule.ownership.deriveFromPath }),
			...(rule.ownership.packageRootPattern === undefined
				? {}
				: { packageRootPattern: rule.ownership.packageRootPattern }),
			...(rule.ownership.moduleRootPattern === undefined
				? {}
				: { moduleRootPattern: rule.ownership.moduleRootPattern }),
			...(rule.ownership.skillPattern === undefined
				? {}
				: { skillPattern: rule.ownership.skillPattern }),
		},
		authority: rule.authority,
		priority: rule.priority,
	}));
	return {
		repoId: repo.repoId,
		mode: repo.mode,
		...(repo.priority === undefined ? {} : { priority: repo.priority }),
		...(repo.git === undefined ? {} : { git: repo.git }),
		...(repo.github === undefined ? {} : { github: repo.github }),
		workspace: {
			rootPath:
				repo.mode === "local-git"
					? (repo.git?.localPath ?? dirname(config.source.configPath))
					: dirname(config.source.configPath),
			packageGlobs: repo.workspace.packageGlobs,
			packageManifestFiles: repo.workspace.packageManifestFiles,
		},
		topology,
		docs: config.config.docs,
	};
}
