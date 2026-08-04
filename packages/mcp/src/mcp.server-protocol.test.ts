import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ATLAS_VERSION } from "@atlas/core";
import { ManifestRepository, RepoRepository } from "@atlas/store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  createConnectedMcpTestClient,
  createMcpTestFixture,
  type McpTestFixture,
  docId,
  repoId,
  sectionId,
  skillId,
} from "./mcp.test-fixtures";
import { answerFromLocalDocsPrompt } from "./prompts/answer-from-local-docs.prompt";
import { compareDocsPrompt } from "./prompts/compare-docs.prompt";
import { onboardToRepoPrompt } from "./prompts/onboard-to-repo.prompt";
import { summarizeModulePrompt } from "./prompts/summarize-module.prompt";
import { createAtlasMcpServer } from "./server/create-mcp-server";
describe("MCP server registration and in-memory protocol", () => {
  let fixture: McpTestFixture;

  beforeEach(async () => {
    fixture = await createMcpTestFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  test("declares reusable prompts and creates a registered server surface", () => {
    const { store } = fixture;
    expect(answerFromLocalDocsPrompt.text).toContain("provenance");
    expect(onboardToRepoPrompt.text).toContain("atlas://repo/{repoId}");
    expect(onboardToRepoPrompt.text).toContain("provenance");
    expect(summarizeModulePrompt.text).toContain("explain_module");
    expect(summarizeModulePrompt.text).toContain("provenance");
    expect(compareDocsPrompt.text).toContain("find_docs");
    expect(compareDocsPrompt.text).toContain("provenance");

    const atlasServer = createAtlasMcpServer({ db: store });
    expect(atlasServer.tools).toEqual([
      "plan_context",
      "find_scopes",
      "find_docs",
      "read_outline",
      "read_section",
      "expand_related",
      "explain_module",
      "use_skill",
      "answer_atlas_docs",
    ]);
    expect(atlasServer.tools).not.toContain("get_freshness");
    expect(atlasServer.tools).not.toContain("what_changed");
    expect(atlasServer.resources).toContain("atlas-document");
    expect(atlasServer.resources).toContain("atlas-summary");
    expect(atlasServer.resources).toContain("atlas-skill-artifact");
    expect(atlasServer.resources).toContain("atlas-source-atlas");
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

  test("exposes only bounded retrieval surfaces to remote MCP clients", () => {
    const { store } = fixture;
    const atlasServer = createAtlasMcpServer({
      db: store,
      exposurePolicy: "bounded-remote",
    });

    expect(atlasServer.tools).toEqual([
      "plan_context",
      "find_scopes",
      "find_docs",
      "answer_atlas_docs",
    ]);
    expect(atlasServer.resources).toEqual([]);
  });

  test("advertises the generic router for additive client preload", async () => {
    const { store } = fixture;
    const atlasServer = createAtlasMcpServer({ db: store });
    fixture.registerCleanup(() => atlasServer.server.close());
    const client = await createConnectedMcpTestClient(atlasServer.server, {
      name: "atlas-metadata-test-client",
      version: "0.0.0",
    });
    fixture.registerCleanup(() => client.close());

    expect(client.getServerVersion()).toMatchObject({
      name: "atlas-mcp",
      version: ATLAS_VERSION,
    });
    expect(client.getInstructions()).not.toContain("before external search");

    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "plan_context"),
    ).toMatchObject({
      title: "Answer from indexed documentation",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { "anthropic/alwaysLoad": true },
    });
  });

  test("serves successful MCP tool calls through the SDK server", async () => {
    const { store } = fixture;
    const atlasServer = createAtlasMcpServer({ db: store });
    fixture.registerCleanup(() => atlasServer.server.close());
    const client = await createConnectedMcpTestClient(atlasServer.server, {
      name: "atlas-mcp-test-client",
      version: "0.0.0",
    });
    fixture.registerCleanup(() => client.close());

    const result = await client.callTool({
      name: "read_outline",
      arguments: { docId },
    });

    expect(result.structuredContent).toMatchObject({
      document: expect.objectContaining({ docId }),
      outline: [expect.objectContaining({ sectionId })],
    });

    const listedSkills = await client.callTool({
      name: "use_skill",
      arguments: { repoId },
    });
    expect(listedSkills.structuredContent).toMatchObject({
      status: "listed",
      total: 1,
      skills: [expect.objectContaining({ skillId })],
    });

    const resolvedSkill = await client.callTool({
      name: "use_skill",
      arguments: { skill: "$atlas-session-skill", repoId },
    });
    expect(resolvedSkill.structuredContent).toMatchObject({
      status: "resolved",
      resolution: { method: "exact" },
      skill: expect.objectContaining({ skillId }),
      instructions: expect.objectContaining({
        markdown: expect.stringContaining("Rotate session tokens"),
      }),
    });
  });

  test("advertises and executes a repo-bound local planning facade", async () => {
    const { store } = fixture;
    const atlasServer = createAtlasMcpServer({ db: store });
    fixture.registerCleanup(() => atlasServer.server.close());
    const client = await createConnectedMcpTestClient(atlasServer.server, {
      name: "atlas-discovery-test-client",
      version: "0.0.0",
    });
    fixture.registerCleanup(() => client.close());

    const tools = await client.listTools();
    const facade = tools.tools.find(
      (tool) => tool.name === "answer_atlas_docs",
    );
    expect(facade).toMatchObject({
      title: "Answer from atlas documentation",
      description: expect.stringMatching(
        /answer immediately without calling another retrieval tool.*session.*append/,
      ),
      annotations: expect.objectContaining({ readOnlyHint: true }),
      _meta: { "anthropic/alwaysLoad": true },
    });
    const result = await client.callTool({
      name: "answer_atlas_docs",
      arguments: {
        query: "What does `rotateSessionToken` do during renewal?",
      },
    });
    const structuredContent = result.structuredContent as {
      context: { evidence: unknown[] };
    };
    expect(structuredContent.context.evidence.length).toBeLessThanOrEqual(4);
    expect(result.structuredContent).toMatchObject({
      coverage: { status: "sufficient" },
      nextAction: "answer_locally",
      context: {
        evidence: expect.arrayContaining([
          expect.objectContaining({
            targetType: "section",
            text: expect.stringContaining("Rotate session tokens"),
          }),
        ]),
        recommendedNextActions: [
          "Answer directly from context.evidence and cite provenance paths. Do not call another retrieval tool unless a required claim is unsupported.",
        ],
      },
      citations: expect.arrayContaining([expect.objectContaining({ repoId })]),
      exactPassages: expect.arrayContaining([
        expect.objectContaining({
          path: "packages/auth/docs/session.md",
          text: expect.stringContaining("Rotate session tokens"),
        }),
      ]),
    });
    const manifest = await client.readResource({ uri: "atlas://manifest" });
    expect(manifest.contents).toHaveLength(1);
  });

  test("refreshes source-bound discovery and notifies connected clients", async () => {
    const { store } = fixture;
    const atlasServer = createAtlasMcpServer({ db: store });
    fixture.registerCleanup(() => atlasServer.server.close());
    const client = new Client(
      { name: "atlas-refresh-test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    fixture.registerCleanup(() => client.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const toolListChanged = Promise.withResolvers<void>();
    const resourceListChanged = Promise.withResolvers<void>();
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        toolListChanged.resolve();
      },
    );
    client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        resourceListChanged.resolve();
      },
    );
    await Promise.all([
      atlasServer.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    new RepoRepository(store).upsert({
      repoId: "github.com/example/guide",
      mode: "local-git",
      revision: "rev_2",
    });
    new ManifestRepository(store).upsert({
      repoId: "github.com/example/guide",
      indexedRevision: "rev_2",
      compilerVersion: "compiler-v1",
    });

    expect(atlasServer.refreshDiscovery()).toBeTrue();
    await Promise.all([toolListChanged.promise, resourceListChanged.promise]);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "answer_guide_docs",
    );
    expect(
      (await client.listResources()).resources.map((resource) => resource.name),
    ).toContain("atlas-source-guide");
    expect(atlasServer.refreshDiscovery()).toBeFalse();
  });
});
