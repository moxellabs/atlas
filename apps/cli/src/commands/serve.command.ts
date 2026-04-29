import { buildCliDependencies } from "../runtime/dependencies";
import type {
	AtlasCliDependencies,
	CliCommandContext,
	CliCommandResult,
} from "../runtime/types";
import { openUrl } from "../utils/open-url";
import { readArgvString, renderSuccess } from "./shared";

/** Starts the local ATLAS server via the shared server runtime entrypoint. */
export async function runServeCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readArgvString(context.argv, "--config");
	const deps = await buildCliDependencies({
		cwd: context.cwd,
		env: context.env,
		...(configPath === undefined ? {} : { configPath }),
	});
	return runServeCommandWithDependencies(context, deps, openUrl);
}

/** Runs serve with injected dependencies for lifecycle tests. */
export async function runServeCommandWithDependencies(
	context: CliCommandContext,
	deps: Pick<AtlasCliDependencies, "server" | "close">,
	openBrowser: (url: string) => Promise<void>,
): Promise<CliCommandResult> {
	try {
		const host = readArgvString(context.argv, "--host");
		const portValue = readArgvString(context.argv, "--port");
		const server = await deps.server.start({
			...(host === undefined ? {} : { host }),
			...(portValue === undefined
				? {}
				: { port: Number.parseInt(portValue, 10) }),
		});
		const url = `http://${server.host}:${server.port}`;
		const openRequested = context.argv.includes("--open");
		const openResult = openRequested
			? await tryOpenUrl(url, openBrowser)
			: undefined;
		return renderSuccess(
			context,
			"serve",
			{
				url,
				host: server.host,
				port: server.port,
				dbPath: server.dbPath,
				repoCount: server.repoCount,
				openApiEnabled: server.openApiEnabled,
				mcpEnabled: server.mcpEnabled,
				...(openResult === undefined ? {} : { browserLaunch: openResult }),
			},
			[
				`Server listening on ${url}`,
				`DB: ${server.dbPath}`,
				...(openResult === undefined
					? []
					: [
							openResult.ok
								? "Opened browser."
								: `Browser launch failed: ${openResult.error}`,
						]),
			],
		);
	} finally {
		deps.close();
	}
}

async function tryOpenUrl(
	url: string,
	openBrowser: (url: string) => Promise<void>,
): Promise<{ ok: boolean; error?: string | undefined }> {
	try {
		await openBrowser(url);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Unknown browser launch failure.",
		};
	}
}
