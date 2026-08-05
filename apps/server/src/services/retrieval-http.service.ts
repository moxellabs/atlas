import type { DocumentMetadataFilters } from "@atlas/core";
import {
  createRetrievalStore,
  searchPassages,
  findScopes,
  planContext,
  type RetrievalStore,
} from "@atlas/retrieval";
import type { AtlasStoreClient, DocumentRecord } from "@atlas/store";

/** HTTP-facing retrieval facade that keeps routes thin. */
export class RetrievalHttpService {
  private readonly store: RetrievalStore;

  constructor(db: AtlasStoreClient) {
    this.store = createRetrievalStore(db);
  }

  /** Finds likely scopes for a query. */
  findScopes(input: {
    query: string;
    repoId?: string;
    limit?: number;
    filters?: DocumentMetadataFilters;
  }) {
    return findScopes({
      store: this.store,
      ...input,
    });
  }

  /** Searches ranked passages through retrieval planning. */
  searchPassages(input: {
    query: string;
    repoId?: string;
    scopeIds?: string[];
    kinds?: DocumentRecord["kind"][];
    limit?: number;
    filters?: DocumentMetadataFilters;
  }) {
    return searchPassages({
      store: this.store,
      ...input,
    });
  }

  /** Plans token-budgeted context for a query. */
  planContext(input: {
    query: string;
    repoId?: string;
    budgetTokens: number;
    candidateLimit?: number;
    summaryLimit?: number;
    expansionLimit?: number;
    filters?: DocumentMetadataFilters;
  }) {
    return planContext({
      store: this.store,
      ...input,
    });
  }

  /** Returns a retrieval diagnostic snapshot for inspect routes. */
  inspect(input: { query: string; repoId?: string; budgetTokens: number }) {
    const plan = this.planContext(input);
    return {
      classification: plan.classification,
      scopes: plan.scopes,
      rankedHits: plan.rankedHits,
      selected: plan.selected,
      omitted: plan.omitted,
      diagnostics: plan.diagnostics,
      ambiguity: plan.ambiguity,
      indexedDocuments:
        input.repoId === undefined
          ? []
          : this.store.listDocumentsByRepo(input.repoId),
    };
  }
}
