export interface FreshnessInput {
  repoId: string;
  repoRevision: string;
  indexedRevision?: string | undefined;
  lastSyncAt?: string | undefined;
  partialRevision?: string | undefined;
  partialBuildTimestamp?: string | undefined;
  partialSelector?: unknown;
}

export interface FreshnessSnapshot extends FreshnessInput {
  fresh: boolean;
  stale: boolean;
  indexed: boolean;
}

/** Computes the shared local freshness contract used by CLI, server, MCP, and retrieval. */
export function computeFreshness(input: FreshnessInput): FreshnessSnapshot {
  const indexed = input.indexedRevision !== undefined;
  const fresh = indexed && input.indexedRevision === input.repoRevision;
  return {
    ...input,
    indexed,
    fresh,
    stale: !fresh
  };
}
