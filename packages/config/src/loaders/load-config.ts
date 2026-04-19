import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";

import { type AtlasConfig, atlasConfigSchema } from "../atlas-config.schema";
import {
	buildDefaultConfig,
	buildDefaultCorpusDbPath,
	defaultHttpServerConfig,
} from "../defaults/default-config";
import type { AtlasEnv } from "../env.schema";
import { resolveIdentityProfile } from "../white-label/profile";
import {
	type GhesCommandRunner,
	ghesHostname,
	type ResolvedGhesToken,
	resolveGhesAuth,
} from "./ghes-auth";
import { loadEnv } from "./load-env";

export type LoadConfigOptions = {
	cwd?: string;
	configPath?: string;
	env?: NodeJS.ProcessEnv;
	requireGhesAuth?: boolean;
	runCommand?: GhesCommandRunner;
};

export type ResolvedAtlasConfig = {
	config: AtlasConfig;
	source: {
		configPath: string;
		loadedFrom: "env" | "explicit" | "discovered";
	};
	env: AtlasEnv;
	ghesAuth?: Record<string, ResolvedGhesToken> | undefined;
};

export class AtlasConfigError extends Error {
	readonly code: string;
	readonly filePath?: string;
	readonly fieldPath?: string;

	constructor(
		message: string,
		options: {
			code: string;
			filePath?: string;
			fieldPath?: string;
			cause?: unknown;
		},
	) {
		super(message, { cause: options.cause });
		this.name = this.constructor.name;
		this.code = options.code;
		if (options.filePath) {
			this.filePath = options.filePath;
		}
		if (options.fieldPath) {
			this.fieldPath = options.fieldPath;
		}
	}
}

export class AtlasConfigNotFoundError extends AtlasConfigError {
	constructor(candidates: string[]) {
		super(`ATLAS config file not found. Checked: ${candidates.join(", ")}`, {
			code: "ATLAS_CONFIG_NOT_FOUND",
		});
	}
}

export class AtlasConfigReadError extends AtlasConfigError {
	constructor(filePath: string, cause: unknown) {
		super(`Unable to read ATLAS config file: ${filePath}`, {
			code: "ATLAS_CONFIG_UNREADABLE",
			filePath,
			cause,
		});
	}
}

export class AtlasConfigParseError extends AtlasConfigError {
	constructor(filePath: string, cause: unknown) {
		super(`Unable to parse ATLAS config file: ${filePath}`, {
			code: "ATLAS_CONFIG_PARSE_FAILED",
			filePath,
			cause,
		});
	}
}

export class AtlasConfigValidationError extends AtlasConfigError {
	readonly issues: string[];

	constructor(filePath: string, issues: string[], cause: unknown) {
		super(`Invalid ATLAS config in ${filePath}: ${issues.join("; ")}`, {
			code: "ATLAS_CONFIG_VALIDATION_FAILED",
			filePath,
			cause,
		});
		this.issues = issues;
	}
}

export class AtlasConfigPathError extends AtlasConfigError {
	constructor(fieldPath: string, value: string, cause: unknown) {
		super(`Invalid path for ${fieldPath}: ${value}`, {
			code: "ATLAS_CONFIG_INVALID_PATH",
			fieldPath,
			cause,
		});
	}
}

const CONFIG_FILE_NAMES = [
	"atlas.config.yaml",
	"atlas.config.yml",
	"atlas.config.json",
] as const;

const fileExists = async (filePath: string): Promise<boolean> => {
	try {
		return await Bun.file(filePath).exists();
	} catch {
		return false;
	}
};

const resolvePathInput = (
	inputPath: string,
	baseDir: string,
	fieldPath: string,
): string => {
	try {
		const expandedPath =
			inputPath === "~" || inputPath.startsWith("~/")
				? join(homedir(), inputPath.slice(2))
				: inputPath;

		return normalize(
			isAbsolute(expandedPath) ? expandedPath : resolve(baseDir, expandedPath),
		);
	} catch (error) {
		throw new AtlasConfigPathError(fieldPath, inputPath, error);
	}
};

const resolveConfigPath = async (
	cwd: string,
	explicitConfigPath: string | undefined,
	envConfigPath: string | undefined,
): Promise<{
	configPath: string;
	loadedFrom: "env" | "explicit" | "discovered";
}> => {
	const baseDir = resolve(cwd);

	if (explicitConfigPath) {
		const configPath = resolvePathInput(
			explicitConfigPath,
			baseDir,
			"configPath",
		);
		if (!(await fileExists(configPath))) {
			throw new AtlasConfigNotFoundError([configPath]);
		}

		return {
			configPath,
			loadedFrom: "explicit",
		};
	}

	if (envConfigPath) {
		const configPath = resolvePathInput(envConfigPath, baseDir, "ATLAS_CONFIG");
		if (!(await fileExists(configPath))) {
			throw new AtlasConfigNotFoundError([configPath]);
		}

		return {
			configPath,
			loadedFrom: "env",
		};
	}

	const candidates = CONFIG_FILE_NAMES.map((fileName) =>
		resolve(baseDir, fileName),
	);

	for (const candidate of candidates) {
		if (await fileExists(candidate)) {
			return {
				configPath: candidate,
				loadedFrom: "discovered",
			};
		}
	}

	throw new AtlasConfigNotFoundError(candidates);
};

const readConfigFile = async (configPath: string): Promise<string> => {
	try {
		return await Bun.file(configPath).text();
	} catch (error) {
		throw new AtlasConfigReadError(configPath, error);
	}
};

const readJsonConfigFile = async (configPath: string): Promise<unknown> => {
	try {
		return await Bun.file(configPath).json();
	} catch (error) {
		throw new AtlasConfigParseError(configPath, error);
	}
};

const parseYamlConfig = (configPath: string, rawContent: string): unknown => {
	try {
		return parseYaml(rawContent) as unknown;
	} catch (error) {
		throw new AtlasConfigParseError(configPath, error);
	}
};

const readRawConfigFile = async (configPath: string): Promise<unknown> => {
	if (configPath.endsWith(".json")) {
		return await readJsonConfigFile(configPath);
	}

	if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
		return parseYamlConfig(configPath, await readConfigFile(configPath));
	}

	throw new AtlasConfigParseError(
		configPath,
		new Error("Supported config extensions are .yaml, .yml, and .json"),
	);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const mergeWithDefaults = (rawConfig: unknown, env: AtlasEnv): unknown => {
	if (!isRecord(rawConfig)) {
		return rawConfig;
	}

	const rawIdentity = isRecord(rawConfig.identity)
		? rawConfig.identity
		: undefined;
	const identityProfile = resolveIdentityProfile({
		envIdentityRoot: env.ATLAS_IDENTITY_ROOT,
		configIdentity:
			rawIdentity === undefined
				? undefined
				: {
					...(typeof rawIdentity.root === "string" ? { root: rawIdentity.root } : {}),
					...(isRecord(rawIdentity.mcp)
						? {
							mcp: {
								...(typeof rawIdentity.mcp.name === "string" ? { name: rawIdentity.mcp.name } : {}),
								...(typeof rawIdentity.mcp.title === "string" ? { title: rawIdentity.mcp.title } : {}),
								...(typeof rawIdentity.mcp.resourcePrefix === "string" ? { resourcePrefix: rawIdentity.mcp.resourcePrefix } : {}),
							},
						}
						: {}),
				},
		mcp: {
			envMcpName: env.ATLAS_MCP_NAME,
			envMcpTitle: env.ATLAS_MCP_TITLE,
		},
	});
	const fileCacheDir =
		typeof rawConfig.cacheDir === "string" ? rawConfig.cacheDir : undefined;
	const effectiveCacheDir =
		env.ATLAS_CACHE_DIR ?? fileCacheDir ?? identityProfile.runtimeRoot;
	const defaults = buildDefaultConfig(effectiveCacheDir);
	const rawServer = isRecord(rawConfig.server) ? rawConfig.server : {};
	const hasExplicitCorpusDbPath = typeof rawConfig.corpusDbPath === "string";
	const serverWithDefaults =
		rawServer.transport === "http"
			? {
					...defaultHttpServerConfig,
					...rawServer,
				}
			: {
					...defaults.server,
					...rawServer,
				};

	return {
		...defaults,
		...rawConfig,
		version: rawConfig.version,
		cacheDir: effectiveCacheDir ?? defaults.cacheDir,
		corpusDbPath: hasExplicitCorpusDbPath
			? rawConfig.corpusDbPath
			: buildDefaultCorpusDbPath(effectiveCacheDir ?? defaults.cacheDir),
		server: serverWithDefaults,
		repos: Array.isArray(rawConfig.repos) ? rawConfig.repos : defaults.repos,
	};
};

const applyEnvOverrides = (config: unknown, env: AtlasEnv): unknown => {
	if (!isRecord(config)) {
		return config;
	}

	return {
		...config,
		...(env.ATLAS_CACHE_DIR ? { cacheDir: env.ATLAS_CACHE_DIR } : {}),
		...(env.ATLAS_LOG_LEVEL ? { logLevel: env.ATLAS_LOG_LEVEL } : {}),
	};
};

const normalizeResolvedPaths = (
	config: AtlasConfig,
	configDir: string,
	env: AtlasEnv,
): AtlasConfig => {
	const cacheDir = resolvePathInput(config.cacheDir, configDir, "cacheDir");
	const corpusDbPath = resolvePathInput(
		config.corpusDbPath,
		configDir,
		"corpusDbPath",
	);
	const normalizedRepos = config.repos.map((repo) => {
		if (repo.mode === "local-git" && repo.git) {
			return {
				...repo,
				git: {
					...repo.git,
					localPath: resolvePathInput(
						repo.git.localPath,
						configDir,
						`repos.${repo.repoId}.git.localPath`,
					),
				},
			};
		}

		return repo;
	});

	if (env.ATLAS_CA_CERT_PATH) {
		resolvePathInput(env.ATLAS_CA_CERT_PATH, configDir, "ATLAS_CA_CERT_PATH");
	}

	return {
		...config,
		cacheDir,
		corpusDbPath,
		repos: normalizedRepos,
	};
};

const normalizeResolvedEnv = (
	env: AtlasEnv,
	cwd: string,
	configDir: string,
): AtlasEnv => ({
	...env,
	...(env.ATLAS_CONFIG
		? {
				ATLAS_CONFIG: normalize(
					isAbsolute(env.ATLAS_CONFIG)
						? env.ATLAS_CONFIG
						: resolve(cwd, env.ATLAS_CONFIG),
				),
			}
		: {}),
	...(env.ATLAS_CACHE_DIR
		? {
				ATLAS_CACHE_DIR: resolvePathInput(
					env.ATLAS_CACHE_DIR,
					configDir,
					"ATLAS_CACHE_DIR",
				),
			}
		: {}),
	...(env.ATLAS_CA_CERT_PATH
		? {
				ATLAS_CA_CERT_PATH: resolvePathInput(
					env.ATLAS_CA_CERT_PATH,
					configDir,
					"ATLAS_CA_CERT_PATH",
				),
			}
		: {}),
});

const formatConfigIssues = (error: ZodError): string[] =>
	error.issues.map((issue) => {
		const path = issue.path.join(".");

		return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
	});

export const resolveAtlasConfig = (
	rawConfig: unknown,
	configPath: string,
	env: AtlasEnv,
	rawEnv: NodeJS.ProcessEnv = process.env,
	options: { requireGhesAuth?: boolean | undefined } = {},
): AtlasConfig => {
	void rawEnv;
	void options;
	const configDir = dirname(configPath);
	const mergedConfig = applyEnvOverrides(
		mergeWithDefaults(rawConfig, env),
		env,
	);
	const parsedConfig = atlasConfigSchema.safeParse(mergedConfig);

	if (!parsedConfig.success) {
		throw new AtlasConfigValidationError(
			configPath,
			formatConfigIssues(parsedConfig.error),
			parsedConfig.error,
		);
	}

	const normalizedConfig = normalizeResolvedPaths(
		parsedConfig.data,
		configDir,
		env,
	);
	return normalizedConfig;
};

const missingGhesAuthIssues = (
	config: AtlasConfig,
	auth: ResolvedAtlasConfig["ghesAuth"],
): string[] =>
	config.repos.flatMap((repo) => {
		if (
			repo.mode !== "ghes-api" ||
			repo.github === undefined ||
			auth?.[repo.repoId] !== undefined
		) {
			return [];
		}
		return [
			`repos.${repo.repoId}.github.auth: no token found; set ${repo.github.tokenEnvVar ?? "GHES_TOKEN"}, GH_ENTERPRISE_TOKEN, GH_TOKEN, GITHUB_TOKEN, or run gh auth login --hostname ${ghesHostname(repo.github.baseUrl)}`,
		];
	});

export const loadConfig = async (
	options: LoadConfigOptions = {},
): Promise<ResolvedAtlasConfig> => {
	const rawEnv = options.env ?? process.env;
	const env = await loadEnv(rawEnv);
	const cwd = options.cwd ?? process.cwd();
	const source = await resolveConfigPath(
		cwd,
		options.configPath,
		env.ATLAS_CONFIG,
	);
	const rawConfig = await readRawConfigFile(source.configPath);
	const configDir = dirname(source.configPath);

	const config = resolveAtlasConfig(rawConfig, source.configPath, env, rawEnv, {
		requireGhesAuth: options.requireGhesAuth,
	});
	const ghesAuth = await resolveGhesAuth(config, {
		env: rawEnv,
		...(options.runCommand === undefined
			? {}
			: { runCommand: options.runCommand }),
	});
	if (options.requireGhesAuth !== false) {
		const issues = missingGhesAuthIssues(config, ghesAuth);
		if (issues.length > 0) {
			throw new AtlasConfigValidationError(
				source.configPath,
				issues,
				undefined,
			);
		}
	}

	return {
		config,
		source,
		env: normalizeResolvedEnv(env, cwd, configDir),
		...(ghesAuth === undefined ? {} : { ghesAuth }),
	};
};
