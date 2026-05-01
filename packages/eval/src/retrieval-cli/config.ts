import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { RuntimeInfo } from "../retrieval-harness/types";
import { isRecord, runCliJson } from "./io";

const defaultArtifactDbPath = ".moxel/atlas/corpus.db";

export async function resolveEvalConfig(input: {
	cli: string;
	explicitConfigPath?: string;
	useGlobal: boolean;
	cwd: string;
}): Promise<{
	configPath?: string;
	tempConfigDir?: string;
	source: RuntimeInfo["source"];
}> {
	if (input.explicitConfigPath !== undefined) {
		return {
			configPath: resolve(input.cwd, input.explicitConfigPath),
			source: "explicit-config",
		};
	}
	if (input.useGlobal || input.cli !== "bun run cli") {
		return { source: "cli-default" };
	}
	const artifactDbPath = resolve(input.cwd, defaultArtifactDbPath);
	if (!(await Bun.file(artifactDbPath).exists())) {
		return { source: "cli-default" };
	}
	const tempConfigDir = await mkdtemp(join(tmpdir(), "atlas-eval-config-"));
	const configPath = join(tempConfigDir, "atlas.config.json");
	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				version: 1,
				cacheDir: resolve(input.cwd, ".moxel/atlas"),
				corpusDbPath: artifactDbPath,
				logLevel: "warn",
				server: { transport: "stdio" },
				hosts: [],
				repos: [],
			},
			null,
			2,
		)}\n`,
	);
	return { configPath, tempConfigDir, source: "repo-local-artifact" };
}

export async function inspectRuntime(input: {
	cliPrefix: string[];
	cli: string;
	configPath?: string;
	source: RuntimeInfo["source"];
	repoId?: string;
	cwd: string;
}): Promise<RuntimeInfo> {
	const corpusDbPath =
		input.configPath === undefined ? undefined : await readCorpusDbPath(input.configPath);
	const info: RuntimeInfo = {
		cli: input.cli,
		...(input.configPath === undefined ? {} : { configPath: input.configPath }),
		...(input.repoId === undefined ? {} : { repoId: input.repoId }),
		...(corpusDbPath === undefined ? {} : { corpusDbPath }),
		source: input.source,
	};
	if (input.repoId === undefined) {
		return info;
	}
	const output = await runCliJson(
		[...input.cliPrefix, "inspect", "repo", input.repoId, "--json"],
		input.cwd,
	);
	const data = isRecord(output.data) ? output.data : {};
	const repo = isRecord(data.repo) ? data.repo : {};
	const manifest = isRecord(data.manifest) ? data.manifest : {};
	const docs = Array.isArray(data.docs) ? data.docs : [];
	return {
		...info,
		...(typeof repo.repoId === "string" ? { repoId: repo.repoId } : {}),
		...(typeof repo.revision === "string" ? { repoRevision: repo.revision } : {}),
		...(typeof manifest.indexedRevision === "string"
			? { indexedRevision: manifest.indexedRevision }
			: {}),
		docCount: docs.length,
	};
}

export function omitConfigPath(runtime: RuntimeInfo): RuntimeInfo {
	return Object.fromEntries(
		Object.entries(runtime).filter(([key]) => key !== "configPath"),
	) as RuntimeInfo;
}

async function readCorpusDbPath(configPath: string): Promise<string | undefined> {
	if (!configPath.endsWith(".json")) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
		if (isRecord(parsed) && typeof parsed.corpusDbPath === "string") {
			return parsed.corpusDbPath;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

