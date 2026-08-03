import { mkdtemp, rm } from "node:fs/promises";
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
  SkillRepository,
  SummaryRepository,
} from "@atlas/store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildIndexedSourceCatalog } from "./discovery/indexed-source-catalog";

export const repoId = "atlas";
export const packageId = createPackageId({ repoId, path: "packages/auth" });
export const moduleId = createModuleId({
  repoId,
  packageId,
  path: "packages/auth/src/session",
});
export const docId = createDocId({
  repoId,
  path: "packages/auth/docs/session.md",
});
export const sectionId = createSectionId({
  docId,
  headingPath: ["Session", "Rotation"],
  ordinal: 0,
});
export const skillId = createSkillId({
  repoId,
  packageId,
  moduleId,
  path: "packages/auth/docs/session-skill.md",
});
export const documentSummaryId = `${docId}:summary`;
export const relatedDocId = createDocId({
  repoId,
  path: "packages/auth/docs/session-renewal.md",
});
export const relatedSectionId = createSectionId({
  docId: relatedDocId,
  headingPath: ["Session", "Renewal"],
  ordinal: 0,
});

export interface McpTestFixture {
  readonly store: AtlasStoreClient;
  registerCleanup(cleanup: () => Promise<void>): void;
  cleanup(): Promise<void>;
}

export async function createMcpTestFixture(): Promise<McpTestFixture> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-mcp-test-"));
  const store = await openSeededMcpTestStore(directory);
  const cleanups: Array<() => Promise<void>> = [];

  return {
    store,
    registerCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async cleanup() {
      let firstError: unknown;
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          firstError ??= error;
        }
      }
      try {
        store.close();
      } catch (error) {
        firstError ??= error;
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) throw firstError;
    },
  };
}

async function openSeededMcpTestStore(
  directory: string,
): Promise<AtlasStoreClient> {
  let store: AtlasStoreClient | undefined;
  try {
    store = openStore({ path: join(directory, "atlas.db"), migrate: true });
    seedStore(store);
    return store;
  } catch (error) {
    const errors: unknown[] = [error];
    if (store !== undefined) {
      try {
        store.close();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        "Failed to initialize MCP test fixture.",
      );
    }
    throw error;
  }
}

export function createMcpTestCatalog(store: AtlasStoreClient) {
  return buildIndexedSourceCatalog({ db: store });
}

type ConnectableMcpServer = {
  connect(transport: InMemoryTransport): Promise<void>;
};

export async function createConnectedMcpTestClient(
  server: ConnectableMcpServer,
  clientInfo: { name: string; version: string },
): Promise<Client> {
  const client = new Client(clientInfo, { capabilities: {} });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
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
      tags: ["session", "append"],
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
