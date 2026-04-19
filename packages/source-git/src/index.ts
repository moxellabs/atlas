export { LocalGitSourceAdapter } from "./adapters/local-git-source.adapter";
export type { LocalGitSourceAdapterOptions } from "./adapters/local-git-source.adapter";
export { RepoCacheService, requireLocalGitRepo } from "./cache/repo-cache.service";
export type {
  EnsureRepoCacheResult,
  RepoCacheDiagnosticEvent,
  RepoCacheServiceOptions,
  RepoCacheStatus,
  UpdateRepoCacheResult
} from "./cache/repo-cache.service";
export type { SourceGitDiagnosticEvent, SourceGitDiagnosticSink } from "./diagnostics";
export { diffPaths } from "./diff/diff-paths";
export type { ChangedPath, DiffPathsOptions } from "./diff/diff-paths";
export { filterRelevantPaths } from "./diff/filter-relevant-paths";
export type { RelevantPathFilters } from "./diff/filter-relevant-paths";
export {
  GitCloneError,
  GitCommandFailedError,
  GitCommandTimeoutError,
  GitDiffError,
  GitExecutableNotFoundError,
  GitFetchError,
  GitInvalidRepositoryError,
  GitReadFileError,
  GitRefResolutionError,
  GitSparseCheckoutError,
  GitUnsupportedRepoModeError,
  SourceGitError
} from "./git/git-errors";
export type { SourceGitErrorCode, SourceGitErrorContext } from "./git/git-errors";
