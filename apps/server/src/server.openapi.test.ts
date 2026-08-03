import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SCALAR_CDN_URL } from "@atlas/presentation-assets/openapi";
import { createApp } from "./app";

import {
  corsPreflight,
  createResolvedConfig,
  createStubIndexer,
  createServerTestFixture,
  json,
  repoId,
  response as request,
  type ServerTestFixture,
} from "./server.test-fixtures";

type OpenApiSchema = {
  type?: string;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  default?: unknown;
  const?: unknown;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
};

type OpenApiOperation = {
  tags?: string[];
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; schema: OpenApiSchema }>;
  requestBody?: {
    content?: { "application/json"?: { schema?: OpenApiSchema } };
  };
  responses?: Record<
    string,
    { content?: { "application/json"?: { schema?: OpenApiSchema } } }
  >;
};

type OpenApiSpec = {
  info: { title: string; description: string };
  servers: Array<{ description: string }>;
  tags: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
};

describe("server OpenAPI contract", () => {
  let fixture: ServerTestFixture;
  let app: ServerTestFixture["app"];
  let repoConfig: Record<string, unknown>;

  beforeEach(async () => {
    fixture = await createServerTestFixture();
    app = createApp(
      fixture.createDependencies(
        { enableMcp: true, enableOpenApi: true },
        createStubIndexer({
          async syncRepo() {
            return {} as never;
          },
          async syncAll() {
            return {} as never;
          },
          async buildRepo() {
            return {} as never;
          },
          async buildAll() {
            return {} as never;
          },
        }),
      ),
    );
    repoConfig = createResolvedConfig(fixture.dbPath).config.repos[0] as Record<
      string,
      unknown
    >;
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("serves Scalar docs and redirects root to docs", async () => {
    const docsResponse = await request(app, "/docs");
    const docsHtml = await docsResponse.text();
    const openApiResponse = await request(app, "/openapi");
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
    expect(openApiHtml).not.toContain("MOXEL ATLAS Docs");
    expect(docsHtml).not.toContain("Local-first documentation runtime");
    expect(docsHtml).not.toContain("atlas setup");
    expect(docsHtml).not.toContain("atlas artifact verify --fresh");

    const rawSpec = await request(app, "/openapi.json");
    expect(rawSpec.status).toBe(200);
    expect(
      ((await rawSpec.json()) as OpenApiSpec).paths["/api/repos"],
    ).toBeDefined();

    const rootResponse = await request(app, "/");
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get("location")).toBe("/docs");
  });

  test("serves an organized OpenAPI contract for Scalar", async () => {
    const spec = await openApiSpec(app);
    const aliasSpec = (await json(app, "/openapi.json")) as OpenApiSpec;

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

    const findScopesOperation = operation(spec, "/api/search/scopes", "post");
    const outlineOperation = operation(
      spec,
      "/api/docs/{docId}/outline",
      "get",
    );
    const syncOperation = operation(spec, "/api/sync", "post");
    const buildOperation = operation(spec, "/api/build", "post");

    expect(operation(spec, "/api/repos", "post")).toMatchObject({
      tags: ["Repositories"],
      operationId: "createRepository",
    });
    expect(Object.keys(spec.paths["/api/repos/{repoId}"] ?? {}).sort()).toEqual(
      ["delete", "get", "put"],
    );
    expect(operation(spec, "/api/repos/{repoId}", "put")).toMatchObject({
      tags: ["Repositories"],
      operationId: "replaceRepository",
    });
    expect(findScopesOperation).toMatchObject({
      tags: ["Retrieval"],
      operationId: "findScopes",
      summary: "Infer relevant scopes",
    });
    expect(findScopesOperation.requestBody).toBeDefined();
    expect(findScopesOperation.responses?.["200"]).toBeDefined();
    expect(outlineOperation).toMatchObject({
      tags: ["Documents"],
      operationId: "readDocumentOutline",
      summary: "Read document outline",
    });
    expect(syncOperation.responses?.["200"]).toBeDefined();
    expect(buildOperation.responses?.["200"]).toBeDefined();
    expect(Object.keys(spec.paths["/mcp"] ?? {}).sort()).toEqual([
      "delete",
      "get",
      "post",
    ]);
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, documentedOperation] of Object.entries(methods)) {
        expect(
          documentedOperation.summary,
          `${method.toUpperCase()} ${path} summary`,
        ).toBeTruthy();
        expect(
          documentedOperation.description,
          `${method.toUpperCase()} ${path} description`,
        ).toBeTruthy();
        expect(
          documentedOperation.summary?.length ?? 0,
          `${method.toUpperCase()} ${path} summary length`,
        ).toBeGreaterThan(10);
        expect(
          documentedOperation.description?.length ?? 0,
          `${method.toUpperCase()} ${path} description length`,
        ).toBeGreaterThan(20);
        expect(
          documentedOperation.tags?.length ?? 0,
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

  test("keeps generated request schemas aligned with runtime validation", async () => {
    const spec = await openApiSpec(app);
    const findDocuments = requestSchema(spec, "/api/search/docs");
    const findScopes = requestSchema(spec, "/api/search/scopes");
    const context = requestSchema(spec, "/api/context/plan");
    const repository = requestSchema(spec, "/api/repos");
    const sync = requestSchema(spec, "/api/sync");
    const build = requestSchema(spec, "/api/build");
    const inspectBudget = queryParameter(
      operation(spec, "/api/inspect/retrieval", "get"),
      "budgetTokens",
    );
    const repositoryId = pathParameter(
      operation(spec, "/api/repos/{repoId}", "get"),
      "repoId",
    );
    const successEnvelope = responseSchema(
      operation(spec, "/api/search/scopes", "post"),
      "200",
    );
    const failureEnvelope = responseSchema(
      operation(spec, "/api/search/scopes", "post"),
      "400",
    );

    expect(successEnvelope.properties).toMatchObject({
      ok: { enum: [true], type: "boolean" },
      requestId: { type: "string" },
      data: { type: "object" },
    });
    expect(failureEnvelope.properties).toMatchObject({
      ok: { enum: [false], type: "boolean" },
      requestId: { type: "string" },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
        },
      },
    });

    for (const schema of [findDocuments, findScopes, context]) {
      expect(schema.properties).toMatchObject({
        profile: { minLength: 1 },
        audience: { type: "array", maxItems: 10 },
        purpose: { type: "array", maxItems: 10 },
        visibility: { type: "array", maxItems: 2 },
      });
    }
    expect(findDocuments.properties?.scopeIds).toMatchObject({
      type: "array",
      maxItems: 20,
      items: { minLength: 1 },
    });
    expect(repository.properties).toMatchObject({
      repoId: { minLength: 1 },
      mode: { type: "string" },
      git: { type: "object" },
      workspace: { type: "object" },
    });
    expect(inspectBudget.schema).toMatchObject({
      minimum: 1,
      maximum: 200_000,
      default: 2_000,
    });
    expect(repositoryId.schema).toMatchObject({ type: "string" });
    expect(findDocuments.properties?.query).toMatchObject({ minLength: 1 });
    expect(sync.properties).toMatchObject({
      repoId: { minLength: 1 },
      mode: { type: "string" },
      dryRun: { type: "boolean" },
    });
    expect(build.properties).toMatchObject({
      repoId: { minLength: 1 },
      mode: { type: "string" },
      force: { type: "boolean" },
      docIds: { type: "array", items: { minLength: 1 } },
      packageId: { minLength: 1 },
      moduleId: { minLength: 1 },
    });

    const validSearch = await post(app, "/api/search/docs", {
      query: "session rotation",
      profile: "default",
      audience: ["contributor"],
      purpose: ["implementation"],
      visibility: ["public"],
    });
    expect(validSearch.status).toBe(200);
    expect(await validSearch.json()).toMatchObject({
      ok: true,
      requestId: "local",
    });

    const invalidSearch = await post(app, "/api/search/docs", {
      query: "",
      audience: Array.from({ length: 11 }, () => "contributor"),
    });
    expect(invalidSearch.status).toBe(400);
    expect(await invalidSearch.json()).toMatchObject({
      ok: false,
      requestId: "local",
      error: { code: "validation_failed" },
    });

    const invalidRepository = await post(app, "/api/repos", {
      ...repoConfig,
      repoId: " ",
    });
    expect(invalidRepository.status).toBe(400);
    expect(await invalidRepository.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });

    const validInspect = await request(
      app,
      "/api/inspect/retrieval?query=session%20rotation",
    );
    expect(validInspect.status).toBe(200);
    expect(await validInspect.json()).toMatchObject({
      ok: true,
      requestId: "local",
    });

    const invalidInspect = await request(
      app,
      "/api/inspect/retrieval?query=session&budgetTokens=200001",
    );
    expect(invalidInspect.status).toBe(400);

    const validSync = await post(app, "/api/sync", {
      repoId,
      mode: "incremental",
      dryRun: true,
    });
    expect(validSync.status).toBe(200);
    expect(await validSync.json()).toMatchObject({
      ok: true,
      requestId: "local",
    });

    const invalidSync = await post(app, "/api/sync", { mode: "unknown" });
    expect(invalidSync.status).toBe(400);
    expect(await invalidSync.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });

    const validBuild = await post(app, "/api/build", {
      repoId,
      mode: "incremental",
      docIds: ["docs/runtime-surfaces.md"],
    });
    expect(validBuild.status).toBe(200);
    expect(await validBuild.json()).toMatchObject({
      ok: true,
      requestId: "local",
    });

    const invalidBuild = await post(app, "/api/build", {
      repoId,
      docIds: [""],
    });
    expect(invalidBuild.status).toBe(400);
    expect(await invalidBuild.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });
  });

  test("serves OpenAPI HTML shell", async () => {
    const response = await request(app, "/openapi");
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
  test("serves an empty favicon response for local OpenAPI browsers", async () => {
    const response = await request(app, "/favicon.ico");

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
  });
});

async function openApiSpec(
  app: ServerTestFixture["app"],
): Promise<OpenApiSpec> {
  return (await json(app, "/openapi/json")) as OpenApiSpec;
}

function post(
  app: ServerTestFixture["app"],
  path: string,
  body: unknown,
): Promise<Response> {
  return request(app, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function operation(
  spec: OpenApiSpec,
  path: string,
  method: string,
): OpenApiOperation {
  const documentedOperation = spec.paths[path]?.[method];
  if (documentedOperation === undefined) {
    throw new Error(
      `OpenAPI operation is missing: ${method.toUpperCase()} ${path}`,
    );
  }
  return documentedOperation;
}

function requestSchema(spec: OpenApiSpec, path: string): OpenApiSchema {
  const schema = operation(spec, path, "post").requestBody?.content?.[
    "application/json"
  ]?.schema;
  if (schema === undefined)
    throw new Error(`OpenAPI request schema is missing: ${path}`);
  return schema;
}
function responseSchema(
  documentedOperation: OpenApiOperation,
  status: string,
): OpenApiSchema {
  const schema =
    documentedOperation.responses?.[status]?.content?.["application/json"]
      ?.schema;
  if (schema === undefined) {
    throw new Error(`OpenAPI response schema is missing: ${status}`);
  }
  return schema;
}

function queryParameter(operation: OpenApiOperation, name: string) {
  const parameter = operation.parameters?.find(
    (candidate) => candidate.name === name && candidate.in === "query",
  );
  if (parameter === undefined)
    throw new Error(`OpenAPI query parameter is missing: ${name}`);
  return parameter;
}

function pathParameter(operation: OpenApiOperation, name: string) {
  const parameter = operation.parameters?.find(
    (candidate) => candidate.name === name && candidate.in === "path",
  );
  if (parameter === undefined)
    throw new Error(`OpenAPI path parameter is missing: ${name}`);
  return parameter;
}
