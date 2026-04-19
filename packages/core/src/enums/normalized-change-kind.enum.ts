/** Processing-oriented content change kinds used for invalidation decisions. */
export const NORMALIZED_CONTENT_CHANGE_KINDS = ["added", "modified", "deleted", "renamed"] as const;

/** Processing-oriented content change kind. */
export type NormalizedContentChangeKind = (typeof NORMALIZED_CONTENT_CHANGE_KINDS)[number];
