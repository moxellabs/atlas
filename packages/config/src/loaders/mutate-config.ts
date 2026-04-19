import { mkdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { type AtlasConfig, atlasConfigSchema } from "../atlas-config.schema";
import {
	buildDefaultConfig,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	DEFAULT_MOXEL_ATLAS_HOME,
} from "../defaults/default-config";
import {
	AtlasConfigNotFoundError,
	type LoadConfigOptions,
	loadConfig,
} from "./load-config";

/** Returns the config source path if it exists, otherwise the default creation target. */
export async function resolveAtlasConfigTarget(
	options: LoadConfigOptions,
): Promise<string> {
	try {
		const resolved = await loadConfig(options);
		return resolved.source.configPath;
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) {
			throw error;
		}
		const cwd = resolve(options.cwd ?? process.cwd());
		return options.configPath === undefined
			? defaultMoxelAtlasConfigPath(options.env)
			: resolve(cwd, options.configPath);
	}
}

function defaultMoxelAtlasConfigPath(
	env: NodeJS.ProcessEnv | undefined,
): string {
	return join(
		env?.HOME ?? process.env.HOME ?? "~",
		DEFAULT_MOXEL_ATLAS_HOME.slice(2),
		DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	);
}

/** Reads, mutates, validates, and atomically writes an ATLAS config file. */
export async function mutateAtlasConfigFile(
	options: LoadConfigOptions & { createDefault?: AtlasConfig | undefined },
	mutate: (config: AtlasConfig) => AtlasConfig,
): Promise<{
	configPath: string;
	config: AtlasConfig;
	format: "json" | "yaml";
}> {
	const targetPath = await resolveAtlasConfigTarget(options);
	const existing = await Bun.file(targetPath).exists();
	const format = targetPath.endsWith(".json") ? "json" : "yaml";
	const current = existing
		? atlasConfigSchema.parse(
				format === "json"
					? await Bun.file(targetPath).json()
					: (parseYaml(await Bun.file(targetPath).text()) as unknown),
			)
		: (options.createDefault ?? buildDefaultConfig());
	const next = atlasConfigSchema.parse(mutate(current));
	const serialized =
		format === "json"
			? `${JSON.stringify(next, null, 2)}\n`
			: stringifyYaml(next);
	await mkdir(dirname(targetPath), { recursive: true });
	await Bun.write(`${targetPath}.tmp`, serialized);
	await rename(`${targetPath}.tmp`, targetPath);
	return {
		configPath: targetPath,
		config: next,
		format,
	};
}
