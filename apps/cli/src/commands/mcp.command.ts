import { resolveIdentityProfile } from "@atlas/config";
import type { AtlasMcpServer } from "@atlas/mcp";
import { createAtlasMcpServer, createStdioTransport } from "@atlas/mcp";

import { buildCliDependencies } from "../runtime/dependencies";
import type {
	AtlasCliDependencies,
	CliCommandContext,
	CliCommandResult,
} from "../runtime/types";
import { createCliConsole, readArgvString } from "./shared";

type StdioTransport = ReturnType<typeof createStdioTransport>;
type McpRuntimeDependencies = Pick<
	AtlasCliDependencies,
	"db" | "sourceDiffProvider" | "close"
> &
	Partial<Pick<AtlasCliDependencies, "config">>;

interface McpCommandRuntime {
	createServer(
		deps: Pick<AtlasCliDependencies, "db" | "sourceDiffProvider">,
		identity: ReturnType<typeof resolveIdentityProfile>["mcpIdentity"],
	): AtlasMcpServer;
	createTransport(context: CliCommandContext): StdioTransport;
}

const defaultRuntime: McpCommandRuntime = {
	createServer(deps, identity) {
		return createAtlasMcpServer({
			db: deps.db,
			identity,
			sourceDiffProvider: deps.sourceDiffProvider,
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
	const configPath = readArgvString(context.argv, "--config");
	const deps = await buildCliDependencies({
		cwd: context.cwd,
		env: context.env,
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
						envMcpName: deps.config.env.ATLAS_MCP_NAME,
						envMcpTitle: deps.config.env.ATLAS_MCP_TITLE,
					},
				}).mcpIdentity
			: resolveIdentityProfile({
					mcp: {
						cliMcpName: context.mcpName,
						cliMcpTitle: context.mcpTitle,
						envMcpName: context.env.ATLAS_MCP_NAME,
						envMcpTitle: context.env.ATLAS_MCP_TITLE,
					},
				}).mcpIdentity;
	const server = runtime.createServer(deps, identity);
	const transport = runtime.createTransport(context);
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
		context.stdin.off("end", closeTransport);
		context.stdin.off("close", closeTransport);
		deps.close();
	}
}
