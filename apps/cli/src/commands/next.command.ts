import { stat } from "node:fs/promises";
import { join } from "node:path";
import { AtlasConfigNotFoundError, loadConfig } from "@atlas/config";
import { getStoreDiagnostics, openStore } from "@atlas/store";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { runProcess } from "../utils/node-runtime";
import { resolveCliPath } from "../utils/paths";
import { readRepoTargetArg, resolveRepoTarget } from "./repo-target";
import {
	listRepoMetadata,
	readArgvString,
	renderSuccess,
	resolveCliArtifactRoot,
} from "./shared";

export interface NextStepState {
	configFound: boolean;
	configPath?: string | undefined;
	runtimeRoot?: string | undefined;
	repoCount: number;
	registryCount: number;
	documentCount: number;
	insideGitCheckout: boolean;
	gitOrigin?: string | undefined;
	repoMetadataFound: boolean;
	artifactFound: boolean;
	staleArtifact: boolean;
	targetRepoId?: string | undefined;
	targetSource?: string | undefined;
}

interface NextStepRecommendation {
	recommendedCommand: string;
	reason: string;
	state: NextStepState;
	alternatives: string[];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function gitOutput(cwd: string, args: readonly string[]) {
	try {
		const { exitCode, stdout } = await runProcess(["git", ...args], { cwd });
		if (exitCode !== 0) return undefined;
		const value = stdout.trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

export async function probeNextStepState(
	context: CliCommandContext,
): Promise<NextStepState> {
	const configPath = readArgvString(context.argv, "--config");
	let configFound = false;
	let runtimeRoot: string | undefined;
	let repoCount = 0;
	let registryCount = 0;
	let documentCount = 0;
	let staleArtifact = false;
	let targetRepoId: string | undefined;
	let targetSource: string | undefined;
	let loadedConfig: Awaited<ReturnType<typeof loadConfig>> | undefined;
	try {
		loadedConfig = await loadConfig({
			cwd: context.cwd,
			env: context.env,
			requireGhesAuth: false,
			...(configPath === undefined ? {} : { configPath }),
		});
		configFound = true;
		runtimeRoot = resolveCliPath(loadedConfig.config.cacheDir, context.cwd);
		repoCount = loadedConfig.config.repos.length;
		try {
			const registry = await listRepoMetadata(runtimeRoot);
			registryCount = registry.length;
			staleArtifact = registry.some((entry) => entry.stale === true);
		} catch {
			registryCount = 0;
		}
		try {
			const db = openStore({
				path: resolveCliPath(loadedConfig.config.corpusDbPath, context.cwd),
				migrate: true,
			});
			try {
				documentCount = getStoreDiagnostics(db).documentCount;
			} finally {
				db.close();
			}
		} catch {
			documentCount = 0;
		}
		try {
			const target = await resolveRepoTarget(context, {
				config: loadedConfig.config,
				...readRepoTargetArg(context.argv, 0),
				command: "next",
				nonInteractive: true,
			});
			targetRepoId = target.repoId;
			targetSource = target.source;
		} catch {
			targetRepoId = undefined;
			targetSource = undefined;
		}
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) throw error;
	}
	const gitRoot = await gitOutput(context.cwd, [
		"rev-parse",
		"--show-toplevel",
	]);
	const gitOrigin = gitRoot
		? await gitOutput(gitRoot, ["remote", "get-url", "origin"])
		: undefined;
	const artifactRoot = await resolveCliArtifactRoot(
		context,
		gitRoot ?? context.cwd,
	);
	const metadataPath = join(artifactRoot.artifactDir, "atlas.repo.json");
	const repoMetadataFound = await pathExists(metadataPath);
	const artifactFound = await pathExists(
		join(artifactRoot.artifactDir, "manifest.json"),
	);
	return {
		configFound,
		configPath,
		runtimeRoot,
		repoCount,
		registryCount,
		documentCount,
		insideGitCheckout: gitRoot !== undefined,
		gitOrigin,
		repoMetadataFound,
		artifactFound,
		staleArtifact,
		targetRepoId,
		targetSource,
	};
}

function recommend(state: NextStepState): NextStepRecommendation {
	if (!state.configFound) {
		return {
			recommendedCommand: "atlas setup",
			reason: "No Atlas runtime config was found.",
			state,
			alternatives: ["atlas next --json"],
		};
	}
	if (state.repoMetadataFound && !state.artifactFound) {
		return {
			recommendedCommand: "atlas build",
			reason:
				"This checkout has Atlas repo metadata but no published artifact yet.",
			state,
			alternatives: ["atlas artifact verify", "atlas doctor"],
		};
	}
	if (
		state.insideGitCheckout &&
		!state.repoMetadataFound &&
		state.repoCount === 0
	) {
		return {
			recommendedCommand: "atlas init",
			reason:
				"You are in a Git checkout and no repo artifact metadata exists yet.",
			state,
			alternatives: ["atlas repo add <repo>", "atlas index <path>"],
		};
	}
	if (state.repoCount === 0 && state.registryCount === 0) {
		return {
			recommendedCommand: "atlas repo add <repo>",
			reason:
				"Atlas is set up but no repositories are added to the local corpus.",
			state,
			alternatives: ["atlas init && atlas build", "atlas index <path>"],
		};
	}
	if (state.staleArtifact) {
		return {
			recommendedCommand: "atlas sync",
			reason: "At least one imported artifact is marked stale.",
			state,
			alternatives: ["atlas repo doctor", "atlas artifact verify --fresh"],
		};
	}
	if (state.documentCount === 0) {
		return {
			recommendedCommand: state.targetRepoId
				? `atlas repo add ${state.targetRepoId}`
				: "atlas repo add <repo>",
			reason:
				"Repositories are configured, but the local corpus has no documents.",
			state,
			alternatives: ["atlas sync", "atlas repo doctor"],
		};
	}
	return {
		recommendedCommand: "atlas search <query>",
		reason: "Atlas has imported documents in the local corpus.",
		state,
		alternatives: ["atlas list repos", "atlas doctor", "atlas next --json"],
	};
}

export async function runNextCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const state = await probeNextStepState(context);
	const result = recommend(state);
	return renderSuccess(context, "next", result, [
		`Next: ${result.recommendedCommand}`,
		`Reason: ${result.reason}`,
		`State: setup=${state.configFound ? "yes" : "no"}, repos=${state.repoCount}, registry=${state.registryCount}, docs=${state.documentCount}, checkout=${state.insideGitCheckout ? "yes" : "no"}, artifact=${state.artifactFound ? "yes" : "no"}`,
		...(state.targetRepoId
			? [`Repo target: ${state.targetRepoId} (${state.targetSource})`]
			: []),
		`Alternatives: ${result.alternatives.join(" | ")}`,
	]);
}
