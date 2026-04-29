import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
	ManifestRepository,
	ModuleRepository,
	openStore,
	PackageRepository,
	RepoRepository,
	SectionRepository,
	SkillRepository,
	SummaryRepository,
} from "@atlas/store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import * as publicMcp from "./index";
import { answerFromLocalDocsPrompt } from "./prompts/answer-from-local-docs.prompt";
import { compareDocsPrompt } from "./prompts/compare-docs.prompt";
import { onboardToRepoPrompt } from "./prompts/onboard-to-repo.prompt";
import { summarizeModulePrompt } from "./prompts/summarize-module.prompt";
import { documentResource } from "./resources/document.resource";
import { manifestResource } from "./resources/manifest.resource";
import { moduleResource } from "./resources/module.resource";
import { packageResource } from "./resources/package.resource";
import { repoResource } from "./resources/repo.resource";
import { skillResource } from "./resources/skill.resource";
import { skillArtifactResource } from "./resources/skill-artifact.resource";
import { summaryResource } from "./resources/summary.resource";
import { readSectionInputSchema } from "./schemas/tool-schemas";
import { createAtlasMcpServer } from "./server/create-mcp-server";
import {
	createAtlasTransport,
	createStdioTransport,
	createStreamableHttpTransport,
} from "./server/transports";
import { executeExpandRelated } from "./tools/expand-related.tool";
import { executeExplainModule } from "./tools/explain-module.tool";
import { executeFindDocs } from "./tools/find-docs.tool";
import { executeFindScopes } from "./tools/find-scopes.tool";
import { executeGetFreshness } from "./tools/get-freshness.tool";
import { executeGetSkill } from "./tools/get-skill.tool";
import { executeListSkills } from "./tools/list-skills.tool";
import { executePlanContext } from "./tools/plan-context.tool";
import { executeReadOutline } from "./tools/read-outline.tool";
import { executeReadSection } from "./tools/read-section.tool";
import { executeUseSkill } from "./tools/use-skill.tool";
import { executeWhatChanged } from "./tools/what-changed.tool";

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
	headingPath: ["Session", "Rotation"],
	ordinal: 0,
});
const skillId = createSkillId({
	repoId,
	packageId,
	moduleId,
	path: "packages/auth/docs/session-skill.md",
});
const documentSummaryId = `${docId}:summary`;
const relatedDocId = createDocId({
	repoId,
	path: "packages/auth/docs/session-renewal.md",
});
const relatedSectionId = createSectionId({
	docId: relatedDocId,
	headingPath: ["Session", "Renewal"],
	ordinal: 0,
});

describe("mcp package", () => {
	test("public barrel exports first-party skill MCP surface", () => {
		expect(publicMcp.USE_SKILL_TOOL).toBe("use_skill");
		expect(publicMcp.executeUseSkill).toBeFunction();
		expect(publicMcp.registerUseSkillTool).toBeFunction();
		expect(publicMcp.useSkillInputSchema).toBeDefined();
		expect(publicMcp.skillArtifactResource).toBeDefined();
	});
	let dbPath: string;
	let store: AtlasStoreClient;

	beforeEach(async () => {
		dbPath = join(await mkdtemp(join(tmpdir(), "atlas-mcp-test-")), "atlas.db");
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

	test("validates tool input schemas strictly", () => {
		expect(() => readSectionInputSchema.parse({ docId })).toThrow();
		expect(readSectionInputSchema.parse({ docId, sectionId })).toMatchObject({
			docId,
			sectionId,
		});
	});

	test("executes retrieval-backed tool contracts", () => {
		const dependencies = { db: store };

		expect(
			executeFindScopes(
				{ query: "session rotation skill", repoId, limit: 4 },
				dependencies,
			).scopes,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ level: "skill", id: skillId }),
			]),
		);
		expect(
			executeFindDocs(
				{ query: "session rotation", repoId, limit: 5 },
				dependencies,
			).hits,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provenance: expect.objectContaining({ docId }),
				}),
			]),
		);
		const plannedContext = executePlanContext(
			{ query: "how do I rotate session tokens?", repoId, budgetTokens: 200 },
			dependencies,
		);
		expect(plannedContext).toMatchObject({
			query: "how do I rotate session tokens?",
			confidence: expect.any(String),
			selected: expect.any(Array),
			contextPacket: {
				evidence: expect.arrayContaining([
					expect.objectContaining({
						label: "session",
						scopeContext: expect.objectContaining({
							module: expect.objectContaining({
								moduleId,
								name: "session",
								path: "packages/auth/src/session",
							}),
						}),
					}),
				]),
				recommendedNextActions: expect.any(Array),
			},
		});
	});

	test("keeps plan_context wired to local retrieval dependencies", async () => {
		const content = await readFile(
			"packages/mcp/src/tools/plan-context.tool.ts",
			"utf8",
		);
		const forbiddenImports = [
			"@atlas/source-git",
			"@atlas/source-ghes",
			"@atlas/indexer",
		];

		expect(content).toContain("@atlas/retrieval");
		expect(content).toContain("dependencies.db");
		for (const forbiddenImport of forbiddenImports) {
			expect(content).not.toContain(forbiddenImport);
		}
	});

	test("executes store-backed read and skill tools", () => {
		const dependencies = { db: store };

		expect(executeReadOutline({ docId }, dependencies)).toMatchObject({
			document: expect.objectContaining({ docId }),
			outline: [expect.objectContaining({ sectionId })],
		});
		expect(
			executeReadSection({ docId, sectionId }, dependencies),
		).toMatchObject({
			section: expect.objectContaining({
				sectionId,
				text: "Rotate session tokens by calling rotateSessionToken during renewal.",
			}),
		});
		expect(executeListSkills({ repoId }, dependencies)).toMatchObject({
			skills: [
				expect.objectContaining({
					skillId,
					topics: ["session"],
					aliases: ["session rotation"],
					tokenCount: 18,
					invocationAliases: expect.arrayContaining([
						"$atlas-session",
						"$atlas-session-skill",
					]),
					artifactSummary: {
						scripts: 1,
						references: 1,
						agentProfiles: 1,
						other: 0,
					},
					hasScripts: true,
				}),
			],
		});
		expect(executeGetSkill({ skillId }, dependencies)).toMatchObject({
			skill: expect.objectContaining({
				skillId,
				topics: ["session"],
				aliases: ["session rotation"],
				tokenCount: 18,
			}),
			provenance: expect.objectContaining({ docId, skillId }),
		});
		expect(
			executeUseSkill(
				{
					nameOrAlias: "$atlas-session-skill",
					repoId,
					task: "rotate tokens",
					agent: "openai",
				},
				dependencies,
			),
		).toMatchObject({
			status: "ok",
			task: "rotate tokens",
			skill: expect.objectContaining({
				skillId,
				invocationAliases: expect.arrayContaining(["$atlas-session-skill"]),
			}),
			instructions: expect.objectContaining({
				description:
					"Use this skill to answer session token operation questions.",
				markdown: expect.stringContaining("Rotate session tokens"),
			}),
			artifacts: expect.arrayContaining([
				expect.objectContaining({
					path: "scripts/check.py",
					kind: "script",
					execution: "served-only",
				}),
				expect.objectContaining({
					path: "references/session.md",
					kind: "reference",
				}),
				expect.objectContaining({
					path: "agents/openai.yaml",
					kind: "agent-profile",
				}),
			]),
			selectedAgentProfile: expect.objectContaining({
				path: "agents/openai.yaml",
			}),
			freshness: expect.objectContaining({ repoId, fresh: true }),
			provenance: expect.objectContaining({ docId, skillId }),
		});
		expect(
			executeUseSkill({ nameOrAlias: "$atlas-missing", repoId }, dependencies),
		).toMatchObject({
			status: "not_found",
			recommendedNextActions: expect.any(Array),
		});
	});

	test("executes source-backed change inspection when a diff provider is configured", async () => {
		const result = await executeWhatChanged(
			{ repoId, fromRevision: "rev_0" },
			{
				db: store,
				sourceDiffProvider: {
					async diff(request) {
						return {
							repoId: request.repoId,
							fromRevision: request.fromRevision,
							toRevision: request.toRevision,
							changes: [
								{
									rawKind: "modified",
									normalizedKind: "modified",
									path: "packages/auth/docs/session.md",
								},
							],
							relevantChanges: [
								{
									rawKind: "modified",
									normalizedKind: "modified",
									path: "packages/auth/docs/session.md",
								},
							],
							relevantDocPaths: ["packages/auth/docs/session.md"],
							topologySensitivePaths: [],
							packageManifestPaths: [],
						};
					},
				},
			},
		);
		expect(result).toMatchObject({
			repo: expect.objectContaining({ repoId, revision: "rev_1" }),
			manifest: expect.objectContaining({ indexedRevision: "rev_1" }),
			requestedRange: { fromRevision: "rev_0", toRevision: "rev_1" },
			sourceDiff: expect.objectContaining({
				available: true,
				fromRevision: "rev_0",
				toRevision: "rev_1",
				relevantDocPaths: ["packages/auth/docs/session.md"],
				changedIndexedDocuments: [expect.objectContaining({ docId })],
			}),
		});
		expect(result.indexedDocuments).toEqual(
			expect.arrayContaining([expect.objectContaining({ docId })]),
		);
	});

	test("reports unavailable source diffs for embedded MCP runtimes without a provider", async () => {
		expect(await executeWhatChanged({ repoId }, { db: store })).toMatchObject({
			requestedRange: { fromRevision: "rev_1", toRevision: "rev_1" },
			sourceDiff: {
				available: false,
				fromRevision: "rev_1",
				toRevision: "rev_1",
				reason: "No source diff provider is configured for this MCP runtime.",
			},
		});
	});

	test("reports local freshness for all repos, filtered repos, and stale revisions", () => {
		expect(executeGetFreshness({}, { db: store })).toMatchObject({
			freshness: [
				expect.objectContaining({
					repoId,
					repoRevision: "rev_1",
					indexedRevision: "rev_1",
					fresh: true,
					stale: false,
					lastSyncAt: expect.any(String),
					manifest: expect.objectContaining({
						repoId,
						indexedRevision: "rev_1",
					}),
				}),
			],
		});
		expect(executeGetFreshness({ repoId }, { db: store })).toMatchObject({
			freshness: [expect.objectContaining({ repoId, fresh: true })],
		});

		new RepoRepository(store).upsert({
			repoId,
			mode: "local-git",
			revision: "rev_2",
		});
		expect(executeGetFreshness({ repoId }, { db: store })).toMatchObject({
			freshness: [
				expect.objectContaining({
					repoId,
					repoRevision: "rev_2",
					indexedRevision: "rev_1",
					fresh: false,
					stale: true,
				}),
			],
		});
		expect(() =>
			executeGetFreshness({ repoId: "missing_repo" }, { db: store }),
		).toThrow("Repository was not found.");
	});

	test("expands related context from document, section, chunk, and summary anchors", () => {
		const dependencies = { db: store };

		const expanded = executeExpandRelated(
			{ targetType: "document", targetId: docId, limit: 3 },
			dependencies,
		);
		expect(expanded).toMatchObject({
			anchor: {
				targetType: "document",
				document: expect.objectContaining({ docId }),
			},
			related: {
				documents: expect.arrayContaining([
					expect.objectContaining({ docId: relatedDocId }),
				]),
				sections: expect.arrayContaining([
					expect.objectContaining({
						sectionId,
						preview: expect.stringContaining("Rotate session tokens"),
					}),
				]),
				summaries: expect.arrayContaining([
					expect.objectContaining({ summaryId: documentSummaryId }),
				]),
				skills: expect.arrayContaining([expect.objectContaining({ skillId })]),
			},
		});
		expect(
			executeExpandRelated(
				{ targetType: "section", targetId: sectionId, limit: 2 },
				dependencies,
			),
		).toMatchObject({
			anchor: {
				targetType: "section",
				section: expect.objectContaining({ sectionId }),
				document: expect.objectContaining({ docId }),
			},
		});
		expect(
			executeExpandRelated(
				{
					targetType: "chunk",
					targetId: createChunkId({ docId, sectionId, ordinal: 0 }),
					limit: 2,
				},
				dependencies,
			),
		).toMatchObject({
			anchor: {
				targetType: "chunk",
				chunk: expect.objectContaining({ docId }),
				document: expect.objectContaining({ docId }),
			},
		});
		expect(
			executeExpandRelated(
				{ targetType: "summary", targetId: documentSummaryId, limit: 2 },
				dependencies,
			),
		).toMatchObject({
			anchor: {
				targetType: "summary",
				summary: expect.objectContaining({ summaryId: documentSummaryId }),
				document: expect.objectContaining({ docId }),
			},
		});
		expect(() =>
			executeExpandRelated(
				{ targetType: "document", targetId: "missing_doc" },
				dependencies,
			),
		).toThrow("Related expansion target was not found.");
	});

	test("explains a module from summaries, documents, sections, skills, and provenance", () => {
		const explained = executeExplainModule(
			{ moduleId, limit: 2 },
			{ db: store },
		);

		expect(explained).toMatchObject({
			module: expect.objectContaining({ moduleId, name: "session" }),
			explanation: "Session module coordinates token rotation and renewal.",
			summaries: {
				module: [
					expect.objectContaining({ targetType: "module", targetId: moduleId }),
				],
			},
			skills: [expect.objectContaining({ skillId })],
		});
		expect(explained.documents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ docId }),
				expect.objectContaining({ docId: relatedDocId }),
			]),
		);
		const summaryPayload = explained.summaries as { documents?: unknown[] };
		expect(Array.isArray(summaryPayload.documents)).toBe(true);
		expect(summaryPayload.documents?.length ?? 0).toBeLessThanOrEqual(2);
		expect(explained.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sectionId,
					preview: expect.stringContaining("Rotate session tokens"),
				}),
			]),
		);
		expect(explained.provenance).toEqual(
			expect.arrayContaining([expect.objectContaining({ docId })]),
		);
		expect(() =>
			executeExplainModule({ moduleId: "missing_module" }, { db: store }),
		).toThrow("Module was not found.");
	});

	test("reads stable resource payloads from atlas URIs", () => {
		const manifestPayload = manifestResource.read(new URL("atlas://manifest"), {
			db: store,
		});
		expect(manifestPayload).toMatchObject({
			manifests: [expect.objectContaining({ repoId })],
			indexedCoverage: [
				expect.objectContaining({
					repoId,
					indexedRevision: "rev_1",
					compilerVersion: "compiler-v1",
					status: "indexed",
					packageCount: 1,
					moduleCount: 1,
					documentCount: 2,
				}),
			],
			agentGuidance: expect.stringContaining(
				"For questions about an indexed repository, call plan_context before answering from memory.",
			),
		});
		expect(JSON.stringify(manifestPayload)).not.toMatch(
			/(token|password|secret|authorization|credential)/i,
		);
		expect(
			repoResource.read(new URL(`atlas://repo/${repoId}`), { db: store }),
		).toMatchObject({
			repo: expect.objectContaining({ repoId }),
			manifest: expect.objectContaining({ repoId, indexedRevision: "rev_1" }),
			freshness: expect.objectContaining({
				repoId,
				repoRevision: "rev_1",
				indexedRevision: "rev_1",
				fresh: true,
				stale: false,
			}),
			packages: [expect.objectContaining({ packageId })],
			modules: [expect.objectContaining({ moduleId })],
			documents: expect.arrayContaining([
				expect.objectContaining({ docId }),
				expect.objectContaining({ docId: relatedDocId }),
			]),
			skills: [expect.objectContaining({ skillId })],
		});
		expect(
			packageResource.read(
				new URL(`atlas://package/${encodeURIComponent(packageId)}`),
				{ db: store },
			),
		).toMatchObject({
			package: expect.objectContaining({ packageId }),
			repo: expect.objectContaining({ repoId }),
			manifest: expect.objectContaining({ repoId }),
			modules: [expect.objectContaining({ moduleId })],
			documents: expect.arrayContaining([
				expect.objectContaining({ docId }),
				expect.objectContaining({ docId: relatedDocId }),
			]),
			skills: [expect.objectContaining({ skillId })],
		});
		expect(
			moduleResource.read(
				new URL(`atlas://module/${encodeURIComponent(moduleId)}`),
				{ db: store },
			),
		).toMatchObject({
			module: expect.objectContaining({ moduleId }),
			repo: expect.objectContaining({ repoId }),
			package: expect.objectContaining({ packageId }),
			manifest: expect.objectContaining({ repoId }),
			documents: expect.arrayContaining([
				expect.objectContaining({ docId }),
				expect.objectContaining({ docId: relatedDocId }),
			]),
			summaries: [
				expect.objectContaining({ targetType: "module", targetId: moduleId }),
			],
			skills: [expect.objectContaining({ skillId })],
		});
		expect(
			documentResource.read(new URL(`atlas://document/${docId}`), {
				db: store,
			}),
		).toMatchObject({
			document: expect.objectContaining({ docId }),
			outline: [expect.objectContaining({ sectionId })],
		});
		expect(
			skillResource.read(new URL(`atlas://skill/${skillId}`), { db: store }),
		).toMatchObject({
			skill: expect.objectContaining({
				skillId,
				topics: ["session"],
				aliases: ["session rotation"],
				tokenCount: 18,
			}),
			artifacts: expect.arrayContaining([
				expect.objectContaining({ path: "scripts/check.py" }),
			]),
			repo: expect.objectContaining({ repoId }),
			package: expect.objectContaining({ packageId }),
			module: expect.objectContaining({ moduleId }),
			manifest: expect.objectContaining({ repoId }),
			sourceDocument: expect.objectContaining({ docId }),
			sourceDocumentSummaries: expect.arrayContaining([
				expect.objectContaining({ summaryId: documentSummaryId }),
			]),
			sourceOutline: [expect.objectContaining({ sectionId })],
			provenance: expect.objectContaining({ docId, skillId }),
		});
		expect(
			skillArtifactResource.read(
				new URL(
					`atlas://skill-artifact/${encodeURIComponent(skillId)}/scripts/check.py`,
				),
				{ db: store },
			),
		).toMatchObject({
			artifact: expect.objectContaining({
				skillId,
				path: "scripts/check.py",
				content: "print('ok')",
			}),
			executionPolicy: "served-only",
		});
		expect(
			summaryResource.read(
				new URL(`atlas://summary/${encodeURIComponent(documentSummaryId)}`),
				{ db: store },
			),
		).toMatchObject({
			summary: expect.objectContaining({
				summaryId: documentSummaryId,
				targetType: "document",
				targetId: docId,
			}),
		});
	});

	test("declares reusable prompts and creates a registered server surface", () => {
		expect(answerFromLocalDocsPrompt.text).toContain("provenance");
		expect(onboardToRepoPrompt.text).toContain("atlas://repo/{repoId}");
		expect(onboardToRepoPrompt.text).toContain("provenance");
		expect(summarizeModulePrompt.text).toContain("explain_module");
		expect(summarizeModulePrompt.text).toContain("provenance");
		expect(compareDocsPrompt.text).toContain("find_docs");
		expect(compareDocsPrompt.text).toContain("provenance");

		const atlasServer = createAtlasMcpServer({ db: store });
		expect(atlasServer.tools).toEqual([
			"find_scopes",
			"find_docs",
			"read_outline",
			"read_section",
			"expand_related",
			"explain_module",
			"list_skills",
			"get_skill",
			"use_skill",
			"get_freshness",
			"plan_context",
			"what_changed",
		]);
		expect(atlasServer.resources).toContain("atlas-document");
		expect(atlasServer.resources).toContain("atlas-summary");
		expect(atlasServer.resources).toContain("atlas-skill-artifact");
		expect(atlasServer.prompts).toEqual([
			"answer_from_local_docs",
			"onboard_to_module",
			"onboard_to_repo",
			"summarize_module",
			"compare_docs",
			"explain_skill_usage",
		]);
		expect(
			atlasServer.diagnostics.map((diagnostic) => diagnostic.stage),
		).toEqual(["tool", "resource", "prompt", "server"]);
	});

	test("serves successful MCP tool calls through the SDK server", async () => {
		const atlasServer = createAtlasMcpServer({ db: store });
		const client = new Client(
			{ name: "atlas-mcp-test-client", version: "0.0.0" },
			{ capabilities: {} },
		);
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		await Promise.all([
			atlasServer.server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		const result = await client.callTool({
			name: "read_outline",
			arguments: { docId },
		});

		expect(result.structuredContent).toMatchObject({
			document: expect.objectContaining({ docId }),
			outline: [expect.objectContaining({ sectionId })],
		});

		await Promise.all([client.close(), atlasServer.server.close()]);
	});

	test("creates isolated stdio and streamable HTTP transports", async () => {
		const stdio = createStdioTransport();
		expect(stdio).toBeDefined();
		const http = createStreamableHttpTransport();
		expect(http).toBeDefined();
		expect(
			createAtlasTransport({ mode: "streamable-http", http: {} }),
		).toBeDefined();
		await http.close();
	});

	test("list_skills and use_skill expose first-party skill artifacts", () => {
		const documentCodebaseDocId = createDocId({
			repoId,
			path: "skills/document-codebase/SKILL.md",
		});
		const documentCodebaseSectionId = createSectionId({
			docId: documentCodebaseDocId,
			headingPath: ["Document Codebase"],
			ordinal: 0,
		});
		const documentCodebaseSkillId = createSkillId({
			repoId,
			path: "skills/document-codebase/SKILL.md",
		});
		const skillCreatorDocId = createDocId({
			repoId,
			path: "skills/skill-creator/SKILL.md",
		});
		const skillCreatorSectionId = createSectionId({
			docId: skillCreatorDocId,
			headingPath: ["Skill Creator"],
			ordinal: 0,
		});
		const skillCreatorSkillId = createSkillId({
			repoId,
			path: "skills/skill-creator/SKILL.md",
		});

		new DocRepository(store).replaceCanonicalDocument({
			docId: documentCodebaseDocId,
			repoId,
			path: "skills/document-codebase/SKILL.md",
			sourceVersion: "rev_1",
			title: "Document Codebase",
			kind: "skill-doc",
			authority: "canonical",
			scopes: [{ level: "repo", repoId }],
			sections: [
				{
					sectionId: documentCodebaseSectionId,
					headingPath: ["Document Codebase"],
					ordinal: 0,
					text: "Inventory source and docs before updating codebase documentation.",
					codeBlocks: [],
				},
			],
			metadata: {
				visibility: "public",
				audience: ["contributor", "maintainer"],
				purpose: ["workflow"],
				tags: [],
			},
		});
		new DocRepository(store).replaceCanonicalDocument({
			docId: skillCreatorDocId,
			repoId,
			path: "skills/skill-creator/SKILL.md",
			sourceVersion: "rev_1",
			title: "Skill Creator",
			kind: "skill-doc",
			authority: "canonical",
			scopes: [{ level: "repo", repoId }],
			sections: [
				{
					sectionId: skillCreatorSectionId,
					headingPath: ["Skill Creator"],
					ordinal: 0,
					text: "Research Atlas docs and source structure before recommending skill assets.",
					codeBlocks: [],
				},
			],
			metadata: {
				visibility: "public",
				audience: ["contributor", "maintainer"],
				purpose: ["workflow"],
				tags: [],
			},
		});
		new SectionRepository(store).replaceForDocument(documentCodebaseDocId, [
			{
				sectionId: documentCodebaseSectionId,
				headingPath: ["Document Codebase"],
				ordinal: 0,
				text: "Inventory source and docs before updating codebase documentation.",
				codeBlocks: [],
			},
		]);
		new SectionRepository(store).replaceForDocument(skillCreatorDocId, [
			{
				sectionId: skillCreatorSectionId,
				headingPath: ["Skill Creator"],
				ordinal: 0,
				text: "Research Atlas docs and source structure before recommending skill assets.",
				codeBlocks: [],
			},
		]);
		new SkillRepository(store).upsert({
			node: {
				skillId: documentCodebaseSkillId,
				repoId,
				path: "skills/document-codebase/SKILL.md",
				title: "Document Codebase",
				sourceDocPath: "skills/document-codebase/SKILL.md",
				topics: ["documentation"],
				aliases: [],
				tokenCount: 24,
				diagnostics: [],
			},
			sourceDocId: documentCodebaseDocId,
			description: "Analyze source truth and update durable codebase docs.",
			headings: [["Document Codebase"]],
			keySections: [
				"Inventory source and docs before updating codebase documentation.",
			],
			topics: ["documentation"],
			aliases: [],
			tokenCount: 24,
			artifacts: [
				{
					skillId: documentCodebaseSkillId,
					path: "references/documentation-patterns.md",
					kind: "reference",
					contentHash: "hash_doc_patterns",
					sizeBytes: 32,
					mimeType: "text/markdown",
					content: "# Documentation patterns",
				},
				{
					skillId: documentCodebaseSkillId,
					path: "scripts/inventory_codebase_docs.py",
					kind: "script",
					contentHash: "hash_inventory",
					sizeBytes: 18,
					mimeType: "text/x-python",
					content: "print('inventory')",
				},
				{
					skillId: documentCodebaseSkillId,
					path: "scripts/check_markdown_links.py",
					kind: "script",
					contentHash: "hash_links",
					sizeBytes: 14,
					mimeType: "text/x-python",
					content: "print('links')",
				},
				{
					skillId: documentCodebaseSkillId,
					path: "agents/openai.yaml",
					kind: "agent-profile",
					contentHash: "hash_openai",
					sizeBytes: 20,
					mimeType: "application/yaml",
					content: "interface:\n  model: openai",
				},
			],
		});
		new SkillRepository(store).upsert({
			node: {
				skillId: skillCreatorSkillId,
				repoId,
				path: "skills/skill-creator/SKILL.md",
				title: "Skill Creator",
				sourceDocPath: "skills/skill-creator/SKILL.md",
				topics: ["skills", "workflow"],
				aliases: [],
				tokenCount: 32,
				diagnostics: [],
			},
			sourceDocId: skillCreatorDocId,
			description:
				"Research Atlas docs and create only explicitly approved skill assets.",
			headings: [["Skill Creator"]],
			keySections: [
				"Research Atlas docs and source structure before recommending skill assets.",
			],
			topics: ["skills", "workflow"],
			aliases: [],
			tokenCount: 32,
			artifacts: [
				{
					skillId: skillCreatorSkillId,
					path: "references/skill-spec-template.md",
					kind: "reference",
					contentHash: "hash_skill_creator_template",
					sizeBytes: 44,
					mimeType: "text/markdown",
					content: "# Skill spec template",
				},
			],
		});

		const listResult = executeListSkills({ repoId }, { db: store });
		const skills = listResult.skills as Array<{
			sourceDocPath: string;
			title: string;
			invocationAliases: string[];
			artifactSummary: {
				references: number;
				scripts: number;
				agentProfiles: number;
			};
		}>;
		const skill = skills.find(
			(entry) => entry.sourceDocPath === "skills/document-codebase/SKILL.md",
		);
		expect(skill).toMatchObject({
			title: "Document Codebase",
			invocationAliases: expect.arrayContaining(["$atlas-document-codebase"]),
			artifactSummary: { references: 1, scripts: 2, agentProfiles: 1 },
		});
		const skillCreator = skills.find(
			(entry) => entry.sourceDocPath === "skills/skill-creator/SKILL.md",
		);
		expect(skillCreator).toMatchObject({
			title: "Skill Creator",
			invocationAliases: expect.arrayContaining(["$atlas-skill-creator"]),
			artifactSummary: { references: 1 },
		});

		const useResult = executeUseSkill(
			{ nameOrAlias: "$atlas-document-codebase", repoId },
			{ db: store },
		);
		expect(useResult).toMatchObject({
			status: "ok",
			instructions: {
				sourceDocumentPath: "skills/document-codebase/SKILL.md",
			},
		});
		const artifacts = useResult.artifacts as Array<{
			uri: string;
			path: string;
			execution: string;
		}>;
		expect(artifacts.map((artifact) => artifact.uri).join("\n")).toContain(
			"references/documentation-patterns.md",
		);
		expect(
			artifacts.find(
				(artifact) => artifact.path === "scripts/check_markdown_links.py",
			),
		).toMatchObject({ execution: "served-only" });

		const skillCreatorUseResult = executeUseSkill(
			{ nameOrAlias: "$atlas-skill-creator", repoId },
			{ db: store },
		);
		expect(skillCreatorUseResult).toMatchObject({
			status: "ok",
			instructions: {
				sourceDocumentPath: "skills/skill-creator/SKILL.md",
			},
		});
		const skillCreatorArtifacts = skillCreatorUseResult.artifacts as Array<{
			path: string;
			uri: string;
		}>;
		expect(skillCreatorArtifacts.map((artifact) => artifact.path)).toContain(
			"references/skill-spec-template.md",
		);
		expect(
			skillCreatorArtifacts.map((artifact) => artifact.uri).join("\n"),
		).toContain("references/skill-spec-template.md");
	});

	test("identity metadata resources skills and generic tools stay stable", () => {
		const server = createAtlasMcpServer({
			db: store,
			identity: {
				name: "acme-knowledge",
				title: "Acme Knowledge MCP",
				resourcePrefix: "acme",
			},
		});
		expect(
			server.diagnostics.find((diagnostic) => diagnostic.stage === "server")
				?.metadata,
		).toMatchObject({
			metadata: { name: "acme-knowledge", title: "Acme Knowledge MCP" },
		});
		expect(server.resources).toEqual(
			expect.arrayContaining(["acme-document", "acme-summary"]),
		);
		expect(server.resources).not.toContain("atlas-document");
		const documentUriTemplate = String(
			(documentResource.uri as { uriTemplate: unknown }).uriTemplate,
		);
		expect(documentUriTemplate).toContain("atlas://");
		expect(documentUriTemplate).not.toContain("acme://");
		expect(server.tools).toEqual(
			expect.arrayContaining([
				"find_docs",
				"read_outline",
				"read_section",
				"plan_context",
				"list_skills",
				"use_skill",
			]),
		);
		const skill = (
			executeListSkills(
				{ repoId },
				{ db: store, identity: { resourcePrefix: "acme" } },
			).skills as { invocationAliases: string[] }[]
		)[0];
		expect(skill?.invocationAliases).toEqual(
			expect.arrayContaining(["$acme-session-skill"]),
		);
		expect(
			executeUseSkill(
				{ nameOrAlias: "$acme-session-skill", repoId },
				{ db: store, identity: { resourcePrefix: "acme" } },
			),
		).toMatchObject({ status: "ok" });
	});
});

function seedStore(store: AtlasStoreClient): void {
	new RepoRepository(store).upsert({
		repoId,
		mode: "local-git",
		revision: "rev_1",
	});
	new ManifestRepository(store).upsert({
		repoId,
		indexedRevision: "rev_1",
		compilerVersion: "compiler-v1",
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

	const document = createDocument();
	new DocRepository(store).replaceCanonicalDocument(document);
	new DocRepository(store).replaceCanonicalDocument(createRelatedDocument());
	new SummaryRepository(store).replaceForTarget("module", moduleId, [
		{
			summaryId: `${moduleId}:summary`,
			targetType: "module",
			targetId: moduleId,
			level: "short",
			text: "Session module coordinates token rotation and renewal.",
			tokenCount: 8,
		},
	]);
	new SummaryRepository(store).replaceForTarget("document", docId, [
		{
			summaryId: documentSummaryId,
			targetType: "document",
			targetId: docId,
			level: "short",
			text: "Session docs explain token rotation.",
			tokenCount: 8,
		},
		{
			summaryId: `${docId}:outline`,
			targetType: "document",
			targetId: docId,
			level: "outline",
			text: "Session > Rotation",
			tokenCount: 5,
		},
	]);
	new SummaryRepository(store).replaceForTarget("skill", skillId, [
		{
			summaryId: `${skillId}:summary`,
			targetType: "skill",
			targetId: skillId,
			level: "short",
			text: "Use for session token operation questions.",
			tokenCount: 8,
		},
	]);
	new SummaryRepository(store).replaceForTarget("document", relatedDocId, [
		{
			summaryId: `${relatedDocId}:summary`,
			targetType: "document",
			targetId: relatedDocId,
			level: "short",
			text: "Session renewal docs describe related rotation flows.",
			tokenCount: 8,
		},
	]);
	new ChunkRepository(store).replaceForDocument(docId, [createChunk()]);
	new SkillRepository(store).upsert({
		node: {
			skillId,
			repoId,
			packageId,
			moduleId,
			path: "packages/auth/docs/session-skill.md",
			title: "Session Skill",
			sourceDocPath: "packages/auth/docs/session.md",
			topics: ["session"],
			aliases: ["session rotation"],
			tokenCount: 18,
			diagnostics: [],
		},
		sourceDocId: docId,
		description: "Use this skill to answer session token operation questions.",
		headings: [["Session", "Rotation"]],
		keySections: [
			"Rotate session tokens by calling rotateSessionToken during renewal.",
		],
		topics: ["session"],
		aliases: ["session rotation"],
		tokenCount: 18,
		artifacts: [
			{
				skillId,
				path: "agents/openai.yaml",
				kind: "agent-profile",
				contentHash: "hash_agent",
				sizeBytes: 28,
				mimeType: "application/yaml",
				content: "interface:\n  display_name: Session",
			},
			{
				skillId,
				path: "references/session.md",
				kind: "reference",
				contentHash: "hash_reference",
				sizeBytes: 20,
				mimeType: "text/markdown",
				content: "# Session reference",
			},
			{
				skillId,
				path: "scripts/check.py",
				kind: "script",
				contentHash: "hash_script",
				sizeBytes: 11,
				mimeType: "text/x-python",
				content: "print('ok')",
			},
		],
	});
}

function createRelatedDocument(): CanonicalDocument {
	return {
		docId: relatedDocId,
		repoId,
		path: "packages/auth/docs/session-renewal.md",
		sourceVersion: "rev_1",
		title: "Session Renewal",
		kind: "module-doc",
		authority: "preferred",
		scopes: [{ level: "module", repoId, packageId, moduleId }],
		sections: [
			{
				sectionId: relatedSectionId,
				headingPath: ["Session", "Renewal"],
				ordinal: 0,
				text: "Renew session tokens before expiration and reuse rotation guidance.",
				codeBlocks: [],
			},
		],
		metadata: {
			packageId,
			moduleId,
			tags: ["session"],
		},
	};
}

function createDocument(): CanonicalDocument {
	return {
		docId,
		repoId,
		path: "packages/auth/docs/session.md",
		sourceVersion: "rev_1",
		title: "Session",
		kind: "module-doc",
		authority: "preferred",
		scopes: [{ level: "module", repoId, packageId, moduleId }],
		sections: [
			{
				sectionId,
				headingPath: ["Session", "Rotation"],
				ordinal: 0,
				text: "Rotate session tokens by calling rotateSessionToken during renewal.",
				codeBlocks: [{ lang: "ts", code: "rotateSessionToken(sessionId);" }],
			},
		],
		metadata: {
			packageId,
			moduleId,
			tags: ["session"],
		},
	};
}

function createChunk(): CorpusChunk {
	return {
		chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
		docId,
		repoId,
		packageId,
		moduleId,
		kind: "module-doc",
		authority: "preferred",
		headingPath: ["Session", "Rotation"],
		ordinal: 0,
		text: "Rotate session tokens by calling rotateSessionToken during renewal.",
		tokenCount: 12,
	};
}
