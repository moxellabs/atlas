import { classifyQuery, inferScopes, planContext } from "@atlas/retrieval";
import type { AtlasStoreClient, DocumentRecord } from "@atlas/store";
import { DocRepository } from "@atlas/store";

/** HTTP-facing retrieval facade that keeps routes thin. */
export class RetrievalHttpService {
  constructor(private readonly db: AtlasStoreClient) {}

  /** Finds likely scopes for a query. */
  findScopes(input: { query: string; repoId?: string; limit?: number }) {
    const classification = classifyQuery(input.query);
    const result = inferScopes({
      db: this.db,
      query: input.query,
      classification,
      ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
      ...(input.limit === undefined ? {} : { limit: input.limit })
    });
    return { query: input.query, classification, scopes: result.scopes, diagnostics: result.diagnostics };
  }

  /** Finds ranked document-ish hits through retrieval planning. */
  findDocs(input: { query: string; repoId?: string; scopeIds?: string[]; kinds?: DocumentRecord["kind"][]; limit?: number }) {
    const plan = planContext({
      db: this.db,
      query: input.query,
      budgetTokens: 8_000,
      ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
      candidateLimit: input.limit ?? 20
    });
    const scopeIds = new Set(input.scopeIds ?? []);
    const kinds = new Set(input.kinds ?? []);
    return {
      query: input.query,
      classification: plan.classification,
      hits: plan.rankedHits
        .filter((hit) => hit.targetType !== "summary")
        .filter((hit) => kinds.size === 0 || (hit.kind !== undefined && kinds.has(hit.kind)))
        .filter((hit) =>
          scopeIds.size === 0
            ? true
            : [hit.provenance.repoId, hit.provenance.packageId, hit.provenance.moduleId, hit.provenance.skillId].some(
                (scopeId) => scopeId !== undefined && scopeIds.has(scopeId)
              )
        )
        .slice(0, input.limit ?? 20),
      ambiguity: plan.ambiguity,
      diagnostics: plan.diagnostics
    };
  }

  /** Plans token-budgeted context for a query. */
  planContext(input: {
    query: string;
    repoId?: string;
    budgetTokens: number;
    candidateLimit?: number;
    summaryLimit?: number;
    expansionLimit?: number;
  }) {
    return planContext({
      db: this.db,
      query: input.query,
      budgetTokens: input.budgetTokens,
      ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
      ...(input.candidateLimit === undefined ? {} : { candidateLimit: input.candidateLimit }),
      ...(input.summaryLimit === undefined ? {} : { summaryLimit: input.summaryLimit }),
      ...(input.expansionLimit === undefined ? {} : { expansionLimit: input.expansionLimit })
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
      indexedDocuments: input.repoId === undefined ? [] : new DocRepository(this.db).listByRepo(input.repoId)
    };
  }
}
