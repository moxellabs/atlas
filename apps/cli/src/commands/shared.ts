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

/** Creates a local-git repo entry from parsed flags or interactive defaults. */
export async function resolveRepoConfigInput(
	context: CliCommandContext,
	input: {
		repoId?: string | undefined;
		mode?: "local-git" | "ghes-api" | undefined;
		remote?: string | undefined;
		localPath?: string | undefined;
		ref?: string | undefined;
		baseUrl?: string | undefined;
		owner?: string | undefined;
		name?: string | undefined;
		tokenEnvVar?: string | undefined;
		packageGlobs: string[];
		packageManifestFiles: string[];
		template?: TopologyTemplate | undefined;
		cacheDir: string;
		nonInteractive: boolean;
	},
): Promise<AtlasRepoConfig> {
	const interactive = canPrompt() && !input.nonInteractive;
	const prompts = interactive ? createPrompts() : undefined;
	const mode = (input.mode ??
		(interactive
			? ((await prompts?.select("Choose repository mode", [
					{ label: "Local Git", value: "local-git" },
					{ label: "GitHub Enterprise API", value: "ghes-api" },
				])) as "local-git" | "ghes-api")
			: "local-git")) as "local-git" | "ghes-api";
	const repoId =
		input.repoId ??
		(interactive ? await prompts?.input("Repository ID") : undefined);
	if (!repoId) {
		throw new CliError("Missing repository ID.", {
			code: "CLI_REPO_ID_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const template = input.template ?? "mixed-monorepo";

	const packageGlobs =
		input.packageGlobs.length > 0 ? input.packageGlobs : ["packages/*"];
	const packageManifestFiles =
		input.packageManifestFiles.length > 0
			? input.packageManifestFiles
			: ["package.json"];
	if (mode === "local-git") {
		const gitDefaults = await detectLocalGitDefaults(context.cwd);
		const defaultRef = gitDefaults?.ref ?? "main";
		const defaultRemote = gitDefaults?.remote;
		const ref =
			input.ref ??
			(interactive ? await prompts?.input("Git ref", defaultRef) : defaultRef);
		const defaultLocalPath = resolveCliPath(
			repoCheckoutDir(input.cacheDir, repoId),
			context.cwd,
		);
		const localPath =
			input.localPath ??
			(interactive
				? await prompts?.input("Local checkout path", defaultLocalPath)
				: defaultLocalPath);
		const remote =
			input.remote ??
			(interactive
				? await prompts?.input("Git remote URL", defaultRemote)
				: defaultRemote);
		if (!remote || !localPath || !ref) {
			throw new CliError(
				"Missing local-git remote. Use --remote, or run add-repo from inside a Git checkout so Atlas can infer one.",
				{
					code: "CLI_REMOTE_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				},
			);
		}
		return {
			repoId,
			mode,
			git: {
				remote,
				localPath,
				ref,
			},
			workspace: {
				packageGlobs,
				packageManifestFiles,
			},
			topology: topologyTemplate(template),
		};
	}

	const ref =
		input.ref ??
		(interactive ? await prompts?.input("GitHub ref", "main") : "main");
	const baseUrl =
		input.baseUrl ??
		(interactive ? await prompts?.input("GHES API base URL") : undefined);
	const owner =
		input.owner ??
		(interactive ? await prompts?.input("GHES owner") : undefined);
	const name =
		input.name ??
		(interactive ? await prompts?.input("GHES repository name") : undefined);
	if (!baseUrl || !owner || !name) {
		throw new CliError(
			"Missing GHES repository fields. Use --base-url, --owner, and --name in non-interactive mode.",
			{
				code: "CLI_GHES_FIELDS_REQUIRED",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	const ghesRef = ref ?? "main";
	const ghesBaseUrl = baseUrl;
	const ghesOwner = owner;
	const ghesName = name;
	return {
		repoId,
		mode,
		github: {
			baseUrl: ghesBaseUrl,
			owner: ghesOwner,
			name: ghesName,
			ref: ghesRef,
			...(input.tokenEnvVar === undefined
				? {}
				: { tokenEnvVar: input.tokenEnvVar }),
		},
		workspace: {
			packageGlobs,
			packageManifestFiles,
		},
		topology: topologyTemplate(template),
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
		| { mode: "local-git"; remote: string; localPath: string; ref: string }
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

/** Builds human-readable repo list rows. */
export function repoRows(db: AtlasCliDependencies["db"]) {
	const repos = new RepoRepository(db).list();
	const manifests = new ManifestRepository(db);
	return repos.map((repo) => {
		const manifest = manifests.get(repo.repoId);
		return {
			repoId: repo.repoId,
			mode: repo.mode,
			revision: repo.revision,
			indexedRevision: manifest?.indexedRevision ?? "",
			fresh: manifest?.indexedRevision === repo.revision,
		};
	});
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
	const classification = deps.retrieval.classifyQuery(query);
	return {
		classification,
		scopes: deps.retrieval.inferScopes({
			query,
			classification,
			...(repoId === undefined ? {} : { repoId }),
		}),
		plan: deps.retrieval.planContext({
			query,
			...(repoId === undefined ? {} : { repoId }),
			budgetTokens,
		}),
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
	diagnostics: Array<{ severity: string }>;
}
