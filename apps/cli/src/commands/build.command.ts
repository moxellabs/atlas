import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AtlasConfig,
  DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
  defaultGithubHostConfig,
  resolveRuntimeRepoConfigs,
} from "@atlas/config";
import {
	type AtlasDocAudience,
	type AtlasDocPurpose,
	BUILT_IN_DOC_METADATA_PROFILES,
	type DocumentMetadata,
	documentMatchesMetadataFilters,
} from "@atlas/core";
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
import { fileExists } from "../utils/node-runtime";
import {
	maybeRenderArtifactRootMigrationHint,
	resolveCliArtifactRoot,
} from "./artifact-root";
import { loadDependenciesFromGlobal } from "./dependencies";
import { gitOutput, readGitRoot } from "./git";
import { resolveRepoIdentity } from "./repo-identity";
import { buildFailureLines, reportExitCode, reportLines } from "./reports";
import { renderSuccess } from "./render";

const REPO_METADATA_FILE = "atlas.repo.json";
const COMMIT_HINT =
	"Review and commit artifact root when ready; Atlas does not stage, commit, branch, or push.";

function filterArtifactCorpusByProfile(
  db: StoreDatabase,
  profile: string,
): void {
	type Candidate = {
		doc_id: string;
		path: string;
		audience_json: string;
		purpose_json: string;
		visibility: string;
	};
	const documents = db.all<Candidate>(
		"SELECT doc_id, path, audience_json, purpose_json, visibility FROM documents",
	);
	const removeDocIds: string[] = [];
	for (const document of documents) {
    if (
      !documentMatchesMetadataFilters(documentMetadata(document), { profile })
    ) {
			removeDocIds.push(document.doc_id);
		}
	}
	for (const docId of removeDocIds) {
		db.run("DELETE FROM fts_entries WHERE doc_id = $docId", { $docId: docId });
		db.run("DELETE FROM documents WHERE doc_id = $docId", { $docId: docId });
	}
}

function documentMetadata(document: {
	path: string;
	audience_json: string;
	purpose_json: string;
	visibility: string;
}): DocumentMetadata {
	return {
		audience: parseStringArray(document.audience_json) as AtlasDocAudience[],
		purpose: parseStringArray(document.purpose_json) as AtlasDocPurpose[],
		visibility:
			document.visibility === "public" || document.visibility === "internal"
				? document.visibility
				: undefined,
		tags: [],
	};
}

function parseStringArray(json: string): string[] {
	try {
		const parsed = JSON.parse(json) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((value): value is string => typeof value === "string")
			: [];
	} catch {
		return [];
	}
}

const AVAILABLE_ARTIFACT_PROFILES = Object.keys(BUILT_IN_DOC_METADATA_PROFILES);

function availableArtifactProfilesFor(profile: string): string[] {
	const index = AVAILABLE_ARTIFACT_PROFILES.indexOf(profile);
  return index === -1 ? [] : AVAILABLE_ARTIFACT_PROFILES.slice(0, index + 1);
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
type BuildTargetResolution = Awaited<ReturnType<typeof resolveRepoIdentity>>;

/** Delegates build orchestration to shared indexer service or repo-local artifact mode. */
export async function runBuildCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const parsed = parseBuildCommandInput(context);
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

function parseBuildCommandInput(context: CliCommandContext): BuildCommandInput {
	const docIds = readStringListOption(context, "docId");
	const parsed = {
		repoId: readStringOption(context, "repo"),
		force: readBooleanOption(context, "force"),
		mode: readStringOption(context, "mode"),
		docIds,
		packageId: readStringOption(context, "packageId"),
		moduleId: readStringOption(context, "moduleId"),
		config: readStringOption(context, "config"),
		profile: readStringOption(context, "profile") ?? "public",
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
    return await resolveRepoIdentity(context, {
      intent: "target",
      config: deps.config.config,
			...(input.repoId === undefined ? {} : { explicit: input.repoId }),
			command: "build",
			nonInteractive: readBooleanOption(context, "nonInteractive"),
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
	if (!AVAILABLE_ARTIFACT_PROFILES.includes(options.profile)) {
		throw new CliError(
			`Profile ${options.profile} not available for repo-local artifact export. Available profiles: ${AVAILABLE_ARTIFACT_PROFILES.join(", ")}.`,
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
      lifecycle: {
        repositoryRefresh: {
          enabled: false,
          intervalMs: DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
        },
      },
			hosts: [defaultGithubHostConfig()],
			docs: { metadata: { rules: [], profiles: {} } },
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
        runtimeRepos: resolveRuntimeRepoConfigs(
          config,
          join(repoLocal.root, repoLocal.artifactRoot, REPO_METADATA_FILE),
        ),
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
		filterArtifactCorpusByProfile(db, options.profile);
		await writePrettyJson(
			join(repoLocal.artifactDir, "manifest.json"),
			manifestFromStore(
				db,
				options.repoId,
				buildRef,
				options.profile,
				availableArtifactProfilesFor(options.profile),
			),
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
	const root = (await readGitRoot(context.cwd)) ?? context.cwd;
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
