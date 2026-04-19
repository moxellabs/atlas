import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAtlasConfig } from "@atlas/config";
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
import type {
	BuildBatchReport,
	BuildReport,
	IndexerService,
	SyncBatchReport,
	SyncReport,
} from "@atlas/indexer";
import {
	type AtlasStoreClient,
	ChunkRepository,
	DocRepository,
	ManifestRepository,
	ModuleRepository,
	openStore,
	PackageRepository,
	RepoRepository,
	SkillRepository,
	SummaryRepository,
} from "@atlas/store";

import { createApp } from "./app";
import type { ServerEnv } from "./env";
import { loadServerEnv } from "./env";
import { SCALAR_CDN_URL } from "./openapi/moxel-theme";
import { BuildOperationsService } from "./services/build-operations.service";
import { McpBridgeService } from "./services/mcp-bridge.service";
import { RetrievalHttpService } from "./services/retrieval-http.service";
import { StoreReadService } from "./services/store-read.service";
import type { AtlasServerDependencies } from "./services/types";

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

describe("server app", () => {
	let dbPath: string;
	let store: AtlasStoreClient;
	let app: ReturnType<typeof createApp>;

	beforeEach(async () => {
		dbPath = join(
			await mkdtemp(join(tmpdir(), "atlas-server-test-")),
			"atlas.db",
		);
		store = openStore({ path: dbPath, migrate: true });
		seedStore(store);
		app = createApp(createDependencies(store, dbPath));
	});

	afterEach(async () => {
		store.close();
		await rm(dbPath.replace(/\/atlas\.db$/, ""), {
			recursive: true,
			force: true,
		});
	});

	test("validates server environment defaults and overrides", () => {
		expect(loadServerEnv({})).toMatchObject({
			host: "127.0.0.1",
			port: 3000,
			enableUi: false,
			enableMcp: true,
		});
		expect(
			loadServerEnv({
				ATLAS_HOST: "0.0.0.0",
				ATLAS_PORT: "40789",
				ATLAS_ENABLE_UI: "false",
			}),
		).toMatchObject({
			host: "0.0.0.0",
			port: 40789,
			enableUi: false,
		});
		expect(() => loadServerEnv({ ATLAS_PORT: "99999" })).toThrow();
	});

	test("serves health, version, repo, manifest, freshness, and topology inspection", async () => {
		expect(await json(app, "/health")).toMatchObject({
			ok: true,
			data: {
				service: "ATLAS",
				readiness: {
					store: expect.objectContaining({ repoCount: 1, documentCount: 1 }),
				},
			},
		});
		expect(await json(app, "/version")).toMatchObject({
			data: { service: "ATLAS", version: "0.0.0" },
		});
		expect(await json(app, "/api/repos")).toMatchObject({
			data: [expect.objectContaining({ repoId, fresh: true })],
		});
		expect(await json(app, `/api/repos/${repoId}`)).toMatchObject({
			data: {
				repo: expect.objectContaining({ repoId }),
				counts: expect.objectContaining({ documents: 1, skills: 1 }),
			},
		});
		expect(await json(app, "/api/inspect/manifest")).toMatchObject({
			data: { manifests: [expect.objectContaining({ repoId })] },
		});
		expect(await json(app, "/api/inspect/freshness")).toMatchObject({
			data: [expect.objectContaining({ repoId, fresh: true })],
		});
		expect(await json(app, `/api/inspect/topology/${repoId}`)).toMatchObject({
			data: { modules: [expect.objectContaining({ moduleId })] },
		});
	});

	test("serves search, scope, context, and retrieval inspect routes", async () => {
		expect(
			await postJson(app, "/api/search/scopes", {
				query: "session rotation",
				repoId,
			}),
		).toMatchObject({
			data: {
				scopes: expect.arrayContaining([
					expect.objectContaining({ id: moduleId }),
				]),
			},
		});
		expect(
			await postJson(app, "/api/search/docs", {
				query: "session rotation",
				repoId,
			}),
		).toMatchObject({
			data: {
				hits: expect.arrayContaining([
					expect.objectContaining({
						provenance: expect.objectContaining({ docId }),
					}),
				]),
			},
		});
		expect(
			await postJson(app, "/api/context/plan", {
				query: "how do I rotate session tokens?",
				repoId,
				budgetTokens: 200,
			}),
		).toMatchObject({
			data: { selected: expect.any(Array), confidence: expect.any(String) },
		});
		expect(
			await json(
				app,
				`/api/inspect/retrieval?query=${encodeURIComponent("session rotation")}&repoId=${repoId}`,
			),
		).toMatchObject({
			data: {
				classification: expect.any(Object),
				rankedHits: expect.any(Array),
			},
		});
	});

	test("serves direct document outline and section reads", async () => {
		expect(await json(app, `/api/docs/${docId}/outline`)).toMatchObject({
			data: {
				document: expect.objectContaining({
					docId,
					title: "Session",
					path: "packages/auth/docs/session.md",
				}),
				outline: [
					expect.objectContaining({
						sectionId,
						headingPath: ["Session", "Rotation"],
						ordinal: 0,
						preview:
							"Rotate session tokens by calling rotateSessionToken during renewal.",
					}),
				],
				summaries: [
					expect.objectContaining({ targetId: docId, level: "short" }),
				],
			},
		});

		expect(
			await json(app, `/api/docs/${docId}/sections/${sectionId}`),
		).toMatchObject({
			data: {
				section: expect.objectContaining({
					sectionId,
					docId,
					headingPath: ["Session", "Rotation"],
					text: "Rotate session tokens by calling rotateSessionToken during renewal.",
					codeBlocks: [{ lang: "ts", code: "rotateSessionToken(sessionId);" }],
				}),
				provenance: expect.objectContaining({
					docId,
					repoId,
					packageId,
					moduleId,
					path: "packages/auth/docs/session.md",
					headingPath: ["Session", "Rotation"],
				}),
			},
		});

		expect(
			await json(
				app,
				`/api/docs/${docId}/section?heading=Session&heading=Rotation`,
			),
		).toMatchObject({
			data: {
				section: expect.objectContaining({ sectionId }),
				provenance: expect.objectContaining({
					headingPath: ["Session", "Rotation"],
				}),
			},
		});
	});

	test("maps document read validation and not-found errors through the shared envelope", async () => {
		const emptyHeading = await response(
			app,
			`/api/docs/${docId}/section?heading=`,
		);
		expect(emptyHeading.status).toBe(400);
		expect(await emptyHeading.json()).toMatchObject({
			ok: false,
			error: { code: "validation_failed" },
		});

		const missingDocument = await response(app, "/api/docs/missing/outline");
		expect(missingDocument.status).toBe(404);
		expect(await missingDocument.json()).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});

		const missingSection = await response(
			app,
			`/api/docs/${docId}/sections/missing`,
		);
		expect(missingSection.status).toBe(404);
		expect(await missingSection.json()).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
	});

	test("serves Scalar docs and redirects root to docs", async () => {
		expect(await json(app, `/api/skills?repoId=${repoId}`)).toMatchObject({
			data: [expect.objectContaining({ skillId })],
		});
		expect(await json(app, `/api/skills/${skillId}`)).toMatchObject({
			data: {
				skill: expect.objectContaining({ skillId }),
				sourceDocument: expect.objectContaining({ docId }),
			},
		});

		const documentedApp = createApp(
			createDependencies(store, dbPath, { enableOpenApi: true }),
		);
		const docsResponse = await documentedApp.handle(
			new Request("http://atlas.local/docs"),
		);
		const docsHtml = await docsResponse.text();
		const openApiResponse = await documentedApp.handle(
			new Request("http://atlas.local/openapi"),
		);
		const openApiHtml = await openApiResponse.text();

		expect(docsResponse.status).toBe(200);
		expect(openApiResponse.status).toBe(200);
		expect(docsResponse.headers.get("content-type")).toContain("text/html");
		expect(docsHtml).toContain(SCALAR_CDN_URL);
		expect(docsHtml).toContain('id="api-reference"');
		expect(docsHtml).toContain("url&quot;:&quot;/openapi.json");
		expect(docsHtml).toContain("_integration&quot;:&quot;elysiajs");
		expect(docsHtml).not.toContain("Back to Docs");
		expect(openApiHtml).not.toContain("Back to Docs");
		expect(docsHtml).not.toContain("Scalar OpenAPI");
		expect(openApiHtml).not.toContain("Scalar OpenAPI");
		expect(docsHtml).not.toContain("MOXEL ATLAS Docs");
		expect(docsHtml).not.toContain("Local-first documentation runtime");
		expect(docsHtml).not.toContain("atlas setup");
		expect(docsHtml).not.toContain("atlas artifact verify --fresh");

		const rawSpec = await documentedApp.handle(
			new Request("http://atlas.local/openapi.json"),
		);
		expect(rawSpec.status).toBe(200);
		expect(
			((await rawSpec.json()) as { paths: Record<string, unknown> }).paths[
				"/api/repos"
			],
		).toBeDefined();

		const rootResponse = await documentedApp.handle(
			new Request("http://atlas.local/"),
		);
		expect(rootResponse.status).toBe(302);
		expect(rootResponse.headers.get("location")).toBe("/docs");
	});

	test("serves organized OpenAPI contract for Scalar", async () => {
		const documentedApp = createApp(
			createDependencies(store, dbPath, {
				enableOpenApi: true,
				enableMcp: true,
			}),
		);
		const spec = (await json(documentedApp, "/openapi/json")) as {
			info: { title: string; description: string };
			servers: Array<{ description: string }>;
			tags: Array<{ name: string; description?: string }>;
			paths: Record<
				string,
				Record<
					string,
					{
						tags?: string[];
						operationId?: string;
						summary?: string;
						description?: string;
						requestBody?: unknown;
						responses?: Record<string, unknown>;
					}
				>
			>;
		};
		const aliasSpec = (await json(
			documentedApp,
			"/openapi.json",
		)) as typeof spec;

		expect(spec.info.title).toBe("MOXEL ATLAS Local API");
		expect(spec.info.description).toContain("atlas-docs-hero");
		expect(spec.info.description).toContain(
			"Start building with your local engineering knowledge base",
		);
		expect(spec.info.description).toContain("Quickstart");
		expect(spec.info.description).toContain("Common workflows");
		expect(spec.info.description).toContain("atlas-docs-cards");
		expect(spec.info.description).toContain("Safety model");
		expect(spec.info.description).toContain("/docs");
		expect(spec.info.description).toContain("/openapi.json");
		expect(spec.info.description).toContain("does not fetch remote source");
		expect(spec.servers[0]?.description).toBe("Default loopback Atlas server");
		expect(aliasSpec.info.title).toBe(spec.info.title);
		expect(aliasSpec.paths["/api/repos"]).toBeDefined();
		expect(spec.tags.map((tag) => tag.name)).toEqual([
			"Runtime",
			"Repositories",
			"Retrieval",
			"Documents",
			"Skills",
			"Inspection",
			"Operations",
			"MCP",
		]);
		expect(spec.tags.map((tag) => tag.description)).toEqual([
			"Health, version, and runtime readiness for the local Atlas server.",
			"Local repository config and indexed corpus inspection.",
			"Search, scope inference, and context planning over the local corpus.",
			"Canonical document outline and section reads from indexed public artifacts.",
			"Generated Atlas skill discovery and read-only skill inspection.",
			"Diagnostics for manifests, freshness, topology, and retrieval state.",
			"Explicit sync and build operations backed by local indexer services.",
			"Model Context Protocol Streamable HTTP bridge for local agents.",
		]);
		const findScopesOperation = spec.paths["/api/search/scopes"]?.post;
		const outlineOperation = spec.paths["/api/docs/{docId}/outline"]?.get;
		const syncOperation = spec.paths["/api/sync"]?.post;
		const buildOperation = spec.paths["/api/build"]?.post;

		expect(spec.paths["/api/repos"]?.post).toMatchObject({
			tags: ["Repositories"],
			operationId: "createRepository",
		});
		expect(Object.keys(spec.paths["/api/repos/{repoId}"] ?? {}).sort()).toEqual(
			["delete", "get", "put"],
		);
		expect(spec.paths["/api/repos/{repoId}"]?.put).toMatchObject({
			tags: ["Repositories"],
			operationId: "replaceRepository",
		});
		expect(findScopesOperation).toMatchObject({
			tags: ["Retrieval"],
			operationId: "findScopes",
			summary: "Infer relevant scopes",
		});
		expect(findScopesOperation?.requestBody).toBeDefined();
		expect(findScopesOperation?.responses?.["200"]).toBeDefined();
		expect(outlineOperation).toMatchObject({
			tags: ["Documents"],
			operationId: "readDocumentOutline",
			summary: "Read document outline",
		});
		expect(syncOperation?.responses?.["200"]).toBeDefined();
		expect(buildOperation?.responses?.["200"]).toBeDefined();
		expect(Object.keys(spec.paths["/mcp"] ?? {}).sort()).toEqual([
			"delete",
			"get",
			"post",
		]);
		for (const [path, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				expect(
					operation.summary,
					`${method.toUpperCase()} ${path} summary`,
				).toBeTruthy();
				expect(
					operation.description,
					`${method.toUpperCase()} ${path} description`,
				).toBeTruthy();
				expect(
					operation.summary?.length ?? 0,
					`${method.toUpperCase()} ${path} summary length`,
				).toBeGreaterThan(10);
				expect(
					operation.description?.length ?? 0,
					`${method.toUpperCase()} ${path} description length`,
				).toBeGreaterThan(20);
				expect(
					operation.tags?.length ?? 0,
					`${method.toUpperCase()} ${path} tags`,
				).toBeGreaterThan(0);
			}
		}
		const serializedSpec = JSON.stringify(spec);
		expect(serializedSpec).toContain("session rotation");
		expect(serializedSpec).toContain("github.com/org/repo");
		expect(serializedSpec).toContain("How does authentication work?");
		expect(serializedSpec).toContain("incremental");
		expect(serializedSpec).toContain("document-codebase");
		expect(spec.paths["/"]).toBeUndefined();
		expect(spec.paths["/docs"]).toBeUndefined();
		expect(spec.paths["/openapi"]).toBeUndefined();
		expect(spec.paths["/openapi.json"]).toBeUndefined();
		expect(spec.paths["/openapi/json"]).toBeUndefined();
		expect(spec.paths["/favicon.ico"]).toBeUndefined();
		expect(spec.paths["/assets/{*}"]).toBeUndefined();
	});

	test("serves OpenAPI HTML shell", async () => {
		const documentedApp = createApp(
			createDependencies(store, dbPath, { enableOpenApi: true }),
		);
		const response = await documentedApp.handle(
			new Request("http://atlas.local/openapi"),
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain(SCALAR_CDN_URL);
		expect(html).toContain("MOXEL ATLAS API Reference");
		expect(html).not.toContain('href="/docs"');
		expect(html).not.toContain('href="/openapi.json"');
		expect(html).not.toContain("Back to Docs");
		expect(html).not.toContain("Route groups");
		expect(html).not.toContain("Loopback-first mutation routes");
		expect(html).toContain("url&quot;:&quot;/openapi.json");
		expect(html).toContain("_integration&quot;:&quot;elysiajs");
		expect(html).toContain('id="api-reference"');
	});

	test("serves an empty favicon response for local OpenAPI browsers", async () => {
		const documentedApp = createApp(
			createDependencies(store, dbPath, { enableOpenApi: true }),
		);
		const response = await documentedApp.handle(
			new Request("http://atlas.local/favicon.ico"),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("cache-control")).toContain("max-age=86400");
	});

	test("mcp identity serverInfo uses ATLAS_MCP configuration", async () => {
		const mcpApp = createApp(
			createDependencies(
				store,
				dbPath,
				{ enableMcp: true },
				undefined,
				undefined,
				{
					name: "acme-knowledge",
					title: "Acme Knowledge MCP",
					resourcePrefix: "acme",
				},
			),
		);
		const initialize = await mcpRequest(mcpApp, {
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			},
		});
		const body = (await initialize.json()) as {
			result: { serverInfo: { name: string; title?: string } };
		};
		expect(body.result.serverInfo).toMatchObject({
			name: "acme-knowledge",
			title: "Acme Knowledge MCP",
		});
	});

	test("bridges SDK-compatible MCP Streamable HTTP requests", async () => {
		const mcpApp = createApp(
			createDependencies(store, dbPath, { enableMcp: true }),
		);
		const initialize = await mcpRequest(mcpApp, {
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "atlas-server-test", version: "0.0.0" },
			},
		});

		expect(initialize.status).toBe(200);
		const sessionId = initialize.headers.get("mcp-session-id");
		expect(sessionId).toBeDefined();
		expect(await initialize.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				serverInfo: expect.objectContaining({ name: expect.any(String) }),
				capabilities: expect.any(Object),
			},
		});

		const tools = await mcpRequest(
			mcpApp,
			{
				id: 2,
				method: "tools/list",
				params: {},
			},
			sessionId ?? undefined,
		);
		expect(tools.status).toBe(200);
		expect(await tools.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 2,
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "find_docs" }),
				]),
			},
		});

		const stream = await response(mcpApp, "/mcp", {
			method: "GET",
			headers: {
				accept: "text/event-stream",
				"mcp-session-id": sessionId ?? "",
				"mcp-protocol-version": "2025-03-26",
			},
		});
		expect(stream.status).toBe(200);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		await stream.body?.cancel();

		const deleted = await response(mcpApp, "/mcp", {
			method: "DELETE",
			headers: {
				"mcp-session-id": sessionId ?? "",
				"mcp-protocol-version": "2025-03-26",
			},
		});
		expect(deleted.status).toBe(200);
	});

	test("isolates MCP Streamable HTTP state per session", async () => {
		const mcpApp = createApp(
			createDependencies(store, dbPath, { enableMcp: true }),
		);
		const firstInitialize = await mcpRequest(mcpApp, {
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "atlas-server-test-a", version: "0.0.0" },
			},
		});
		const secondInitialize = await mcpRequest(mcpApp, {
			id: 2,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "atlas-server-test-b", version: "0.0.0" },
			},
		});

		expect(firstInitialize.status).toBe(200);
		expect(secondInitialize.status).toBe(200);
		const firstSessionId = firstInitialize.headers.get("mcp-session-id");
		const secondSessionId = secondInitialize.headers.get("mcp-session-id");
		expect(firstSessionId).toBeDefined();
		expect(secondSessionId).toBeDefined();
		expect(firstSessionId).not.toBe(secondSessionId);

		const firstTools = await mcpRequest(
			mcpApp,
			{ id: 3, method: "tools/list", params: {} },
			firstSessionId ?? undefined,
		);
		const secondTools = await mcpRequest(
			mcpApp,
			{ id: 4, method: "tools/list", params: {} },
			secondSessionId ?? undefined,
		);
		expect(firstTools.status).toBe(200);
		expect(secondTools.status).toBe(200);
		expect(await firstTools.json()).toMatchObject({
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "find_docs" }),
				]),
			},
		});
		expect(await secondTools.json()).toMatchObject({
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "find_docs" }),
				]),
			},
		});

		const deletedFirst = await response(mcpApp, "/mcp", {
			method: "DELETE",
			headers: {
				"mcp-session-id": firstSessionId ?? "",
				"mcp-protocol-version": "2025-03-26",
			},
		});
		expect(deletedFirst.status).toBe(200);

		const deletedSessionTools = await mcpRequest(
			mcpApp,
			{ id: 5, method: "tools/list", params: {} },
			firstSessionId ?? undefined,
		);
		expect(deletedSessionTools.status).toBe(404);
		expect(await deletedSessionTools.json()).toMatchObject({
			jsonrpc: "2.0",
			error: { code: -32001, message: "Session not found" },
		});

		const remainingSessionTools = await mcpRequest(
			mcpApp,
			{ id: 6, method: "tools/list", params: {} },
			secondSessionId ?? undefined,
		);
		expect(remainingSessionTools.status).toBe(200);
		expect(await remainingSessionTools.json()).toMatchObject({
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "find_docs" }),
				]),
			},
		});
	});

	test("returns MCP protocol errors without escaping the route boundary", async () => {
		const mcpApp = createApp(
			createDependencies(store, dbPath, { enableMcp: true }),
		);

		const invalidAccept = await mcpRequest(
			mcpApp,
			{ id: 1, method: "tools/list", params: {} },
			undefined,
			{
				accept: "application/json",
			},
		);
		expect(invalidAccept.status).toBe(406);
		expect(await invalidAccept.json()).toMatchObject({
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message: expect.stringContaining("Not Acceptable"),
			},
		});

		const missingSession = await response(mcpApp, "/mcp", {
			method: "DELETE",
			headers: { "mcp-protocol-version": "2025-03-26" },
		});
		expect(missingSession.status).toBe(400);
		expect(await missingSession.json()).toMatchObject({
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message: expect.stringContaining("Server not initialized"),
			},
		});
	});

	test("allows only local browser origins for Scalar request execution", async () => {
		const allowedLocalhost = await corsPreflight(app, "http://localhost:5173");
		expect(allowedLocalhost.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:5173",
		);
		expect(
			allowedLocalhost.headers.get("access-control-allow-headers"),
		).toContain("authorization");
		expect(
			allowedLocalhost.headers.get("access-control-allow-credentials"),
		).toBeNull();

		const allowedIpv4 = await corsPreflight(app, "http://127.0.0.1:3000");
		expect(allowedIpv4.headers.get("access-control-allow-origin")).toBe(
			"http://127.0.0.1:3000",
		);

		const allowedIpv6 = await corsPreflight(app, "http://[::1]:3000");
		expect(allowedIpv6.headers.get("access-control-allow-origin")).toBe(
			"http://[::1]:3000",
		);

		const blockedHttps = await corsPreflight(app, "https://localhost:5173");
		expect(blockedHttps.headers.get("access-control-allow-origin")).not.toBe(
			"https://localhost:5173",
		);

		const blockedRemote = await corsPreflight(app, "http://evil.test");
		expect(blockedRemote.headers.get("access-control-allow-origin")).not.toBe(
			"http://evil.test",
		);

		const missingOrigin = await app.handle(
			new Request("http://atlas.local/api/search/scopes", {
				method: "OPTIONS",
				headers: {
					"access-control-request-method": "POST",
					"access-control-request-headers": "authorization,content-type",
				},
			}),
		);
		expect(missingOrigin.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("does not log authorization header values", async () => {
		const loggingApp = createApp(
			createDependencies(store, dbPath, { logRequests: true }),
		);
		const originalLog = console.log;
		const logs: string[] = [];
		console.log = (message?: unknown) => {
			logs.push(String(message));
		};

		try {
			const loggedResponse = await loggingApp.handle(
				new Request("http://atlas.local/health", {
					headers: { authorization: "Bearer redaction-canary-header" },
				}),
			);
			await loggedResponse.text();
			await Bun.sleep(0);
		} finally {
			console.log = originalLog;
		}

		expect(logs.join("\n")).not.toContain("redaction-canary-header");
	});

	test("executes sync and build through the shared indexer adapter", async () => {
		const operationalApp = createApp(
			createDependencies(
				store,
				dbPath,
				{},
				createStubIndexer({
					async syncRepo(inputRepoId): Promise<SyncReport> {
						return {
							repoId: inputRepoId,
							mode: "local-git",
							status: "updated",
							previousRevision: "rev_1",
							currentRevision: "rev_2",
							sourceChanged: true,
							corpusAffected: true,
							corpusImpact: "docs",
							changedPathCount: 1,
							relevantChangedPathCount: 1,
							relevantDocPathCount: 1,
							topologySensitivePathCount: 0,
							packageManifestPathCount: 0,
							diagnostics: [],
							recovery: fakeRecovery(),
							timings: fakeTimings(),
						};
					},
					async buildRepo(inputRepoId, options): Promise<BuildReport> {
						return {
							repoId: inputRepoId,
							strategy: options?.selection ? "targeted" : "full",
							reasonCode: options?.selection ? "targeted_doc" : "force",
							partial: options?.selection !== undefined,
							reason: "stubbed build",
							currentRevision: "rev_2",
							docsConsidered: 1,
							docsRebuilt: 1,
							docsDeleted: 0,
							chunksPersisted: 2,
							skillsUpdated: 0,
							summariesUpdated: 2,
							manifestUpdated: true,
							changedPaths: [],
							affectedDocPaths: [],
							deletedDocPaths: [],
							skippedDocPaths: [],
							diagnostics: [],
							recovery: fakeRecovery(),
							timings: fakeTimings(),
						};
					},
				}),
			),
		);

		const sync = await response(operationalApp, "/api/sync", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repoId, mode: "incremental" }),
		});
		expect(sync.status).toBe(200);
		expect(await sync.json()).toMatchObject({
			ok: true,
			data: {
				repoId,
				status: "updated",
				currentRevision: "rev_2",
			},
		});

		const build = await response(operationalApp, "/api/build", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repoId, moduleId, mode: "incremental" }),
		});
		expect(build.status).toBe(200);
		expect(await build.json()).toMatchObject({
			ok: true,
			data: {
				repoId,
				strategy: "targeted",
				partial: true,
			},
		});
	});

	test("mutates repo config locally and blocks mutation on non-loopback hosts", async () => {
		const configPath = dbPath.replace(/atlas\.db$/, "atlas.config.json");
		const mutationConfig = createResolvedConfig(dbPath, configPath).config;
		await Bun.write(
			configPath,
			`${JSON.stringify({ ...mutationConfig, repos: [] }, null, 2)}\n`,
		);
		const mutableApp = createApp(
			createDependencies(store, dbPath, {}, createStubIndexer(), configPath),
		);
		const extraRepoId = "github.com/platform/atlas-extra";
		const extraRepoRoute = encodeURIComponent(extraRepoId);
		const createdRepo = {
			repoId: extraRepoId,
			mode: "local-git",
			git: {
				remote: "file:///tmp/atlas-extra",
				localPath: "/tmp/atlas-extra",
				ref: "main",
			},
			workspace: {
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
					priority: 1,
				},
			],
		};

		const create = await response(mutableApp, "/api/repos", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(createdRepo),
		});
		expect(create.status).toBe(201);
		expect(await create.json()).toMatchObject({
			ok: true,
			data: { repoId: extraRepoId },
		});
		expect(await Bun.file(configPath).json()).toMatchObject({
			repos: expect.arrayContaining([
				expect.objectContaining({ repoId: extraRepoId }),
			]),
		});

		const replace = await response(mutableApp, `/api/repos/${extraRepoRoute}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				...createdRepo,
				git: { ...createdRepo.git, ref: "release" },
			}),
		});
		expect(replace.status).toBe(200);
		expect(await replace.json()).toMatchObject({
			data: { git: expect.objectContaining({ ref: "release" }) },
		});

		const remove = await response(mutableApp, `/api/repos/${extraRepoRoute}`, {
			method: "DELETE",
		});
		expect(remove.status).toBe(200);
		expect(await remove.json()).toMatchObject({
			data: { repoId: extraRepoId, deleted: true },
		});

		const publicApp = createApp(
			createDependencies(
				store,
				dbPath,
				{ host: "0.0.0.0" },
				createStubIndexer(),
				configPath,
			),
		);
		const blocked = await response(publicApp, "/api/repos", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(createdRepo),
		});
		expect(blocked.status).toBe(403);
		expect(await blocked.json()).toMatchObject({
			ok: false,
			error: { code: "forbidden" },
		});
	});

	test("rejects invalid targeted build selector combinations at the route boundary", async () => {
		const build = await response(app, "/api/build", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repoId, docIds: [docId], packageId }),
		});

		expect(build.status).toBe(400);
		expect(await build.json()).toMatchObject({
			ok: false,
			error: { code: "validation_failed" },
		});
	});

	test("maps validation and not-found errors through the shared envelope", async () => {
		const validation = await response(app, "/api/search/scopes", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "" }),
		});
		expect(validation.status).toBe(400);
		expect(await validation.json()).toMatchObject({
			ok: false,
			error: { code: "validation_failed" },
		});

		const missing = await response(app, "/api/skills/missing");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
	});
});

async function json(
	app: ReturnType<typeof createApp>,
	path: string,
): Promise<unknown> {
	return response(app, path).then((res) => res.json());
}

async function postJson(
	app: ReturnType<typeof createApp>,
	path: string,
	body: unknown,
): Promise<unknown> {
	return response(app, path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	}).then((res) => res.json());
}

function mcpRequest(
	app: ReturnType<typeof createApp>,
	body: { id: number; method: string; params?: unknown },
	sessionId?: string | undefined,
	headers: Record<string, string> = {},
): Promise<Response> {
	return response(app, "/mcp", {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-protocol-version": "2025-03-26",
			...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
			...headers,
		},
		body: JSON.stringify({ jsonrpc: "2.0", ...body }),
	});
}

function response(
	app: ReturnType<typeof createApp>,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return app.handle(new Request(`http://atlas.local${path}`, init));
}

function corsPreflight(
	app: ReturnType<typeof createApp>,
	origin: string,
): Promise<Response> {
	return app.handle(
		new Request("http://atlas.local/api/search/scopes", {
			method: "OPTIONS",
			headers: {
				origin,
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization,content-type",
			},
		}),
	);
}

function createDependencies(
	store: AtlasStoreClient,
	corpusDbPath: string,
	envOverrides: Partial<ServerEnv> = {},
	indexer: IndexerService = createStubIndexer(),
	configPath = "/tmp/atlas.config.json",
	mcpIdentity?:
		| { name?: string; title?: string; resourcePrefix?: string }
		| undefined,
): AtlasServerDependencies {
	const env: ServerEnv = {
		host: "127.0.0.1",
		port: 3000,
		enableUi: false,
		enableOpenApi: false,
		enableMcp: false,
		enableTelemetry: false,
		logRequests: false,
		...envOverrides,
	};
	const mcp = env.enableMcp
		? new McpBridgeService(store, undefined, mcpIdentity)
		: undefined;
	const dependencies: AtlasServerDependencies = {
		env,
		config: createResolvedConfig(corpusDbPath, configPath),
		db: store,
		store: new StoreReadService(store),
		retrieval: new RetrievalHttpService(store),
		operations: new BuildOperationsService(indexer),
		...(mcp === undefined ? {} : { mcp, mcpServer: mcp.atlasMcpServer }),
		reloadConfig(nextConfig) {
			dependencies.config = nextConfig;
			dependencies.operations = new BuildOperationsService(indexer);
		},
	};
	return dependencies;
}

function createStubIndexer(
	overrides: Partial<IndexerService> = {},
): IndexerService {
	return {
		async syncRepo(): Promise<SyncReport> {
			throw new Error("stub");
		},
		async syncAll(): Promise<SyncBatchReport> {
			throw new Error("stub");
		},
		async buildRepo(): Promise<BuildReport> {
			throw new Error("stub");
		},
		async buildAll(): Promise<BuildBatchReport> {
			throw new Error("stub");
		},
		...overrides,
	};
}

function fakeTimings() {
	return {
		startedAt: "2026-01-01T00:00:00.000Z",
		completedAt: "2026-01-01T00:00:00.010Z",
		durationMs: 10,
	};
}

function fakeRecovery() {
	return {
		previousCorpusPreserved: true,
		stale: false,
		nextAction: "No recovery action required.",
	};
}

function createResolvedConfig(
	corpusDbPath: string,
	configPath = "/tmp/atlas.config.json",
): ResolvedAtlasConfig {
	return {
		config: {
			version: 1,
			cacheDir: corpusDbPath.replace(/\/atlas\.db$/, ""),
			corpusDbPath,
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
						remote: "file:///tmp/atlas",
						localPath: "/tmp/atlas",
						ref: "main",
					},
					workspace: {
						packageGlobs: ["packages/*"],
						packageManifestFiles: ["package.json"],
					},
					topology: [
						{
							id: "docs",
							kind: "module-doc",
							match: { include: ["**/*.md"] },
							ownership: { attachTo: "module" },
							authority: "preferred",
							priority: 1,
						},
					],
				},
			],
		},
		source: { configPath, loadedFrom: "explicit" },
		env: {},
	};
}

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
	new DocRepository(store).replaceCanonicalDocument(createDocument());
	new SummaryRepository(store).replaceForTarget("document", docId, [
		{
			summaryId: `${docId}:summary`,
			targetType: "document",
			targetId: docId,
			level: "short",
			text: "Session docs explain token rotation.",
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
	});
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
