import { runAddRepoCommand } from "../commands/add-repo.command";
import { runAdoptionTemplateCommand } from "../commands/adoption-template.command";
import { runAgentCommand } from "../commands/agent.command";
import { runArtifactCommand } from "../commands/artifact.command";
import { runBuildCommand } from "../commands/build.command";
import { runCleanCommand } from "../commands/clean.command";
import { runDoctorCommand } from "../commands/doctor.command";
import { runEvalCommand } from "../commands/eval.command";
import { runHostsCommand } from "../commands/hosts.command";
import { runIndexCommand } from "../commands/index.command";
import { runInitCommand } from "../commands/init.command";
import { runInspectCommand } from "../commands/inspect.command";
import { runInstallSkillCommand } from "../commands/install-skill.command";
import { runListCommand } from "../commands/list.command";
import { runMcpCommand } from "../commands/mcp.command";
import { runNextCommand } from "../commands/next.command";
import { runPruneCommand } from "../commands/prune.command";
import { runRepoCommand } from "../commands/repo.command";
import { runSearchCommand } from "../commands/search.command";
import { runServeCommand } from "../commands/serve.command";
import { runSyncCommand } from "../commands/sync.command";
import type { CommandManifestEntry } from "./contracts";
import {
  addRepoOptions,
  adoptionTemplateOptions,
  agentSubcommandOptions,
  artifactInspectOptions,
  artifactVerifyOptions,
  buildOptions,
  cleanOptions,
  doctorOptions,
  evalOptions,
  globalOptions,
  hostAddOptions,
  hostPrioritizeOptions,
  hostRemoveOptions,
  indexOptions,
  inspectOptions,
  inspectRetrievalOptions,
  inspectTopologyOptions,
  installSkillOptions,
  listDocsOptions,
  listOptions,
  listRepoOptions,
  listSectionsOptions,
  listSkillsOptions,
  mcpOptions,
  pruneOptions,
  repoRemoveOptions,
  searchOptions,
  serveOptions,
  setupOptions,
  syncOptions,
} from "./options";

/** Creates the ordered Atlas command grammar for one display identity. */
export function createAtlasCommandManifest(
  identityName: string,
): readonly CommandManifestEntry[] {
  return [
    {
      name: "setup",
      description: "Create runtime config and directories",
      args: [],
      runner: (context) => runInitCommand(context, "setup"),
      options: setupOptions,
    },
    {
      name: "init",
      description: `Prepare ${identityName} docs publishing for this checkout`,
      args: [],
      runner: (context) => runInitCommand(context, "init"),
      options: setupOptions,
    },
    {
      name: "add-repo",
      description: "Legacy alias for repo add",
      args: ["[repo]"],
      runner: runAddRepoCommand,
      options: addRepoOptions,
      hidden: true,
    },
    {
      name: "next",
      description: `Recommend the next ${identityName} command for this state`,
      args: [],
      runner: runNextCommand,
      options: globalOptions,
    },
    {
      name: "adoption-template",
      description: "Generate copyable maintainer request text",
      args: ["[repo]"],
      runner: runAdoptionTemplateCommand,
      options: adoptionTemplateOptions,
    },
    {
      name: "sync",
      description: "Sync imported repositories",
      args: [],
      runner: runSyncCommand,
      options: syncOptions,
    },
    {
      name: "build",
      description: `Build repo-local ${identityName} artifact`,
      args: [],
      runner: runBuildCommand,
      options: buildOptions,
    },
    {
      name: "index",
      description: "Clone and index a repo locally only",
      args: ["<repo>"],
      runner: runIndexCommand,
      options: indexOptions,
    },
    {
      name: "serve",
      description: "Start HTTP server",
      args: [],
      runner: runServeCommand,
      options: serveOptions,
    },
    {
      name: "mcp",
      description: "Start MCP server over local corpus",
      args: [],
      runner: runMcpCommand,
      options: mcpOptions,
    },
    {
      name: "agent",
      description: "Manage Atlas MCP integrations for coding agents and IDEs",
      usage: "[options] <subcommand> [client]",
      allowExcessArguments: true,
      runner: runAgentCommand,
      options: globalOptions,
      visible: (runtime) => runtime.exposeIdentityOptions !== false,
      commands: [
        {
          name: "list",
          description: "List supported clients and adapter types",
          args: [],
          runner: runAgentCommand,
          options: agentSubcommandOptions.list,
        },
        {
          name: "detect",
          description: "Detect installed clients and managed scopes",
          args: [],
          runner: runAgentCommand,
          options: agentSubcommandOptions.detect,
        },
        {
          name: "install",
          description: "Install an Atlas MCP integration",
          args: ["[client]"],
          runner: runAgentCommand,
          options: agentSubcommandOptions.install,
        },
        {
          name: "remove",
          description: "Remove only Atlas-managed integration entries",
          args: ["[client]"],
          runner: runAgentCommand,
          options: agentSubcommandOptions.remove,
        },
        {
          name: "doctor",
          description: "Diagnose client version and integration state",
          args: ["[client]"],
          runner: runAgentCommand,
          options: agentSubcommandOptions.doctor,
        },
        {
          name: "print-config",
          description: "Print a client integration plan without applying it",
          args: ["<client>"],
          runner: runAgentCommand,
          options: agentSubcommandOptions["print-config"],
        },
      ],
    },
    {
      name: "inspect",
      description: "Inspect local corpus data",
      usage: "[options] <subcommand> [id]",
      allowExcessArguments: true,
      runner: runInspectCommand,
      options: inspectOptions,
      commands: [
        {
          name: "manifest",
          description: "Inspect manifest",
          args: [],
          runner: runInspectCommand,
          options: globalOptions,
        },
        {
          name: "freshness",
          description: "Inspect freshness",
          args: ["[repo]"],
          runner: runInspectCommand,
          options: globalOptions,
        },
        {
          name: "repo",
          description: "Inspect repo",
          args: ["[repo]"],
          runner: runInspectCommand,
          options: globalOptions,
        },
        {
          name: "topology",
          description: "Inspect topology",
          args: ["[repo]"],
          runner: runInspectCommand,
          options: inspectTopologyOptions,
        },
        {
          name: "retrieval",
          description: "Inspect retrieval",
          args: [],
          runner: runInspectCommand,
          options: inspectRetrievalOptions,
        },
        {
          name: "doc",
          description: "Inspect doc",
          args: ["<doc>"],
          runner: runInspectCommand,
          options: globalOptions,
        },
        {
          name: "section",
          description: "Inspect section",
          args: ["<section>"],
          runner: runInspectCommand,
          options: globalOptions,
        },
        {
          name: "skill",
          description: "Inspect skill",
          args: ["<skill>"],
          runner: runInspectCommand,
          options: globalOptions,
        },
      ],
    },
    {
      name: "install-skill",
      description: "Install a skill",
      args: ["[skillIds...]"],
      runner: runInstallSkillCommand,
      options: installSkillOptions,
    },
    {
      name: "clean",
      description: "Clean generated state",
      args: [],
      runner: runCleanCommand,
      options: cleanOptions,
    },
    {
      name: "prune",
      description: "Prune cached data",
      args: [],
      runner: runPruneCommand,
      options: pruneOptions,
    },
    {
      name: "search",
      description: "Search the local imported corpus",
      args: ["[query]"],
      runner: runSearchCommand,
      options: searchOptions,
    },
    {
      name: "doctor",
      description: `Check ${identityName} runtime health`,
      args: [],
      runner: runDoctorCommand,
      options: doctorOptions,
    },
    {
      name: "eval",
      description: "Run evaluation harness",
      args: [],
      runner: runEvalCommand,
      options: evalOptions,
    },
    {
      name: "artifact",
      description: `Verify and inspect ${identityName} knowledge bundles`,
      options: [],
      showHelpOnEmpty: true,
      commands: [
        {
          name: "verify",
          description: `Verify a ${identityName} artifact`,
          args: [],
          runner: runArtifactCommand,
          options: artifactVerifyOptions,
        },
        {
          name: "inspect",
          description: `Inspect a ${identityName} artifact`,
          args: [],
          runner: runArtifactCommand,
          options: artifactInspectOptions,
        },
      ],
    },
    {
      name: "hosts",
      description: "Manage GitHub/GHES hosts",
      options: [],
      showHelpOnEmpty: true,
      commands: [
        {
          name: "list",
          description: "Hosts list",
          args: [],
          runner: runHostsCommand,
          options: globalOptions,
        },
        {
          name: "add",
          description: "Hosts add",
          args: ["<name>"],
          runner: runHostsCommand,
          options: hostAddOptions,
        },
        {
          name: "remove",
          description: "Hosts remove",
          args: ["<name>"],
          runner: runHostsCommand,
          options: hostRemoveOptions,
        },
        {
          name: "set-default",
          description: "Hosts set-default",
          args: ["<name>"],
          runner: runHostsCommand,
          options: globalOptions,
        },
        {
          name: "prioritize",
          description: "Hosts prioritize",
          args: ["<name>"],
          runner: runHostsCommand,
          options: hostPrioritizeOptions,
        },
      ],
    },
    {
      name: "repo",
      description: "Manage added repositories",
      options: [],
      showHelpOnEmpty: true,
      commands: [
        {
          name: "add",
          description: `Add a repo's published ${identityName} docs`,
          args: ["[repo]"],
          runner: (context) =>
            runAddRepoCommand({
              ...context,
              positionals: context.positionals.slice(1),
            }),
          options: addRepoOptions,
        },
        {
          name: "list",
          description: "List added repositories",
          args: [],
          runner: runRepoCommand,
          options: globalOptions,
        },
        {
          name: "doctor",
          description: "Check one repository",
          args: ["[repo]"],
          runner: runRepoCommand,
          options: globalOptions,
        },
        {
          name: "remove",
          description: "Remove one repository",
          args: ["<repo>"],
          runner: runRepoCommand,
          options: repoRemoveOptions,
        },
        {
          name: "show",
          description: "Show one repository",
          args: ["[repo]"],
          runner: runRepoCommand,
          options: globalOptions,
        },
      ],
    },
    {
      name: "list",
      description: "List corpus objects",
      allowExcessArguments: true,
      runner: runListCommand,
      options: listOptions,
      commands: [
        {
          name: "repos",
          description: "List repos",
          args: [],
          runner: runListCommand,
          options: globalOptions,
        },
        {
          name: "packages",
          description: "List packages",
          args: [],
          runner: runListCommand,
          options: listRepoOptions,
        },
        {
          name: "modules",
          description: "List modules",
          args: [],
          runner: runListCommand,
          options: listRepoOptions,
        },
        {
          name: "docs",
          description: "List docs",
          args: [],
          runner: runListCommand,
          options: listDocsOptions,
        },
        {
          name: "sections",
          description: "List sections",
          args: [],
          runner: runListCommand,
          options: listSectionsOptions,
        },
        {
          name: "skills",
          description: "List skills",
          args: [],
          runner: runListCommand,
          options: listSkillsOptions,
        },
      ],
    },
  ];
}
