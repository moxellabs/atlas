/** Machine-readable GHES source error categories. */
export type GhesSourceErrorCode =
  | "GHES_CONFIGURATION_FAILED"
  | "GHES_AUTHENTICATION_FAILED"
  | "GHES_REQUEST_FAILED"
  | "GHES_PAGINATION_FAILED"
  | "GHES_TREE_READ_FAILED"
  | "GHES_BLOB_READ_FAILED"
  | "GHES_CONTENT_READ_FAILED"
  | "GHES_REVISION_RESOLUTION_FAILED"
  | "GHES_DIFF_FAILED"
  | "GHES_UNSUPPORTED_REPO_MODE";

/** Structured context attached to source-ghes errors without secrets. */
export interface GhesSourceErrorContext {
  repoId?: string | undefined;
  owner?: string | undefined;
  repoName?: string | undefined;
  ref?: string | undefined;
  path?: string | undefined;
  endpoint?: string | undefined;
  operation?: string | undefined;
  status?: number | undefined;
  baseUrl?: string | undefined;
  authMode?: string | undefined;
  message?: string | undefined;
  cause?: unknown | undefined;
}

/** Base class for every error intentionally raised by packages/source-ghes. */
export class GhesSourceError extends Error {
  readonly code: GhesSourceErrorCode;
  readonly context: GhesSourceErrorContext;

  constructor(code: GhesSourceErrorCode, message: string, context: GhesSourceErrorContext = {}) {
    super(message, context.cause ? { cause: context.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
  }
}

export class GhesConfigurationError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_CONFIGURATION_FAILED", "Invalid GitHub Enterprise source configuration.", context);
  }
}

export class GhesAuthenticationError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_AUTHENTICATION_FAILED", "GitHub Enterprise authentication failed.", context);
  }
}

export class GhesRequestError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_REQUEST_FAILED", "GitHub Enterprise request failed.", context);
  }
}

export class GhesPaginationError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_PAGINATION_FAILED", "GitHub Enterprise pagination failed.", context);
  }
}

export class GhesTreeReadError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_TREE_READ_FAILED", "Failed to read GitHub Enterprise repository tree.", context);
  }
}

export class GhesBlobReadError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_BLOB_READ_FAILED", "Failed to read GitHub Enterprise blob content.", context);
  }
}

export class GhesContentReadError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_CONTENT_READ_FAILED", "Failed to read GitHub Enterprise repository content.", context);
  }
}

export class GhesRevisionResolutionError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_REVISION_RESOLUTION_FAILED", "Failed to resolve GitHub Enterprise repository revision.", context);
  }
}

export class GhesDiffError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_DIFF_FAILED", "Failed to compute GitHub Enterprise changed paths.", context);
  }
}

export class GhesUnsupportedRepoModeError extends GhesSourceError {
  constructor(context: GhesSourceErrorContext = {}) {
    super("GHES_UNSUPPORTED_REPO_MODE", "Repo config must use mode \"ghes-api\".", context);
  }
}
