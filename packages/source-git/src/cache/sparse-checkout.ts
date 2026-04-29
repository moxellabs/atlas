import { GitSparseCheckoutError } from "../git/git-errors";
import { spawnGit } from "../git/spawn-git";

/** Options for applying sparse-checkout to a managed repo cache. */
export interface SparseCheckoutOptions {
	/** ATLAS repo identifier used only for diagnostics. */
	repoId: string;
	/** Persistent local checkout path. */
	localPath: string;
	/** Sparse patterns to apply exactly in non-cone mode. Empty disables sparse checkout. */
	patterns: readonly string[];
	/** Optional timeout applied to sparse-checkout Git commands. */
	timeoutMs?: number | undefined;
}

/** Result of sparse-checkout reconciliation. */
export interface SparseCheckoutResult {
	/** True when sparse-checkout is active after this operation. */
	enabled: boolean;
	/** Normalized patterns applied to Git. */
	patterns: string[];
}

/**
 * Applies caller-provided sparse-checkout patterns in non-cone mode. Empty
 * pattern lists intentionally leave the checkout non-sparse.
 */
export async function applySparseCheckout(
	options: SparseCheckoutOptions,
): Promise<SparseCheckoutResult> {
	const patterns = normalizeSparsePatterns(options.patterns);
	if (patterns.length === 0) {
		await runSparseCommand(options, ["sparse-checkout", "disable"], true);
		return {
			enabled: false,
			patterns,
		};
	}

	await runSparseCommand(options, ["sparse-checkout", "init", "--no-cone"]);
	await runSparseCommand(options, [
		"sparse-checkout",
		"set",
		"--no-cone",
		...patterns,
	]);

	return {
		enabled: true,
		patterns,
	};
}

/**
 * Normalizes sparse patterns while preserving caller intent and order.
 */
export async function inspectSparseCheckout(
	options: Omit<SparseCheckoutOptions, "patterns">,
): Promise<SparseCheckoutResult> {
	const enabledResult = await spawnGit({
		cwd: options.localPath,
		args: ["config", "--bool", "core.sparseCheckout"],
		timeoutMs: options.timeoutMs,
	});
	const enabled =
		enabledResult.exitCode === 0 && enabledResult.stdout.trim() === "true";
	if (!enabled) return { enabled: false, patterns: [] };

	const patternsResult = await spawnGit({
		cwd: options.localPath,
		args: ["sparse-checkout", "list"],
		timeoutMs: options.timeoutMs,
	});
	return {
		enabled: true,
		patterns:
			patternsResult.exitCode === 0
				? normalizeSparsePatterns(patternsResult.stdout.split(/\r?\n/))
				: [],
	};
}

export function normalizeSparsePatterns(patterns: readonly string[]): string[] {
	const unique = new Set<string>();
	for (const pattern of patterns) {
		const normalized = pattern.trim().replaceAll("\\", "/");
		if (normalized.length > 0) {
			unique.add(normalized);
		}
	}
	return [...unique];
}

async function runSparseCommand(
	options: SparseCheckoutOptions,
	args: readonly string[],
	allowUnsupportedDisable = false,
): Promise<void> {
	const result = await spawnGit({
		cwd: options.localPath,
		args,
		timeoutMs: options.timeoutMs,
	});

	if (result.exitCode !== 0) {
		if (
			allowUnsupportedDisable &&
			isSparseCheckoutNotInitialized(result.stderr)
		) {
			return;
		}
		throw new GitSparseCheckoutError({
			repoId: options.repoId,
			localPath: options.localPath,
			command: result.command,
			exitCode: result.exitCode,
			stderr: result.stderr,
			stdout: result.stdout,
		});
	}
}

function isSparseCheckoutNotInitialized(stderr: string): boolean {
	return (
		stderr.includes("this worktree is not sparse") ||
		stderr.includes("not in sparse checkout")
	);
}
