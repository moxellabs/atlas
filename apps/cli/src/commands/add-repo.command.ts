import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AtlasConfigNotFoundError,
	buildDefaultConfig,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	loadConfig,
	resolveGhesToken,
	resolveIdentityProfile,
} from "@atlas/config";
import {
	artifactStorageDir,
	fetchRemoteArtifact,
	fetchRemoteHeadRevision,
	importArtifactCorpus,
	MOXEL_ATLAS_REMOTE_ARTIFACT_FILES,
	type MoxelAtlasArtifactManifest,
	validateFetchedArtifact,
} from "@atlas/indexer";
import { RepoCacheService } from "@atlas/source-git";
import { STORE_SCHEMA_VERSION } from "@atlas/store";
import { canUseInteractiveUi, createPrompts } from "../io/prompts";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	buildIndexCommand,
	buildMissingArtifactAdoptionTemplates,
	type MissingArtifactAction,
	missingArtifactNextActions,
	renderIssuePrInstructions,
	renderMaintainerInstructions,
	renderMissingArtifactHumanLines,
} from "./missing-artifact";
import { type ResolvedRepoInput, resolveRepoInput } from "./repo-resolver";
import {
	appendRepoConfig,
	readArgvString,
	renderSuccess,
	resolveCliArtifactRoot,
	resolveRepoConfigInput,
	writeRepoArtifactMetadata,
} from "./shared";

function firstRepoInput(argv: readonly string[]): string | undefined {
	return argv[0]?.startsWith("--") ? undefined : argv[0];
}

async function fileExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function completeArtifactDir(path: string): Promise<boolean> {
	for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES) {
		if (!(await fileExists(join(path, file)))) return false;
	}
	return true;
}

async function selectedMissingArtifactAction(
	context: CliCommandContext,
): Promise<MissingArtifactAction | undefined> {
	if (context.argv.includes("--local-only"))
		return "clone-and-index-local-only";
	if (context.argv.includes("--skip-missing-artifact")) return "skip";
	if (context.argv.includes("--maintainer-instructions"))
		return "show-maintainer-instructions";
	if (context.argv.includes("--issue-pr-instructions"))
		return "generate-issue-pr-instructions";
	const explicit = readArgvString(context.argv, "--missing-artifact-action");
	if (explicit) {
		if (missingArtifactNextActions.includes(explicit as MissingArtifactAction))
			return explicit as MissingArtifactAction;
		throw new CliError(`Invalid missing artifact action: ${explicit}.`, {
			code: "CLI_INVALID_CHOICE",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	if (!context.argv.includes("--interactive") && !context.argv.includes("-i"))
		return "skip";
	if (
		!canUseInteractiveUi(context, {
			interactive: true,
			nonInteractive: context.argv.includes("--non-interactive"),
		})
	) {
		throw new CliError(
			"Missing artifact requires an explicit action in non-interactive mode. Re-run with --missing-artifact-action skip, --local-only, --maintainer-instructions, or --issue-pr-instructions.",
			{
				code: "CLI_INTERACTIVE_REQUIRED",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	return (await createPrompts().select(
		"This repo doesn't publish an Atlas knowledge bundle yet. What should Atlas do?",
		[
			{ label: "Build a local index", value: "clone-and-index-local-only" },
			{ label: "Don't add this repo", value: "skip" },
			{
				label: "Show maintainer instructions",
				value: "show-maintainer-instructions",
			},
			{
				label: "Draft issue/PR text",
				value: "generate-issue-pr-instructions",
			},
		],
	)) as MissingArtifactAction;
}

async function renderMissingArtifactResult(
	context: CliCommandContext,
	input: Parameters<typeof renderMissingArtifactHumanLines>[0],
): Promise<CliCommandResult> {
	const selectedAction = input.selectedAction ?? "skip";
	const selectedInput = { ...input, selectedAction };
	const adoptionTemplates =
		buildMissingArtifactAdoptionTemplates(selectedInput);
	const data = {
		artifactFound: false,
		missingArtifact: true,
		repoId: input.repoId,
		selectedAction,
		nextActions: missingArtifactNextActions,
		...(selectedAction === "clone-and-index-local-only"
			? { indexCommand: buildIndexCommand(input) }
			: {}),
		...(selectedAction === "show-maintainer-instructions" ||
		selectedAction === "generate-issue-pr-instructions"
			? { adoptionTemplates }
			: {}),
	};
	const lines =
		selectedAction === "show-maintainer-instructions"
			? [
					"This repo doesn't publish an Atlas knowledge bundle yet.",
					...renderMaintainerInstructions(selectedInput),
				]
			: selectedAction === "generate-issue-pr-instructions"
				? [
						"This repo doesn't publish an Atlas knowledge bundle yet.",
						...renderIssuePrInstructions(selectedInput),
					]
				: renderMissingArtifactHumanLines(selectedInput);
	return renderSuccess(context, "add-repo", data, lines, 0);
}

export async function findLocalCheckoutArtifact(
	_context: CliCommandContext,
	resolved: ResolvedRepoInput | undefined,
	artifactRoot: string,
): Promise<string | undefined> {
	if (!resolved?.localPath) return undefined;
	return findCompleteArtifactDir(resolved.localPath, artifactRoot);
}

async function findCompleteArtifactDir(
	localPath: string,
	artifactRoot: string,
): Promise<string | undefined> {
	const artifactDir = join(localPath, artifactRoot);
	return (await completeArtifactDir(artifactDir)) ? artifactDir : undefined;
}

async function findGitFetchedArtifact(
	repo: Parameters<typeof resolveGhesToken>[0],
	artifactRoot: string,
): Promise<string | undefined> {
	if (repo.mode !== "local-git" || !repo.git) return undefined;
	await new RepoCacheService().updateCache(repo as never);
	return findCompleteArtifactDir(repo.git.localPath, artifactRoot);
}

export async function copyLocalArtifactToRepoStorage(
	sourceArtifactDir: string,
	targetArtifactDir: string,
): Promise<void> {
	if (!(await completeArtifactDir(sourceArtifactDir))) {
		throw new CliError("Local identity artifact is incomplete.", {
			code: "CLI_ARTIFACT_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	await mkdir(targetArtifactDir, { recursive: true });
	for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES)
		await rm(join(targetArtifactDir, file), { force: true });
	for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES)
		await writeFile(
			join(targetArtifactDir, file),
			await readFile(join(sourceArtifactDir, file)),
		);
}

function artifactValidationError(
	diagnostics: Array<{ code: string; message: string }>,
): CliError {
	const code = diagnostics[0]?.code ?? "CLI_ARTIFACT_INVALID";
	return new CliError(
		`${code}: ${diagnostics.map((d) => d.message).join("; ")}`,
		{ code, exitCode: EXIT_INPUT_ERROR },
	);
}

async function resolveRepoApiToken(
	repo: Parameters<typeof resolveGhesToken>[0],
	context: CliCommandContext,
): Promise<string | undefined> {
	if (repo.mode !== "ghes-api") return undefined;
	return (await resolveGhesToken(repo, { env: context.env }))?.token;
}

type LoadedAddRepoConfig = Awaited<ReturnType<typeof loadConfig>>;
type AddRepoResolvedInput = Awaited<ReturnType<typeof resolveRepoInput>>;
type AddRepoArtifactSource = "local-artifact" | "remote-artifact";

interface AddRepoSetup {
	loadedConfig: LoadedAddRepoConfig;
	cacheDir: string;
	corpusDbPath: string;
	configPath: string;
	artifactRoot: string;
	positional: string | undefined;
	resolved: AddRepoResolvedInput | undefined;
	ref: string;
}

interface AcquiredArtifact {
	artifactDir: string;
	artifactSource: AddRepoArtifactSource;
}

/** Adds one validated repository entry to ATLAS config using artifact-only acquisition. */
export async function runAddRepoCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const setup = await prepareAddRepoSetup(context);
	const repo = await buildAddRepoConfig(context, setup);
	if (setup.resolved === undefined) {
		return renderConfigOnlyAddRepo(context, repo, setup);
	}
	const resolvedSetup = { ...setup, resolved: setup.resolved };

	const acquired = await acquireAddRepoArtifact(context, repo, resolvedSetup);
	if ("missing" in acquired) return acquired.missing;
	const validation = await validateAddRepoArtifact(
		repo,
		resolvedSetup.resolved,
		acquired.artifactDir,
	);
	const freshness = await resolveAddRepoFreshness(
		context,
		repo,
		resolvedSetup.resolved,
		setup.ref,
		acquired.artifactSource,
		validation.manifest,
	);
	const written = await appendRepoConfig(context, repo, {
		configPath: setup.configPath,
		cacheDir: setup.cacheDir,
	});
	const importResult = await importAddRepoArtifact(
		repo,
		setup,
		acquired,
		validation.manifest,
		freshness,
	);

	return renderImportedAddRepo(context, {
		configPath: written.configPath,
		repo,
		artifactDir: acquired.artifactDir,
		artifactSource: acquired.artifactSource,
		importCounts: importResult.counts,
		stale: freshness.stale,
		indexedRevision: validation.manifest.indexedRevision,
		remoteHeadRevision: freshness.remoteHeadRevision,
		warning: freshness.warning,
	});
}

async function prepareAddRepoSetup(
	context: CliCommandContext,
): Promise<AddRepoSetup> {
	const loadedConfig = await loadAddRepoConfig(context);
	const cacheDir =
		readArgvString(context.argv, "--cache-dir") ?? loadedConfig.config.cacheDir;
	const identityArtifact = await resolveCliArtifactRoot(context);
	const positional = firstRepoInput(context.argv);
	const resolved = await resolveAddRepoInput(context, loadedConfig, positional);
	return {
		loadedConfig,
		cacheDir,
		corpusDbPath: loadedConfig.config.corpusDbPath,
		configPath: loadedConfig.source.configPath,
		artifactRoot: identityArtifact.artifactRoot,
		positional,
		resolved,
		ref: readArgvString(context.argv, "--ref") ?? "main",
	};
}

async function loadAddRepoConfig(
	context: CliCommandContext,
): Promise<LoadedAddRepoConfig> {
	const explicitConfigPath = readArgvString(context.argv, "--config");
	const identityProfile = resolveIdentityProfile({
		cliIdentityRoot: context.identityRoot,
		envIdentityRoot: context.env.ATLAS_IDENTITY_ROOT,
	});
	const defaultConfigPath = join(
		context.env.HOME ?? process.env.HOME ?? "~",
		identityProfile.runtimeRoot.startsWith("~/")
			? identityProfile.runtimeRoot.slice(2)
			: identityProfile.runtimeRoot,
		DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	);
	try {
		return await loadConfig({
			cwd: context.cwd,
			env: context.env,
			...(explicitConfigPath === undefined
				? {}
				: { configPath: explicitConfigPath }),
			requireGhesAuth: false,
		});
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) throw error;
		if (
			explicitConfigPath === undefined &&
			(await fileExists(defaultConfigPath))
		) {
			return await loadConfig({
				cwd: context.cwd,
				env: context.env,
				configPath: defaultConfigPath,
				requireGhesAuth: false,
			});
		}
		return {
			config: buildDefaultConfig(identityProfile.runtimeRoot),
			source: {
				configPath: explicitConfigPath ?? defaultConfigPath,
				loadedFrom:
					explicitConfigPath === undefined ? "discovered" : "explicit",
			},
			env: context.env as never,
		};
	}
}

async function resolveAddRepoInput(
	context: CliCommandContext,
	loadedConfig: LoadedAddRepoConfig,
	positional: string | undefined,
): Promise<AddRepoResolvedInput | undefined> {
	if (positional === undefined) return undefined;
	const hostFlag = readArgvString(context.argv, "--host");
	const resolved = await resolveRepoInput(context, loadedConfig.config, {
		input: positional,
		...(hostFlag === undefined ? {} : { host: hostFlag }),
		nonInteractive: context.argv.includes("--non-interactive"),
	});
	const explicitRepoId = readArgvString(context.argv, "--repo-id");
	if (
		explicitRepoId &&
		explicitRepoId !== resolved.repoId &&
		!context.argv.includes("--force")
	) {
		throw new CliError(
			`Explicit --repo-id ${explicitRepoId} does not match resolved ${resolved.repoId}.`,
			{ code: "CLI_REPO_ID_MISMATCH", exitCode: EXIT_INPUT_ERROR },
		);
	}
	return resolved;
}

async function buildAddRepoConfig(
	context: CliCommandContext,
	setup: AddRepoSetup,
) {
	const resolved = setup.resolved;
	const mode =
		(readArgvString(context.argv, "--mode") as
			| "local-git"
			| "ghes-api"
			| undefined) ?? "local-git";
	return await resolveRepoConfigInput(context, {
		repoId: readArgvString(context.argv, "--repo-id") ?? resolved?.repoId,
		mode,
		remote:
			readArgvString(context.argv, "--remote") ??
			resolved?.remote ??
			defaultResolvedRemote(resolved),
		localPath:
			readArgvString(context.argv, "--local-path") ?? resolved?.localPath,
		ref: setup.ref,
		refMode: readArgvString(context.argv, "--ref-mode") as
			| "remote"
			| "current-checkout"
			| undefined,
		baseUrl:
			readArgvString(context.argv, "--base-url") ?? resolved?.host.apiUrl,
		owner: readArgvString(context.argv, "--owner") ?? resolved?.owner,
		name: readArgvString(context.argv, "--name") ?? resolved?.name,
		tokenEnvVar: readArgvString(context.argv, "--token-env-var"),
		packageGlobs: readRepeatedOption(context.argv, "--package-glob"),
		packageManifestFiles: readRepeatedOption(
			context.argv,
			"--package-manifest-file",
		),
		template: readArgvString(context.argv, "--template") as never,
		cacheDir: setup.cacheDir,
		nonInteractive:
			!context.argv.includes("--interactive") && !context.argv.includes("-i"),
	});
}

function defaultResolvedRemote(
	resolved: AddRepoResolvedInput | undefined,
): string | undefined {
	if (resolved === undefined) return undefined;
	return resolved.host.protocol === "ssh"
		? `git@${resolved.host.name}:${resolved.owner}/${resolved.name}.git`
		: `${resolved.host.webUrl}/${resolved.owner}/${resolved.name}.git`;
}

function readRepeatedOption(argv: readonly string[], flag: string): string[] {
	return argv
		.flatMap((token, index) => (token === flag ? [argv[index + 1] ?? ""] : []))
		.filter(Boolean);
}

async function renderConfigOnlyAddRepo(
	context: CliCommandContext,
	repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>,
	setup: AddRepoSetup,
): Promise<CliCommandResult> {
	const written = await appendRepoConfig(context, repo, {
		configPath: setup.configPath,
		cacheDir: setup.cacheDir,
	});
	return renderSuccess(
		context,
		"add-repo",
		{ configPath: written.configPath, repo },
		[`Added repo ${repo.repoId}.`, `Config: ${written.configPath}`],
	);
}

async function acquireAddRepoArtifact(
	context: CliCommandContext,
	repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>,
	setup: AddRepoSetup & { resolved: AddRepoResolvedInput },
): Promise<AcquiredArtifact | { missing: CliCommandResult }> {
	const artifactDir = artifactStorageDir(
		setup.cacheDir,
		repo.repoId,
		setup.artifactRoot,
	);
	const localArtifact = await findLocalCheckoutArtifact(
		context,
		setup.resolved,
		setup.artifactRoot,
	);
	if (localArtifact) {
		await copyLocalArtifactToRepoStorage(localArtifact, artifactDir);
		return { artifactDir, artifactSource: "local-artifact" };
	}
	const gitArtifact = await findGitFetchedArtifact(
		repo,
		setup.artifactRoot,
	).catch(() => undefined);
	if (gitArtifact) {
		await copyLocalArtifactToRepoStorage(gitArtifact, artifactDir);
		return { artifactDir, artifactSource: "local-artifact" };
	}
	const fetched = await fetchRemoteArtifact({
		apiUrl: setup.resolved.host.apiUrl,
		owner: setup.resolved.owner,
		name: setup.resolved.name,
		ref: setup.ref,
		repoId: repo.repoId,
		artifactDir,
		artifactRoot: setup.artifactRoot,
		token: await resolveRepoApiToken(repo, context),
	});
	if (!fetched.ok && fetched.code === "CLI_ARTIFACT_NOT_FOUND") {
		return {
			missing: await renderMissingArtifactResult(context, {
				repoId: repo.repoId,
				repoInput: setup.positional ?? repo.repoId,
				ref: setup.ref,
				host: setup.resolved.host.name,
				owner: setup.resolved.owner,
				name: setup.resolved.name,
				nonInteractive: context.argv.includes("--non-interactive"),
				json: context.output.json,
				selectedAction: await selectedMissingArtifactAction(context),
			}),
		};
	}
	if (!fetched.ok) throw artifactValidationError(fetched.diagnostics);
	return { artifactDir, artifactSource: "remote-artifact" };
}

async function validateAddRepoArtifact(
	repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>,
	resolved: AddRepoResolvedInput,
	artifactDir: string,
) {
	const validation = await validateFetchedArtifact(artifactDir, {
		repoId: repo.repoId,
		host: resolved.host.name,
		owner: resolved.owner,
		name: resolved.name,
	});
	if (!validation.valid) throw artifactValidationError(validation.diagnostics);
	return { manifest: validation.manifest as MoxelAtlasArtifactManifest };
}

async function resolveAddRepoFreshness(
	context: CliCommandContext,
	repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>,
	resolved: AddRepoResolvedInput,
	ref: string,
	artifactSource: AddRepoArtifactSource,
	manifest: MoxelAtlasArtifactManifest,
): Promise<{ remoteHeadRevision?: string; stale: boolean; warning?: string }> {
	if (artifactSource !== "remote-artifact" || !resolved.host.apiUrl)
		return { stale: false };
	const head = await fetchRemoteHeadRevision({
		apiUrl: resolved.host.apiUrl,
		owner: resolved.owner,
		name: resolved.name,
		ref,
		token: await resolveRepoApiToken(repo, context),
	});
	if (!head.ok && head.code === "CLI_REMOTE_REF_NOT_FOUND")
		throw artifactValidationError(head.diagnostics);
	const remoteHeadRevision = head.ok ? head.remoteHeadRevision : undefined;
	const stale = remoteHeadRevision
		? manifest.indexedRevision !== remoteHeadRevision
		: false;
	return {
		...(remoteHeadRevision === undefined ? {} : { remoteHeadRevision }),
		stale,
		...(stale
			? { warning: "Artifact is stale; importing anyway." }
			: head.ok
				? {}
				: {
						warning: "Could not verify artifact freshness; importing anyway.",
					}),
	};
}

async function importAddRepoArtifact(
	repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>,
	setup: AddRepoSetup,
	acquired: AcquiredArtifact,
	manifest: MoxelAtlasArtifactManifest,
	freshness: { remoteHeadRevision?: string; stale: boolean },
) {
	await writeRepoArtifactMetadata(setup.cacheDir, repo.repoId, {
		artifactPath: setup.artifactRoot,
		artifactSource: acquired.artifactSource,
		artifactValidatedAt: new Date().toISOString(),
		indexedRevision: manifest.indexedRevision,
		remoteHeadRevision: freshness.remoteHeadRevision,
		stale: freshness.stale,
		importStatus: "ready",
	});
	const importedAt = new Date().toISOString();
	const importResult = importArtifactCorpus({
		repoId: repo.repoId,
		artifactDbPath: join(acquired.artifactDir, "corpus.db"),
		manifestPath: join(acquired.artifactDir, "manifest.json"),
		globalDbPath: setup.corpusDbPath,
		expectedSchemaVersion: STORE_SCHEMA_VERSION,
		importedAt,
	});
	if (importResult.diagnostics.length > 0)
		throw artifactValidationError(importResult.diagnostics);
	await writeRepoArtifactMetadata(setup.cacheDir, repo.repoId, {
		artifactPath: setup.artifactRoot,
		artifactSource: acquired.artifactSource,
		artifactValidatedAt: importedAt,
		indexedRevision: manifest.indexedRevision,
		remoteHeadRevision: freshness.remoteHeadRevision,
		stale: freshness.stale,
		importStatus: "imported",
		importedAt,
		globalCorpusPath: "../../../../corpus.db",
		importCounts: { ...importResult.counts },
	});
	return importResult;
}

function renderImportedAddRepo(
	context: CliCommandContext,
	input: {
		configPath: string;
		repo: Awaited<ReturnType<typeof resolveRepoConfigInput>>;
		artifactDir: string;
		artifactSource: AddRepoArtifactSource;
		importCounts: ReturnType<typeof importArtifactCorpus>["counts"];
		stale: boolean;
		indexedRevision: string;
		remoteHeadRevision?: string | undefined;
		warning?: string | undefined;
	},
): Promise<CliCommandResult> {
	return renderSuccess(
		context,
		"add-repo",
		{
			configPath: input.configPath,
			repo: input.repo,
			artifactFound: true,
			artifactPath: input.artifactDir,
			fetchedFiles: [...MOXEL_ATLAS_REMOTE_ARTIFACT_FILES],
			artifactSource: input.artifactSource,
			validation: "passed",
			importStatus: "imported",
			importCounts: input.importCounts,
			stale: input.stale,
			indexedRevision: input.indexedRevision,
			remoteHeadRevision: input.remoteHeadRevision,
			...(input.warning ? { warning: input.warning } : {}),
		},
		[
			`Added repo ${input.repo.repoId}.`,
			`Config: ${input.configPath}`,
			`Knowledge bundle: ${input.artifactDir}`,
			`Source: ${input.artifactSource === "local-artifact" ? "local checkout" : "remote repository"}`,
			"Validation: passed",
			"Import: completed",
			...(input.warning ? [`Warning: ${input.warning}`] : []),
		],
	);
}
