import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AtlasConfigNotFoundError,
	buildDefaultConfig,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	loadConfig,
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
	const artifactDir = join(resolved.localPath, artifactRoot);
	return (await completeArtifactDir(artifactDir)) ? artifactDir : undefined;
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

/** Adds one validated repository entry to ATLAS config using artifact-only acquisition. */
export async function runAddRepoCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
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
	let loadedConfig: Awaited<ReturnType<typeof loadConfig>>;
	try {
		loadedConfig = await loadConfig({
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
			loadedConfig = await loadConfig({
				cwd: context.cwd,
				env: context.env,
				configPath: defaultConfigPath,
				requireGhesAuth: false,
			});
		} else {
			loadedConfig = {
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
	const cacheDir =
		readArgvString(context.argv, "--cache-dir") ?? loadedConfig.config.cacheDir;
	const corpusDbPath = loadedConfig.config.corpusDbPath;
	const configPath = loadedConfig.source.configPath;
	const identityArtifact = await resolveCliArtifactRoot(context);
	const positional = firstRepoInput(context.argv);
	let resolved: Awaited<ReturnType<typeof resolveRepoInput>> | undefined;
	const explicitRepoId = readArgvString(context.argv, "--repo-id");
	if (positional) {
		const loaded = loadedConfig;
		const hostFlag = readArgvString(context.argv, "--host");
		resolved = await resolveRepoInput(context, loaded.config, {
			input: positional,
			...(hostFlag === undefined ? {} : { host: hostFlag }),
			nonInteractive: context.argv.includes("--non-interactive"),
		});
		if (
			explicitRepoId &&
			explicitRepoId !== resolved.repoId &&
			!context.argv.includes("--force")
		)
			throw new CliError(
				`Explicit --repo-id ${explicitRepoId} does not match resolved ${resolved.repoId}.`,
				{ code: "CLI_REPO_ID_MISMATCH", exitCode: EXIT_INPUT_ERROR },
			);
	}
	const ref = readArgvString(context.argv, "--ref") ?? "main";
	const mode =
		(readArgvString(context.argv, "--mode") as
			| "local-git"
			| "ghes-api"
			| undefined) ??
		(resolved && resolved.kind !== "local-path" ? "ghes-api" : "local-git");
	const remote =
		readArgvString(context.argv, "--remote") ??
		resolved?.remote ??
		(resolved
			? resolved.host.protocol === "ssh"
				? `git@${resolved.host.name}:${resolved.owner}/${resolved.name}.git`
				: `${resolved.host.webUrl}/${resolved.owner}/${resolved.name}.git`
			: undefined);
	const repo = await resolveRepoConfigInput(context, {
		repoId: explicitRepoId ?? resolved?.repoId,
		mode,
		remote,
		localPath:
			readArgvString(context.argv, "--local-path") ?? resolved?.localPath,
		ref,
		refMode: readArgvString(context.argv, "--ref-mode") as
			| "remote"
			| "current-checkout"
			| undefined,
		baseUrl:
			readArgvString(context.argv, "--base-url") ?? resolved?.host.apiUrl,
		owner: readArgvString(context.argv, "--owner") ?? resolved?.owner,
		name: readArgvString(context.argv, "--name") ?? resolved?.name,
		tokenEnvVar: readArgvString(context.argv, "--token-env-var"),
		packageGlobs: context.argv
			.flatMap((token, index) =>
				token === "--package-glob" ? [context.argv[index + 1] ?? ""] : [],
			)
			.filter(Boolean),
		packageManifestFiles: context.argv
			.flatMap((token, index) =>
				token === "--package-manifest-file"
					? [context.argv[index + 1] ?? ""]
					: [],
			)
			.filter(Boolean),
		template: readArgvString(context.argv, "--template") as never,
		cacheDir,
		nonInteractive:
			!context.argv.includes("--interactive") && !context.argv.includes("-i"),
	});
	if (!resolved) {
		const written = await appendRepoConfig(context, repo, {
			configPath,
			cacheDir,
		});
		return renderSuccess(
			context,
			"add-repo",
			{ configPath: written.configPath, repo },
			[`Added repo ${repo.repoId}.`, `Config: ${written.configPath}`],
		);
	}
	const artifactDir = artifactStorageDir(
		cacheDir,
		repo.repoId,
		identityArtifact.artifactRoot,
	);
	let artifactSource: "local-artifact" | "remote-artifact" = "remote-artifact";
	const localArtifact = await findLocalCheckoutArtifact(
		context,
		resolved,
		identityArtifact.artifactRoot,
	);
	if (localArtifact) {
		artifactSource = "local-artifact";
		await copyLocalArtifactToRepoStorage(localArtifact, artifactDir);
	} else {
		const apiUrl = resolved.host.apiUrl;
		const tokenEnvVar =
			repo.mode === "ghes-api" ? repo.github?.tokenEnvVar : undefined;
		const fetched = await fetchRemoteArtifact({
			apiUrl,
			owner: resolved.owner,
			name: resolved.name,
			ref,
			repoId: repo.repoId,
			artifactDir,
			artifactRoot: identityArtifact.artifactRoot,
			token: tokenEnvVar ? context.env[tokenEnvVar] : undefined,
		});
		if (!fetched.ok && fetched.code === "CLI_ARTIFACT_NOT_FOUND") {
			return renderMissingArtifactResult(context, {
				repoId: repo.repoId,
				repoInput: positional ?? repo.repoId,
				ref,
				host: resolved.host.name,
				owner: resolved.owner,
				name: resolved.name,
				nonInteractive: context.argv.includes("--non-interactive"),
				json: context.output.json,
				selectedAction: await selectedMissingArtifactAction(context),
			});
		}
		if (!fetched.ok) throw artifactValidationError(fetched.diagnostics);
	}
	const validation = await validateFetchedArtifact(artifactDir, {
		repoId: repo.repoId,
		host: resolved.host.name,
		owner: resolved.owner,
		name: resolved.name,
	});
	if (!validation.valid) throw artifactValidationError(validation.diagnostics);
	const manifest = validation.manifest as MoxelAtlasArtifactManifest;
	let remoteHeadRevision: string | undefined;
	let freshnessWarning: string | undefined;
	if (artifactSource === "remote-artifact" && resolved.host.apiUrl) {
		const tokenEnvVar =
			repo.mode === "ghes-api" ? repo.github?.tokenEnvVar : undefined;
		const head = await fetchRemoteHeadRevision({
			apiUrl: resolved.host.apiUrl,
			owner: resolved.owner,
			name: resolved.name,
			ref,
			token: tokenEnvVar ? context.env[tokenEnvVar] : undefined,
		});
		if (head.ok) remoteHeadRevision = head.remoteHeadRevision;
		else if (head.code !== "CLI_REMOTE_REF_NOT_FOUND")
			freshnessWarning =
				"Could not verify artifact freshness; importing anyway.";
		else throw artifactValidationError(head.diagnostics);
	}
	const stale = remoteHeadRevision
		? manifest.indexedRevision !== remoteHeadRevision
		: false;
	const warning = stale
		? "Artifact is stale; importing anyway."
		: freshnessWarning;
	const written = await appendRepoConfig(context, repo, {
		configPath,
		cacheDir,
	});
	await writeRepoArtifactMetadata(cacheDir, repo.repoId, {
		artifactPath: identityArtifact.artifactRoot,
		artifactSource,
		artifactValidatedAt: new Date().toISOString(),
		indexedRevision: manifest.indexedRevision,
		remoteHeadRevision,
		stale,
		importStatus: "ready",
	});
	const importedAt = new Date().toISOString();
	const importResult = importArtifactCorpus({
		repoId: repo.repoId,
		artifactDbPath: join(artifactDir, "corpus.db"),
		manifestPath: join(artifactDir, "manifest.json"),
		globalDbPath: corpusDbPath,
		expectedSchemaVersion: STORE_SCHEMA_VERSION,
		importedAt,
	});
	if (importResult.diagnostics.length > 0)
		throw artifactValidationError(importResult.diagnostics);
	await writeRepoArtifactMetadata(cacheDir, repo.repoId, {
		artifactPath: identityArtifact.artifactRoot,
		artifactSource,
		artifactValidatedAt: importedAt,
		indexedRevision: manifest.indexedRevision,
		remoteHeadRevision,
		stale,
		importStatus: "imported",
		importedAt,
		globalCorpusPath: "../../../../corpus.db",
		importCounts: { ...importResult.counts },
	});
	return renderSuccess(
		context,
		"add-repo",
		{
			configPath: written.configPath,
			repo,
			artifactFound: true,
			artifactPath: artifactDir,
			fetchedFiles: [...MOXEL_ATLAS_REMOTE_ARTIFACT_FILES],
			artifactSource,
			validation: "passed",
			importStatus: "imported",
			importCounts: importResult.counts,
			stale,
			indexedRevision: manifest.indexedRevision,
			remoteHeadRevision,
			...(warning ? { warning } : {}),
		},
		[
			`Added repo ${repo.repoId}.`,
			`Config: ${written.configPath}`,
			`Knowledge bundle: ${artifactDir}`,
			`Source: ${artifactSource === "local-artifact" ? "local checkout" : "remote repository"}`,
			"Validation: passed",
			"Import: completed",
			...(warning ? [`Warning: ${warning}`] : []),
		],
	);
}
