import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RepoRepository } from "@atlas/store";

import {
  createSeededRetrievalFixture,
  repoDocId,
  repoId,
  sessionDocId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
import type { RetrievalStore } from "../types";
import { gatherCandidates } from "./gather-candidates";

describe("gatherCandidates", () => {
  let fixture: SeededRetrievalFixture | undefined;

  beforeEach(async () => {
    fixture = await createSeededRetrievalFixture();
  });

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  test("uses precise lexical evidence before Atlas-specific expansions", () => {
    const lexicalQueries: string[] = [];
    const pathQueries: string[] = [];
    const retrievalStore = fixture!.retrievalStore;
    const trackedStore: RetrievalStore = {
      ...retrievalStore,
      lexicalSearch(options) {
        lexicalQueries.push(options.query);
        return retrievalStore.lexicalSearch(options);
      },
      pathSearch(options) {
        pathQueries.push(options.path);
        return retrievalStore.pathSearch(options);
      },
    };

    const candidates = gatherCandidates(trackedStore, {
      query: "How does session rotation work?",
      expandedQuery:
        "How does session rotation work? credentials docs/architecture.md",
      scopes: [],
      candidateLimit: 40,
      countTokens: () => 1,
    });

    expect(lexicalQueries).toEqual(["session rotation"]);
    expect(pathQueries).toEqual([]);
    expect(
      candidates.some(
        (candidate) => candidate.provenance.docId === sessionDocId,
      ),
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.provenance.docId === repoDocId),
    ).toBe(false);
    lexicalQueries.length = 0;
    pathQueries.length = 0;
    gatherCandidates(trackedStore, {
      query: "How does session rotation work?",
      expandedQuery:
        "How does session rotation work? credentials docs/architecture.md",
      repoId,
      scopes: [],
      candidateLimit: 40,
      countTokens: () => 1,
    });
    expect(lexicalQueries).toEqual([
      "session rotation",
      "session rotation credentials docs architecture md",
    ]);
    expect(pathQueries).toEqual(["docs/architecture.md", "architecture.md"]);
  });

  test("uses expanded terms and path hints only for sparse original matches", () => {
    const lexicalQueries: string[] = [];
    const pathQueries: string[] = [];
    const retrievalStore = fixture!.retrievalStore;
    const trackedStore: RetrievalStore = {
      ...retrievalStore,
      lexicalSearch(options) {
        lexicalQueries.push(options.query);
        return retrievalStore.lexicalSearch(options);
      },
      pathSearch(options) {
        pathQueries.push(options.path);
        return retrievalStore.pathSearch(options);
      },
    };

    const candidates = gatherCandidates(trackedStore, {
      query: "quantum scheduler",
      expandedQuery: "quantum scheduler `docs/architecture.md`",
      repoId,
      scopes: [],
      candidateLimit: 40,
      countTokens: () => 1,
    });

    expect(lexicalQueries).toEqual([
      "quantum scheduler",
      "quantum scheduler docs architecture md",
    ]);
    expect(pathQueries).toEqual(["docs/architecture.md", "architecture.md"]);
    expect(
      candidates.some((candidate) => candidate.provenance.docId === repoDocId),
    ).toBe(true);
  });

  test("bounds repository scans behind the retrieval store port", () => {
    const store = fixture!.store;
    const repos = new RepoRepository(store);
    for (let index = 0; index < 12; index += 1) {
      repos.upsert({
        repoId: `fallback-${index.toString().padStart(2, "0")}`,
        mode: "local-git",
        revision: "rev_1",
      });
    }

    let listReposCalls = 0;
    const scannedRepoIds: string[] = [];
    const retrievalStore = fixture!.retrievalStore;
    const boundedStore: RetrievalStore = {
      ...retrievalStore,
      listRepos() {
        listReposCalls += 1;
        return retrievalStore.listRepos();
      },
      listDocumentsByRepo(scannedRepoId) {
        scannedRepoIds.push(scannedRepoId);
        return [];
      },
    };

    const candidates = gatherCandidates(boundedStore, {
      query: "quantum cache scheduler",
      expandedQuery: "quantum cache scheduler",
      scopes: [],
      candidateLimit: 40,
      countTokens: () => 1,
    });

    expect(candidates).toEqual([]);
    expect(listReposCalls).toBe(1);
    expect(scannedRepoIds).toHaveLength(8);
  });
});
