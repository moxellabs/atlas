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
  ModuleRepository,
  openStore,
  PackageRepository,
  RepoRepository,
  SkillRepository,
  SummaryRepository,
} from "@atlas/store";

import { createRetrievalStore } from "./store/retrieval-store";
import type { RetrievalStore } from "./types";

export const repoId = "atlas";
export const authPackageId = createPackageId({ repoId, path: "packages/auth" });
export const billingPackageId = createPackageId({
  repoId,
  path: "packages/billing",
});
export const sessionModuleId = createModuleId({
  repoId,
  packageId: authPackageId,
  path: "packages/auth/src/session",
});
export const loginModuleId = createModuleId({
  repoId,
  packageId: authPackageId,
  path: "packages/auth/src/login",
});
export const invoiceModuleId = createModuleId({
  repoId,
  packageId: billingPackageId,
  path: "packages/billing/src/invoice",
});
export const sessionDocId = createDocId({
  repoId,
  path: "packages/auth/docs/session.md",
});
export const loginDocId = createDocId({
  repoId,
  path: "packages/auth/docs/login.md",
});
export const repoDocId = createDocId({
  repoId,
  path: "docs/architecture.md",
});
export const invoiceDocId = createDocId({
  repoId,
  path: "packages/billing/docs/invoice.md",
});
export const sessionSkillId = createSkillId({
  repoId,
  packageId: authPackageId,
  moduleId: sessionModuleId,
  path: "packages/auth/docs/session-skill.md",
});

export interface SeededRetrievalFixture {
  readonly store: AtlasStoreClient;
  readonly retrievalStore: RetrievalStore;
  dispose(): Promise<void>;
}

export async function createSeededRetrievalFixture(): Promise<SeededRetrievalFixture> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-retrieval-test-"));
  const dbPath = join(directory, "atlas.db");
  let store: AtlasStoreClient | undefined;

  try {
    const activeStore = openStore({ path: dbPath, migrate: true });
    store = activeStore;
    seedStore(activeStore);
    const retrievalStore = createRetrievalStore(activeStore);
    let disposed = false;

    return {
      store: activeStore,
      retrievalStore,
      async dispose(): Promise<void> {
        if (disposed) {
          return;
        }
        disposed = true;
        const errors = await cleanupRetrievalFixtureResources(
          activeStore,
          directory,
        );
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            "Failed to dispose retrieval test fixture.",
          );
        }
      },
    };
  } catch (error) {
    const cleanupErrors = await cleanupRetrievalFixtureResources(
      store,
      directory,
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Failed to initialize retrieval test fixture.",
      );
    }
    throw error;
  }
}

async function cleanupRetrievalFixtureResources(
  store: AtlasStoreClient | undefined,
  directory: string,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (store !== undefined) {
    try {
      store.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  return errors;
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
          text: "Auth architecture coordinates login and session modules. Maintainers build release outputs as public corpus artifacts under .moxel/atlas.",
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
