import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ATLAS_VERSION } from "@atlas/core";

import { AGENT_INTEGRATIONS, getAgentIntegration } from "./catalog";
import {
  applyPreparedFiles,
  fileOperationMatches,
  prepareFileOperations,
  prepareRemovalOperations,
  type PreparedFileChange,
  readOptional,
  restoreFiles,
  writeAtomic,
} from "./file-operations";
import { isUnknownRecord } from "./guards";
import {
  extractVersion,
  resolveExecutable,
  runIntegrationCommand,
  versionAtLeast,
} from "./runtime";
import {
  AGENT_CLIENT_IDS,
  type AgentClientAdapter,
  type AgentClientId,
  type AgentDetectionResult,
  type AgentDoctorResult,
  type AgentIntegrationPlan,
  type AgentIntegrationReceipt,
  type AgentIntegrationMode,
  type AgentIntegrationScope,
  type ApplyIntegrationResult,
  type CommandOperation,
  type IntegrationCommandRunner,
  type IntegrationEnvironment,
  type IntegrationOperation,
  type PlanIntegrationInput,
  type ServerLaunchSpec,
} from "./types";

export interface ApplyOptions {
  readonly dryRun?: boolean | undefined;
}

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

export function listAgentIntegrations() {
  return AGENT_INTEGRATIONS;
}

export function planAgentInstall(
  input: PlanIntegrationInput,
  environment: IntegrationEnvironment,
): AgentIntegrationPlan {
  const descriptor = getAgentIntegration(input.clientId);
  const adapter = adapterForScope(descriptor, input.scope);
  const server = input.server ?? defaultAtlasServer(input.mode);
  const operations = installOperations(
    adapter,
    input.scope,
    input.mode,
    server,
    environment,
  );
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    input.clientId,
    input.scope,
    environment.workspaceDir,
  );
  const notes = [
    ...(descriptor.notes ?? []),
    ...(input.mode === "prefer-local"
      ? [
          "Prefer-local is policy-assisted mode: Atlas is consulted first only for matching covered questions, with fallback for partial, absent, or stale coverage.",
        ]
      : []),
  ];
  const unsigned = {
    action: "install" as const,
    clientId: input.clientId,
    displayName: descriptor.displayName,
    scope: input.scope,
    mode: input.mode,
    server,
    operations,
    receiptPath,
    requiresManualAction: operations.some(
      (operation) => operation.kind === "manual",
    ),
    notes,
  };
  return {
    ...unsigned,
    fingerprint: integrationFingerprint(
      input.clientId,
      input.scope,
      input.mode,
      server,
      operations,
    ),
  };
}

export async function planAgentRemoval(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): Promise<AgentIntegrationPlan> {
  const descriptor = getAgentIntegration(clientId);
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
  const receipt = await readReceipt(receiptPath);
  if (receipt !== undefined)
    assertReceiptMatchesPlan(receipt, environment, clientId, scope);
  const server =
    receipt?.server ?? defaultAtlasServer(receipt?.mode ?? "standard");
  const unsigned = {
    action: "remove" as const,
    clientId,
    displayName: descriptor.displayName,
    scope,
    mode: receipt?.mode ?? ("standard" as const),
    server,
    operations: receipt?.operations ?? [],
    receiptPath,
    requiresManualAction: false,
    notes:
      receipt === undefined
        ? (["No Atlas-managed integration receipt exists."] as const)
        : ([] as const),
  };
  return {
    ...unsigned,
    fingerprint: integrationFingerprint(
      clientId,
      scope,
      receipt?.mode ?? "standard",
      server,
      receipt?.operations ?? [],
    ),
  };
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
  let backups: Awaited<ReturnType<typeof applyPreparedFiles>> = [];
  try {
    if (existing !== undefined)
      await applyInverseCommands(
        existing.operations,
        environment,
        completedRemovedCommands,
      );
    await applyCommands(plan.operations, environment, completedCommands);
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
        ...(await rollbackCommands(completedCommands, environment)),
        ...(await rollbackInverseCommands(
          completedRemovedCommands,
          environment,
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
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
  return withIntegrationLocks(receiptPath, [], environment, async () => {
    const plan = await planAgentRemoval(clientId, scope, environment);
    return withOperationLocks(plan.operations, environment, () =>
      removeAgentIntegrationLocked(clientId, scope, environment),
    );
  });
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
  let backups: Awaited<ReturnType<typeof applyPreparedFiles>> = [];
  try {
    await applyInverseCommands(
      receipt.operations,
      environment,
      completedInverseCommands,
    );
    backups = await applyPreparedFiles(fileChanges);
    await rm(plan.receiptPath, { force: true });
    return { changed: true, plan, receipt };
  } catch (error) {
    return recoverTransaction(
      error,
      () => restoreFiles(backups),
      () => rollbackInverseCommands(completedInverseCommands, environment),
      "Atlas integration removal failed and rollback was incomplete.",
    );
  }
}

export async function detectAgentIntegrations(
  environment: IntegrationEnvironment,
): Promise<readonly AgentDetectionResult[]> {
  return Promise.all(
    AGENT_INTEGRATIONS.map(async (descriptor) => {
      const executablePath =
        descriptor.executable === undefined
          ? undefined
          : await resolveExecutable(descriptor.executable, environment.path);
      const configuredScopes = await configuredScopesFor(
        descriptor.id,
        environment,
      );
      let version: string | undefined;
      let versionProbeError: string | undefined;
      if (executablePath !== undefined) {
        try {
          const result = await (
            environment.runCommand ?? runIntegrationCommand
          )([executablePath, "--version"], commandRunOptions(environment));
          if (result.exitCode === 0) {
            version = extractVersion(`${result.stdout}\n${result.stderr}`);
            if (version === undefined)
              versionProbeError = "Version probe returned no semantic version.";
          } else {
            versionProbeError = `Version probe exited with code ${result.exitCode}.`;
          }
        } catch (error) {
          versionProbeError = `Version probe failed: ${errorMessage(error)}.`;
        }
      }
      return {
        clientId: descriptor.id,
        displayName: descriptor.displayName,
        installed: executablePath !== undefined || configuredScopes.length > 0,
        ...(executablePath === undefined ? {} : { executablePath }),
        ...(version === undefined ? {} : { version }),
        ...(descriptor.minimumVersion === undefined
          ? {}
          : {
              versionSupported:
                versionProbeError === undefined &&
                version !== undefined &&
                versionAtLeast(version, descriptor.minimumVersion),
            }),
        ...(versionProbeError === undefined ? {} : { versionProbeError }),
        configuredScopes,
      };
    }),
  );
}

export async function doctorAgentIntegration(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): Promise<AgentDoctorResult> {
  const detections = await detectAgentIntegrations(environment);
  const detection = detections.find((item) => item.clientId === clientId);
  if (detection === undefined)
    throw new Error(`Detection result missing for ${clientId}.`);
  const descriptor = getAgentIntegration(clientId);
  if (descriptor[scope] === undefined) {
    const supported = (["user", "workspace"] as const)
      .filter((candidate) => descriptor[candidate] !== undefined)
      .join(", ");
    return {
      detection,
      scope,
      healthy: false,
      receiptPresent: false,
      issues: [
        `${descriptor.displayName} does not support ${scope}-scope MCP configuration.`,
      ],
      nextActions: [`Use a supported scope: ${supported}.`],
    };
  }
  const issues: string[] = [];
  const nextActions: string[] = [];
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
  const lockPath = integrationLockPath(
    environment.homeDir,
    await canonicalMutationPath(receiptPath),
  );
  if ((await readOptional(lockPath)) !== undefined) {
    issues.push(`An integration transaction lock is present at ${lockPath}.`);
    nextActions.push(
      "Verify the recorded owner process is no longer running before removing the lock.",
    );
  }
  const receipt = await readReceipt(receiptPath);
  let receiptValid = false;
  if (receipt !== undefined) {
    try {
      assertReceiptMatchesPlan(receipt, environment, clientId, scope);
      receiptValid = true;
    } catch (error) {
      issues.push(errorMessage(error));
      nextActions.push(
        `Remove the invalid receipt at ${receiptPath} and reinstall Atlas.`,
      );
    }
  }
  if (
    receiptValid &&
    !(await allOperationsMatch(receipt?.operations ?? [], environment))
  ) {
    issues.push(
      `${detection.displayName} configuration has drifted from the Atlas-managed receipt.`,
    );
    nextActions.push(
      `Remove and reinstall the ${scope}-scope Atlas integration.`,
    );
  }
  if (!detection.installed) {
    issues.push(`${detection.displayName} was not detected.`);
    nextActions.push(`Install ${detection.displayName}, then rerun doctor.`);
  }
  if (detection.versionSupported === false) {
    const minimum = getAgentIntegration(clientId).minimumVersion;
    issues.push(
      detection.versionProbeError ??
        `${detection.displayName} ${detection.version ?? "unknown"} is below supported version ${minimum ?? "unknown"}.`,
    );
    nextActions.push(
      detection.versionProbeError === undefined
        ? `Upgrade ${detection.displayName}.`
        : `Verify ${detection.displayName} can run --version, then rerun doctor.`,
    );
  }
  if (receipt === undefined) {
    issues.push(`No Atlas-managed ${scope}-scope integration receipt exists.`);
    nextActions.push(
      `Run atlas agent install ${clientId} --scope ${scope} --mode discoverable.`,
    );
  }
  return {
    detection,
    scope,
    healthy: issues.length === 0,
    receiptPresent: receipt !== undefined,
    issues,
    nextActions,
  };
}

export function renderAgentConfig(plan: AgentIntegrationPlan): unknown {
  return {
    clientId: plan.clientId,
    scope: plan.scope,
    mode: plan.mode,
    server: plan.server,
    operations: plan.operations,
    notes: plan.notes,
  };
}

export function integrationReceiptPath(
  homeDir: string,
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  workspaceDir: string,
): string {
  const workspaceKey =
    scope === "workspace"
      ? `-${createHash("sha256").update(resolve(workspaceDir)).digest("hex").slice(0, 16)}`
      : "";
  const baseDir = homeDir;
  return join(
    baseDir,
    ".moxel",
    "atlas",
    "integrations",
    `${clientId}-${scope}${workspaceKey}.json`,
  );
}

function installOperations(
  adapter: AgentClientAdapter,
  scope: AgentIntegrationScope,
  mode: PlanIntegrationInput["mode"],
  server: ServerLaunchSpec,
  environment: IntegrationEnvironment,
): readonly IntegrationOperation[] {
  if (adapter.kind === "native")
    return [
      {
        kind: "command",
        command: adapter.add(server, scope),
        inverse: adapter.remove(scope),
        check: adapter.check(scope),
        checkOutputIncludes: adapter.checkOutputIncludes(server),
        verification: {
          kind: "native-config",
          path: adapterPath(
            adapter.verification.relativePath,
            scope,
            environment,
          ),
          keyPath: [...adapter.verification.rootPath, "atlas"],
          server,
        },
      },
    ];
  if (adapter.kind === "codex")
    return [
      {
        kind: "codex-config",
        path: adapterPath(adapter.relativePath, scope, environment),
        serverName: "atlas",
        command: server.command,
        args: server.args,
        ...(server.env === undefined ? {} : { env: server.env }),
        discoverable: mode !== "standard",
      },
    ];
  if (adapter.kind === "json") {
    const relativePath = jsonAdapterRelativePath(adapter, environment.platform);
    if (relativePath === undefined)
      return [
        {
          kind: "manual",
          reason: `Automatic ${scope}-scope configuration is not supported on ${environment.platform}.`,
          config: nestedJsonConfig(
            adapter.rootPath,
            adapter.serverValue(server),
          ),
        },
      ];
    return [
      {
        kind: "json-merge",
        path: adapterPath(relativePath, scope, environment),
        keyPath: [...adapter.rootPath, "atlas"],
        value: adapter.serverValue(server),
      },
    ];
  }
  if (adapter.kind === "managed-file")
    return [
      {
        kind: "managed-file",
        path: adapterPath(adapter.relativePath, scope, environment),
        content: adapter.render(server),
      },
    ];
  return [
    {
      kind: "manual",
      reason: adapter.reason,
      config: adapter.render(server),
    },
  ];
}
function jsonAdapterRelativePath(
  adapter: Extract<AgentClientAdapter, { kind: "json" }>,
  platform: NodeJS.Platform,
): string | undefined {
  return typeof adapter.relativePath === "string"
    ? adapter.relativePath
    : adapter.relativePath(platform);
}
function nestedJsonConfig(
  rootPath: readonly string[],
  serverValue: unknown,
): unknown {
  return rootPath.reduceRight<unknown>((value, key) => ({ [key]: value }), {
    atlas: serverValue,
  });
}

function adapterForScope(
  descriptor: ReturnType<typeof getAgentIntegration>,
  scope: AgentIntegrationScope,
): AgentClientAdapter {
  const adapter = descriptor[scope];
  if (adapter !== undefined) return adapter;
  const supported = (["user", "workspace"] as const)
    .filter((candidate) => descriptor[candidate] !== undefined)
    .join(", ");
  throw new Error(
    `${descriptor.displayName} does not support ${scope}-scope MCP configuration. Supported scopes: ${supported}.`,
  );
}

async function assertNoUnmanagedNativeConfiguration(
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

async function assertNativeAdapterReady(
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
    commandRunOptions(environment),
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

async function applyCommands(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  completed: CommandOperation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind !== "command") continue;
    await runRequired(operation.command, environment);
    completed.push(operation);
  }
}

async function assertDistinctScopeTargets(
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

async function withIntegrationLocks<T>(
  receiptPath: string,
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  action: () => Promise<T>,
): Promise<T> {
  const canonicalReceipt = await canonicalMutationPath(receiptPath);
  return withPathLock(
    integrationLockPath(environment.homeDir, canonicalReceipt),
    canonicalReceipt,
    () => withOperationLocks(operations, environment, action),
  );
}

async function withOperationLocks<T>(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  action: () => Promise<T>,
): Promise<T> {
  const targets = await Promise.all(
    operationMutationPaths(operations).map(canonicalMutationPath),
  );
  const uniqueTargets = [...new Set(targets)].sort((left, right) =>
    left.localeCompare(right),
  );
  let lockedAction = action;
  for (const target of [...uniqueTargets].reverse()) {
    const next = lockedAction;
    lockedAction = () =>
      withPathLock(
        integrationLockPath(environment.homeDir, target),
        target,
        next,
      );
  }
  return lockedAction();
}

function operationMutationPaths(
  operations: readonly IntegrationOperation[],
): string[] {
  return operations.flatMap((operation) => {
    if (operation.kind === "command") return [operation.verification.path];
    if (
      operation.kind === "json-merge" ||
      operation.kind === "codex-config" ||
      operation.kind === "managed-file"
    )
      return [operation.path];
    return [];
  });
}

async function canonicalMutationPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      return join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if (nodeErrorCode(error) !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(path);
      suffix.push(basename(cursor));
      cursor = parent;
    }
  }
}

export function integrationLockPath(homeDir: string, target: string): string {
  const key = createHash("sha256").update(target).digest("hex");
  return join(
    homeDir,
    ".moxel",
    "atlas",
    "integrations",
    "locks",
    `${key}.lock`,
  );
}

async function withPathLock<T>(
  lockPath: string,
  target: string,
  action: () => Promise<T>,
): Promise<T> {
  const ownerToken = randomUUID();
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            ownerToken,
            target,
            acquiredAt: new Date().toISOString(),
          })}\n`,
        );
        return await action();
      } finally {
        await handle.close();
        await removeOwnedLock(lockPath, ownerToken);
      }
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for integration lock: ${lockPath}. Verify the recorded owner process is no longer running before removing this lock.`,
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function removeOwnedLock(
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  const content = await readOptional(lockPath);
  if (content === undefined) return;
  try {
    const owner = JSON.parse(content) as unknown;
    if (!isUnknownRecord(owner) || owner.ownerToken !== ownerToken) return;
  } catch {
    return;
  }
  await rm(lockPath, { force: true });
}

async function applyInverseCommands(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  completed: CommandOperation[],
): Promise<void> {
  for (const operation of [...operations].reverse()) {
    if (operation.kind !== "command") continue;
    await runRequired(operation.inverse, environment);
    completed.push(operation);
  }
}

async function rollbackCommands(
  completed: readonly CommandOperation[],
  environment: IntegrationEnvironment,
): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const operation of [...completed].reverse()) {
    const failure = await runCompensation(operation.inverse, environment);
    if (failure !== undefined) failures.push(failure);
  }
  return failures;
}

async function rollbackInverseCommands(
  completed: readonly CommandOperation[],
  environment: IntegrationEnvironment,
): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const operation of completed) {
    const failure = await runCompensation(operation.command, environment);
    if (failure !== undefined) failures.push(failure);
  }
  return failures;
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

async function recoverTransaction(
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

async function configuredScopesFor(
  clientId: AgentClientId,
  environment: IntegrationEnvironment,
): Promise<readonly AgentIntegrationScope[]> {
  const scopes: AgentIntegrationScope[] = [];
  for (const scope of ["user", "workspace"] as const) {
    if (
      (await readOptional(
        integrationReceiptPath(
          environment.homeDir,
          clientId,
          scope,
          environment.workspaceDir,
        ),
      )) !== undefined
    )
      scopes.push(scope);
  }
  return scopes;
}

function adapterPath(
  relativePath: string,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): string {
  const root =
    scope === "user" ? environment.homeDir : environment.workspaceDir;
  if (scope === "user") {
    if (
      relativePath === ".codex/config.toml" &&
      environment.env.CODEX_HOME !== undefined
    )
      return join(resolve(environment.env.CODEX_HOME), "config.toml");
    if (
      relativePath === ".copilot/mcp-config.json" &&
      environment.env.COPILOT_HOME !== undefined
    )
      return join(resolve(environment.env.COPILOT_HOME), "mcp-config.json");
    if (
      relativePath === ".gemini/settings.json" &&
      environment.env.GEMINI_CLI_HOME !== undefined
    )
      return join(
        resolve(environment.env.GEMINI_CLI_HOME),
        ".gemini",
        "settings.json",
      );
    if (
      relativePath === ".config/opencode/opencode.json" &&
      environment.env.OPENCODE_CONFIG !== undefined
    )
      return resolve(environment.env.OPENCODE_CONFIG);
    if (
      relativePath.startsWith(".config/") &&
      environment.env.XDG_CONFIG_HOME !== undefined
    )
      return join(
        resolve(environment.env.XDG_CONFIG_HOME),
        relativePath.slice(".config/".length),
      );
  }
  return join(root, relativePath);
}

async function readReceipt(
  path: string,
): Promise<AgentIntegrationReceipt | undefined> {
  const content = await readOptional(path);
  if (content === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Atlas integration receipt is invalid JSON (${path}): ${errorMessage(error)}`,
    );
  }
  if (!isReceipt(parsed))
    throw new Error(`Atlas integration receipt has an invalid shape: ${path}.`);
  return parsed;
}

function isReceipt(value: unknown): value is AgentIntegrationReceipt {
  if (!isUnknownRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.clientId === "string" &&
    AGENT_CLIENT_IDS.some((clientId) => clientId === value.clientId) &&
    (value.scope === "user" || value.scope === "workspace") &&
    (value.mode === "standard" ||
      value.mode === "discoverable" ||
      value.mode === "prefer-local") &&
    typeof value.installedAt === "string" &&
    typeof value.fingerprint === "string" &&
    isServerLaunchSpec(value.server) &&
    Array.isArray(value.operations) &&
    value.operations.every(isIntegrationOperation)
  );
}

function isIntegrationOperation(value: unknown): value is IntegrationOperation {
  if (!isUnknownRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "command")
    return (
      stringArray(value.command) &&
      stringArray(value.inverse) &&
      stringArray(value.check) &&
      stringArray(value.checkOutputIncludes) &&
      isNativeConfigVerification(value.verification)
    );
  if (value.kind === "json-merge")
    return typeof value.path === "string" && stringArray(value.keyPath);
  if (value.kind === "codex-config")
    return (
      typeof value.path === "string" &&
      typeof value.serverName === "string" &&
      typeof value.command === "string" &&
      stringArray(value.args) &&
      (value.env === undefined ||
        (isUnknownRecord(value.env) &&
          Object.values(value.env).every(
            (entry) => typeof entry === "string",
          ))) &&
      typeof value.discoverable === "boolean"
    );
  if (value.kind === "managed-file")
    return typeof value.path === "string" && typeof value.content === "string";
  if (value.kind === "manual")
    return typeof value.reason === "string" && "config" in value;
  return false;
}

function isNativeConfigVerification(
  value: unknown,
): value is CommandOperation["verification"] {
  return (
    isUnknownRecord(value) &&
    value.kind === "native-config" &&
    typeof value.path === "string" &&
    stringArray(value.keyPath) &&
    isServerLaunchSpec(value.server)
  );
}

async function allOperationsMatch(
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
): Promise<boolean> {
  const matches = await Promise.all(
    operations.map(async (operation) => {
      if (operation.kind !== "command") return fileOperationMatches(operation);
      if (!(await fileOperationMatches(operation.verification))) return false;
      const result = await (environment.runCommand ?? runIntegrationCommand)(
        operation.check,
        commandRunOptions(environment),
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

function assertReceiptMatchesPlan(
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

function isServerLaunchSpec(value: unknown): value is ServerLaunchSpec {
  return (
    isUnknownRecord(value) &&
    typeof value.command === "string" &&
    stringArray(value.args) &&
    (value.env === undefined ||
      (isUnknownRecord(value.env) &&
        Object.values(value.env).every((entry) => typeof entry === "string")))
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function integrationFingerprint(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  mode: AgentIntegrationMode,
  server: ServerLaunchSpec,
  operations: readonly IntegrationOperation[],
): string {
  return fingerprint({
    schemaVersion: 1,
    clientId,
    scope,
    mode,
    server,
    operations,
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nodeErrorCode(error: unknown): string | undefined {
  return isUnknownRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
