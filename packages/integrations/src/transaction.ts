import { rm } from "node:fs/promises";

import {
  applyPreparedFiles,
  prepareFileOperations,
  prepareRemovalOperations,
  type FileBackup,
  type PreparedFileChange,
  restoreFiles,
  writeAtomic,
} from "./file-operations";
import { withIntegrationLocks, withStableIntegrationLocks } from "./locks";
import {
  executeCommands,
  recoverTransaction,
  rollbackCommands,
} from "./operation-execution";
import {
  allOperationsMatch,
  assertDistinctScopeTargets,
  assertNativeAdapterReady,
  assertNoUnmanagedNativeConfiguration,
  assertReceiptMatchesPlan,
} from "./operation-validation";
import {
  planAgentInstall,
  planAgentRemoval as createRemovalPlan,
} from "./planning";
import { integrationReceiptPath, readReceipt } from "./receipts";
import type {
  AgentClientId,
  AgentIntegrationPlan,
  AgentIntegrationReceipt,
  AgentIntegrationScope,
  ApplyIntegrationResult,
  CommandOperation,
  IntegrationEnvironment,
  PlanIntegrationInput,
} from "./types";

export interface ApplyOptions {
  readonly dryRun?: boolean | undefined;
}

export async function planAgentRemoval(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): Promise<AgentIntegrationPlan> {
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
  const receipt = await readReceipt(receiptPath);
  if (receipt !== undefined)
    assertReceiptMatchesPlan(receipt, environment, clientId, scope);
  return createRemovalPlan(clientId, scope, environment, receipt);
}

export async function installAgentIntegration(
  input: PlanIntegrationInput,
  environment: IntegrationEnvironment,
  options: ApplyOptions = {},
): Promise<ApplyIntegrationResult> {
  const plan = planAgentInstall(input, environment);
  if (plan.requiresManualAction) return { changed: false, plan };
  await assertDistinctScopeTargets(input, environment, plan.operations);
  if ((await readReceipt(plan.receiptPath)) === undefined)
    await assertNoUnmanagedNativeConfiguration(plan.operations);
  if (options.dryRun === true) return { changed: false, plan };
  return withIntegrationLocks(
    plan.receiptPath,
    plan.operations,
    environment,
    () => installAgentIntegrationLocked(input, environment),
  );
}

async function installAgentIntegrationLocked(
  input: PlanIntegrationInput,
  environment: IntegrationEnvironment,
): Promise<ApplyIntegrationResult> {
  const plan = planAgentInstall(input, environment);
  await assertNativeAdapterReady(input.clientId, input.scope, environment);
  const existing = await readReceipt(plan.receiptPath);
  if (existing !== undefined) {
    assertReceiptMatchesPlan(
      existing,
      environment,
      input.clientId,
      input.scope,
    );
    if (!(await allOperationsMatch(existing.operations, environment)))
      throw new Error(
        `${plan.displayName} configuration has drifted from the Atlas-managed receipt; run atlas agent doctor ${input.clientId} --scope ${input.scope}.`,
      );
    if (existing.fingerprint === plan.fingerprint)
      return { changed: false, plan, receipt: existing };
  }
  if (existing === undefined)
    await assertNoUnmanagedNativeConfiguration(plan.operations);

  const removedFiles =
    existing === undefined
      ? new Map<string, PreparedFileChange>()
      : await prepareRemovalOperations(existing.operations);
  const fileChanges = await prepareFileOperations(
    plan.operations,
    removedFiles,
  );
  const completedRemovedCommands: CommandOperation[] = [];
  const completedCommands: CommandOperation[] = [];
  let backups: readonly FileBackup[] = [];
  try {
    if (existing !== undefined)
      await executeCommands(
        existing.operations,
        environment,
        "inverse",
        completedRemovedCommands,
      );
    await executeCommands(
      plan.operations,
      environment,
      "forward",
      completedCommands,
    );
    backups = await applyPreparedFiles(fileChanges);
    const receipt: AgentIntegrationReceipt = {
      schemaVersion: 1,
      clientId: input.clientId,
      scope: input.scope,
      mode: input.mode,
      installedAt: (environment.now?.() ?? new Date()).toISOString(),
      fingerprint: plan.fingerprint,
      server: plan.server,
      operations: plan.operations,
    };
    if (!(await allOperationsMatch(plan.operations, environment)))
      throw new Error(
        `${plan.displayName} did not produce the expected Atlas MCP configuration.`,
      );
    await writeAtomic(
      plan.receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    return { changed: true, plan, receipt };
  } catch (error) {
    return recoverTransaction(
      error,
      () => restoreFiles(backups),
      async () => [
        ...(await rollbackCommands(completedCommands, environment, "forward")),
        ...(await rollbackCommands(
          completedRemovedCommands,
          environment,
          "inverse",
        )),
      ],
      "Atlas integration install or update failed and rollback was incomplete.",
    );
  }
}

export async function removeAgentIntegration(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
  options: ApplyOptions = {},
): Promise<ApplyIntegrationResult> {
  if (options.dryRun === true)
    return removeAgentIntegrationLocked(clientId, scope, environment, options);
  return withStableIntegrationLocks(
    () => planAgentRemoval(clientId, scope, environment),
    environment,
    () => removeAgentIntegrationLocked(clientId, scope, environment),
  );
}

async function removeAgentIntegrationLocked(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
  options: ApplyOptions = {},
): Promise<ApplyIntegrationResult> {
  const plan = await planAgentRemoval(clientId, scope, environment);
  const receipt = await readReceipt(plan.receiptPath);
  if (receipt === undefined) return { changed: false, plan };
  assertReceiptMatchesPlan(receipt, environment, clientId, scope);
  if (!(await allOperationsMatch(receipt.operations, environment)))
    throw new Error(
      `${plan.displayName} configuration has drifted from the Atlas-managed receipt; run atlas agent doctor ${clientId} --scope ${scope}.`,
    );
  if (options.dryRun === true) return { changed: false, plan, receipt };

  const fileChanges = await prepareRemovalOperations(receipt.operations);
  const completedInverseCommands: CommandOperation[] = [];
  let backups: readonly FileBackup[] = [];
  try {
    await executeCommands(
      receipt.operations,
      environment,
      "inverse",
      completedInverseCommands,
    );
    backups = await applyPreparedFiles(fileChanges);
    await rm(plan.receiptPath, { force: true });
    return { changed: true, plan, receipt };
  } catch (error) {
    return recoverTransaction(
      error,
      () => restoreFiles(backups),
      () => rollbackCommands(completedInverseCommands, environment, "inverse"),
      "Atlas integration removal failed and rollback was incomplete.",
    );
  }
}
