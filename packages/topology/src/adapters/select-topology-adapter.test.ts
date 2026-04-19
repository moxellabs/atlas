import { describe, expect, test } from "bun:test";
import type { TopologyContext } from "@atlas/core";

import { MixedMonorepoTopologyAdapter } from "./mixed-monorepo.adapter";
import { ModuleLocalDocsTopologyAdapter } from "./module-local-docs.adapter";
import { PackageTopLevelTopologyAdapter } from "./package-top-level.adapter";
import { selectTopologyAdapter } from "./select-topology-adapter";
import { UnsupportedTopologyAdapterError } from "../errors";

const baseContext: TopologyContext = {
  repoId: "atlas",
  rootPath: ".",
  files: [],
  workspace: {
    rootPath: ".",
    packageGlobs: ["packages/*"],
    packageManifestFiles: ["package.json"]
  },
  rules: []
};

describe("selectTopologyAdapter", () => {
  test("selects the first detecting adapter from the provided list", async () => {
    const ctx = {
      ...baseContext,
      files: [{ path: "packages/auth/docs/api.md", type: "file" as const }]
    };

    await expect(
      selectTopologyAdapter(ctx, {
        adapters: [new PackageTopLevelTopologyAdapter(), new MixedMonorepoTopologyAdapter()]
      })
    ).resolves.toBeInstanceOf(PackageTopLevelTopologyAdapter);
  });

  test("selects module-local adapter when narrower adapters are provided", async () => {
    const ctx = {
      ...baseContext,
      files: [{ path: "Auth/docs/overview.md", type: "file" as const }]
    };

    await expect(
      selectTopologyAdapter(ctx, {
        adapters: [new ModuleLocalDocsTopologyAdapter()]
      })
    ).resolves.toBeInstanceOf(ModuleLocalDocsTopologyAdapter);
  });

  test("throws for unsupported empty or non-doc repos", async () => {
    await expect(selectTopologyAdapter(baseContext)).rejects.toThrow(UnsupportedTopologyAdapterError);
  });
});
