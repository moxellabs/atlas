import type { ClassificationDiagnostic } from "@atlas/core";

/** Diagnostic emitted by topology discovery helpers. */
export interface TopologyDiscoveryDiagnostic extends ClassificationDiagnostic {
  /** Optional path associated with the diagnostic. */
  path?: string | undefined;
}

/** Creates a consistent high-confidence discovery diagnostic. */
export function discoveryDiagnostic(
  reason: string,
  confidence: ClassificationDiagnostic["confidence"],
  path?: string
): TopologyDiscoveryDiagnostic {
  return path ? { reason, confidence, path } : { reason, confidence };
}
