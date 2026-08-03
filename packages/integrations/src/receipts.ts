import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

import { isUnknownRecord } from "./guards";
import { readOptional } from "./file-operations";
import {
  AGENT_CLIENT_IDS,
  type AgentClientId,
  type AgentIntegrationMode,
  type AgentIntegrationReceipt,
  type AgentIntegrationScope,
  type CommandOperation,
  type IntegrationOperation,
  type ServerLaunchSpec,
} from "./types";

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
  return join(
    homeDir,
    ".moxel",
    "atlas",
    "integrations",
    `${clientId}-${scope}${workspaceKey}.json`,
  );
}

export async function readReceipt(
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

export function integrationFingerprint(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  mode: AgentIntegrationMode,
  server: ServerLaunchSpec,
  operations: readonly IntegrationOperation[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        clientId,
        scope,
        mode,
        server,
        operations,
      }),
    )
    .digest("hex");
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
    isServerLaunchSpec(value.server) &&
    stringArray(value.allowedKeys) &&
    (value.expectedValues === undefined ||
      isUnknownRecord(value.expectedValues))
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
