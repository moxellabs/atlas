import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoConfig } from "@atlas/core";

import { RepoCacheService } from "../cache/repo-cache.service";
import { diffPaths } from "../diff/diff-paths";
import {
	GitCloneError,
	GitInvalidRepositoryError,
	GitReadFileError,
	GitRefResolutionError,
	GitUnsupportedRepoModeError,
} from "../git/git-errors";
import { spawnGitOrThrow } from "../git/spawn-git";
import { LocalGitSourceAdapter } from "./local-git-source.adapter";

describe("LocalGitSourceAdapter integration", () => {
	let fixtureDir: string;
	let originPath: string;
	let cachePath: string;
	let repo: RepoConfig;

	beforeEach(async () => {
		fixtureDir =
			await Bun.$`mktemp -d ${join(tmpdir(), "atlas-source-git-test-XXXXXX")}`.text();
		fixtureDir = fixtureDir.trim();
		originPath = join(fixtureDir, "origin");
		cachePath = join(fixtureDir, "cache", "identity");
		await createOriginRepo(originPath);
		repo = buildRepoConfig(originPath, cachePath);
	});

	afterEach(async () => {
		await rm(fixtureDir, { recursive: true, force: true });
	});

	test("clones a persistent sparse cache and lists materialized files", async () => {
		const adapter = new LocalGitSourceAdapter({ sparsePaths: ["docs/**"] });

		const revision = await adapter.getRevision(repo);
		const files = await adapter.listFiles(repo);

		expect(revision.repoId).toBe("identity");
		expect(revision.ref).toBe("main");
		expect(revision.revision).toHaveLength(40);
		expect(files.map((file) => file.path)).toEqual(["docs/guide.md"]);
		expect(await Bun.file(join(cachePath, "src", "app.ts")).exists()).toBe(
			false,
		);
	});

	test("disables sparse checkout when patterns are removed", async () => {
		await new LocalGitSourceAdapter({ sparsePaths: ["docs/**"] }).getRevision(
			repo,
		);

		const fullAdapter = new LocalGitSourceAdapter();
		const files = await fullAdapter.listFiles(repo);

		expect(files.map((file) => file.path)).toEqual([
			"docs/guide.md",
			"src/app.ts",
		]);
	});

	test("updates sparse checkout patterns when the materialized roots change", async () => {
		await new LocalGitSourceAdapter({ sparsePaths: ["docs/**"] }).getRevision(
			repo,
		);

		const srcAdapter = new LocalGitSourceAdapter({ sparsePaths: ["src/**"] });
		const files = await srcAdapter.listFiles(repo);

		expect(files.map((file) => file.path)).toEqual(["src/app.ts"]);
		expect(await Bun.file(join(cachePath, "docs", "guide.md")).exists()).toBe(
			false,
		);
	});

	test("reads materialized files without allowing path traversal", async () => {
		const adapter = new LocalGitSourceAdapter({ sparsePaths: ["docs/**"] });

		await expect(
			adapter.readFile(repo, "docs/guide.md"),
		).resolves.toMatchObject({
			path: "docs/guide.md",
			content: "hello docs\n",
		});
		await expect(adapter.readFile(repo, "../outside.md")).rejects.toThrow(
			GitReadFileError,
		);
	});

	test("fetches updates incrementally and computes renamed paths", async () => {
		const service = new RepoCacheService({ sparsePaths: ["docs/**"] });
		const adapter = new LocalGitSourceAdapter({ cacheService: service });
		const firstRevision = (await adapter.getRevision(repo)).revision;

		await renameGuide(originPath);
		const update = await service.updateCache(repo);
		const changedPaths = await diffPaths({
			repoId: repo.repoId,
			localPath: cachePath,
			fromRevision: firstRevision,
			toRevision: update.update.currentRevision,
		});

		expect(update.update.changed).toBe(true);
		expect(changedPaths).toEqual([
			{
				rawKind: "renamed",
				normalizedKind: "renamed",
				oldPath: "docs/guide.md",
				path: "docs/renamed.md",
			},
		]);
		await expect(
			adapter.diffPaths(repo, firstRevision, update.update.currentRevision),
		).resolves.toEqual([
			{
				rawKind: "renamed",
				normalizedKind: "renamed",
				oldPath: "docs/guide.md",
				path: "docs/renamed.md",
			},
		]);
		await expect(
			adapter.readFile(repo, "docs/renamed.md"),
		).resolves.toMatchObject({
			content: "hello docs\n",
		});
	});

	test("reports no-op fetches as unchanged", async () => {
		const service = new RepoCacheService({ sparsePaths: ["docs/**"] });
		await service.ensureCache(repo);

		const update = await service.updateCache(repo);

		expect(update.update.changed).toBe(false);
		expect(update.update.previousRevision).toBe(update.update.currentRevision);
		expect(update.diagnostics.map((event) => event.type)).toContain(
			"revision_unchanged",
		);
	});

	test("computes modified and deleted paths", async () => {
		const adapter = new LocalGitSourceAdapter();
		const firstRevision = (await adapter.getRevision(repo)).revision;

		await writeFile(
			join(originPath, "src", "app.ts"),
			"export const value = 2;\n",
		);
		await spawnGitOrThrow({ cwd: originPath, args: ["rm", "docs/guide.md"] });
		await spawnGitOrThrow({ cwd: originPath, args: ["add", "."] });
		await spawnGitOrThrow({
			cwd: originPath,
			args: ["commit", "-m", "modify and delete"],
		});
		const update = await new RepoCacheService().updateCache(repo);

		await expect(
			diffPaths({
				repoId: repo.repoId,
				localPath: cachePath,
				fromRevision: firstRevision,
				toRevision: update.update.currentRevision,
			}),
		).resolves.toEqual([
			{ rawKind: "deleted", normalizedKind: "deleted", path: "docs/guide.md" },
			{ rawKind: "modified", normalizedKind: "modified", path: "src/app.ts" },
		]);
	});

	test("preserves copied and type-changed raw semantics", async () => {
		const adapter = new LocalGitSourceAdapter();
		const firstRevision = (await adapter.getRevision(repo)).revision;

		await copyFile(
			join(originPath, "docs", "guide.md"),
			join(originPath, "docs", "copy.md"),
		);
		await rm(join(originPath, "src", "app.ts"));
		await symlink("../docs/guide.md", join(originPath, "src", "app.ts"));
		await spawnGitOrThrow({ cwd: originPath, args: ["add", "."] });
		await spawnGitOrThrow({
			cwd: originPath,
			args: ["commit", "-m", "copy and type change"],
		});
		const update = await new RepoCacheService().updateCache(repo);

		await expect(
			adapter.diffPaths(repo, firstRevision, update.update.currentRevision),
		).resolves.toEqual([
			{
				rawKind: "copied",
				normalizedKind: "modified",
				oldPath: "docs/guide.md",
				path: "docs/copy.md",
			},
			{
				rawKind: "type-changed",
				normalizedKind: "modified",
				path: "src/app.ts",
			},
		]);
	});

	test("wraps missing refs during initial clone with clone context", async () => {
		const missingRefRepo = buildRepoConfig(
			originPath,
			cachePath,
			"missing-ref",
		);
		const adapter = new LocalGitSourceAdapter();
		const error = await adapter
			.getRevision(missingRefRepo)
			.catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(GitCloneError);
		expect(error).toMatchObject({
			code: "GIT_CLONE_FAILED",
			context: {
				repoId: "identity",
				localPath: cachePath,
			},
		});
	});

	test("reports missing remote refs with current-checkout guidance", async () => {
		const service = new RepoCacheService();
		await service.ensureCache(repo);
		const missingRefRepo = buildRepoConfig(
			originPath,
			cachePath,
			"missing-ref",
		);
		const error = await service
			.updateCache(missingRefRepo)
			.catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(GitRefResolutionError);
		expect(error).toMatchObject({
			code: "GIT_REF_RESOLUTION_FAILED",
			context: {
				repoId: "identity",
				localPath: cachePath,
				ref: "missing-ref",
				refMode: "remote",
			},
		});
		expect((error as Error).message).toContain(
			"Remote ref missing-ref was not found on origin",
		);
		expect((error as Error).message).toContain("refMode: current-checkout");
	});

	test("builds a local-only branch in current-checkout mode without fetching origin", async () => {
		const checkoutPath = join(fixtureDir, "working-checkout");
		await cloneWorkingCheckout(originPath, checkoutPath);
		await spawnGitOrThrow({
			cwd: checkoutPath,
			args: ["checkout", "-b", "local-only"],
		});
		await writeFile(
			join(checkoutPath, "docs", "local.md"),
			"local only docs\n",
		);
		await spawnGitOrThrow({ cwd: checkoutPath, args: ["add", "."] });
		await spawnGitOrThrow({
			cwd: checkoutPath,
			args: ["commit", "-m", "local only"],
		});

		const currentRepo = buildRepoConfig(
			originPath,
			checkoutPath,
			"local-only",
			"current-checkout",
		);
		const remoteRepo = buildRepoConfig(
			originPath,
			join(fixtureDir, "remote-cache"),
			"local-only",
		);

		const adapter = new LocalGitSourceAdapter();
		await expect(adapter.getRevision(currentRepo)).resolves.toMatchObject({
			repoId: "identity",
			ref: "local-only",
		});
		await expect(adapter.listFiles(currentRepo)).resolves.toContainEqual({
			path: "docs/local.md",
			type: "file",
		});

		const remoteError = await adapter
			.getRevision(remoteRepo)
			.catch((cause: unknown) => cause);
		expect(remoteError).toBeInstanceOf(GitCloneError);
		expect((remoteError as Error).message).toContain(
			"ref local-only was not found on origin",
		);
		expect((remoteError as Error).message).toContain(
			"refMode: current-checkout",
		);
	});

	test("resolves detached HEAD with ref HEAD in current-checkout mode", async () => {
		const checkoutPath = join(fixtureDir, "detached-checkout");
		await cloneWorkingCheckout(originPath, checkoutPath);
		const detachedRevision = (
			await spawnGitOrThrow({ cwd: checkoutPath, args: ["rev-parse", "HEAD"] })
		).stdout.trim();
		await spawnGitOrThrow({
			cwd: checkoutPath,
			args: ["checkout", "--detach", detachedRevision],
		});

		const detachedRepo = buildRepoConfig(
			originPath,
			checkoutPath,
			"HEAD",
			"current-checkout",
		);
		const revision = await new LocalGitSourceAdapter().getRevision(
			detachedRepo,
		);

		expect(revision.ref).toBe("HEAD");
		expect(revision.revision).toBe(detachedRevision);
	});

	test("rejects existing non-repo cache paths", async () => {
		await mkdir(cachePath, { recursive: true });
		await writeFile(join(cachePath, "not-git.txt"), "nope");
		const adapter = new LocalGitSourceAdapter();

		await expect(adapter.getRevision(repo)).rejects.toThrow(
			GitInvalidRepositoryError,
		);
	});

	test("rejects GHES mode repos explicitly", async () => {
		const adapter = new LocalGitSourceAdapter();
		const ghesRepo: RepoConfig = {
			repoId: "identity",
			mode: "ghes-api",
			workspace: {
				rootPath: ".",
				packageGlobs: ["packages/*"],
				packageManifestFiles: ["package.json"],
			},
			topology: repo.topology,
		};

		await expect(adapter.getRevision(ghesRepo)).rejects.toThrow(
			GitUnsupportedRepoModeError,
		);
	});

	test("streams diagnostics through the adapter and cache service", async () => {
		const diagnostics: string[] = [];
		const service = new RepoCacheService({
			sparsePaths: ["docs/**"],
			onDiagnostic: (event) => diagnostics.push(event.type),
		});
		const adapter = new LocalGitSourceAdapter({
			cacheService: service,
			onDiagnostic: (event) => diagnostics.push(event.type),
		});

		const firstRevision = (await adapter.getRevision(repo)).revision;
		const update = await service.updateCache(repo);
		await adapter.diffPaths(repo, firstRevision, update.update.currentRevision);

		expect(diagnostics).toContain("clone_started");
		expect(diagnostics).toContain("clone_completed");
		expect(diagnostics).toContain("sparse_checkout_applied");
		expect(diagnostics).toContain("fetch_started");
		expect(diagnostics).toContain("fetch_completed");
		expect(diagnostics).toContain("revision_unchanged");
		expect(diagnostics).toContain("diff_computed");
	});
});

async function createOriginRepo(originPath: string): Promise<void> {
	await mkdir(join(originPath, "docs"), { recursive: true });
	await mkdir(join(originPath, "src"), { recursive: true });
	await spawnGitOrThrow({ cwd: originPath, args: ["init", "-b", "main"] });
	await spawnGitOrThrow({
		cwd: originPath,
		args: ["config", "user.email", "atlas@example.test"],
	});
	await spawnGitOrThrow({
		cwd: originPath,
		args: ["config", "user.name", "ATLAS Test"],
	});
	await writeFile(join(originPath, "docs", "guide.md"), "hello docs\n");
	await writeFile(
		join(originPath, "src", "app.ts"),
		"export const value = 1;\n",
	);
	await spawnGitOrThrow({ cwd: originPath, args: ["add", "."] });
	await spawnGitOrThrow({ cwd: originPath, args: ["commit", "-m", "initial"] });
}

async function renameGuide(originPath: string): Promise<void> {
	await spawnGitOrThrow({
		cwd: originPath,
		args: ["mv", "docs/guide.md", "docs/renamed.md"],
	});
	await spawnGitOrThrow({
		cwd: originPath,
		args: ["commit", "-m", "rename guide"],
	});
}

async function cloneWorkingCheckout(
	remote: string,
	checkoutPath: string,
): Promise<void> {
	await spawnGitOrThrow({
		cwd: join(checkoutPath, ".."),
		args: ["clone", remote, checkoutPath],
	});
	await spawnGitOrThrow({
		cwd: checkoutPath,
		args: ["config", "user.email", "atlas@example.test"],
	});
	await spawnGitOrThrow({
		cwd: checkoutPath,
		args: ["config", "user.name", "ATLAS Test"],
	});
}

function buildRepoConfig(
	remote: string,
	localPath: string,
	ref = "main",
	refMode: "remote" | "current-checkout" = "remote",
): RepoConfig {
	return {
		repoId: "identity",
		mode: "local-git",
		git: {
			remote,
			localPath,
			ref,
			refMode,
		},
		workspace: {
			rootPath: ".",
			packageGlobs: ["packages/*"],
			packageManifestFiles: ["package.json"],
		},
		topology: [
			{
				id: "repo-docs",
				kind: "repo-doc",
				match: {
					include: ["docs/**/*.md"],
				},
				ownership: {
					attachTo: "repo",
				},
				authority: "canonical",
				priority: 10,
			},
		],
	};
}
