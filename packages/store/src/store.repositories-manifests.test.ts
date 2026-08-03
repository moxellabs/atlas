import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CanonicalDocument,
  createDocId,
  createSectionId,
  createSkillId,
} from "@atlas/core";
import {
  DocRepository,
  getStoreDiagnostics,
  ManifestRepository,
  PackageRepository,
  pathSearch,
  RepoRepository,
  SectionRepository,
  SkillRepository,
  STORE_SCHEMA_VERSION,
  SummaryRepository,
} from "./index";
import {
  closeStoreFixture,
  createStoreFixture,
  moduleId,
  packageId,
  repoId,
  seedStructuralStore,
  type StoreFixture,
} from "./store.test-fixtures";

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

describe("store repositories and manifests", () => {
  let fixture: StoreFixture | undefined;

  beforeEach(async () => {
    fixture = await createStoreFixture();
  });

  afterEach(async () => {
    await closeStoreFixture(fixture);
    fixture = undefined;
  });

  test("stores slash-bearing canonical repo IDs unchanged", () => {
    const { store } = fixture!;
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

  test("normalizes document paths at write and path-search ingress", () => {
    const { store } = fixture!;
    seedStructuralStore(store);
    const document = createDocument(
      "Session",
      "Use this guide to authenticate requests.",
      "./packages\\auth//docs/session.md",
    );

    const stored = new DocRepository(store).upsert(document);

    expect(stored.path).toBe("packages/auth/docs/session.md");
    expect(new DocRepository(store).get(docId)?.path).toBe(
      "packages/auth/docs/session.md",
    );
    expect(
      pathSearch(store, {
        repoId,
        path: "\\packages\\auth\\docs\\session.md",
        mode: "exact",
      }),
    ).toEqual([
      expect.objectContaining({ docId, path: "packages/auth/docs/session.md" }),
    ]);
  });

  test("repository batch writes can run inside an outer transaction in node sqlite runtime", () => {
    const { store } = fixture!;
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

  test("persists structural entities, canonical docs, summaries, skills, manifests, and diagnostics", () => {
    const { dbPath, store } = fixture!;
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
    const { store } = fixture!;
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
});

function createDocument(
  title: string,
  text: string,
  path = "packages/auth/docs/session.md",
): CanonicalDocument {
  return {
    docId,
    repoId,
    path,
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
