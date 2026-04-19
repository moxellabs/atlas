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
import {
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
		 SET visibility = 'public',
		     audience_json = '["consumer"]',
		     purpose_json = '["guide","reference"]',
		     profile = 'public'
		 WHERE path LIKE 'apps/%/docs/%'
		    OR path LIKE 'packages/%/docs/%'`,
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

/** Delegates build orchestration to shared indexer service or repo-local artifact mode. */
export async function runBuildCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const options = parseOptions(context.argv);
	const parsed = {
		repoId: readStringOption(options, "repo"),
		force: readBooleanOption(options, "force"),
		mode: readStringOption(options, "mode"),
		docIds: readStringListOption(options, "doc-id"),
		packageId: readStringOption(options, "package-id"),
		moduleId: readStringOption(options, "module-id"),
		config: readStringOption(options, "config"),
		profile: readStringOption(options, "profile") ?? "public",
	};
	const selectorCount = [
		parsed.docIds.length > 0,
		parsed.packageId !== undefined,
		parsed.moduleId !== undefined,
	].filter(Boolean).length;
	if (selectorCount > 1) {
		throw new CliError(
			"Build command accepts only one of --doc-id, --package-id, or --module-id.",
			{ code: "CLI_INVALID_BUILD_SELECTOR", exitCode: EXIT_INPUT_ERROR },
		);
	}
	const repoLocal =
		parsed.config === undefined && parsed.repoId === undefined
			? await findRepoArtifactMetadata(context)
			: undefined;
	const effectiveRepoId = parsed.repoId ?? repoLocal?.metadata.repoId;
	if (selectorCount > 0 && effectiveRepoId === undefined) {
		throw new CliError("Targeted build selectors require --repo.", {
			code: "CLI_REPO_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	if (repoLocal !== undefined && effectiveRepoId !== undefined) {
		return runRepoLocalBuild(context, repoLocal, {
			repoId: effectiveRepoId,
			force: parsed.force || parsed.mode === "full",
			profile: parsed.profile,
			selection:
				selectorCount === 0
					? undefined
					: {
							...(parsed.docIds.length === 0 ? {} : { docIds: parsed.docIds }),
							...(parsed.packageId === undefined
								? {}
								: { packageId: parsed.packageId }),
							...(parsed.moduleId === undefined
								? {}
								: { moduleId: parsed.moduleId }),
						},
		});
	}

	const deps = await loadDependenciesFromGlobal(context, parsed.config);
	try {
		const report = effectiveRepoId
			? await deps.indexer.buildRepo(effectiveRepoId, {
					force: parsed.force || parsed.mode === "full",
					...(selectorCount === 0
						? {}
						: {
								selection: {
									...(parsed.docIds.length === 0
										? {}
										: { docIds: parsed.docIds }),
									...(parsed.packageId === undefined
										? {}
										: { packageId: parsed.packageId }),
									...(parsed.moduleId === undefined
										? {}
										: { moduleId: parsed.moduleId }),
								},
							}),
				})
			: await deps.indexer.buildAll({
					all: true,
					force: parsed.force || parsed.mode === "full",
				});
		const exitCode = reportExitCode(report);
		if (exitCode !== 0) {
			throw new CliError(reportLines(report).join("\n"), {
				code: "CLI_BUILD_FAILED",
				exitCode,
				details: report,
			});
		}
		return await renderSuccess(context, "build", report, reportLines(report));
	} finally {
		deps.close();
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
						localPath: join(tempDir, "checkout"),
						ref: buildRef,
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
			throw new CliError(reportLines(report).join("\n"), {
				code: "CLI_BUILD_FAILED",
				exitCode,
				details: report,
			});
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
