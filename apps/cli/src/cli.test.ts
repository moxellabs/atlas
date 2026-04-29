import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@atlas/config";
import {
	buildArtifactManifest,
	buildDocsIndex,
	exportCorpusDbSnapshot,
	validateArtifactChecksums,
	writeArtifactChecksums,
	writePrettyJson,
} from "@atlas/indexer";
import { ManifestRepository, openStore, RepoRepository } from "@atlas/store";
import { Command } from "commander";
import {
	type AtlasMountConfig,
	attachAtlas,
	createAtlasCommand,
} from "./commander";
import { runMcpCommandWithDependencies } from "./commands/mcp.command";
import { runServeCommandWithDependencies } from "./commands/serve.command";
import { buildFailureLines } from "./commands/shared";
import { runCli } from "./index";
import type { CliCommandContext } from "./runtime/types";
import { CliError, toFailureResult } from "./utils/errors";

describe("atlas cli", () => {
	test("CLI_BUILD_FAILED diagnostics keep stacks verbose-only and render cause chain", () => {
		const report = {
			repoId: "github.mycorp.com/platform/docs",
			strategy: "full",
			docsRebuilt: 0,
			docsDeleted: 0,
			diagnostics: [
				{
					severity: "error",
					stage: "compile",
					path: "packages/auth/docs/api.md",
					message: "Failed to rebuild doc packages/auth/docs/api.md.",
					code: "IndexerBuildError",
					cause: {
						name: "IndexerBuildError",
						message: "Failed to rebuild docs.",
						stack: "IndexerBuildError: redacted stack",
						context: {
							operation: "rebuildDocs",
							repoId: "github.mycorp.com/platform/docs",
							entity: "packages/auth/docs/api.md",
						},
						cause: {
							name: "CompilerError",
							message: "Nested compiler failure",
							stack: "CompilerError: redacted stack",
						},
					},
				},
			],
		};
		const error = new CliError("build failed", {
			code: "CLI_BUILD_FAILED",
			exitCode: 1,
			details: report,
		});

		expect(
			JSON.stringify(toFailureResult("build", error, false)),
		).not.toContain("stack");
		expect(JSON.stringify(toFailureResult("build", error, true))).toContain(
			"CompilerError: redacted stack",
		);
		expect(buildFailureLines(report, false)).toContain(
			"Run again with --verbose --json to see nested cause details.",
		);
		expect(buildFailureLines(report, true).join("\n")).toContain(
			"CompilerError: Nested compiler failure",
		);
		expect(buildFailureLines(report, true).join("\n")).toContain(
			"path: packages/auth/docs/api.md",
		);
	});

	test("mounted Commander API validates namespace and returns parent", () => {
		const program = new Command();
		program.name("userCli");
		expect(attachAtlas(program, { namespace: "acme" })).toBe(program);
		expect(createAtlasCommand({ namespace: "acme" }).name()).toBe("acme");
		expect(() => createAtlasCommand({ namespace: "" })).toThrow(
			"namespace must not be empty",
		);
		expect(() => createAtlasCommand({ namespace: "acme corp" })).toThrow(
			"namespace must be a single command segment",
		);
	});

	test("mount defaults validate supported identity fields only", () => {
		const command = createAtlasCommand({
			namespace: "acme",
			identityRoot: ".acme/knowledge",
			mcp: {
				name: "acme-mcp",
				title: "Acme Local Knowledge MCP",
				resourcePrefix: "acme",
			},
			defaults: {
				config: "./acme-atlas.yaml",
				cacheDir: "~/.acme/knowledge",
				logLevel: "debug",
				caCertPath: "./ca.pem",
			},
		});
		expect(command.name()).toBe("acme");
		expect(() =>
			createAtlasCommand({
				namespace: "acme",
				mcp: { resourcePrefix: "Acme" },
			}),
		).toThrow("identity.mcp.resourcePrefix must be a lower-kebab identifier");
	});

	test("unsupported mount fields are rejected by AtlasMountConfig typing", () => {
		// @ts-expect-error logo is not supported
		const invalid = { namespace: "acme", logo: "x" } satisfies AtlasMountConfig;
		expect(invalid.namespace).toBe("acme");
	});

	let rootDir: string;
	let originPath: string;
	let configPath: string;
	let cacheDir: string;
	let localPath: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "atlas-cli-test-"));
		originPath = join(rootDir, "origin");
		configPath = join(rootDir, "home", ".moxel", "atlas", "config.yaml");
		cacheDir = join(rootDir, ".moxel", "atlas");
		localPath = join(cacheDir, "checkouts", "github.mycorp.com/platform/docs");
		await createOriginRepo(originPath);
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	test("setup bootstraps identity-derived runtime config", async () => {
		const home = join(rootDir, "home-identity");
		const setup = await runWithCapture(
			[
				"setup",
				"--cwd",
				rootDir,
				"--atlas-identity-root",
				".acme/knowledge",
				"--non-interactive",
			],
			{ HOME: home },
		);
		expect(setup.exitCode).toBe(0);
		const identityConfigPath = join(home, ".acme", "knowledge", "config.yaml");
		expect(await Bun.file(identityConfigPath).exists()).toBe(true);
		const configText = await readFile(identityConfigPath, "utf8");
		expect(configText).toContain("root: .acme/knowledge");
		const resolved = await loadConfig({
			cwd: rootDir,
			configPath: identityConfigPath,
			env: { HOME: home },
		});
		expect(resolved.config.cacheDir).toBe(join(home, ".acme", "knowledge"));
		expect(resolved.config.corpusDbPath).toBe(
			join(home, ".acme", "knowledge", "corpus.db"),
		);
		expect(
			await Bun.file(join(home, ".moxel", "atlas", "config.yaml")).exists(),
		).toBe(false);
	});

	test("next recommends setup, repo add, and build from detected state", async () => {
		const noSetup = await runWithCapture(["next", "--cwd", rootDir, "--json"], {
			HOME: join(rootDir, "home-next-empty"),
		});
		expect(noSetup.exitCode).toBe(0);
		expect(JSON.parse(noSetup.stdout).data).toMatchObject({
			recommendedCommand: "atlas setup",
			state: { configFound: false },
		});

		const home = join(rootDir, "home-next");
		const setup = await runWithCapture(
			["setup", "--cwd", rootDir, "--cache-dir", cacheDir, "--non-interactive"],
			{ HOME: home },
		);
		expect(setup.exitCode).toBe(0);
		const nextConfig = join(home, ".moxel", "atlas", "config.yaml");
		const emptySetup = await runWithCapture(
			["next", "--cwd", rootDir, "--config", nextConfig, "--json"],
			{ HOME: home },
		);
		expect(JSON.parse(emptySetup.stdout).data).toMatchObject({
			recommendedCommand: "atlas repo add <repo>",
			state: { configFound: true, repoCount: 0 },
		});

		const checkout = join(rootDir, "next-checkout");
		await mkdir(checkout, { recursive: true });
		await git(checkout, ["init", "-b", "main"]);
		await git(checkout, ["config", "user.email", "atlas@example.test"]);
		await git(checkout, ["config", "user.name", "ATLAS Test"]);
		await git(checkout, [
			"remote",
			"add",
			"origin",
			"git@github.com:moxellabs/atlas.git",
		]);
		await writeFile(join(checkout, "README.md"), "# Atlas\n");
		await git(checkout, ["add", "."]);
		await git(checkout, ["commit", "-m", "initial"]);
		await runWithCapture(
			["init", "--cwd", checkout, "--config", nextConfig, "--non-interactive"],
			{ HOME: home },
		);
		const buildNext = await runWithCapture(
			["next", "--cwd", checkout, "--config", nextConfig, "--json"],
			{ HOME: home },
		);
		expect(JSON.parse(buildNext.stdout).data).toMatchObject({
			recommendedCommand: "atlas build",
			state: { repoMetadataFound: true, artifactFound: false },
		});
	});

	test("help explains command order and setup hides wrapper-only identity knobs", async () => {
		const help = await runWithCapture(["--help"]);
		expect(help.stdout).toContain(
			"atlas setup                 one-time local runtime setup",
		);
		expect(help.stdout).toContain(
			"atlas repo add <repo>       use an existing repo artifact",
		);
		expect(help.stdout).toContain(
			"atlas init && atlas build   publish/update artifact from a checkout",
		);
		expect(help.stdout).toContain(
			"atlas index <path>          fallback local-only index",
		);
		expect(help.stdout).toContain("Start: setup, next");

		const setupHelp = await runWithCapture(["setup", "--help"]);
		const lower = setupHelp.stdout.toLowerCase();
		for (const forbidden of [
			"branding",
			"logo",
			"color",
			"productname",
			"namespace",
			"mcp title",
			"resource prefix",
			"--atlas-mcp-name",
			"--atlas-mcp-title",
		]) {
			expect(lower).not.toContain(forbidden);
		}
	});

	test("repo add alias preserves add-repo JSON result shape", async () => {
		const home = join(rootDir, "home-repo-add-alias");
		await runWithCapture(
			["setup", "--cwd", rootDir, "--cache-dir", cacheDir, "--non-interactive"],
			{ HOME: home },
		);
		const cfg = join(home, ".moxel", "atlas", "config.yaml");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const topLevel = await runWithCapture(
				[
					"add-repo",
					"moxellabs/atlas",
					"--cwd",
					rootDir,
					"--config",
					cfg,
					"--cache-dir",
					join(rootDir, "alias-top"),
					"--non-interactive",
					"--json",
				],
				{ HOME: home },
			);
			const nested = await runWithCapture(
				[
					"repo",
					"add",
					"moxellabs/atlas",
					"--cwd",
					rootDir,
					"--config",
					cfg,
					"--cache-dir",
					join(rootDir, "alias-nested"),
					"--non-interactive",
					"--json",
				],
				{ HOME: home },
			);
			expect(topLevel.exitCode).toBe(0);
			expect(nested.exitCode).toBe(0);
			expect(Object.keys(JSON.parse(nested.stdout).data).sort()).toEqual(
				Object.keys(JSON.parse(topLevel.stdout).data).sort(),
			);
			expect(JSON.parse(nested.stdout).data.repoId).toBe(
				"github.com/moxellabs/atlas",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("shorthand repo input uses configured default host before public GitHub", async () => {
		const home = join(rootDir, "home-default-host");
		await runWithCapture(
			["setup", "--cwd", rootDir, "--cache-dir", cacheDir, "--non-interactive"],
			{ HOME: home },
		);
		const cfg = join(home, ".moxel", "atlas", "config.yaml");
		await runWithCapture([
			"hosts",
			"add",
			"github.mycorp.com",
			"--cwd",
			rootDir,
			"--config",
			cfg,
			"--web-url",
			"https://github.mycorp.com",
			"--api-url",
			"https://github.mycorp.com/api/v3",
			"--protocol",
			"ssh",
			"--priority",
			"10",
			"--default",
		]);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const result = await runWithCapture(
				[
					"add-repo",
					"platform/docs",
					"--cwd",
					rootDir,
					"--config",
					cfg,
					"--cache-dir",
					cacheDir,
					"--non-interactive",
					"--json",
				],
				{ HOME: home },
			);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout).data.repoId).toBe(
				"github.mycorp.com/platform/docs",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("repo target inference supports cwd, git origin, bare names, and ambiguity", async () => {
		const initRepo = join(rootDir, "github-origin");
		await mkdir(initRepo, { recursive: true });
		await git(initRepo, ["init", "-b", "main"]);
		await git(initRepo, ["config", "user.email", "atlas@example.test"]);
		await git(initRepo, ["config", "user.name", "ATLAS Test"]);
		await git(initRepo, [
			"remote",
			"add",
			"origin",
			"git@github.com:moxellabs/atlas.git",
		]);
		await writeFile(join(initRepo, "README.md"), "# Atlas\n");
		await git(initRepo, ["add", "."]);
		await git(initRepo, ["commit", "-m", "initial"]);

		const inferredInit = await runWithCapture([
			"init",
			"--cwd",
			initRepo,
			"--json",
		]);
		expect(inferredInit.exitCode).toBe(0);
		expect(JSON.parse(inferredInit.stdout).data.targetResolution).toMatchObject(
			{
				repoId: "github.com/moxellabs/atlas",
				source: "git-origin",
			},
		);

		await runWithCapture([
			"setup",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			originPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);

		const cwdDoctor = await runWithCapture([
			"repo",
			"doctor",
			"--cwd",
			originPath,
			"--config",
			configPath,
			"--json",
		]);
		expect(cwdDoctor.exitCode).toBe(0);
		expect(JSON.parse(cwdDoctor.stdout).data.targetResolution.source).toBe(
			"cwd-config",
		);
		expect(JSON.parse(cwdDoctor.stdout).data.checks[0].layer).toBe("registry");

		const bareShow = await runWithCapture([
			"repo",
			"show",
			"docs",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(bareShow.exitCode).toBe(0);
		expect(JSON.parse(bareShow.stdout).data.targetResolution).toMatchObject({
			repoId: "github.com/platform/docs",
			source: "bare-name",
		});

		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.com/other/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			originPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);
		const ambiguous = await runWithCapture([
			"repo",
			"doctor",
			"docs",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(ambiguous.exitCode).toBe(2);
		const ambiguity = JSON.parse(ambiguous.stdout);
		expect(ambiguity.error.code).toBe("CLI_REPO_TARGET_AMBIGUOUS");
		expect(ambiguity.error.details.candidates).toEqual([
			"github.com/other/docs",
			"github.com/platform/docs",
		]);
	});

	test("setup bootstraps a YAML config and add-repo preserves it", async () => {
		const init = await runWithCapture([
			"setup",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		expect(init.exitCode).toBe(0);
		expect(await Bun.file(configPath).exists()).toBe(true);
		expect(await readFile(configPath, "utf8")).toContain("version: 1");

		const added = await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			localPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);
		expect(added.exitCode).toBe(0);

		const resolved = await loadConfig({ cwd: rootDir, configPath });
		expect(resolved.config.repos).toHaveLength(1);
		expect(resolved.config.repos[0]).toMatchObject({
			repoId: "github.mycorp.com/platform/docs",
			mode: "local-git",
			git: {
				remote: `file://${originPath}`,
				localPath,
			},
		});
		expect(await readFile(configPath, "utf8")).toContain(
			"repoId: github.mycorp.com/platform/docs",
		);
	});

	test("sync, build, list, inspect, doctor, clean, and prune work end to end in JSON mode", async () => {
		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			localPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);

		const sync = await runWithCapture([
			"sync",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(sync.exitCode).toBe(0);
		expect(JSON.parse(sync.stdout)).toMatchObject({
			ok: true,
			command: "sync",
			data: {
				reports: expect.any(Array),
			},
		});

		const build = await runWithCapture([
			"build",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		console.log({ build });
		expect(build.exitCode, build.stderr).toBe(0);
		expect(JSON.parse(build.stdout)).toMatchObject({
			ok: true,
			command: "build",
			data: {
				reports: expect.any(Array),
				successCount: 1,
			},
		});

		const list = await runWithCapture([
			"list",
			"repos",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(list.stdout)).toMatchObject({
			ok: true,
			command: "list",
			data: [
				expect.objectContaining({ repoId: "github.mycorp.com/platform/docs" }),
			],
		});

		const packages = JSON.parse(
			(
				await runWithCapture([
					"list",
					"packages",
					"--cwd",
					rootDir,
					"--config",
					configPath,
					"--repo",
					"github.mycorp.com/platform/docs",
					"--json",
				])
			).stdout,
		);
		const modules = JSON.parse(
			(
				await runWithCapture([
					"list",
					"modules",
					"--cwd",
					rootDir,
					"--config",
					configPath,
					"--repo",
					"github.mycorp.com/platform/docs",
					"--json",
				])
			).stdout,
		);
		const packageId = packages.data[0]?.packageId as string;
		const moduleId = modules.data[0]?.moduleId as string;

		const scopedSkills = await runWithCapture([
			"list",
			"skills",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--module",
			moduleId,
			"--json",
		]);
		expect(JSON.parse(scopedSkills.stdout)).toMatchObject({
			ok: true,
			command: "list",
			data: [expect.objectContaining({ moduleId })],
		});

		const packageScopedSkills = await runWithCapture([
			"list",
			"skills",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--package",
			packageId,
			"--json",
		]);
		expect(JSON.parse(packageScopedSkills.stdout)).toMatchObject({
			ok: true,
			command: "list",
		});
		const skillsPayload = JSON.parse(scopedSkills.stdout);
		const skillId = (skillsPayload.data as Array<{ skillId: string }>)[0]
			?.skillId as string;
		expect(skillId).toBeDefined();

		const workspaceInstall = await runWithCapture([
			"install-skill",
			skillId,
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--target",
			"claude-code",
			"--scope",
			"workspace",
			"--workspace",
			rootDir,
			"--json",
		]);
		expect(workspaceInstall.exitCode).toBe(0);
		const workspaceInstallPayload = JSON.parse(workspaceInstall.stdout);
		expect(workspaceInstallPayload).toMatchObject({
			ok: true,
			command: "install-skill",
			data: {
				target: "claude-code",
				scope: "workspace",
				dryRun: false,
				skills: [expect.objectContaining({ skillId })],
				writtenFiles: [
					expect.stringContaining(".claude/skills/auth-skill/SKILL.md"),
				],
			},
		});
		expect(
			await readFile(
				join(rootDir, ".claude", "skills", "auth-skill", "SKILL.md"),
				"utf8",
			),
		).toContain(`ATLAS skill ID: ${skillId}`);

		const overwriteRefused = await runWithCapture([
			"install-skill",
			skillId,
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--target",
			"claude-code",
			"--scope",
			"workspace",
			"--workspace",
			rootDir,
			"--json",
		]);
		expect(JSON.parse(overwriteRefused.stdout)).toMatchObject({
			ok: true,
			command: "install-skill",
			data: {
				writtenFiles: [],
				skippedFiles: [
					expect.stringContaining(".claude/skills/auth-skill/SKILL.md"),
				],
			},
		});

		const userDryRun = await runWithCapture(
			[
				"install-skill",
				"--repo",
				"github.mycorp.com/platform/docs",
				"--cwd",
				rootDir,
				"--config",
				configPath,
				"--target",
				"cursor",
				"--scope",
				"user",
				"--dry-run",
				"--json",
			],
			{ HOME: join(rootDir, "home") },
		);
		expect(JSON.parse(userDryRun.stdout)).toMatchObject({
			ok: true,
			command: "install-skill",
			data: {
				target: "cursor",
				scope: "user",
				dryRun: true,
				writtenFiles: [],
				wouldWriteFiles: [
					expect.stringContaining(".cursor/rules/auth-skill.mdc"),
				],
			},
		});
		expect(
			await exists(join(rootDir, "home", ".cursor", "rules", "auth-skill.mdc")),
		).toBe(false);

		const docs = await runWithCapture([
			"list",
			"docs",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--repo",
			"github.mycorp.com/platform/docs",
			"--json",
		]);
		const docsPayload = JSON.parse(docs.stdout);
		const docRows = docsPayload.data as Array<{ docId?: string }>;
		const docId = docRows.find((doc) => typeof doc.docId === "string")
			?.docId as string;
		expect(docId).toBeDefined();
		expect(docsPayload).toMatchObject({
			ok: true,
			command: "list",
			data: expect.arrayContaining([
				expect.objectContaining({ path: expect.stringContaining(".md") }),
			]),
		});

		const sections = await runWithCapture([
			"list",
			"sections",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--doc",
			docId,
			"--json",
		]);
		const sectionsPayload = JSON.parse(sections.stdout);
		const sectionRows = sectionsPayload.data as Array<{ sectionId?: string }>;
		const sectionId = sectionRows.find(
			(section) => typeof section.sectionId === "string",
		)?.sectionId as string;
		expect(sectionId).toBeDefined();
		expect(sectionsPayload).toMatchObject({
			ok: true,
			command: "list",
			data: [
				expect.objectContaining({
					sectionId: expect.any(String),
					heading: expect.any(String),
				}),
			],
		});

		const freshness = await runWithCapture([
			"list",
			"freshness",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--repo",
			"github.mycorp.com/platform/docs",
			"--json",
		]);
		expect(JSON.parse(freshness.stdout)).toMatchObject({
			ok: true,
			command: "list",
			data: [
				expect.objectContaining({
					repoId: "github.mycorp.com/platform/docs",
					fresh: true,
				}),
			],
		});

		const inspect = await runWithCapture([
			"inspect",
			"manifest",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(inspect.stdout)).toMatchObject({
			ok: true,
			command: "inspect",
			data: [
				expect.objectContaining({ repoId: "github.mycorp.com/platform/docs" }),
			],
		});

		const inspectFreshness = await runWithCapture([
			"inspect",
			"freshness",
			"github.mycorp.com/platform/docs",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(inspectFreshness.stdout)).toMatchObject({
			ok: true,
			command: "inspect",
			data: [
				expect.objectContaining({
					repoId: "github.mycorp.com/platform/docs",
					fresh: true,
					manifest: expect.any(Object),
				}),
			],
		});

		const inspectSection = await runWithCapture([
			"inspect",
			"section",
			sectionId,
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(inspectSection.stdout)).toMatchObject({
			ok: true,
			command: "inspect",
			data: {
				section: expect.objectContaining({ sectionId }),
				document: expect.objectContaining({ docId }),
			},
		});

		const datasetPath = join(rootDir, "eval.dataset.json");
		await writeFile(
			datasetPath,
			JSON.stringify({
				name: "cli-eval",
				cases: [
					{
						id: "session-docs",
						query: "session package documentation",
						expected: { authorities: ["preferred"] },
					},
				],
			}),
		);
		const evalResult = await runWithCapture([
			"eval",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--dataset",
			datasetPath,
			"--json",
		]);
		expect(JSON.parse(evalResult.stdout)).toMatchObject({
			ok: true,
			command: "eval",
			data: {
				dataset: "cli-eval",
				totalCases: 1,
				passedCases: 1,
				metrics: expect.objectContaining({
					provenanceHitRate: 1,
					tokenBudgetPassRate: 1,
				}),
			},
		});

		const doctor = await runWithCapture([
			"doctor",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(doctor.stdout)).toMatchObject({
			ok: true,
			command: "doctor",
			data: expect.arrayContaining([
				expect.objectContaining({ name: "config", status: "pass" }),
			]),
		});

		const resolved = await loadConfig({ cwd: rootDir, configPath });
		const corpusDbPath = resolved.config.corpusDbPath;
		await writeFile(`${corpusDbPath}-wal`, "wal");
		await writeFile(`${corpusDbPath}-shm`, "shm");
		await writeFile(`${corpusDbPath}-journal`, "journal");

		const cleanDryRun = await runWithCapture([
			"clean",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
			"--dry-run",
		]);
		expect(JSON.parse(cleanDryRun.stdout)).toMatchObject({
			ok: true,
			command: "clean",
			data: {
				corpusDbPath,
				dryRun: true,
				removed: expect.arrayContaining([
					expect.objectContaining({ path: corpusDbPath }),
					expect.objectContaining({ path: `${corpusDbPath}-wal` }),
					expect.objectContaining({ path: `${corpusDbPath}-shm` }),
					expect.objectContaining({ path: `${corpusDbPath}-journal` }),
				]),
				totalBytes: expect.any(Number),
			},
		});
		expect(await exists(corpusDbPath)).toBe(true);
		expect(await exists(localPath)).toBe(true);

		const clean = await runWithCapture([
			"clean",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(clean.stdout)).toMatchObject({
			ok: true,
			command: "clean",
			data: {
				corpusDbPath,
				dryRun: false,
				removed: expect.arrayContaining([
					expect.objectContaining({ path: corpusDbPath }),
					expect.objectContaining({ path: `${corpusDbPath}-wal` }),
					expect.objectContaining({ path: `${corpusDbPath}-shm` }),
					expect.objectContaining({ path: `${corpusDbPath}-journal` }),
				]),
			},
		});
		expect(await exists(corpusDbPath)).toBe(false);
		expect(await exists(`${corpusDbPath}-wal`)).toBe(false);
		expect(await exists(`${corpusDbPath}-shm`)).toBe(false);
		expect(await exists(`${corpusDbPath}-journal`)).toBe(false);
		expect(await exists(localPath)).toBe(true);

		const cleanEmpty = await runWithCapture([
			"clean",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(JSON.parse(cleanEmpty.stdout)).toMatchObject({
			ok: true,
			command: "clean",
			data: {
				corpusDbPath,
				dryRun: false,
				removed: [],
			},
		});

		await mkdir(join(cacheDir, "checkouts", "orphan"), { recursive: true });
		await writeFile(
			join(cacheDir, "checkouts", "orphan", "stale.txt"),
			"stale",
		);
		const prune = await runWithCapture([
			"prune",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
			"--dry-run",
		]);
		expect(JSON.parse(prune.stdout)).toMatchObject({
			ok: true,
			command: "prune",
			data: {
				dryRun: true,
				removed: expect.arrayContaining([
					expect.objectContaining({
						path: join(cacheDir, "checkouts", "orphan"),
					}),
				]),
			},
		});
	});

	test("inspect topology --live analyzes a checkout without config or store mutation", async () => {
		const liveRoot = join(rootDir, "github.mycorp.com/platform/live-atlas");
		await mkdir(join(liveRoot, "docs", "archive"), { recursive: true });
		await mkdir(join(liveRoot, "skills", "document-codebase"), {
			recursive: true,
		});
		await mkdir(
			join(liveRoot, "apps", "cli", "docs", "skills", "add-cli-command"),
			{ recursive: true },
		);
		await mkdir(
			join(
				liveRoot,
				"packages",
				"topology",
				"src",
				"classifiers",
				"docs",
				"skills",
				"change-doc-classification",
			),
			{
				recursive: true,
			},
		);
		await writeFile(
			join(liveRoot, "package.json"),
			JSON.stringify({ name: "github.mycorp.com/platform/live-atlas" }),
		);
		await writeFile(join(liveRoot, "docs", "index.md"), "# Index\n");
		await writeFile(join(liveRoot, "docs", "archive", "old.md"), "# Old\n");
		await writeFile(
			join(liveRoot, "skills", "document-codebase", "SKILL.md"),
			"# Document Codebase\n",
		);
		await writeFile(
			join(liveRoot, "apps", "cli", "package.json"),
			JSON.stringify({ name: "@atlas/cli" }),
		);
		await writeFile(
			join(liveRoot, "apps", "cli", "docs", "index.md"),
			"# CLI\n",
		);
		await writeFile(
			join(
				liveRoot,
				"apps",
				"cli",
				"docs",
				"skills",
				"add-cli-command",
				"SKILL.md",
			),
			"# Add CLI Command\n",
		);
		await writeFile(
			join(liveRoot, "packages", "topology", "package.json"),
			JSON.stringify({ name: "@atlas/topology" }),
		);
		await writeFile(
			join(
				liveRoot,
				"packages",
				"topology",
				"src",
				"classifiers",
				"docs",
				"index.md",
			),
			"# Classifiers\n",
		);
		await writeFile(
			join(
				liveRoot,
				"packages",
				"topology",
				"src",
				"classifiers",
				"docs",
				"skills",
				"change-doc-classification",
				"SKILL.md",
			),
			"# Change Doc Classification\n",
		);

		const result = await runWithCapture([
			"inspect",
			"topology",
			"--cwd",
			liveRoot,
			"--live",
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			command: "inspect",
			data: {
				source: "live",
				repo: expect.objectContaining({
					repoId: "live-atlas",
					config: "inferred",
					packageGlobs: ["apps/*", "packages/*"],
				}),
				packages: expect.arrayContaining([
					expect.objectContaining({ name: "@atlas/cli", path: "apps/cli" }),
					expect.objectContaining({
						name: "@atlas/topology",
						path: "packages/topology",
					}),
				]),
				skills: expect.arrayContaining([
					expect.objectContaining({
						path: "skills/document-codebase/SKILL.md",
					}),
					expect.objectContaining({
						path: "apps/cli/docs/skills/add-cli-command/SKILL.md",
					}),
					expect.objectContaining({
						path: "packages/topology/src/classifiers/docs/skills/change-doc-classification/SKILL.md",
					}),
				]),
			},
		});
		const paths = (payload.data.docs as Array<{ path: string }>).map(
			(doc) => doc.path,
		);
		expect(paths).toContain("docs/index.md");
		expect(paths).not.toContain("docs/archive/old.md");
		expect(await exists(join(liveRoot, "atlas.config.yaml"))).toBe(false);
		expect(await exists(join(liveRoot, ".moxel", "atlas", "corpus.db"))).toBe(
			false,
		);
	});

	test("inspect topology --live succeeds while build reports post-discovery compile failure", async () => {
		await writeFile(
			join(originPath, "docs", "broken.md"),
			"---\ntitle: Broken\n# Missing closing frontmatter\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "add broken doc"]);

		const topology = await runWithCapture([
			"inspect",
			"topology",
			"--cwd",
			originPath,
			"--live",
			"--json",
		]);
		expect(topology.exitCode).toBe(0);
		expect(JSON.parse(topology.stdout)).toMatchObject({
			ok: true,
			data: { source: "live" },
		});

		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			localPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);

		const build = await runWithCapture([
			"build",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--repo",
			"github.mycorp.com/platform/docs",
			"--json",
			"--verbose",
		]);
		expect(build.exitCode).toBe(1);
		const payload = JSON.parse(build.stdout);
		expect(payload).toMatchObject({
			ok: false,
			command: "build",
			error: {
				code: "CLI_BUILD_FAILED",
				details: {
					repoId: "github.mycorp.com/platform/docs",
					docsConsidered: 4,
					diagnostics: expect.arrayContaining([
						expect.objectContaining({
							stage: "compile",
							path: "docs/broken.md",
							cause: expect.objectContaining({
								cause: expect.objectContaining({
									message: expect.stringContaining(
										"Frontmatter opening marker",
									),
								}),
							}),
						}),
					]),
				},
			},
		});
	});

	test("build ignores generated and vendored docs that live topology also skips", async () => {
		await mkdir(join(originPath, "node_modules", "bad-package"), {
			recursive: true,
		});
		await mkdir(join(originPath, ".moxel", "atlas"), { recursive: true });
		await writeFile(
			join(originPath, "node_modules", "bad-package", "SKILL.md"),
			"---\ndescription: broken\n# Missing closing frontmatter\n",
		);
		await writeFile(
			join(originPath, ".moxel", "atlas", "SKILL.md"),
			"---\ndescription: generated broken\n# Missing closing frontmatter\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "add ignored generated docs"]);

		const topology = await runWithCapture([
			"inspect",
			"topology",
			"--cwd",
			originPath,
			"--live",
			"--json",
		]);
		expect(topology.exitCode).toBe(0);
		const topologyPayload = JSON.parse(topology.stdout);
		const livePaths = (
			topologyPayload.data.docs as Array<{ path: string }>
		).map((doc) => doc.path);
		expect(livePaths).not.toEqual(
			expect.arrayContaining([
				"node_modules/bad-package/SKILL.md",
				".moxel/atlas/SKILL.md",
			]),
		);

		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			localPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);
		const build = await runWithCapture([
			"build",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--repo",
			"github.mycorp.com/platform/docs",
			"--json",
		]);
		expect(build.exitCode, build.stderr).toBe(0);
		expect(JSON.parse(build.stdout)).toMatchObject({
			ok: true,
			command: "build",
			data: {
				docsConsidered: 3,
				docsRebuilt: 3,
			},
		});
	});

	test("inspect topology --live uses matching config rules when config exists", async () => {
		const liveRoot = join(rootDir, "configured-live");
		const liveConfigPath = join(rootDir, "live.config.yaml");
		await mkdir(join(liveRoot, "docs"), { recursive: true });
		await mkdir(join(liveRoot, "custom", "docs"), { recursive: true });
		await writeFile(
			join(liveRoot, "package.json"),
			JSON.stringify({ name: "configured-live" }),
		);
		await writeFile(
			join(liveRoot, "docs", "index.md"),
			"# Ignored By Custom Rules\n",
		);
		await writeFile(
			join(liveRoot, "custom", "docs", "guide.md"),
			"# Custom Guide\n",
		);
		await writeFile(
			liveConfigPath,
			`
version: 1
cacheDir: .cache/atlas
corpusDbPath: .cache/atlas/corpus.db
logLevel: info
server:
  transport: stdio
repos:
  - repoId: github.mycorp.com/platform/configured
    mode: local-git
    git:
      remote: file://${liveRoot}
      localPath: ${liveRoot}
      ref: HEAD
    workspace:
      rootPath: ${liveRoot}
      packageGlobs:
        - packages/*
      packageManifestFiles:
        - package.json
    topology:
      - id: custom-docs
        kind: repo-doc
        match:
          include:
            - custom/docs/**/*.md
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`,
		);

		const result = await runWithCapture([
			"inspect",
			"topology",
			"github.mycorp.com/platform/configured",
			"--cwd",
			liveRoot,
			"--config",
			liveConfigPath,
			"--live",
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.data.repo).toMatchObject({
			repoId: "github.mycorp.com/platform/configured",
			config: "matched",
		});
		expect(payload.data.docs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "custom/docs/guide.md",
					authority: "canonical",
				}),
			]),
		);
	});

	test("add-repo infers a file remote and current branch inside an unpublished local git checkout", async () => {
		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);

		const result = await runWithCapture([
			"add-repo",
			"--cwd",
			originPath,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/local",
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "add-repo",
			data: {
				repo: {
					repoId: "github.mycorp.com/platform/local",
					git: {
						remote: pathToFileURL(originPath).href,
						localPath: join(
							cacheDir,
							"checkouts",
							"github.mycorp.com/platform/local",
						),
						ref: "main",
					},
				},
			},
		});
	});

	test("add-repo prefers origin remote when one is configured", async () => {
		await git(originPath, [
			"remote",
			"add",
			"origin",
			"ssh://git@ghe.example.com/platform/atlas.git",
		]);
		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);

		const result = await runWithCapture([
			"add-repo",
			"--cwd",
			originPath,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/origin",
			"--template",
			"mixed-monorepo",
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			data: {
				repo: {
					git: {
						remote: "ssh://git@ghe.example.com/platform/atlas.git",
						ref: "main",
					},
				},
			},
		});
	});

	test("add-repo still requires a remote outside a git checkout", async () => {
		const nonGitRoot = join(rootDir, "not-git");
		await mkdir(nonGitRoot, { recursive: true });

		const result = await runWithCapture([
			"add-repo",
			"--cwd",
			nonGitRoot,
			"--non-interactive",
			"--repo-id",
			"missing-remote",
			"--template",
			"mixed-monorepo",
			"--json",
		]);

		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			command: "add-repo",
			error: {
				code: "CLI_REMOTE_REQUIRED",
				message: expect.stringContaining(
					"run add-repo from inside a Git checkout",
				),
			},
		});
	});

	test("add-repo bootstraps runtime directories and list repos works before sync", async () => {
		const bootstrapConfigPath = join(rootDir, "bootstrap.config.yaml");
		const bootstrapCacheDir = join(
			rootDir,
			".bootstrap-cache",
			"github.mycorp.com/platform/docs",
		);
		const result = await runWithCapture([
			"add-repo",
			"--cwd",
			originPath,
			"--config",
			bootstrapConfigPath,
			"--cache-dir",
			bootstrapCacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/bootstrap",
			"--template",
			"mixed-monorepo",
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		const resolved = await loadConfig({
			cwd: rootDir,
			configPath: bootstrapConfigPath,
		});
		expect(await exists(resolved.config.cacheDir)).toBe(true);
		expect(await exists(join(resolved.config.cacheDir, "repos"))).toBe(true);
		expect(await exists(resolved.config.corpusDbPath)).toBe(false);

		const list = await runWithCapture([
			"list",
			"repos",
			"--cwd",
			rootDir,
			"--config",
			bootstrapConfigPath,
			"--json",
		]);
		expect(list.exitCode).toBe(0);
		expect(JSON.parse(list.stdout)).toMatchObject({
			ok: true,
			command: "list",
			data: [
				expect.objectContaining({
					repoId: "github.mycorp.com/platform/bootstrap",
					mode: "local-git",
				}),
			],
		});
		expect(await exists(resolved.config.corpusDbPath)).toBe(false);
	});

	test("build rejects conflicting targeted selectors", async () => {
		const result = await runWithCapture([
			"build",
			"--json",
			"--repo",
			"github.mycorp.com/platform/docs",
			"--doc-id",
			"doc_1",
			"--package-id",
			"pkg_1",
		]);

		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			command: "build",
			error: {
				code: "CLI_INVALID_BUILD_SELECTOR",
			},
		});
	});

	test("sync --check distinguishes code-only changes from corpus-affecting changes", async () => {
		await runWithCapture([
			"init",
			"--cwd",
			rootDir,
			"--non-interactive",
			"--cache-dir",
			cacheDir,
		]);
		await runWithCapture([
			"add-repo",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
			"--repo-id",
			"github.mycorp.com/platform/docs",
			"--mode",
			"local-git",
			"--remote",
			`file://${originPath}`,
			"--local-path",
			localPath,
			"--ref",
			"main",
			"--template",
			"mixed-monorepo",
		]);
		await runWithCapture(["build", "--cwd", rootDir, "--config", configPath]);

		await mkdir(join(originPath, "packages", "auth", "src"), {
			recursive: true,
		});
		await writeFile(
			join(originPath, "packages", "auth", "src", "index.ts"),
			"export const value = 1;\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "code only"]);

		const codeOnly = await runWithCapture([
			"sync",
			"--repo",
			"github.mycorp.com/platform/docs",
			"--check",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(codeOnly.exitCode).toBe(0);
		expect(JSON.parse(codeOnly.stdout)).toMatchObject({
			ok: true,
			command: "sync",
			data: expect.objectContaining({
				sourceChanged: true,
				corpusAffected: false,
				corpusImpact: "none",
			}),
		});

		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nCheck mode doc update.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "doc update"]);

		const docsChanged = await runWithCapture([
			"sync",
			"--repo",
			"github.mycorp.com/platform/docs",
			"--check",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(docsChanged.exitCode).toBe(1);
		expect(JSON.parse(docsChanged.stdout)).toMatchObject({
			ok: true,
			command: "sync",
			data: expect.objectContaining({
				sourceChanged: true,
				corpusAffected: true,
				corpusImpact: "docs",
			}),
		});

		const docsStillChanged = await runWithCapture([
			"sync",
			"--repo",
			"github.mycorp.com/platform/docs",
			"--check",
			"--cwd",
			rootDir,
			"--config",
			configPath,
			"--json",
		]);
		expect(docsStillChanged.exitCode).toBe(1);
		expect(JSON.parse(docsStillChanged.stdout)).toMatchObject({
			ok: true,
			command: "sync",
			data: expect.objectContaining({
				sourceChanged: false,
				corpusAffected: true,
				corpusImpact: "docs",
			}),
		});
	});

	test("doctor checks GHES token and ref access without leaking secrets", async () => {
		const ghesConfigPath = join(rootDir, "ghes.config.yaml");
		await mkdir(join(rootDir, ".cache", "github.mycorp.com/platform/docs"), {
			recursive: true,
		});
		await writeFile(ghesConfigPath, ghesConfig("http://127.0.0.1:1/api/v3"));

		const missingToken = await runWithCapture([
			"doctor",
			"--cwd",
			rootDir,
			"--config",
			ghesConfigPath,
			"--repo",
			"github.mycorp.com/platform/ghes",
			"--json",
		]);
		expect(JSON.parse(missingToken.stdout).data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "repo:github.mycorp.com/platform/ghes:ghes-auth",
					status: "fail",
					message: expect.stringContaining("No GHES token found."),
				}),
			]),
		);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			const url = new URL(String(input));
			const headers = new Headers(init?.headers);
			if (
				url.pathname === "/api/v3/repos/moxellabs/atlas/commits/main" &&
				headers.get("authorization") === "Bearer secret-token"
			) {
				return new Response(
					JSON.stringify({ sha: "3333333333333333333333333333333333333333" }),
					{
						headers: { "content-type": "application/json" },
					},
				);
			}
			return new Response(JSON.stringify({ message: "not found" }), {
				status: 404,
			});
		}) as typeof fetch;
		try {
			await writeFile(
				ghesConfigPath,
				ghesConfig("http://127.0.0.1:43191/api/v3"),
			);
			const reachable = await runWithCapture(
				[
					"doctor",
					"--cwd",
					rootDir,
					"--config",
					ghesConfigPath,
					"--repo",
					"github.mycorp.com/platform/ghes",
					"--json",
				],
				{
					ATLAS_GHES_TOKEN: "secret-token",
				},
			);
			expect(JSON.parse(reachable.stdout).data).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "repo:github.mycorp.com/platform/ghes:ghes-ref",
						status: "pass",
						message: expect.stringContaining(
							"3333333333333333333333333333333333333333",
						),
					}),
				]),
			);
			expect(reachable.stdout).not.toContain("secret-token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("serve reports startup metadata, open result, and closes CLI dependencies", async () => {
		const context = createCommandContext([
			"serve",
			"--host",
			"0.0.0.0",
			"--port",
			"40789",
			"--open",
		]);
		const startedWith: Array<{
			host?: string | undefined;
			port?: number | undefined;
		}> = [];
		const opened: string[] = [];
		let closed = false;

		const result = await runServeCommandWithDependencies(
			context,
			{
				server: {
					async start(options) {
						startedWith.push(options ?? {});
						return {
							host: options?.host ?? "127.0.0.1",
							port: options?.port ?? 3000,
							dbPath: "/tmp/atlas.db",
							repoCount: 1,
							openApiEnabled: true,
							mcpEnabled: true,
							uiEnabled: false,
							stop() {},
						};
					},
				},
				close() {
					closed = true;
				},
			},
			async (url) => {
				opened.push(url);
			},
		);

		expect(result).toMatchObject({
			ok: true,
			command: "serve",
			data: {
				url: "http://0.0.0.0:40789",
				browserLaunch: { ok: true },
			},
		});
		expect(startedWith).toEqual([{ host: "0.0.0.0", port: 40789 }]);
		expect(opened).toEqual(["http://0.0.0.0:40789"]);
		expect(closed).toBe(true);
	});

	test("mcp connects stdio transport without writing CLI output to stdout", async () => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		let stdoutText = "";
		let stderrText = "";
		stdout.on("data", (chunk) => {
			stdoutText += chunk.toString("utf8");
		});
		stderr.on("data", (chunk) => {
			stderrText += chunk.toString("utf8");
		});
		const context: CliCommandContext = {
			argv: ["mcp"],
			cwd: process.cwd(),
			output: { json: false, verbose: false, quiet: false },
			stdin: new PassThrough() as unknown as NodeJS.ReadStream,
			stdout: stdout as unknown as NodeJS.WriteStream,
			stderr: stderr as unknown as NodeJS.WriteStream,
			env: {},
		};
		const sourceDiffProvider = {
			async diff() {
				throw new Error("unused");
			},
		};
		const transport: { onclose?: () => void } = {};
		let connectedTransport: unknown;
		let closed = false;
		let serverReceivedSourceDiffProvider = false;

		const result = await runMcpCommandWithDependencies(
			context,
			{
				db: {} as never,
				sourceDiffProvider,
				close() {
					closed = true;
				},
			},
			{
				createServer(deps) {
					serverReceivedSourceDiffProvider =
						deps.sourceDiffProvider === sourceDiffProvider;
					return {
						tools: ["find_docs"],
						resources: ["atlas-document"],
						prompts: ["onboard_to_repo"],
						diagnostics: [],
						server: {
							onclose: undefined,
							async connect(nextTransport: unknown) {
								connectedTransport = nextTransport;
								queueMicrotask(() => transport.onclose?.());
							},
						},
					} as never;
				},
				createTransport(nextContext) {
					expect(nextContext.stdin).toBe(context.stdin);
					expect(nextContext.stdout).toBe(context.stdout);
					return transport as never;
				},
			},
		);

		expect(result).toMatchObject({
			ok: true,
			command: "mcp",
			data: {
				transport: "stdio",
				tools: ["find_docs"],
			},
		});
		expect(connectedTransport).toBe(transport);
		expect(serverReceivedSourceDiffProvider).toBe(true);
		expect(closed).toBe(true);
		expect(stdoutText).toBe("");
		expect(stderrText).toBe("");
	});

	test("mcp identity passes atlas-mcp-name into server without stdio noise", async () => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		let receivedIdentity: unknown;
		const transport: { onclose?: () => void } = {};
		const context: CliCommandContext = {
			argv: ["mcp"],
			cwd: process.cwd(),
			output: { json: false, verbose: false, quiet: false },
			mcpName: "acme-knowledge",
			mcpTitle: "Acme Knowledge MCP",
			identityRoot: ".acme/knowledge",
			stdin: new PassThrough() as unknown as NodeJS.ReadStream,
			stdout: stdout as unknown as NodeJS.WriteStream,
			stderr: stderr as unknown as NodeJS.WriteStream,
			env: {},
		};
		const result = await runMcpCommandWithDependencies(
			context,
			{ db: {} as never, sourceDiffProvider: {} as never, close() {} },
			{
				createServer(_deps, identity) {
					receivedIdentity = identity;
					return {
						tools: [
							"find_docs",
							"read_outline",
							"read_section",
							"plan_context",
							"list_skills",
							"use_skill",
						],
						resources: ["acme-document"],
						prompts: [],
						diagnostics: [],
						server: {
							async connect() {
								queueMicrotask(() => transport.onclose?.());
							},
						},
					} as never;
				},
				createTransport() {
					return transport as never;
				},
			},
		);
		expect(result.ok).toBe(true);
		expect(receivedIdentity).toMatchObject({
			name: "acme-knowledge",
			title: "Acme Knowledge MCP",
			resourcePrefix: "atlas",
		});
	});

	test("eval runs MCP adoption JSON success", async () => {
		const datasetPath = join(rootDir, "mcp-adoption.dataset.json");
		const tracePath = join(rootDir, "mcp-adoption.trace.json");
		await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
		await writeFile(
			tracePath,
			JSON.stringify({
				cases: {
					indexed: [
						{ kind: "read_resource", uri: "atlas://manifest" },
						{ kind: "call_tool", name: "plan_context" },
					],
					generic: [],
				},
			}),
		);

		const result = await runWithCapture([
			"eval",
			"--kind",
			"mcp-adoption",
			"--dataset",
			datasetPath,
			"--trace",
			tracePath,
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "eval",
			data: {
				dataset: "cli-mcp-adoption",
				passedCases: 2,
				failedCases: 0,
				adoptionScore: 1,
			},
		});
	});

	test("eval returns failure for MCP adoption misses", async () => {
		const datasetPath = join(rootDir, "mcp-adoption.dataset.json");
		const tracePath = join(rootDir, "mcp-adoption.trace.json");
		await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
		await writeFile(
			tracePath,
			JSON.stringify({
				cases: {
					indexed: [],
					generic: [{ kind: "call_tool", name: "plan_context" }],
				},
			}),
		);

		const result = await runWithCapture([
			"eval",
			"--kind",
			"mcp-adoption",
			"--dataset",
			datasetPath,
			"--trace",
			tracePath,
			"--json",
		]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "eval",
			data: {
				failedCases: expect.any(Number),
			},
			exitCode: 1,
		});
		expect(JSON.parse(result.stdout).data.failedCases).toBeGreaterThan(0);
	});

	test("eval rejects invalid MCP adoption trace kind", async () => {
		const datasetPath = join(rootDir, "mcp-adoption.dataset.json");
		const tracePath = join(rootDir, "mcp-adoption.trace.json");
		await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
		await writeFile(
			tracePath,
			JSON.stringify({
				cases: {
					indexed: [{ kind: "fetch_remote", uri: "https://example.com" }],
				},
			}),
		);

		const result = await runWithCapture([
			"eval",
			"--kind",
			"mcp-adoption",
			"--dataset",
			datasetPath,
			"--trace",
			tracePath,
			"--json",
		]);

		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			command: "eval",
			error: { code: "CLI_INVALID_EVAL_TRACE" },
			exitCode: 2,
		});
	});

	test("help lists every dispatched command", async () => {
		const result = await runWithCapture(["help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("atlas <command>");
		expect(result.stdout).toContain("Commands:");
		expect(result.stdout).toContain(".moxel/atlas");
		for (const command of [
			"setup",
			"init",
			"add-repo",
			"sync",
			"build",
			"serve",
			"mcp",
			"inspect",
			"install-skill",
			"list",
			"clean",
			"prune",
			"doctor",
			"eval",
		]) {
			expect(result.stdout).toContain(`  ${command}`);
		}
	});

	test("unknown commands return one Atlas error and print help in human mode", async () => {
		const result = await runWithCapture(["wat"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("Unknown command: wat.");
		expect(result.stderr).not.toContain("error: unknown command");
		expect(result.stdout).toContain("atlas <command>");
		expect(result.stdout).toContain("Commands:");
		expect(result.stdout).toContain("  mcp");
	});

	test("repo doctor help is command-specific", async () => {
		const result = await runWithCapture(["repo", "doctor", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: atlas repo doctor");
		expect(result.stdout).toContain("[repo]");
	});

	test("interactive missing artifact never falls back to legacy numbered prompt", async () => {
		const cfg = join(rootDir, "missing-interactive.config.yaml");
		await writeFile(
			cfg,
			missingArtifactConfig("https://github.mycorp.com/api/v3"),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const result = await runWithCapture([
				"add-repo",
				"moxellabs/atlas",
				"--cwd",
				rootDir,
				"--config",
				cfg,
				"--cache-dir",
				cacheDir,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"-i",
			]);

			expect(result.exitCode).toBe(2);
			expect(`${result.stdout}\n${result.stderr}`).not.toContain(
				"Select [1-4]:",
			);
			expect(`${result.stdout}\n${result.stderr}`).not.toContain(
				"1. Build a local index",
			);
			expect(result.stderr).toContain(
				"Missing artifact requires an explicit action",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("local-only index help lists fallback command", async () => {
		const result = await runWithCapture(["help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"index [options] <repo>                 Clone and index a repo locally only",
		);
	});

	test("missing artifact JSON default returns skip without repo metadata", async () => {
		const cfg = join(rootDir, "missing.config.yaml");
		await writeFile(
			cfg,
			missingArtifactConfig("https://github.mycorp.com/api/v3"),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const result = await runWithCapture([
				"add-repo",
				"moxellabs/atlas",
				"--cwd",
				rootDir,
				"--config",
				cfg,
				"--config",
				configPath,
				"--cache-dir",
				cacheDir,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"--non-interactive",
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout);
			expect(parsed.data).toMatchObject({
				missingArtifact: true,
				selectedAction: "skip",
				repoId: "github.mycorp.com/moxellabs/atlas",
			});
			expect(parsed.data.nextActions).toContain("clone-and-index-local-only");
			expect(
				await exists(
					join(
						cacheDir,
						"repos",
						"github.mycorp.com",
						"moxellabs",
						"atlas",
						"repo.json",
					),
				),
			).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("missing artifact local-only and maintainer instructions render safe handoffs", async () => {
		const cfg = join(rootDir, "missing-local.config.yaml");
		await writeFile(
			cfg,
			missingArtifactConfig("https://github.mycorp.com/api/v3"),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const localOnly = await runWithCapture([
				"add-repo",
				"moxellabs/atlas",
				"--cwd",
				rootDir,
				"--config",
				cfg,
				"--cache-dir",
				cacheDir,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"--local-only",
			]);
			expect(localOnly.stdout).toContain(
				"This repo doesn't publish an Atlas knowledge bundle yet.",
			);
			expect(localOnly.stdout).toContain("atlas index");
			const maintainer = await runWithCapture([
				"add-repo",
				"moxellabs/atlas",
				"--cwd",
				rootDir,
				"--config",
				cfg,
				"--cache-dir",
				cacheDir,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"--maintainer-instructions",
			]);
			expect(maintainer.stdout).toContain("## Optional maintainer steps");
			expect(maintainer.stdout).toContain("git add .moxel/atlas");
			expect(maintainer.stdout).toContain(
				"This is a request from a user of this repository, not an automated Atlas action.",
			);
			expect(maintainer.stdout).toContain(
				"Atlas does not branch, commit, push, create issues, or create PRs.",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("adoption template command renders human and JSON contracts", async () => {
		const human = await runWithCapture([
			"adoption-template",
			"moxellabs/atlas",
			"--repo-id",
			"github.com/moxellabs/atlas",
		]);
		expect(human.exitCode).toBe(0);
		for (const text of [
			"## Optional maintainer steps",
			"## Issue draft",
			"## PR draft",
			"atlas init",
			"atlas build",
			"git add .moxel/atlas",
			"manifest.json",
			"corpus.db",
			"checksums.json",
			"docs.index.json",
			"Would you consider publishing an Atlas docs bundle",
			"This is a request from a user of this repository, not an automated Atlas action.",
			"Atlas does not branch, commit, push, create issues, or create PRs.",
		])
			expect(human.stdout).toContain(text);

		const json = await runWithCapture([
			"adoption-template",
			"moxellabs/atlas",
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--json",
		]);
		const parsed = JSON.parse(json.stdout);
		expect(parsed.data.adoptionTemplates.issueTemplate).toContain("atlas init");
		expect(parsed.data.adoptionTemplates.prTemplate).toContain(
			"git add .moxel/atlas",
		);
		expect(parsed.data.adoptionTemplates.commands).toEqual([
			"atlas init",
			"atlas build",
			"git add .moxel/atlas",
		]);
	});

	test("adoption template filters and non-interactive repo id boundary", async () => {
		const issue = await runWithCapture([
			"adoption-template",
			"moxellabs/atlas",
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--issue-only",
		]);
		expect(issue.stdout).toContain("## Issue draft");
		expect(issue.stdout).not.toContain("## PR draft");
		const pr = await runWithCapture([
			"adoption-template",
			"moxellabs/atlas",
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--pr-only",
		]);
		expect(pr.stdout).toContain("## PR draft");
		expect(pr.stdout).not.toContain("## Issue draft");
		const maintainer = await runWithCapture([
			"adoption-template",
			"moxellabs/atlas",
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--maintainer-only",
		]);
		expect(maintainer.stdout).toContain("## Optional maintainer steps");
		expect(maintainer.stdout).not.toContain("## Issue draft");
		const repoIdOnly = await runWithCapture([
			"adoption-template",
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--non-interactive",
			"--json",
		]);
		expect(repoIdOnly.exitCode).toBe(0);
		expect(JSON.parse(repoIdOnly.stdout).data.repoId).toBe(
			"github.com/moxellabs/atlas",
		);
		const error = await runWithCapture([
			"adoption-template",
			"--non-interactive",
		]);
		expect(error.exitCode).toBe(2);
		expect(error.stderr).toContain(
			"Repository input or --repo-id is required.",
		);
	});

	test("missing artifact adoption template JSON includes issue and PR text", async () => {
		const cfg = join(rootDir, "missing-json-template.config.yaml");
		await writeFile(
			cfg,
			missingArtifactConfig("https://github.mycorp.com/api/v3"),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			const result = await runWithCapture([
				"add-repo",
				"moxellabs/atlas",
				"--cwd",
				rootDir,
				"--config",
				cfg,
				"--cache-dir",
				cacheDir,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"--issue-pr-instructions",
				"--json",
			]);
			const parsed = JSON.parse(result.stdout);
			expect(parsed.data).toMatchObject({
				missingArtifact: true,
				selectedAction: "generate-issue-pr-instructions",
				repoId: "github.mycorp.com/moxellabs/atlas",
			});
			expect(parsed.data.adoptionTemplates.issueTemplate).toContain(
				"manifest.json",
			);
			expect(parsed.data.adoptionTemplates.prTemplate).toContain(
				"docs.index.json",
			);
			expect(parsed.data.adoptionTemplates.commands).toContain(
				"git add .moxel/atlas",
			);
			expect(
				await exists(
					join(
						cacheDir,
						"repos",
						"github.mycorp.com",
						"moxellabs",
						"atlas",
						"repo.json",
					),
				),
			).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("adoption documentation contains required wording and avoids forbidden automation", async () => {
		const docs = await Promise.all(
			[
				"README.md",
				"docs/ingestion-build-flow.md",
				"docs/security.md",
				"docs/runtime-surfaces.md",
				"apps/cli/docs/index.md",
			].map((path) => readFile(path, "utf8")),
		);
		const combined = docs.join("\n");
		for (const required of [
			"atlas add-repo org/repo --maintainer-instructions",
			"atlas add-repo org/repo --issue-pr-instructions",
			"atlas adoption-template org/repo --repo-id github.com/org/repo",
			"Maintainers control branch names, commit messages, hooks, PR templates, and permissions.",
			"Atlas does not branch, commit, push, create issues, or create PRs.",
		])
			expect(combined).toContain(required);
		for (const forbidden of [
			"git push --force",
			"--no-verify",
			"disable branch protection",
			"skip required reviews",
			"create pull request automatically",
			"create issue automatically",
		])
			expect(combined).not.toContain(forbidden);
	});

	test("artifact verify artifact inspect artifact freshness support human JSON and freshness", async () => {
		const head = await gitOutput(originPath, ["rev-parse", "HEAD"]);
		await createCliArtifactFixture(originPath, head);
		const verify = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			originPath,
		]);
		expect(verify.exitCode).toBe(0);
		expect(verify.stdout).toContain("Bundle verified:");
		const inspect = await runWithCapture([
			"artifact",
			"inspect",
			"--cwd",
			originPath,
			"--json",
		]);
		expect(inspect.exitCode).toBe(0);
		expect(inspect.stdout).toContain('"docsIndex"');
		const fresh = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			originPath,
			"--fresh",
			"--ref",
			head,
		]);
		expect(fresh.exitCode).toBe(0);
		expect(fresh.stdout).toContain("fresh: true");
		const stale = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			originPath,
			"--fresh",
			"--ref",
			"def456",
		]);
		expect(stale.exitCode).not.toBe(0);
		expect(stale.stderr).toContain(
			"Artifact is stale; run atlas build and commit .moxel/atlas.",
		);
		const staleJson = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			originPath,
			"--fresh",
			"--ref",
			"def456",
			"--json",
		]);
		const staleJsonOutput = `${staleJson.stdout}\n${staleJson.stderr}`;
		expect(staleJsonOutput).toContain('"code": "CLI_ARTIFACT_VERIFY_FAILED"');
		expect(staleJsonOutput).toContain('"fresh": false');
	});

	test("public docs are static-site ready", async () => {
		const activePublicDocs = [
			"README.md",
			"docs/index.md",
			"docs/configuration.md",
			"docs/ingestion-build-flow.md",
			"docs/retrieval-and-context.md",
			"docs/runtime-surfaces.md",
			"docs/security.md",
			"docs/self-indexing.md",
			"apps/cli/docs/index.md",
			"apps/server/docs/index.md",
			"packages/compiler/docs/index.md",
			"packages/config/docs/index.md",
			"packages/core/docs/index.md",
			"packages/indexer/docs/index.md",
			"packages/mcp/docs/index.md",
			"packages/retrieval/docs/index.md",
			"packages/source-ghes/docs/index.md",
			"packages/source-git/docs/index.md",
			"packages/store/docs/index.md",
			"packages/testkit/docs/index.md",
			"packages/tokenizer/docs/index.md",
			"packages/topology/docs/index.md",
			"skills/document-codebase/SKILL.md",
			"skills/skill-creator/SKILL.md",
			"skills/atlas-contributor/SKILL.md",
		];

		const docs = await Promise.all(
			activePublicDocs.map(async (path) => ({
				path,
				content: await readFile(path, "utf8"),
			})),
		);

		for (const { path, content } of docs) {
			expect(content.startsWith("---\n")).toBe(true);
			const frontmatter = content.slice(0, content.indexOf("\n---\n", 4));
			for (const required of [
				"title:",
				"description:",
				"audience:",
				"purpose:",
				"visibility: public",
			])
				expect(frontmatter).toContain(required);
			if (!path.startsWith("skills/")) expect(frontmatter).toContain("order:");
		}

		const combined = docs.map(({ content }) => content).join("\n");
		for (const current of [
			"identity root",
			".moxel/atlas",
			"~/.moxel/atlas",
			"public artifact",
			"profile",
			"audience",
			"purpose",
			"visibility",
		])
			expect(combined).toContain(current);
		for (const stale of [
			"ATLAS_ARTIFACT_ROOT",
			"--artifact-root",
			"--moxellabs-atlas-artifact-root",
			"whiteLabel.artifactRoot",
			".atlas/artifact",
			"artifact/.moxel/atlas",
		])
			expect(combined).not.toContain(stale);
	});

	test("self-index public artifact includes active docs and excludes planning/archive", async () => {
		const selfRoot = join(rootDir, "self-index-atlas");
		await mkdir(join(selfRoot, "docs", "archive"), { recursive: true });
		await mkdir(join(selfRoot, ".planning"), { recursive: true });
		await mkdir(join(selfRoot, "skills", "document-codebase"), {
			recursive: true,
		});
		await mkdir(join(selfRoot, "apps", "cli", "docs"), { recursive: true });
		await mkdir(join(selfRoot, "packages", "indexer", "docs"), {
			recursive: true,
		});
		await writeFile(
			join(selfRoot, "package.json"),
			JSON.stringify({ name: "atlas", workspaces: ["apps/*", "packages/*"] }),
		);
		await writeFile(
			join(selfRoot, "README.md"),
			`---
title: Atlas
description: Public artifact overview.
audience: [consumer, contributor, maintainer]
purpose: [guide]
visibility: public
order: 1
---

# Atlas

Public artifact overview.
`,
		);
		await writeFile(
			join(selfRoot, "docs", "self-indexing.md"),
			`---
title: Self Indexing
description: Atlas self-indexing public artifact docs.
audience: [consumer, contributor, maintainer]
purpose: [workflow]
visibility: public
order: 70
---

# Self Indexing

Atlas self-indexing public artifact docs.
`,
		);
		await writeFile(join(selfRoot, "docs", "archive", "old.md"), "# Old\n");
		await writeFile(join(selfRoot, ".planning", "ROADMAP.md"), "# Roadmap\n");
		await writeFile(
			join(selfRoot, "skills", "document-codebase", "SKILL.md"),
			`---
name: document-codebase
description: Document codebases.
title: Document Codebase
visibility: public
audience: [contributor, maintainer]
purpose: [workflow]
order: 100
---

# Document Codebase

Use this skill to document codebases.
`,
		);
		await writeFile(
			join(selfRoot, "apps", "cli", "package.json"),
			JSON.stringify({ name: "@atlas/cli" }),
		);
		await writeFile(
			join(selfRoot, "apps", "cli", "docs", "index.md"),
			`---
title: CLI Docs
description: App docs.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 100
---

# CLI Docs

App docs.
`,
		);
		await writeFile(
			join(selfRoot, "packages", "indexer", "package.json"),
			JSON.stringify({ name: "@atlas/indexer" }),
		);
		await writeFile(
			join(selfRoot, "packages", "indexer", "docs", "index.md"),
			`---
title: Indexer Docs
description: Package docs.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 230
---

# Indexer Docs

Package docs.
`,
		);
		await git(selfRoot, ["init", "-b", "main"]);
		await git(selfRoot, ["config", "user.email", "atlas@example.test"]);
		await git(selfRoot, ["config", "user.name", "ATLAS Test"]);
		await git(selfRoot, ["add", "."]);
		await git(selfRoot, ["commit", "-m", "seed atlas docs"]);

		const init = await runWithCapture([
			"init",
			"--cwd",
			selfRoot,
			"--repo-id",
			"github.com/moxellabs/atlas",
			"--ref",
			"main",
			"--force",
		]);
		expect(init.exitCode).toBe(0);
		const build = await runWithCapture([
			"build",
			"--cwd",
			selfRoot,
			"--profile",
			"public",
			"--json",
		]);
		expect(build.exitCode).toBe(0);

		const artifactDir = join(selfRoot, ".moxel", "atlas");
		const docsIndex = JSON.parse(
			await readFile(join(artifactDir, "docs.index.json"), "utf8"),
		) as { documents: Array<{ path: string }> };
		const paths = docsIndex.documents.map((doc) => doc.path);
		expect(paths).toContain("README.md");
		expect(paths).toContain("docs/self-indexing.md");
		expect(paths).toContain("skills/document-codebase/SKILL.md");
		expect(paths).toContain("apps/cli/docs/index.md");
		expect(paths).toContain("packages/indexer/docs/index.md");
		expect(paths).not.toContain(".planning/ROADMAP.md");
		expect(paths).not.toContain("docs/archive/old.md");
		const manifest = JSON.parse(
			await readFile(join(artifactDir, "manifest.json"), "utf8"),
		);
		expect(manifest.profiles).toMatchObject({
			default: "public",
			applied: "public",
			available: ["public"],
		});
		expect((await validateArtifactChecksums(artifactDir)).valid).toBe(true);

		const artifactDb = new Database(join(artifactDir, "corpus.db"), {
			readonly: true,
		});
		try {
			expect(
				artifactDb
					.query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
					.get(".planning/ROADMAP.md") as { count: number },
			).toMatchObject({ count: 0 });
			expect(
				artifactDb
					.query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
					.get("docs/archive/old.md") as { count: number },
			).toMatchObject({ count: 0 });
			expect(
				artifactDb
					.query("SELECT COUNT(*) AS count FROM fts_entries WHERE path = ?")
					.get(".planning/ROADMAP.md") as { count: number },
			).toMatchObject({ count: 0 });
		} finally {
			artifactDb.close();
		}

		const fresh = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			selfRoot,
			"--fresh",
		]);
		expect(fresh.exitCode).toBe(0);
		const home = join(rootDir, "self-index-home");
		expect(
			(
				await runWithCapture(["setup", "--cwd", rootDir, "--non-interactive"], {
					HOME: home,
				})
			).exitCode,
		).toBe(0);
		expect(
			(
				await runWithCapture(
					["add-repo", selfRoot, "--cwd", rootDir, "--non-interactive"],
					{ HOME: home },
				)
			).exitCode,
		).toBe(0);
		const search = await runWithCapture(
			["search", "self-indexing", "--cwd", rootDir, "--json"],
			{ HOME: home },
		);
		expect(search.exitCode).toBe(0);
		expect(search.stdout).toContain("docs/self-indexing.md");
		expect(search.stdout).not.toContain(".planning/");
	});

	test("identity root init build verify inspect migration and validation", async () => {
		const init = await runWithCapture([
			"init",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			".acme/knowledge",
			"--repo-id",
			"github.com/acme/docs",
		]);
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain("Knowledge bundle: .acme/knowledge");
		expect(
			await exists(join(originPath, ".acme", "knowledge", "atlas.repo.json")),
		).toBe(true);
		expect(await exists(join(originPath, ".moxel", "atlas"))).toBe(false);

		const initJson = await runWithCapture([
			"init",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			".alias/knowledge",
			"--repo-id",
			"github.com/acme/docs",
			"--force",
			"--json",
		]);
		expect(JSON.parse(initJson.stdout).data.artifactRoot).toBe(
			".alias/knowledge",
		);

		const build = await runWithCapture([
			"build",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			".acme/knowledge",
			"--force",
		]);
		expect(build.exitCode).toBe(0);
		for (const file of [
			"manifest.json",
			"corpus.db",
			"checksums.json",
			"docs.index.json",
		]) {
			expect(await exists(join(originPath, ".acme", "knowledge", file))).toBe(
				true,
			);
		}

		const head = await gitOutput(originPath, ["rev-parse", "HEAD"]);
		await createCliArtifactFixture(
			originPath,
			head,
			join(".acme", "knowledge"),
		);
		const verify = await runWithCapture([
			"artifact",
			"verify",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			".acme/knowledge",
		]);
		expect(verify.exitCode).toBe(0);
		expect(verify.stdout).toContain("Knowledge bundle: .acme/knowledge");

		const inspect = await runWithCapture([
			"artifact",
			"inspect",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			".acme/knowledge",
			"--json",
		]);
		expect(inspect.exitCode).toBe(0);
		expect(JSON.parse(inspect.stdout).data.artifactRoot).toBe(
			".acme/knowledge",
		);

		const envRoot = await runWithCapture(
			[
				"init",
				"--cwd",
				originPath,
				"--repo-id",
				"github.com/acme/docs",
				"--force",
			],
			{ ATLAS_IDENTITY_ROOT: ".env/knowledge" },
		);
		expect(envRoot.stdout).toContain("Knowledge bundle: .env/knowledge");

		await writeFile(
			join(originPath, "atlas.config.yaml"),
			`version: 1\ncacheDir: .cache\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .config/knowledge\nrepos: []\n`,
		);
		const configRoot = await runWithCapture([
			"init",
			"--cwd",
			originPath,
			"--repo-id",
			"github.com/acme/docs",
			"--force",
		]);
		expect(configRoot.stdout).toContain("Knowledge bundle: .config/knowledge");

		const invalid = await runWithCapture([
			"init",
			"--cwd",
			originPath,
			"--atlas-identity-root",
			"../secret",
			"--repo-id",
			"github.com/acme/docs",
		]);
		expect(invalid.exitCode).not.toBe(0);
		expect(invalid.stderr).toContain(
			"identity root must be relative and cannot contain traversal",
		);

		const migrationRoot = await mkdtemp(
			join(tmpdir(), "atlas-migration-root-"),
		);
		try {
			await createOriginRepo(migrationRoot);
			await mkdir(join(migrationRoot, ".moxel", "atlas"), { recursive: true });
			const missing = await runWithCapture([
				"artifact",
				"verify",
				"--cwd",
				migrationRoot,
				"--atlas-identity-root",
				".acme/knowledge",
			]);
			expect(missing.exitCode).not.toBe(0);
			expect(missing.stderr).toContain(".moxel/atlas exists");
			expect(missing.stderr).toContain("no migration");
			expect(missing.stderr).toContain("no fallback");
		} finally {
			await rm(migrationRoot, { recursive: true, force: true });
		}
	});

	test("add-repo mirrors artifacts directly under identity root in repo storage", async () => {
		const head = await gitOutput(originPath, ["rev-parse", "HEAD"]);
		await createCliArtifactFixture(originPath, head);
		await git(originPath, [
			"remote",
			"add",
			"origin",
			"https://github.com/moxellabs/atlas.git",
		]);
		await runWithCapture([
			"setup",
			"--cwd",
			rootDir,
			"--cache-dir",
			cacheDir,
			"--non-interactive",
		]);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = artifactFixtureFetch(originPath, ".moxel/atlas");
		try {
			const added = await runWithCapture([
				"add-repo",
				originPath,
				"--cwd",
				rootDir,
				"--cache-dir",
				cacheDir,
				"--non-interactive",
				"--json",
				"--repo-id",
				"github.com/moxellabs/atlas",
				"--mode",
				"local-git",
				"--remote",
				"https://github.com/moxellabs/atlas.git",
				"--host",
				"github.com",
				"--base-url",
				"https://github.com/api/v3",
				"--owner",
				"moxellabs",
				"--name",
				"atlas",
				"--ref",
				head,
				"--template",
				"mixed-monorepo",
			]);
			expect([0, 2]).toContain(added.exitCode);
			const mirrorRoot = join(
				cacheDir,
				"repos",
				"github.com",
				"moxellabs",
				"atlas",
				".moxel",
				"atlas",
			);
			expect(await exists(join(mirrorRoot, "manifest.json"))).toBe(true);
			expect(
				await exists(
					join(
						cacheDir,
						"repos",
						"github.com",
						"moxellabs",
						"atlas",
						".atlas",
						"artifact",
						"manifest.json",
					),
				),
			).toBe(false);
			expect(
				await exists(
					join(
						cacheDir,
						"repos",
						"github.com",
						"moxellabs",
						"atlas",
						"artifact",
						".moxel",
						"atlas",
						"manifest.json",
					),
				),
			).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("add-repo custom identity mirrors artifact root without default fallback", async () => {
		const head = await gitOutput(originPath, ["rev-parse", "HEAD"]);
		await createCliArtifactFixture(
			originPath,
			head,
			join(".acme", "knowledge"),
		);
		await createCliArtifactFixture(originPath, head);
		await rm(join(originPath, ".moxel", "atlas"), {
			recursive: true,
			force: true,
		});
		await git(originPath, [
			"remote",
			"add",
			"origin",
			"https://github.com/moxellabs/atlas.git",
		]);
		const customCacheDir = join(rootDir, ".acme", "knowledge");
		const customConfigPath = join(
			rootDir,
			"home",
			".acme",
			"knowledge",
			"config.yaml",
		);
		await runWithCapture([
			"setup",
			"--cwd",
			rootDir,
			"--cache-dir",
			customCacheDir,
			"--atlas-identity-root",
			".acme/knowledge",
			"--non-interactive",
		]);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = artifactFixtureFetch(originPath, ".acme/knowledge");
		try {
			const added = await runWithCapture([
				"add-repo",
				originPath,
				"--cwd",
				rootDir,
				"--config",
				customConfigPath,
				"--cache-dir",
				customCacheDir,
				"--atlas-identity-root",
				".acme/knowledge",
				"--non-interactive",
				"--json",
				"--repo-id",
				"github.com/moxellabs/atlas",
				"--mode",
				"local-git",
				"--remote",
				"https://github.com/moxellabs/atlas.git",
				"--host",
				"github.com",
				"--base-url",
				"https://github.com/api/v3",
				"--owner",
				"moxellabs",
				"--name",
				"atlas",
				"--ref",
				head,
				"--template",
				"mixed-monorepo",
			]);
			expect([0, 2]).toContain(added.exitCode);
			const mirrorRoot = join(
				customCacheDir,
				"repos",
				"github.com",
				"moxellabs",
				"atlas",
				".acme",
				"knowledge",
			);
			expect(await exists(join(mirrorRoot, "manifest.json"))).toBe(true);
			expect(
				await exists(
					join(
						customCacheDir,
						"repos",
						"github.com",
						"moxellabs",
						"atlas",
						".atlas",
						"artifact",
						"manifest.json",
					),
				),
			).toBe(false);
			expect(
				await exists(
					join(
						customCacheDir,
						"repos",
						"github.com",
						"moxellabs",
						"atlas",
						"artifact",
						".acme",
						"knowledge",
						"manifest.json",
					),
				),
			).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("artifact verification documentation guards freshness and boundaries", async () => {
		const docs = await Promise.all(
			[
				"README.md",
				"docs/ingestion-build-flow.md",
				"docs/security.md",
				"docs/runtime-surfaces.md",
				"apps/cli/docs/index.md",
			].map((path) => readFile(path, "utf8")),
		);
		const combined = docs.join("\n");
		for (const required of [
			"atlas artifact verify --fresh",
			"atlas artifact inspect",
			"Artifact is stale; run atlas build and commit .moxel/atlas.",
			"Maintainers control branch names, commit messages, hooks, PR templates, and permissions.",
			"Atlas does not branch, commit, push, create issues, or create PRs.",
		])
			expect(combined).toContain(required);
		for (const forbidden of [
			"git push --force",
			"--no-verify",
			"disable branch protection",
			"skip required reviews",
			"automatically create pull request",
			"automatically create issue",
		])
			expect(combined).not.toContain(forbidden);
	});

	test("consumer UX help docs mention clean-break workflows", async () => {
		const help = await runWithCapture(["--help"]);
		expect(help.exitCode).toBe(0);
		for (const required of [
			"~/.moxel/atlas",
			".moxel/atlas",
			"hosts",
			"add-repo",
			"index",
			"search",
			"repo",
			"artifact",
			"mcp",
			"GitHub/GHES hosts",
			"local imported corpus",
		])
			expect(help.stdout).toContain(required);

		const artifactHelp = await runWithCapture(["artifact"]);
		expect(artifactHelp.stdout).toContain(
			"Verify and inspect Atlas knowledge bundles",
		);

		const docs = await Promise.all(
			[
				"README.md",
				"docs/ingestion-build-flow.md",
				"docs/configuration.md",
				"apps/cli/docs/index.md",
			].map((path) => readFile(path, "utf8")),
		);
		const combined = docs.join("\n");
		for (const required of [
			"Consumer repo consumption workflow",
			"Maintainer artifact publishing workflow",
			"Enterprise host setup and troubleshooting",
			"Artifact is stale; importing anyway.",
			"Use --host <host> or a full SSH/HTTPS URL",
			"do not fetch remote source at query time",
		])
			expect(combined).toContain(required);
	});

	test("consumer UX local artifact fixture helper creates artifact files", async () => {
		const workspace = await createConsumerUxWorkspace(rootDir);
		await writeConsumerUxArtifact(workspace.repoPath, "consumer-revision");
		for (const file of [
			"manifest.json",
			"corpus.db",
			"checksums.json",
			"docs.index.json",
		])
			expect(
				await exists(join(workspace.repoPath, ".moxel", "atlas", file)),
			).toBe(true);
		expectNoGitMutationCommands([
			"atlas setup",
			"atlas add-repo platform/docs",
			"atlas search deployment",
		]);
	});
});

function cliMcpAdoptionDataset() {
	return {
		name: "cli-mcp-adoption",
		cases: [
			{
				id: "indexed",
				prompt:
					"In the indexed atlas repo, how does plan_context choose evidence?",
				category: "indexed",
				expected: {
					mustCall: [
						{ kind: "read_resource", uri: "atlas://manifest" },
						{ kind: "call_tool", name: "plan_context" },
					],
				},
			},
			{
				id: "generic",
				prompt: "What is a good commit message format?",
				category: "generic",
				expected: { mustCall: [{ kind: "no_call" }] },
			},
		],
	};
}

async function runWithCapture(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = {},
) {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let stdoutText = "";
	let stderrText = "";
	stdout.on("data", (chunk) => {
		stdoutText += chunk.toString("utf8");
	});
	stderr.on("data", (chunk) => {
		stderrText += chunk.toString("utf8");
	});

	const cwdFlagIndex = argv.indexOf("--cwd");
	const cwd = cwdFlagIndex >= 0 ? argv[cwdFlagIndex + 1] : undefined;
	const defaultHome = cwd === undefined ? undefined : join(cwd, "home");
	const exitCode = await runCli(argv, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		stderr: stderr as unknown as NodeJS.WriteStream,
		stdin: process.stdin,
		env: {
			...(defaultHome === undefined ? {} : { HOME: defaultHome }),
			...env,
		},
	});

	return {
		exitCode,
		stdout: stdoutText,
		stderr: stderrText,
	};
}

function missingArtifactConfig(baseUrl: string): string {
	return `
version: 1
cacheDir: .cache/atlas
logLevel: info
server:
  transport: http
hosts:
  - name: github.mycorp.com
    webUrl: https://github.mycorp.com
    apiUrl: ${baseUrl}
    protocol: https
    default: true
    priority: 100
repos: []
`;
}

function ghesConfig(baseUrl: string): string {
	return `
version: 1
cacheDir: .cache/atlas
logLevel: info
server:
  transport: http
repos:
  - repoId: github.mycorp.com/platform/ghes
    mode: ghes-api
    github:
      baseUrl: ${baseUrl}
      owner: moxellabs
      name: atlas
      ref: main
      tokenEnvVar: ATLAS_GHES_TOKEN
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
}

function createCommandContext(argv: readonly string[]): CliCommandContext {
	return {
		argv,
		cwd: process.cwd(),
		output: { json: true, verbose: false, quiet: false },
		stdin: process.stdin,
		stdout: new PassThrough() as unknown as NodeJS.WriteStream,
		stderr: new PassThrough() as unknown as NodeJS.WriteStream,
		env: {},
	};
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

async function createOriginRepo(originPath: string): Promise<void> {
	await mkdir(join(originPath, "docs"), { recursive: true });
	await mkdir(join(originPath, "packages", "auth", "docs"), {
		recursive: true,
	});
	await mkdir(join(originPath, "Auth", "docs", "auth-skill"), {
		recursive: true,
	});
	await git(originPath, ["init", "-b", "main"]);
	await git(originPath, ["config", "user.email", "atlas@example.test"]);
	await git(originPath, ["config", "user.name", "ATLAS Test"]);
	await writeFile(
		join(originPath, "docs", "index.md"),
		"# Index\n\nRepository docs.\n",
	);
	await writeFile(
		join(originPath, "packages", "auth", "package.json"),
		JSON.stringify({ name: "@atlas/auth" }, null, 2),
	);
	await writeFile(
		join(originPath, "packages", "auth", "docs", "api.md"),
		"# API\n\nPackage documentation.\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "overview.md"),
		"# Overview\n\nModule documentation.\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "auth-skill", "skill.md"),
		"# Auth Skill\n\nUse this skill to answer questions.\n",
	);
	await git(originPath, ["add", "."]);
	await git(originPath, ["commit", "-m", "initial"]);
}

async function createConsumerUxWorkspace(
	root: string,
): Promise<{ repoPath: string }> {
	const repoPath = join(root, "consumer-ux-repo");
	await mkdir(join(repoPath, "docs"), { recursive: true });
	await writeFile(
		join(repoPath, "docs", "runbook.md"),
		"# Deployment rollback\n\nRollback deployment using local imported corpus docs.\n",
	);
	return { repoPath };
}

async function writeConsumerUxArtifact(
	repoPath: string,
	revision: string,
): Promise<void> {
	await createCliArtifactFixture(repoPath, revision);
}

function expectNoGitMutationCommands(commands: readonly string[]): void {
	for (const command of commands) {
		expect(command).not.toMatch(
			/\bgit (add|commit|push|checkout -b|switch -c)\b/,
		);
	}
}

async function git(cwd: string, args: string[]): Promise<void> {
	const process = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(await new Response(process.stderr).text());
	}
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}

function artifactFixtureFetch(
	root: string,
	artifactRoot: string,
): typeof fetch {
	return (async (input) => {
		const url = new URL(String(input));
		const prefix = `/api/v3/repos/moxellabs/atlas/contents/${artifactRoot}/`;
		if (!url.pathname.startsWith(prefix))
			return new Response(JSON.stringify({ message: "not found" }), {
				status: 404,
			});
		const file = url.pathname.slice(prefix.length);
		const artifactFile = Bun.file(join(root, artifactRoot, file));
		if (!(await artifactFile.exists()))
			return new Response(JSON.stringify({ message: "not found" }), {
				status: 404,
			});
		return new Response(await artifactFile.arrayBuffer());
	}) as typeof fetch;
}

async function createCliArtifactFixture(
	root: string,
	revision: string,
	artifactRoot = join(".moxel", "atlas"),
): Promise<void> {
	const repoId = "github.com/moxellabs/atlas";
	const sourceDbPath = join(root, "atlas-source.db");
	const db = openStore({ path: sourceDbPath, migrate: true });
	try {
		new RepoRepository(db).upsert({ repoId, mode: "local-git", revision });
		new ManifestRepository(db).upsert({
			repoId,
			indexedRevision: revision,
			compilerVersion: "test",
		});
		const artifactDir = join(root, artifactRoot);
		await mkdir(artifactDir, { recursive: true });
		await writePrettyJson(
			join(artifactDir, "manifest.json"),
			buildArtifactManifest({ repoId, ref: "main", indexedRevision: revision }),
		);
		await writePrettyJson(
			join(artifactDir, "docs.index.json"),
			buildDocsIndex(db, repoId),
		);
		db.close();
		await exportCorpusDbSnapshot(sourceDbPath, join(artifactDir, "corpus.db"));
		await writeArtifactChecksums(artifactDir);
	} finally {
		try {
			db.close();
		} catch {
			// Closed after artifact docs index write.
		}
	}
}

// Phase 13 smoke coverage for host setup/resolver parser.
test("phase 13 hosts and repo resolver smoke", async () => {
	const root = await mkdtemp(join(tmpdir(), "atlas-phase13-"));
	const config = join(root, "home", ".moxel", "atlas", "config.yaml");
	expect(
		(
			await runWithCapture([
				"setup",
				"--cwd",
				root,
				"--non-interactive",
				"--json",
			])
		).exitCode,
	).toBe(0);
	expect(
		(await runWithCapture(["hosts", "list", "--cwd", root, "--json"])).exitCode,
	).toBe(0);
	expect(
		(
			await runWithCapture([
				"hosts",
				"add",
				"github.mycorp.com",
				"--cwd",
				root,
				"--web-url",
				"https://github.mycorp.com",
				"--api-url",
				"https://github.mycorp.com/api/v3",
				"--protocol",
				"ssh",
				"--priority",
				"10",
				"--default",
				"--json",
			])
		).exitCode,
	).toBe(0);
	const configText = await readFile(config, "utf8");
	expect(configText).toContain("github.mycorp.com");
	expect(configText).toContain("https://github.mycorp.com/api/v3");
	expect(
		(
			await runWithCapture([
				"add-repo",
				"platform/docs",
				"--cwd",
				root,
				"--host",
				"github.mycorp.com",
				"--template",
				"mixed-monorepo",
				"--non-interactive",
				"--template",
				"basic",
				"--json",
			])
		).exitCode,
	).toBe(0);
	await rm(root, { recursive: true, force: true });
});
