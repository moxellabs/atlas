import { Command } from "commander";
import packageJson from "../../../../package.json" with { type: "json" };
import {
  addCommandOptions,
  configureCommandIo,
  registerCommandManifest,
} from "./adapter";
import type { AtlasProgramOptions, Runtime } from "./contracts";
import { createAtlasCommandManifest } from "./manifest";
import { globalOptions } from "./options";

export { buildContext } from "./adapter";

export function createAtlasProgram(
  runtime: Runtime,
  options: AtlasProgramOptions = {},
): Command {
  const identityName = options.identityName ?? "Atlas";
  const commandName = options.commandName ?? options.name ?? "atlas";
  const program = createAtlasBaseCommand(runtime, {
    name: options.name ?? "atlas",
    commandName,
    identityName,
    description:
      options.description ??
      "Local-first documentation ingestion, retrieval, and MCP/server access for multi-repo engineering docs.",
    helpPrefix:
      options.helpPrefix ??
      "atlas <command>\nRuntime defaults: ~/.moxel/atlas\n",
    helpQuickPath: options.helpQuickPath ?? defaultHelpQuickPath(commandName),
    exposeIdentityOptions: options.exposeIdentityOptions ?? true,
    mountDefaults: options.mountDefaults,
  });
  return registerAtlasCommands(program, runtime, { identityName });
}

export function registerAtlasCommands(
  program: Command,
  runtime: Runtime,
  identity: { identityName: string } = { identityName: "Atlas" },
): Command {
  return registerCommandManifest(
    program,
    runtime,
    createAtlasCommandManifest(identity.identityName),
  );
}

export function createAtlasBaseCommand(
  runtime: Runtime,
  options: Required<
    Pick<AtlasProgramOptions, "name" | "description" | "helpPrefix">
  > &
    Required<
      Pick<
        AtlasProgramOptions,
        | "commandName"
        | "identityName"
        | "helpQuickPath"
        | "exposeIdentityOptions"
      >
    > &
    Pick<AtlasProgramOptions, "mountDefaults">,
): Command {
  runtime.mountDefaults = options.mountDefaults;
  runtime.exposeIdentityOptions = options.exposeIdentityOptions;
  const command = configureCommandIo(new Command(), runtime)
    .name(options.name)
    .description(options.description)
    .version(packageJson.version, "-v, --version", "Display version")
    .addHelpText("beforeAll", options.helpPrefix)
    .addHelpText("afterAll", options.helpQuickPath);
  addCommandOptions(command, globalOptions, runtime);
  return command;
}

function defaultHelpQuickPath(commandName: string): string {
  return `
Quick path:
  ${commandName} setup                 one-time local runtime setup
  ${commandName} repo add <repo>       use an existing repo artifact
  ${commandName} init && ${commandName} build   publish/update artifact from a checkout
  ${commandName} index <path>          fallback local-only index, not primary onboarding
  ${commandName} next                  inspect state and recommend the next command

Command groups:
  Start: setup, next
  Use repos: repo add, repo list, repo show, sync
  Build artifacts: init, build, artifact verify, artifact inspect
  Search/query: search, list, serve, mcp
  Diagnose: doctor, repo doctor, inspect, clean, prune
`;
}
