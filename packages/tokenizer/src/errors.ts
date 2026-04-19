/** Context attached to structured tokenizer failures. */
export interface TokenizerErrorContext {
  /** Operation that failed. */
  operation: string;
  /** Encoding name when relevant. */
  encoding?: string | undefined;
  /** Processing stage when relevant. */
  stage?: string | undefined;
  /** Original thrown value. */
  cause?: unknown;
}

/** Base class for explicit tokenizer package failures. */
export class TokenizerError extends Error {
  readonly operation: string;
  readonly encoding?: string | undefined;
  readonly stage?: string | undefined;
  override readonly cause?: unknown;

  constructor(message: string, context: TokenizerErrorContext) {
    super(withContext(message, context), { cause: context.cause });
    this.name = new.target.name;
    this.operation = context.operation;
    this.encoding = context.encoding;
    this.stage = context.stage;
    this.cause = context.cause;
  }
}

/** Raised when an encoding or model cannot be resolved. */
export class TokenizerUnsupportedEncodingError extends TokenizerError {}

/** Raised when tokenizer initialization fails. */
export class TokenizerInitializationError extends TokenizerError {}

/** Raised when encode, decode, or count operations fail. */
export class TokenizerEncodeError extends TokenizerError {}

/** Raised when text cannot be split under the requested constraints. */
export class ChunkSplitError extends TokenizerError {}

/** Raised when token budget or chunking options are invalid. */
export class InvalidTokenBudgetError extends TokenizerError {}

function withContext(message: string, context: TokenizerErrorContext): string {
  const parts = [
    `operation=${context.operation}`,
    context.encoding === undefined ? undefined : `encoding=${context.encoding}`,
    context.stage === undefined ? undefined : `stage=${context.stage}`
  ].filter((part): part is string => part !== undefined);
  return `${message} (${parts.join(", ")})`;
}
