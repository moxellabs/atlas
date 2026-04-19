/** High-fidelity source-system change kinds. */
export const RAW_SOURCE_CHANGE_KINDS = ["added", "modified", "deleted", "renamed", "copied", "type-changed"] as const;

/** High-fidelity source-system change kind. */
export type RawSourceChangeKind = (typeof RAW_SOURCE_CHANGE_KINDS)[number];
