import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createChunkId,
  createDocId,
  createSectionId,
  createSkillId,
} from "@atlas/core";
import { createRetrievalStore } from "@atlas/retrieval";
import {
  DocRepository,
  SectionRepository,
  SkillRepository,
} from "@atlas/store";

import * as publicMcp from "./index";
import {
  createMcpTestFixture,
  type McpTestFixture,
  docId,
  documentSummaryId,
  moduleId,
  relatedDocId,
  repoId,
  sectionId,
  skillId,
} from "./mcp.test-fixtures";
import { createAtlasMcpServer } from "./server/create-mcp-server";
import {
  findScopesInputSchema,
  readSectionInputSchema,
} from "./schemas/tool-schemas";
import { executeExpandRelated } from "./tools/expand-related.tool";
import { executeExplainModule } from "./tools/explain-module.tool";
import { executeFindDocs } from "./tools/find-docs.tool";
import { executeFindScopes } from "./tools/find-scopes.tool";
import { executeGetSkill } from "./tools/get-skill.tool";
import { executeListSkills } from "./tools/list-skills.tool";
import { executePlanContext } from "./tools/plan-context.tool";
import { executeReadOutline } from "./tools/read-outline.tool";
import { executeReadSection } from "./tools/read-section.tool";
import { executeUseSkill } from "./tools/use-skill.tool";
import { documentResource } from "./resources/document.resource";

describe("MCP tool contracts", () => {
  let fixture: McpTestFixture;

  beforeEach(async () => {
    fixture = await createMcpTestFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  test("public barrel exports first-party skill MCP surface", () => {
    expect(publicMcp.USE_SKILL_TOOL).toBe("use_skill");
    expect(publicMcp.executeUseSkill).toBeFunction();
    expect(publicMcp.registerUseSkillTool).toBeFunction();
    expect(publicMcp.useSkillInputSchema).toBeDefined();
    expect(publicMcp.skillArtifactResource).toBeDefined();
  });

  test("validates tool input schemas strictly", () => {
    expect(() => readSectionInputSchema.parse({ docId })).toThrow();
    expect(readSectionInputSchema.parse({ docId, sectionId })).toMatchObject({
      docId,
      sectionId,
    });
    expect(
      findScopesInputSchema.parse({
        query: "session rotation",
        visibility: ["internal"],
      }),
    ).toMatchObject({
      query: "session rotation",
      visibility: ["internal"],
    });
  });

  test("executes retrieval-backed tool contracts", () => {
    const { store } = fixture;
    const dependencies = {
      db: store,
      retrievalStore: createRetrievalStore(store),
    };

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
      coverage: { status: expect.any(String) },
      nextAction: expect.any(String),
      context: {
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
  test("folds lifecycle freshness and bounded recent changes into plan_context", () => {
    const { store } = fixture;
    const plannedContext = executePlanContext(
      {
        query: "what changed in the session rotation docs?",
        repoId,
        budgetTokens: 200,
      },
      {
        db: store,
        retrievalStore: createRetrievalStore(store),
        repositoryRefreshStateProvider: {
          getRepositoryRefreshState(requestedRepoId) {
            return requestedRepoId === repoId
              ? {
                  repoId,
                  status: "refresh_failed",
                  lastCheckedAt: "2026-08-03T00:00:00.000Z",
                  lastSuccessfulRefreshAt: "2026-08-02T00:00:00.000Z",
                  sourceRevision: "rev-2",
                  indexedRevision: "rev-1",
                  changedPaths: ["packages/auth/docs/session.md"],
                  error: { message: "remote unavailable" },
                }
              : undefined;
          },
        },
      },
    );

    expect(plannedContext).toMatchObject({
      coverage: {
        status: "stale",
        selectedSources: [
          expect.objectContaining({
            repoId,
            fresh: false,
            stale: true,
            repositoryRefresh: expect.objectContaining({
              status: "refresh_failed",
              sourceRevision: "rev-2",
              indexedRevision: "rev-1",
            }),
          }),
        ],
      },
      recentChanges: [
        {
          repoId,
          status: "refresh_failed",
          changedPaths: ["packages/auth/docs/session.md"],
          lastCheckedAt: "2026-08-03T00:00:00.000Z",
        },
      ],
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
    const { store } = fixture;
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

  test("expands related context from document, section, chunk, and summary anchors", () => {
    const { store } = fixture;
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
    const { store } = fixture;
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

  test("list_skills and use_skill expose first-party skill artifacts", () => {
    const { store } = fixture;
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
    const { store } = fixture;
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
