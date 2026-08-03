import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AtlasEnv } from "../env.schema";

export const validYamlConfig = `
version: 1
cacheDir: .atlas-cache
logLevel: info
server:
  transport: http
  port: 4321
repos:
  - repoId: github.mycorp.com/platform/docs
    mode: local-git
    git:
      remote: ssh://git@ghe.example.com/platform/identity.git
      localPath: repos/identity
      ref: main
    workspace:
      packageGlobs:
        - packages/*
      packageManifestFiles:
        - package.json
    topology:
      - id: repo-docs
        kind: repo-doc
        match:
          include:
            - docs/**/*.md
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`;

export const createIsolatedEnv = (
  values: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({ ...values });

export const emptyEnv: AtlasEnv = {};

export const useLoaderTestWorkspace = (): { readonly fixtureDir: string } => {
  let fixtureDir: string | undefined;

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "atlas-config-test-"));
  });

  afterEach(async () => {
    const activeFixtureDir = fixtureDir;
    fixtureDir = undefined;
    if (activeFixtureDir !== undefined) {
      await rm(activeFixtureDir, { recursive: true, force: true });
    }
  });

  return {
    get fixtureDir(): string {
      if (fixtureDir === undefined) {
        throw new Error("Loader test workspace has not been initialized");
      }
      return fixtureDir;
    },
  };
};
