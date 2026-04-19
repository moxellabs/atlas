import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
	buildCliDependencies,
	managedRepoCacheRoot,
} from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { parseDuration, readArgvString, renderSuccess } from "./shared";

/** Safely prunes orphaned managed repo caches under the CLI cache root. */
export async function runPruneCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readArgvString(context.argv, "--config");
	const deps = await buildCliDependencies({
		cwd: context.cwd,
		...(configPath === undefined ? {} : { configPath }),
	});
	try {
		const dryRun = context.argv.includes("--dry-run");
		const olderThanMs = parseDuration(
			readArgvString(context.argv, "--older-than"),
		);
		const cacheRoot = managedRepoCacheRoot(deps.config.config.cacheDir);
		const legacyCheckoutRoot = join(deps.config.config.cacheDir, "checkouts");
		const active = new Set(
			deps.config.config.repos
				.filter((repo) => repo.mode === "local-git")
				.map((repo) => repo.git?.localPath)
				.filter((path): path is string => path !== undefined),
		);
		const candidates = [
			...(await listPrunableDirectories(cacheRoot, active, olderThanMs)),
			...(await listPrunableDirectories(legacyCheckoutRoot, active, olderThanMs)),
		].sort((left, right) => left.path.localeCompare(right.path));
		if (!dryRun) {
			for (const path of candidates.map((entry) => entry.path)) {
				await rm(path, { recursive: true, force: true });
			}
		}
		return renderSuccess(
			context,
			"prune",
			{
				cacheRoot,
				dryRun,
				removed: candidates,
			},
			[
				`${dryRun ? "Would remove" : "Removed"} ${candidates.length} cache director${candidates.length === 1 ? "y" : "ies"}.`,
				...candidates.map((entry) => `- ${entry.path}`),
			],
		);
	} finally {
		deps.close();
	}
}

async function listPrunableDirectories(
	cacheRoot: string,
	activePaths: Set<string>,
	olderThanMs: number | undefined,
) {
	try {
		await stat(cacheRoot);
	} catch {
		return [];
	}
	const now = Date.now();
	const entries = await readdir(cacheRoot, { withFileTypes: true });
	const candidates: Array<{ path: string; ageMs: number }> = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const path = join(cacheRoot, entry.name);
		if (
			activePaths.has(path) ||
			Array.from(activePaths).some((activePath) =>
				activePath.startsWith(`${path}/`),
			)
		) {
			continue;
		}
		const details = await stat(path);
		const ageMs = now - details.mtimeMs;
		if (olderThanMs !== undefined && ageMs < olderThanMs) {
			continue;
		}
		candidates.push({ path, ageMs });
	}
	return candidates.sort((left, right) => left.path.localeCompare(right.path));
}
