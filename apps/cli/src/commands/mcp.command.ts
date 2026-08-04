import { readFile, stat } from "node:fs/promises";

import {
  type ResolvedAtlasConfig,
  resolveIdentityProfile,
} from "@atlas/config";
import type { RepositoryRefreshStateProvider } from "@atlas/core";
import {
  type IndexerService,
  RepositoryLifecycleService,
  type RepositoryLifecycleDiagnostic,
} from "@atlas/indexer";
import type {
  AtlasMcpDiscoveryPolicy,
  AtlasMcpServer,
  AtlasMcpToolProfile,
  RemoteMcpProxy,
} from "@atlas/mcp";
import {
  ATLAS_MCP_DISCOVERY_POLICIES,
  ATLAS_MCP_TOOL_PROFILES,
  createAtlasMcpServer,
  createStdioTransport,
  createRemoteMcpProxy,
} from "@atlas/mcp";

import { readStringOption } from "../runtime/args";
import { buildCliDependencies } from "../runtime/dependencies";
import type {
  AtlasCliDependencies,
  CliCommandContext,
  CliCommandResult,
} from "../runtime/types";
import { createCliConsole } from "./render";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";

type StdioTransport = ReturnType<typeof createStdioTransport>;
type McpRuntimeDependencies = Pick<AtlasCliDependencies, "db" | "close"> &
  Partial<Pick<AtlasCliDependencies, "config" | "indexer">>;

interface McpCommandRuntime {
  createServer(
    deps: Pick<AtlasCliDependencies, "db"> & {
      repositoryRefreshStateProvider?:
        | RepositoryRefreshStateProvider
        | undefined;
    },
    identity: ReturnType<typeof resolveIdentityProfile>["mcpIdentity"],
    discoveryPolicy: AtlasMcpDiscoveryPolicy,
    toolProfile: AtlasMcpToolProfile,
    sourceFacadeRepoIds: readonly string[],
  ): AtlasMcpServer;
  createLifecycle?(
    config: ResolvedAtlasConfig,
    indexer: IndexerService,
    onCorpusChanged: () => void,
    onDiagnostic: (diagnostic: RepositoryLifecycleDiagnostic) => void,
  ): RepositoryLifecycleService;
  createTransport(context: CliCommandContext): StdioTransport;
}

const defaultRuntime: McpCommandRuntime = {
  createServer(
    deps,
    identity,
    discoveryPolicy,
    toolProfile,
    sourceFacadeRepoIds,
  ) {
    return createAtlasMcpServer({
      db: deps.db,
      identity,
      discoveryPolicy,
      toolProfile,
      sourceFacadeRepoIds,
      ...(deps.repositoryRefreshStateProvider === undefined
        ? {}
        : {
            repositoryRefreshStateProvider: deps.repositoryRefreshStateProvider,
          }),
    });
  },
  createLifecycle(config, indexer, onCorpusChanged, onDiagnostic) {
    return new RepositoryLifecycleService({
      config,
      indexer,
      onCorpusChanged,
      onDiagnostic,
    });
  },
  createTransport(context) {
    return createStdioTransport(context.stdin, context.stdout);
  },
};

/** Starts the ATLAS MCP server over stdio for command-launched MCP clients. */
export async function runMcpCommand(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  if (readStringOption(context, "remoteUrl") !== undefined)
    return runRemoteMcpCommand(context);
  const configPath = readStringOption(context, "config");
  const deps = await buildCliDependencies({
    cwd: context.cwd,
    env: context.env,
    requireGhesAuth: false,
    ...(configPath === undefined ? {} : { configPath }),
  });
  return runMcpCommandWithDependencies(context, deps, defaultRuntime);
}

/** Runs the stdio MCP command with injected dependencies for lifecycle tests. */
export async function runMcpCommandWithDependencies(
  context: CliCommandContext,
  deps: McpRuntimeDependencies,
  runtime: McpCommandRuntime = defaultRuntime,
): Promise<CliCommandResult> {
  const consoleIo = createCliConsole(context);
  const identity =
    deps.config !== undefined
      ? resolveIdentityProfile({
          envIdentityRoot: deps.config.env.ATLAS_IDENTITY_ROOT,
          configIdentity: deps.config.config.identity,
          mcp: {
            cliMcpName: context.mcpName,
            cliMcpTitle: context.mcpTitle,
            cliMcpResourcePrefix: context.mcpResourcePrefix,
            envMcpName: deps.config.env.ATLAS_MCP_NAME,
            envMcpTitle: deps.config.env.ATLAS_MCP_TITLE,
            envMcpResourcePrefix: deps.config.env.ATLAS_MCP_RESOURCE_PREFIX,
          },
        }).mcpIdentity
      : resolveIdentityProfile({
          mcp: {
            cliMcpName: context.mcpName,
            cliMcpTitle: context.mcpTitle,
            cliMcpResourcePrefix:
              context.mcpResourcePrefix ??
              context.env.ATLAS_MCP_RESOURCE_PREFIX,
            envMcpName: context.env.ATLAS_MCP_NAME,
            envMcpTitle: context.env.ATLAS_MCP_TITLE,
            envMcpResourcePrefix: context.env.ATLAS_MCP_RESOURCE_PREFIX,
          },
        }).mcpIdentity;
  const discoveryPolicy = readDiscoveryPolicy(context);
  const toolProfile = readToolProfile(context);
  let server!: AtlasMcpServer;
  const createLifecycle =
    runtime.createLifecycle ?? defaultRuntime.createLifecycle;
  const lifecycle =
    deps.config === undefined ||
    deps.indexer === undefined ||
    createLifecycle === undefined
      ? undefined
      : createLifecycle(
          deps.config,
          deps.indexer,
          () => {
            server.refreshDiscovery();
          },
          (diagnostic) => {
            void consoleIo.debug(diagnostic.message);
          },
        );
  server = runtime.createServer(
    {
      db: deps.db,
      ...(lifecycle === undefined
        ? {}
        : { repositoryRefreshStateProvider: lifecycle }),
    },
    identity,
    discoveryPolicy,
    toolProfile,
    deps.config?.config.repos?.map((repo) => repo.repoId) ?? [],
  );
  lifecycle?.start();
  const transport = runtime.createTransport(context);
  const refreshTimer = setInterval(() => {
    try {
      server.refreshDiscovery();
    } catch (error) {
      void consoleIo.debug(
        `Atlas MCP discovery refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 5_000);
  refreshTimer.unref();
  const closeTransport = () => {
    void transport.close();
  };
  const closed = new Promise<void>((resolve) => {
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      resolve();
    };
  });

  try {
    context.stdin.once("end", closeTransport);
    context.stdin.once("close", closeTransport);
    await server.server.connect(transport);
    await consoleIo.debug("Atlas MCP stdio server connected.");
    await closed;
    return {
      ok: true,
      command: "mcp",
      data: {
        transport: "stdio",
        tools: server.tools,
        resources: server.resources,
        prompts: server.prompts,
      },
    };
  } finally {
    clearInterval(refreshTimer);
    context.stdin.off("end", closeTransport);
    context.stdin.off("close", closeTransport);
    await lifecycle?.close();
    deps.close();
  }
}
async function runRemoteMcpCommand(
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const consoleIo = createCliConsole(context);
  const url = readStringOption(context, "remoteUrl");
  if (url === undefined)
    throw new CliError("Remote MCP URL is required.", {
      code: "CLI_MISSING_REQUIRED_OPTION",
      exitCode: EXIT_INPUT_ERROR,
    });
  const token = await readRemoteToken(context);
  const proxy = await createRemoteMcpProxy({
    url,
    token,
    expectedDiscoveryPolicy: readDiscoveryPolicy(context),
  });
  const transport = createStdioTransport(context.stdin, context.stdout);
  await serveProxyOverStdio(context, proxy, transport, consoleIo);
  return {
    ok: true,
    command: "mcp",
    data: { transport: "stdio-http-proxy", url },
  };
}

async function serveProxyOverStdio(
  context: CliCommandContext,
  proxy: RemoteMcpProxy,
  transport: StdioTransport,
  consoleIo: ReturnType<typeof createCliConsole>,
): Promise<void> {
  const closeTransport = () => {
    void transport.close();
  };
  const closed = new Promise<void>((resolve) => {
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      resolve();
    };
  });
  try {
    context.stdin.once("end", closeTransport);
    context.stdin.once("close", closeTransport);
    await proxy.server.connect(transport);
    await consoleIo.debug("Atlas remote MCP proxy connected.");
    await closed;
  } finally {
    context.stdin.off("end", closeTransport);
    context.stdin.off("close", closeTransport);
    await proxy.close();
  }
}

async function readRemoteToken(context: CliCommandContext): Promise<string> {
  const envName = readStringOption(context, "authTokenEnv");
  const file = readStringOption(context, "authTokenFile");
  if ((envName === undefined) === (file === undefined))
    throw new CliError(
      "Remote MCP requires exactly one of --auth-token-env or --auth-token-file.",
      { code: "CLI_INVALID_OPTIONS", exitCode: EXIT_INPUT_ERROR },
    );
  if (envName !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(envName))
      throw new CliError(
        `Invalid auth token environment variable: ${envName}.`,
        {
          code: "CLI_INVALID_OPTION",
          exitCode: EXIT_INPUT_ERROR,
        },
      );
    const token = context.env[envName];
    if (token === undefined || token.length < 32)
      throw new CliError(
        `Environment variable ${envName} must contain a token with at least 32 characters.`,
        { code: "CLI_INVALID_OPTION", exitCode: EXIT_INPUT_ERROR },
      );
    return token;
  }
  const tokenFile = file as string;
  const metadata = await stat(tokenFile);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
    throw new CliError(
      "Auth token file must be a regular file without group or world permissions.",
      { code: "CLI_INVALID_OPTION", exitCode: EXIT_INPUT_ERROR },
    );
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length < 32)
    throw new CliError("Auth token file must contain at least 32 characters.", {
      code: "CLI_INVALID_OPTION",
      exitCode: EXIT_INPUT_ERROR,
    });
  return token;
}

function readDiscoveryPolicy(
  context: CliCommandContext,
): AtlasMcpDiscoveryPolicy {
  const value = readStringOption(context, "discoveryPolicy") ?? "neutral";
  if (ATLAS_MCP_DISCOVERY_POLICIES.includes(value as AtlasMcpDiscoveryPolicy)) {
    return value as AtlasMcpDiscoveryPolicy;
  }
  throw new CliError(
    `Invalid MCP discovery policy: ${value}. Expected one of: ${ATLAS_MCP_DISCOVERY_POLICIES.join(", ")}.`,
    { code: "CLI_INVALID_CHOICE", exitCode: EXIT_INPUT_ERROR },
  );
}

function readToolProfile(context: CliCommandContext): AtlasMcpToolProfile {
  const value = readStringOption(context, "toolProfile") ?? "agent";
  if (ATLAS_MCP_TOOL_PROFILES.includes(value as AtlasMcpToolProfile)) {
    return value as AtlasMcpToolProfile;
  }
  throw new CliError(
    `Invalid MCP tool profile: ${value}. Expected one of: ${ATLAS_MCP_TOOL_PROFILES.join(", ")}.`,
    { code: "CLI_INVALID_CHOICE", exitCode: EXIT_INPUT_ERROR },
  );
}
