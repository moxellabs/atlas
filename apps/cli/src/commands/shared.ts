import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type AtlasConfig,
	type AtlasRepoConfig,
	buildDefaultConfig,
	buildDefaultCorpusDbPath,
	DEFAULT_ATLAS_ARTIFACT_ROOT,
	DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
	IDENTITY_ROOT_ERROR,
	loadConfig,
	parseCanonicalRepoId,
	repoPathSegments,
	resolveIdentityProfile,
} from "@atlas/config";
import {
	DocRepository,
	ManifestRepository,
	ModuleRepository,
	PackageRepository,
	RepoRepository,
	SectionRepository,
	SkillRepository,
	SummaryRepository,
} from "@atlas/store";
import { CliConsole } from "../io/console";
import { canPrompt, createPrompts } from "../io/prompts";
import { renderTable } from "../io/table";
import {
	buildCliDependencies,
	mutateAtlasConfig,
	repoCheckoutDir,
} from "../runtime/dependencies";
import type {
	AtlasCliDependencies,
	CliCommandContext,
	CliCommandResult,
} from "../runtime/types";
import {
	CliError,
	EXIT_INPUT_ERROR,
	exitCodeForReport,
	summarizeReport,
} from "../utils/errors";
import { runProcess } from "../utils/node-runtime";
import { parentDir, resolveCliPath } from "../utils/paths";
import {
	type TopologyTemplate,
	topologyTemplate,
} from "../utils/topology-templates";

/** Creates the stream-backed console for one command run. */
export function createCliConsole(context: CliCommandContext): CliConsole {
	return new CliConsole(context.output, context.stdout, context.stderr);
}

export interface CliArtifactRootResolution {
	artifactRoot: string;
	artifactDir: string;
	customRootUsed: boolean;
	source: "cli" | "env" | "config" | "default";
}

export async function resolveCliArtifactRoot(
	context: CliCommandContext,
	root: string = context.cwd,
): Promise<CliArtifactRootResolution> {
	let configIdentity: { root?: string | undefined } | undefined;
	try {
		const configPath = readArgvString(context.argv, "--config");
		const loaded = await loadConfig({
			cwd: context.cwd,
			env: context.env,
			...(configPath === undefined ? {} : { configPath }),
			requireGhesAuth: false,
		});
		configIdentity = loaded.config.identity;
	} catch {
		configIdentity = undefined;
	}
	try {
		const profile = resolveIdentityProfile({
			cliIdentityRoot: context.identityRoot,
			envIdentityRoot: context.env.ATLAS_IDENTITY_ROOT,
			configIdentity,
		});
		return {
			artifactRoot: profile.artifactRoot,
			artifactDir: join(root, profile.artifactRoot),
			customRootUsed: profile.customIdentityRoot,
			source: profile.identityRootSource,
		};
	} catch (error) {
		throw new CliError(
			error instanceof Error ? error.message : IDENTITY_ROOT_ERROR,
			{ code: "CLI_INVALID_ARTIFACT_ROOT", exitCode: EXIT_INPUT_ERROR },
		);
	}
}

export async function readRepoLocalArtifactMetadata(
	context: CliCommandContext,
	root: string,
): Promise<{ repoId: string; path: string } | undefined> {
	const artifactRoot = await resolveCliArtifactRoot(context, root);
	const path = join(artifactRoot.artifactDir, "atlas.repo.json");
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as {
			repoId?: unknown;
		};
		if (typeof raw.repoId === "string") return { repoId: raw.repoId, path };
		return undefined;
	} catch {
		return undefined;
	}
}

export async function maybeRenderArtifactRootMigrationHint(input: {
	root: string;
	artifactRoot: string;
	customRootUsed: boolean;
}): Promise<string | undefined> {
	if (!input.customRootUsed) return undefined;
	if (await pathExists(join(input.root, input.artifactRoot))) return undefined;
	if (!(await pathExists(join(input.root, DEFAULT_ATLAS_ARTIFACT_ROOT))))
		return undefined;
	return `${DEFAULT_ATLAS_ARTIFACT_ROOT} exists, but ${input.artifactRoot} was selected; no migration was performed and no fallback will be used.`;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Loads dependencies using already parsed global flags. */
export async function loadDependenciesFromGlobal(
	context: CliCommandContext,
	configPath?: string,
) {
	return buildCliDependencies({
		cwd: context.cwd,
		env: {
			...context.env,
			...(context.identityRoot === undefined
				? {}
				: { ATLAS_IDENTITY_ROOT: context.identityRoot }),
		},
		...(configPath === undefined ? {} : { configPath }),
	});
}

/** Renders success in human or JSON mode. */
export async function renderSuccess<T>(
	context: CliCommandContext,
	command: string,
	data: T,
	lines: string[] = [],
	exitCode = 0,
): Promise<CliCommandResult<T>> {
	const consoleIo = createCliConsole(context);
	const result = {
		ok: true as const,
		command,
		data,
		...(exitCode === 0 ? {} : { exitCode }),
	};
	if (context.output.json) {
		await consoleIo.jsonSuccess(result);
	} else {
		const renderedLines =
			lines.length > 0 ? lines : [JSON.stringify(data, null, 2)];
		for (const line of renderedLines) {
			await consoleIo.info(line);
		}
	}
	return result;
}

/** Returns a default config object for `atlas init`. */
export function defaultCliConfig(cacheDir?: string): AtlasConfig {
	const config = buildDefaultConfig(cacheDir);
	return {
		...config,
		corpusDbPath: buildDefaultCorpusDbPath(config.cacheDir),
	};
}

type RepoConfigMode = "local-git" | "ghes-api";
type RepoConfigPrompts = ReturnType<typeof createPrompts> | undefined;

interface RepoConfigInput {
	repoId?: string | undefined;
	mode?: RepoConfigMode | undefined;
	remote?: string | undefined;
	localPath?: string | undefined;
	ref?: string | undefined;
	refMode?: "remote" | "current-checkout" | undefined;
	baseUrl?: string | undefined;
	owner?: string | undefined;
	name?: string | undefined;
	tokenEnvVar?: string | undefined;
	packageGlobs: string[];
	packageManifestFiles: string[];
	template?: TopologyTemplate | undefined;
	cacheDir: string;
	nonInteractive: boolean;
}

interface RepoConfigResolutionContext {
	cwd: string;
	interactive: boolean;
	prompts: RepoConfigPrompts;
}

interface RepoWorkspaceInput {
	packageGlobs: string[];
	packageManifestFiles: string[];
	template: TopologyTemplate;
}

/** Creates a local-git repo entry from parsed flags or interactive defaults. */
export async function resolveRepoConfigInput(
	context: CliCommandContext,
	input: RepoConfigInput,
): Promise<AtlasRepoConfig> {
	const resolution = createRepoConfigResolutionContext(context, input);
	const mode = await resolveRepoConfigMode(input, resolution);
	const repoId = await resolveRepoConfigRepoId(input, resolution);
	const workspace = resolveRepoWorkspaceInput(input);
	return mode === "local-git"
		? await resolveLocalGitRepoConfig(
				context,
				input,
				resolution,
				repoId,
				workspace,
			)
		: await resolveGhesRepoConfig(input, resolution, repoId, workspace);
}

function createRepoConfigResolutionContext(
	context: CliCommandContext,
	input: RepoConfigInput,
): RepoConfigResolutionContext {
	const interactive = canPrompt() && !input.nonInteractive;
	return {
		cwd: context.cwd,
		interactive,
		prompts: interactive ? createPrompts() : undefined,
	};
}

async function resolveRepoConfigMode(
	input: RepoConfigInput,
	context: RepoConfigResolutionContext,
): Promise<RepoConfigMode> {
	if (input.mode !== undefined) {
		return input.mode;
	}
	if (!context.interactive) {
		return "local-git";
	}
	return (await context.prompts?.select("Choose repository mode", [
		{ label: "Local Git", value: "local-git" },
		{ label: "GitHub Enterprise API", value: "ghes-api" },
	])) as RepoConfigMode;
}

async function resolveRepoConfigRepoId(
	input: RepoConfigInput,
	context: RepoConfigResolutionContext,
): Promise<string> {
	const repoId =
		input.repoId ?? (await promptIfInteractive(context, "Repository ID"));
	if (repoId === undefined || repoId.length === 0) {
		throw new CliError("Missing repository ID.", {
			code: "CLI_REPO_ID_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return repoId;
}

function resolveRepoWorkspaceInput(input: RepoConfigInput): RepoWorkspaceInput {
	return {
		packageGlobs:
			input.packageGlobs.length > 0 ? input.packageGlobs : ["packages/*"],
		packageManifestFiles:
			input.packageManifestFiles.length > 0
				? input.packageManifestFiles
				: ["package.json"],
		template: input.template ?? "mixed-monorepo",
	};
}

async function resolveLocalGitRepoConfig(
	cliContext: CliCommandContext,
	input: RepoConfigInput,
	context: RepoConfigResolutionContext,
	repoId: string,
	workspace: RepoWorkspaceInput,
): Promise<AtlasRepoConfig> {
	const gitDefaults = await detectLocalGitDefaults(cliContext.cwd);
	const defaultRef = gitDefaults?.ref ?? "main";
	const defaultLocalPath = resolveCliPath(
		repoCheckoutDir(input.cacheDir, repoId),
		cliContext.cwd,
	);
	const ref =
		input.ref ??
		(await promptIfInteractive(context, "Git ref", defaultRef)) ??
		defaultRef;
	const localPath =
		input.localPath ??
		(await promptIfInteractive(
			context,
			"Local checkout path",
			defaultLocalPath,
		)) ??
		defaultLocalPath;
	const remote =
		input.remote ??
		(await promptIfInteractive(
			context,
			"Git remote URL",
			gitDefaults?.remote,
		)) ??
		gitDefaults?.remote;
	const git = requireLocalGitFields(remote, localPath, ref);
	return {
		repoId,
		mode: "local-git",
		git: { ...git, refMode: input.refMode ?? "remote" },
		workspace: repoWorkspaceConfig(workspace),
		topology: topologyTemplate(workspace.template),
	};
}

async function resolveGhesRepoConfig(
	input: RepoConfigInput,
	context: RepoConfigResolutionContext,
	repoId: string,
	workspace: RepoWorkspaceInput,
): Promise<AtlasRepoConfig> {
	const ref =
		input.ref ??
		(await promptIfInteractive(context, "GitHub ref", "main")) ??
		"main";
	const baseUrl =
		input.baseUrl ?? (await promptIfInteractive(context, "GHES API base URL"));
	const owner =
		input.owner ?? (await promptIfInteractive(context, "GHES owner"));
	const name =
		input.name ?? (await promptIfInteractive(context, "GHES repository name"));
	const ghes = requireGhesFields(baseUrl, owner, name);
	return {
		repoId,
		mode: "ghes-api",
		github: {
			...ghes,
			ref,
			...(input.tokenEnvVar === undefined
				? {}
				: { tokenEnvVar: input.tokenEnvVar }),
		},
		workspace: repoWorkspaceConfig(workspace),
		topology: topologyTemplate(workspace.template),
	};
}

async function promptIfInteractive(
	context: RepoConfigResolutionContext,
	message: string,
	defaultValue?: string | undefined,
): Promise<string | undefined> {
	return context.interactive
		? await context.prompts?.input(message, defaultValue)
		: undefined;
}

function requireLocalGitFields(
	remote: string | undefined,
	localPath: string | undefined,
	ref: string | undefined,
): { remote: string; localPath: string; ref: string } {
	if (
		remote === undefined ||
		remote.length === 0 ||
		localPath === undefined ||
		localPath.length === 0 ||
		ref === undefined ||
		ref.length === 0
	) {
		throw new CliError(
			"Missing local-git remote. Use --remote, or run add-repo from inside a Git checkout so Atlas can infer one.",
			{ code: "CLI_REMOTE_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
	return { remote, localPath, ref };
}

function requireGhesFields(
	baseUrl: string | undefined,
	owner: string | undefined,
	name: string | undefined,
): { baseUrl: string; owner: string; name: string } {
	if (
		baseUrl === undefined ||
		baseUrl.length === 0 ||
		owner === undefined ||
		owner.length === 0 ||
		name === undefined ||
		name.length === 0
	) {
		throw new CliError(
			"Missing GHES repository fields. Use --base-url, --owner, and --name in non-interactive mode.",
			{ code: "CLI_GHES_FIELDS_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
	return { baseUrl, owner, name };
}

function repoWorkspaceConfig(
	input: RepoWorkspaceInput,
): AtlasRepoConfig["workspace"] {
	return {
		packageGlobs: input.packageGlobs,
		packageManifestFiles: input.packageManifestFiles,
	};
}

/** Adds one repo safely to the ATLAS config. */
export async function appendRepoConfig(
	context: CliCommandContext,
	repo: AtlasRepoConfig,
	options: {
		configPath?: string | undefined;
		cacheDir?: string | undefined;
	} = {},
) {
	const result = await mutateAtlasConfig(
		{
			cwd: context.cwd,
			env: context.env,
			...(options.configPath === undefined
				? {}
				: { configPath: options.configPath }),
			...(options.cacheDir !== undefined
				? { createDefault: defaultCliConfig(options.cacheDir) }
				: {}),
		},
		(config) => {
			if (config.repos.some((entry) => entry.repoId === repo.repoId)) {
				throw new CliError(
					`Repository ${repo.repoId} already exists in config.`,
					{
						code: "CLI_DUPLICATE_REPO",
						exitCode: EXIT_INPUT_ERROR,
					},
				);
			}
			return {
				...config,
				repos: [...config.repos, repo],
			};
		},
	);
	await mkdir(resolveCliPath(result.config.cacheDir, context.cwd), {
		recursive: true,
	});
	await mkdir(
		resolveCliPath(
			`${result.config.cacheDir}/${DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH}`,
			context.cwd,
		),
		{ recursive: true },
	);
	await mkdir(
		parentDir(resolveCliPath(result.config.corpusDbPath, context.cwd)),
		{ recursive: true },
	);
	await writeRepoMetadata(
		repoMetadataPath(
			resolveCliPath(result.config.cacheDir, context.cwd),
			repo.repoId,
		),
		createRepoMetadata(repo),
	);
	return result;
}

export interface RepoMetadata {
	schemaVersion: 1;
	repoId: string;
	host: string;
	owner: string;
	name: string;
	source:
		| {
				mode: "local-git";
				remote: string;
				localPath: string;
				ref: string;
				refMode: "remote" | "current-checkout";
		  }
		| {
				mode: "ghes-api";
				baseUrl: string;
				owner: string;
				name: string;
				ref: string;
				tokenEnvVar: string | null;
		  };
	createdAt: string;
	updatedAt: string;
	artifactPath: string | null;
	artifactSource?: "local-artifact" | "remote-artifact" | undefined;
	artifactValidatedAt?: string | undefined;
	indexedRevision?: string | undefined;
	remoteHeadRevision?: string | undefined;
	stale?: boolean | undefined;
	importStatus?: "ready" | "imported" | "missing-artifact" | undefined;
	indexSource?: "local-only" | undefined;
	checkoutPath?: string | undefined;
	importedAt?: string | undefined;
	globalCorpusPath?: string | undefined;
	importCounts?: Record<string, number> | undefined;
	documentationSignal?: Record<string, unknown> | undefined;
}

export function repoFolderPath(atlasHome: string, repoId: string): string {
	return join(
		atlasHome,
		DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
		...repoPathSegments(repoId),
	);
}

export function repoMetadataPath(atlasHome: string, repoId: string): string {
	return join(repoFolderPath(atlasHome, repoId), "repo.json");
}

export function createRepoMetadata(
	repo: AtlasRepoConfig,
	now = new Date().toISOString(),
): RepoMetadata {
	const { host, owner, name } = parseCanonicalRepoId(repo.repoId);
	return {
		schemaVersion: 1,
		repoId: repo.repoId,
		host,
		owner,
		name,
		source:
			repo.mode === "local-git"
				? {
						mode: "local-git",
						remote: repo.git?.remote ?? "",
						localPath: repo.git?.localPath ?? "",
						ref: repo.git?.ref ?? "",
						refMode: repo.git?.refMode ?? "remote",
					}
				: {
						mode: "ghes-api",
						baseUrl: repo.github?.baseUrl ?? "",
						owner: repo.github?.owner ?? "",
						name: repo.github?.name ?? "",
						ref: repo.github?.ref ?? "",
						tokenEnvVar: repo.github?.tokenEnvVar ?? null,
					},
		createdAt: now,
		updatedAt: now,
		artifactPath: null,
	};
}

export async function readRepoMetadata(path: string): Promise<RepoMetadata> {
	const metadata = JSON.parse(await readFile(path, "utf8")) as RepoMetadata;
	if (
		metadata.schemaVersion !== 1 ||
		metadata.repoId === undefined ||
		metadata.host === undefined ||
		metadata.owner === undefined ||
		metadata.name === undefined ||
		metadata.source === undefined ||
		metadata.createdAt === undefined ||
		metadata.updatedAt === undefined ||
		!("artifactPath" in metadata)
	) {
		throw new Error(`Invalid repo metadata: ${path}`);
	}
	return metadata;
}

export async function writeRepoMetadata(
	path: string,
	metadata: RepoMetadata,
): Promise<void> {
	await mkdir(parentDir(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function writeRepoArtifactMetadata(
	atlasHome: string,
	repoId: string,
	artifact: Pick<
		RepoMetadata,
		| "artifactPath"
		| "artifactSource"
		| "artifactValidatedAt"
		| "indexedRevision"
		| "remoteHeadRevision"
		| "stale"
		| "importStatus"
		| "indexSource"
		| "checkoutPath"
		| "importedAt"
		| "globalCorpusPath"
		| "importCounts"
		| "documentationSignal"
	>,
): Promise<void> {
	const path = repoMetadataPath(atlasHome, repoId);
	const metadata = await readRepoMetadata(path);
	await writeRepoMetadata(path, {
		...metadata,
		...artifact,
		updatedAt: new Date().toISOString(),
	});
}

export async function listRepoMetadata(
	atlasHome: string,
): Promise<RepoMetadata[]> {
	const root = join(atlasHome, DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH);
	const { stdout: output } = await runProcess([
		"find",
		root,
		"-name",
		"repo.json",
		"-type",
		"f",
	]);
	const metadata: RepoMetadata[] = [];
	for (const path of output.split("\n").filter(Boolean)) {
		metadata.push(await readRepoMetadata(path));
	}
	return metadata.sort((left, right) =>
		left.repoId.localeCompare(right.repoId),
	);
}

export async function removeRepoFolder(
	atlasHome: string,
	repoId: string,
): Promise<boolean> {
	await rm(repoFolderPath(atlasHome, repoId), { recursive: true, force: true });
	return true;
}

/** Builds a human-readable store listing. */
export function renderRows(
	rows: Array<Record<string, string | number | boolean | undefined>>,
): string {
	return renderTable(rows);
}

/** Resolves cached doc/skill inspection data directly from the store. */
export function inspectArtifacts(db: AtlasCliDependencies["db"]) {
	return {
		repos: new RepoRepository(db),
		manifests: new ManifestRepository(db),
		packages: new PackageRepository(db),
		modules: new ModuleRepository(db),
		docs: new DocRepository(db),
		sections: new SectionRepository(db),
		skills: new SkillRepository(db),
		summaries: new SummaryRepository(db),
	};
}

/** Executes retrieval planning directly against the local store. */
export function inspectRetrievalPlan(
	deps: AtlasCliDependencies,
	query: string,
	repoId?: string,
	budgetTokens = 1200,
) {
	const startedAt = performance.now();
	const classification = deps.retrieval.classifyQuery(query);
	const scopes = deps.retrieval.inferScopes({
		query,
		classification,
		...(repoId === undefined ? {} : { repoId }),
	});
	const plan = deps.retrieval.planContext({
		query,
		...(repoId === undefined ? {} : { repoId }),
		budgetTokens,
	});
	return {
		classification,
		scopes,
		plan,
		timings: {
			retrievalLatencyMs: Math.round(performance.now() - startedAt),
		},
	};
}

interface LocalGitDefaults {
	rootPath: string;
	ref: string;
	remote: string;
}

async function detectLocalGitDefaults(
	cwd: string,
): Promise<LocalGitDefaults | undefined> {
	const rootPath = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
	if (rootPath === undefined) {
		return undefined;
	}
	const currentBranch = await gitOutput(rootPath, ["branch", "--show-current"]);
	const configuredRemote = await gitOutput(rootPath, [
		"config",
		"--get",
		"remote.origin.url",
	]);
	return {
		rootPath,
		ref: currentBranch ?? "HEAD",
		remote: configuredRemote ?? pathToFileURL(rootPath).href,
	};
}

async function gitOutput(
	cwd: string,
	args: readonly string[],
): Promise<string | undefined> {
	try {
		const { exitCode, stdout } = await runProcess(["git", ...args], { cwd });
		if (exitCode !== 0) {
			return undefined;
		}
		const output = stdout.trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}

/** Parses `--older-than` into milliseconds. */
export function parseDuration(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
	if (!match) {
		throw new CliError(
			`Invalid duration: ${value}. Expected formats like 30m, 12h, or 7d.`,
			{
				code: "CLI_INVALID_DURATION",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	const amount = Number.parseInt(match[1] ?? "0", 10);
	const unit = match[2];
	const multiplier =
		unit === "ms"
			? 1
			: unit === "s"
				? 1000
				: unit === "m"
					? 60_000
					: unit === "h"
						? 3_600_000
						: 86_400_000;
	return amount * multiplier;
}

/** Reads a string from the raw argv for bootstrap cases before parsed globals exist. */
export function readArgvString(
	argv: readonly string[],
	flag: string,
): string | undefined {
	const index = argv.findIndex((token) => token === flag);
	if (index === -1) {
		return undefined;
	}
	const next = argv[index + 1];
	return next?.startsWith("--") ? undefined : next;
}

/** Renders a sync/build report batch in human mode. */
export function reportLines(
	report: { reports?: Array<SyncLike | BuildLike> } | SyncLike | BuildLike,
): string[] {
	if ("reports" in report && report.reports) {
		return [
			summarizeReport(report as never),
			...report.reports.map((entry) => `- ${summarizeReport(entry as never)}`),
		];
	}
	return [summarizeReport(report as never)];
}

/** Computes the final command exit code for a report-bearing command. */
export function reportExitCode(
	report:
		| SyncLike
		| BuildLike
		| { reports: Array<SyncLike | BuildLike>; failureCount: number },
): number {
	return exitCodeForReport(report as never);
}

type SyncLike = SyncBatchEntry;
type BuildLike = BuildBatchEntry;

interface SyncBatchEntry {
	repoId: string;
	status: string;
	sourceChanged: boolean;
	corpusAffected: boolean;
	changedPathCount: number;
	relevantDocPathCount: number;
}

interface BuildBatchEntry {
	repoId: string;
	strategy: string;
	docsRebuilt: number;
	docsDeleted: number;
	diagnostics: Array<{
		severity: string;
		stage?: string | undefined;
		message?: string | undefined;
		code?: string | undefined;
		path?: string | undefined;
		details?: Record<string, unknown> | undefined;
		cause?: DiagnosticCause | undefined;
	}>;
}

interface DiagnosticCause {
	name: string;
	message: string;
	code?: string | undefined;
	stack?: string | undefined;
	context?: Record<string, unknown> | undefined;
	cause?: DiagnosticCause | undefined;
}

/** Renders build failures with nested diagnostic details when verbose is enabled. */
export function buildFailureLines(
	report: { reports?: BuildBatchEntry[] } | BuildBatchEntry,
	verbose: boolean,
): string[] {
	const reports: BuildBatchEntry[] = Array.isArray(
		(report as { reports?: BuildBatchEntry[] }).reports,
	)
		? (report as { reports: BuildBatchEntry[] }).reports
		: [report as BuildBatchEntry];
	const lines = reportLines(report as never);
	if (!verbose) {
		return [
			...lines,
			"Run again with --verbose --json to see nested cause details.",
		];
	}
	for (const entry of reports) {
		const errors = entry.diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		);
		for (const diagnostic of errors) {
			lines.push(`Diagnostic: ${entry.repoId}`);
			lines.push(`  stage: ${diagnostic.stage ?? "unknown"}`);
			lines.push(`  layer: ${diagnosticLayer(diagnostic.stage)}`);
			if (diagnostic.path !== undefined)
				lines.push(`  path: ${diagnostic.path}`);
			if (diagnostic.code !== undefined)
				lines.push(`  code: ${diagnostic.code}`);
			if (diagnostic.message !== undefined) {
				lines.push(`  message: ${diagnostic.message}`);
			}
			if (diagnostic.cause !== undefined) {
				lines.push("  cause:");
				lines.push(...formatCauseChain(diagnostic.cause, 2));
			}
		}
	}
	return lines;
}

function diagnosticLayer(stage: string | undefined): string {
	switch (stage) {
		case "source":
			return "source/cache";
		case "planning":
			return "topology";
		case "compile":
		case "chunk":
			return "compile";
		case "persistence":
			return "persistence";
		case "build":
			return "build";
		default:
			return "unknown";
	}
}

function formatCauseChain(cause: DiagnosticCause, depth: number): string[] {
	const indent = "  ".repeat(depth);
	const lines = [`${indent}- ${cause.name}: ${cause.message}`];
	if (cause.code !== undefined) lines.push(`${indent}  code: ${cause.code}`);
	const context = cause.context ?? {};
	for (const key of ["operation", "stage", "repoId", "entity"] as const) {
		const value = context[key];
		if (typeof value === "string" || typeof value === "number") {
			lines.push(`${indent}  ${key}: ${value}`);
		}
	}
	if (cause.stack !== undefined) lines.push(`${indent}  stack: ${cause.stack}`);
	if (cause.cause !== undefined) {
		lines.push(...formatCauseChain(cause.cause, depth + 1));
	}
	return lines;
}
