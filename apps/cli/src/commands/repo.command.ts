import { existsSync } from "node:fs";
import { loadConfig } from "@atlas/config";
import {
	deleteRepoCorpus,
	ManifestRepository,
	openStore,
	RepoRepository,
} from "@atlas/store";
import { mutateAtlasConfig } from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { resolveCliPath } from "../utils/paths";
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
	const repoId = context.argv[1] ?? readArgvString(context.argv, "--repo");
	if (!repoId)
		throw new CliError("repo doctor requires a repoId.", {
			code: "CLI_REPO_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const { resolved, atlasHome } = await loadRegistryContext(context);
	const checks: Array<{
		name: string;
		status: "PASS" | "WARN" | "FAIL";
		message: string;
	}> = [];
	const folder = repoFolderPath(atlasHome, repoId);
	const metadataPath = repoMetadataPath(atlasHome, repoId);
	checks.push({
		name: "repo-folder",
		status: existsSync(folder) ? "PASS" : "FAIL",
		message: folder,
	});
	try {
		const metadata = await readRepoMetadata(metadataPath);
		const agreement =
			metadata.repoId === repoId &&
			repoFolderPath(atlasHome, metadata.repoId) === folder;
		checks.push({
			name: "repo-metadata",
			status: agreement ? "PASS" : "FAIL",
			message: metadataPath,
		});
	} catch (error) {
		checks.push({
			name: "repo-metadata",
			status: "FAIL",
			message: error instanceof Error ? error.message : metadataPath,
		});
	}
	checks.push({
		name: "config-entry",
		status: resolved.config.repos.some((repo) => repo.repoId === repoId)
			? "PASS"
			: "WARN",
		message: repoId,
	});
	let db: ReturnType<typeof openStore> | undefined;
	try {
		db = openStore({ path: resolved.config.corpusDbPath, migrate: true });
		checks.push({
			name: "store-entry",
			status: new RepoRepository(db).get(repoId) ? "PASS" : "WARN",
			message: repoId,
		});
		checks.push({
			name: "manifest-entry",
			status: new ManifestRepository(db).get(repoId) ? "PASS" : "WARN",
			message: repoId,
		});
	} catch (error) {
		checks.push({
			name: "store-entry",
			status: "FAIL",
			message:
				error instanceof Error ? error.message : "Failed to open corpus DB.",
		});
		checks.push({
			name: "manifest-entry",
			status: "WARN",
			message: "Store unavailable.",
		});
	} finally {
		db?.close();
	}
	const exitCode = checks.some((check) => check.status === "FAIL") ? 1 : 0;
	return renderSuccess(
		context,
		"repo doctor",
		checks,
		checks.map((check) => `${check.status} ${check.name}: ${check.message}`),
		exitCode,
	);
}

async function runRepoShow(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const repoId = context.argv[1];
	if (!repoId)
		throw new CliError("repo show requires a repoId.", {
			code: "CLI_REPO_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const { resolved, atlasHome } = await loadRegistryContext(context);
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
	};
	return renderSuccess(context, "repo show", data, [
		JSON.stringify(data, null, 2),
	]);
}

async function runRepoRemove(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const repoId = context.argv[1];
	if (!repoId)
		throw new CliError("repo remove requires a repoId.", {
			code: "CLI_REPO_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const yes = context.argv.includes("--yes");
	const dryRun = context.argv.includes("--dry-run");
	if (!yes && !dryRun)
		throw new CliError("Confirmation required. Re-run with --yes.", {
			code: "CLI_CONFIRMATION_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const { resolved, atlasHome, configPath } =
		await loadRegistryContext(context);
	const folder = repoFolderPath(atlasHome, repoId);
	let removedFolder = false;
	let removedStoreRows = false;
	let deletedCorpusCounts = {};
	let removedConfigEntry = false;
	if (!dryRun) {
		removedFolder = await removeRepoFolder(atlasHome, repoId);
		const db = openStore({ path: resolved.config.corpusDbPath, migrate: true });
		try {
			deletedCorpusCounts = deleteRepoCorpus(db, repoId).deleted;
			removedStoreRows = true;
		} finally {
			db.close();
		}
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
