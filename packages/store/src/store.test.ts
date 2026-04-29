import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalDocument,
	type CorpusChunk,
	createChunkId,
	createDocId,
	createModuleId,
	createPackageId,
	createSectionId,
	createSkillId,
} from "@atlas/core";

import {
	type AtlasStoreClient,
	ChunkRepository,
	DocRepository,
	getCurrentSchemaVersion,
	getStoreDiagnostics,
	lexicalSearch,
	ManifestRepository,
	ModuleRepository,
	migrateStore,
	openStore,
	PackageRepository,
	pathSearch,
	RepoRepository,
	SectionRepository,
	SkillRepository,
	STORE_SCHEMA_VERSION,
	SummaryRepository,
	scopeSearch,
} from "./index";

const repoId = "atlas";
const packageId = createPackageId({ repoId, path: "packages/auth" });
const moduleId = createModuleId({
	repoId,
	packageId,
	path: "packages/auth/src/session",
});
const docId = createDocId({ repoId, path: "packages/auth/docs/session.md" });
const sectionId = createSectionId({
	docId,
	headingPath: ["Session"],
	ordinal: 0,
});
const skillId = createSkillId({
	repoId,
	packageId,
	moduleId,
	path: "packages/auth/docs/session-skill",
});

describe("store integration", () => {
	let dbPath: string;
	let store: AtlasStoreClient;

	beforeEach(async () => {
		dbPath = join(
			await mkdtemp(join(tmpdir(), "atlas-store-test-")),
			"atlas.db",
		);
		store = openStore({ path: dbPath, migrate: true });
	});

	afterEach(async () => {
		store.close();
		await rm(dbPath.replace(/\/atlas\.db$/, ""), {
			recursive: true,
			force: true,
		});
	});

	test("initializes and reruns migrations idempotently", () => {
		expect(getCurrentSchemaVersion(store)).toBe(STORE_SCHEMA_VERSION);
		expect(() =>
			openStore({ path: dbPath, migrate: true }).close(),
		).not.toThrow();
	});

	test("creates missing parent directories for file-backed stores", async () => {
		const rootPath = await mkdtemp(join(tmpdir(), "atlas-store-parent-test-"));
		const nestedDbPath = join(rootPath, "nested", "corpus", "atlas.db");
		const nestedStore = openStore({ path: nestedDbPath, migrate: true });
		nestedStore.close();

		expect((await stat(nestedDbPath)).isFile()).toBe(true);
		await rm(rootPath, { recursive: true, force: true });
	});

	test("stores slash-bearing canonical repo IDs unchanged", () => {
		const repos = new RepoRepository(store);
		const canonicalRepoId = "github.mycorp.com/platform/docs";

		repos.upsert({
			repoId: canonicalRepoId,
			mode: "local-git",
			revision: "rev_1",
		});

		expect(repos.get(canonicalRepoId)).toMatchObject({
			repoId: canonicalRepoId,
			revision: "rev_1",
		});
		expect(repos.list().map((repo) => repo.repoId)).toContain(canonicalRepoId);

		repos.delete(canonicalRepoId);

		expect(repos.get(canonicalRepoId)).toBeUndefined();
	});

	test("repository batch writes can run inside an outer transaction in node sqlite runtime", () => {
		const nodeRuntimeStore = store as unknown as { runtime: "bun" | "node" };
		nodeRuntimeStore.runtime = "node";
		const canonicalRepoId = "github.mycorp.com/platform/docs";
		new RepoRepository(store).upsert({
			repoId: canonicalRepoId,
			mode: "local-git",
			revision: "rev_1",
		});

		expect(() => {
			store.transaction(() => {
				new PackageRepository(store).replaceForRepo(canonicalRepoId, []);
			});
		}).not.toThrow();
	});

	test("repairs unreleased v1 dev stores with missing baseline tables", async () => {
		const rootPath = await mkdtemp(
			join(tmpdir(), "atlas-store-hard-cut-test-"),
		);
		const legacyDbPath = join(rootPath, "atlas.db");
		const legacyStore = openStore({ path: legacyDbPath, migrate: false });
		try {
			legacyStore.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
			legacyStore.run(
				"INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'baseline_store_schema', '2026-01-01T00:00:00.000Z')",
			);

			expect(() =>
				new SkillRepository(legacyStore).listArtifacts("missing_skill"),
			).toThrow();

			migrateStore(legacyStore);

			expect(getCurrentSchemaVersion(legacyStore)).toBe(STORE_SCHEMA_VERSION);
			expect(
				new SkillRepository(legacyStore).listArtifacts("missing_skill"),
			).toEqual([]);
		} finally {
			legacyStore.close();
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	test("persists structural entities, canonical docs, summaries, skills, manifests, and diagnostics", () => {
		seedStructuralStore(store);
		const document = createDocument(
			"Session",
			"Session tokens authenticate requests.",
		);

		const docRepo = new DocRepository(store);
		docRepo.replaceCanonicalDocument(document);
		new SummaryRepository(store).replaceForTarget("document", docId, [
			{
				summaryId: "summary_session_short",
				targetType: "document",
				targetId: docId,
				level: "short",
				text: "Session tokens authenticate requests.",
				tokenCount: 8,
			},
		]);
		new SkillRepository(store).upsert({
			node: {
				skillId,
				repoId,
				packageId,
				moduleId,
				path: "packages/auth/docs/session-skill/skill.md",
				title: "Session Skill",
				sourceDocPath: "packages/auth/docs/session.md",
				topics: ["session"],
				aliases: ["session helper"],
				tokenCount: 12,
				diagnostics: [],
			},
			sourceDocId: docId,
			description: "Operate session docs.",
			headings: [["Session"]],
			keySections: ["Session tokens authenticate requests."],
			topics: ["session", "auth"],
			aliases: ["session helper"],
			tokenCount: 18,
			artifacts: [
				{
					skillId,
					path: "scripts/check.py",
					kind: "script",
					contentHash: "hash_check",
					sizeBytes: 11,
					mimeType: "text/x-python",
					content: "print('ok')",
				},
			],
		});
		new ManifestRepository(store).upsert({
			repoId,
			indexedRevision: "rev_2",
			compilerVersion: "compiler-v1",
		});

		expect(docRepo.get(docId)).toMatchObject({
			docId,
			repoId,
			path: "packages/auth/docs/session.md",
			title: "Session",
			packageId,
			moduleId,
			tags: ["auth"],
			scopes: [{ level: "module", repoId, packageId, moduleId }],
		});
		expect(docRepo.listByModule(moduleId)).toEqual([
			expect.objectContaining({ docId, path: "packages/auth/docs/session.md" }),
		]);
		expect(docRepo.listByModule("missing_module")).toEqual([]);
		expect(new SectionRepository(store).listByDocument(docId)).toEqual([
			expect.objectContaining({
				sectionId,
				headingPath: ["Session"],
				text: "Session tokens authenticate requests.",
				codeBlocks: [{ lang: "ts", code: "export const token = 'ok';" }],
			}),
		]);
		expect(new SectionRepository(store).getById(sectionId)).toMatchObject({
			sectionId,
			docId,
		});
		expect(
			new SectionRepository(store).getById("missing_section"),
		).toBeUndefined();
		expect(
			new SummaryRepository(store).listForTarget("document", docId),
		).toHaveLength(1);
		expect(
			new SummaryRepository(store).getById("summary_session_short"),
		).toMatchObject({
			summaryId: "summary_session_short",
			targetType: "document",
			targetId: docId,
			level: "short",
		});
		expect(
			new SummaryRepository(store).getById("missing_summary"),
		).toBeUndefined();
		expect(new SkillRepository(store).get(skillId)).toMatchObject({
			skillId,
			title: "Session Skill",
			description: "Operate session docs.",
			topics: ["session", "auth"],
			aliases: ["session helper"],
			tokenCount: 18,
		});
		expect(new SkillRepository(store).listArtifacts(skillId)).toEqual([
			expect.objectContaining({
				skillId,
				path: "scripts/check.py",
				kind: "script",
				contentHash: "hash_check",
				content: "print('ok')",
			}),
		]);
		expect(new SkillRepository(store).summarizeArtifacts(skillId)).toEqual({
			scripts: 1,
			references: 0,
			agentProfiles: 0,
			other: 0,
		});
		expect(new ManifestRepository(store).get(repoId)).toMatchObject({
			repoId,
			indexedRevision: "rev_2",
			schemaVersion: STORE_SCHEMA_VERSION,
			compilerVersion: "compiler-v1",
		});
		expect(getStoreDiagnostics(store)).toMatchObject({
			dbPath,
			schemaVersion: STORE_SCHEMA_VERSION,
			repoCount: 1,
			documentCount: 1,
			summaryCount: 1,
		});
	});

	test("records and clears partial build state without advancing indexed revision", () => {
		seedStructuralStore(store);
		const manifests = new ManifestRepository(store);

		manifests.upsert({
			repoId,
			indexedRevision: "rev_2",
			compilerVersion: "compiler-v1",
		});
		manifests.recordPartialBuild({
			repoId,
			revision: "rev_3",
			selector: { docIds: [docId] },
		});

		expect(manifests.get(repoId)).toMatchObject({
			repoId,
			indexedRevision: "rev_2",
			partialRevision: "rev_3",
			partialSelector: { docIds: [docId] },
		});

		manifests.clearPartialBuild(repoId);

		expect(manifests.get(repoId)).toMatchObject({
			repoId,
			indexedRevision: "rev_2",
		});
		expect(manifests.get(repoId)).not.toMatchObject({
			partialRevision: expect.any(String),
			partialSelector: expect.anything(),
		});
	});

	test("replaces document child artifacts cleanly on rebuild", () => {
		seedStructuralStore(store);
		const docRepo = new DocRepository(store);
		docRepo.replaceCanonicalDocument(createDocument("Session", "Old text."));

		const replacementSectionId = createSectionId({
			docId,
			headingPath: ["Session", "Rotation"],
			ordinal: 0,
		});
		docRepo.replaceCanonicalDocument({
			...createDocument("Session", "Rotated text."),
			sections: [
				{
					sectionId: replacementSectionId,
					headingPath: ["Session", "Rotation"],
					ordinal: 0,
					text: "Rotated text.",
					codeBlocks: [],
				},
			],
		});

		expect(new SectionRepository(store).listByDocument(docId)).toEqual([
			expect.objectContaining({
				sectionId: replacementSectionId,
				headingPath: ["Session", "Rotation"],
				text: "Rotated text.",
			}),
		]);
		expect(lexicalSearch(store, { query: "Old", repoId })).toEqual([]);
		expect(lexicalSearch(store, { query: "Rotated", repoId })[0]).toMatchObject(
			{ docId },
		);
	});

	test("persists chunks, supports path and scope search, and cascades repo deletion", () => {
		seedStructuralStore(store);
		const document = createDocument(
			"Session",
			"Session tokens authenticate requests.",
		);
		new DocRepository(store).replaceCanonicalDocument(document);
		const chunk: CorpusChunk = {
			chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
			docId,
			repoId,
			packageId,
			moduleId,
			kind: "module-doc",
			authority: "preferred",
			headingPath: ["Session"],
			ordinal: 0,
			text: "Session token rotation is supported.",
			tokenCount: 8,
		};
		new ChunkRepository(store).replaceForDocument(docId, [chunk]);

		expect(
			pathSearch(store, {
				repoId,
				path: "packages/auth/docs/session.md",
				mode: "exact",
			}),
		).toEqual([
			expect.objectContaining({ docId, path: "packages/auth/docs/session.md" }),
		]);
		expect(
			pathSearch(store, { path: "packages/auth/docs", mode: "prefix" }),
		).toEqual([expect.objectContaining({ docId })]);
		expect(scopeSearch(store, { repoId, moduleId })).toEqual([
			expect.objectContaining({ docId }),
		]);
		expect(lexicalSearch(store, { query: "rotation", repoId })).toEqual([
			expect.objectContaining({
				entityType: "chunk",
				chunkId: chunk.chunkId,
				docId,
			}),
		]);
		expect(new ChunkRepository(store).getById(chunk.chunkId)).toMatchObject({
			chunkId: chunk.chunkId,
			docId,
		});
		expect(new ChunkRepository(store).getById("missing_chunk")).toBeUndefined();

		new RepoRepository(store).delete(repoId);

		expect(new DocRepository(store).get(docId)).toBeUndefined();
		expect(new ChunkRepository(store).listByDocument(docId)).toEqual([]);
		expect(lexicalSearch(store, { query: "rotation", repoId })).toEqual([]);
	});
});

function seedStructuralStore(store: AtlasStoreClient): void {
	new RepoRepository(store).upsert({
		repoId,
		mode: "local-git",
		revision: "rev_1",
	});
	new PackageRepository(store).upsert({
		packageId,
		repoId,
		name: "@atlas/auth",
		path: "packages/auth",
		manifestPath: "packages/auth/package.json",
	});
	new ModuleRepository(store).upsert({
		moduleId,
		repoId,
		packageId,
		name: "session",
		path: "packages/auth/src/session",
	});
}

function createDocument(title: string, text: string): CanonicalDocument {
	return {
		docId,
		repoId,
		path: "packages/auth/docs/session.md",
		sourceVersion: "rev_1",
		title,
		kind: "module-doc",
		authority: "preferred",
		scopes: [{ level: "module", repoId, packageId, moduleId }],
		sections: [
			{
				sectionId,
				headingPath: ["Session"],
				ordinal: 0,
				text,
				codeBlocks: [{ lang: "ts", code: "export const token = 'ok';" }],
			},
		],
		metadata: {
			packageId,
			moduleId,
			tags: ["auth"],
		},
	};
}
