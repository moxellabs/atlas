import { exitCodeForReport, summarizeReport } from "../utils/errors";
/** Renders a sync/build report batch in human mode. */
export function reportLines(
  report: { reports?: Array<SyncLike | BuildLike> } | SyncLike | BuildLike,
): string[] {
  if ("reports" in report && report.reports) {
    return [
      summarizeReport(report as never),
      ...report.reports.map((entry) => `- ${summarizeReport(entry as never)}`),
    ];
  }
  return [summarizeReport(report as never)];
}

/** Computes the final command exit code for a report-bearing command. */
export function reportExitCode(
  report:
    | SyncLike
    | BuildLike
    | { reports: Array<SyncLike | BuildLike>; failureCount: number },
): number {
  return exitCodeForReport(report as never);
}

type SyncLike = SyncBatchEntry;
type BuildLike = BuildBatchEntry;

interface SyncBatchEntry {
  repoId: string;
  status: string;
  sourceChanged: boolean;
  corpusAffected: boolean;
  changedPathCount: number;
  relevantDocPathCount: number;
}

interface BuildBatchEntry {
  repoId: string;
  strategy: string;
  docsRebuilt: number;
  docsDeleted: number;
  diagnostics: Array<{
    severity: string;
    stage?: string | undefined;
    message?: string | undefined;
    code?: string | undefined;
    path?: string | undefined;
    details?: Record<string, unknown> | undefined;
    cause?: DiagnosticCause | undefined;
  }>;
}

interface DiagnosticCause {
  name: string;
  message: string;
  code?: string | undefined;
  stack?: string | undefined;
  context?: Record<string, unknown> | undefined;
  cause?: DiagnosticCause | undefined;
}

/** Renders build failures with nested diagnostic details when verbose is enabled. */
export function buildFailureLines(
  report: { reports?: BuildBatchEntry[] } | BuildBatchEntry,
  verbose: boolean,
): string[] {
  const reports: BuildBatchEntry[] = Array.isArray(
    (report as { reports?: BuildBatchEntry[] }).reports,
  )
    ? (report as { reports: BuildBatchEntry[] }).reports
    : [report as BuildBatchEntry];
  const lines = reportLines(report as never);
  if (!verbose) {
    return [
      ...lines,
      "Run again with --verbose --json to see nested cause details.",
    ];
  }
  for (const entry of reports) {
    const errors = entry.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    for (const diagnostic of errors) {
      lines.push(`Diagnostic: ${entry.repoId}`);
      lines.push(`  stage: ${diagnostic.stage ?? "unknown"}`);
      lines.push(`  layer: ${diagnosticLayer(diagnostic.stage)}`);
      if (diagnostic.path !== undefined)
        lines.push(`  path: ${diagnostic.path}`);
      if (diagnostic.code !== undefined)
        lines.push(`  code: ${diagnostic.code}`);
      if (diagnostic.message !== undefined) {
        lines.push(`  message: ${diagnostic.message}`);
      }
      if (diagnostic.cause !== undefined) {
        lines.push("  cause:");
        lines.push(...formatCauseChain(diagnostic.cause, 2));
      }
    }
  }
  return lines;
}

function diagnosticLayer(stage: string | undefined): string {
  switch (stage) {
    case "source":
      return "source/cache";
    case "planning":
      return "topology";
    case "compile":
    case "chunk":
      return "compile";
    case "persistence":
      return "persistence";
    case "build":
      return "build";
    default:
      return "unknown";
  }
}

function formatCauseChain(cause: DiagnosticCause, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}- ${cause.name}: ${cause.message}`];
  if (cause.code !== undefined) lines.push(`${indent}  code: ${cause.code}`);
  const context = cause.context ?? {};
  for (const key of ["operation", "stage", "repoId", "entity"] as const) {
    const value = context[key];
    if (typeof value === "string" || typeof value === "number") {
      lines.push(`${indent}  ${key}: ${value}`);
    }
  }
  if (cause.stack !== undefined) lines.push(`${indent}  stack: ${cause.stack}`);
  if (cause.cause !== undefined) {
    lines.push(...formatCauseChain(cause.cause, depth + 1));
  }
  return lines;
}
