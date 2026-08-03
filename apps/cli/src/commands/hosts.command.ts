import { type AtlasHostConfig, sortHostsByPriority } from "@atlas/config";
import { mutateAtlasConfig } from "../runtime/dependencies";
import { readBooleanOption, readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { renderSuccess } from "./render";

function positional(
	argv: readonly string[],
	index: number,
): string | undefined {
	return argv[index];
}

function hostFromFlags(
	context: CliCommandContext,
	name: string,
): AtlasHostConfig {
	const webUrl = readStringOption(context, "webUrl");
	const apiUrl = readStringOption(context, "apiUrl");
	const protocol = readStringOption(context, "protocol") as
		| "ssh"
		| "https"
		| undefined;
	const priorityInput = readStringOption(context, "priority") ?? "100";
	const priority = Number(priorityInput);
	if (!Number.isInteger(priority)) {
		throw new CliError(
			`Invalid host priority: ${priorityInput}. Expected an integer.`,
			{
				code: "CLI_HOST_PRIORITY_INVALID",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	if (!webUrl || !apiUrl || !protocol) {
		throw new CliError(
			"Missing host fields. Use --web-url, --api-url, --protocol, and --priority.",
			{ code: "CLI_HOST_FIELDS_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
	return {
		name: name.toLowerCase(),
		webUrl,
		apiUrl,
		protocol,
		priority,
		default: readBooleanOption(context, "default"),
	};
}

export async function runHostsCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const sub = context.positionals[0] ?? "list";
	const configPath = readStringOption(context, "config");
	const configOptions = {
		cwd: context.cwd,
		env: context.env,
		...(configPath === undefined ? {} : { configPath }),
	};
	if (sub === "list") {
		const result = await mutateAtlasConfig(configOptions, (config) => config);
		const hosts = sortHostsByPriority(result.config.hosts);
		return renderSuccess(
			context,
			"hosts",
			{ hosts },
			hosts.map(
				(h) =>
					`${h.name}\t${h.default ? "yes" : "no"}\t${h.priority}\t${h.protocol}\t${h.webUrl}\t${h.apiUrl}`,
			),
		);
	}
	const name = positional(context.positionals.slice(1), 0)?.toLowerCase();
	if (!name)
		throw new CliError("Missing host name.", {
			code: "CLI_HOST_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const written = await mutateAtlasConfig(configOptions, (config) => {
		let hosts = [...config.hosts];
		if (sub === "add") {
			if (hosts.some((h) => h.name === name))
				throw new CliError(`Host ${name} already exists.`, {
					code: "CLI_DUPLICATE_HOST",
					exitCode: EXIT_INPUT_ERROR,
				});
			const next = hostFromFlags(context, name);
			if (next.default) hosts = hosts.map((h) => ({ ...h, default: false }));
			hosts.push(next);
		} else if (sub === "remove") {
			const removing = hosts.find((h) => h.name === name);
			if (!removing)
				throw new CliError(`Unknown host ${name}.`, {
					code: "CLI_HOST_UNKNOWN",
					exitCode: EXIT_INPUT_ERROR,
				});
			const remaining = hosts.filter((h) => h.name !== name);
			if (
				removing.default &&
				remaining.length > 0 &&
				!readBooleanOption(context, "force")
			)
				throw new CliError(
					"Cannot remove default host while other hosts remain. Use --force.",
					{ code: "CLI_DEFAULT_HOST_REMOVE", exitCode: EXIT_INPUT_ERROR },
				);
			if (removing.default && remaining.length > 0) {
				const [first] = sortHostsByPriority(remaining);
				hosts = remaining.map((h) => ({
					...h,
					default: h.name === first?.name,
				}));
			} else hosts = remaining;
		} else if (sub === "set-default") {
			if (!hosts.some((h) => h.name === name))
				throw new CliError(`Unknown host ${name}.`, {
					code: "CLI_HOST_UNKNOWN",
					exitCode: EXIT_INPUT_ERROR,
				});
			hosts = hosts.map((h) => ({ ...h, default: h.name === name }));
		} else if (sub === "prioritize") {
			const priorityInput = readStringOption(context, "priority");
			if (priorityInput === undefined)
				throw new CliError("Missing priority.", {
					code: "CLI_PRIORITY_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			const priority = Number(priorityInput);
			if (!Number.isInteger(priority))
				throw new CliError(
					`Invalid priority: ${priorityInput}. Expected an integer.`,
					{
						code: "CLI_PRIORITY_INVALID",
						exitCode: EXIT_INPUT_ERROR,
					},
				);
			hosts = hosts.map((h) => (h.name === name ? { ...h, priority } : h));
		} else
			throw new CliError(`Unknown hosts subcommand: ${sub}.`, {
				code: "CLI_UNKNOWN_HOSTS_COMMAND",
				exitCode: EXIT_INPUT_ERROR,
			});
		return { ...config, hosts };
	});
	return renderSuccess(
		context,
		"hosts",
		{ hosts: sortHostsByPriority(written.config.hosts) },
		[`Hosts updated: ${written.configPath}`],
	);
}
