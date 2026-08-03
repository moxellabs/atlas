import { Command, CommanderError } from "commander";
import { CliConsole } from "../io/console";
import type {
  CliCommandContext,
  CliCommandOptions,
  CliCommandResult,
} from "../runtime/types";
import type {
  CommandDescriptor,
  CommandGroupDescriptor,
  CommandManifestEntry,
  OptionSpec,
  Runner,
  Runtime,
} from "./contracts";

export function registerCommandManifest(
  program: Command,
  runtime: Runtime,
  manifest: readonly CommandManifestEntry[],
): Command {
  for (const entry of manifest) {
    if ("commands" in entry) {
      if (entry.visible?.(runtime) !== false)
        addCommandGroup(program, runtime, entry);
    } else {
      addCommand(program, runtime, entry);
    }
  }
  return program;
}

export function configureCommandIo(
  command: Command,
  runtime: Runtime,
): Command {
  command.on("option:json", () => {
    runtime.output.json = true;
  });
  command.on("option:verbose", () => {
    runtime.output.verbose = true;
  });
  command.on("option:quiet", () => {
    runtime.output.quiet = true;
  });
  return command.exitOverride().configureOutput({
    writeOut: (str) => runtime.stdout.write(str),
    writeErr: (str) => runtime.stderr.write(str),
    outputError: () => undefined,
  });
}

export function collectCommandPositionals(
  values: readonly unknown[],
  commandArgs: readonly string[],
): string[] {
  const actionPositionals = values.filter(
    (value): value is string => typeof value === "string",
  );
  const duplicatePrefix = actionPositionals.every(
    (value, index) => commandArgs[index] === value,
  );
  const excessArgs = duplicatePrefix
    ? commandArgs.slice(actionPositionals.length)
    : [];
  return [...actionPositionals, ...excessArgs];
}

function addCommand(
  program: Command,
  runtime: Runtime,
  descriptor: CommandDescriptor,
): void {
  const command = configureCommandIo(new Command(descriptor.name), runtime)
    .description(descriptor.description)
    .allowExcessArguments();
  if (descriptor.usage !== undefined) command.usage(descriptor.usage);
  installCommandArguments(command, descriptor.args);
  addCommandOptions(command, descriptor.options, runtime);
  command.action(async (...values: unknown[]) =>
    emitCommandResult(command, runtime, values, descriptor.runner),
  );
  program.addCommand(command, { hidden: descriptor.hidden === true });
}

function addCommandGroup(
  program: Command,
  runtime: Runtime,
  descriptor: CommandGroupDescriptor,
): void {
  const group = configureCommandIo(
    new Command(descriptor.name),
    runtime,
  ).description(descriptor.description);
  if (descriptor.usage !== undefined) group.usage(descriptor.usage);
  if (descriptor.allowExcessArguments) group.allowExcessArguments();
  addCommandOptions(group, descriptor.options, runtime);
  if (descriptor.showHelpOnEmpty) group.action(() => group.outputHelp());
  else if (descriptor.runner) {
    group.action(async (...values: unknown[]) =>
      emitCommandResult(group, runtime, values, descriptor.runner as Runner),
    );
  }
  for (const command of descriptor.commands)
    addSubcommand(group, runtime, command);
  program.addCommand(group);
}

function addSubcommand(
  parent: Command,
  runtime: Runtime,
  descriptor: CommandDescriptor,
): void {
  const command = configureCommandIo(new Command(descriptor.name), runtime)
    .description(descriptor.description)
    .allowExcessArguments();
  installCommandArguments(command, descriptor.args);
  addCommandOptions(command, descriptor.options, runtime);
  command.action(async (...values: unknown[]) =>
    emitCommandResult(
      command,
      runtime,
      [descriptor.name, ...values],
      descriptor.runner,
    ),
  );
  parent.addCommand(command);
}

function installCommandArguments(
  command: Command,
  args: readonly string[],
): void {
  for (const arg of args) command.argument(arg);
}

export function addCommandOptions(
  command: Command,
  options: readonly OptionSpec[],
  runtime: Runtime,
): void {
  for (const option of visibleOptions(options, runtime)) {
    command.option(option.flags, option.description, option.parser as never);
  }
}

function visibleOptions(
  options: readonly OptionSpec[],
  runtime: Runtime,
): readonly OptionSpec[] {
  if (runtime.exposeIdentityOptions !== false) return options;
  return options.filter((option) => !option.flags.includes("--atlas-"));
}

async function emitCommandResult(
  command: Command,
  runtime: Runtime,
  values: readonly unknown[],
  runner: Runner,
): Promise<void> {
  const opts = command.optsWithGlobals<CliCommandOptions>();
  runtime.output.json = Boolean(opts.json);
  runtime.output.verbose = Boolean(opts.verbose);
  runtime.output.quiet = Boolean(opts.quiet);
  const context = buildContext(
    runtime,
    collectCommandPositionals(values, command.args),
    opts,
  );
  const consoleIo = new CliConsole(
    context.output,
    context.stdout,
    context.stderr,
  );
  const result = await runner(context);
  runtime.exitCode = await emitResult(consoleIo, context.output.json, result);
  if (!result.ok) {
    throw new CommanderError(
      result.exitCode,
      "atlas.commandFailed",
      result.error.message,
    );
  }
}

function stringOpt(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstStringOpt(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string");
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

export function buildContext(
  runtime: Runtime,
  positionals: readonly string[],
  opts: CliCommandOptions,
): CliCommandContext {
  const defaults = runtime.mountDefaults ?? {};
  const identityRoot =
    stringOpt(opts.atlasIdentityRoot) ?? defaults.ATLAS_IDENTITY_ROOT;
  const mcpName = stringOpt(opts.atlasMcpName) ?? defaults.ATLAS_MCP_NAME;
  const mcpTitle = stringOpt(opts.atlasMcpTitle) ?? defaults.ATLAS_MCP_TITLE;
  const mcpResourcePrefix = defaults.ATLAS_MCP_RESOURCE_PREFIX;
  const configPath = firstStringOpt(opts.config) ?? defaults.ATLAS_CONFIG;
  return {
    positionals,
    options: opts,
    cwd: stringOpt(opts.cwd) ?? runtime.cwdFallback,
    output: {
      json: Boolean(opts.json),
      verbose: Boolean(opts.verbose),
      quiet: Boolean(opts.quiet),
    },
    identityRoot,
    mcpName,
    mcpTitle,
    mcpResourcePrefix,
    stdin: runtime.stdin,
    stdout: runtime.stdout,
    stderr: runtime.stderr,
    env: {
      ...runtime.env,
      ...(defaults.ATLAS_CACHE_DIR === undefined ||
      runtime.env.ATLAS_CACHE_DIR !== undefined
        ? {}
        : { ATLAS_CACHE_DIR: defaults.ATLAS_CACHE_DIR }),
      ...(defaults.ATLAS_LOG_LEVEL === undefined ||
      runtime.env.ATLAS_LOG_LEVEL !== undefined
        ? {}
        : { ATLAS_LOG_LEVEL: defaults.ATLAS_LOG_LEVEL }),
      ...(defaults.ATLAS_CA_CERT_PATH === undefined ||
      runtime.env.ATLAS_CA_CERT_PATH !== undefined
        ? {}
        : { ATLAS_CA_CERT_PATH: defaults.ATLAS_CA_CERT_PATH }),
      ...(configPath === undefined ? {} : { ATLAS_CONFIG: configPath }),
      ...(identityRoot === undefined
        ? {}
        : { ATLAS_IDENTITY_ROOT: identityRoot }),
      ...(mcpName === undefined ? {} : { ATLAS_MCP_NAME: mcpName }),
      ...(mcpTitle === undefined ? {} : { ATLAS_MCP_TITLE: mcpTitle }),
      ...(mcpResourcePrefix === undefined
        ? {}
        : { ATLAS_MCP_RESOURCE_PREFIX: mcpResourcePrefix }),
    },
  };
}

async function emitResult(
  consoleIo: CliConsole,
  json: boolean,
  result: CliCommandResult,
): Promise<number> {
  if (!result.ok && json) await consoleIo.jsonFailure(result);
  return result.ok ? (result.exitCode ?? 0) : result.exitCode;
}
