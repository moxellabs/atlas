import { Command, CommanderError } from "commander";
import { runAddRepoCommand } from "./commands/add-repo.command";
import { runAdoptionTemplateCommand } from "./commands/adoption-template.command";
import { runArtifactCommand } from "./commands/artifact.command";
import { runBuildCommand } from "./commands/build.command";
import { runCleanCommand } from "./commands/clean.command";
import { runDoctorCommand } from "./commands/doctor.command";
import { runEvalCommand } from "./commands/eval.command";
import { runHostsCommand } from "./commands/hosts.command";
import { runIndexCommand } from "./commands/index.command";
import { runInitCommand } from "./commands/init.command";
import { runInspectCommand } from "./commands/inspect.command";
import { runInstallSkillCommand } from "./commands/install-skill.command";
import { runListCommand } from "./commands/list.command";
import { runMcpCommand } from "./commands/mcp.command";
import { runNextCommand } from "./commands/next.command";
import { runPruneCommand } from "./commands/prune.command";
import { runRepoCommand } from "./commands/repo.command";
import { runSearchCommand } from "./commands/search.command";
import { runServeCommand } from "./commands/serve.command";
import { runSyncCommand } from "./commands/sync.command";
import { CliConsole } from "./io/console";
import type { CliCommandContext, CliCommandResult } from "./runtime/types";
import { CliError, EXIT_INPUT_ERROR, toFailureResult } from "./utils/errors";

export interface Runtime {
	stdin: NodeJS.ReadStream;
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
	env: NodeJS.ProcessEnv;
	cwdFallback: string;
	exitCode?: number;
	mountDefaults?: Partial<Record<string, string>> | undefined;
}

export type Runner = (context: CliCommandContext) => Promise<CliCommandResult>;

/** Runs Atlas CLI against provided argv tokens. */
export async function runCli(
	argv: readonly string[] = process.argv.slice(2),
	streams: Partial<
		Pick<CliCommandContext, "stdin" | "stdout" | "stderr" | "env">
	> = {},
): Promise<number> {
	const runtime: Runtime = {
		stdin: streams.stdin ?? process.stdin,
		stdout: streams.stdout ?? process.stdout,
		stderr: streams.stderr ?? process.stderr,
		env: streams.env ?? process.env,
		cwdFallback: process.cwd(),
	};
	const json = argv.includes("--json");
	const verbose = argv.includes("--verbose");
	const consoleIo = new CliConsole(
		{ json, verbose, quiet: argv.includes("--quiet") },
		runtime.stdout,
		runtime.stderr,
	);

	try {
		const program = createAtlasProgram(runtime);
		const normalizedArgv =
			argv.length === 0 || argv[0] === "help" ? ["--help"] : [...argv];
		await program.parseAsync(normalizedArgv, { from: "user" });
		return runtime.exitCode ?? 0;
	} catch (error) {
		if (error instanceof CommanderError) {
			if (error.code === "commander.helpDisplayed") return 0;
			const unknownCommand = commandNameFromArgv(argv);
			const failure = toFailureResult(
				unknownCommand,
				new CliError(
					error.code === "commander.unknownCommand"
						? `Unknown command: ${unknownCommand}.`
						: cleanCommanderMessage(error.message),
					{
						code:
							error.code === "commander.unknownCommand"
								? "CLI_UNKNOWN_COMMAND"
								: "CLI_INPUT_ERROR",
						exitCode: EXIT_INPUT_ERROR,
					},
				),
				verbose,
			);
			if (json) await consoleIo.jsonFailure(failure);
			else {
				if (
					failure.error.code === "CLI_UNKNOWN_COMMAND" &&
					!argv.includes("--quiet")
				) {
					createAtlasProgram(runtime).outputHelp();
				}
				await consoleIo.error(failure.error.message);
			}
			return failure.exitCode;
		}
		const failure = toFailureResult(commandNameFromArgv(argv), error, verbose);
		if (json) await consoleIo.jsonFailure(failure);
		else await consoleIo.error(failure.error.message);
		return failure.exitCode;
	}
}

export interface AtlasProgramOptions {
	readonly name?: string;
	readonly description?: string;
	readonly helpPrefix?: string;
	readonly mountDefaults?: Partial<Record<string, string>> | undefined;
}

export function createAtlasProgram(
	runtime: Runtime,
	options: AtlasProgramOptions = {},
): Command {
	const program = createAtlasBaseCommand(runtime, {
		name: options.name ?? "atlas",
		description:
			options.description ??
			"Local-first documentation ingestion, retrieval, and MCP/server access for multi-repo engineering docs.",
		helpPrefix:
			options.helpPrefix ??
			"atlas <command>\nRuntime defaults: ~/.moxel/atlas\n",
		mountDefaults: options.mountDefaults,
	});
	return registerAtlasCommands(program, runtime);
}

export function registerAtlasCommands(
	program: Command,
	runtime: Runtime,
): Command {
	addCommand(
		program,
		runtime,
		"setup",
		"Create runtime config and directories",
		[],
		(c) => runInitCommand(c, "setup"),
		setupOptions,
	);
	addCommand(
		program,
		runtime,
		"init",
		"Prepare Atlas docs publishing for this checkout",
		[],
		(c) => runInitCommand(c, "init"),
		setupOptions,
	);
	addCommand(
		program,
		runtime,
		"add-repo",
		"Add a repo's published Atlas docs to local search",
		["[repo]"],
		runAddRepoCommand,
		addRepoOptions,
	);
	addCommand(
		program,
		runtime,
		"next",
		"Recommend the next Atlas command for this state",
		[],
		runNextCommand,
		globalOptions,
	);
	addCommand(
		program,
		runtime,
		"adoption-template",
		"Generate copyable maintainer request text",
		["[repo]"],
		runAdoptionTemplateCommand,
		adoptionTemplateOptions,
	);
	addCommand(
		program,
		runtime,
		"sync",
		"Sync imported repositories",
		[],
		runSyncCommand,
		syncOptions,
	);
	addCommand(
		program,
		runtime,
		"build",
		"Build repo-local Atlas artifact",
		[],
		runBuildCommand,
		buildOptions,
	);
	addCommand(
		program,
		runtime,
		"index",
		"Clone and index a repo locally only",
		["<repo>"],
		runIndexCommand,
		indexOptions,
	);
	addCommand(
		program,
		runtime,
		"serve",
		"Start HTTP server",
		[],
		runServeCommand,
		serveOptions,
	);
	addCommand(
		program,
		runtime,
		"mcp",
		"Start MCP server over local corpus",
		[],
		runMcpCommand,
		globalOptions,
	);
	const inspect = configureCommandIo(new Command("inspect"), runtime)
		.description("Inspect local corpus data")
		.usage("[options] <subcommand> [id]")
		.allowExcessArguments();
	for (const option of inspectOptions) {
		inspect.option(option.flags, option.description, option.parser as never);
	}
	inspect.action(async (...values: unknown[]) =>
		emitCommandResult(inspect, runtime, values, runInspectCommand),
	);
	for (const spec of [
		{ name: "manifest", args: [], options: globalOptions },
		{ name: "freshness", args: ["[repo]"], options: globalOptions },
		{ name: "repo", args: ["[repo]"], options: globalOptions },
		{ name: "topology", args: ["[repo]"], options: inspectTopologyOptions },
		{ name: "retrieval", args: [], options: inspectRetrievalOptions },
		{ name: "doc", args: ["<doc>"], options: globalOptions },
		{ name: "section", args: ["<section>"], options: globalOptions },
		{ name: "skill", args: ["<skill>"], options: globalOptions },
	] as const) {
		addSubcommand(
			inspect,
			runtime,
			spec.name,
			`Inspect ${spec.name}`,
			spec.args,
			runInspectCommand,
			spec.options,
		);
	}
	program.addCommand(inspect);
	addCommand(
		program,
		runtime,
		"install-skill",
		"Install a skill",
		["[skillIds...]"],
		runInstallSkillCommand,
		installSkillOptions,
	);
	addCommand(
		program,
		runtime,
		"clean",
		"Clean generated state",
		[],
		runCleanCommand,
		cleanOptions,
	);
	addCommand(
		program,
		runtime,
		"prune",
		"Prune cached data",
		[],
		runPruneCommand,
		pruneOptions,
	);
	addCommand(
		program,
		runtime,
		"search",
		"Search the local imported corpus",
		["[query]"],
		runSearchCommand,
		searchOptions,
	);
	addCommand(
		program,
		runtime,
		"doctor",
		"Check Atlas runtime health",
		[],
		runDoctorCommand,
		doctorOptions,
	);
	addCommand(
		program,
		runtime,
		"eval",
		"Run evaluation harness",
		[],
		runEvalCommand,
		evalOptions,
	);

	const artifact = configureCommandIo(new Command("artifact"), runtime)
		.description("Verify and inspect Atlas knowledge bundles")
		.action(() => artifact.outputHelp());
	addSubcommand(
		artifact,
		runtime,
		"verify",
		"Verify an Atlas artifact",
		[],
		runArtifactCommand,
		artifactVerifyOptions,
	);
	addSubcommand(
		artifact,
		runtime,
		"inspect",
		"Inspect an Atlas artifact",
		[],
		runArtifactCommand,
		artifactInspectOptions,
	);
	program.addCommand(artifact);

	const hosts = configureCommandIo(new Command("hosts"), runtime)
		.description("Manage GitHub/GHES hosts")
		.action(() => hosts.outputHelp());
	for (const spec of [
		{ name: "list", args: [], options: globalOptions },
		{ name: "add", args: ["<name>"], options: hostAddOptions },
		{ name: "remove", args: ["<name>"], options: hostRemoveOptions },
		{ name: "set-default", args: ["<name>"], options: globalOptions },
		{ name: "prioritize", args: ["<name>"], options: hostPrioritizeOptions },
	] as const) {
		addSubcommand(
			hosts,
			runtime,
			spec.name,
			`Hosts ${spec.name}`,
			spec.args,
			runHostsCommand,
			spec.options,
		);
	}
	program.addCommand(hosts);

	const repo = configureCommandIo(new Command("repo"), runtime)
		.description("Manage added repositories")
		.action(() => repo.outputHelp());
	for (const spec of [
		{
			name: "add",
			args: ["[repo]"],
			options: addRepoOptions,
			runner: (context: CliCommandContext) =>
				runAddRepoCommand({ ...context, argv: context.argv.slice(1) }),
			description: "Add a repo's published Atlas docs",
		},
		{
			name: "list",
			args: [],
			options: globalOptions,
			runner: runRepoCommand,
			description: "List added repositories",
		},
		{
			name: "doctor",
			args: ["[repo]"],
			options: globalOptions,
			runner: runRepoCommand,
			description: "Check one repository",
		},
		{
			name: "remove",
			args: ["<repo>"],
			options: repoRemoveOptions,
			runner: runRepoCommand,
			description: "Remove one repository",
		},
		{
			name: "show",
			args: ["[repo]"],
			options: globalOptions,
			runner: runRepoCommand,
			description: "Show one repository",
		},
	] as const) {
		addSubcommand(
			repo,
			runtime,
			spec.name,
			spec.description,
			spec.args,
			spec.runner,
			spec.options,
		);
	}
	program.addCommand(repo);

	const list = configureCommandIo(new Command("list"), runtime)
		.description("List corpus objects")
		.allowExcessArguments();
	for (const option of listOptions) {
		list.option(option.flags, option.description, option.parser as never);
	}
	list.action(async (...values: unknown[]) =>
		emitCommandResult(list, runtime, values, runListCommand),
	);
	for (const spec of [
		{ name: "repos", options: globalOptions },
		{ name: "packages", options: listRepoOptions },
		{ name: "modules", options: listRepoOptions },
		{ name: "docs", options: listDocsOptions },
		{ name: "sections", options: listSectionsOptions },
		{ name: "skills", options: listSkillsOptions },
	] as const) {
		addSubcommand(
			list,
			runtime,
			spec.name,
			`List ${spec.name}`,
			[],
			runListCommand,
			spec.options,
		);
	}
	program.addCommand(list);

	return program;
}

export function createAtlasBaseCommand(
	runtime: Runtime,
	options: Required<
		Pick<AtlasProgramOptions, "name" | "description" | "helpPrefix">
	> &
		Pick<AtlasProgramOptions, "mountDefaults">,
): Command {
	runtime.mountDefaults = options.mountDefaults;
	return new Command()
		.name(options.name)
		.description(options.description)
		.exitOverride()
		.configureOutput({
			writeOut: (str) => runtime.stdout.write(str),
			writeErr: (str) => runtime.stderr.write(str),
			outputError: () => undefined,
		})
		.option("--json", "Emit machine-readable JSON output")
		.option("--verbose", "Emit verbose diagnostics")
		.option("--quiet", "Suppress human informational output")
		.option("--cwd <path>", "Run as if Atlas was started in this directory")
		.option("--config <path>", "Use an explicit Atlas config file", collect)
		.option(
			"--atlas-identity-root <relative-path>",
			"Use custom identity root for artifacts/runtime storage",
		)
		.option("--atlas-mcp-name <name>", "Use explicit MCP server identity name")
		.option(
			"--atlas-mcp-title <title>",
			"Use explicit MCP server display title",
		)
		.addHelpText("beforeAll", options.helpPrefix)
		.addHelpText(
			"afterAll",
			`
Quick path:
  atlas setup                 one-time local runtime setup
  atlas repo add <repo>       use an existing repo artifact
  atlas init && atlas build   publish/update artifact from a checkout
  atlas index <path>          fallback local-only index, not primary onboarding
  atlas next                  inspect state and recommend the next command

Command groups:
  Start: setup, next
  Use repos: repo add, add-repo, repo list, repo show, sync
  Build artifacts: init, build, artifact verify, artifact inspect
  Search/query: search, list, serve, mcp
  Diagnose: doctor, repo doctor, inspect, clean, prune
`,
		);
}

function addCommand(
	program: Command,
	runtime: Runtime,
	name: string,
	description: string,
	args: readonly string[],
	runner: Runner,
	options: readonly OptionSpec[],
	usage?: string,
): void {
	const command = configureCommandIo(new Command(name), runtime)
		.description(description)
		.allowExcessArguments();
	if (usage !== undefined) command.usage(usage);
	for (const arg of args) command.argument(arg);
	for (const option of options)
		command.option(option.flags, option.description, option.parser as never);
	command.action(async (...values: unknown[]) =>
		emitCommandResult(command, runtime, values, runner),
	);
	program.addCommand(command);
}

function addSubcommand(
	parent: Command,
	runtime: Runtime,
	name: string,
	description: string,
	args: readonly string[],
	runner: Runner,
	options: readonly OptionSpec[],
): void {
	const command = configureCommandIo(new Command(name), runtime)
		.description(description)
		.allowExcessArguments();
	for (const arg of args) command.argument(arg);
	for (const option of options)
		command.option(option.flags, option.description, option.parser as never);
	command.action(async (...values: unknown[]) =>
		emitCommandResult(command, runtime, [name, ...values], runner),
	);
	parent.addCommand(command);
}

function configureCommandIo(command: Command, runtime: Runtime): Command {
	return command.exitOverride().configureOutput({
		writeOut: (str) => runtime.stdout.write(str),
		writeErr: (str) => runtime.stderr.write(str),
		outputError: () => undefined,
	});
}

async function emitCommandResult(
	command: Command,
	runtime: Runtime,
	values: readonly unknown[],
	runner: Runner,
): Promise<void> {
	const opts = command.optsWithGlobals<Record<string, unknown>>();
	const positionals = collectCommandPositionals(values, command.args);
	const context = buildContext(runtime, positionals, opts);
	const consoleIo = new CliConsole(
		context.output,
		context.stdout,
		context.stderr,
	);
	const result = await runner(context);
	runtime.exitCode = await emitResult(consoleIo, context.output.json, result);
	if (!result.ok) {
		throw new CommanderError(
			result.exitCode,
			"atlas.commandFailed",
			result.error.message,
		);
	}
}

export function collectCommandPositionals(
	values: readonly unknown[],
	commandArgs: readonly string[],
): string[] {
	const actionPositionals = values.filter(
		(value): value is string => typeof value === "string",
	);
	const duplicatePrefix = actionPositionals.every(
		(value, index) => commandArgs[index] === value,
	);
	const excessArgs = duplicatePrefix
		? commandArgs.slice(actionPositionals.length)
		: [];
	return [...actionPositionals, ...excessArgs];
}

function buildContext(
	runtime: Runtime,
	positionals: readonly string[],
	opts: Record<string, unknown>,
): CliCommandContext {
	const defaults = runtime.mountDefaults ?? {};
	const identityRoot =
		stringOpt(opts.atlasIdentityRoot) ?? defaults.ATLAS_IDENTITY_ROOT;
	const mcpName = stringOpt(opts.atlasMcpName) ?? defaults.ATLAS_MCP_NAME;
	const mcpTitle = stringOpt(opts.atlasMcpTitle) ?? defaults.ATLAS_MCP_TITLE;
	const mcpResourcePrefix = defaults.ATLAS_MCP_RESOURCE_PREFIX;
	const configPath = firstStringOpt(opts.config) ?? defaults.ATLAS_CONFIG;
	const commandArgv = [...positionals, ...optionsToArgv(opts)];
	return {
		argv: commandArgv,
		args: Object.fromEntries(
			positionals.map((value, index) => [
				index === 0 ? "repo" : `arg${index}`,
				value,
			]),
		),
		options: opts,
		cwd: stringOpt(opts.cwd) ?? runtime.cwdFallback,
		output: {
			json: Boolean(opts.json),
			verbose: Boolean(opts.verbose),
			quiet: Boolean(opts.quiet),
		},
		identityRoot,
		mcpName,
		mcpTitle,
		mcpResourcePrefix,
		stdin: runtime.stdin,
		stdout: runtime.stdout,
		stderr: runtime.stderr,
		env: {
			...runtime.env,
			...(defaults.ATLAS_CACHE_DIR === undefined ||
			runtime.env.ATLAS_CACHE_DIR !== undefined
				? {}
				: { ATLAS_CACHE_DIR: defaults.ATLAS_CACHE_DIR }),
			...(defaults.ATLAS_LOG_LEVEL === undefined ||
			runtime.env.ATLAS_LOG_LEVEL !== undefined
				? {}
				: { ATLAS_LOG_LEVEL: defaults.ATLAS_LOG_LEVEL }),
			...(defaults.ATLAS_CA_CERT_PATH === undefined ||
			runtime.env.ATLAS_CA_CERT_PATH !== undefined
				? {}
				: { ATLAS_CA_CERT_PATH: defaults.ATLAS_CA_CERT_PATH }),
			...(configPath === undefined ? {} : { ATLAS_CONFIG: configPath }),
			...(identityRoot === undefined
				? {}
				: { ATLAS_IDENTITY_ROOT: identityRoot }),
			...(mcpName === undefined ? {} : { ATLAS_MCP_NAME: mcpName }),
			...(mcpTitle === undefined ? {} : { ATLAS_MCP_TITLE: mcpTitle }),
			...(mcpResourcePrefix === undefined
				? {}
				: { ATLAS_MCP_RESOURCE_PREFIX: mcpResourcePrefix }),
		},
	};
}

async function emitResult(
	consoleIo: CliConsole,
	json: boolean,
	result: CliCommandResult,
): Promise<number> {
	if (!result.ok && json) await consoleIo.jsonFailure(result);
	return result.ok ? (result.exitCode ?? 0) : result.exitCode;
}

function commandNameFromArgv(argv: readonly string[]): string {
	const optionsWithValues = new Set([
		"--cwd",
		"--config",
		"--atlas-identity-root",
		"--atlas-mcp-name",
		"--atlas-mcp-title",
	]);
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) continue;
		if (optionsWithValues.has(arg)) {
			index++;
			continue;
		}
		if (arg.startsWith("--") && arg.includes("=")) continue;
		if (arg.startsWith("-")) continue;
		return arg;
	}
	return "help";
}

function cleanCommanderMessage(message: string): string {
	return message.replace(/^error:\s*/i, "");
}

function stringOpt(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function firstStringOpt(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const first = value.find((item) => typeof item === "string");
		return typeof first === "string" ? first : undefined;
	}
	return undefined;
}

function optionsToArgv(opts: Record<string, unknown>): string[] {
	const argv: string[] = [];
	for (const [key, value] of Object.entries(opts)) {
		if (
			[
				"json",
				"verbose",
				"quiet",
				"cwd",
				"atlasIdentityRoot",
				"atlasMcpName",
				"atlasMcpTitle",
			].includes(key)
		)
			continue;
		const flag = `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
		if (value === true) argv.push(flag);
		else if (typeof value === "string") argv.push(flag, value);
		else if (Array.isArray(value))
			for (const item of value) argv.push(flag, String(item));
	}
	return argv;
}

interface OptionSpec {
	flags: string;
	description: string;
	parser?: (value: string, previous: string[]) => string[];
}
const collect = (value: string, previous: string[] = []) => [
	...previous,
	value,
];
const globalOptions: OptionSpec[] = [
	{ flags: "--json", description: "Emit machine-readable JSON output" },
	{ flags: "--verbose", description: "Emit verbose diagnostics" },
	{ flags: "--quiet", description: "Suppress human informational output" },
	{
		flags: "--cwd <path>",
		description: "Run as if Atlas was started in this directory",
	},
	{
		flags: "--config <path>",
		description: "Use an explicit Atlas config file",
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
const promptOptions: OptionSpec[] = [
	{ flags: "--non-interactive", description: "Fail instead of prompting" },
];
const interactiveOptions: OptionSpec[] = [
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
const setupGlobalOptions: OptionSpec[] = globalOptions.filter(
	(option) => !option.flags.startsWith("--atlas-mcp-"),
);
const setupOptions: OptionSpec[] = [
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
const addRepoOptions: OptionSpec[] = [
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
const adoptionTemplateOptions: OptionSpec[] = [
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
const artifactInspectOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--path <path>", description: "Artifact path" },
	{ flags: "--repo-id <id>", description: "Repository id" },
];
const artifactVerifyOptions: OptionSpec[] = [
	...artifactInspectOptions,
	{ flags: "--fresh", description: "Require fresh artifact" },
	{ flags: "--ref <ref>", description: "Expected ref" },
];
const hostAddOptions: OptionSpec[] = [
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
const hostRemoveOptions: OptionSpec[] = [...globalOptions, forceOption];
const hostPrioritizeOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--priority <number>", description: "Host priority" },
];
const syncOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	checkOption,
];
const doctorOptions: OptionSpec[] = [...globalOptions, repoFilterOption];
const repoRemoveOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--yes", description: "Confirm destructive operation" },
	{ flags: "--dry-run", description: "Show what would change" },
];
const listRepoOptions: OptionSpec[] = [...globalOptions, repoFilterOption];
const listDocsOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--package <package>", description: "Filter by package" },
	{ flags: "--module <module>", description: "Filter by module" },
	{ flags: "--kind <kind>", description: "Filter by kind" },
];
const listSectionsOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--doc <doc>", description: "Filter by doc" },
];
const listSkillsOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--package <package>", description: "Filter by package" },
	{ flags: "--module <module>", description: "Filter by module" },
];
const listOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--package <package>", description: "Filter by package" },
	{ flags: "--module <module>", description: "Filter by module" },
	{ flags: "--kind <kind>", description: "Filter by kind" },
];
const buildOptions: OptionSpec[] = [
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
const indexOptions: OptionSpec[] = [
	...globalOptions,
	...promptOptions,
	forceOption,
	{ flags: "--cache-dir <path>", description: "Runtime cache directory" },
	{ flags: "--host <name>", description: "Host name" },
	{ flags: "--repo-id <id>", description: "Repository id" },
	{ flags: "--ref <ref>", description: "Git ref" },
];
const serveOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--host <host>", description: "Bind host" },
	{ flags: "--port <port>", description: "Bind port" },
	{ flags: "--open", description: "Open browser" },
];
const inspectTopologyOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--live", description: "Inspect live checkout topology" },
];
const inspectRetrievalOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--query <query>", description: "Inspect retrieval plan" },
];
const inspectOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--live", description: "Inspect live checkout topology" },
	{ flags: "--query <query>", description: "Inspect retrieval plan" },
];
const installSkillOptions: OptionSpec[] = [
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
const cleanOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--dry-run", description: "Show what would be cleaned" },
	{ flags: "--all", description: "Clean all" },
];
const pruneOptions: OptionSpec[] = [
	...globalOptions,
	{
		flags: "--older-than <duration>",
		description: "Prune entries older than duration (for example 30m, 12h, 7d)",
	},
	{ flags: "--dry-run", description: "Show what would be pruned" },
];
const searchOptions: OptionSpec[] = [
	...globalOptions,
	repoFilterOption,
	{ flags: "--repo-id <id>", description: "Repository id" },
	{
		flags: "--profile <profile>",
		description: "Metadata profile (for example public)",
	},
	{ flags: "--audience <audience>", description: "Filter by audience" },
	{ flags: "--purpose <purpose>", description: "Filter by purpose" },
	{ flags: "--visibility <visibility>", description: "Filter by visibility" },
];
const evalOptions: OptionSpec[] = [
	...globalOptions,
	{ flags: "--dataset <path>", description: "Dataset path" },
	{
		flags: "--kind <kind>",
		description: "Eval kind: retrieval or mcp-adoption",
	},
	{ flags: "--trace <path>", description: "Trace input for mcp-adoption eval" },
	{ flags: "--budget-tokens <number>", description: "Token budget" },
];

if (import.meta.main) {
	process.exitCode = await runCli();
}
