import { runIntegrationCommand } from "./runtime";
import { errorMessage } from "./receipts";
import type {
  CommandOperation,
  IntegrationEnvironment,
  IntegrationOperation,
} from "./types";

export type CommandDirection = "forward" | "inverse";

export async function executeCommands(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  direction: CommandDirection,
  completed: CommandOperation[],
): Promise<void> {
  const ordered =
    direction === "forward" ? operations : [...operations].reverse();
  for (const operation of ordered) {
    if (operation.kind !== "command") continue;
    const command =
      direction === "forward" ? operation.command : operation.inverse;
    await runRequired(command, environment);
    completed.push(operation);
  }
}

export async function rollbackCommands(
  completed: readonly CommandOperation[],
  environment: IntegrationEnvironment,
  direction: CommandDirection,
): Promise<readonly Error[]> {
  const failures: Error[] = [];
  const ordered =
    direction === "forward" ? [...completed].reverse() : completed;
  for (const operation of ordered) {
    const command =
      direction === "forward" ? operation.inverse : operation.command;
    const failure = await runCompensation(command, environment);
    if (failure !== undefined) failures.push(failure);
  }
  return failures;
}

export async function recoverTransaction(
  primaryError: unknown,
  restore: () => Promise<void>,
  rollback: () => Promise<readonly Error[]>,
  aggregateMessage: string,
): Promise<never> {
  const failures: unknown[] = [];
  try {
    await restore();
  } catch (error) {
    failures.push(error);
  }
  try {
    failures.push(...(await rollback()));
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 0) throw primaryError;
  throw new AggregateError([primaryError, ...failures], aggregateMessage);
}

function commandRunOptions(environment: IntegrationEnvironment): {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
} {
  return { cwd: environment.workspaceDir, env: environment.env };
}

async function runRequired(
  command: readonly string[],
  environment: IntegrationEnvironment,
): Promise<void> {
  const result = await (environment.runCommand ?? runIntegrationCommand)(
    command,
    commandRunOptions(environment),
  );
  if (result.exitCode !== 0)
    throw new Error(
      `Integration command '${command[0] ?? "unknown"}' failed with exit ${result.exitCode}.`,
    );
}

async function runCompensation(
  command: readonly string[],
  environment: IntegrationEnvironment,
): Promise<Error | undefined> {
  try {
    const result = await (environment.runCommand ?? runIntegrationCommand)(
      command,
      commandRunOptions(environment),
    );
    return result.exitCode === 0
      ? undefined
      : new Error(
          `Rollback command '${command[0] ?? "unknown"}' failed with exit ${result.exitCode}.`,
        );
  } catch (error) {
    return new Error(
      `Rollback command '${command[0] ?? "unknown"}' failed: ${errorMessage(error)}.`,
    );
  }
}
