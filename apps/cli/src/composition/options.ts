import type { OptionSpec } from "./contracts";

export const collect = (value: string, previous: string[] = []) => [
  ...previous,
  value,
];

export const globalOptions: readonly OptionSpec[] = [
  { flags: "--json", description: "Emit machine-readable JSON output" },
  { flags: "--verbose", description: "Emit verbose diagnostics" },
  { flags: "--quiet", description: "Suppress human informational output" },
  {
    flags: "--cwd <path>",
    description: "Run as if the command was started in this directory",
  },
  {
    flags: "--config <path>",
    description: "Use an explicit config file",
    parser: collect,
  },
  {
    flags: "--atlas-identity-root <relative-path>",
    description: "Use custom identity root for artifacts/runtime storage",
  },
  {
    flags: "--atlas-mcp-name <name>",
    description: "Use explicit MCP server identity name",
  },
  {
    flags: "--atlas-mcp-title <title>",
    description: "Use explicit MCP server display title",
  },
];

export const mcpOptions: readonly OptionSpec[] = [
  ...globalOptions,
  {
    flags: "--discovery-policy <policy>",
    description: "MCP guidance policy: neutral or prefer-local",
  },
  {
    flags: "--tool-profile <profile>",
    description: "MCP tool surface: agent or advanced",
  },
  {
    flags: "--remote-url <url>",
    description: "Proxy stdio to a remote HTTPS MCP endpoint",
  },
  {
    flags: "--auth-token-env <name>",
    description: "Read the remote bearer token from an environment variable",
  },
  {
    flags: "--auth-token-file <path>",
    description: "Read the remote bearer token from an owner-only file",
  },
];

const agentScopeOption: OptionSpec = {
  flags: "--scope <scope>",
  description: "Configuration scope: user or workspace",
};
const agentModeOption: OptionSpec = {
  flags: "--mode <mode>",
  description: "Integration mode: standard, discoverable, or prefer-local",
};
const agentDryRunOption: OptionSpec = {
  flags: "--dry-run",
  description: "Print the exact plan without changing client configuration",
};
const agentAllOption: OptionSpec = {
  flags: "--all",
  description: "Target every supported client",
};
const agentServerOptions: readonly OptionSpec[] = [
  {
    flags: "--server-command <command>",
    description: "Override the Atlas MCP server executable",
  },
  {
    flags: "--server-arg <arg>",
    description: "Append an Atlas MCP server argument",
    parser: collect,
  },
  {
    flags: "--remote-url <url>",
    description: "Install an HTTPS Atlas MCP proxy command",
  },
  {
    flags: "--auth-token-env <name>",
    description: "Remote bearer-token environment variable name",
  },
  {
    flags: "--auth-token-file <path>",
    description: "Owner-only remote bearer-token file path",
  },
];

export const agentSubcommandOptions = {
  list: globalOptions,
  detect: globalOptions,
  install: [
    ...globalOptions,
    agentScopeOption,
    agentModeOption,
    agentDryRunOption,
    {
      flags: "--detected",
      description: "Install every detected supported client",
    },
    ...agentServerOptions,
  ],
  remove: [
    ...globalOptions,
    agentScopeOption,
    agentDryRunOption,
    agentAllOption,
  ],
  doctor: [...globalOptions, agentScopeOption, agentAllOption],
  "print-config": [
    ...globalOptions,
    agentScopeOption,
    agentModeOption,
    ...agentServerOptions,
  ],
} as const satisfies Record<string, readonly OptionSpec[]>;

const promptOptions: readonly OptionSpec[] = [
  { flags: "--non-interactive", description: "Fail instead of prompting" },
];
const interactiveOptions: readonly OptionSpec[] = [
  { flags: "-i, --interactive", description: "Allow interactive prompts" },
];
const repoFilterOption: OptionSpec = {
  flags: "--repo <repo>",
  description: "Repository id",
};
const forceOption: OptionSpec = {
  flags: "--force",
  description: "Force operation",
};
const checkOption: OptionSpec = {
  flags: "--check",
  description: "Check without mutating or fail on detected changes",
};
const setupGlobalOptions = globalOptions.filter(
  (option) => !option.flags.startsWith("--atlas-mcp-"),
);

export const setupOptions: readonly OptionSpec[] = [
  ...setupGlobalOptions,
  ...promptOptions,
  forceOption,
  { flags: "--cache-dir <path>", description: "Runtime cache directory" },
  { flags: "--host <name>", description: "Host name" },
  { flags: "--repo-id <id>", description: "Repository id" },
  { flags: "--web-url <url>", description: "Host web URL" },
  { flags: "--api-url <url>", description: "Host API URL" },
  {
    flags: "--protocol <protocol>",
    description: "Clone protocol: ssh or https",
  },
  { flags: "--priority <number>", description: "Host priority" },
  { flags: "--ref <ref>", description: "Git ref" },
  {
    flags: "--ref-mode <mode>",
    description:
      "local-git ref mode: remote (requires origin ref) or current-checkout",
  },
];
export const addRepoOptions: readonly OptionSpec[] = [
  ...setupOptions,
  ...interactiveOptions,
  { flags: "--mode <mode>", description: "Import mode" },
  { flags: "--remote <url>", description: "Remote URL" },
  { flags: "--local-path <path>", description: "Local checkout path" },
  { flags: "--base-url <url>", description: "Base URL" },
  { flags: "--owner <owner>", description: "Repo owner" },
  { flags: "--name <name>", description: "Repo name" },
  { flags: "--token-env-var <name>", description: "Token env var" },
  {
    flags: "--package-glob <glob>",
    description: "Package glob",
    parser: collect,
  },
  {
    flags: "--package-manifest-file <path>",
    description: "Package manifest file",
    parser: collect,
  },
  { flags: "--template <name>", description: "Template" },
  {
    flags: "--missing-artifact-action <action>",
    description: "Missing artifact action",
  },
  { flags: "--local-only", description: "Build local-only index" },
  { flags: "--skip-missing-artifact", description: "Skip missing artifact" },
  {
    flags: "--maintainer-instructions",
    description: "Show maintainer instructions",
  },
  { flags: "--issue-pr-instructions", description: "Draft issue/PR text" },
  { flags: "--issue-only", description: "Issue only" },
  { flags: "--pr-only", description: "PR only" },
  { flags: "--maintainer-only", description: "Maintainer only" },
];
export const adoptionTemplateOptions: readonly OptionSpec[] = [
  ...globalOptions,
  ...promptOptions,
  { flags: "--repo-id <id>", description: "Repository id" },
  { flags: "--host <name>", description: "Host name" },
  { flags: "--owner <owner>", description: "Repo owner" },
  { flags: "--name <name>", description: "Repo name" },
  { flags: "--ref <ref>", description: "Git ref" },
  { flags: "--issue-only", description: "Issue only" },
  { flags: "--pr-only", description: "PR only" },
  { flags: "--maintainer-only", description: "Maintainer only" },
];
export const artifactInspectOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--path <path>", description: "Artifact path" },
  { flags: "--repo-id <id>", description: "Repository id" },
];
export const artifactVerifyOptions: readonly OptionSpec[] = [
  ...artifactInspectOptions,
  { flags: "--fresh", description: "Require fresh artifact" },
  { flags: "--ref <ref>", description: "Expected ref" },
];
export const hostAddOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--web-url <url>", description: "Host web URL" },
  { flags: "--api-url <url>", description: "Host API URL" },
  {
    flags: "--protocol <protocol>",
    description: "Clone protocol: ssh or https",
  },
  { flags: "--priority <number>", description: "Host priority" },
  { flags: "--default", description: "Set as default host" },
];
export const hostRemoveOptions: readonly OptionSpec[] = [
  ...globalOptions,
  forceOption,
];
export const hostPrioritizeOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--priority <number>", description: "Host priority" },
];
export const syncOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  checkOption,
];
export const doctorOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
];
export const repoRemoveOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--yes", description: "Confirm destructive operation" },
  { flags: "--dry-run", description: "Show what would change" },
];
export const listRepoOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
];
export const listDocsOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--package <package>", description: "Filter by package" },
  { flags: "--module <module>", description: "Filter by module" },
  { flags: "--kind <kind>", description: "Filter by kind" },
];
export const listSectionsOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--doc <doc>", description: "Filter by doc" },
];
export const listSkillsOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--package <package>", description: "Filter by package" },
  { flags: "--module <module>", description: "Filter by module" },
];
export const listOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--package <package>", description: "Filter by package" },
  { flags: "--module <module>", description: "Filter by module" },
  { flags: "--kind <kind>", description: "Filter by kind" },
];
export const buildOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  forceOption,
  { flags: "--mode <mode>", description: "Build mode" },
  { flags: "--profile <profile>", description: "Metadata profile" },
  { flags: "--path <path>", description: "Artifact path" },
  { flags: "--ref <ref>", description: "Git ref" },
  { flags: "--doc-id <id>", description: "Document id", parser: collect },
  { flags: "--package-id <id>", description: "Package id" },
  { flags: "--module-id <id>", description: "Module id" },
];
export const indexOptions: readonly OptionSpec[] = [
  ...globalOptions,
  ...promptOptions,
  forceOption,
  { flags: "--cache-dir <path>", description: "Runtime cache directory" },
  { flags: "--host <name>", description: "Host name" },
  { flags: "--repo-id <id>", description: "Repository id" },
  { flags: "--ref <ref>", description: "Git ref" },
];
export const serveOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--host <host>", description: "Bind host" },
  { flags: "--port <port>", description: "Bind port" },
  { flags: "--open", description: "Open browser" },
];
export const inspectTopologyOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--live", description: "Inspect live checkout topology" },
];
export const inspectRetrievalOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--query <query>", description: "Inspect retrieval plan" },
];
export const inspectOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--live", description: "Inspect live checkout topology" },
  { flags: "--query <query>", description: "Inspect retrieval plan" },
];
export const installSkillOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  {
    flags: "--target <target>",
    description:
      "Install target: codex, claude-code, cursor, or vscode-copilot",
  },
  { flags: "--scope <scope>", description: "Install scope: user or workspace" },
  { flags: "--workspace <path>", description: "Workspace" },
  { flags: "--package <package>", description: "Select skills by package" },
  { flags: "--module <module>", description: "Select skills by module" },
  { flags: "--all", description: "Install all skills" },
  { flags: "--dry-run", description: "Show what would be installed" },
  { flags: "--overwrite", description: "Overwrite existing instruction files" },
];
export const cleanOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--dry-run", description: "Show what would be cleaned" },
  { flags: "--all", description: "Clean all" },
];
export const pruneOptions: readonly OptionSpec[] = [
  ...globalOptions,
  {
    flags: "--older-than <duration>",
    description: "Prune entries older than duration (for example 30m, 12h, 7d)",
  },
  { flags: "--dry-run", description: "Show what would be pruned" },
];
export const searchOptions: readonly OptionSpec[] = [
  ...globalOptions,
  repoFilterOption,
  { flags: "--repo-id <id>", description: "Repository id" },
  {
    flags: "--profile <profile>",
    description:
      "Metadata profile (defaults to public; use 'any' or --all-profiles to search without a profile filter)",
  },
  {
    flags: "--all-profiles",
    description: "Search without the default public profile filter",
  },
  {
    flags: "--audience <audience>",
    description: "Filter by audience",
    parser: collect,
  },
  {
    flags: "--purpose <purpose>",
    description: "Filter by purpose",
    parser: collect,
  },
  {
    flags: "--visibility <visibility>",
    description: "Filter by visibility",
    parser: collect,
  },
];
export const evalOptions: readonly OptionSpec[] = [
  ...globalOptions,
  { flags: "--dataset <path>", description: "Dataset path" },
  {
    flags: "--kind <kind>",
    description: "Eval kind: retrieval or mcp-adoption",
  },
  { flags: "--trace <path>", description: "Trace input for mcp-adoption eval" },
  { flags: "--budget-tokens <number>", description: "Token budget" },
];
