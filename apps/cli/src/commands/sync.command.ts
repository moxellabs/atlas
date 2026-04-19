import type { SyncBatchReport, SyncReport } from "@atlas/indexer";

import { loadDependenciesFromGlobal, readArgvString, renderSuccess, reportExitCode, reportLines } from "./shared";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { EXIT_FAILURE, EXIT_PARTIAL_FAILURE } from "../utils/errors";

/** Delegates sync orchestration to the shared indexer service. */
export async function runSyncCommand(context: CliCommandContext): Promise<CliCommandResult> {
  const deps = await loadDependenciesFromGlobal(context, readArgvString(context.argv, "--config"));
  try {
    const repoId = readArgvString(context.argv, "--repo");
    const check = context.argv.includes("--check");
    const report = repoId ? await deps.indexer.syncRepo(repoId) : await deps.indexer.syncAll({ all: true });
    return await renderSuccess(context, "sync", report, reportLines(report), check ? syncCheckExitCode(report) : reportExitCode(report));
  } finally {
    deps.close();
  }
}

function syncCheckExitCode(report: SyncReport | SyncBatchReport): number {
  if ("reports" in report && Array.isArray(report.reports)) {
    if (report.failureCount > 0) {
      return EXIT_PARTIAL_FAILURE;
    }
    return report.reports.some((entry) => entry.corpusAffected) ? EXIT_PARTIAL_FAILURE : 0;
  }
  const syncReport = report as SyncReport;
  if (syncReport.status === "failed") {
    return EXIT_FAILURE;
  }
  return syncReport.corpusAffected ? EXIT_FAILURE : 0;
}
