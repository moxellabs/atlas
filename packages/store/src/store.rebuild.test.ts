import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CanonicalDocument,
  createDocId,
  createSectionId,
} from "@atlas/core";

import { DocRepository, lexicalSearch, SectionRepository } from "./index";
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

describe("store rebuild replacement", () => {
  let fixture: StoreFixture | undefined;

  beforeEach(async () => {
    fixture = await createStoreFixture();
  });

  afterEach(async () => {
    await closeStoreFixture(fixture);
    fixture = undefined;
  });

  test("replaces document child artifacts cleanly on rebuild", () => {
    const { store } = fixture!;
    seedStructuralStore(store);
    const docRepo = new DocRepository(store);
    docRepo.replaceCanonicalDocument(createDocument("Session", "Old text."));

    const replacementSectionId = createSectionId({
      docId,
      headingPath: ["Session", "Rotation"],
      ordinal: 0,
    });
    docRepo.replaceCanonicalDocument({
      ...createDocument("Session", "Rotated text."),
      sections: [
        {
          sectionId: replacementSectionId,
          headingPath: ["Session", "Rotation"],
          ordinal: 0,
          text: "Rotated text.",
          codeBlocks: [],
        },
      ],
    });

    expect(new SectionRepository(store).listByDocument(docId)).toEqual([
      expect.objectContaining({
        sectionId: replacementSectionId,
        headingPath: ["Session", "Rotation"],
        text: "Rotated text.",
      }),
    ]);
    expect(lexicalSearch(store, { query: "Old", repoId })).toEqual([]);
    expect(lexicalSearch(store, { query: "Rotated", repoId })[0]).toMatchObject(
      { docId },
    );
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
