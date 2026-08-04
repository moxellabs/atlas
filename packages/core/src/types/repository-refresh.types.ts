/** Repository refresh states surfaced by answer planning. */
export const REPOSITORY_REFRESH_STATUSES = [
  "fresh",
  "stale",
  "refreshing",
  "refresh_failed",
] as const;

/** Current lifecycle state for one imported repository. */
export type RepositoryRefreshStatus =
  (typeof REPOSITORY_REFRESH_STATUSES)[number];

/** Actionable failure retained after a background refresh attempt. */
export interface RepositoryRefreshFailure {
  /** Stable error or diagnostic code when one is available. */
  code?: string | undefined;
  /** Redacted operator-facing failure message. */
  message: string;
}

/** Persisted lifecycle state for one imported repository. */
export interface RepositoryRefreshState {
  /** Canonical repository identifier. */
  repoId: string;
  /** Current background lifecycle status. */
  status: RepositoryRefreshStatus;
  /** Time the most recent source check completed. */
  lastCheckedAt?: string | undefined;
  /** Time the most recent successful source check completed. */
  lastSuccessfulRefreshAt?: string | undefined;
  /** Time the active refresh started. */
  refreshStartedAt?: string | undefined;
  /** Source revision observed by the latest completed check. */
  sourceRevision?: string | undefined;
  /** Revision currently represented by the indexed corpus. */
  indexedRevision?: string | undefined;
  /** Bounded source paths observed by the most recent source check. */
  changedPaths: readonly string[];
  /** Latest refresh failure, present only when status is refresh_failed. */
  error?: RepositoryRefreshFailure | undefined;
}

/** Synchronous read boundary used by query-time consumers. */
export interface RepositoryRefreshStateProvider {
  getRepositoryRefreshState(repoId: string): RepositoryRefreshState | undefined;
}
