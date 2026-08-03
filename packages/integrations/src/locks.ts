import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { readOptional } from "./file-operations";
import { isUnknownRecord } from "./guards";
import type { IntegrationEnvironment, IntegrationOperation } from "./types";

export interface IntegrationLockPlan {
  readonly receiptPath: string;
  readonly operations: readonly IntegrationOperation[];
}

export async function withIntegrationLocks<T>(
  receiptPath: string,
  operations: readonly IntegrationOperation[],
  environment: IntegrationEnvironment,
  action: () => Promise<T>,
): Promise<T> {
  const targets = await canonicalIntegrationLockTargets(
    receiptPath,
    operations,
  );
  return withCanonicalMutationLocks(targets, environment, action);
}

export async function withStableIntegrationLocks<
  T,
  Plan extends IntegrationLockPlan,
>(
  loadPlan: () => Promise<Plan>,
  environment: IntegrationEnvironment,
  action: (plan: Plan) => Promise<T>,
): Promise<T> {
  while (true) {
    const snapshot = await loadPlan();
    const expectedTargets = await canonicalIntegrationLockTargets(
      snapshot.receiptPath,
      snapshot.operations,
    );
    const attempt = await withCanonicalMutationLocks(
      expectedTargets,
      environment,
      async (): Promise<
        | { readonly stable: false }
        | { readonly stable: true; readonly value: T }
      > => {
        const lockedPlan = await loadPlan();
        const lockedTargets = await canonicalIntegrationLockTargets(
          lockedPlan.receiptPath,
          lockedPlan.operations,
        );
        if (!sameTargets(expectedTargets, lockedTargets))
          return { stable: false };
        return { stable: true, value: await action(lockedPlan) };
      },
    );
    if (attempt.stable) return attempt.value;
  }
}

async function canonicalIntegrationLockTargets(
  receiptPath: string,
  operations: readonly IntegrationOperation[],
): Promise<readonly string[]> {
  const targets = await Promise.all(
    [receiptPath, ...operationMutationPaths(operations)].map(
      canonicalMutationPath,
    ),
  );
  return [...new Set(targets)].sort((left, right) => left.localeCompare(right));
}

async function withCanonicalMutationLocks<T>(
  targets: readonly string[],
  environment: IntegrationEnvironment,
  action: () => Promise<T>,
): Promise<T> {
  let lockedAction = action;
  for (const target of [...targets].reverse()) {
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

function sameTargets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((target, index) => target === right[index])
  );
}

export function operationMutationPaths(
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

export async function canonicalMutationPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      return join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      const code =
        isUnknownRecord(error) && typeof error.code === "string"
          ? error.code
          : undefined;
      if (code !== "ENOENT") throw error;
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
      const code =
        isUnknownRecord(error) && typeof error.code === "string"
          ? error.code
          : undefined;
      if (code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for integration lock: ${lockPath}. Verify the recorded owner process is no longer running before removing this lock.`,
        );
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
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
