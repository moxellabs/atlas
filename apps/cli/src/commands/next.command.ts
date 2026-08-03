import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { AtlasConfigNotFoundError, loadConfig } from "@atlas/config";
import {
	countRepoCorpusRows,
	getStoreDiagnostics,
	ManifestRepository,
	openStore,
	RepoRepository,
} from "@atlas/store";
import { readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError } from "../utils/errors";
import { runProcess } from "../utils/node-runtime";
import { resolveCliPath } from "../utils/paths";
import {
	type NextProbeIssue,
	type NextStepState,
	type NextTargetState,
	recommendNextStep,
} from "./next-recommendation";
import { readRepoTargetArg, resolveRepoTarget } from "./repo-target";
import {
	listRepoMetadata,
	renderSuccess,
	resolveCliArtifactRoot,
} from "./shared";

export type { NextStepState } from "./next-recommendation";

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

/** Probes local state only. It never creates or migrates the runtime corpus. */
export async function probeNextStepState(
	context: CliCommandContext,
): Promise<NextStepState> {
	const configPath = readStringOption(context, "config");
	const issues: NextProbeIssue[] = [];
	const gitRoot = await gitOutput(context.cwd, [
		"rev-parse",
		"--show-toplevel",
	]);
	const gitOrigin = gitRoot
		? await gitOutput(gitRoot, ["remote", "get-url", "origin"])
		: undefined;
	const checkout = await probeCheckout(context, gitRoot, issues);

	let loadedConfig: Awaited<ReturnType<typeof loadConfig>> | undefined;
	try {
		loadedConfig = await loadConfig({
			cwd: context.cwd,
			env: context.env,
			requireGhesAuth: false,
			...(configPath === undefined ? {} : { configPath }),
		});
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) throw error;
	}
	if (loadedConfig === undefined) {
		return {
			configFound: false,
			configPath,
			repoCount: 0,
			registryCount: 0,
			documentCount: 0,
			insideGitCheckout: gitRoot !== undefined,
			gitOrigin,
			repoMetadataFound: checkout.repoMetadataFound,
			artifactFound: checkout.artifactFound,
			staleArtifact: false,
			issues,
		};
	}

	const runtimeRoot = resolveCliPath(loadedConfig.config.cacheDir, context.cwd);
	const targetResolution = await resolveNextTarget(
		context,
		loadedConfig.config,
		issues,
	);
	const targetRepoId = targetResolution?.repoId;
	let registry: Awaited<ReturnType<typeof listRepoMetadata>> = [];
	try {
		registry = await listRepoMetadata(runtimeRoot);
	} catch (error) {
		issues.push({
			scope: targetRepoId === undefined ? "runtime" : "target",
			code: "NEXT_REGISTRY_UNAVAILABLE",
			message: errorMessage(error, "Atlas could not read the repository registry."),
		});
	}
	const targetRegistry = targetRepoId
		? registry.find((entry) => entry.repoId === targetRepoId)
		: undefined;
	const target = targetRepoId
		? createTargetState({
			config: loadedConfig.config,
			repoId: targetRepoId,
			source: targetResolution?.source ?? "unknown",
			registry: targetRegistry,
			checkout,
		})
		: undefined;
	if (
		target !== undefined &&
		checkout.repoId !== undefined &&
		checkout.repoId !== target.repoId
	) {
		issues.push({
			scope: "target",
			code: "NEXT_CHECKOUT_TARGET_MISMATCH",
			message: `Checkout metadata identifies ${checkout.repoId}, but the selected target is ${target.repoId}.`,
		});
	}

	let documentCount = 0;
	if (target !== undefined) {
		const corpus = await probeCorpus(
			resolveCliPath(loadedConfig.config.corpusDbPath, context.cwd),
			target.repoId,
			issues,
		);
		documentCount = corpus.documentCount;
		target.corpus = corpus.target;
	} else {
		documentCount = await probeGlobalDocumentCount(
			resolveCliPath(loadedConfig.config.corpusDbPath, context.cwd),
			issues,
		);
	}

	return {
		configFound: true,
		configPath: loadedConfig.source.configPath ?? configPath,
		runtimeRoot,
		repoCount: loadedConfig.config.repos.length,
		registryCount: registry.length,
		documentCount,
		insideGitCheckout: gitRoot !== undefined,
		gitOrigin,
		repoMetadataFound: checkout.repoMetadataFound,
		artifactFound: checkout.artifactFound,
		staleArtifact: registry.some((entry) => entry.stale === true),
		...(target === undefined
			? {}
			: {
				targetRepoId: target.repoId,
				targetSource: target.source,
				target,
			}),
		issues,
	};
}

async function resolveNextTarget(
	context: CliCommandContext,
	config: Awaited<ReturnType<typeof loadConfig>>["config"],
	issues: NextProbeIssue[],
) {
	const args = readRepoTargetArg(context, 0);
	try {
		return await resolveRepoTarget(context, {
			config,
			...args,
			command: "next",
			nonInteractive: true,
		});
	} catch (error) {
		if (args.explicit !== undefined || args.positional !== undefined) throw error;
		if (
			error instanceof CliError &&
			(error.code === "CLI_REPO_TARGET_REQUIRED" ||
				error.code === "CLI_REPO_TARGET_AMBIGUOUS")
		)
			return undefined;
		issues.push({
			scope: "runtime",
			code: "NEXT_TARGET_RESOLUTION_FAILED",
			message: errorMessage(error, "Atlas could not resolve a repository target."),
		});
		return undefined;
	}
}

function createTargetState(input: {
	config: Awaited<ReturnType<typeof loadConfig>>["config"];
	repoId: string;
	source: string;
	registry: Awaited<ReturnType<typeof listRepoMetadata>>[number] | undefined;
	checkout: CheckoutProbe;
}): NextTargetState {
	const configEntry = input.config.repos.find(
		(repo) => repo.repoId === input.repoId,
	);
	const checkoutMatchesTarget =
		input.checkout.repoId === input.repoId ||
		input.source === "repo-metadata" ||
		input.source === "cwd-config" ||
		input.source === "git-origin";
	return {
		repoId: input.repoId,
		source: input.source,
		configured: configEntry !== undefined,
		...(configEntry === undefined ? {} : { mode: configEntry.mode }),
		...(input.registry === undefined
			? {}
			: {
				registry: {
					found: true,
					stale: input.registry.stale === true,
					...(input.registry.importStatus === undefined
						? {}
						: { importStatus: input.registry.importStatus }),
				},
			}),
		corpus: { status: "missing" },
		checkout: {
			inside: input.checkout.inside && checkoutMatchesTarget,
			repoMetadataFound:
				input.checkout.repoMetadataFound && checkoutMatchesTarget,
			artifactFound: input.checkout.artifactFound && checkoutMatchesTarget,
			...(input.checkout.artifactFresh === undefined
				? {}
				: checkoutMatchesTarget
					? { artifactFresh: input.checkout.artifactFresh }
					: {}),
		},
	};
}

interface CheckoutProbe {
	inside: boolean;
	repoMetadataFound: boolean;
	artifactFound: boolean;
	artifactFresh?: boolean | undefined;
	repoId?: string | undefined;
}

async function probeCheckout(
	context: CliCommandContext,
	gitRoot: string | undefined,
	issues: NextProbeIssue[],
): Promise<CheckoutProbe> {
	const root = gitRoot ?? context.cwd;
	const artifactRoot = await resolveCliArtifactRoot(context, root);
	const metadataPath = join(artifactRoot.artifactDir, "atlas.repo.json");
	const manifestPath = join(artifactRoot.artifactDir, "manifest.json");
	const repoMetadataFound = await pathExists(metadataPath);
	const artifactFound = await pathExists(manifestPath);
	let repoId: string | undefined;
	if (repoMetadataFound) {
		try {
			const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
				repoId?: unknown;
			};
			if (typeof metadata.repoId !== "string") throw new Error("repoId is missing");
			repoId = metadata.repoId;
		} catch (error) {
			issues.push({
				scope: "checkout",
				code: "NEXT_REPO_METADATA_INVALID",
				message: `Checkout metadata is invalid: ${errorMessage(error, metadataPath)}`,
			});
		}
	}
	let artifactFresh: boolean | undefined;
	if (artifactFound) {
		try {
			const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
				indexedRevision?: unknown;
			};
			if (typeof manifest.indexedRevision !== "string") {
				throw new Error("indexedRevision is missing");
			}
			const head = gitRoot
				? await gitOutput(gitRoot, ["rev-parse", "HEAD"])
				: undefined;
			artifactFresh = head === undefined ? undefined : head === manifest.indexedRevision;
		} catch (error) {
			issues.push({
				scope: "checkout",
				code: "NEXT_ARTIFACT_MANIFEST_INVALID",
				message: `Knowledge bundle manifest is invalid: ${errorMessage(error, manifestPath)}`,
			});
		}
	}
	return {
		inside: gitRoot !== undefined,
		repoMetadataFound,
		artifactFound,
		...(artifactFresh === undefined ? {} : { artifactFresh }),
		...(repoId === undefined ? {} : { repoId }),
	};
}

async function probeCorpus(
	dbPath: string,
	repoId: string,
	issues: NextProbeIssue[],
): Promise<{ documentCount: number; target: NextTargetState["corpus"] }> {
	if (!(await pathExists(dbPath))) {
		return {
			documentCount: 0,
			target: { status: "missing", documentCount: 0 },
		};
	}
	try {
		const db = openStore({ path: dbPath, readOnly: true });
		try {
			const counts = countRepoCorpusRows(db, repoId);
			return {
				documentCount: counts.documents,
				target: {
					status: counts.documents > 0 ? "ready" : "missing",
					documentCount: counts.documents,
					repoFound: Boolean(new RepoRepository(db).get(repoId)),
					manifestFound: Boolean(new ManifestRepository(db).get(repoId)),
				},
			};
		} finally {
			db.close();
		}
	} catch (error) {
		issues.push({
			scope: "target",
			code: "NEXT_CORPUS_UNAVAILABLE",
			message: errorMessage(error, "Atlas could not read the target corpus."),
		});
		return {
			documentCount: 0,
			target: { status: "unavailable" },
		};
	}
}

async function probeGlobalDocumentCount(
	dbPath: string,
	issues: NextProbeIssue[],
): Promise<number> {
	if (!(await pathExists(dbPath))) return 0;
	try {
		const db = openStore({ path: dbPath, readOnly: true });
		try {
			return getStoreDiagnostics(db).documentCount;
		} finally {
			db.close();
		}
	} catch (error) {
		issues.push({
			scope: "runtime",
			code: "NEXT_CORPUS_UNAVAILABLE",
			message: errorMessage(error, "Atlas could not read the local corpus."),
		});
		return 0;
	}
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: fallback;
}

export async function runNextCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const state = await probeNextStepState(context);
	const result = recommendNextStep(state);
	return renderSuccess(context, "next", result, [
		`Next: ${result.recommendedCommand}`,
		`Why: ${result.reason}`,
		...(state.targetRepoId
			? [`Target: ${state.targetRepoId} (${state.targetSource})`]
			: []),
		...result.evidence.map((evidence) => `Evidence: ${evidence}`),
		...(context.output.verbose
			? result.candidates.map(
				(candidate) =>
					`Candidate: ${candidate.command} (score ${candidate.score})`,
			)
			: []),
	]);
}
