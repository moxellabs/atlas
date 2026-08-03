import { resolve } from "node:path";

import {
  type AgentClientId,
  type AgentIntegrationMode,
  type AgentIntegrationScope,
  createIntegrationEnvironment,
  detectAgentIntegrations,
  defaultAtlasServer,
  doctorAgentIntegration,
  installAgentIntegration,
  isAgentClientId,
  listAgentIntegrations,
  planAgentInstall,
  removeAgentIntegration,
  renderAgentConfig,
  type ServerLaunchSpec,
} from "@atlas/integrations";

import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import {
  CliError,
  EXIT_INPUT_ERROR,
  EXIT_PARTIAL_FAILURE,
} from "../utils/errors";
import { renderRows, renderSuccess } from "./render";

export async function runAgentCommand(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const [subcommand = "list"] = context.positionals;
  switch (subcommand) {
    case "list":
      return listClients(context);
    case "detect":
      return detectClients(context);
    case "install":
      return installClients(context);
    case "remove":
      return removeClients(context);
    case "doctor":
      return doctorClients(context);
    case "print-config":
      return printClientConfig(context);
    default:
      throw new CliError(`Unknown agent subcommand: ${subcommand}.`, {
        code: "CLI_UNKNOWN_AGENT_SUBCOMMAND",
        exitCode: EXIT_INPUT_ERROR,
      });
  }
}

async function listClients(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const rows = listAgentIntegrations().map((descriptor) => ({
    client: descriptor.id,
    name: descriptor.displayName,
    kind: descriptor.kind,
    minimumVersion: descriptor.minimumVersion ?? "n/a",
    userAdapter: descriptor.user?.kind ?? "unsupported",
    workspaceAdapter: descriptor.workspace?.kind ?? "unsupported",
  }));
  return renderSuccess(context, "agent list", rows, [renderRows(rows)]);
}

async function detectClients(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const environment = integrationEnvironment(context);
  const detected = await detectAgentIntegrations(environment);
  const rows = detected.map((item) => ({
    client: item.clientId,
    installed: item.installed,
    version: item.version ?? "unknown",
    versionSupported: item.versionSupported ?? "unknown",
    scopes: item.configuredScopes.join(",") || "none",
  }));
  return renderSuccess(context, "agent detect", detected, [renderRows(rows)]);
}

async function installClients(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const environment = integrationEnvironment(context);
  const scope = readScope(context);
  const mode = readMode(context);
  const dryRun = readBooleanOption(context, "dryRun");
  const batch = readBooleanOption(context, "detected");
  const clientIds = await resolveTargetClients(context, environment);
  const server = readServerLaunch(context, mode);
  const inputs = clientIds.map((clientId) => ({
    clientId,
    scope,
    mode,
    ...(server === undefined ? {} : { server }),
  }));

  // Scope and adapter validation is deliberately complete before the first
  // client is mutated so unsupported entries cannot leave a partial install.
  await Promise.all(
    inputs.map((input) =>
      installAgentIntegration(input, environment, { dryRun: true }),
    ),
  );

  const results = [];
  const outcomes: Array<Record<string, unknown>> = [];
  let failed = false;
  for (const input of inputs) {
    try {
      const result = await installAgentIntegration(input, environment, {
        dryRun,
      });
      results.push(result);
      outcomes.push({
        client: input.clientId,
        status: result.plan.requiresManualAction
          ? "manual"
          : dryRun
            ? "planned"
            : result.changed
              ? "configured"
              : "unchanged",
        result,
      });
    } catch (error) {
      if (!batch) throw error;
      failed = true;
      outcomes.push({
        client: input.clientId,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }
  const lines = outcomes.map((outcome) =>
    outcome.status === "failed"
      ? `${outcome.client}: failed: ${outcome.error}`
      : `${outcome.client}: ${outcome.status} (${scope}, ${mode}).`,
  );
  if (failed)
    return renderSuccess(
      context,
      "agent install",
      outcomes,
      lines,
      EXIT_PARTIAL_FAILURE,
    );
  return renderSuccess(context, "agent install", results, lines);
}

async function removeClients(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const environment = integrationEnvironment(context);
  const scope = readScope(context);
  const dryRun = readBooleanOption(context, "dryRun");
  const batch = readBooleanOption(context, "all");
  const clientIds = resolveExplicitOrAllClients(context);

  // A removal dry-run verifies receipt integrity and live state. Preflight the
  // entire selection before deleting any Atlas-owned configuration.
  const planned = await Promise.all(
    clientIds.map((clientId) =>
      removeAgentIntegration(clientId, scope, environment, { dryRun: true }),
    ),
  );
  if (dryRun)
    return renderSuccess(
      context,
      "agent remove",
      planned,
      planned.map(
        (result) => `${result.plan.displayName}: planned (${scope}).`,
      ),
    );

  const results = [];
  const outcomes: Array<Record<string, unknown>> = [];
  let failed = false;
  for (const clientId of clientIds) {
    try {
      const result = await removeAgentIntegration(clientId, scope, environment);
      results.push(result);
      outcomes.push({
        client: clientId,
        status: result.changed ? "removed" : "unchanged",
        result,
      });
    } catch (error) {
      if (!batch) throw error;
      failed = true;
      outcomes.push({
        client: clientId,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }
  const lines = outcomes.map((outcome) =>
    outcome.status === "failed"
      ? `${outcome.client}: failed: ${outcome.error}`
      : `${outcome.client}: ${outcome.status} (${scope}).`,
  );
  if (failed)
    return renderSuccess(
      context,
      "agent remove",
      outcomes,
      lines,
      EXIT_PARTIAL_FAILURE,
    );
  return renderSuccess(context, "agent remove", results, lines);
}

async function doctorClients(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const environment = integrationEnvironment(context);
  const scope = readScope(context);
  const clientIds = resolveExplicitOrAllClients(context);
  const reports = [];
  for (const clientId of clientIds)
    reports.push(await doctorAgentIntegration(clientId, scope, environment));
  const rows = reports.map((report) => ({
    client: report.detection.clientId,
    installed: report.detection.installed,
    version: report.detection.version ?? "unknown",
    healthy: report.healthy,
    issues: report.issues.join("; ") || "none",
  }));
  return renderSuccess(context, "agent doctor", reports, [renderRows(rows)]);
}

async function printClientConfig(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const clientId = requiredClientId(context.positionals[1]);
  const scope = readScope(context);
  const mode = readMode(context);
  const server = readServerLaunch(context, mode);
  const plan = planAgentInstall(
    {
      clientId,
      scope,
      mode,
      ...(server === undefined ? {} : { server }),
    },
    integrationEnvironment(context),
  );
  const config = renderAgentConfig(plan);
  return renderSuccess(context, "agent print-config", config, [
    JSON.stringify(config, null, 2),
  ]);
}

async function resolveTargetClients(
  context: CliCommandContext,
  environment: ReturnType<typeof createIntegrationEnvironment>,
): Promise<readonly AgentClientId[]> {
  const explicit = positionalClient(context);
  const detectedRequested = readBooleanOption(context, "detected");
  if (detectedRequested && explicit !== undefined)
    throw conflictingSelectorError("client", "--detected");
  if (!detectedRequested) return [requiredClientId(explicit)];
  const detected = await detectAgentIntegrations(environment);
  const clientIds = detected
    .filter((item) => item.installed && item.versionSupported !== false)
    .map((item) => item.clientId);
  if (clientIds.length === 0)
    throw new CliError("No supported agent clients were detected.", {
      code: "CLI_NO_AGENT_CLIENTS_DETECTED",
      exitCode: EXIT_INPUT_ERROR,
    });
  return clientIds;
}

function requiredClientId(value: string | undefined): AgentClientId {
  if (value === undefined || !isAgentClientId(value))
    throw new CliError(
      `Agent client is required. Expected one of: ${listAgentIntegrations()
        .map((descriptor) => descriptor.id)
        .join(", ")}.`,
      { code: "CLI_INVALID_AGENT_CLIENT", exitCode: EXIT_INPUT_ERROR },
    );
  return value;
}

function readScope(context: CliCommandContext): AgentIntegrationScope {
  const value = readStringOption(context, "scope") ?? "user";
  if (value === "user" || value === "workspace") return value;
  throw new CliError(
    `Invalid agent scope: ${value}. Expected user or workspace.`,
    { code: "CLI_INVALID_CHOICE", exitCode: EXIT_INPUT_ERROR },
  );
}

function readMode(context: CliCommandContext): AgentIntegrationMode {
  const value = readStringOption(context, "mode") ?? "standard";
  if (
    value === "standard" ||
    value === "discoverable" ||
    value === "prefer-local"
  )
    return value;
  throw new CliError(
    `Invalid agent mode: ${value}. Expected standard, discoverable, or prefer-local.`,
    { code: "CLI_INVALID_CHOICE", exitCode: EXIT_INPUT_ERROR },
  );
}

function readServerLaunch(
  context: CliCommandContext,
  mode: AgentIntegrationMode,
): ServerLaunchSpec | undefined {
  const command = readStringOption(context, "serverCommand");
  const args = readStringArrayOption(context, "serverArg");
  const remoteUrl = readStringOption(context, "remoteUrl");
  const tokenEnv = readStringOption(context, "authTokenEnv");
  const tokenFile = readStringOption(context, "authTokenFile");
  if (remoteUrl !== undefined) {
    if (command !== undefined || args.length > 0)
      throw new CliError(
        "--remote-url cannot be combined with --server-command or --server-arg.",
        { code: "CLI_INVALID_OPTIONS", exitCode: EXIT_INPUT_ERROR },
      );
    let parsed: URL;
    try {
      parsed = new URL(remoteUrl);
    } catch {
      throw new CliError(`Invalid remote Atlas URL: ${remoteUrl}.`, {
        code: "CLI_INVALID_OPTION",
        exitCode: EXIT_INPUT_ERROR,
      });
    }
    if (parsed.protocol !== "https:")
      throw new CliError("Remote Atlas URLs must use HTTPS.", {
        code: "CLI_INVALID_OPTION",
        exitCode: EXIT_INPUT_ERROR,
      });
    if ((tokenEnv === undefined) === (tokenFile === undefined))
      throw new CliError(
        "--remote-url requires exactly one of --auth-token-env or --auth-token-file.",
        { code: "CLI_INVALID_OPTIONS", exitCode: EXIT_INPUT_ERROR },
      );
    if (tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnv))
      throw new CliError(
        `Invalid auth token environment variable: ${tokenEnv}.`,
        {
          code: "CLI_INVALID_OPTION",
          exitCode: EXIT_INPUT_ERROR,
        },
      );
    const server = defaultAtlasServer(mode);
    return {
      command: server.command,
      args: [
        ...server.args,
        "--remote-url",
        parsed.toString(),
        ...(tokenEnv === undefined
          ? ["--auth-token-file", resolve(context.cwd, tokenFile as string)]
          : ["--auth-token-env", tokenEnv]),
      ],
    };
  }
  if (tokenEnv !== undefined || tokenFile !== undefined)
    throw new CliError(
      "--auth-token-env and --auth-token-file require --remote-url.",
      { code: "CLI_INVALID_OPTIONS", exitCode: EXIT_INPUT_ERROR },
    );
  if (command === undefined && args.length === 0) return undefined;
  if (command === undefined)
    throw new CliError("--server-arg requires --server-command.", {
      code: "CLI_MISSING_REQUIRED_OPTION",
      exitCode: EXIT_INPUT_ERROR,
    });
  return { command, args };
}

function resolveExplicitOrAllClients(
  context: CliCommandContext,
): readonly AgentClientId[] {
  const explicit = positionalClient(context);
  const allRequested = readBooleanOption(context, "all");
  if (allRequested && explicit !== undefined)
    throw conflictingSelectorError("client", "--all");
  return allRequested
    ? listAgentIntegrations().map((descriptor) => descriptor.id)
    : [requiredClientId(explicit)];
}

function positionalClient(context: CliCommandContext): string | undefined {
  return context.positionals[1];
}

function conflictingSelectorError(left: string, right: string): CliError {
  return new CliError(`Choose exactly one of ${left} or ${right}.`, {
    code: "CLI_INVALID_OPTIONS",
    exitCode: EXIT_INPUT_ERROR,
  });
}

function readBooleanOption(context: CliCommandContext, key: string): boolean {
  return context.options?.[key] === true;
}

function readStringOption(
  context: CliCommandContext,
  key: string,
): string | undefined {
  const value = context.options?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArrayOption(
  context: CliCommandContext,
  key: string,
): string[] {
  const value = context.options?.[key];
  if (typeof value === "string") return [value];
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? [...value]
    : [];
}

function integrationEnvironment(context: CliCommandContext) {
  return createIntegrationEnvironment({ cwd: context.cwd, env: context.env });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
