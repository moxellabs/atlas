import { describe, expect, test } from "bun:test";
import type { RepoConfig } from "@atlas/core";

import { GhesSourceAdapter } from "./adapters/ghes-source.adapter";
import { decodeBlobContent } from "./api/blobs";
import { buildAuthHeaders, describeAuth } from "./client/auth";
import type { GhesFetch } from "./client/ghes-client";
import { normalizeBaseUrl } from "./client/ghes-client";
import { parseLinkHeader } from "./client/pagination";
import { GhesBlobReadError, GhesTreeReadError } from "./errors";

describe("source-ghes", () => {
	test("builds bearer token auth headers without exposing token policy elsewhere", () => {
		expect(buildAuthHeaders({ kind: "token", token: "token-123" })).toEqual({
			authorization: "Bearer token-123",
		});
	});

	test("describes token auth without exposing token values", () => {
		const auth = { kind: "token" as const, token: "redaction-canary-value" };

		expect(describeAuth(auth)).toEqual({ kind: "token" });
		expect(JSON.stringify(describeAuth(auth))).not.toContain(
			"redaction-canary-value",
		);
		expect(buildAuthHeaders(auth)).toEqual({
			authorization: "Bearer redaction-canary-value",
		});
		expect(() => buildAuthHeaders({ kind: "token", token: "   " })).toThrow(
			"GitHub Enterprise authentication failed.",
		);
		const thrown = stringifyThrown(() =>
			buildAuthHeaders({ kind: "token", token: "   " }),
		);
		expect(thrown).not.toContain("redaction-canary-value");
		expect(thrown).not.toContain("Bearer");
	});

	test("normalizes explicit GHES REST base URLs", () => {
		expect(normalizeBaseUrl("https://ghe.example.com/api/v3/")).toBe(
			"https://ghe.example.com/api/v3",
		);
	});

	test("parses GitHub pagination Link headers", () => {
		expect(
			parseLinkHeader(
				'<https://ghe.example.com/api/v3/items?page=2>; rel="next", <https://ghe.example.com/api/v3/items?page=5>; rel="last"',
			),
		).toEqual({
			next: "https://ghe.example.com/api/v3/items?page=2",
			last: "https://ghe.example.com/api/v3/items?page=5",
		});
	});

	test("decodes base64 blob payloads deterministically", () => {
		expect(
			decodeBlobContent(
				{
					sha: "blob-sha",
					size: 12,
					url: "https://ghe.example.com/blob",
					content: Buffer.from("hello docs\n", "utf8").toString("base64"),
					encoding: "base64",
				},
				{
					repoId: "atlas-ghes",
					owner: "moxellabs",
					repoName: "atlas",
					sha: "blob-sha",
					path: "docs/index.md",
				},
			),
		).toBe("hello docs\n");
	});

	test("rejects unsupported blob encodings", () => {
		expect(() =>
			decodeBlobContent(
				{
					sha: "blob-sha",
					size: 12,
					url: "https://ghe.example.com/blob",
					content: "hello",
					encoding: "utf-8",
				},
				{
					repoId: "atlas-ghes",
					owner: "moxellabs",
					repoName: "atlas",
					sha: "blob-sha",
					path: "docs/index.md",
				},
			),
		).toThrow(GhesBlobReadError);
	});

	test("implements revision, tree listing, file reads, and compare diffs through mocked GHES REST", async () => {
		const adapter = new GhesSourceAdapter({
			auth: { kind: "token", token: "test-token" },
			fetch: buildMockFetch(),
		});

		await expect(adapter.getRevision(repo)).resolves.toEqual({
			repoId: "atlas-ghes",
			ref: "main",
			revision: "1111111111111111111111111111111111111111",
		});
		await expect(adapter.listFiles(repo)).resolves.toEqual([
			{ path: "docs", type: "dir" },
			{ path: "docs/index.md", type: "file" },
			{ path: "packages/auth/package.json", type: "file" },
		]);
		await expect(adapter.readFile(repo, "docs/index.md")).resolves.toEqual({
			path: "docs/index.md",
			content: "# Index\n",
		});
		await expect(
			adapter.diffPaths(
				repo,
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			),
		).resolves.toEqual([
			{
				rawKind: "modified",
				normalizedKind: "modified",
				path: "docs/index.md",
			},
			{
				rawKind: "renamed",
				normalizedKind: "renamed",
				path: "docs/new.md",
				oldPath: "docs/old.md",
			},
		]);
	});

	test("caches commit and tree lookups across repeated file operations", async () => {
		const requestCounts = new Map<string, number>();
		const fetch = buildMockFetch();
		const countingFetch: GhesFetch = async (input, init) => {
			const url = new URL(String(input));
			requestCounts.set(url.pathname, (requestCounts.get(url.pathname) ?? 0) + 1);
			return fetch(input, init);
		};
		const adapter = new GhesSourceAdapter({
			auth: { kind: "token", token: "test-token" },
			fetch: countingFetch,
		});

		await expect(adapter.listFiles(repo)).resolves.toHaveLength(3);
		await expect(adapter.readFile(repo, "docs/index.md")).resolves.toEqual({
			path: "docs/index.md",
			content: "# Index\n",
		});
		await expect(adapter.listFiles(repo)).resolves.toHaveLength(3);
		await expect(adapter.readFile(repo, "docs/index.md")).resolves.toEqual({
			path: "docs/index.md",
			content: "# Index\n",
		});

		expect(requestCounts.get("/api/v3/repos/moxellabs/atlas/commits/main")).toBe(1);
		expect(requestCounts.get("/api/v3/repos/moxellabs/atlas/git/trees/tree-sha")).toBe(1);
		expect(requestCounts.get("/api/v3/repos/moxellabs/atlas/git/blobs/blob-sha")).toBe(2);
	});

	test("rejects truncated tree responses instead of returning partial file lists", async () => {
		const adapter = new GhesSourceAdapter({
			auth: { kind: "token", token: "test-token" },
			fetch: buildMockFetch({ truncatedTree: true }),
		});

		await expect(adapter.listFiles(repo)).rejects.toThrow(GhesTreeReadError);
	});
});

const repo: RepoConfig = {
	repoId: "atlas-ghes",
	mode: "ghes-api",
	github: {
		baseUrl: "https://ghe.example.com/api/v3",
		owner: "moxellabs",
		name: "atlas",
		ref: "main",
	},
	workspace: {
		rootPath: ".",
		packageGlobs: ["packages/*"],
		packageManifestFiles: ["package.json"],
	},
	topology: [
		{
			id: "docs",
			kind: "repo-doc",
			match: { include: ["docs/**/*.md"] },
			ownership: { attachTo: "repo" },
			authority: "canonical",
			priority: 10,
		},
	],
};

function buildMockFetch(
	options: { truncatedTree?: boolean | undefined } = {},
): GhesFetch {
	return async (input) => {
		const url = new URL(String(input));
		const path = url.pathname;
		if (path === "/api/v3/repos/moxellabs/atlas/commits/main") {
			return jsonResponse({
				sha: "1111111111111111111111111111111111111111",
				commit: { tree: { sha: "tree-sha" } },
			});
		}
		if (path === "/api/v3/repos/moxellabs/atlas/git/trees/tree-sha") {
			return jsonResponse({
				sha: "tree-sha",
				truncated: options.truncatedTree === true,
				tree: [
					{
						path: "docs",
						mode: "040000",
						type: "tree",
						sha: "dir-sha",
						url: "https://ghe.example.com/tree/docs",
					},
					{
						path: "docs/index.md",
						mode: "100644",
						type: "blob",
						sha: "blob-sha",
						size: 8,
						url: "https://ghe.example.com/blob",
					},
					{
						path: "packages/auth/package.json",
						mode: "100644",
						type: "blob",
						sha: "pkg-sha",
						size: 2,
						url: "https://ghe.example.com/blob2",
					},
				],
			});
		}
		if (path === "/api/v3/repos/moxellabs/atlas/git/blobs/blob-sha") {
			return jsonResponse({
				sha: "blob-sha",
				size: 8,
				url: "https://ghe.example.com/blob",
				content: Buffer.from("# Index\n", "utf8").toString("base64"),
				encoding: "base64",
			});
		}
		if (
			path ===
			"/api/v3/repos/moxellabs/atlas/compare/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		) {
			return jsonResponse({
				status: "ahead",
				total_commits: 1,
				files: [
					{ filename: "docs/index.md", status: "modified" },
					{
						filename: "docs/new.md",
						previous_filename: "docs/old.md",
						status: "renamed",
					},
				],
			});
		}
		return jsonResponse({ message: `Unhandled path: ${path}` }, 404);
	};
}

function stringifyThrown(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		return String(error);
	}
	return "";
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});
}
