import type { AtlasRunningServer } from "../../../server/src/start-server";
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
	waitForShutdown: () => Promise<void> = waitForProcessShutdownSignal,
): Promise<CliCommandResult> {
	let server: AtlasRunningServer | undefined;
	try {
		const host = readArgvString(context.argv, "--host");
		const portValue = readArgvString(context.argv, "--port");
		server = await deps.server.start({
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

		if (!context.output.json && !context.output.quiet) {
			await writeStdoutLine(context.stdout, `Server listening on ${url}`);
			await writeStdoutLine(context.stdout, `DB: ${server.dbPath}`);
			if (openResult !== undefined) {
				await writeStdoutLine(
					context.stdout,
					openResult.ok
						? "Opened browser."
						: `Browser launch failed: ${openResult.error}`,
				);
			}
		}

		// Keep the process alive until interrupt. Tests inject an immediate wait.
		await waitForShutdown();

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
		try {
			await server?.stop();
		} finally {
			deps.close();
		}
	}
}

async function waitForProcessShutdownSignal(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const shutdown = () => {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		resolve();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	await promise;
}

function writeStdoutLine(
	stdout: NodeJS.WriteStream,
	line: string,
): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	stdout.write(`${line}\n`, (error) => {
		if (error) {
			reject(error);
			return;
		}
		resolve();
	});
	return promise;
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
