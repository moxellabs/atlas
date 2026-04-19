import type { AtlasConfig, AtlasHostConfig } from "../atlas-config.schema";

export const DEFAULT_MOXEL_ATLAS_HOME = "~/.moxel/atlas";
export const DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH = "config.yaml";
export const DEFAULT_MOXEL_ATLAS_CORPUS_DB_RELATIVE_PATH = "corpus.db";
export const DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH = "repos";
export const DEFAULT_REPO_ARTIFACT_RELATIVE_PATH = ".moxel/atlas";
export const DEFAULT_CACHE_DIR = DEFAULT_MOXEL_ATLAS_HOME;
export const DEFAULT_CORPUS_DB_RELATIVE_PATH =
	DEFAULT_MOXEL_ATLAS_CORPUS_DB_RELATIVE_PATH;
export const DEFAULT_SERVER_PORT = 3711;
export const DEFAULT_SERVER_HOST = "127.0.0.1";

export const defaultGithubHostConfig = (): AtlasHostConfig => ({
	name: "github.com",
	webUrl: "https://github.com",
	apiUrl: "https://api.github.com",
	protocol: "ssh",
	priority: 100,
	default: true,
});

export const buildDefaultConfig = (
	cacheDir = DEFAULT_CACHE_DIR,
): AtlasConfig => ({
	version: 1,
	cacheDir,
	corpusDbPath: `${cacheDir}/${DEFAULT_CORPUS_DB_RELATIVE_PATH}`,
	logLevel: "warn",
	server: {
		transport: "stdio",
	},
	hosts: [defaultGithubHostConfig()],
	docs: { metadata: { rules: [], profiles: {} } },
	repos: [],
});

export const defaultHttpServerConfig = {
	transport: "http" as const,
	host: DEFAULT_SERVER_HOST,
	port: DEFAULT_SERVER_PORT,
};

export const defaultConfig: AtlasConfig = buildDefaultConfig();

export const buildDefaultCorpusDbPath = (cacheDir: string): string => {
	const trimmedCacheDir = cacheDir.replace(/\/+$/, "");

	return `${trimmedCacheDir}/${DEFAULT_CORPUS_DB_RELATIVE_PATH}`;
};
