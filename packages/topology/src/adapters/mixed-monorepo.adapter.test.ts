import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FileEntry, TopologyContext, TopologyRule } from "@atlas/core";
import { createDocId, createModuleId, createPackageId, createSkillId } from "@atlas/core";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MixedMonorepoTopologyAdapter } from "./mixed-monorepo.adapter";
import { ModuleLocalDocsTopologyAdapter } from "./module-local-docs.adapter";
import { PackageTopLevelTopologyAdapter } from "./package-top-level.adapter";
import { classifyDoc } from "../classifiers/classify-doc";
import { ImpossibleOwnershipResolutionError } from "../errors";

const files: FileEntry[] = [
  { path: "docs/index.md", type: "file" },
  { path: "docs/archive/old-spec.md", type: "file" },
  { path: "packages/auth/package.json", type: "file" },
  { path: "packages/auth/docs/api.md", type: "file" },
  { path: "Auth/docs/overview.md", type: "file" },
  { path: "Auth/docs/auth-skill/skill.md", type: "file" }
];

const rules: TopologyRule[] = [
  {
    id: "repo-docs",
    kind: "repo-doc",
    match: { include: ["docs/**/*.md"], exclude: ["docs/archive/**/*.md"] },
    ownership: { attachTo: "repo" },
    authority: "canonical",
    priority: 10
  },
  {
    id: "package-docs",
    kind: "package-doc",
    match: { include: ["packages/*/docs/**/*.md"] },
    ownership: { attachTo: "package" },
    authority: "preferred",
    priority: 20
  },
  {
    id: "module-docs",
    kind: "module-doc",
    match: { include: ["*/docs/**/*.md"], exclude: ["*/docs/**/{skill,SKILL}.md"] },
    ownership: { attachTo: "module", moduleRootPattern: "*/docs/**/*.md" },
    authority: "preferred",
    priority: 30
  },
  {
    id: "skills",
    kind: "skill-doc",
    match: { include: ["**/{skill,SKILL}.md"] },
    ownership: { attachTo: "skill", skillPattern: "**/{skill,SKILL}.md" },
    authority: "canonical",
    priority: 40
  }
];

describe("MixedMonorepoTopologyAdapter", () => {
  let rootPath: string;
  let ctx: TopologyContext;

  beforeEach(async () => {
    rootPath = await Bun.$`mktemp -d ${join(tmpdir(), "atlas-topology-mixed-XXXXXX")}`.text();
    rootPath = rootPath.trim();
    await mkdir(join(rootPath, "packages", "auth"), { recursive: true });
    await writeFile(join(rootPath, "packages", "auth", "package.json"), JSON.stringify({ name: "@atlas/auth" }));
    ctx = {
      repoId: "atlas",
      rootPath,
      files,
      workspace: {
        rootPath,
        packageGlobs: ["packages/*"],
        packageManifestFiles: ["package.json"]
      },
      rules
    };
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  test("discovers packages, modules, docs, skills, and diagnostics deterministically", async () => {
    const adapter = new MixedMonorepoTopologyAdapter();
    const packages = await adapter.discoverPackages(ctx);
    const modules = await adapter.discoverModules(ctx, packages);
    const docs = await adapter.classifyDocs(ctx);
    const skills = await adapter.classifySkills(ctx);
    const packageId = createPackageId({ repoId: "atlas", path: "packages/auth" });
    const moduleId = createModuleId({ repoId: "atlas", path: "Auth" });
    const skillId = createSkillId({ repoId: "atlas", moduleId, path: "Auth/docs/auth-skill" });

    expect(packages).toEqual([
      {
        packageId,
        repoId: "atlas",
        name: "@atlas/auth",
        path: "packages/auth",
        manifestPath: "packages/auth/package.json"
      }
    ]);
    expect(modules).toEqual([{ moduleId, repoId: "atlas", name: "Auth", path: "Auth" }]);
    expect(docs).toEqual([
      expect.objectContaining({
        docId: createDocId({ repoId: "atlas", path: "Auth/docs/auth-skill/skill.md" }),
        kind: "skill-doc",
        skillId,
        scopes: [{ level: "skill", repoId: "atlas", moduleId, skillId }]
      }),
      expect.objectContaining({
        docId: createDocId({ repoId: "atlas", path: "Auth/docs/overview.md" }),
        kind: "module-doc",
        moduleId,
        scopes: [{ level: "module", repoId: "atlas", moduleId }]
      }),
      expect.objectContaining({
        docId: createDocId({ repoId: "atlas", path: "docs/index.md" }),
        kind: "repo-doc",
        scopes: [{ level: "repo", repoId: "atlas" }]
      }),
      expect.objectContaining({
        docId: createDocId({ repoId: "atlas", path: "packages/auth/docs/api.md" }),
        kind: "package-doc",
        packageId,
        scopes: [{ level: "package", repoId: "atlas", packageId }]
      })
    ]);
    expect(docs.some((doc) => doc.path.startsWith("docs/archive/"))).toBe(false);
    expect(docs.every((doc) => doc.diagnostics.length > 0)).toBe(true);
    expect(skills).toEqual([
      expect.objectContaining({
        skillId,
        repoId: "atlas",
        moduleId,
        path: "Auth/docs/auth-skill/skill.md",
        title: "Auth Skill",
        sourceDocPath: "Auth/docs/auth-skill/skill.md"
      })
    ]);
  });

  test("detects specialized layout adapters", async () => {
    await expect(new MixedMonorepoTopologyAdapter().detect(ctx)).resolves.toBe(true);
    await expect(new PackageTopLevelTopologyAdapter().detect(ctx)).resolves.toBe(true);
    await expect(new ModuleLocalDocsTopologyAdapter().detect(ctx)).resolves.toBe(true);
  });

  test("classifies top-level docs with fallback diagnostics when rules are empty", async () => {
    const docs = await new MixedMonorepoTopologyAdapter().classifyDocs({ ...ctx, rules: [] }, [
      { path: "docs/fallback.md", type: "file" }
    ]);

    expect(docs).toEqual([
      expect.objectContaining({
        kind: "repo-doc",
        authority: "supplemental",
        scopes: [{ level: "repo", repoId: "atlas" }],
        diagnostics: [expect.objectContaining({ reason: "Fallback structural documentation heuristic was used." })]
      })
    ]);
  });

  test("does not classify archived root docs through fallback heuristics", async () => {
    const docs = await new MixedMonorepoTopologyAdapter().classifyDocs({ ...ctx, rules: [] }, [
      { path: "docs/archive/old-spec.md", type: "file" }
    ]);

    expect(docs).toEqual([]);
  });

  test("classifies skill files outside package and module roots with repo ownership", async () => {
    const docs = await new MixedMonorepoTopologyAdapter().classifyDocs(ctx, [
      { path: "skills/lone/SKILL.md", type: "file" }
    ]);
    const skills = await new MixedMonorepoTopologyAdapter().classifySkills(ctx, [
      { path: "skills/lone/SKILL.md", type: "file" }
    ]);

    expect(docs[0]?.scopes[0]).toMatchObject({ level: "skill", repoId: "atlas" });
    expect(skills[0]).toMatchObject({
      repoId: "atlas",
      path: "skills/lone/SKILL.md",
      title: "Lone"
    });
    expect(skills[0]?.skillId).toBe(createSkillId({ repoId: "atlas", path: "skills/lone" }));
  });

  test("throws for impossible explicit skill ownership on non-skill module docs", async () => {
    const moduleId = createModuleId({ repoId: "atlas", path: "Auth" });

    expect(() =>
      classifyDoc({
        repoId: "atlas",
        path: "Auth/docs/overview.md",
        rules: [
          {
            id: "bad-skill",
            kind: "skill-doc",
            match: { include: ["Auth/docs/**/*.md"] },
            ownership: { attachTo: "skill" },
            authority: "canonical",
            priority: 100
          }
        ],
        packages: [],
        modules: [{ moduleId, repoId: "atlas", name: "Auth", path: "Auth" }]
      })
    ).toThrow(ImpossibleOwnershipResolutionError);
  });
});
