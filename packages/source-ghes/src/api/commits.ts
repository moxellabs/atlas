import type { SourceChange } from "@atlas/core";

import type { GhesClient } from "../client/ghes-client";
import { paginateRequest } from "../client/pagination";
import { GhesDiffError, GhesRevisionResolutionError } from "../errors";

export interface GhesCommitResponse {
	sha: string;
	commit: {
		tree: {
			sha: string;
		};
	};
}

export interface GhesCompareFile {
	filename: string;
	status:
		| "added"
		| "removed"
		| "modified"
		| "renamed"
		| "copied"
		| "changed"
		| "unchanged";
	previous_filename?: string | undefined;
}

export interface GhesCompareResponse {
	status: string;
	total_commits: number;
	files?: GhesCompareFile[] | undefined;
}

export interface ResolveCommitOptions {
	client: GhesClient;
	repoId: string;
	owner: string;
	repoName: string;
	ref: string;
}

export interface CompareCommitsOptions {
	client: GhesClient;
	repoId: string;
	owner: string;
	repoName: string;
	from: string;
	to: string;
}

export async function resolveCommit(
	options: ResolveCommitOptions,
): Promise<GhesCommitResponse> {
	try {
		const response = await options.client.request<GhesCommitResponse>({
			path: `/repos/${encodeSegment(options.owner)}/${encodeSegment(options.repoName)}/commits/${encodeSegment(options.ref)}`,
			operation: "resolveCommit",
			repoId: options.repoId,
		});
		validateCommit(response.data, options);
		return response.data;
	} catch (cause) {
		if (cause instanceof GhesRevisionResolutionError) {
			throw cause;
		}
		throw new GhesRevisionResolutionError({
			repoId: options.repoId,
			owner: options.owner,
			repoName: options.repoName,
			ref: options.ref,
			operation: "resolveCommit",
			cause,
		});
	}
}

export async function compareCommits(
	options: CompareCommitsOptions,
): Promise<SourceChange[]> {
	try {
		const files = await paginateRequest<GhesCompareFile>(
			options.client,
			{
				path: `/repos/${encodeSegment(options.owner)}/${encodeSegment(options.repoName)}/compare/${encodeSegment(options.from)}...${encodeSegment(options.to)}`,
				query: { per_page: 100 },
				operation: "compareCommits",
				repoId: options.repoId,
			},
			(data) => readCompareFiles(data, options),
		);
		return files.map((file) => toSourceChange(file, options));
	} catch (cause) {
		if (cause instanceof GhesDiffError) {
			throw cause;
		}
		throw new GhesDiffError({
			repoId: options.repoId,
			owner: options.owner,
			repoName: options.repoName,
			operation: "compareCommits",
			cause,
		});
	}
}

function validateCommit(
	value: GhesCommitResponse,
	context: ResolveCommitOptions,
): void {
	if (
		!value ||
		typeof value.sha !== "string" ||
		typeof value.commit?.tree?.sha !== "string"
	) {
		throw new GhesRevisionResolutionError({
			repoId: context.repoId,
			owner: context.owner,
			repoName: context.repoName,
			ref: context.ref,
			operation: "validateCommit",
			message: "Unexpected GHES commit response shape.",
		});
	}
}

function readCompareFiles(
	data: unknown,
	context: CompareCommitsOptions,
): GhesCompareFile[] {
	const compare = data as GhesCompareResponse;
	if (!compare || !Array.isArray(compare.files)) {
		throw new GhesDiffError({
			repoId: context.repoId,
			owner: context.owner,
			repoName: context.repoName,
			operation: "readCompareFiles",
			message: "GHES compare response did not include file metadata.",
		});
	}
	return compare.files;
}

function toSourceChange(
	file: GhesCompareFile,
	context: CompareCommitsOptions,
): SourceChange {
	if (typeof file.filename !== "string" || file.filename.length === 0) {
		throw new GhesDiffError({
			repoId: context.repoId,
			owner: context.owner,
			repoName: context.repoName,
			operation: "toSourceChange",
			message: "GHES compare file was missing filename.",
		});
	}

	if (file.status === "renamed") {
		if (!file.previous_filename) {
			throw new GhesDiffError({
				repoId: context.repoId,
				owner: context.owner,
				repoName: context.repoName,
				path: file.filename,
				operation: "toSourceChange",
				message: "GHES renamed file was missing previous_filename.",
			});
		}
		return {
			rawKind: "renamed",
			normalizedKind: "renamed",
			path: normalizePath(file.filename, context),
			oldPath: normalizePath(file.previous_filename, context),
		};
	}

	if (file.status === "copied") {
		if (!file.previous_filename) {
			throw new GhesDiffError({
				repoId: context.repoId,
				owner: context.owner,
				repoName: context.repoName,
				path: file.filename,
				operation: "toSourceChange",
				message: "GHES copied file was missing previous_filename.",
			});
		}
		return {
			rawKind: "copied",
			normalizedKind: "modified",
			path: normalizePath(file.filename, context),
			oldPath: normalizePath(file.previous_filename, context),
		};
	}

	const statusMap = {
		added: { rawKind: "added", normalizedKind: "added" },
		removed: { rawKind: "deleted", normalizedKind: "deleted" },
		modified: { rawKind: "modified", normalizedKind: "modified" },
		changed: { rawKind: "type-changed", normalizedKind: "modified" },
		unchanged: { rawKind: "modified", normalizedKind: "modified" },
	} as const;
	const mapped = statusMap[file.status];
	if (!mapped) {
		throw new GhesDiffError({
			repoId: context.repoId,
			owner: context.owner,
			repoName: context.repoName,
			path: file.filename,
			operation: "toSourceChange",
			message: `Unsupported GHES compare status: ${file.status}.`,
		});
	}
	return {
		path: normalizePath(file.filename, context),
		...mapped,
	};
}

function normalizePath(path: string, context: CompareCommitsOptions): string {
	const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+/, "");
	if (
		normalizedPath.length === 0 ||
		normalizedPath === ".." ||
		normalizedPath.startsWith("../") ||
		normalizedPath.includes("/../")
	) {
		throw new GhesDiffError({
			repoId: context.repoId,
			owner: context.owner,
			repoName: context.repoName,
			path,
			operation: "toSourceChange",
			message: "GHES compare path must be repository-relative.",
		});
	}
	return normalizedPath;
}

function encodeSegment(value: string): string {
	return encodeURIComponent(value);
}
