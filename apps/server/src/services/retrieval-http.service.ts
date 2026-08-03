import type { DocumentMetadataFilters } from "@atlas/core";
import { findDocs, findScopes, planContext } from "@atlas/retrieval";
import type { AtlasStoreClient, DocumentRecord } from "@atlas/store";
import { DocRepository } from "@atlas/store";

/** HTTP-facing retrieval facade that keeps routes thin. */
export class RetrievalHttpService {
  constructor(private readonly db: AtlasStoreClient) {}

  /** Finds likely scopes for a query. */
  findScopes(input: {
    query: string;
    repoId?: string;
    limit?: number;
    filters?: DocumentMetadataFilters;
  }) {
    return findScopes({
      db: this.db,
      ...input,
    });
  }

  /** Finds ranked document-ish hits through retrieval planning. */
  findDocs(input: {
    query: string;
    repoId?: string;
    scopeIds?: string[];
    kinds?: DocumentRecord["kind"][];
    limit?: number;
    filters?: DocumentMetadataFilters;
  }) {
    return findDocs({
      db: this.db,
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
      db: this.db,
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
          : new DocRepository(this.db).listByRepo(input.repoId),
    };
  }
}
