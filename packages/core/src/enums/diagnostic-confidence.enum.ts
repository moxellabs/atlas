/** Confidence levels used by classification and retrieval diagnostics. */
export const DIAGNOSTIC_CONFIDENCES = ["high", "medium", "low"] as const;

/** Diagnostic confidence level. */
export type DiagnosticConfidence = (typeof DIAGNOSTIC_CONFIDENCES)[number];
