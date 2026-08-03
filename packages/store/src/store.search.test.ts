import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CanonicalDocument,
  createDocId,
  createSectionId,
} from "@atlas/core";

import { DocRepository, lexicalSearch } from "./index";
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

describe("store search", () => {
  let fixture: StoreFixture | undefined;

  beforeEach(async () => {
    fixture = await createStoreFixture();
  });

  afterEach(async () => {
    await closeStoreFixture(fixture);
    fixture = undefined;
  });

  test("weights title path and heading matches above body-only matches", () => {
    const { store } = fixture!;
    seedStructuralStore(store);
    const titleDocId = createDocId({
      repoId,
      path: "docs/public-artifacts.md",
    });
    const bodyDocId = createDocId({ repoId, path: "docs/body-only.md" });
    new DocRepository(store).replaceCanonicalDocument({
      ...createDocument(
        "Public Artifact",
        "General release packaging guidance.",
      ),
      docId: titleDocId,
      path: "docs/public-artifacts.md",
      sections: [
        {
          sectionId: createSectionId({
            docId: titleDocId,
            headingPath: ["Artifact"],
            ordinal: 0,
          }),
          headingPath: ["Artifact"],
          ordinal: 0,
          text: "Release packaging guidance.",
          codeBlocks: [],
        },
      ],
    });
    new DocRepository(store).replaceCanonicalDocument({
      ...createDocument(
        "Operations",
        "Artifact artifact artifact artifact details live here.",
      ),
      docId: bodyDocId,
      path: "docs/body-only.md",
    });

    const hits = lexicalSearch(store, { query: "artifact", repoId, limit: 6 });

    expect(hits[0]).toMatchObject({ docId: titleDocId });
    expect(hits.findIndex((hit) => hit.docId === titleDocId)).toBeLessThan(
      hits.findIndex((hit) => hit.docId === bodyDocId),
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
