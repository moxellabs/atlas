/** Repository source modes supported by ATLAS ingestion. */
export const SOURCE_MODES = ["local-git", "ghes-api"] as const;

/** Repository source mode. */
export type SourceMode = (typeof SOURCE_MODES)[number];
