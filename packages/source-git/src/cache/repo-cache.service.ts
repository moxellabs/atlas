import { stat } from "node:fs/promises";
import type { RepoConfig } from "@atlas/core";
import type {
	SourceGitDiagnosticEvent,
	SourceGitDiagnosticSink,
} from "../diagnostics";
import { recordDiagnostic } from "../diagnostics";
import {
	GitInvalidRepositoryError,
	GitUnsupportedRepoModeError,
} from "../git/git-errors";
import type { FetchUpdatesResult } from "./fetch-updates";
import {
	fetchUpdates,
	resolveCurrentCheckoutRevision,
	resolveCurrentRevision,
} from "./fetch-updates";
import {
	checkoutCloneRef,
	ensurePartialClone,
	isGitRepoPath,
} from "./partial-clone";
import type { SparseCheckoutResult } from "./sparse-checkout";
import { applySparseCheckout } from "./sparse-checkout";

/** Structured lifecycle event emitted by cache operations. */
export type RepoCacheDiagnosticEvent = SourceGitDiagnosticEvent;

/** Status summary for a managed local Git cache. */
export interface RepoCacheStatus {
	/** ATLAS repo identifier. */
	repoId: string;
	/** Persistent local checkout path. */
	localPath: string;
	/** True when the configured path exists. */
	exists: boolean;
	/** True when Git recognizes the path as a work tree. */
	initialized: boolean;
	/** Current HEAD revision, if resolvable. */
	currentRevision?: string | undefined;
	/** Configured target ref. */
	targetRef: string;
	/** Result of the latest fetch performed by this service call. */
	lastFetchSucceeded?: boolean | undefined;
}

/** Result returned after ensuring a repo cache exists. */
export interface EnsureRepoCacheResult {
	/** Cache status after the operation. */
	status: RepoCacheStatus;
	/** True when this operation performed the initial clone. */
	cloned: boolean;
	/** Sparse-checkout result when patterns were provided. */
	sparseCheckout: SparseCheckoutResult;
	/** Diagnostic events collected during the operation. */
	diagnostics: RepoCacheDiagnosticEvent[];
}

/** Result returned after updating an existing repo cache. */
export interface UpdateRepoCacheResult {
	/** Cache status after the update attempt. */
	status: RepoCacheStatus;
	/** Fetch result for the configured ref. */
	update: FetchUpdatesResult;
	/** Sparse-checkout result after pattern reconciliation. */
	sparseCheckout: SparseCheckoutResult;
	/** Diagnostic events collected during the operation. */
	diagnostics: RepoCacheDiagnosticEvent[];
}

/** Options used to construct a repo cache service. */
export interface RepoCacheServiceOptions {
	/** Static sparse patterns or a resolver invoked per repo. Empty means no sparse checkout. */
	sparsePaths?:
		| readonly string[]
		| ((repo: RepoConfig) => readonly string[])
		| undefined;
	/** Optional timeout applied to Git commands launched by this service. */
	gitTimeoutMs?: number | undefined;
	/** Optional sink for streaming structured diagnostics to CLI/server layers. */
	onDiagnostic?: SourceGitDiagnosticSink | undefined;
}

/** Coordinates persistent clone, sparse-checkout, fetch, and status behavior. */
export class RepoCacheService {
	readonly #options: RepoCacheServiceOptions;

	constructor(options: RepoCacheServiceOptions = {}) {
		this.#options = options;
	}

	/**
	 * Ensures the configured local-git cache exists and is checked out at the
	 * configured ref. Reads are not fetched implicitly by this method.
	 */
	async ensureCache(repo: RepoConfig): Promise<EnsureRepoCacheResult> {
		const git = requireLocalGitRepo(repo);
		const diagnostics: RepoCacheDiagnosticEvent[] = [];
		if (isCurrentCheckoutMode(git)) {
			const exists = await this.#pathExists(git.localPath);
			if (!exists || !(await isGitRepoPath(git.localPath))) {
				throw new GitInvalidRepositoryError({
					repoId: repo.repoId,
					localPath: git.localPath,
				});
			}
			this.#record(
				diagnostics,
				event("cache_validated", repo.repoId, git.localPath, {
					refMode: "current-checkout",
				}),
			);
			const sparseCheckout = { enabled: false, patterns: [] };
			this.#record(
				diagnostics,
				event("sparse_checkout_disabled", repo.repoId, git.localPath),
			);
			return {
				status: await this.getStatus(repo),
				cloned: false,
				sparseCheckout,
				diagnostics,
			};
		}

		const existedBefore = await this.#pathExists(git.localPath);

		if (!existedBefore) {
			this.#record(
				diagnostics,
				event("clone_started", repo.repoId, git.localPath),
			);
		}

		const clone = await ensurePartialClone({
			repoId: repo.repoId,
			remote: git.remote,
			localPath: git.localPath,
			ref: git.ref,
			timeoutMs: this.#options.gitTimeoutMs,
		});

		if (clone.cloned) {
			this.#record(
				diagnostics,
				event("clone_completed", repo.repoId, git.localPath),
			);
		} else {
			this.#record(
				diagnostics,
				event("cache_validated", repo.repoId, git.localPath),
			);
		}

		const sparseCheckout = await applySparseCheckout({
			repoId: repo.repoId,
			localPath: git.localPath,
			patterns: this.#resolveSparsePaths(repo),
			timeoutMs: this.#options.gitTimeoutMs,
		});

		if (sparseCheckout.enabled) {
			this.#record(
				diagnostics,
				event("sparse_checkout_applied", repo.repoId, git.localPath, {
					patternCount: sparseCheckout.patterns.length,
				}),
			);
		} else {
			this.#record(
				diagnostics,
				event("sparse_checkout_disabled", repo.repoId, git.localPath),
			);
		}

		if (clone.cloned) {
			await checkoutCloneRef({
				repoId: repo.repoId,
				remote: git.remote,
				localPath: git.localPath,
				ref: git.ref,
				timeoutMs: this.#options.gitTimeoutMs,
			});
		}

		return {
			status: await this.getStatus(repo),
			cloned: clone.cloned,
			sparseCheckout,
			diagnostics,
		};
	}

	/**
	 * Fetches the configured ref incrementally and reapplies sparse-checkout
	 * patterns after the cache is present.
	 */
	async updateCache(repo: RepoConfig): Promise<UpdateRepoCacheResult> {
		const git = requireLocalGitRepo(repo);
		const ensureResult = await this.ensureCache(repo);
		const diagnostics = [...ensureResult.diagnostics];
		if (isCurrentCheckoutMode(git)) {
			const currentRevision = await resolveCurrentCheckoutRevision({
				repoId: repo.repoId,
				localPath: git.localPath,
				ref: git.ref,
				timeoutMs: this.#options.gitTimeoutMs,
			});
			const update = {
				previousRevision: currentRevision,
				currentRevision,
				changed: false,
			};
			this.#record(
				diagnostics,
				event("revision_unchanged", repo.repoId, git.localPath, update),
			);
			return {
				status: await this.getStatus(repo),
				update,
				sparseCheckout: ensureResult.sparseCheckout,
				diagnostics,
			};
		}
		this.#record(
			diagnostics,
			event("fetch_started", repo.repoId, git.localPath),
		);

		const update = await fetchUpdates({
			repoId: repo.repoId,
			localPath: git.localPath,
			ref: git.ref,
			timeoutMs: this.#options.gitTimeoutMs,
		});

		this.#record(
			diagnostics,
			event("fetch_completed", repo.repoId, git.localPath, {
				changed: update.changed,
			}),
		);
		this.#record(
			diagnostics,
			event(
				update.changed ? "revision_changed" : "revision_unchanged",
				repo.repoId,
				git.localPath,
				{
					previousRevision: update.previousRevision,
					currentRevision: update.currentRevision,
				},
			),
		);

		const sparseCheckout = await applySparseCheckout({
			repoId: repo.repoId,
			localPath: git.localPath,
			patterns: this.#resolveSparsePaths(repo),
			timeoutMs: this.#options.gitTimeoutMs,
		});

		return {
			status: {
				...(await this.getStatus(repo)),
				lastFetchSucceeded: true,
			},
			update,
			sparseCheckout,
			diagnostics,
		};
	}

	/**
	 * Reads cache status without cloning or fetching.
	 */
	async getStatus(repo: RepoConfig): Promise<RepoCacheStatus> {
		const git = requireLocalGitRepo(repo);
		const exists = await this.#pathExists(git.localPath);
		const initialized = exists ? await isGitRepoPath(git.localPath) : false;

		let currentRevision: string | undefined;
		if (initialized) {
			const resolver = isCurrentCheckoutMode(git)
				? resolveCurrentCheckoutRevision
				: resolveCurrentRevision;
			currentRevision = await resolver({
				repoId: repo.repoId,
				localPath: git.localPath,
				ref: git.ref,
				timeoutMs: this.#options.gitTimeoutMs,
			}).catch(() => undefined);
		}

		return {
			repoId: repo.repoId,
			localPath: git.localPath,
			exists,
			initialized,
			currentRevision,
			targetRef: git.ref,
		};
	}

	#resolveSparsePaths(repo: RepoConfig): readonly string[] {
		if (!this.#options.sparsePaths) {
			return [];
		}
		return typeof this.#options.sparsePaths === "function"
			? this.#options.sparsePaths(repo)
			: this.#options.sparsePaths;
	}

	#record(
		diagnostics: RepoCacheDiagnosticEvent[],
		diagnostic: RepoCacheDiagnosticEvent,
	): void {
		recordDiagnostic(diagnostics, this.#options.onDiagnostic, diagnostic);
	}

	async #pathExists(path: string): Promise<boolean> {
		try {
			await stat(path);
			return true;
		} catch (cause) {
			if (
				typeof cause === "object" &&
				cause !== null &&
				"code" in cause &&
				(cause as { code?: unknown }).code === "ENOENT"
			) {
				return false;
			}
			throw cause;
		}
	}
}

/**
 * Narrows a RepoConfig to a configured local-git source or raises a structured
 * error for unsupported modes and malformed config values.
 */
export function requireLocalGitRepo(
	repo: RepoConfig,
): NonNullable<RepoConfig["git"]> {
	if (repo.mode !== "local-git" || !repo.git) {
		throw new GitUnsupportedRepoModeError({
			repoId: repo.repoId,
		});
	}
	if (!repo.git.localPath || !repo.git.remote || !repo.git.ref) {
		throw new GitInvalidRepositoryError({
			repoId: repo.repoId,
			localPath: repo.git.localPath,
		});
	}
	return repo.git;
}

function isCurrentCheckoutMode(git: NonNullable<RepoConfig["git"]>): boolean {
	return git.refMode === "current-checkout";
}

export function createRepoCacheDiagnostic(
	type: RepoCacheDiagnosticEvent["type"],
	repoId: string,
	localPath: string,
	details?: Record<string, string | number | boolean>,
): RepoCacheDiagnosticEvent {
	return details
		? { type, repoId, localPath, details }
		: { type, repoId, localPath };
}

function event(
	type: RepoCacheDiagnosticEvent["type"],
	repoId: string,
	localPath: string,
	details?: Record<string, string | number | boolean>,
): RepoCacheDiagnosticEvent {
	return createRepoCacheDiagnostic(type, repoId, localPath, details);
}
