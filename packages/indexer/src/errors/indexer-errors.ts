/** Structured context attached to indexer failures. */
export interface IndexerErrorContext {
  /** Operation that failed. */
  operation: string;
  /** Processing stage that failed. */
  stage?: string | undefined;
  /** Entity or subsystem involved in the failure. */
  entity?: string | undefined;
  /** Repository associated with the failure when known. */
  repoId?: string | undefined;
  /** Original thrown value, when available. */
  cause?: unknown;
}

/** Base class for indexer package failures. */
export class IndexerError extends Error {
  readonly context: IndexerErrorContext;

  constructor(message: string, context: IndexerErrorContext) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    if (context.cause !== undefined) {
      this.cause = context.cause;
    }
  }
}

/** Raised when sync orchestration fails. */
export class IndexerSyncError extends IndexerError {}

/** Raised when build orchestration fails. */
export class IndexerBuildError extends IndexerError {}

/** Raised when incremental planning fails. */
export class IndexerIncrementalBuildError extends IndexerError {}

/** Raised when build results cannot be persisted. */
export class IndexerPersistenceError extends IndexerError {}

/** Raised when required indexer configuration is missing or invalid. */
export class IndexerConfigurationError extends IndexerError {}
