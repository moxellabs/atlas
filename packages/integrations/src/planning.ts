import { join, resolve } from "node:path";

import { AGENT_INTEGRATIONS, getAgentIntegration } from "./catalog";
import { defaultAtlasServer } from "./environment";
import { integrationFingerprint, integrationReceiptPath } from "./receipts";
import type {
  AgentClientAdapter,
  AgentClientId,
  AgentIntegrationDescriptor,
  AgentIntegrationPlan,
  AgentIntegrationReceipt,
  AgentIntegrationScope,
  IntegrationEnvironment,
  IntegrationOperation,
  PlanIntegrationInput,
  ServerLaunchSpec,
} from "./types";

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

export function planAgentRemoval(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
  receipt: AgentIntegrationReceipt | undefined,
): AgentIntegrationPlan {
  const descriptor = getAgentIntegration(clientId);
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
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
          allowedKeys: adapter.verification.allowedKeys,
          ...(adapter.verification.expectedValues === undefined
            ? {}
            : { expectedValues: adapter.verification.expectedValues }),
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
    const relativePath =
      typeof adapter.relativePath === "string"
        ? adapter.relativePath
        : adapter.relativePath(environment.platform);
    if (relativePath === undefined)
      return [
        {
          kind: "manual",
          reason: `Automatic ${scope}-scope configuration is not supported on ${environment.platform}.`,
          config: adapter.rootPath.reduceRight<unknown>(
            (value, key) => ({ [key]: value }),
            { atlas: adapter.serverValue(server) },
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
    { kind: "manual", reason: adapter.reason, config: adapter.render(server) },
  ];
}

export function adapterForScope(
  descriptor: AgentIntegrationDescriptor,
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
