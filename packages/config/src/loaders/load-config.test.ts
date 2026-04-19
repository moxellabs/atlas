import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AtlasEnv } from "../env.schema";
import {
	AtlasConfigNotFoundError,
	AtlasConfigParseError,
	AtlasConfigValidationError,
	loadConfig,
	resolveAtlasConfig,
} from "./load-config";

const emptyEnv: AtlasEnv = {};

const validYamlConfig = `
version: 1
cacheDir: .atlas-cache
logLevel: info
server:
  transport: http
  port: 4321
repos:
  - repoId: github.mycorp.com/platform/docs
    mode: local-git
    git:
      remote: ssh://git@ghe.example.com/platform/identity.git
      localPath: repos/identity
      ref: main
    workspace:
      packageGlobs:
        - packages/*
      packageManifestFiles:
        - package.json
    topology:
      - id: repo-docs
        kind: repo-doc
        match:
          include:
            - docs/**/*.md
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`;

function ghesConfig() {
	return {
		version: 1,
		cacheDir: ".cache",
		logLevel: "warn",
		repos: [
			{
				repoId: "github.mycorp.com/platform/docs",
				mode: "ghes-api",
				github: {
					baseUrl: "https://ghe.example.com/api/v3",
					owner: "platform",
					name: "platform",
					ref: "main",
				},
				workspace: {
					packageGlobs: ["packages/*"],
					packageManifestFiles: ["package.json"],
				},
				topology: [
					{
						id: "repo-docs",
						kind: "repo-doc",
						match: { include: ["docs/**/*.md"] },
						ownership: { attachTo: "repo" },
						authority: "canonical",
						priority: 10,
					},
				],
			},
		],
	};
}

describe("loadConfig", () => {
	let fixtureDir: string;

	beforeEach(async () => {
		fixtureDir = await mkdtemp(join(tmpdir(), "atlas-config-test-"));
	});

	afterEach(async () => {
		await rm(fixtureDir, { recursive: true, force: true });
	});

	test("discovers and loads YAML config files", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(configPath, validYamlConfig);

		const resolved = await loadConfig({ cwd: fixtureDir, env: {} });

		expect(resolved.source).toEqual({
			configPath,
			loadedFrom: "discovered",
		});
		expect(resolved.config.version).toBe(1);
		expect(resolved.config.repos[0]?.repoId).toBe(
			"github.mycorp.com/platform/docs",
		);
	});

	test("uses ATLAS_CONFIG before discovery", async () => {
		const discoveredPath = join(fixtureDir, "atlas.config.yaml");
		const explicitPath = join(fixtureDir, "custom.yaml");
		await writeFile(
			discoveredPath,
			validYamlConfig.replace(
				"repoId: github.mycorp.com/platform/docs",
				"repoId: ignored",
			),
		);
		await writeFile(explicitPath, validYamlConfig);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				ATLAS_CONFIG: explicitPath,
			},
		});

		expect(resolved.source.loadedFrom).toBe("env");
		expect(resolved.source.configPath).toBe(explicitPath);
		expect(resolved.config.repos[0]?.repoId).toBe(
			"github.mycorp.com/platform/docs",
		);
	});

	test("normalizes resolved env path values when loading config", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(configPath, validYamlConfig);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				ATLAS_CONFIG: "atlas.config.yaml",
				ATLAS_CACHE_DIR: "runtime-cache",
				ATLAS_CA_CERT_PATH: "certs/company.pem",
			},
		});

		expect(resolved.env.ATLAS_CONFIG).toBe(configPath);
		expect(resolved.env.ATLAS_CACHE_DIR).toBe(
			join(fixtureDir, "runtime-cache"),
		);
		expect(resolved.env.ATLAS_CA_CERT_PATH).toBe(
			join(fixtureDir, "certs", "company.pem"),
		);
	});

	test("wraps YAML parse failures in structured errors", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(configPath, "version: 1\nrepos:\n  - repoId: [");

		await expect(
			loadConfig({ cwd: fixtureDir, env: {} }),
		).rejects.toMatchObject({
			code: "ATLAS_CONFIG_PARSE_FAILED",
			filePath: configPath,
		});
		await expect(loadConfig({ cwd: fixtureDir, env: {} })).rejects.toThrow(
			AtlasConfigParseError,
		);
	});

	test("loads JSON config files", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(
			configPath,
			JSON.stringify({
				version: 1,
				cacheDir: ".cache",
				logLevel: "warn",
				repos: [
					{
						repoId: "github.mycorp.com/platform/docs",
						mode: "ghes-api",
						github: {
							baseUrl: "https://ghe.example.com",
							owner: "platform",
							name: "platform",
							ref: "main",
						},
						workspace: {
							packageGlobs: ["packages/*"],
							packageManifestFiles: ["package.json"],
						},
						topology: [
							{
								id: "repo-docs",
								kind: "repo-doc",
								match: { include: ["docs/**/*.md"] },
								ownership: { attachTo: "repo" },
								authority: "canonical",
								priority: 10,
							},
						],
					},
				],
			}),
		);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: { GHES_TOKEN: "token" },
		});

		expect(resolved.config.repos[0]?.mode).toBe("ghes-api");
		expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBeUndefined();
	});

	test("wraps JSON parse failures in structured errors", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(configPath, "{");

		await expect(
			loadConfig({ cwd: fixtureDir, env: {} }),
		).rejects.toMatchObject({
			code: "ATLAS_CONFIG_PARSE_FAILED",
			filePath: configPath,
		});
		await expect(loadConfig({ cwd: fixtureDir, env: {} })).rejects.toThrow(
			AtlasConfigParseError,
		);
	});

	test("rejects invalid GHES base URLs with field-specific validation", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [
						{
							repoId: "github.mycorp.com/platform/docs",
							mode: "ghes-api",
							github: {
								baseUrl: "not-a-url",
								owner: "platform",
								name: "platform",
								ref: "main",
							},
							workspace: {
								packageGlobs: ["packages/*"],
								packageManifestFiles: ["package.json"],
							},
							topology: [
								{
									id: "repo-docs",
									kind: "repo-doc",
									match: { include: ["docs/**/*.md"] },
									ownership: { attachTo: "repo" },
									authority: "canonical",
									priority: 10,
								},
							],
						},
					],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
				{ GHES_TOKEN: "token" },
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("requires a resolvable token for GHES repos", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(
			configPath,
			JSON.stringify({
				version: 1,
				cacheDir: ".cache",
				logLevel: "warn",
				repos: [
					{
						repoId: "github.mycorp.com/platform/docs",
						mode: "ghes-api",
						github: {
							baseUrl: "https://ghe.example.com",
							owner: "platform",
							name: "platform",
							ref: "main",
							tokenEnvVar: "CUSTOM_GHES_TOKEN",
						},
						workspace: {
							packageGlobs: ["packages/*"],
							packageManifestFiles: ["package.json"],
						},
						topology: [
							{
								id: "repo-docs",
								kind: "repo-doc",
								match: { include: ["docs/**/*.md"] },
								ownership: { attachTo: "repo" },
								authority: "canonical",
								priority: 10,
							},
						],
					},
				],
			}),
		);

		await expect(
			loadConfig({
				cwd: fixtureDir,
				env: {},
				runCommand: async () => ({
					exitCode: 1,
					stdout: "",
					stderr: "missing auth",
				}),
			}),
		).rejects.toThrow(AtlasConfigValidationError);
	});

	test("can load GHES config without auth for diagnostics", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(
			configPath,
			`
version: 1
cacheDir: .atlas-cache
logLevel: info
server:
  transport: http
repos:
  - repoId: github.mycorp.com/platform/docs
    mode: ghes-api
    github:
      baseUrl: https://ghe.example.com/api/v3
      owner: platform
      name: identity
      ref: main
      tokenEnvVar: CUSTOM_GHES_TOKEN
    workspace:
      packageGlobs: ["packages/*"]
      packageManifestFiles: ["package.json"]
    topology:
      - id: repo-docs
        kind: repo-doc
        match:
          include: ["docs/**/*.md"]
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`,
		);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {},
			requireGhesAuth: false,
		});

		expect(resolved.config.repos[0]).toMatchObject({
			repoId: "github.mycorp.com/platform/docs",
			mode: "ghes-api",
			github: expect.objectContaining({ tokenEnvVar: "CUSTOM_GHES_TOKEN" }),
		});
		expect(resolved.ghesAuth).toBeUndefined();
	});

	test("accepts custom token env vars for GHES repos", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(
			configPath,
			JSON.stringify({
				version: 1,
				cacheDir: ".cache",
				logLevel: "warn",
				repos: [
					{
						repoId: "github.mycorp.com/platform/docs",
						mode: "ghes-api",
						github: {
							baseUrl: "https://ghe.example.com",
							owner: "platform",
							name: "platform",
							ref: "main",
							tokenEnvVar: "CUSTOM_GHES_TOKEN",
						},
						workspace: {
							packageGlobs: ["packages/*"],
							packageManifestFiles: ["package.json"],
						},
						topology: [
							{
								id: "repo-docs",
								kind: "repo-doc",
								match: { include: ["docs/**/*.md"] },
								ownership: { attachTo: "repo" },
								authority: "canonical",
								priority: 10,
							},
						],
					},
				],
			}),
		);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				CUSTOM_GHES_TOKEN: "token",
			},
		});

		expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBe(
			"CUSTOM_GHES_TOKEN",
		);
		expect(resolved.ghesAuth).toEqual({
			"github.mycorp.com/platform/docs": {
				kind: "token",
				source: "env",
				sourceName: "CUSTOM_GHES_TOKEN",
				token: "token",
			},
		});
		expect(resolved.env).toEqual({});
	});

	test("resolves GHES auth from standard env vars without repo-specific token config", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(configPath, JSON.stringify(ghesConfig()));

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				GH_ENTERPRISE_TOKEN: "enterprise-token",
			},
		});

		expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBeUndefined();
		expect(resolved.ghesAuth?.["github.mycorp.com/platform/docs"]).toEqual({
			kind: "token",
			source: "env",
			sourceName: "GH_ENTERPRISE_TOKEN",
			token: "enterprise-token",
		});
	});

	test("resolves GHES auth from gh CLI credentials", async () => {
		const configPath = join(fixtureDir, "atlas.config.json");
		await writeFile(configPath, JSON.stringify(ghesConfig()));

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {},
			runCommand: async (command) => {
				expect(command).toEqual([
					"gh",
					"auth",
					"token",
					"--hostname",
					"ghe.example.com",
				]);
				return { exitCode: 0, stdout: "gh-token\n", stderr: "" };
			},
		});

		expect(resolved.ghesAuth?.["github.mycorp.com/platform/docs"]).toEqual({
			kind: "token",
			source: "gh-cli",
			sourceName: "gh:ghe.example.com",
			token: "gh-token",
		});
	});

	test("resolves relative paths against the config directory", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(configPath, validYamlConfig);

		const resolved = await loadConfig({ cwd: fixtureDir, env: {} });

		expect(resolved.config.cacheDir).toBe(join(fixtureDir, ".atlas-cache"));
		expect(resolved.config.corpusDbPath).toBe(
			join(fixtureDir, ".atlas-cache", "corpus.db"),
		);
		expect(resolved.config.repos[0]?.git?.localPath).toBe(
			join(fixtureDir, "repos", "identity"),
		);
	});

	test("expands tilde paths explicitly", () => {
		const config = resolveAtlasConfig(
			{
				version: 1,
				cacheDir: "~/.moxel/atlas",
				logLevel: "warn",
				repos: [],
			},
			join(fixtureDir, "atlas.config.yaml"),
			emptyEnv,
		);

		expect(config.cacheDir).toBe(join(homedir(), ".moxel", "atlas"));
		expect(config.corpusDbPath).toBe(
			join(homedir(), ".moxel", "atlas", "corpus.db"),
		);
	});

	test("derives runtime paths from identity root", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(
			configPath,
			"version: 1\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .acme/knowledge\nrepos: []\n",
		);

		const resolved = await loadConfig({ cwd: fixtureDir, env: {} });

		expect(resolved.config.cacheDir).toBe(
			join(homedir(), ".acme", "knowledge"),
		);
		expect(resolved.config.corpusDbPath).toBe(
			join(homedir(), ".acme", "knowledge", "corpus.db"),
		);
	});

	test("explicit runtime paths override identity root", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(
			configPath,
			"version: 1\ncacheDir: explicit-cache\ncorpusDbPath: explicit-db/corpus.sqlite\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .acme/knowledge\nrepos: []\n",
		);

		const resolved = await loadConfig({ cwd: fixtureDir, env: {} });

		expect(resolved.config.cacheDir).toBe(join(fixtureDir, "explicit-cache"));
		expect(resolved.config.corpusDbPath).toBe(
			join(fixtureDir, "explicit-db", "corpus.sqlite"),
		);
	});

	test("applies env overrides after file values", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(configPath, validYamlConfig);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				ATLAS_CACHE_DIR: "runtime-cache",
				ATLAS_LOG_LEVEL: "debug",
			},
		});

		expect(resolved.config.cacheDir).toBe(join(fixtureDir, "runtime-cache"));
		expect(resolved.config.corpusDbPath).toBe(
			join(fixtureDir, "runtime-cache", "corpus.db"),
		);
		expect(resolved.config.logLevel).toBe("debug");
	});

	test("preserves explicit corpusDbPath when ATLAS_CACHE_DIR overrides cacheDir", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(
			configPath,
			validYamlConfig.replace(
				"cacheDir: .atlas-cache",
				"cacheDir: .atlas-cache\ncorpusDbPath: explicit/db.sqlite",
			),
		);

		const resolved = await loadConfig({
			cwd: fixtureDir,
			env: {
				ATLAS_CACHE_DIR: "runtime-cache",
			},
		});

		expect(resolved.config.cacheDir).toBe(join(fixtureDir, "runtime-cache"));
		expect(resolved.config.corpusDbPath).toBe(
			join(fixtureDir, "explicit", "db.sqlite"),
		);
	});

	test("rejects configs without an explicit version", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("applies HTTP server defaults only for HTTP transport", () => {
		const config = resolveAtlasConfig(
			{
				version: 1,
				cacheDir: ".cache",
				logLevel: "warn",
				server: {
					transport: "http",
				},
				repos: [],
			},
			join(fixtureDir, "atlas.config.yaml"),
			emptyEnv,
		);

		expect(config.server).toEqual({
			transport: "http",
			host: "127.0.0.1",
			port: 3711,
		});
	});

	test("rejects host and port for stdio transport", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					server: {
						transport: "stdio",
						host: "127.0.0.1",
						port: 3711,
					},
					repos: [],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("rejects duplicate repo ids", async () => {
		const configPath = join(fixtureDir, "atlas.config.yaml");
		await writeFile(
			configPath,
			`${validYamlConfig}\n${validYamlConfig.split("repos:")[1] ?? ""}`,
		);

		await expect(loadConfig({ cwd: fixtureDir, env: {} })).rejects.toThrow(
			AtlasConfigValidationError,
		);
	});

	test("rejects incompatible repo mode fields", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [
						{
							repoId: "github.mycorp.com/platform/docs",
							mode: "local-git",
							git: {
								remote: "ssh://git@ghe.example.com/platform/identity.git",
								localPath: "repos/identity",
								ref: "main",
							},
							github: {
								baseUrl: "https://ghe.example.com",
								owner: "platform",
								name: "identity",
								ref: "main",
							},
							workspace: {
								packageGlobs: ["packages/*"],
								packageManifestFiles: ["package.json"],
							},
							topology: [
								{
									id: "repo-docs",
									kind: "repo-doc",
									match: { include: ["docs/**/*.md"] },
									ownership: { attachTo: "repo" },
									authority: "canonical",
									priority: 10,
								},
							],
						},
					],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("rejects invalid topology rules", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [
						{
							repoId: "github.mycorp.com/platform/docs",
							mode: "local-git",
							git: {
								remote: "ssh://git@ghe.example.com/platform/identity.git",
								localPath: "repos/identity",
								ref: "main",
							},
							workspace: {
								packageGlobs: ["packages/*"],
								packageManifestFiles: ["package.json"],
							},
							topology: [
								{
									id: "repo-docs",
									kind: "repo-doc",
									match: { include: [] },
									ownership: { attachTo: "repo" },
									authority: "canonical",
									priority: 10,
								},
							],
						},
					],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("rejects duplicate workspace glob and manifest values", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [
						{
							repoId: "github.mycorp.com/platform/docs",
							mode: "local-git",
							git: {
								remote: "ssh://git@ghe.example.com/platform/identity.git",
								localPath: "repos/identity",
								ref: "main",
							},
							workspace: {
								packageGlobs: ["packages/*", "packages/*"],
								packageManifestFiles: ["package.json", "package.json"],
							},
							topology: [
								{
									id: "repo-docs",
									kind: "repo-doc",
									match: { include: ["docs/**/*.md"] },
									ownership: { attachTo: "repo" },
									authority: "canonical",
									priority: 10,
								},
							],
						},
					],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("rejects duplicate topology rule ids", () => {
		expect(() =>
			resolveAtlasConfig(
				{
					version: 1,
					cacheDir: ".cache",
					logLevel: "warn",
					repos: [
						{
							repoId: "github.mycorp.com/platform/docs",
							mode: "local-git",
							git: {
								remote: "ssh://git@ghe.example.com/platform/identity.git",
								localPath: "repos/identity",
								ref: "main",
							},
							workspace: {
								packageGlobs: ["packages/*"],
								packageManifestFiles: ["package.json"],
							},
							topology: [
								{
									id: "repo-docs",
									kind: "repo-doc",
									match: { include: ["docs/**/*.md"] },
									ownership: { attachTo: "repo" },
									authority: "canonical",
									priority: 10,
								},
								{
									id: "repo-docs",
									kind: "guide-doc",
									match: { include: ["guides/**/*.md"] },
									ownership: { attachTo: "repo" },
									authority: "supplemental",
									priority: 20,
								},
							],
						},
					],
				},
				join(fixtureDir, "atlas.config.yaml"),
				emptyEnv,
			),
		).toThrow(AtlasConfigValidationError);
	});

	test("throws a structured not found error when discovery fails", async () => {
		await expect(
			loadConfig({ cwd: fixtureDir, env: {} }),
		).rejects.toMatchObject({
			code: "ATLAS_CONFIG_NOT_FOUND",
		});
		await expect(loadConfig({ cwd: fixtureDir, env: {} })).rejects.toThrow(
			AtlasConfigNotFoundError,
		);
	});

	test("throws a structured not found error when ATLAS_CONFIG points to a missing file", async () => {
		await expect(
			loadConfig({
				cwd: fixtureDir,
				env: {
					ATLAS_CONFIG: "missing.yaml",
				},
			}),
		).rejects.toThrow(AtlasConfigNotFoundError);
	});
});
