import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AtlasConfig, defaultGithubHostConfig } from "@atlas/config";
import {
	buildDocsIndex,
	createIndexerServices,
	exportCorpusDbSnapshot,
	MOXEL_ATLAS_ARTIFACT_FILES,
	manifestFromStore,
	scanArtifactSafety,
	validateArtifactChecksums,
	writeArtifactChecksums,
	writePrettyJson,
} from "@atlas/indexer";
import { openStore, type StoreDatabase } from "@atlas/store";

import {
	readBooleanOption,
	readStringListOption,
	readStringOption,
} from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { fileExists, runProcess } from "../utils/node-runtime";
import { resolveRepoTarget } from "./repo-target";
import {
	buildFailureLines,
	loadDependenciesFromGlobal,
	maybeRenderArtifactRootMigrationHint,
	renderSuccess,
	reportExitCode,
	reportLines,
	resolveCliArtifactRoot,
} from "./shared";

const REPO_METADATA_FILE = "atlas.repo.json";
const COMMIT_HINT =
	"Review and commit artifact root when ready; Atlas does not stage, commit, branch, or push.";

function filterPublicArtifactCorpus(db: StoreDatabase): void {
	db.run(
		`UPDATE documents
		 SET audience_json = '["consumer"]',
		     purpose_json = '["guide","reference"]',
		     profile = 'public'
		 WHERE visibility = 'public'
		   AND (
		     path LIKE 'apps/%/docs/%'
		     OR path LIKE 'packages/%/docs/%'
		   )`,
	);
	db.run(
		`DELETE FROM fts_entries
		 WHERE doc_id IN (
			 SELECT doc_id FROM documents
			 WHERE visibility <> 'public'
		 )`,
	);
	db.run(
		`DELETE FROM documents
		 WHERE visibility <> 'public'`,
	);
}

interface BuildCommandInput {
	repoId?: string | undefined;
	force: boolean;
	mode?: string | undefined;
	docIds: string[];
	packageId?: string | undefined;
	moduleId?: string | undefined;
	config?: string | undefined;
	profile: string;
	selection?:
		| { docIds?: string[]; packageId?: string; moduleId?: string }
		| undefined;
	selectorCount: number;
}

type BuildDependencies = Awaited<ReturnType<typeof loadDependenciesFromGlobal>>;
type BuildTargetResolution = Awaited<ReturnType<typeof resolveRepoTarget>>;

/** Delegates build orchestration to shared indexer service or repo-local artifact mode. */
export async function runBuildCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const parsed = parseBuildCommandInput(context.argv);
	const repoLocal = await resolveRepoLocalBuildMetadata(context, parsed);
	const deps =
		repoLocal === undefined
			? await loadDependenciesFromGlobal(context, parsed.config)
			: undefined;
	const targetResolution = await resolveBuildTarget(
		context,
		parsed,
		deps,
		repoLocal,
	);
	const effectiveRepoId =
		parsed.repoId ?? repoLocal?.metadata.repoId ?? targetResolution?.repoId;
	assertBuildTarget(parsed, effectiveRepoId);

	if (repoLocal !== undefined && effectiveRepoId !== undefined) {
		return runRepoLocalBuild(context, repoLocal, {
			repoId: effectiveRepoId,
			force: shouldForceBuild(parsed),
			profile: parsed.profile,
			...(parsed.selection === undefined
				? {}
				: { selection: parsed.selection }),
		});
	}
	return runGlobalBuild(
		context,
		requireBuildDependencies(deps),
		parsed,
		effectiveRepoId,
		targetResolution,
	);
}

function parseBuildCommandInput(argv: readonly string[]): BuildCommandInput {
	const options = parseOptions(argv);
	const docIds = readStringListOption(options, "doc-id");
	const parsed = {
		repoId: readStringOption(options, "repo"),
		force: readBooleanOption(options, "force"),
		mode: readStringOption(options, "mode"),
		docIds,
		packageId: readStringOption(options, "package-id"),
		moduleId: readStringOption(options, "module-id"),
		config: readStringOption(options, "config"),
		profile: readStringOption(options, "profile") ?? "public",
	};
	const selectorCount = [
		docIds.length > 0,
		parsed.packageId !== undefined,
		parsed.moduleId !== undefined,
	].filter(Boolean).length;
	if (selectorCount > 1) {
		throw new CliError(
			"Build command accepts only one of --doc-id, --package-id, or --module-id.",
			{ code: "CLI_INVALID_BUILD_SELECTOR", exitCode: EXIT_INPUT_ERROR },
		);
	}
	return { ...parsed, selectorCount, selection: buildSelection(parsed) };
}

function buildSelection(
	input: Pick<BuildCommandInput, "docIds" | "packageId" | "moduleId">,
): BuildCommandInput["selection"] {
	if (
		input.docIds.length === 0 &&
		input.packageId === undefined &&
		input.moduleId === undefined
	) {
		return undefined;
	}
	return {
		...(input.docIds.length === 0 ? {} : { docIds: input.docIds }),
		...(input.packageId === undefined ? {} : { packageId: input.packageId }),
		...(input.moduleId === undefined ? {} : { moduleId: input.moduleId }),
	};
}

function resolveRepoLocalBuildMetadata(
	context: CliCommandContext,
	input: BuildCommandInput,
): Promise<RepoLocalMetadata | undefined> {
	return input.config === undefined && input.repoId === undefined
		? findRepoArtifactMetadata(context)
		: Promise.resolve(undefined);
}

async function resolveBuildTarget(
	context: CliCommandContext,
	input: BuildCommandInput,
	deps: BuildDependencies | undefined,
	repoLocal: RepoLocalMetadata | undefined,
): Promise<BuildTargetResolution | undefined> {
	if (repoLocal !== undefined || deps === undefined) return undefined;
	try {
		return await resolveRepoTarget(context, {
			config: deps.config.config,
			...(input.repoId === undefined ? {} : { explicit: input.repoId }),
			command: "build",
			nonInteractive: context.argv.includes("--non-interactive"),
			allowSingleConfigured: input.selectorCount > 0,
		});
	} catch (error) {
		if (input.selectorCount > 0 || input.repoId !== undefined) throw error;
		if (
			!(error instanceof CliError) ||
			error.code !== "CLI_REPO_TARGET_REQUIRED"
		)
			throw error;
		return undefined;
	}
}

function assertBuildTarget(
	input: BuildCommandInput,
	effectiveRepoId: string | undefined,
): void {
	if (input.selectorCount > 0 && effectiveRepoId === undefined) {
		throw new CliError(
			"Targeted build selectors require a repo target. Use --repo, run from a configured checkout, or pass a unique bare repo name.",
			{ code: "CLI_REPO_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
}

function shouldForceBuild(input: BuildCommandInput): boolean {
	return input.force || input.mode === "full";
}

function requireBuildDependencies(
	deps: BuildDependencies | undefined,
): BuildDependencies {
	if (deps === undefined) {
		throw new CliError("Build dependencies unavailable.", {
			code: "CLI_BUILD_DEPENDENCIES_UNAVAILABLE",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return deps;
}

async function runGlobalBuild(
	context: CliCommandContext,
	deps: BuildDependencies,
	input: BuildCommandInput,
	effectiveRepoId: string | undefined,
	targetResolution: BuildTargetResolution | undefined,
): Promise<CliCommandResult> {
	try {
		const report = effectiveRepoId
			? await deps.indexer.buildRepo(effectiveRepoId, {
					force: shouldForceBuild(input),
					...(input.selection === undefined
						? {}
						: { selection: input.selection }),
				})
			: await deps.indexer.buildAll({
					all: true,
					force: shouldForceBuild(input),
				});
		throwIfBuildFailed(report, context.output.verbose);
		const data =
			targetResolution === undefined ? report : { ...report, targetResolution };
		return await renderSuccess(context, "build", data, [
			...(targetResolution === undefined
				? []
				: [
						`Repo target: ${targetResolution.repoId} (${targetResolution.source})`,
					]),
			...reportLines(report),
		]);
	} finally {
		deps.close();
	}
}

function throwIfBuildFailed(
	report: Parameters<typeof reportExitCode>[0],
	verbose: boolean,
): void {
	const exitCode = reportExitCode(report);
	if (exitCode !== 0) {
		throw new CliError(
			buildFailureLines(
				report as Parameters<typeof buildFailureLines>[0],
				verbose,
			).join("\n"),
			{
				code: "CLI_BUILD_FAILED",
				exitCode,
				details: report,
			},
		);
	}
}

async function runRepoLocalBuild(
	context: CliCommandContext,
	repoLocal: RepoLocalMetadata,
	options: {
		repoId: string;
		force: boolean;
		profile: string;
		selection?:
			| { docIds?: string[]; packageId?: string; moduleId?: string }
			| undefined;
	},
): Promise<CliCommandResult> {
	if (options.profile !== "public") {
		throw new CliError(
			`Profile ${options.profile} not available for repo; imported artifact contains public docs only.`,
			{ code: "CLI_ARTIFACT_PROFILE_UNAVAILABLE", exitCode: EXIT_INPUT_ERROR },
		);
	}
	const tempDir = await mkdtemp(join(tmpdir(), "atlas-artifact-build-"));
	const dbPath = join(tempDir, "corpus.db");
	const db = openStore({ path: dbPath, migrate: true });
	try {
		const buildRef =
			(await gitOutput(repoLocal.root, ["rev-parse", "HEAD"])) ??
			repoLocal.metadata.ref;
		const refMode = repoLocal.metadata.refMode ?? "current-checkout";
		const config: AtlasConfig = {
			version: 1,
			cacheDir: tempDir,
			corpusDbPath: dbPath,
			logLevel: "warn",
			server: { transport: "stdio" },
			hosts: [defaultGithubHostConfig()],
			docs: {
				metadata: {
					rules: [
						{
							id: "repo-local-app-package-docs-public",
							match: {
								include: [
									"apps/*/docs/**/*.md",
									"apps/*/docs/**/*.mdx",
									"packages/*/docs/**/*.md",
									"packages/*/docs/**/*.mdx",
								],
							},
							metadata: {
								visibility: "public",
								audience: ["consumer"],
								purpose: ["guide", "reference"],
							},
							priority: 20,
						},
					],
					profiles: {},
				},
			},
			repos: [
				{
					repoId: options.repoId,
					mode: "local-git",
					git: {
						remote: repoLocal.remote,
						localPath:
							refMode === "current-checkout"
								? repoLocal.root
								: join(tempDir, "checkout"),
						ref: buildRef,
						refMode,
					},
					workspace: {
						packageGlobs: ["apps/*", "packages/*"],
						packageManifestFiles: ["package.json"],
					},
					topology: [
						{
							id: "skills",
							kind: "skill-doc",
							match: { include: ["**/{skill,SKILL}.md"] },
							ownership: {
								attachTo: "skill",
								skillPattern: "**/{skill,SKILL}.md",
							},
							authority: "canonical",
							priority: 120,
						},
						{
							id: "package-docs",
							kind: "package-doc",
							match: {
								include: [
									"apps/*/docs/**/*.md",
									"apps/*/docs/**/*.mdx",
									"packages/*/docs/**/*.md",
									"packages/*/docs/**/*.mdx",
								],
								exclude: ["**/{skill,SKILL}.md"],
							},
							ownership: { attachTo: "package" },
							authority: "preferred",
							priority: 110,
						},
						{
							id: "docs",
							kind: "repo-doc",
							match: {
								include: [
									"README.md",
									"*.md",
									"*.mdx",
									"docs/**/*.md",
									"docs/**/*.mdx",
								],
								exclude: ["**/{skill,SKILL}.md"],
							},
							ownership: { attachTo: "repo" },
							authority: "canonical",
							priority: 100,
						},
					],
				},
			],
		};
		const { service } = createIndexerServices({
			config: {
				config,
				source: {
					configPath: join(
						repoLocal.root,
						repoLocal.artifactRoot,
						REPO_METADATA_FILE,
					),
					loadedFrom: "explicit",
				},
				env: {},
			},
			db,
		});
		const report = await service.buildRepo(options.repoId, {
			force: options.force,
			...(options.selection === undefined
				? {}
				: { selection: options.selection }),
		});
		const exitCode = reportExitCode(report);
		if (exitCode !== 0) {
			throw new CliError(
				buildFailureLines(report, context.output.verbose).join("\n"),
				{
					code: "CLI_BUILD_FAILED",
					exitCode,
					details: report,
				},
			);
		}
		filterPublicArtifactCorpus(db);
		await writePrettyJson(
			join(repoLocal.artifactDir, "manifest.json"),
			manifestFromStore(db, options.repoId, buildRef, "public"),
		);
		db.run("PRAGMA wal_checkpoint(TRUNCATE)");
		await exportCorpusDbSnapshot(
			dbPath,
			join(repoLocal.artifactDir, "corpus.db"),
		);
		await writePrettyJson(
			join(repoLocal.artifactDir, "docs.index.json"),
			buildDocsIndex(db, options.repoId),
		);
		await writeArtifactChecksums(repoLocal.artifactDir);
		const checksum = await validateArtifactChecksums(repoLocal.artifactDir);
		const safety = await scanArtifactSafety(repoLocal.artifactDir);
		if (!checksum.valid || !safety.valid) {
			throw new CliError("Artifact export failed validation.", {
				code: "CLI_ARTIFACT_EXPORT_INVALID",
				exitCode: EXIT_INPUT_ERROR,
				details: {
					checksums: checksum.diagnostics,
					safety: safety.diagnostics,
				},
			});
		}
		const lines = [
			...(repoLocal.migrationHint === undefined
				? []
				: [repoLocal.migrationHint]),
			...reportLines(report),
			`Knowledge bundle: ${repoLocal.artifactRoot}`,
			COMMIT_HINT,
		];
		const data = {
			report,
			repoId: options.repoId,
			artifactPath: repoLocal.artifactRoot,
			artifactRoot: repoLocal.artifactRoot,
			files: MOXEL_ATLAS_ARTIFACT_FILES,
			commitHint: COMMIT_HINT,
		};
		return await renderSuccess(context, "build", data, lines);
	} finally {
		db.close();
		await rm(tempDir, { recursive: true, force: true });
	}
}

interface RepoLocalMetadata {
	root: string;
	artifactDir: string;
	artifactRoot: string;
	migrationHint?: string | undefined;
	remote: string;
	metadata: {
		schema: "moxel-atlas-repo/v1";
		repoId: string;
		host: string;
		owner: string;
		name: string;
		ref: string;
		refMode?: "remote" | "current-checkout" | undefined;
		artifactPath: string;
	};
}

async function findRepoArtifactMetadata(
	context: CliCommandContext,
): Promise<RepoLocalMetadata | undefined> {
	const root =
		(await gitOutput(context.cwd, ["rev-parse", "--show-toplevel"])) ??
		context.cwd;
	const artifactRoot = await resolveCliArtifactRoot(context, root);
	const migrationHint = await maybeRenderArtifactRootMigrationHint({
		root,
		artifactRoot: artifactRoot.artifactRoot,
		customRootUsed: artifactRoot.customRootUsed,
	});
	const artifactDir = artifactRoot.artifactDir;
	const path = join(artifactDir, REPO_METADATA_FILE);
	if (!(await fileExists(path))) {
		if (migrationHint !== undefined) {
			throw new CliError(migrationHint, {
				code: "CLI_ARTIFACT_METADATA_NOT_FOUND",
				exitCode: EXIT_INPUT_ERROR,
			});
		}
		return undefined;
	}
	const metadata = JSON.parse(
		await readFile(path, "utf8"),
	) as RepoLocalMetadata["metadata"];
	const remote = `file://${root}`;
	return {
		root,
		artifactDir,
		artifactRoot: artifactRoot.artifactRoot,
		migrationHint,
		remote,
		metadata,
	};
}

async function gitOutput(
	cwd: string,
	args: readonly string[],
): Promise<string | undefined> {
	try {
		const { exitCode, stdout } = await runProcess(["git", ...args], { cwd });
		if (exitCode !== 0) return undefined;
		const output = stdout.trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}

function parseOptions(
	argv: readonly string[],
): Record<string, string | boolean | string[]> {
	const options: Record<string, string | boolean | string[]> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token?.startsWith("--")) continue;
		const key = token.slice(2);
		const value = argv[index + 1];
		if (["force", "json", "verbose", "quiet", "all"].includes(key)) {
			options[key] = true;
			continue;
		}
		if (key === "doc-id") {
			options[key] = Array.isArray(options[key])
				? [...(options[key] as string[]), value ?? ""]
				: [value ?? ""];
			index += 1;
			continue;
		}
		options[key] = value ?? "";
		index += 1;
	}
	return options;
}
