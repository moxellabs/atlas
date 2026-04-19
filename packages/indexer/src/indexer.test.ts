import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAtlasConfig } from "@atlas/config";
import { createDocId, createModuleId, createPackageId } from "@atlas/core";
import type { GhesFetch } from "@atlas/source-ghes";
import {
	type AtlasStoreClient,
	ManifestRepository,
	openStore,
	RepoRepository,
} from "@atlas/store";

import {
	buildArtifactManifest,
	buildDocsIndex,
	exportCorpusDbSnapshot,
	inspectMoxelAtlasArtifact,
	verifyMoxelAtlasArtifact,
	writeArtifactChecksums,
	writePrettyJson,
} from "./artifact";
import { analyzeDocumentationSignal } from "./local-only-index";
import { createIndexerServices } from "./services/create-indexer-services";
import { computeSourceDiff } from "./sync/compute-source-updates";

const repoId = "atlas";
const packageId = createPackageId({ repoId, path: "packages/auth" });
const moduleId = createModuleId({ repoId, path: "Auth" });
const repoDocId = createDocId({ repoId, path: "docs/index.md" });
const packageDocId = createDocId({ repoId, path: "packages/auth/docs/api.md" });
const moduleDocId = createDocId({ repoId, path: "Auth/docs/overview.md" });
const skillDocId = createDocId({
	repoId,
	path: "Auth/docs/auth-skill/skill.md",
});

describe("documentation signal", () => {
	test("detects README-only documentation", async () => {
		const signal = await analyzeDocumentationSignal(
			["README.md"],
			async () => "hello",
		);
		expect(signal.signal).toBe("readme-only");
		expect(signal.warnings[0]?.code).toBe("README_ONLY_DOCS");
	});

	test("detects weak markdown corpus", async () => {
		const signal = await analyzeDocumentationSignal(
			["docs/a.md", "docs/b.mdx"],
			async () => "small",
		);
		expect(signal.signal).toBe("weak");
		expect(signal.warnings[0]?.code).toBe("WEAK_DOCS_SIGNAL");
	});

	test("detects strong markdown corpus", async () => {
		const content = "x".repeat(700);
		const signal = await analyzeDocumentationSignal(
			["docs/a.md", "docs/b.md", "docs/c.mdx"],
			async () => content,
		);
		expect(signal.signal).toBe("strong");
		expect(signal.markdownFileCount).toBe(3);
		expect(signal.totalMarkdownBytes).toBeGreaterThanOrEqual(2000);
	});
});

describe("indexer integration", () => {
	let fixtureDir: string;
	let originPath: string;
	let localPath: string;
	let dbPath: string;
	let store: AtlasStoreClient;

	beforeEach(async () => {
		fixtureDir = (
			await Bun.$`mktemp -d ${join(tmpdir(), "atlas-indexer-test-XXXXXX")}`.text()
		).trim();
		originPath = join(fixtureDir, "origin");
		localPath = join(fixtureDir, "cache", repoId);
		dbPath = join(fixtureDir, "atlas.db");

		await mkdir(join(fixtureDir, "cache"), { recursive: true });
		await createOriginRepo(originPath);
		store = openStore({ path: dbPath, migrate: true });
	});

	afterEach(async () => {
		store.close();
		await rm(fixtureDir, { recursive: true, force: true });
	});

	test("syncs revisions, reports unchanged state, and then reports updated doc changes", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const initial = await service.syncRepo(repoId);
		expect(initial).toMatchObject({
			repoId,
			status: "unchanged",
			sourceChanged: false,
			corpusAffected: true,
			corpusImpact: "missing-manifest",
			changedPathCount: 0,
			relevantChangedPathCount: 0,
			recovery: {
				previousCorpusPreserved: true,
				stale: true,
				nextAction: "Run atlas build to create the indexed corpus.",
			},
		});
		expect(initial.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			"fetch_completed",
		);
		expect(deps.store.repos.get(repoId)?.revision).toBe(
			initial.currentRevision,
		);

		const unchanged = await service.syncRepo(repoId);
		expect(unchanged.status).toBe("unchanged");

		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nUpdated package documentation.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "update package doc"]);

		const updated = await service.syncRepo(repoId);
		expect(updated).toMatchObject({
			repoId,
			status: "updated",
			sourceChanged: true,
			corpusAffected: true,
			corpusImpact: "missing-manifest",
			changedPathCount: 1,
			relevantChangedPathCount: 1,
			relevantDocPathCount: 1,
			recovery: {
				previousCorpusPreserved: true,
				stale: true,
				nextAction: "Run atlas build to create the indexed corpus.",
			},
		});
	});

	test("sync fast-forwards compatible manifests for code-only changes", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const built = await service.buildRepo(repoId);
		await mkdir(join(originPath, "packages", "auth", "src"), {
			recursive: true,
		});
		await writeFile(
			join(originPath, "packages", "auth", "src", "index.ts"),
			"export const updated = true;\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "update code only"]);

		const synced = await service.syncRepo(repoId);

		expect(synced).toMatchObject({
			repoId,
			status: "updated",
			sourceChanged: true,
			corpusAffected: false,
			corpusImpact: "none",
			changedPathCount: 1,
			relevantChangedPathCount: 0,
			relevantDocPathCount: 0,
			recovery: {
				previousCorpusPreserved: true,
				stale: false,
				nextAction: "No recovery action required.",
			},
		});
		expect(deps.store.repos.get(repoId)?.revision).toBe(synced.currentRevision);
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			synced.currentRevision,
		);
		expect(deps.store.manifests.get(repoId)?.indexedRevision).not.toBe(
			built.currentRevision,
		);
	});

	test("sync keeps compatible manifests stale for documentation changes", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const built = await service.buildRepo(repoId);
		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nSync-visible package documentation update.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "update docs after build"]);

		const synced = await service.syncRepo(repoId);

		expect(synced).toMatchObject({
			repoId,
			status: "updated",
			sourceChanged: true,
			corpusAffected: true,
			corpusImpact: "docs",
			changedPathCount: 1,
			relevantChangedPathCount: 1,
			relevantDocPathCount: 1,
			recovery: {
				previousCorpusPreserved: true,
				stale: true,
				nextAction: "Run atlas build to update the indexed corpus.",
			},
		});
		expect(deps.store.repos.get(repoId)?.revision).toBe(synced.currentRevision);
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			built.currentRevision,
		);
	});

	test("repeated sync preserves corpus-affecting changes until build consumes them", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const built = await service.buildRepo(repoId);
		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nRepeated sync should stay stale.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "doc update before repeated sync"]);

		const firstSync = await service.syncRepo(repoId);
		expect(firstSync).toMatchObject({
			sourceChanged: true,
			corpusAffected: true,
			corpusImpact: "docs",
			relevantDocPathCount: 1,
		});
		expect(deps.store.repos.get(repoId)?.revision).toBe(
			firstSync.currentRevision,
		);
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			built.currentRevision,
		);

		const secondSync = await service.syncRepo(repoId);
		expect(secondSync).toMatchObject({
			sourceChanged: false,
			corpusAffected: true,
			corpusImpact: "docs",
			relevantDocPathCount: 1,
		});
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			built.currentRevision,
		);

		const rebuild = await service.buildRepo(repoId);
		expect(rebuild).toMatchObject({
			strategy: "incremental",
			docsRebuilt: 1,
			manifestUpdated: true,
		});
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			rebuild.currentRevision,
		);
	});

	test("computes explicit source diffs without mutating stored repo revision", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const initial = await service.syncRepo(repoId);
		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nRead-only source diff update.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "read-only diff update"]);
		const nextRevision = await gitOutput(originPath, ["rev-parse", "HEAD"]);
		if (initial.currentRevision === undefined) {
			throw new Error("Initial sync did not report a current revision.");
		}

		const diff = await computeSourceDiff(
			deps.resolveRepo(repoId),
			deps,
			initial.currentRevision,
			nextRevision,
		);

		expect(diff).toMatchObject({
			repoId,
			previousRevision: initial.currentRevision,
			currentRevision: nextRevision,
			changed: true,
			relevantDocPaths: ["packages/auth/docs/api.md"],
			relevantChanges: [
				expect.objectContaining({
					path: "packages/auth/docs/api.md",
					normalizedKind: "modified",
				}),
			],
		});
		expect(deps.store.repos.get(repoId)?.revision).toBe(
			initial.currentRevision,
		);
	});

	test("runs an initial full build and persists canonical docs, skills, and manifest state", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const report = await service.buildRepo(repoId);

		expect(report).toMatchObject({
			repoId,
			strategy: "full",
			partial: false,
			docsRebuilt: 4,
			manifestUpdated: true,
			recovery: {
				previousCorpusPreserved: true,
				stale: false,
			},
		});
		expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			"fetch_completed",
		);
		expect(
			deps.store.docs
				.listByRepo(repoId)
				.map((doc) => doc.docId)
				.sort(),
		).toEqual([moduleDocId, skillDocId, repoDocId, packageDocId].sort());
		expect(deps.store.skills.listByRepo(repoId)).toEqual([
			expect.objectContaining({
				topics: ["auth", "login"],
				aliases: ["auth helper", "login helper"],
				tokenCount: expect.any(Number),
			}),
		]);
		expect(
			deps.store.skills.summarizeArtifacts(
				deps.store.skills.listByRepo(repoId)[0]?.skillId ?? "",
			),
		).toEqual({
			scripts: 1,
			references: 1,
			agentProfiles: 1,
			other: 0,
		});
		expect(deps.store.manifests.get(repoId)).toMatchObject({
			repoId,
			indexedRevision: report.currentRevision,
			compilerVersion: deps.compilerVersion,
			schemaVersion: deps.storeSchemaVersion,
		});
	});

	test("rebuilds incrementally for doc edits and cleans up deleted documents", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		await service.buildRepo(repoId);

		await writeFile(
			join(originPath, "packages", "auth", "docs", "api.md"),
			"# API\n\nIncremental update.\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "incremental doc edit"]);

		const incremental = await service.buildRepo(repoId);
		expect(incremental).toMatchObject({
			repoId,
			strategy: "incremental",
			partial: false,
			docsRebuilt: 1,
			docsDeleted: 0,
			manifestUpdated: true,
		});
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBe(
			incremental.currentRevision,
		);

		await unlink(join(originPath, "packages", "auth", "docs", "api.md"));
		await git(originPath, ["add", "-A"]);
		await git(originPath, ["commit", "-m", "delete package doc"]);

		const deletion = await service.buildRepo(repoId);
		expect(deletion).toMatchObject({
			repoId,
			strategy: "incremental",
			partial: false,
			docsDeleted: 1,
			manifestUpdated: true,
		});
		expect(deps.store.docs.get(packageDocId)).toBeUndefined();
	});

	test("rebuilds skill bundles when adjacent scripts change", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		await service.buildRepo(repoId);
		const skill = deps.store.skills.listByRepo(repoId)[0];
		if (skill === undefined) {
			throw new Error("Expected seeded skill.");
		}
		const before = deps.store.skills.getArtifact(
			skill.skillId,
			"scripts/check.py",
		);

		await writeFile(
			join(originPath, "Auth", "docs", "auth-skill", "scripts", "check.py"),
			"print('changed')\n",
		);
		await git(originPath, ["add", "."]);
		await git(originPath, ["commit", "-m", "update skill script"]);

		const report = await service.buildRepo(repoId);
		expect(report).toMatchObject({
			repoId,
			strategy: "full",
			docsRebuilt: 4,
			skillsUpdated: 1,
		});
		expect(
			deps.store.skills.getArtifact(skill.skillId, "scripts/check.py"),
		).toMatchObject({
			path: "scripts/check.py",
			content: "print('changed')\n",
		});
		expect(
			deps.store.skills.getArtifact(skill.skillId, "scripts/check.py")
				?.contentHash,
		).not.toBe(before?.contentHash);
	});

	test("supports targeted doc, package, and module builds with partial manifest state", async () => {
		const { service, deps } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath),
			db: store,
		});

		const byDoc = await service.buildRepo(repoId, {
			selection: { docIds: [moduleDocId] },
		});
		expect(byDoc).toMatchObject({
			repoId,
			strategy: "targeted",
			partial: true,
			docsRebuilt: 1,
			manifestUpdated: true,
		});
		expect(deps.store.manifests.get(repoId)).toMatchObject({
			repoId,
			partialRevision: byDoc.currentRevision,
			partialSelector: { docIds: [moduleDocId] },
		});
		expect(deps.store.manifests.get(repoId)?.indexedRevision).toBeUndefined();

		const byPackage = await service.buildRepo(repoId, {
			selection: { packageId },
		});
		expect(byPackage).toMatchObject({
			repoId,
			strategy: "targeted",
			partial: true,
			docsRebuilt: 1,
		});
		expect(deps.store.manifests.get(repoId)?.partialSelector).toEqual({
			packageId,
		});

		const byModule = await service.buildRepo(repoId, {
			selection: { moduleId },
		});
		expect(byModule.repoId).toBe(repoId);
		expect(byModule.strategy).toBe("targeted");
		expect(byModule.partial).toBe(true);
		expect(byModule.docsRebuilt).toBeGreaterThanOrEqual(1);
		expect(deps.store.manifests.get(repoId)?.partialSelector).toEqual({
			moduleId,
		});

		const full = await service.buildRepo(repoId, { force: true });
		expect(full.strategy).toBe("full");
		expect(full.partial).toBe(false);
		expect(deps.store.manifests.get(repoId)).toMatchObject({
			repoId,
			indexedRevision: full.currentRevision,
		});
		expect(deps.store.manifests.get(repoId)).not.toMatchObject({
			partialRevision: expect.any(String),
			partialSelector: expect.anything(),
		});
	});

	test("builds GHES repos through the source adapter without blocking local-git repos", async () => {
		const { service } = createIndexerServices({
			config: createResolvedConfig(originPath, localPath, {
				includeGhesRepo: true,
			}),
			db: store,
			ghesFetch: buildGhesFetch(),
		});

		const report = await service.buildAll({ all: true });

		expect(report.successCount).toBe(2);
		expect(report.failureCount).toBe(0);
		expect(report.reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					repoId,
					strategy: expect.any(String),
					diagnostics: expect.not.arrayContaining([
						expect.objectContaining({ severity: "error" }),
					]),
				}),
				expect.objectContaining({
					repoId: "atlas-ghes",
					strategy: "full",
					docsRebuilt: 2,
					diagnostics: expect.not.arrayContaining([
						expect.objectContaining({ severity: "error" }),
					]),
				}),
			]),
		);
	});

	test("preserves old corpus and reports recovery state when a rebuild fails", async () => {
		const first = createIndexerServices({
			config: createResolvedConfig(originPath, localPath, {
				includeGhesRepo: true,
			}),
			db: store,
			ghesFetch: buildGhesFetch(),
		});

		const successful = await first.service.buildRepo("atlas-ghes");
		const manifestBefore = first.deps.store.manifests.get("atlas-ghes");
		const docsBefore = first.deps.store.docs
			.listByRepo("atlas-ghes")
			.map((doc) => doc.docId)
			.sort();

		const second = createIndexerServices({
			config: createResolvedConfig(originPath, localPath, {
				includeGhesRepo: true,
			}),
			db: store,
			ghesFetch: buildFailingGhesFetch(),
		});

		const failed = await second.service.buildRepo("atlas-ghes");

		expect(successful.manifestUpdated).toBe(true);
		expect(failed).toMatchObject({
			repoId: "atlas-ghes",
			manifestUpdated: false,
			diagnostics: [expect.objectContaining({ severity: "error" })],
			recovery: {
				previousCorpusPreserved: true,
				nextAction:
					"Fix the build failure and rerun atlas build for this repo.",
			},
		});
		expect(second.deps.store.manifests.get("atlas-ghes")).toEqual(
			manifestBefore,
		);
		expect(
			second.deps.store.docs
				.listByRepo("atlas-ghes")
				.map((doc) => doc.docId)
				.sort(),
		).toEqual(docsBefore);
	});
});

describe("artifact verification helpers", () => {
	test("artifact freshness accepts valid artifacts and detects freshness", async () => {
		const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
		try {
			const artifactDir = await createArtifactFixture(root, {
				revision: "abc123",
			});
			const verified = await verifyMoxelAtlasArtifact({ artifactDir });
			expect(verified.valid).toBe(true);
			expect(verified.importable).toBe(true);
			const fresh = await verifyMoxelAtlasArtifact({
				artifactDir,
				requireFresh: true,
				freshRef: "abc123",
			});
			expect(fresh.valid).toBe(true);
			expect(fresh.fresh).toBe(true);
			expect(fresh.expectedRevision).toBe("abc123");
			expect(fresh.indexedRevision).toBe("abc123");
			const stale = await verifyMoxelAtlasArtifact({
				artifactDir,
				requireFresh: true,
				freshRef: "def456",
			});
			expect(stale.valid).toBe(false);
			expect(stale.fresh).toBe(false);
			expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
				"ATLAS_ARTIFACT_STALE",
			);
			const ignored = await verifyMoxelAtlasArtifact({
				artifactDir,
				freshRef: "def456",
			});
			expect(ignored.valid).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("artifact verify reports schema repo and corrupt corpus diagnostics", async () => {
		const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
		try {
			const artifactDir = await createArtifactFixture(root, {
				revision: "abc123",
			});
			const manifestPath = join(artifactDir, "manifest.json");
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			await writePrettyJson(manifestPath, {
				...manifest,
				schema: "bad",
				repoId: "bad",
			});
			await writeArtifactChecksums(artifactDir);
			const invalid = await verifyMoxelAtlasArtifact({ artifactDir });
			expect(
				invalid.diagnostics.map((diagnostic) => diagnostic.code),
			).toContain("ATLAS_ARTIFACT_SCHEMA_INVALID");
			expect(
				invalid.diagnostics.map((diagnostic) => diagnostic.code),
			).toContain("ATLAS_ARTIFACT_REPO_ID_INVALID");
			await writePrettyJson(manifestPath, manifest);
			await writeFile(join(artifactDir, "corpus.db"), "not sqlite");
			await writeArtifactChecksums(artifactDir);
			const corrupt = await verifyMoxelAtlasArtifact({ artifactDir });
			expect(
				corrupt.diagnostics.map((diagnostic) => diagnostic.code),
			).toContain("ATLAS_ARTIFACT_CORPUS_UNIMPORTABLE");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("artifact inspect returns docs counts", async () => {
		const root = await mkdtemp(join(tmpdir(), "atlas-artifact-test-"));
		try {
			const artifactDir = await createArtifactFixture(root, {
				revision: "abc123",
			});
			const inspected = await inspectMoxelAtlasArtifact({ artifactDir });
			expect(inspected.docsIndex?.counts.documents).toBe(0);
			expect(inspected.manifest?.repoId).toBe("github.com/moxellabs/atlas");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function createArtifactFixture(
	root: string,
	options: { revision: string },
): Promise<string> {
	const repoId = "github.com/moxellabs/atlas";
	const sourceDbPath = join(root, "source.db");
	const sourceDb = openStore({ path: sourceDbPath, migrate: true });
	try {
		new RepoRepository(sourceDb).upsert({
			repoId,
			mode: "local-git",
			revision: options.revision,
		});
		new ManifestRepository(sourceDb).upsert({
			repoId,
			indexedRevision: options.revision,
			compilerVersion: "test",
		});
		const artifactDir = join(root, ".moxel", "atlas");
		await mkdir(artifactDir, { recursive: true });
		await writePrettyJson(
			join(artifactDir, "manifest.json"),
			buildArtifactManifest({
				repoId,
				ref: "main",
				indexedRevision: options.revision,
			}),
		);
		await writePrettyJson(
			join(artifactDir, "docs.index.json"),
			buildDocsIndex(sourceDb, repoId),
		);
		sourceDb.close();
		await exportCorpusDbSnapshot(sourceDbPath, join(artifactDir, "corpus.db"));
		await writeArtifactChecksums(artifactDir);
		return artifactDir;
	} finally {
		try {
			sourceDb.close();
		} catch {
			// Already closed after docs index snapshot.
		}
	}
}

async function createOriginRepo(originPath: string): Promise<void> {
	await mkdir(join(originPath, "docs"), { recursive: true });
	await mkdir(join(originPath, "packages", "auth", "docs"), {
		recursive: true,
	});
	await mkdir(join(originPath, "Auth", "docs", "auth-skill"), {
		recursive: true,
	});
	await git(originPath, ["init", "-b", "main"]);
	await git(originPath, ["config", "user.email", "atlas@example.test"]);
	await git(originPath, ["config", "user.name", "ATLAS Test"]);
	await writeFile(
		join(originPath, "docs", "index.md"),
		"# Index\n\nRepository docs.\n",
	);
	await writeFile(
		join(originPath, "packages", "auth", "package.json"),
		JSON.stringify({ name: "@atlas/auth" }, null, 2),
	);
	await writeFile(
		join(originPath, "packages", "auth", "docs", "api.md"),
		"# API\n\nPackage documentation.\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "overview.md"),
		"# Overview\n\nModule documentation.\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "auth-skill", "skill.md"),
		"---\ntopics: auth, login\naliases:\n  - auth helper\n  - login helper\n---\n# Auth Skill\n\nUse this skill to answer authentication questions.\n",
	);
	await mkdir(join(originPath, "Auth", "docs", "auth-skill", "scripts"), {
		recursive: true,
	});
	await mkdir(join(originPath, "Auth", "docs", "auth-skill", "references"), {
		recursive: true,
	});
	await mkdir(join(originPath, "Auth", "docs", "auth-skill", "agents"), {
		recursive: true,
	});
	await writeFile(
		join(originPath, "Auth", "docs", "auth-skill", "scripts", "check.py"),
		"print('auth')\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "auth-skill", "references", "auth.txt"),
		"Auth reference\n",
	);
	await writeFile(
		join(originPath, "Auth", "docs", "auth-skill", "agents", "openai.yaml"),
		"interface:\n  display_name: Auth\n",
	);
	await git(originPath, ["add", "."]);
	await git(originPath, ["commit", "-m", "initial"]);
}

async function git(cwd: string, args: string[]): Promise<void> {
	const result = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await result.exited;
	if (exitCode !== 0) {
		const stderr = await readStream(result.stderr);
		throw new Error(
			`git ${args.join(" ")} failed with code ${exitCode}: ${stderr}`,
		);
	}
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
	const result = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await result.exited;
	if (exitCode !== 0) {
		const stderr = await readStream(result.stderr);
		throw new Error(
			`git ${args.join(" ")} failed with code ${exitCode}: ${stderr}`,
		);
	}
	return (await readStream(result.stdout)).trim();
}

async function readStream(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (stream === null) {
		return "";
	}
	return await new Response(stream).text();
}

function createResolvedConfig(
	originRepoPath: string,
	localRepoPath: string,
	options: { includeGhesRepo?: boolean | undefined } = {},
): ResolvedAtlasConfig {
	return {
		config: {
			version: 1,
			cacheDir: join(localRepoPath, ".."),
			corpusDbPath: join(localRepoPath, "..", "atlas.db"),
			logLevel: "info",
			server: { transport: "http", host: "127.0.0.1", port: 3000 },
			hosts: [
				{
					name: "github.com",
					webUrl: "https://github.com",
					apiUrl: "https://api.github.com",
					protocol: "ssh",
					priority: 100,
					default: true,
				},
			],
			repos: [
				{
					repoId,
					mode: "local-git",
					git: {
						remote: `file://${originRepoPath}`,
						localPath: localRepoPath,
						ref: "main",
					},
					workspace: {
						packageGlobs: ["packages/*"],
						packageManifestFiles: ["package.json"],
					},
					topology: defaultTopology(),
				},
				...(options.includeGhesRepo
					? [
							{
								repoId: "atlas-ghes",
								mode: "ghes-api" as const,
								github: {
									baseUrl: "https://ghes.example.test/api/v3",
									owner: "moxellabs",
									name: "atlas",
									ref: "main",
									tokenEnvVar: "ATLAS_GHES_TOKEN",
								},
								workspace: {
									packageGlobs: ["packages/*"],
									packageManifestFiles: ["package.json"],
								},
								topology: defaultTopology(),
							},
						]
					: []),
			],
		},
		source: {
			configPath: join(localRepoPath, "..", "atlas.config.json"),
			loadedFrom: "explicit",
		},
		env: {},
		...(options.includeGhesRepo
			? {
					ghesAuth: {
						"atlas-ghes": {
							kind: "token" as const,
							source: "env" as const,
							sourceName: "ATLAS_GHES_TOKEN",
							token: "test-token",
						},
					},
				}
			: {}),
	};
}

function buildGhesFetch(): GhesFetch {
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
				truncated: false,
				tree: [
					{
						path: "docs/index.md",
						mode: "100644",
						type: "blob",
						sha: "repo-doc-sha",
						size: 28,
						url: "https://ghe.example.test/blob1",
					},
					{
						path: "packages/auth/package.json",
						mode: "100644",
						type: "blob",
						sha: "manifest-sha",
						size: 24,
						url: "https://ghe.example.test/blob2",
					},
					{
						path: "packages/auth/docs/api.md",
						mode: "100644",
						type: "blob",
						sha: "package-doc-sha",
						size: 29,
						url: "https://ghe.example.test/blob3",
					},
				],
			});
		}
		if (path === "/api/v3/repos/moxellabs/atlas/git/blobs/repo-doc-sha") {
			return jsonResponse(blob("# Index\n\nRepository docs.\n"));
		}
		if (path === "/api/v3/repos/moxellabs/atlas/git/blobs/package-doc-sha") {
			return jsonResponse(blob("# API\n\nPackage documentation.\n"));
		}
		return jsonResponse({ message: `Unhandled path: ${path}` }, 404);
	};
}

function buildFailingGhesFetch(): GhesFetch {
	return async (input) => {
		const url = new URL(String(input));
		const path = url.pathname;
		if (path === "/api/v3/repos/moxellabs/atlas/commits/main") {
			return jsonResponse({
				sha: "2222222222222222222222222222222222222222",
				commit: { tree: { sha: "tree-sha-2" } },
			});
		}
		if (
			path ===
			"/api/v3/repos/moxellabs/atlas/compare/1111111111111111111111111111111111111111...2222222222222222222222222222222222222222"
		) {
			return jsonResponse({
				status: "ahead",
				total_commits: 1,
				files: [{ filename: "packages/auth/docs/api.md", status: "modified" }],
			});
		}
		if (path === "/api/v3/repos/moxellabs/atlas/git/trees/tree-sha-2") {
			return jsonResponse({
				sha: "tree-sha-2",
				truncated: false,
				tree: [
					{
						path: "docs/index.md",
						mode: "100644",
						type: "blob",
						sha: "repo-doc-sha",
						size: 28,
						url: "https://ghe.example.test/blob1",
					},
					{
						path: "packages/auth/package.json",
						mode: "100644",
						type: "blob",
						sha: "manifest-sha",
						size: 24,
						url: "https://ghe.example.test/blob2",
					},
					{
						path: "packages/auth/docs/api.md",
						mode: "100644",
						type: "blob",
						sha: "broken-package-doc-sha",
						size: 29,
						url: "https://ghe.example.test/blob3",
					},
				],
			});
		}
		if (
			path === "/api/v3/repos/moxellabs/atlas/git/blobs/broken-package-doc-sha"
		) {
			return jsonResponse({ message: "blob unavailable" }, 500);
		}
		return jsonResponse({ message: `Unhandled path: ${path}` }, 404);
	};
}

function blob(content: string) {
	return {
		sha: "blob-sha",
		size: content.length,
		url: "https://ghe.example.test/blob",
		content: Buffer.from(content, "utf8").toString("base64"),
		encoding: "base64",
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});
}

function defaultTopology() {
	return [
		{
			id: "repo-docs",
			kind: "repo-doc" as const,
			match: { include: ["docs/**/*.md"] },
			ownership: { attachTo: "repo" as const },
			authority: "canonical" as const,
			priority: 10,
		},
		{
			id: "package-docs",
			kind: "package-doc" as const,
			match: { include: ["packages/*/docs/**/*.md"] },
			ownership: { attachTo: "package" as const },
			authority: "preferred" as const,
			priority: 20,
		},
		{
			id: "module-docs",
			kind: "module-doc" as const,
			match: { include: ["*/docs/**/*.md"], exclude: ["*/docs/**/skill.md"] },
			ownership: {
				attachTo: "module" as const,
				moduleRootPattern: "*/docs/**/*.md",
			},
			authority: "preferred" as const,
			priority: 30,
		},
		{
			id: "skills",
			kind: "skill-doc" as const,
			match: { include: ["**/skill.md"] },
			ownership: { attachTo: "skill" as const, skillPattern: "**/skill.md" },
			authority: "canonical" as const,
			priority: 40,
		},
	];
}
