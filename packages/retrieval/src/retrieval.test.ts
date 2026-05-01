import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
	ModuleRepository,
	openStore,
	PackageRepository,
	RepoRepository,
	SkillRepository,
	SummaryRepository,
} from "@atlas/store";

import { classifyQuery } from "./classify/classify-query";
import { finalizeContext } from "./planner/finalize-context";
import { planContext } from "./planner/plan-context";
import { authorityWeight } from "./ranking/authority-weight";
import { localityWeight } from "./ranking/locality-weight";
import { rankCandidates } from "./ranking/rank-candidates";
import { redundancyPenalty } from "./ranking/redundancy-penalty";
import { inferScopes } from "./scopes/infer-scopes";
import type { PlannedItem, RetrievalCandidate } from "./types";

const repoId = "atlas";
const authPackageId = createPackageId({ repoId, path: "packages/auth" });
const billingPackageId = createPackageId({ repoId, path: "packages/billing" });
const sessionModuleId = createModuleId({
	repoId,
	packageId: authPackageId,
	path: "packages/auth/src/session",
});
const loginModuleId = createModuleId({
	repoId,
	packageId: authPackageId,
	path: "packages/auth/src/login",
});
const invoiceModuleId = createModuleId({
	repoId,
	packageId: billingPackageId,
	path: "packages/billing/src/invoice",
});
const sessionDocId = createDocId({
	repoId,
	path: "packages/auth/docs/session.md",
});
const loginDocId = createDocId({ repoId, path: "packages/auth/docs/login.md" });
const repoDocId = createDocId({ repoId, path: "docs/architecture.md" });
const invoiceDocId = createDocId({
	repoId,
	path: "packages/billing/docs/invoice.md",
});
const sessionSkillId = createSkillId({
	repoId,
	packageId: authPackageId,
	moduleId: sessionModuleId,
	path: "packages/auth/docs/session-skill.md",
});

describe("retrieval", () => {
	let dbPath: string;
	let store: AtlasStoreClient;

	beforeEach(async () => {
		dbPath = join(
			await mkdtemp(join(tmpdir(), "atlas-retrieval-test-")),
			"atlas.db",
		);
		store = openStore({ path: dbPath, migrate: true });
		seedStore(store);
	});

	afterEach(async () => {
		store.close();
		await rm(dbPath.replace(/\/atlas\.db$/, ""), {
			recursive: true,
			force: true,
		});
	});

	test("classifies query intent deterministically", () => {
		expect(classifyQuery("how do I use the session skill?")).toMatchObject({
			kind: "skill-invocation",
			confidence: "high",
		});
		expect(
			classifyQuery("where is packages/auth/docs/session.md?"),
		).toMatchObject({
			kind: "exact-lookup",
			confidence: "high",
		});
		expect(classifyQuery("packages/auth/docs/session.md")).toMatchObject({
			kind: "exact-lookup",
		});
		expect(
			classifyQuery("How does a maintainer build and publish .moxel/atlas artifacts?"),
		).not.toMatchObject({ kind: "exact-lookup" });
		expect(classifyQuery("compare login and session flows")).toMatchObject({
			kind: "compare",
		});
	});

	test("infers scored package, module, and skill scopes from store metadata", () => {
		const classification = classifyQuery("use the session skill in auth");
		const result = inferScopes({
			db: store,
			query: "use the session skill in auth",
			classification,
			repoId,
		});

		expect(result.scopes[0]).toMatchObject({
			level: "skill",
			id: sessionSkillId,
		});
		expect(
			result.scopes.some(
				(scope) => scope.level === "module" && scope.id === sessionModuleId,
			),
		).toBe(true);
		expect(result.diagnostics[0]).toMatchObject({ stage: "scope-inference" });
	});

	test("scores authority, locality, redundancy, and final rank rationales explicitly", () => {
		const classification = classifyQuery("session rotation usage");
		const scopes = inferScopes({
			db: store,
			query: "session rotation usage",
			classification,
			repoId,
		}).scopes;
		const canonical = candidate(
			"document",
			repoDocId,
			"canonical",
			"docs/architecture.md",
			0.6,
			"Session overview architecture.",
		);
		const local = candidate(
			"section",
			"session-section",
			"preferred",
			"packages/auth/docs/session.md",
			0.7,
			"Session rotation usage examples.",
			{
				packageId: authPackageId,
				moduleId: sessionModuleId,
			},
		);
		const duplicate = candidate(
			"section",
			"session-section-copy",
			"preferred",
			"packages/auth/docs/session-copy.md",
			0.65,
			"Session rotation usage examples.",
			{
				packageId: authPackageId,
				moduleId: sessionModuleId,
			},
		);

		expect(
			authorityWeight({ authority: "canonical", queryKind: "overview" }),
		).toBeGreaterThan(
			authorityWeight({ authority: "supplemental", queryKind: "overview" }),
		);
		expect(localityWeight(local.provenance, scopes)).toBeGreaterThan(
			localityWeight(canonical.provenance, scopes),
		);
		expect(redundancyPenalty(duplicate, [local])).toBeGreaterThan(0);

		const ranked = rankCandidates({
			query: "session rotation usage",
			classification,
			scopes,
			candidates: [canonical, local, duplicate],
		});
		expect(ranked[0]?.targetId).toBe("session-section");
		expect(ranked[0]?.rationale.length).toBeGreaterThan(2);
		expect(ranked[0]?.factors.locality).toBeGreaterThan(0);

		const staleRanked = rankCandidates({
			query: "session rotation usage",
			classification,
			scopes,
			candidates: [local],
			freshnessByRepo: new Map([[repoId, -0.35]]),
		});
		expect(staleRanked[0]?.factors.freshness).toBeLessThan(0);
		expect(staleRanked[0]?.rationale).toContain(
			"Candidate was penalized 0.35 for stale repository freshness.",
		);
	});

	test("plans overview context summary-first without deep expansion when summaries are sufficient", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "what is the auth architecture overview?",
			budgetTokens: 160,
		});

		expect(plan.classification.kind).toBe("overview");
		expect(plan.selected.some((item) => item.targetType === "summary")).toBe(
			true,
		);
		expect(plan.selected.every((item) => item.targetType === "summary")).toBe(
			true,
		);
		expect(plan.usedTokens).toBeLessThanOrEqual(plan.budgetTokens);
		expect(plan.diagnostics.map((diagnostic) => diagnostic.stage)).toContain(
			"candidate-generation",
		);
	});

	test("expands into local sections and chunks for usage queries", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "how do I rotate session tokens?",
			budgetTokens: 220,
		});

		expect(plan.classification.kind).toBe("usage");
		expect(
			plan.selected.some(
				(item) => item.targetType === "section" || item.targetType === "chunk",
			),
		).toBe(true);
		expect(plan.selected[0]?.provenance.moduleId).toBe(sessionModuleId);
		expect(plan.usedTokens).toBeLessThanOrEqual(220);
		expect(plan.confidence).not.toBe("low");
	});

	test("uses path candidates for exact lookup and preserves omitted budget decisions", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "where is packages/auth/docs/session.md",
			budgetTokens: 24,
			summaryLimit: 0,
			expansionLimit: 2,
		});

		expect(plan.classification.kind).toBe("exact-lookup");
		expect(plan.rankedHits[0]?.source).toBe("path");
		expect(plan.usedTokens).toBeLessThanOrEqual(24);
		expect(plan.omitted.length).toBeGreaterThan(0);
	});

	test("emits structured omission diagnostics with reason categories", () => {
		const omitted = [
			plannedItem("budget-item", "Item does not fit remaining token budget."),
			plannedItem(
				"authority-item",
				"Lower authority supplemental candidate omitted.",
			),
			plannedItem(
				"freshness-item",
				"Candidate was penalized for stale repository freshness.",
			),
			plannedItem("archive-item", "Archive historical doc excluded."),
			plannedItem(
				"redundancy-item",
				"Skipped redundant expansion from an already selected document.",
			),
		];
		const context = finalizeContext({
			query: "session token budget",
			classification: classifyQuery("session token budget"),
			scopes: [],
			state: {
				budgetTokens: 50,
				usedTokens: 0,
				selected: [],
				omitted,
				warnings: [],
			},
			rankedHits: [],
			diagnostics: [],
		});

		expect(context.usedTokens).toBeLessThanOrEqual(context.budgetTokens);
		expect(context.omissionDiagnostics.map((item) => item.reason)).toEqual([
			"budget",
			"authority",
			"freshness",
			"archive",
			"redundancy",
		]);
		expect(context.contextPacket.omissionDiagnostics).toEqual(
			context.omissionDiagnostics,
		);
	});

	test("recovers candidates for natural-language queries with no strict lexical AND match", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "How should operators renew session credentials with nonexistent jargon?",
			budgetTokens: 220,
		});

		expect(plan.rankedHits.length).toBeGreaterThan(0);
		expect(
			plan.rankedHits.some((hit) => hit.provenance.docId === sessionDocId),
		).toBe(true);
	});

	test("adds broad fallback candidates from document metadata when lexical search is sparse", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "How do payment ledger aliases work?",
			budgetTokens: 220,
		});

		expect(
			plan.rankedHits.some((hit) => hit.provenance.docId === invoiceDocId),
		).toBe(true);
		expect(
			plan.rankedHits.some((hit) =>
				hit.rationale.some((item) => item.includes("broad fallback")),
			),
		).toBe(true);
	});

	test("surfaces low-confidence ambiguity for no-result queries", () => {
		const plan = planContext({
			db: store,
			repoId,
			query: "where is the quantum cache scheduler?",
			budgetTokens: 120,
		});

		expect(plan.selected).toEqual([]);
		expect(plan.confidence).toBe("low");
		expect(plan.ambiguity).toMatchObject({
			status: "ambiguous",
			reason: "No retrieval candidates matched the query.",
		});
	});

	test("does not import source adapters or indexer from retrieval code", async () => {
		const forbiddenImports = [
			"@atlas/source-git",
			"@atlas/source-ghes",
			"@atlas/indexer",
		];
		const files = await listTypeScriptFiles("packages/retrieval/src");

		for (const file of files.filter(
			(path) => !path.endsWith("retrieval.test.ts"),
		)) {
			const content = await readFile(file, "utf8");
			for (const forbiddenImport of forbiddenImports) {
				expect(
					content,
					`${file} must not import ${forbiddenImport}`,
				).not.toContain(forbiddenImport);
			}
		}
	});
});

function plannedItem(targetId: string, reason: string): PlannedItem {
	return {
		targetType: "section",
		targetId,
		tokenCount: 10,
		provenance: {
			repoId,
			docId: sessionDocId,
			path: `packages/auth/docs/${targetId}.md`,
			sourceVersion: "rev_1",
			authority: "preferred",
		},
		rationale: [reason],
	};
}

function seedStore(store: AtlasStoreClient): void {
	new RepoRepository(store).upsert({
		repoId,
		mode: "local-git",
		revision: "rev_1",
	});
	new PackageRepository(store).upsert({
		packageId: authPackageId,
		repoId,
		name: "@atlas/auth",
		path: "packages/auth",
		manifestPath: "packages/auth/package.json",
	});
	new PackageRepository(store).upsert({
		packageId: billingPackageId,
		repoId,
		name: "@atlas/billing",
		path: "packages/billing",
		manifestPath: "packages/billing/package.json",
	});
	new ModuleRepository(store).upsert({
		moduleId: sessionModuleId,
		repoId,
		packageId: authPackageId,
		name: "session",
		path: "packages/auth/src/session",
	});
	new ModuleRepository(store).upsert({
		moduleId: loginModuleId,
		repoId,
		packageId: authPackageId,
		name: "login",
		path: "packages/auth/src/login",
	});
	new ModuleRepository(store).upsert({
		moduleId: invoiceModuleId,
		repoId,
		packageId: billingPackageId,
		name: "invoice",
		path: "packages/billing/src/invoice",
	});

	const documents = [
		createDocument({
			docId: repoDocId,
			path: "docs/architecture.md",
			title: "Architecture",
			kind: "repo-doc",
			authority: "canonical",
			sections: [
				{
					heading: ["Architecture"],
					text: "Auth architecture coordinates login and session modules.",
					packageId: undefined,
					moduleId: undefined,
				},
			],
		}),
		createDocument({
			docId: sessionDocId,
			path: "packages/auth/docs/session.md",
			title: "Session",
			kind: "module-doc",
			authority: "preferred",
			packageId: authPackageId,
			moduleId: sessionModuleId,
			sections: [
				{
					heading: ["Session", "Rotation"],
					text: "Rotate session tokens by calling rotateSessionToken during renewal.",
					packageId: authPackageId,
					moduleId: sessionModuleId,
				},
			],
		}),
		createDocument({
			docId: loginDocId,
			path: "packages/auth/docs/login.md",
			title: "Login",
			kind: "module-doc",
			authority: "preferred",
			packageId: authPackageId,
			moduleId: loginModuleId,
			sections: [
				{
					heading: ["Login"],
					text: "Login exchanges credentials for a session token.",
					packageId: authPackageId,
					moduleId: loginModuleId,
				},
			],
		}),
		createDocument({
			docId: invoiceDocId,
			path: "packages/billing/docs/invoice.md",
			title: "Invoice",
			kind: "module-doc",
			authority: "supplemental",
			packageId: billingPackageId,
			moduleId: invoiceModuleId,
			description: "Payment ledger aliases for finance operators.",
			sections: [
				{
					heading: ["Invoice"],
					text: "Invoice docs describe billing reconciliation.",
					packageId: billingPackageId,
					moduleId: invoiceModuleId,
				},
			],
		}),
	];

	const docRepo = new DocRepository(store);
	const summaryRepo = new SummaryRepository(store);
	const chunkRepo = new ChunkRepository(store);
	for (const document of documents) {
		docRepo.replaceCanonicalDocument(document);
		summaryRepo.replaceForTarget("document", document.docId, [
			{
				summaryId: `${document.docId}:summary`,
				targetType: "document",
				targetId: document.docId,
				level: "short",
				text: `${document.title ?? document.path}: ${document.sections[0]?.text ?? ""}`,
				tokenCount: 18,
			},
		]);
		const section = document.sections[0];
		if (section !== undefined) {
			const chunk: CorpusChunk = {
				chunkId: createChunkId({
					docId: document.docId,
					sectionId: section.sectionId,
					ordinal: 0,
				}),
				docId: document.docId,
				repoId,
				...(document.metadata.packageId === undefined
					? {}
					: { packageId: document.metadata.packageId }),
				...(document.metadata.moduleId === undefined
					? {}
					: { moduleId: document.metadata.moduleId }),
				kind: document.kind,
				authority: document.authority,
				headingPath: section.headingPath,
				ordinal: 0,
				text: section.text,
				tokenCount: 14,
			};
			chunkRepo.replaceForDocument(document.docId, [chunk]);
		}
	}

	new SkillRepository(store).upsert({
		node: {
			skillId: sessionSkillId,
			repoId,
			packageId: authPackageId,
			moduleId: sessionModuleId,
			path: "packages/auth/docs/session-skill.md",
			title: "Session Skill",
			sourceDocPath: "packages/auth/docs/session.md",
			topics: ["session"],
			aliases: ["session rotation"],
			tokenCount: 18,
			diagnostics: [],
		},
		sourceDocId: sessionDocId,
		description: "Use this skill to answer session token operation questions.",
		headings: [["Session", "Rotation"]],
		keySections: [
			"Rotate session tokens by calling rotateSessionToken during renewal.",
		],
		topics: ["session"],
		aliases: ["session rotation"],
		tokenCount: 18,
	});
}

interface DocumentFixture {
	readonly docId: string;
	readonly path: string;
	readonly title: string;
	readonly kind: CanonicalDocument["kind"];
	readonly authority: CanonicalDocument["authority"];
	readonly packageId?: string | undefined;
	readonly moduleId?: string | undefined;
	readonly description?: string | undefined;
	readonly sections: readonly SectionFixture[];
}

interface SectionFixture {
	readonly heading: readonly string[];
	readonly text: string;
	readonly packageId?: string | undefined;
	readonly moduleId?: string | undefined;
}

function createDocument(fixture: DocumentFixture): CanonicalDocument {
	return {
		docId: fixture.docId,
		repoId,
		path: fixture.path,
		sourceVersion: "rev_1",
		title: fixture.title,
		kind: fixture.kind,
		authority: fixture.authority,
		scopes:
			fixture.moduleId === undefined
				? [{ level: "repo", repoId }]
				: [
						{
							level: "module",
							repoId,
							...(fixture.packageId === undefined
								? {}
								: { packageId: fixture.packageId }),
							moduleId: fixture.moduleId,
						},
					],
		sections: fixture.sections.map((section, ordinal) => ({
			sectionId: createSectionId({
				docId: fixture.docId,
				headingPath: section.heading,
				ordinal,
			}),
			headingPath: [...section.heading],
			ordinal,
			text: section.text,
			codeBlocks: section.heading.includes("Rotation")
				? [{ lang: "ts", code: "rotateSessionToken(sessionId);" }]
				: [],
		})),
		metadata: {
			...(fixture.packageId === undefined
				? {}
				: { packageId: fixture.packageId }),
			...(fixture.moduleId === undefined ? {} : { moduleId: fixture.moduleId }),
			...(fixture.description === undefined
				? {}
				: { description: fixture.description }),
			tags: [fixture.title.toLowerCase()],
		},
	};
}

async function listTypeScriptFiles(root: string): Promise<string[]> {
	const entries = await readdir(root);
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry);
		const info = await stat(path);
		if (info.isDirectory()) {
			files.push(...(await listTypeScriptFiles(path)));
		} else if (path.endsWith(".ts")) {
			files.push(path);
		}
	}
	return files;
}

function candidate(
	targetType: RetrievalCandidate["targetType"],
	targetId: string,
	authority: RetrievalCandidate["authority"],
	path: string,
	score: number,
	textPreview: string,
	scope: { packageId?: string; moduleId?: string } = {},
): RetrievalCandidate {
	return {
		targetType,
		targetId,
		authority,
		score,
		tokenCount: 12,
		textPreview,
		provenance: {
			repoId,
			...(scope.packageId === undefined ? {} : { packageId: scope.packageId }),
			...(scope.moduleId === undefined ? {} : { moduleId: scope.moduleId }),
			docId: targetId,
			path,
			sourceVersion: "rev_1",
			authority,
		},
		source: "manual",
		rationale: ["test candidate"],
	};
}
