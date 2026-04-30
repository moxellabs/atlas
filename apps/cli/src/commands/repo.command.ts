import { existsSync } from "node:fs";
import { loadConfig } from "@atlas/config";
import {
	countRepoCorpusRows,
	deleteRepoCorpus,
	ManifestRepository,
	openStore,
	RepoRepository,
} from "@atlas/store";
import { mutateAtlasConfig } from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { resolveCliPath } from "../utils/paths";
import { readRepoTargetArg, resolveRepoTarget } from "./repo-target";
import {
	listRepoMetadata,
	readArgvString,
	readRepoMetadata,
	removeRepoFolder,
	renderRows,
	renderSuccess,
	repoFolderPath,
	repoMetadataPath,
} from "./shared";

/** Manages host-aware repo folder registry metadata. */
export async function runRepoCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const subcommand = context.argv[0] ?? "list";
	if (subcommand === "list") return runRepoList(context);
	if (subcommand === "doctor") return runRepoDoctor(context);
	if (subcommand === "remove") return runRepoRemove(context);
	if (subcommand === "show") return runRepoShow(context);
	throw new CliError(`Unknown repo subcommand: ${subcommand}.`, {
		code: "CLI_UNKNOWN_REPO_SUBCOMMAND",
		exitCode: EXIT_INPUT_ERROR,
	});
}

async function loadRegistryContext(context: CliCommandContext) {
	const configPath = readArgvString(context.argv, "--config");
	const resolved = await loadConfig({
		cwd: context.cwd,
		env: context.env,
		requireGhesAuth: false,
		...(configPath === undefined ? {} : { configPath }),
	});
	return {
		resolved,
		atlasHome: resolveCliPath(resolved.config.cacheDir, context.cwd),
		configPath,
	};
}

async function runRepoList(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const { atlasHome } = await loadRegistryContext(context);
	const rows = (await listRepoMetadata(atlasHome)).map((entry) => ({
		repoId: entry.repoId,
		host: entry.host,
		owner: entry.owner,
		name: entry.name,
		mode: entry.source.mode,
		updatedAt: entry.updatedAt,
	}));
	return renderSuccess(context, "repo list", rows, [renderRows(rows)]);
}

async function runRepoDoctor(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const { resolved, atlasHome } = await loadRegistryContext(context);
	const target = await resolveRepoTarget(context, {
		config: resolved.config,
		...readRepoTargetArg(context.argv, 1),
		command: "repo doctor",
		nonInteractive: context.argv.includes("--non-interactive"),
	});
	const repoId = target.repoId;
	const checks: Array<{
		name: string;
		layer: string;
		status: "PASS" | "WARN" | "FAIL";
		message: string;
		nextAction?: string | undefined;
	}> = [];
	const folder = repoFolderPath(atlasHome, repoId);
	const metadataPath = repoMetadataPath(atlasHome, repoId);
	checks.push({
		name: "repo-folder",
		layer: "registry",
		status: existsSync(folder) ? "PASS" : "FAIL",
		message: folder,
		nextAction: existsSync(folder)
			? undefined
			: "Run atlas add-repo or atlas index for this repo.",
	});
	try {
		const metadata = await readRepoMetadata(metadataPath);
		const agreement =
			metadata.repoId === repoId &&
			repoFolderPath(atlasHome, metadata.repoId) === folder;
		checks.push({
			name: "repo-metadata",
			layer: "registry",
			status: agreement ? "PASS" : "FAIL",
			message: metadataPath,
			nextAction: agreement ? undefined : "Remove and re-add repo metadata.",
		});
	} catch (error) {
		checks.push({
			name: "repo-metadata",
			layer: "registry",
			status: "FAIL",
			message: error instanceof Error ? error.message : metadataPath,
			nextAction:
				"Run atlas add-repo or atlas index to create repo registry metadata.",
		});
	}
	checks.push({
		name: "config-entry",
		layer: "config",
		status: resolved.config.repos.some((repo) => repo.repoId === repoId)
			? "PASS"
			: "WARN",
		message: repoId,
		nextAction: resolved.config.repos.some((repo) => repo.repoId === repoId)
			? undefined
			: "Run atlas add-repo to add this repo to config.",
	});
	let db: ReturnType<typeof openStore> | undefined;
	try {
		db = openStore({ path: resolved.config.corpusDbPath, migrate: true });
		const hasStoreEntry = Boolean(new RepoRepository(db).get(repoId));
		const hasManifestEntry = Boolean(new ManifestRepository(db).get(repoId));
		checks.push({
			name: "store-entry",
			layer: "store",
			status: hasStoreEntry ? "PASS" : "WARN",
			message: repoId,
			nextAction: hasStoreEntry
				? undefined
				: "Run atlas build or atlas add-repo to populate store rows.",
		});
		checks.push({
			name: "manifest-entry",
			layer: "artifact-metadata",
			status: hasManifestEntry ? "PASS" : "WARN",
			message: repoId,
			nextAction: hasManifestEntry
				? undefined
				: "Run atlas build to create/update artifact metadata.",
		});
	} catch (error) {
		checks.push({
			name: "store-entry",
			layer: "store",
			status: "FAIL",
			message:
				error instanceof Error ? error.message : "Failed to open corpus DB.",
			nextAction: "Run atlas doctor to check runtime store configuration.",
		});
		checks.push({
			name: "manifest-entry",
			layer: "artifact-metadata",
			status: "WARN",
			message: "Store unavailable.",
			nextAction: "Fix store layer first, then run atlas build.",
		});
	} finally {
		db?.close();
	}
	const exitCode = checks.some((check) => check.status === "FAIL") ? 1 : 0;
	return renderSuccess(
		context,
		"repo doctor",
		{
			repoId,
			targetResolution: target,
			note: "repo doctor checks config/registry/store/artifact metadata only; it does not run build.",
			checks,
		},
		[
			`Repo target: ${repoId} (${target.source})`,
			"Checks config/registry/store/artifact metadata only; does not run build.",
			...checks.map(
				(check) =>
					`${check.status} [${check.layer}] ${check.name}: ${check.message}${check.nextAction ? ` Next: ${check.nextAction}` : ""}`,
			),
		],
		exitCode,
	);
}

async function runRepoShow(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const { resolved, atlasHome } = await loadRegistryContext(context);
	const target = await resolveRepoTarget(context, {
		config: resolved.config,
		...readRepoTargetArg(context.argv, 1),
		command: "repo show",
		nonInteractive: context.argv.includes("--non-interactive"),
	});
	const repoId = target.repoId;
	const configEntry = resolved.config.repos.find(
		(repo) => repo.repoId === repoId,
	);
	const metadataPath = repoMetadataPath(atlasHome, repoId);
	let metadata: Awaited<ReturnType<typeof readRepoMetadata>> | undefined;
	try {
		metadata = await readRepoMetadata(metadataPath);
	} catch {
		metadata = undefined;
	}
	if (configEntry === undefined && metadata === undefined)
		throw new CliError(`Unknown repository: ${repoId}.`, {
			code: "CLI_REPO_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	const folder = repoFolderPath(atlasHome, repoId);
	const data = {
		repoId,
		repoFolder: folder,
		metadataPath,
		configured: configEntry !== undefined,
		metadataFound: metadata !== undefined,
		config: configEntry,
		metadata,
		targetResolution: target,
	};
	return renderSuccess(context, "repo show", data, renderRepoShowLines(data));
}

function renderRepoShowLines(data: {
	repoId: string;
	repoFolder: string;
	metadataPath: string;
	configured: boolean;
	metadataFound: boolean;
	config: Awaited<ReturnType<typeof loadConfig>>["config"]["repos"][number] | undefined;
	metadata: Awaited<ReturnType<typeof readRepoMetadata>> | undefined;
	targetResolution: Awaited<ReturnType<typeof resolveRepoTarget>>;
}): string[] {
	const source = data.metadata?.source;
	const config = data.config;
	const mode = source?.mode ?? config?.mode;
	const lines = [
		`Repo: ${data.repoId}`,
		`Configured: ${data.configured ? "yes" : "no"}`,
		`Metadata found: ${data.metadataFound ? "yes" : "no"}`,
	];
	if (mode !== undefined) lines.push(`Mode: ${mode}`);
	if (source !== undefined) {
		if (source.mode === "local-git") {
			if (source.remote) lines.push(`Source: ${source.remote}`);
			if (source.localPath) lines.push(`Local path: ${source.localPath}`);
			if (source.ref) lines.push(`Ref: ${source.ref}`);
		} else {
			if (source.baseUrl) lines.push(`Source: ${source.baseUrl}`);
			if (source.ref) lines.push(`Ref: ${source.ref}`);
		}
	} else if (config?.mode === "local-git") {
		if (config.git?.remote) lines.push(`Source: ${config.git.remote}`);
		if (config.git?.localPath) lines.push(`Local path: ${config.git.localPath}`);
		if (config.git?.ref) lines.push(`Ref: ${config.git.ref}`);
	} else if (config?.mode === "ghes-api") {
		if (config.github?.baseUrl) lines.push(`Source: ${config.github.baseUrl}`);
		if (config.github?.ref) lines.push(`Ref: ${config.github.ref}`);
	}
	lines.push(`Repo folder: ${data.repoFolder}`);
	lines.push(`Metadata path: ${data.metadataPath}`);
	lines.push(`Target: ${data.targetResolution.source}`);
	if (config !== undefined) {
		const packageGlobCount = config.workspace.packageGlobs.length;
		lines.push(
			`Config entry: ${config.mode}, ${packageGlobCount} package glob${packageGlobCount === 1 ? "" : "s"}`,
		);
	} else {
		lines.push("Config entry: missing");
	}
	if (!data.configured) lines.push("Next: Run atlas add-repo to add this repo to config.");
	if (!data.metadataFound)
		lines.push(
			"Next: Run atlas add-repo or atlas index to create repo registry metadata.",
		);
	lines.push("Full details: rerun with --json.");
	return lines;
}

async function runRepoRemove(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const yes = context.argv.includes("--yes");
	const dryRun = context.argv.includes("--dry-run");
	if (!yes && !dryRun)
		throw new CliError("Confirmation required. Re-run with --yes.", {
			code: "CLI_CONFIRMATION_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const { resolved, atlasHome, configPath } =
		await loadRegistryContext(context);
	const target = await resolveRepoTarget(context, {
		config: resolved.config,
		...readRepoTargetArg(context.argv, 1),
		command: "repo remove",
		nonInteractive: true,
		allowSingleConfigured: false,
	});
	const repoId = target.repoId;
	const folder = repoFolderPath(atlasHome, repoId);
	let removedFolder = false;
	let removedStoreRows = false;
	let deletedCorpusCounts = {};
	let removedConfigEntry = false;
	if (dryRun && !existsSync(resolved.config.corpusDbPath)) {
		deletedCorpusCounts = emptyRepoCorpusCounts();
	} else {
		const db = openStore({ path: resolved.config.corpusDbPath, migrate: !dryRun });
		try {
			if (dryRun) {
				deletedCorpusCounts = countRepoCorpusRows(db, repoId);
			} else {
				removedFolder = await removeRepoFolder(atlasHome, repoId);
				deletedCorpusCounts = deleteRepoCorpus(db, repoId).deleted;
				removedStoreRows = true;
			}
		} finally {
			db.close();
		}
	}
	if (!dryRun) {
		const mutated = await mutateAtlasConfig(
			{
				cwd: context.cwd,
				env: context.env,
				...(configPath === undefined ? {} : { configPath }),
			},
			(config) => {
				const repos = config.repos.filter((repo) => repo.repoId !== repoId);
				removedConfigEntry = repos.length !== config.repos.length;
				return { ...config, repos };
			},
		);
		void mutated;
	}
	const result = {
		repoId,
		targetResolution: target,
		repoFolder: folder,
		removedFolder,
		removedStoreRows,
		deletedCorpusCounts,
		removedConfigEntry,
		dryRun,
	};
	return renderSuccess(context, "repo remove", result, [
		dryRun ? `Would remove repo ${repoId}.` : `Removed repo ${repoId}.`,
		dryRun
			? `Corpus rows that would be deleted: ${JSON.stringify(deletedCorpusCounts)}`
			: `Corpus rows deleted: ${JSON.stringify(deletedCorpusCounts)}`,
		JSON.stringify(result, null, 2),
	]);
}

function emptyRepoCorpusCounts(): ReturnType<typeof countRepoCorpusRows> {
	return {
		repos: 0,
		packages: 0,
		modules: 0,
		documents: 0,
		sections: 0,
		chunks: 0,
		summaries: 0,
		skills: 0,
		manifests: 0,
		ftsRows: 0,
	};
}
