/** Stable documentation artifact classifications. */
export const DOC_KINDS = ["repo-doc", "package-doc", "module-doc", "skill-doc", "guide-doc", "reference-doc"] as const;

/** Documentation artifact classification. */
export type DocKind = (typeof DOC_KINDS)[number];
