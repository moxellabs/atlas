import type { RepoTopologyAdapter, TopologyContext } from "@atlas/core";

import { MixedMonorepoTopologyAdapter } from "./mixed-monorepo.adapter";
import { ModuleLocalDocsTopologyAdapter } from "./module-local-docs.adapter";
import { PackageTopLevelTopologyAdapter } from "./package-top-level.adapter";
import { UnsupportedTopologyAdapterError } from "../errors";

/** Options for topology adapter selection. */
export interface SelectTopologyAdapterOptions {
  /** Candidate adapters in selection order. */
  adapters?: readonly RepoTopologyAdapter[] | undefined;
}

/** Selects the first adapter that detects support for the repo context. */
export async function selectTopologyAdapter(
  ctx: TopologyContext,
  options: SelectTopologyAdapterOptions = {}
): Promise<RepoTopologyAdapter> {
  const adapters =
    options.adapters ?? [new MixedMonorepoTopologyAdapter(), new PackageTopLevelTopologyAdapter(), new ModuleLocalDocsTopologyAdapter()];

  for (const adapter of adapters) {
    if (await adapter.detect(ctx)) {
      return adapter;
    }
  }

  throw new UnsupportedTopologyAdapterError({
    repoId: ctx.repoId,
    fileCount: ctx.files.length
  });
}
