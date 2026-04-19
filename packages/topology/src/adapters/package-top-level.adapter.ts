import type { ClassifiedDoc, FileEntry, ModuleNode, PackageNode, RepoTopologyAdapter, SkillNode, TopologyContext } from "@atlas/core";

import { MixedMonorepoTopologyAdapter } from "./mixed-monorepo.adapter";
import { normalizeRepoPath } from "../path-utils";

/** Adapter for repos where docs are top-level or directly under package roots. */
export class PackageTopLevelTopologyAdapter implements RepoTopologyAdapter {
  readonly #mixed = new MixedMonorepoTopologyAdapter();

  /** Detects top-level docs or package-local docs layouts. */
  async detect(ctx: TopologyContext): Promise<boolean> {
    return ctx.files.some((file) => {
      const path = normalizeRepoPath(file.path);
      return file.type === "file" && path.endsWith(".md") && (path.startsWith("docs/") || packageDocsPattern.test(path));
    });
  }

  async discoverPackages(ctx: TopologyContext): Promise<PackageNode[]> {
    return this.#mixed.discoverPackages(ctx);
  }

  async discoverModules(ctx: TopologyContext, packages: PackageNode[]): Promise<ModuleNode[]> {
    return this.#mixed.discoverModules(ctx, packages);
  }

  async classifyDocs(ctx: TopologyContext, files: FileEntry[] = ctx.files): Promise<ClassifiedDoc[]> {
    return this.#mixed.classifyDocs(ctx, files);
  }

  async classifySkills(ctx: TopologyContext, files: FileEntry[] = ctx.files): Promise<SkillNode[]> {
    return this.#mixed.classifySkills(ctx, files);
  }
}

const packageDocsPattern = new RegExp("^packages/[^/]+/docs/");
