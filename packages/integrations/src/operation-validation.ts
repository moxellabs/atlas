import { getAgentIntegration } from "./catalog";
import { fileOperationMatches, readOptional } from "./file-operations";
import { isUnknownRecord } from "./guards";
import { canonicalMutationPath, operationMutationPaths } from "./locks";
import { adapterForScope, planAgentInstall } from "./planning";
import { errorMessage } from "./receipts";
import {
  extractVersion,
  resolveExecutable,
  runIntegrationCommand,
  versionAtLeast,
} from "./runtime";
import type {
  AgentClientId,
  AgentIntegrationReceipt,
  AgentIntegrationScope,
  IntegrationEnvironment,
  IntegrationOperation,
  PlanIntegrationInput,
} from "./types";

export async function assertDistinctScopeTargets(
  input: PlanIntegrationInput,
  environment: IntegrationEnvironment,
  operations: readonly IntegrationOperation[],
): Promise<void> {
  const descriptor = getAgentIntegration(input.clientId);
  const otherScope = input.scope === "user" ? "workspace" : "user";
  if (descriptor[otherScope] === undefined) return;
  const otherPlan = planAgentInstall(
    { ...input, scope: otherScope },
    environment,
  );
  const [currentTargets, otherTargets] = await Promise.all([
    Promise.all(operationMutationPaths(operations).map(canonicalMutationPath)),
    Promise.all(
      operationMutationPaths(otherPlan.operations).map(canonicalMutationPath),
    ),
  ]);
  const otherSet = new Set(otherTargets);
  const conflict = currentTargets.find((target) => otherSet.has(target));
  if (conflict !== undefined)
    throw new Error(
      `${descriptor.displayName} user and workspace scopes resolve to the same configuration target: ${conflict}. Choose distinct home and workspace roots.`,
    );
}

export async function assertNoUnmanagedNativeConfiguration(
  operations: readonly IntegrationOperation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind !== "command") continue;
    const content = await readOptional(operation.verification.path);
    if (content === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(
        `Native client configuration is not valid JSON: ${operation.verification.path}. ${errorMessage(error)}`,
      );
    }
    let cursor: unknown = value;
    for (const key of operation.verification.keyPath) {
      if (!isUnknownRecord(cursor) || !(key in cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[key];
    }
    if (cursor !== undefined)
      throw new Error(
        `Refusing to overwrite unmanaged Atlas configuration at ${operation.verification.keyPath.join(".")} in ${operation.verification.path}.`,
      );
  }
}

export async function assertNativeAdapterReady(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): Promise<void> {
  const descriptor = getAgentIntegration(clientId);
  const adapter = adapterForScope(descriptor, scope);
  if (adapter.kind === "manual") return;
  if (
    clientId === "claude" &&
    scope === "user" &&
    environment.env.CLAUDE_CONFIG_DIR !== undefined
  )
    throw new Error(
      "Automatic Claude Code user configuration is unavailable when CLAUDE_CONFIG_DIR is set; use workspace scope or atlas agent print-config.",
    );
  if (descriptor.kind !== "headless" && adapter.kind !== "native") return;
  const executable = descriptor.executable;
  if (executable === undefined) return;
  const executablePath = await resolveExecutable(executable, environment.path);
  if (executablePath === undefined)
    throw new Error(
      `${descriptor.displayName} executable '${executable}' was not found in PATH.`,
    );
  if (descriptor.minimumVersion === undefined) return;
  const result = await (environment.runCommand ?? runIntegrationCommand)(
    [executablePath, "--version"],
    { cwd: environment.workspaceDir, env: environment.env },
  );
  const version = extractVersion(`${result.stdout}\n${result.stderr}`);
  if (
    result.exitCode !== 0 ||
    version === undefined ||
    !versionAtLeast(version, descriptor.minimumVersion)
  )
    throw new Error(
      `${descriptor.displayName} must be at least ${descriptor.minimumVersion}; detected ${version ?? "an unreadable version"}.`,
    );
}

export async function allOperationsMatch(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
): Promise<boolean> {
  const matches = await Promise.all(
    operations.map(async (operation) => {
      if (operation.kind !== "command") return fileOperationMatches(operation);
      if (!(await fileOperationMatches(operation.verification))) return false;
      const result = await (environment.runCommand ?? runIntegrationCommand)(
        operation.check,
        { cwd: environment.workspaceDir, env: environment.env },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      return (
        result.exitCode === 0 &&
        operation.checkOutputIncludes.every((fragment) =>
          output.includes(fragment),
        )
      );
    }),
  );
  return matches.every(Boolean);
}

export function assertReceiptMatchesPlan(
  receipt: AgentIntegrationReceipt,
  environment: IntegrationEnvironment,
  expectedClientId: AgentClientId,
  expectedScope: AgentIntegrationScope,
): void {
  if (
    receipt.clientId !== expectedClientId ||
    receipt.scope !== expectedScope
  ) {
    throw new Error(
      `Atlas integration receipt target does not match ${expectedClientId} at ${expectedScope} scope.`,
    );
  }
  const expected = planAgentInstall(
    {
      clientId: receipt.clientId,
      scope: receipt.scope,
      mode: receipt.mode,
      server: receipt.server,
    },
    environment,
  );
  if (
    expected.fingerprint !== receipt.fingerprint ||
    JSON.stringify(expected.operations) !== JSON.stringify(receipt.operations)
  )
    throw new Error(
      `Atlas integration receipt failed its integrity check for ${receipt.clientId} at ${receipt.scope} scope.`,
    );
}
