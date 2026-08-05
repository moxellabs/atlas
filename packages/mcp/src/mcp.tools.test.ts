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
  packageId,
  repoId,
  sectionId,
  skillId,
} from "./mcp.test-fixtures";
import { createAtlasMcpServer } from "./server/create-mcp-server";
import {
  expandRelatedOutputSchema,
  planContextOutputSchema,
} from "./schemas/tool-output-schemas";
import {
  findScopesInputSchema,
  readDocumentInputSchema,
  planContextInputSchema,
  useSkillInputSchema,
} from "./schemas/tool-schemas";
import { executeExpandRelated } from "./tools/expand-related.tool";
import { executeFindDocs } from "./tools/find-docs.tool";
import { executeFindScopes } from "./tools/find-scopes.tool";
import { executePlanContext } from "./tools/plan-context.tool";
import { executeReadDocument } from "./tools/read-document.tool";
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
    for (const removedExport of [
      "LIST_SKILLS_TOOL",
      "GET_SKILL_TOOL",
      "executeListSkills",
      "executeGetSkill",
      "listSkillsInputSchema",
      "getSkillInputSchema",
    ]) {
      expect(removedExport in publicMcp).toBe(false);
    }
    expect(publicMcp.skillArtifactResource).toBeDefined();
  });

  test("validates tool input schemas strictly", () => {
    expect(readDocumentInputSchema.parse({ docId })).toEqual({ docId });
    expect(readDocumentInputSchema.parse({ docId, sectionId })).toMatchObject({
      docId,
      sectionId,
    });
    expect(() =>
      readDocumentInputSchema.parse({
        docId,
        sectionId,
        heading: ["Session"],
      }),
    ).toThrow();
    expect(
      findScopesInputSchema.parse({
        query: "session rotation",
        visibility: ["internal"],
      }),
    ).toMatchObject({
      query: "session rotation",
      visibility: ["internal"],
    });
    expect(
      planContextInputSchema.parse({
        query: "session rotation",
        summaryLimit: 0,
        expansionLimit: 2,
      }),
    ).toMatchObject({ summaryLimit: 0, expansionLimit: 2 });
    expect(useSkillInputSchema.parse({})).toEqual({});
    expect(() =>
      useSkillInputSchema.parse({ nameOrAlias: "$atlas-session" }),
    ).toThrow();
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
    expect(
      executeFindDocs(
        { query: "session rotation", repoId, limit: 5 },
        dependencies,
      ),
    ).toMatchObject({
      nextAction: "answer_locally",
      nextActionGuidance: expect.stringContaining(
        "Do not call another Atlas tool",
      ),
    });
    const filteredHits = executeFindDocs(
      {
        query: "session rotation",
        repoId,
        scopeIds: [moduleId],
        documentKinds: ["module-doc"],
        targetTypes: ["section"],
        limit: 5,
      },
      dependencies,
    ).hits as Array<{
      targetType: string;
      provenance: { moduleId?: string };
    }>;
    expect(filteredHits.length).toBeGreaterThan(0);
    expect(
      filteredHits.every(
        (hit) =>
          hit.targetType === "section" && hit.provenance.moduleId === moduleId,
      ),
    ).toBe(true);
    const plannedContext = executePlanContext(
      {
        query: "how do I rotate session tokens?",
        scope: { repoId },
        budgetTokens: 200,
      },
      dependencies,
    );
    expect(plannedContext).toMatchObject({
      query: "how do I rotate session tokens?",
      coverage: { status: expect.any(String) },
      nextAction: expect.any(String),
      nextActionGuidance: expect.any(String),
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

  test("returns terminal answer-ready evidence for generic exact lookups", () => {
    const { store } = fixture;
    const plannedContext = executePlanContext(
      {
        query: "What does `rotateSessionToken` do during renewal?",
        scope: { repoId },
        budgetTokens: 2_000,
      },
      {
        db: store,
        retrievalStore: createRetrievalStore(store),
      },
    );

    const parsed = planContextOutputSchema.parse(plannedContext);
    expect(parsed.context.evidence[0]?.targetType).toBe("section");
    expect(
      parsed.context.evidence.some((item) => item.targetType === "summary"),
    ).toBe(false);
    expect(parsed).toMatchObject({
      coverage: { status: "sufficient" },
      nextAction: "answer_locally",
      context: {
        evidence: expect.arrayContaining([
          expect.objectContaining({
            targetType: "section",
            text: expect.stringContaining(
              "Rotate session tokens by calling rotateSessionToken during renewal.",
            ),
          }),
        ]),
        recommendedNextActions: [
          "TERMINAL: answer_locally now from context.evidence and cite provenance paths. Read the selected evidence text before answering; do not claim evidence is unavailable when it contains the requested value. Do not call another Atlas tool.",
        ],
      },
      citations: expect.arrayContaining([
        expect.objectContaining({ path: "packages/auth/docs/session.md" }),
      ]),
    });
  });

  test("resolves human-readable package and module scope paths", () => {
    const { store } = fixture;
    const plannedContext = executePlanContext(
      {
        query: "What does `rotateSessionToken` do during renewal?",
        scope: {
          repoId,
          packageId: "packages/auth",
          moduleId: "packages/auth/src/session",
        },
        budgetTokens: 2_000,
      },
      {
        db: store,
        retrievalStore: createRetrievalStore(store),
      },
    );

    expect(plannedContext).toMatchObject({
      coverage: { status: "sufficient" },
      context: {
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provenance: expect.objectContaining({ packageId, moduleId }),
          }),
        ]),
      },
    });
  });

  test("keeps small output limits from starving candidate generation", () => {
    const { store } = fixture;
    const retrievalStore = createRetrievalStore(store);
    const lexicalLimits: number[] = [];
    const observedStore: typeof retrievalStore = {
      ...retrievalStore,
      lexicalSearch(options) {
        lexicalLimits.push(options.limit ?? 0);
        return retrievalStore.lexicalSearch(options);
      },
    };

    const result = executeFindDocs(
      { query: "session token renewal", repoId, limit: 1 },
      { db: store, retrievalStore: observedStore },
    );

    expect(result.hits).toHaveLength(1);
    expect(lexicalLimits.length).toBeGreaterThan(0);
    expect(lexicalLimits.every((limit) => limit >= 80)).toBe(true);
  });
  test("folds lifecycle freshness and bounded recent changes into plan_context", () => {
    const { store } = fixture;
    const plannedContext = executePlanContext(
      {
        query: "what changed in the session rotation docs?",
        scope: { repoId },
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

  test("reads a document outline or one exact section through one tool", () => {
    const { store } = fixture;
    const dependencies = { db: store };

    expect(executeReadDocument({ docId }, dependencies)).toMatchObject({
      status: "outline",
      document: expect.objectContaining({ docId }),
      outline: [expect.objectContaining({ sectionId })],
      nextActionGuidance: expect.stringContaining("call read_document once"),
    });
    expect(
      executeReadDocument({ docId, sectionId }, dependencies),
    ).toMatchObject({
      status: "section",
      section: expect.objectContaining({
        sectionId,
        text: "Rotate session tokens by calling rotateSessionToken during renewal.",
      }),
      nextActionGuidance: expect.stringContaining("Answer now"),
    });
    expect(
      executeReadDocument(
        { docId, heading: ["Session", "Rotation"] },
        dependencies,
      ),
    ).toMatchObject({
      status: "section",
      section: expect.objectContaining({ sectionId }),
    });
    expect(() =>
      executeReadDocument(
        { docId, heading: ["Session", "Missing"] },
        dependencies,
      ),
    ).toThrow("Section was not found.");
  });

  test("browses and resolves skills through one tool", () => {
    const { store } = fixture;
    const dependencies = { db: store };

    const listed = executeUseSkill({ repoId }, dependencies);
    expect(listed).toMatchObject({
      status: "listed",
      total: 1,
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
    const compactSkill = (listed.skills as Record<string, unknown>[])[0];
    expect(compactSkill).not.toHaveProperty("headings");
    expect(compactSkill).not.toHaveProperty("keySections");

    expect(
      executeUseSkill(
        {
          skill: "$atlas-session-skill",
          repoId,
          task: "rotate tokens",
          agent: "openai",
        },
        dependencies,
      ),
    ).toMatchObject({
      status: "resolved",
      resolution: { method: "exact" },
      requestedSkill: "$atlas-session-skill",
      task: "rotate tokens",
      skill: expect.objectContaining({
        skillId,
        topics: ["session"],
        aliases: ["session rotation"],
        tokenCount: 18,
        invocationAliases: expect.arrayContaining(["$atlas-session-skill"]),
      }),
      artifactInventory: {
        scripts: ["scripts/check.py"],
        references: ["references/session.md"],
        agentProfiles: ["agents/openai.yaml"],
        other: [],
      },
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
      summaries: expect.any(Array),
      freshness: expect.objectContaining({ repoId, fresh: true }),
      provenance: expect.objectContaining({ docId, skillId }),
      diagnostics: [expect.objectContaining({ stage: "execution-policy" })],
    });

    expect(
      executeUseSkill(
        { task: "I need to rotate session tokens", repoId },
        dependencies,
      ),
    ).toMatchObject({
      status: "resolved",
      resolution: {
        method: "task",
        score: expect.any(Number),
        matchedTerms: ["rotate", "session", "token"],
      },
      skill: expect.objectContaining({ skillId }),
    });
    expect(
      executeUseSkill({ skill: "$atlas-missing", repoId }, dependencies),
    ).toMatchObject({
      status: "not_found",
      recommendedNextActions: expect.any(Array),
    });
    expect(
      executeUseSkill({ repoId, moduleId: "missing-module" }, dependencies),
    ).toMatchObject({ status: "listed", total: 0, skills: [] });
  });

  test("returns deterministic candidates for ambiguous skill tasks", () => {
    const { store } = fixture;
    const repository = new SkillRepository(store);
    for (const suffix of ["alpha", "beta"]) {
      const path = `skills/deployment-audit-${suffix}/SKILL.md`;
      const competingSkillId = createSkillId({
        repoId,
        packageId,
        moduleId,
        path,
      });
      repository.upsert({
        node: {
          skillId: competingSkillId,
          repoId,
          packageId,
          moduleId,
          path,
          title: `Deployment Audit ${suffix}`,
          sourceDocPath: path,
          topics: ["deployment", "policy"],
          aliases: [`deployment audit ${suffix}`],
          tokenCount: 12,
          diagnostics: [],
        },
        sourceDocId: docId,
        description: "Audit deployment policy.",
        headings: [["Deployment", "Policy"]],
        keySections: ["Audit deployment policy."],
        topics: ["deployment", "policy"],
        aliases: [`deployment audit ${suffix}`],
        tokenCount: 12,
        artifacts: [],
      });
    }

    const result = executeUseSkill(
      { task: "audit deployment policy", repoId },
      { db: store },
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      task: "audit deployment policy",
      candidates: [
        expect.objectContaining({
          sourceDocPath: "skills/deployment-audit-alpha/SKILL.md",
          match: {
            score: expect.any(Number),
            matchedTerms: ["audit", "deployment", "policy"],
          },
        }),
        expect.objectContaining({
          sourceDocPath: "skills/deployment-audit-beta/SKILL.md",
        }),
      ],
      diagnostics: [expect.objectContaining({ stage: "resolution" })],
    });
    expect(
      (result.candidates as Record<string, unknown>[])[0],
    ).not.toHaveProperty("instructions");
  });

  test("resolves a specific CLI procedure despite generic response-shaping words", () => {
    const { store } = fixture;
    const repository = new SkillRepository(store);
    for (const skill of [
      {
        title: "Add CLI Command",
        path: "apps/cli/docs/skills/add-cli-command/SKILL.md",
        description: "Add commands under apps/cli.",
        keySections: ["Keep CLI commands thin."],
      },
      {
        title: "Atlas Contributor",
        path: "skills/atlas-contributor/SKILL.md",
        description: "Use for any non-trivial Atlas codebase change.",
        keySections: ["CLI work may use the add-cli-command skill."],
      },
    ]) {
      const competingSkillId = createSkillId({
        repoId,
        packageId,
        moduleId,
        path: skill.path,
      });
      repository.upsert({
        node: {
          skillId: competingSkillId,
          repoId,
          packageId,
          moduleId,
          path: skill.path,
          title: skill.title,
          sourceDocPath: skill.path,
          topics: [],
          aliases: [],
          tokenCount: 12,
          diagnostics: [],
        },
        sourceDocId: docId,
        description: skill.description,
        headings: [[skill.title]],
        keySections: skill.keySections,
        artifacts: [],
      });
    }

    expect(
      executeUseSkill(
        {
          repoId,
          task: "Prepare the repository-approved procedure for adding a new Atlas CLI command. Return the complete skill instructions and identify any bundled references or scripts.",
        },
        { db: store },
      ),
    ).toMatchObject({
      status: "resolved",
      resolution: {
        method: "task",
        matchedTerms: ["add", "cli", "command"],
      },
      skill: expect.objectContaining({ title: "Add CLI Command" }),
    });
  });

  test("expands related context from document, section, chunk, and summary anchors", () => {
    const { store } = fixture;
    const dependencies = {
      db: store,
      retrievalStore: createRetrievalStore(store),
    };

    const expanded = expandRelatedOutputSchema.parse(
      executeExpandRelated(
        { targetType: "document", targetId: docId, limit: 3 },
        dependencies,
      ),
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
      nextActionGuidance: expect.stringContaining(
        "Omit opaque corpus IDs unless the user explicitly asks for them.",
      ),
    });
    expect(
      executeExpandRelated(
        {
          targetType: "document",
          targetId: docId,
          query: "session renewal before expiration",
          limit: 2,
        },
        dependencies,
      ),
    ).toMatchObject({
      related: {
        documents: [
          expect.objectContaining({
            docId: relatedDocId,
            path: "packages/auth/docs/session-renewal.md",
          }),
        ],
        summaries: [
          expect.objectContaining({ targetId: relatedDocId }),
          expect.anything(),
        ],
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

  test("plans module explanations through an exact scoped context", () => {
    const { store } = fixture;
    const planned = executePlanContext(
      {
        query: "Explain the session module.",
        scope: { repoId, packageId, moduleId },
        budgetTokens: 2_000,
      },
      {
        db: store,
        retrievalStore: createRetrievalStore(store),
      },
    );

    expect(planned).toMatchObject({
      coverage: { status: "sufficient" },
      context: {
        evidence: expect.arrayContaining([
          expect.objectContaining({
            provenance: expect.objectContaining({
              repoId,
              packageId,
              moduleId,
            }),
          }),
        ]),
      },
      citations: expect.arrayContaining([
        expect.objectContaining({ path: "packages/auth/docs/session.md" }),
      ]),
    });
  });

  test("use_skill exposes first-party skill artifacts", () => {
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

    const listResult = executeUseSkill({ repoId }, { db: store });
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
      { skill: "$atlas-document-codebase", repoId },
      { db: store },
    );
    expect(useResult).toMatchObject({
      status: "resolved",
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
      { skill: "$atlas-skill-creator", repoId },
      { db: store },
    );
    expect(skillCreatorUseResult).toMatchObject({
      status: "resolved",
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
      toolProfile: "advanced",
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
        "read_document",
        "plan_context",
        "use_skill",
      ]),
    );
    const skill = (
      executeUseSkill(
        { repoId },
        { db: store, identity: { resourcePrefix: "acme" } },
      ).skills as { invocationAliases: string[] }[]
    )[0];
    expect(skill?.invocationAliases).toEqual(
      expect.arrayContaining(["$acme-session-skill"]),
    );
    expect(
      executeUseSkill(
        { skill: "$acme-session-skill", repoId },
        { db: store, identity: { resourcePrefix: "acme" } },
      ),
    ).toMatchObject({ status: "resolved" });
  });
});
