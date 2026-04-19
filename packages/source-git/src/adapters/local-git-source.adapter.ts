import { access, opendir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
	FileEntry,
	RepoConfig,
	RepoRevision,
	RepoSourceAdapter,
	SourceChange,
	SourceFile,
} from "@atlas/core";
import type { RepoCacheServiceOptions } from "../cache/repo-cache.service";
import {
	RepoCacheService,
	requireLocalGitRepo,
} from "../cache/repo-cache.service";
import type { SourceGitDiagnosticSink } from "../diagnostics";
import { diffPaths } from "../diff/diff-paths";
import { GitReadFileError } from "../git/git-errors";

/** Options for the local Git source adapter. */
export interface LocalGitSourceAdapterOptions extends RepoCacheServiceOptions {
	/** Cache service override for tests or higher-level composition. */
	cacheService?: RepoCacheService | undefined;
}

/** Source adapter backed by persistent local Git caches. */
export class LocalGitSourceAdapter implements RepoSourceAdapter {
	readonly #cacheService: RepoCacheService;
	readonly #gitTimeoutMs: number | undefined;
	readonly #onDiagnostic: SourceGitDiagnosticSink | undefined;

	constructor(options: LocalGitSourceAdapterOptions = {}) {
		this.#cacheService = options.cacheService ?? new RepoCacheService(options);
		this.#gitTimeoutMs = options.gitTimeoutMs;
		this.#onDiagnostic = options.onDiagnostic;
	}

	/**
	 * Ensures the managed cache exists and returns the current configured-ref
	 * revision as the core adapter contract expects.
	 */
	async getRevision(repo: RepoConfig): Promise<RepoRevision> {
		const git = requireLocalGitRepo(repo);
		const ensured = await this.#cacheService.ensureCache(repo);
		if (!ensured.status.currentRevision) {
			throw new GitReadFileError({
				repoId: repo.repoId,
				localPath: git.localPath,
			});
		}
		return {
			repoId: repo.repoId,
			ref: git.ref,
			revision: ensured.status.currentRevision,
		};
	}

	/**
	 * Lists materialized files from the managed checkout, excluding `.git`.
	 */
	async listFiles(repo: RepoConfig): Promise<FileEntry[]> {
		const git = requireLocalGitRepo(repo);
		await this.#cacheService.ensureCache(repo);
		return listMaterializedFiles(git.localPath);
	}

	/**
	 * Reads a UTF-8 file from the materialized checkout. This initializes a
	 * missing cache but never fetches remote updates during the read.
	 */
	async readFile(repo: RepoConfig, path: string): Promise<SourceFile> {
		const git = requireLocalGitRepo(repo);
		await this.#cacheService.ensureCache(repo);

		const normalizedPath = normalizeRelativePath(path);
		const filePath = resolveRepoPath(
			git.localPath,
			normalizedPath,
			repo.repoId,
		);
		try {
			await access(filePath);
			return {
				path: normalizedPath,
				content: await readFile(filePath, "utf8"),
			};
		} catch (cause) {
			if (cause instanceof GitReadFileError) {
				throw cause;
			}
			throw new GitReadFileError({
				repoId: repo.repoId,
				localPath: git.localPath,
				relativePath: normalizedPath,
				cause,
			});
		}
	}

	/**
	 * Computes changed paths between two revisions and maps Git statuses to the
	 * core adapter's stable path-diff vocabulary.
	 */
	async diffPaths(
		repo: RepoConfig,
		from: string,
		to: string,
	): Promise<SourceChange[]> {
		const git = requireLocalGitRepo(repo);
		await this.#cacheService.ensureCache(repo);
		const paths = await diffPaths({
			repoId: repo.repoId,
			localPath: git.localPath,
			fromRevision: from,
			toRevision: to,
			timeoutMs: this.#gitTimeoutMs,
			onDiagnostic: this.#onDiagnostic,
		});
		return paths;
	}
}

/**
 * Lists checkout files using local filesystem traversal and returns stable,
 * repository-relative POSIX paths.
 */
export async function listMaterializedFiles(
	rootPath: string,
): Promise<FileEntry[]> {
	const entries: FileEntry[] = [];
	await walkDirectory(rootPath, rootPath, entries);
	entries.sort((left, right) => left.path.localeCompare(right.path));
	return entries;
}

async function walkDirectory(
	rootPath: string,
	directoryPath: string,
	entries: FileEntry[],
): Promise<void> {
	const directory = await opendir(directoryPath);
	for await (const entry of directory) {
		if (entry.name === ".git") {
			continue;
		}

		const absolutePath = join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			await walkDirectory(rootPath, absolutePath, entries);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		entries.push({
			path: normalizeRelativePath(relative(rootPath, absolutePath)),
			type: "file",
		});
	}
}

function resolveRepoPath(
	rootPath: string,
	normalizedPath: string,
	repoId: string,
): string {
	if (
		normalizedPath.startsWith("../") ||
		normalizedPath === ".." ||
		normalizedPath.length === 0
	) {
		throw new GitReadFileError({
			repoId,
			localPath: rootPath,
			relativePath: normalizedPath,
		});
	}

	const absoluteRoot = resolve(rootPath);
	const absolutePath = resolve(absoluteRoot, normalizedPath);
	const relativePath = relative(absoluteRoot, absolutePath);
	if (
		relativePath.startsWith("..") ||
		relativePath === "" ||
		resolve(relativePath) === absolutePath
	) {
		throw new GitReadFileError({
			repoId,
			localPath: rootPath,
			relativePath: normalizedPath,
		});
	}

	return absolutePath;
}

function normalizeRelativePath(path: string): string {
	return path.split(sep).join("/").replaceAll("\\", "/");
}
