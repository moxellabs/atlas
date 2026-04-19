/** Context attached to structured store errors. */
export interface StoreErrorContext {
  operation: string;
  entity?: string | undefined;
  sql?: string | undefined;
  cause?: unknown;
}

/** Base class for explicit store failures. */
export class StoreError extends Error {
  readonly operation: string;
  readonly entity?: string | undefined;
  readonly sql?: string | undefined;
  override readonly cause?: unknown;

  constructor(message: string, context: StoreErrorContext) {
    super(withContext(message, context), { cause: context.cause });
    this.name = new.target.name;
    this.operation = context.operation;
    this.entity = context.entity;
    this.sql = context.sql;
    this.cause = context.cause;
  }
}

/** Raised when opening or initializing the database fails. */
export class StoreInitializationError extends StoreError {}

/** Raised when applying schema migrations fails. */
export class StoreMigrationError extends StoreError {}

/** Raised when a transaction fails and is rolled back. */
export class StoreTransactionError extends StoreError {}

/** Raised when repository read/write operations fail. */
export class StoreRepositoryError extends StoreError {}

/** Raised when full-text or structured search fails. */
export class StoreSearchError extends StoreError {}

function withContext(message: string, context: StoreErrorContext): string {
  const parts = [
    `operation=${context.operation}`,
    context.entity === undefined ? undefined : `entity=${context.entity}`,
    context.sql === undefined ? undefined : `sql=${context.sql}`
  ].filter((part): part is string => part !== undefined);
  return `${message} (${parts.join(", ")})`;
}
