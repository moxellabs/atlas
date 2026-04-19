export { GhesSourceAdapter, requireGhesRepo } from "./adapters/ghes-source.adapter";
export type { GhesSourceAdapterOptions, GhesSourceDiagnosticEvent, GhesSourceDiagnosticSink } from "./adapters/ghes-source.adapter";
export { buildAuthHeaders, describeAuth } from "./client/auth";
export type { GhesAuthConfig, GhesAuthMetadata } from "./client/auth";
export { GhesClient, normalizeBaseUrl } from "./client/ghes-client";
export type { GhesClientOptions, GhesFetch } from "./client/ghes-client";
export {
  GhesAuthenticationError,
  GhesBlobReadError,
  GhesConfigurationError,
  GhesContentReadError,
  GhesDiffError,
  GhesPaginationError,
  GhesRequestError,
  GhesRevisionResolutionError,
  GhesSourceError,
  GhesTreeReadError,
  GhesUnsupportedRepoModeError
} from "./errors";
export type { GhesSourceErrorCode, GhesSourceErrorContext } from "./errors";
