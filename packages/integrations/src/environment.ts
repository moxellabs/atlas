import { homedir } from "node:os";
import { resolve } from "node:path";
import { ATLAS_VERSION } from "@atlas/core";

import { runIntegrationCommand } from "./runtime";
import type {
  IntegrationCommandRunner,
  IntegrationEnvironment,
  PlanIntegrationInput,
  ServerLaunchSpec,
} from "./types";

export function createIntegrationEnvironment(input: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly runCommand?: IntegrationCommandRunner | undefined;
  readonly now?: (() => Date) | undefined;
}): IntegrationEnvironment {
  const env = input.env ?? process.env;
  return {
    homeDir: env.HOME ?? homedir(),
    workspaceDir: resolve(input.cwd),
    env,
    path: env.PATH,
    platform: input.platform ?? process.platform,
    runCommand: input.runCommand ?? runIntegrationCommand,
    now: input.now,
  };
}

export function defaultAtlasServer(
  mode: PlanIntegrationInput["mode"],
): ServerLaunchSpec {
  return {
    command: "npx",
    args: [
      "--yes",
      `@mrmendez/atlas@${ATLAS_VERSION}`,
      "mcp",
      ...(mode === "prefer-local"
        ? ["--discovery-policy", "prefer-local"]
        : []),
    ],
  };
}
