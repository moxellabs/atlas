import { afterEach } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATLAS_VERSION } from "@atlas/core";

import {
  createIntegrationEnvironment,
  type IntegrationCommandRunner,
} from "./index";

const roots: string[] = [];

export const ATLAS_NPX_PACKAGE = `@mrmendez/atlas@${ATLAS_VERSION}`;

export function installIntegrationTestCleanup(): void {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });
}

export async function writeClaudeConfig(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        mcpServers: {
          atlas: {
            command: "npx",
            args: ["--yes", ATLAS_NPX_PACKAGE, "mcp"],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

export async function createFixture(
  runCommand?: IntegrationCommandRunner,
  executables: readonly string[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), "atlas-integrations-test-"));
  roots.push(root);
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const bin = join(root, "bin");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  for (const executable of executables) {
    const path = join(bin, executable);
    await writeFile(path, "#!/bin/sh\nexit 0\n");
    await chmod(path, 0o755);
  }
  return {
    root,
    home,
    workspace,
    environment: createIntegrationEnvironment({
      cwd: workspace,
      env: { HOME: home, PATH: bin },
      runCommand,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
    }),
  };
}
