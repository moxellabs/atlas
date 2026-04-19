/** Stable authority levels used to rank documentation trust. */
export const AUTHORITIES = ["canonical", "preferred", "supplemental"] as const;

/** Documentation authority level. */
export type Authority = (typeof AUTHORITIES)[number];
