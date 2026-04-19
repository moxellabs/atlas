/**
 * Machine-readable source-git error categories used by callers to decide
 * whether a failure is environmental, configuration-related, or retryable.
 */
export type SourceGitErrorCode =
  | "GIT_EXECUTABLE_NOT_FOUND"
  | "GIT_CLONE_FAILED"
  | "GIT_FETCH_FAILED"
  | "GIT_INVALID_REPOSITORY"
  | "GIT_REF_RESOLUTION_FAILED"
  | "GIT_SPARSE_CHECKOUT_FAILED"
  | "GIT_DIFF_FAILED"
  | "GIT_READ_FILE_FAILED"
  | "GIT_COMMAND_TIMED_OUT"
  | "GIT_COMMAND_FAILED"
  | "GIT_UNSUPPORTED_REPO_MODE";

/**
 * Structured context attached to source-git errors so CLI and server layers can
 * render actionable diagnostics without scraping Git stderr.
 */
export interface SourceGitErrorContext {
  /** ATLAS repo identifier associated with the failure, when known. */
  repoId?: string | undefined;
  /** Working directory or target local repo path associated with the failure. */
  localPath?: string | undefined;
  /** Command vector that produced the failure. */
  command?: readonly string[] | undefined;
  /** Captured stderr from Git, when a command reached Git. */
  stderr?: string | undefined;
  /** Captured stdout from Git, useful for commands that report errors there. */
  stdout?: string | undefined;
  /** Subprocess exit code, when available. */
  exitCode?: number | undefined;
  /** Configured timeout in milliseconds for timeout failures. */
  timeoutMs?: number | undefined;
  /** Repository-relative file path associated with read/path failures. */
  relativePath?: string | undefined;
  /** Underlying thrown value for filesystem or subprocess failures. */
  cause?: unknown | undefined;
}

/** Base class for every error intentionally raised by packages/source-git. */
export class SourceGitError extends Error {
  /** Stable category for programmatic handling. */
  readonly code: SourceGitErrorCode;

  /** Structured details for diagnostics and logs. */
  readonly context: SourceGitErrorContext;

  constructor(code: SourceGitErrorCode, message: string, context: SourceGitErrorContext = {}) {
    super(message, context.cause ? { cause: context.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
  }
}

/** Raised when the `git` executable cannot be launched. */
export class GitExecutableNotFoundError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_EXECUTABLE_NOT_FOUND", "Git executable was not found on PATH.", context);
  }
}

/** Raised when the initial managed cache clone fails. */
export class GitCloneError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_CLONE_FAILED", "Git clone failed for the managed repo cache.", context);
  }
}

/** Raised when an incremental fetch fails. */
export class GitFetchError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_FETCH_FAILED", "Git fetch failed for the managed repo cache.", context);
  }
}

/** Raised when a configured local path is not a usable Git repository. */
export class GitInvalidRepositoryError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_INVALID_REPOSITORY", "Configured local path is not a valid Git repository.", context);
  }
}

/** Raised when the configured ref cannot be resolved to a commit. */
export class GitRefResolutionError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_REF_RESOLUTION_FAILED", "Configured Git ref could not be resolved.", context);
  }
}

/** Raised when sparse-checkout setup or pattern application fails. */
export class GitSparseCheckoutError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_SPARSE_CHECKOUT_FAILED", "Git sparse-checkout configuration failed.", context);
  }
}

/** Raised when changed-path detection fails. */
export class GitDiffError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_DIFF_FAILED", "Git diff failed while computing changed paths.", context);
  }
}

/** Raised when a file cannot be safely read from a managed checkout. */
export class GitReadFileError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_READ_FILE_FAILED", "Failed to read a file from the managed repo checkout.", context);
  }
}

/** Raised when a Git subprocess exceeds its configured timeout. */
export class GitCommandTimeoutError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_COMMAND_TIMED_OUT", "Git command timed out.", context);
  }
}

/** Raised when local-git APIs are called with a non-local-git repo config. */
export class GitUnsupportedRepoModeError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_UNSUPPORTED_REPO_MODE", "Repo config must use mode \"local-git\".", context);
  }
}

/** Raised for uncategorized non-zero Git command exits. */
export class GitCommandFailedError extends SourceGitError {
  constructor(context: SourceGitErrorContext = {}) {
    super("GIT_COMMAND_FAILED", "Git command failed.", context);
  }
}
