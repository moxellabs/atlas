import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CanonicalDocument,
  type CorpusChunk,
  createChunkId,
  createDocId,
  createSectionId,
} from "@atlas/core";

import {
  ChunkRepository,
  DocRepository,
  lexicalSearch,
  pathSearch,
  RepoRepository,
  SectionRepository,
  scopeSearch,
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

describe("store deletion and cascade", () => {
  let fixture: StoreFixture | undefined;

  beforeEach(async () => {
    fixture = await createStoreFixture();
  });

  afterEach(async () => {
    await closeStoreFixture(fixture);
    fixture = undefined;
  });

  test("persists chunks, supports path and scope search, and cascades repo deletion", () => {
    const { store } = fixture!;
    seedStructuralStore(store);
    const document = createDocument(
      "Session",
      "Session tokens authenticate requests.",
    );
    new DocRepository(store).replaceCanonicalDocument(document);
    const chunk: CorpusChunk = {
      chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
      docId,
      repoId,
      packageId,
      moduleId,
      kind: "module-doc",
      authority: "preferred",
      headingPath: ["Session"],
      ordinal: 0,
      text: "Session token rotation is supported.",
      searchText:
        "repo: atlas | title: Session | section: Session | path: packages/auth/docs/session.md\n\ncontextual-only Session token rotation is supported.",
      tokenCount: 8,
    };
    new ChunkRepository(store).replaceForDocument(docId, [chunk]);

    expect(
      pathSearch(store, {
        repoId,
        path: "packages/auth/docs/session.md",
        mode: "exact",
      }),
    ).toEqual([
      expect.objectContaining({ docId, path: "packages/auth/docs/session.md" }),
    ]);
    expect(
      pathSearch(store, {
        repoId,
        path: "./packages\\auth//docs/session.md",
        mode: "exact",
      }),
    ).toEqual([
      expect.objectContaining({ docId, path: "packages/auth/docs/session.md" }),
    ]);
    expect(
      pathSearch(store, { path: "\\packages\\auth\\docs", mode: "prefix" }),
    ).toEqual([expect.objectContaining({ docId })]);
    expect(scopeSearch(store, { repoId, moduleId })).toEqual([
      expect.objectContaining({ docId }),
    ]);
    expect(lexicalSearch(store, { query: "rotation", repoId })).toEqual([
      expect.objectContaining({
        entityType: "chunk",
        chunkId: chunk.chunkId,
        docId,
      }),
    ]);
    expect(
      lexicalSearch(store, { query: "rotation imaginary", repoId }),
    ).toEqual([
      expect.objectContaining({
        entityType: "chunk",
        chunkId: chunk.chunkId,
        docId,
      }),
    ]);
    expect(lexicalSearch(store, { query: "export", repoId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: "document", docId }),
        expect.objectContaining({
          entityType: "section",
          sectionId,
          docId,
        }),
      ]),
    );
    expect(lexicalSearch(store, { query: "contextual-only", repoId })).toEqual([
      expect.objectContaining({
        entityType: "chunk",
        chunkId: chunk.chunkId,
        docId,
      }),
    ]);
    const chunkFtsBody = store.get<{ body: string }>(
      "SELECT body FROM fts_entries WHERE entity_type = 'chunk' AND chunk_id = $chunkId",
      { $chunkId: chunk.chunkId },
    )?.body;
    expect(chunkFtsBody).toBe(
      "repo: atlas | section: Session\n\ncontextual-only Session token rotation is supported.",
    );
    expect(chunkFtsBody).not.toContain("title: Session");
    expect(chunkFtsBody).not.toContain("path: packages/auth/docs/session.md");
    expect(new ChunkRepository(store).getById(chunk.chunkId)).toMatchObject({
      chunkId: chunk.chunkId,
      docId,
      text: "Session token rotation is supported.",
    });
    expect(new ChunkRepository(store).getById("missing_chunk")).toBeUndefined();

    new SectionRepository(store).deleteForDocument(docId);
    expect(new SectionRepository(store).listByDocument(docId)).toEqual([]);
    expect(new ChunkRepository(store).listByDocument(docId)).toEqual([]);
    expect(lexicalSearch(store, { query: "rotation", repoId })).toEqual([]);
    expect(lexicalSearch(store, { query: "authenticate", repoId })).toEqual([
      expect.objectContaining({ entityType: "document", docId }),
    ]);

    new RepoRepository(store).delete(repoId);

    expect(new DocRepository(store).get(docId)).toBeUndefined();
    expect(new ChunkRepository(store).listByDocument(docId)).toEqual([]);
    expect(lexicalSearch(store, { query: "rotation", repoId })).toEqual([]);
  });
});

function createDocument(title: string, text: string): CanonicalDocument {
  return {
    docId,
    repoId,
    path: "packages/auth/docs/session.md",
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
