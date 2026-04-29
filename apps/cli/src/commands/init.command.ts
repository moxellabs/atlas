import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AtlasConfig,
	type AtlasHostConfig,
	DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
	defaultGithubHostConfig,
	loadConfig,
	parseCanonicalRepoId,
	resolveIdentityProfile,
} from "@atlas/config";

import { canPrompt, createPrompts } from "../io/prompts";
import {
	mutateAtlasConfig,
	resolveCliConfigTarget,
} from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { fileExists, runProcess } from "../utils/node-runtime";
import { displayPath, parentDir, resolveCliPath } from "../utils/paths";
import { resolveRepoTarget } from "./repo-target";
import {
	appendRepoConfig,
	defaultCliConfig,
	maybeRenderArtifactRootMigrationHint,
	readArgvString,
	renderSuccess,
	resolveCliArtifactRoot,
	resolveRepoConfigInput,
} from "./shared";

const REPO_METADATA_FILE = "atlas.repo.json";

/** Bootstraps repo-local artifact metadata or global ATLAS config. */
export async function runInitCommand(
	context: CliCommandContext,
	command: "init" | "setup" = "init",
): Promise<CliCommandResult> {
	if (command === "init") {
		return runRepoArtifactInitCommand(context);
	}
	return runSetupCommand(context, command);
}

async function runRepoArtifactInitCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const force = context.argv.includes("--force");
	const gitRoot =
		(await gitOutput(context.cwd, ["rev-parse", "--show-toplevel"])) ??
		context.cwd;
	let targetConfig = await loadTargetConfig(context);
	const explicitRepoId =
		readArgvString(context.argv, "--repo-id") ?? repoIdFromParts(context);
	let target = await resolveRepoTargetForInit(context, targetConfig.config, {
		...(explicitRepoId === undefined ? {} : { explicit: explicitRepoId }),
		command: "init",
		nonInteractive: context.argv.includes("--non-interactive"),
	});
	if (target.hostStatus === "unknown" && target.source === "git-origin") {
		if (targetConfig.configPath === undefined) {
			const host = parseCanonicalRepoId(target.repoId).host;
			throw new CliError(
				`Git origin host ${host} is not configured. Run atlas setup first, or add it explicitly with atlas hosts add ${host} --web-url https://${host} --api-url https://${host}/api/v3 --protocol ssh.`,
				{
					code: "CLI_REPO_HOST_UNKNOWN",
					exitCode: EXIT_INPUT_ERROR,
					details: { host, repoId: target.repoId },
				},
			);
		}
		const host = parseCanonicalRepoId(target.repoId).host;
		const written = await mutateAtlasConfig(
			{
				cwd: context.cwd,
				env: context.env,
				configPath: targetConfig.configPath,
			},
			(config) => ({
				...config,
				hosts: config.hosts.some((entry) => entry.name === host)
					? config.hosts
					: [...config.hosts, defaultEnterpriseHostConfig(host)],
			}),
		);
		targetConfig = { config: written.config, configPath: written.configPath };
		target = { ...target, hostStatus: "configured" };
	}
	const repoId = target.repoId;
	let parsed: { host: string; owner: string; name: string };
	try {
		parsed = parseCanonicalRepoId(repoId);
	} catch (error) {
		throw new CliError("Repository ID must be host/owner/name.", {
			code: "CLI_REPO_ID_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
			details: error,
		});
	}
	const ref =
		readArgvString(context.argv, "--ref") ??
		(await gitOutput(gitRoot, [
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		])) ??
		(await gitOutput(gitRoot, ["rev-parse", "HEAD"])) ??
		"HEAD";
	const refMode = parseRefMode(readArgvString(context.argv, "--ref-mode"));
	const artifactRoot = await resolveCliArtifactRoot(context, gitRoot);
	const migrationHint = await maybeRenderArtifactRootMigrationHint({
		root: gitRoot,
		artifactRoot: artifactRoot.artifactRoot,
		customRootUsed: artifactRoot.customRootUsed,
	});
	const artifactDir = artifactRoot.artifactDir;
	const metadataPath = join(artifactDir, REPO_METADATA_FILE);
	if (!force && (await fileExists(metadataPath))) {
		throw new CliError(`Artifact metadata already exists at ${metadataPath}.`, {
			code: "CLI_ARTIFACT_INIT_EXISTS",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const metadata = {
		schema: "moxel-atlas-repo/v1",
		repoId,
		host: parsed.host,
		owner: parsed.owner,
		name: parsed.name,
		ref,
		refMode,
		createdAt: new Date().toISOString(),
		artifactPath: artifactRoot.artifactRoot,
	};
	await mkdir(artifactDir, { recursive: true });
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
	return renderSuccess(
		context,
		"init",
		{
			...metadata,
			artifactRoot: artifactRoot.artifactRoot,
			metadataPath: `${artifactRoot.artifactRoot}/${REPO_METADATA_FILE}`,
			targetResolution: target,
		},
		[
			...(migrationHint === undefined ? [] : [migrationHint]),
			`Repo target: ${repoId} (${target.source})`,
			`Ref mode: ${refMode} (atlas build reads current checkout; remote mode requires ref on origin)`,
			`Knowledge bundle: ${artifactRoot.artifactRoot}`,
			"Next: atlas build",
		],
	);
}

function parseRefMode(
	value: string | undefined,
): "remote" | "current-checkout" {
	if (value === undefined) return "current-checkout";
	if (value === "remote" || value === "current-checkout") return value;
	throw new CliError("Invalid --ref-mode. Use remote or current-checkout.", {
		code: "CLI_INVALID_REF_MODE",
		exitCode: EXIT_INPUT_ERROR,
	});
}

function repoIdFromParts(context: CliCommandContext): string | undefined {
	const host = readArgvString(context.argv, "--host");
	const owner = readArgvString(context.argv, "--owner");
	const name = readArgvString(context.argv, "--name");
	return host && owner && name ? `${host}/${owner}/${name}` : undefined;
}

async function loadTargetConfig(context: CliCommandContext): Promise<{
	config: AtlasConfig;
	configPath?: string | undefined;
}> {
	const configPath = readArgvString(context.argv, "--config");
	try {
		const loaded = await loadConfig({
			cwd: context.cwd,
			env: context.env,
			requireGhesAuth: false,
			...(configPath === undefined ? {} : { configPath }),
		});
		return { config: loaded.config, configPath: loaded.source.configPath };
	} catch (error) {
		if (configPath !== undefined) throw error;
		return { config: defaultCliConfig() };
	}
}

async function resolveRepoTargetForInit(
	context: CliCommandContext,
	config: AtlasConfig,
	options: {
		explicit?: string | undefined;
		command: string;
		nonInteractive: boolean;
	},
) {
	try {
		return await resolveRepoTarget(context, { config, ...options });
	} catch (error) {
		if (
			!(error instanceof CliError) ||
			error.code !== "CLI_REPO_HOST_UNKNOWN"
		) {
			throw error;
		}
		const details = error.details as { repoId?: unknown } | undefined;
		if (typeof details?.repoId !== "string") throw error;
		return {
			repoId: details.repoId,
			source: "git-origin" as const,
			reason: "parsed remote.origin.url",
			hostStatus: "unknown" as const,
		};
	}
}

function defaultEnterpriseHostConfig(host: string): AtlasHostConfig {
	return {
		name: host,
		webUrl: `https://${host}`,
		apiUrl: `https://${host}/api/v3`,
		protocol: "ssh",
		priority: 100,
		default: false,
	};
}

async function runSetupCommand(
	context: CliCommandContext,
	command: "setup",
): Promise<CliCommandResult> {
	const explicitConfigPath = readArgvString(context.argv, "--config");
	const identityProfile = resolveIdentityProfile({
		cliIdentityRoot: context.identityRoot,
		envIdentityRoot: context.env.ATLAS_IDENTITY_ROOT,
	});
	const identityEnv = {
		...context.env,
		...(context.identityRoot === undefined
			? {}
			: { ATLAS_IDENTITY_ROOT: context.identityRoot }),
	};
	const configPath =
		explicitConfigPath === undefined
			? join(
					context.env.HOME ?? process.env.HOME ?? "~",
					identityProfile.runtimeRoot.startsWith("~/")
						? identityProfile.runtimeRoot.slice(2)
						: identityProfile.runtimeRoot,
					"config.yaml",
				)
			: await resolveCliConfigTarget({
					cwd: context.cwd,
					env: identityEnv,
					configPath: explicitConfigPath,
				});
	if (await fileExists(configPath)) {
		throw new CliError(`Config already exists at ${configPath}.`, {
			code: "CLI_CONFIG_EXISTS",
			exitCode: EXIT_INPUT_ERROR,
		});
	}

	const cacheDirFlag = readArgvString(context.argv, "--cache-dir");
	const nonInteractive = context.argv.includes("--non-interactive");
	const interactive = canPrompt() && !nonInteractive;
	const prompts = interactive ? createPrompts() : undefined;
	const defaultRuntimeRoot = identityProfile.runtimeRoot.startsWith("~/")
		? join(
				context.env.HOME ?? process.env.HOME ?? "~",
				identityProfile.runtimeRoot.slice(2),
			)
		: resolveCliPath(identityProfile.runtimeRoot, context.cwd);
	const cacheDir =
		cacheDirFlag ??
		(interactive
			? await prompts?.input("Atlas runtime directory", defaultRuntimeRoot)
			: defaultRuntimeRoot);
	if (!cacheDir) {
		throw new CliError("Missing cache directory.", {
			code: "CLI_CACHE_DIR_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}

	const hostName = readArgvString(context.argv, "--host");
	const webUrl = readArgvString(context.argv, "--web-url");
	const apiUrl = readArgvString(context.argv, "--api-url");
	const protocol = readArgvString(context.argv, "--protocol") as
		| "ssh"
		| "https"
		| undefined;
	const priority = Number(readArgvString(context.argv, "--priority") ?? "100");
	const setupHost = hostName
		? {
				name: hostName.toLowerCase(),
				webUrl: webUrl ?? `https://${hostName.toLowerCase()}`,
				apiUrl: apiUrl ?? `https://${hostName.toLowerCase()}/api/v3`,
				protocol: protocol ?? "ssh",
				priority,
				default: true,
			}
		: defaultGithubHostConfig();

	const created = await mutateAtlasConfig(
		{
			cwd: context.cwd,
			env: context.env,
			configPath,
			createDefault: {
				...defaultCliConfig(cacheDir),
				identity: { root: identityProfile.identityRoot },
				hosts: [setupHost],
			},
		},
		(config) => ({ ...config, hosts: [setupHost] }),
	);
	await mkdir(
		parentDir(resolveCliPath(created.config.corpusDbPath, context.cwd)),
		{ recursive: true },
	);
	await mkdir(resolveCliPath(created.config.cacheDir, context.cwd), {
		recursive: true,
	});
	await mkdir(
		resolveCliPath(
			`${created.config.cacheDir}/${DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH}`,
			context.cwd,
		),
		{ recursive: true },
	);

	if (
		interactive &&
		(await prompts?.confirm("Add the first repository now?", true))
	) {
		const repo = await resolveRepoConfigInput(context, {
			cacheDir: created.config.cacheDir,
			packageGlobs: [],
			packageManifestFiles: [],
			nonInteractive: false,
		});
		await appendRepoConfig(context, repo, {
			configPath,
			cacheDir: created.config.cacheDir,
		});
	}
	return renderSuccess(
		context,
		command,
		{
			configPath,
			identityRoot: identityProfile.identityRoot,
			runtimeRoot: created.config.cacheDir,
			cacheDir: created.config.cacheDir,
			corpusDbPath: created.config.corpusDbPath,
			hosts: created.config.hosts,
		},
		[
			`Config: ${displayPath(configPath, context.cwd)}`,
			`Artifact root: ${identityProfile.identityRoot}`,
			`Runtime root: ${displayPath(resolveCliPath(created.config.cacheDir, context.cwd), context.cwd)}`,
			`Cache: ${displayPath(resolveCliPath(created.config.cacheDir, context.cwd), context.cwd)}`,
			"Next: atlas repo add <repo>",
		],
	);
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
