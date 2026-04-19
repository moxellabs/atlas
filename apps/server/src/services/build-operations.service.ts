import type { BuildBatchReport, BuildReport, BuildSelection, IndexerService, SyncBatchReport, SyncReport } from "@atlas/indexer";

import { ServerValidationError } from "../errors";

/** Thin server adapter over the shared indexer sync/build service. */
export class BuildOperationsService {
  constructor(private readonly indexer: IndexerService) {}

  /** Executes sync for one repo or all repos based on the request payload. */
  async sync(input: SyncOperationInput): Promise<SyncReport | SyncBatchReport> {
    if (input.repoId) {
      return this.indexer.syncRepo(input.repoId);
    }
    return this.indexer.syncAll({ all: true });
  }

  /** Executes build for one repo or all repos based on the request payload. */
  async build(input: BuildOperationInput): Promise<BuildReport | BuildBatchReport> {
    const selection = compactSelection(input);
    const force = input.force === true || input.mode === "full";
    if (input.repoId) {
      return this.indexer.buildRepo(input.repoId, {
        force,
        ...(selection === undefined ? {} : { selection })
      });
    }
    if (selection !== undefined) {
      throw new ServerValidationError("Targeted build selectors require repoId.", {
        operation: "build",
        entity: "selection",
        details: input
      });
    }
    return this.indexer.buildAll({ all: true, force });
  }
}

export interface SyncOperationInput {
  repoId?: string | undefined;
  mode?: "incremental" | "full" | undefined;
  dryRun?: boolean | undefined;
}

export interface BuildOperationInput {
  repoId?: string | undefined;
  mode?: "incremental" | "full" | undefined;
  force?: boolean | undefined;
  docIds?: string[] | undefined;
  packageId?: string | undefined;
  moduleId?: string | undefined;
}

function compactSelection(input: BuildOperationInput): BuildSelection | undefined {
  const selection = {
    ...(input.docIds === undefined ? {} : { docIds: input.docIds }),
    ...(input.packageId === undefined ? {} : { packageId: input.packageId }),
    ...(input.moduleId === undefined ? {} : { moduleId: input.moduleId })
  };
  const modeCount = [selection.docIds && selection.docIds.length > 0, selection.packageId !== undefined, selection.moduleId !== undefined].filter(Boolean)
    .length;
  if (modeCount === 0) {
    return undefined;
  }
  if (modeCount > 1) {
    throw new ServerValidationError("Build request must use only one of docIds, packageId, or moduleId.", {
      operation: "build",
      entity: "selection",
      details: input
    });
  }
  return selection;
}
