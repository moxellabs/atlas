import { Command, CommanderError } from "commander";
import { runInitCommand } from "../commands/init.command";
import { CliConsole } from "../io/console";
import { canPrompt } from "../io/prompts";
import { resolveCliConfigTarget } from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR, toFailureResult } from "../utils/errors";
import { fileExists } from "../utils/node-runtime";
import type { Runtime } from "./contracts";
import { buildContext, createAtlasProgram } from "./factory";

/** Runs Atlas CLI against provided argv tokens. */
export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  streams: Partial<
    Pick<CliCommandContext, "stdin" | "stdout" | "stderr" | "env">
  > = {},
): Promise<number> {
  const runtime = createRuntime(streams);
  const program = createAtlasProgram(runtime);
  try {
    await parseAtlasProgram(runtime, argv, program);
    return runtime.exitCode ?? 0;
  } catch (error) {
    const consoleIo = new CliConsole(
      runtime.output,
      runtime.stdout,
      runtime.stderr,
    );
    return handleCliError({
      program,
      runtime,
      consoleIo,
      output: runtime.output,
      error,
    });
  }
}

function createRuntime(
  streams: Partial<
    Pick<CliCommandContext, "stdin" | "stdout" | "stderr" | "env">
  >,
): Runtime {
  return {
    stdin: streams.stdin ?? process.stdin,
    stdout: streams.stdout ?? process.stdout,
    stderr: streams.stderr ?? process.stderr,
    env: streams.env ?? process.env,
    cwdFallback: process.cwd(),
    output: { json: false, verbose: false, quiet: false },
  };
}

async function parseAtlasProgram(
  runtime: Runtime,
  argv: readonly string[],
  program: Command,
): Promise<void> {
  if (await startFirstRunOnboarding(runtime, argv)) return;
  const normalizedArgv =
    argv.length === 0 || argv[0] === "help" ? ["--help"] : [...argv];
  await program.parseAsync(normalizedArgv, { from: "user" });
}

async function startFirstRunOnboarding(
  runtime: Runtime,
  argv: readonly string[],
): Promise<boolean> {
  if (argv.length !== 0) return false;
  const context = buildContext(runtime, [], {});
  if (!(await shouldStartFirstRunOnboarding(context))) return false;
  const result = await runInitCommand(context, "setup");
  runtime.exitCode = await emitResult(
    new CliConsole(context.output, context.stdout, context.stderr),
    false,
    result,
  );
  return true;
}

/** Returns whether a bare interactive invocation should begin first-run setup. */
export async function shouldStartFirstRunOnboarding(
  context: CliCommandContext,
): Promise<boolean> {
  if (!canPrompt(context)) return false;
  try {
    const configPath = await resolveCliConfigTarget({
      cwd: context.cwd,
      env: context.env,
    });
    return !(await fileExists(configPath));
  } catch {
    return false;
  }
}

async function handleCliError(input: {
  program: Command;
  runtime: Runtime;
  consoleIo: CliConsole;
  output: { json: boolean; verbose: boolean; quiet: boolean };
  error: unknown;
}): Promise<number> {
  if (input.error instanceof CommanderError) {
    return handleCommanderError(
      input as typeof input & { error: CommanderError },
    );
  }
  const failure = toFailureResult(
    commandNameFromProgram(input.program),
    input.error,
    input.output.verbose,
  );
  if (input.output.json) await input.consoleIo.jsonFailure(failure);
  else await input.consoleIo.error(failure.error.message);
  return failure.exitCode;
}

async function handleCommanderError(input: {
  program: Command;
  runtime: Runtime;
  consoleIo: CliConsole;
  output: { json: boolean; verbose: boolean; quiet: boolean };
  error: CommanderError;
}): Promise<number> {
  if (
    input.error.code === "commander.helpDisplayed" ||
    input.error.code === "commander.version"
  )
    return 0;
  const failure = toFailureResult(
    commandNameFromProgram(input.program),
    commanderCliError(input.program, input.error),
    input.output.verbose,
  );
  if (input.output.json) await input.consoleIo.jsonFailure(failure);
  else {
    if (failure.error.code === "CLI_UNKNOWN_COMMAND" && !input.output.quiet) {
      input.program.outputHelp();
    }
    await input.consoleIo.error(failure.error.message);
  }
  return failure.exitCode;
}

function commanderCliError(program: Command, error: CommanderError): CliError {
  const unknownCommand = commandNameFromProgram(program);
  const unknown = error.code === "commander.unknownCommand";
  return new CliError(
    unknown
      ? `Unknown command: ${unknownCommand}.`
      : cleanCommanderMessage(error.message),
    {
      code: unknown ? "CLI_UNKNOWN_COMMAND" : "CLI_INPUT_ERROR",
      exitCode: EXIT_INPUT_ERROR,
    },
  );
}

async function emitResult(
  consoleIo: CliConsole,
  json: boolean,
  result: CliCommandResult,
): Promise<number> {
  if (!result.ok && json) await consoleIo.jsonFailure(result);
  return result.ok ? (result.exitCode ?? 0) : result.exitCode;
}

function commandNameFromProgram(program: Command): string {
  return program.args[0] ?? "help";
}

function cleanCommanderMessage(message: string): string {
  return message.replace(/^error:\s*/i, "");
}
