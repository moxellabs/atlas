import type {
  AgentClientAdapter,
  AgentClientId,
  AgentIntegrationDescriptor,
  AgentIntegrationScope,
  ServerLaunchSpec,
} from "./types";

const stdioServer = (server: ServerLaunchSpec) => ({
  command: server.command,
  args: [...server.args],
  ...(server.env === undefined ? {} : { env: { ...server.env } }),
});

const typedStdioServer = (server: ServerLaunchSpec) => ({
  type: "stdio",
  ...stdioServer(server),
});

const localCommandArray = (server: ServerLaunchSpec) => ({
  type: "local",
  command: [server.command, ...server.args],
  enabled: true,
  ...(server.env === undefined ? {} : { environment: { ...server.env } }),
});

const json = (
  relativePath: Extract<AgentClientAdapter, { kind: "json" }>["relativePath"],
  rootPath: readonly string[],
  serverValue: (server: ServerLaunchSpec) => unknown = stdioServer,
): AgentClientAdapter => ({
  kind: "json",
  relativePath,
  rootPath,
  serverValue,
});

const manual = (
  reason: string,
  render: (server: ServerLaunchSpec) => unknown = stdioServer,
): AgentClientAdapter => ({ kind: "manual", reason, render });

const nativeEnvArgs = (server: ServerLaunchSpec): string[] =>
  Object.entries(server.env ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);

const nativeCheckOutput = (): readonly string[] => ["atlas"];

const claudeScope = (scope: AgentIntegrationScope): string =>
  scope === "user" ? "user" : "project";
const geminiScope = (scope: AgentIntegrationScope): string =>
  scope === "user" ? "user" : "project";

export const AGENT_INTEGRATIONS: readonly AgentIntegrationDescriptor[] = [
  {
    id: "codex",
    displayName: "Codex CLI",
    kind: "headless",
    executable: "codex",
    minimumVersion: "0.146.0",
    user: {
      kind: "codex",
      relativePath: ".codex/config.toml",
    },
    workspace: {
      kind: "codex",
      relativePath: ".codex/config.toml",
    },
    notes: [
      "Discoverable mode uses Codex-supported required-server and write-aware tool approval settings.",
    ],
  },
  {
    id: "claude",
    displayName: "Claude Code",
    kind: "headless",
    executable: "claude",
    minimumVersion: "1.0.113",
    user: {
      kind: "native",
      executable: "claude",
      add: (server, scope) => [
        "claude",
        "mcp",
        "add",
        "--scope",
        claudeScope(scope),
        ...nativeEnvArgs(server),
        "--transport",
        "stdio",
        "atlas",
        "--",
        server.command,
        ...server.args,
      ],
      remove: (scope) => [
        "claude",
        "mcp",
        "remove",
        "--scope",
        claudeScope(scope),
        "atlas",
      ],
      check: () => ["claude", "mcp", "get", "atlas"],
      checkOutputIncludes: nativeCheckOutput,
      verification: {
        relativePath: ".claude.json",
        rootPath: ["mcpServers"],
      },
    },
    workspace: {
      kind: "native",
      executable: "claude",
      add: (server, scope) => [
        "claude",
        "mcp",
        "add",
        "--scope",
        claudeScope(scope),
        ...nativeEnvArgs(server),
        "--transport",
        "stdio",
        "atlas",
        "--",
        server.command,
        ...server.args,
      ],
      remove: (scope) => [
        "claude",
        "mcp",
        "remove",
        "--scope",
        claudeScope(scope),
        "atlas",
      ],
      check: () => ["claude", "mcp", "get", "atlas"],
      checkOutputIncludes: nativeCheckOutput,
      verification: {
        relativePath: ".mcp.json",
        rootPath: ["mcpServers"],
      },
    },
    notes: [
      "Atlas marks only plan_context as anthropic/alwaysLoad; Claude tool search remains enabled.",
    ],
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    kind: "headless",
    executable: "gemini",
    minimumVersion: "0.53.1",
    user: {
      kind: "native",
      executable: "gemini",
      add: (server, scope) => [
        "gemini",
        "mcp",
        "add",
        "--scope",
        geminiScope(scope),
        ...nativeEnvArgs(server),
        "atlas",
        server.command,
        ...server.args,
      ],
      remove: (scope) => [
        "gemini",
        "mcp",
        "remove",
        "--scope",
        geminiScope(scope),
        "atlas",
      ],
      check: () => ["gemini", "mcp", "list"],
      checkOutputIncludes: nativeCheckOutput,
      verification: {
        relativePath: ".gemini/settings.json",
        rootPath: ["mcpServers"],
      },
    },
    workspace: {
      kind: "native",
      executable: "gemini",
      add: (server, scope) => [
        "gemini",
        "mcp",
        "add",
        "--scope",
        geminiScope(scope),
        ...nativeEnvArgs(server),
        "atlas",
        server.command,
        ...server.args,
      ],
      remove: (scope) => [
        "gemini",
        "mcp",
        "remove",
        "--scope",
        geminiScope(scope),
        "atlas",
      ],
      check: () => ["gemini", "mcp", "list"],
      checkOutputIncludes: nativeCheckOutput,
      verification: {
        relativePath: ".gemini/settings.json",
        rootPath: ["mcpServers"],
      },
    },
  },
  {
    id: "antigravity",
    displayName: "Google Antigravity",
    kind: "ide",
    user: json(".gemini/config/mcp_config.json", ["mcpServers"]),
    workspace: json(".agents/mcp_config.json", ["mcpServers"]),
    notes: [
      "Antigravity uses its own MCP configuration; Gemini CLI settings are not reused.",
    ],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    kind: "headless",
    executable: "copilot",
    minimumVersion: "1.0.77",
    user: {
      kind: "native",
      executable: "copilot",
      add: (server) => [
        "copilot",
        "mcp",
        "add",
        "atlas",
        ...nativeEnvArgs(server),
        "--",
        server.command,
        ...server.args,
      ],
      remove: () => ["copilot", "mcp", "remove", "atlas"],
      check: () => ["copilot", "mcp", "get", "atlas", "--json"],
      checkOutputIncludes: nativeCheckOutput,
      verification: {
        relativePath: ".copilot/mcp-config.json",
        rootPath: ["mcpServers"],
      },
    },
    workspace: json(".github/mcp.json", ["mcpServers"]),
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    kind: "headless",
    executable: "opencode",
    minimumVersion: "1.0.142",
    user: json(".config/opencode/opencode.json", ["mcp"], localCommandArray),
    workspace: json("opencode.json", ["mcp"], localCommandArray),
  },
  {
    id: "aider",
    displayName: "Aider",
    kind: "headless",
    executable: "aider",
    user: manual(
      "Aider does not currently expose a supported MCP server configuration; use Atlas artifacts as read-only files instead.",
    ),
    workspace: manual(
      "Aider does not currently expose a supported MCP server configuration; use Atlas artifacts as read-only files instead.",
    ),
  },
  {
    id: "vscode",
    displayName: "Visual Studio Code",
    kind: "ide",
    executable: "code",
    user: manual(
      "Open MCP: Open User Configuration in Visual Studio Code; the active profile determines the user config path.",
      (server) => ({ servers: { atlas: typedStdioServer(server) } }),
    ),
    workspace: json(".vscode/mcp.json", ["servers"], typedStdioServer),
  },
  {
    id: "cursor",
    displayName: "Cursor",
    kind: "ide",
    executable: "cursor",
    user: json(".cursor/mcp.json", ["mcpServers"], typedStdioServer),
    workspace: json(".cursor/mcp.json", ["mcpServers"], typedStdioServer),
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    kind: "ide",
    executable: "windsurf",
    user: json(".codeium/windsurf/mcp_config.json", ["mcpServers"]),
    workspace: manual(
      "Windsurf documents only user-level MCP configuration; use user scope.",
    ),
  },
  {
    id: "cline",
    displayName: "Cline",
    kind: "ide",
    user: json(".cline/data/settings/cline_mcp_settings.json", ["mcpServers"]),
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    kind: "ide",
    user: manual(
      "Open Roo Code's MCP Servers panel and choose Edit Global MCP; Roo Code does not publish a stable user configuration path.",
      (server) => ({ mcpServers: { atlas: stdioServer(server) } }),
    ),
    workspace: json(".roo/mcp.json", ["mcpServers"]),
  },
  {
    id: "continue",
    displayName: "Continue",
    kind: "ide",
    user: {
      kind: "managed-file",
      relativePath: ".continue/mcpServers/atlas.yaml",
      render: renderContinueYaml,
    },
    workspace: {
      kind: "managed-file",
      relativePath: ".continue/mcpServers/atlas.yaml",
      render: renderContinueYaml,
    },
  },
  {
    id: "zed",
    displayName: "Zed",
    kind: "ide",
    executable: "zed",
    user: json(
      (platform) => {
        if (platform === "linux") return ".config/zed/settings.json";
        if (platform === "darwin")
          return "Library/Application Support/Zed/settings.json";
        throw new Error(
          `Automatic Zed user configuration is not supported on ${platform}; use atlas agent print-config zed --scope user and configure Zed manually.`,
        );
      },
      ["context_servers"],
    ),
    workspace: json(".zed/settings.json", ["context_servers"]),
  },
  {
    id: "jetbrains",
    displayName: "JetBrains AI Assistant",
    kind: "ide",
    user: manual(
      "JetBrains AI Assistant exposes MCP configuration through Settings > Tools > AI Assistant > Model Context Protocol.",
    ),
    workspace: manual(
      "JetBrains AI Assistant exposes project MCP configuration through Settings > Tools > AI Assistant > Model Context Protocol.",
    ),
  },
  {
    id: "junie",
    displayName: "Junie",
    kind: "ide",
    user: json(".junie/mcp/mcp.json", ["mcpServers"]),
    workspace: json(".junie/mcp/mcp.json", ["mcpServers"]),
  },
  {
    id: "kiro",
    displayName: "Kiro",
    kind: "ide",
    executable: "kiro",
    user: json(".kiro/settings/mcp.json", ["mcpServers"]),
    workspace: json(".kiro/settings/mcp.json", ["mcpServers"]),
  },
  {
    id: "amazon-q",
    displayName: "Amazon Q Developer",
    kind: "ide",
    user: json(".aws/amazonq/default.json", ["mcpServers"]),
    workspace: json(".amazonq/default.json", ["mcpServers"]),
  },
] as const;

const integrationsById = new Map(
  AGENT_INTEGRATIONS.map((integration) => [integration.id, integration]),
);

export function getAgentIntegration(
  clientId: AgentClientId,
): AgentIntegrationDescriptor {
  const descriptor = integrationsById.get(clientId);
  if (descriptor === undefined)
    throw new Error(`Unknown agent client: ${clientId}.`);
  return descriptor;
}

export function isAgentClientId(value: string): value is AgentClientId {
  return integrationsById.has(value as AgentClientId);
}

function renderContinueYaml(server: ServerLaunchSpec): string {
  const args = server.args
    .map((arg) => `      - ${JSON.stringify(arg)}`)
    .join("\n");
  const env = Object.entries(server.env ?? {})
    .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return [
    "name: atlas",
    "version: 0.0.1",
    "schema: v1",
    "mcpServers:",
    "  - name: atlas",
    "    type: stdio",
    `    command: ${JSON.stringify(server.command)}`,
    ...(args.length === 0 ? ["    args: []"] : ["    args:", args]),
    ...(env.length === 0 ? [] : ["    env:", env]),
    "",
  ].join("\n");
}
