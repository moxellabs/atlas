import { stat } from "node:fs/promises";
import {
	type AtlasRepoConfig,
	loadConfig,
	resolveGhesToken,
} from "@atlas/config";
import {
	GhesAuthenticationError,
	GhesClient,
	GhesRequestError,
	normalizeBaseUrl,
} from "@atlas/source-ghes";
import { RepoCacheService } from "@atlas/source-git";
import { openStore } from "@atlas/store";

import { loadServerEnv } from "../../../server/src/env";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { runProcess } from "../utils/node-runtime";
import { resolveRepoTarget } from "./repo-target";
import { readArgvString, renderSuccess } from "./shared";

interface DoctorCheck {
	name: string;
	layer: string;
	status: "pass" | "warn" | "fail";
	message: string;
	nextAction?: string | undefined;
}

/** Runs local readiness and dependency diagnostics. */
export async function runDoctorCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const checks: DoctorCheck[] = [];
	const configPath = readArgvString(context.argv, "--config");
	const resolved = await loadConfig({
		cwd: context.cwd,
		env: context.env,
		requireGhesAuth: false,
		...(configPath === undefined ? {} : { configPath }),
	});
	const repoCache = new RepoCacheService();
	const db = tryOpenStore(resolved.config.corpusDbPath);
	try {
		checks.push({
			name: "config",
			layer: "runtime-config",
			status: "pass",
			message: `Loaded ${resolved.source.configPath}`,
		});
		checks.push(
			db.ok
				? {
						name: "store",
						layer: "db",
						status: "pass",
						message: `Opened ${resolved.config.corpusDbPath}`,
					}
				: {
						name: "store",
						layer: "db",
						status: "fail",
						message: db.message,
						nextAction: "Check corpusDbPath and filesystem permissions.",
					},
		);
		checks.push(serverEnvCheck(context));
		checks.push(await cacheDirectoryCheck(resolved.config.cacheDir));

		const gitVersion = await checkGit();
		checks.push({
			name: "git",
			layer: "local-git-cache",
			status: gitVersion.ok ? "pass" : "fail",
			message: gitVersion.message,
			nextAction: gitVersion.ok
				? undefined
				: "Install git and ensure it is on PATH.",
		});

		const rawTargetRepoId = readArgvString(context.argv, "--repo");
		const target = rawTargetRepoId
			? await resolveRepoTarget(context, {
					config: resolved.config,
					explicit: rawTargetRepoId,
					command: "doctor",
					nonInteractive: context.argv.includes("--non-interactive"),
				})
			: undefined;
		const targetRepoId = target?.repoId;
		const repos =
			targetRepoId === undefined
				? resolved.config.repos
				: resolved.config.repos.filter((repo) => repo.repoId === targetRepoId);
		if (targetRepoId !== undefined && repos.length === 0) {
			checks.push({
				name: `repo:${targetRepoId}`,
				layer: "runtime-config",
				status: "fail",
				message: "Repository is not configured.",
				nextAction: "Run atlas add-repo or choose a configured repo target.",
			});
		}

		for (const repo of repos) {
			if (repo.mode === "ghes-api") {
				checks.push(...(await ghesRepoChecks(repo, context.env)));
				continue;
			}
			const status = await repoCache.getStatus({
				repoId: repo.repoId,
				mode: repo.mode,
				git: repo.git,
				workspace: {
					rootPath: repo.git?.localPath ?? context.cwd,
					packageGlobs: repo.workspace.packageGlobs,
					packageManifestFiles: repo.workspace.packageManifestFiles,
				},
				topology: repo.topology.map((rule) => ({
					id: rule.id,
					kind: rule.kind,
					match: {
						include: [...rule.match.include],
						...(rule.match.exclude === undefined
							? {}
							: { exclude: [...rule.match.exclude] }),
					},
					ownership: {
						attachTo: rule.ownership.attachTo,
						...(rule.ownership.deriveFromPath === undefined
							? {}
							: { deriveFromPath: rule.ownership.deriveFromPath }),
						...(rule.ownership.packageRootPattern === undefined
							? {}
							: { packageRootPattern: rule.ownership.packageRootPattern }),
						...(rule.ownership.moduleRootPattern === undefined
							? {}
							: { moduleRootPattern: rule.ownership.moduleRootPattern }),
						...(rule.ownership.skillPattern === undefined
							? {}
							: { skillPattern: rule.ownership.skillPattern }),
					},
					authority: rule.authority,
					priority: rule.priority,
				})),
			});
			checks.push({
				name: `repo:${repo.repoId}`,
				layer: "local-git-cache",
				status: status.initialized ? "pass" : status.exists ? "warn" : "warn",
				message: status.initialized
					? `Cache ready at ${status.localPath}`
					: status.exists
						? `Path exists but is not initialized as a git cache: ${status.localPath}`
						: `Cache path missing: ${status.localPath}`,
				nextAction: status.initialized
					? undefined
					: "Run atlas sync or atlas build to initialize cache/source state.",
			});
		}
		const exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
		return renderSuccess(
			context,
			"doctor",
			checks,
			[
				"Checks runtime config, DB, local-git cache, and server readiness; does not run build.",
				...checks.map(
					(check) =>
						`${check.status.toUpperCase()} [${check.layer}] ${check.name}: ${check.message}${check.nextAction ? ` Next: ${check.nextAction}` : ""}`,
				),
			],
			exitCode,
		);
	} finally {
		if (db.ok) {
			db.close();
		}
	}
}

function tryOpenStore(
	path: string,
): { ok: true; close(): void } | { ok: false; message: string } {
	try {
		const db = openStore({ path, migrate: true });
		return {
			ok: true,
			close() {
				db.close();
			},
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error ? error.message : `Failed to open ${path}.`,
		};
	}
}

function serverEnvCheck(context: CliCommandContext): DoctorCheck {
	try {
		const env = loadServerEnv(context.env);
		return {
			name: "server-env",
			layer: "server-readiness",
			status: "pass",
			message: `HTTP ${env.host}:${env.port}, OpenAPI ${env.enableOpenApi ? "enabled" : "disabled"}, MCP ${env.enableMcp ? "enabled" : "disabled"}.`,
		};
	} catch (error) {
		return {
			name: "server-env",
			layer: "server-readiness",
			status: "fail",
			message:
				error instanceof Error
					? error.message
					: "Failed to load server environment.",
			nextAction:
				"Fix server environment variables or disable affected runtime surface.",
		};
	}
}

async function cacheDirectoryCheck(cacheDir: string): Promise<DoctorCheck> {
	try {
		const details = await stat(cacheDir);
		return details.isDirectory()
			? {
					name: "cache-dir",
					layer: "local-git-cache",
					status: "pass",
					message: `Cache directory ready at ${cacheDir}.`,
				}
			: {
					name: "cache-dir",
					layer: "local-git-cache",
					status: "fail",
					message: `Cache path exists but is not a directory: ${cacheDir}`,
					nextAction: "Fix cacheDir path or remove non-directory path.",
				};
	} catch {
		return {
			name: "cache-dir",
			layer: "local-git-cache",
			status: "warn",
			message: `Cache directory does not exist yet: ${cacheDir}`,
			nextAction:
				"Run atlas setup, atlas add-repo, atlas sync, or atlas build to create cache state.",
		};
	}
}

async function checkGit(): Promise<{ ok: boolean; message: string }> {
	try {
		const { exitCode, stdout, stderr } = await runProcess(["git", "--version"]);
		return exitCode === 0
			? { ok: true, message: stdout.trim() }
			: { ok: false, message: stderr.trim() || "git --version failed." };
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error ? error.message : "git executable unavailable",
		};
	}
}

async function ghesRepoChecks(
	repo: AtlasRepoConfig,
	env: NodeJS.ProcessEnv,
): Promise<DoctorCheck[]> {
	const github = repo.github;
	if (repo.mode !== "ghes-api" || github === undefined) {
		return [];
	}

	const checks: DoctorCheck[] = [];
	const safeRepo = `${github.owner}/${github.name}`;
	let baseUrl: string;
	try {
		baseUrl = normalizeBaseUrl(github.baseUrl);
		checks.push({
			name: `repo:${repo.repoId}:ghes-config`,
			layer: "runtime-config",
			status: "pass",
			message: `GHES API source configured for ${safeRepo} at ${baseUrl}.`,
		});
	} catch (error) {
		checks.push({
			name: `repo:${repo.repoId}:ghes-config`,
			layer: "runtime-config",
			status: "fail",
			message:
				error instanceof Error ? error.message : "Invalid GHES base URL.",
			nextAction: "Fix GHES base URL in config.",
		});
		return checks;
	}

	const auth = await resolveGhesToken(repo, { env });
	if (auth === undefined) {
		checks.push({
			name: `repo:${repo.repoId}:ghes-auth`,
			layer: "runtime-config",
			status: "fail",
			message: `No GHES token found. Set ${github.tokenEnvVar ?? "GHES_TOKEN"}, GH_ENTERPRISE_TOKEN, GH_TOKEN, GITHUB_TOKEN, or run gh auth login --hostname ${new URL(baseUrl).hostname}.`,
			nextAction: "Provide GHES auth token or run gh auth login.",
		});
		return checks;
	}
	checks.push({
		name: `repo:${repo.repoId}:ghes-auth`,
		layer: "runtime-config",
		status: "pass",
		message:
			auth.source === "env"
				? `Using GHES token from ${auth.sourceName}.`
				: `Using GHES token from ${auth.sourceName}.`,
	});

	const client = new GhesClient({
		baseUrl,
		auth: { kind: "token", token: auth.token },
		fetch: timeoutFetch,
	});
	try {
		const response = await client.request<{ sha?: unknown }>({
			path: `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.name)}/commits/${encodeURIComponent(github.ref)}`,
			operation: "doctorResolveRef",
			repoId: repo.repoId,
		});
		checks.push({
			name: `repo:${repo.repoId}:ghes-ref`,
			layer: "source-cache",
			status: typeof response.data.sha === "string" ? "pass" : "fail",
			message:
				typeof response.data.sha === "string"
					? `Resolved ${safeRepo}@${github.ref} to ${response.data.sha}.`
					: `GHES responded but did not include a commit SHA for ${safeRepo}@${github.ref}.`,
		});
	} catch (error) {
		checks.push(renderGhesFailure(repo.repoId, safeRepo, github.ref, error));
	}

	return checks;
}

async function timeoutFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	return fetch(input, {
		...init,
		signal: AbortSignal.timeout(10_000),
	});
}

function renderGhesFailure(
	repoId: string,
	safeRepo: string,
	ref: string,
	error: unknown,
): DoctorCheck {
	if (error instanceof GhesAuthenticationError) {
		return {
			name: `repo:${repoId}:ghes-ref`,
			layer: "source-cache",
			status: "fail",
			message: `GHES rejected authentication or repo permissions for ${safeRepo}@${ref}.`,
			nextAction: "Check GHES token permissions and repo access.",
		};
	}
	if (error instanceof GhesRequestError) {
		const status = error.context.status;
		return {
			name: `repo:${repoId}:ghes-ref`,
			layer: "source-cache",
			status: status === undefined ? "warn" : "fail",
			message:
				status === undefined
					? `Unable to reach GHES for ${safeRepo}@${ref}; check VPN, DNS, proxy, or CA trust.`
					: `GHES returned HTTP ${status} for ${safeRepo}@${ref}.`,
		};
	}
	return {
		name: `repo:${repoId}:ghes-ref`,
		layer: "source-cache",
		status: "warn",
		message:
			error instanceof Error
				? `Unable to reach GHES for ${safeRepo}@${ref}: ${error.message}`
				: `Unable to reach GHES for ${safeRepo}@${ref}.`,
	};
}
