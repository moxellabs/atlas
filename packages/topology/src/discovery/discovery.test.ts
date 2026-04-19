import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FileEntry, TopologyRule } from "@atlas/core";
import { createModuleId, createPackageId } from "@atlas/core";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { discoverModules, discoverModulesWithDiagnostics } from "./discover-modules";
import { discoverPackages, discoverPackagesWithDiagnostics, findPackageManifestPaths } from "./discover-packages";
import { inferModuleScope } from "../rules/infer-module-scope";
import { inferPackageScope } from "../rules/infer-package-scope";

const workspace = {
  packageGlobs: ["packages/*"],
  packageManifestFiles: ["package.json"]
};

const files: FileEntry[] = [
  { path: "packages/auth/package.json", type: "file" },
  { path: "packages/billing/package.json", type: "file" },
  { path: "packages/auth/docs/api.md", type: "file" },
  { path: "Auth/docs/overview.md", type: "file" },
  { path: "Auth/docs/auth-skill/skill.md", type: "file" },
  { path: "docs/index.md", type: "file" }
];

const rules: TopologyRule[] = [
  {
    id: "module-docs",
    kind: "module-doc",
    match: { include: ["*/docs/**/*.md"] },
    ownership: { attachTo: "module", moduleRootPattern: "*/docs/**/*.md" },
    authority: "preferred",
    priority: 20
  }
];

describe("topology discovery", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await Bun.$`mktemp -d ${join(tmpdir(), "atlas-topology-test-XXXXXX")}`.text();
    rootPath = rootPath.trim();
    await mkdir(join(rootPath, "packages", "auth"), { recursive: true });
    await mkdir(join(rootPath, "packages", "billing"), { recursive: true });
    await writeFile(join(rootPath, "packages", "auth", "package.json"), JSON.stringify({ name: "@scope/auth" }));
    await writeFile(join(rootPath, "packages", "billing", "package.json"), JSON.stringify({ name: "@scope/auth" }));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  test("finds package manifests from workspace config", () => {
    expect(findPackageManifestPaths(files, workspace)).toEqual([
      "packages/auth/package.json",
      "packages/billing/package.json"
    ]);
  });

  test("discovers packages with path-derived stable IDs despite duplicate names", async () => {
    await expect(discoverPackages({ repoId: "atlas", rootPath, files, workspace })).resolves.toEqual([
      {
        packageId: createPackageId({ repoId: "atlas", path: "packages/auth" }),
        repoId: "atlas",
        name: "@scope/auth",
        path: "packages/auth",
        manifestPath: "packages/auth/package.json"
      },
      {
        packageId: createPackageId({ repoId: "atlas", path: "packages/billing" }),
        repoId: "atlas",
        name: "@scope/auth",
        path: "packages/billing",
        manifestPath: "packages/billing/package.json"
      }
    ]);
  });

  test("reports package name fallback and duplicate package name diagnostics", async () => {
    await writeFile(join(rootPath, "packages", "billing", "package.json"), "{");

    const result = await discoverPackagesWithDiagnostics({ repoId: "atlas", rootPath, files, workspace });

    expect(result.packages.map((packageNode) => packageNode.name)).toEqual(["@scope/auth", "billing"]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        reason: "Package manifest name unavailable; path-based package name fallback used.",
        confidence: "medium",
        path: "packages/billing/package.json"
      })
    ]);
  });

  test("reports no discovered modules as a low-confidence diagnostic", () => {
    expect(
      discoverModulesWithDiagnostics({
        repoId: "atlas",
        files: [{ path: "docs/index.md", type: "file" }],
        packages: [],
        rules
      }).diagnostics
    ).toEqual([
      {
        reason: "No module roots discovered from module-local docs or topology rule hints.",
        confidence: "low"
      }
    ]);
  });

  test("discovers module-local docs without treating package docs as modules", async () => {
    const packages = await discoverPackages({ repoId: "atlas", rootPath, files, workspace });

    expect(discoverModules({ repoId: "atlas", files, packages, rules })).toEqual([
      {
        moduleId: createModuleId({ repoId: "atlas", path: "Auth" }),
        repoId: "atlas",
        name: "Auth",
        path: "Auth"
      }
    ]);
  });

  test("infers deepest package and module containment", async () => {
    const packages = await discoverPackages({ repoId: "atlas", rootPath, files, workspace });
    const modules = discoverModules({ repoId: "atlas", files, packages, rules });

    expect(inferPackageScope("packages/auth/docs/api.md", packages).packageNode?.path).toBe("packages/auth");
    expect(inferModuleScope("Auth/docs/auth-skill/skill.md", modules).moduleNode?.path).toBe("Auth");
  });
});
