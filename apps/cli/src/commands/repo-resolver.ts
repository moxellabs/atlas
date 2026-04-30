import { resolve } from "node:path";
import {
	type AtlasConfig,
	type AtlasHostConfig,
	defaultHost,
	sortHostsByPriority,
} from "@atlas/config";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { runProcess } from "../utils/node-runtime";
import { readRepoLocalArtifactMetadata } from "./shared";

export type ParsedRepoInput =
	| {
			kind: "canonical-id";
			input: string;
			host: string;
			owner: string;
			name: string;
			repoId: string;
	  }
	| { kind: "shorthand"; input: string; owner: string; name: string }
	| {
			kind: "ssh-url" | "https-url";
			input: string;
			host: string;
			owner: string;
			name: string;
			repoId: string;
			remote: string;
	  }
	| { kind: "local-path"; input: string; path: string };

const part = "[a-z0-9][a-z0-9._-]*";
const hostPart = "[a-z0-9][a-z0-9.-]*[a-z0-9]";

function candidate(host: string, owner: string, name: string) {
	const clean = name.replace(/\.git$/i, "").toLowerCase();
	const h = host.toLowerCase();
	const o = owner.toLowerCase();
	return { host: h, owner: o, name: clean, repoId: `${h}/${o}/${clean}` };
}

export function parseRepoInput(input: string): ParsedRepoInput {
	const raw = input.trim();
	if (!raw) throw new Error("repo input required");
	if (
		raw === "." ||
		raw.startsWith("./") ||
		raw.startsWith("../") ||
		raw.startsWith("/") ||
		raw.startsWith("file://")
	) {
		return {
			kind: "local-path",
			input: raw,
			path: raw.startsWith("file://") ? new URL(raw).pathname : raw,
		};
	}
	const m = raw.match(
		new RegExp(`^git@(${hostPart}):(${part})/(${part})(?:\\.git)?$`, "i"),
	);
	if (m)
		return {
			kind: "ssh-url",
			input: raw,
			...candidate(m[1]!, m[2]!, m[3]!),
			remote: raw,
		};
	if (raw.startsWith("ssh://")) {
		const u = new URL(raw);
		const seg = u.pathname.replace(/^\/+/, "").split("/");
		if (seg.length !== 2 || !seg[0] || !seg[1])
			throw new Error("SSH URL must be host/owner/name");
		return {
			kind: "ssh-url",
			input: raw,
			...candidate(u.hostname, seg[0], seg[1]),
			remote: raw,
		};
	}
	if (raw.startsWith("https://") || raw.startsWith("http://")) {
		const u = new URL(raw);
		const seg = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
		if (seg.length !== 2 || !seg[0] || !seg[1])
			throw new Error("HTTPS URL must be host/owner/name");
		return {
			kind: "https-url",
			input: raw,
			...candidate(u.hostname, seg[0], seg[1]),
			remote: raw,
		};
	}
	const seg = raw.split("/");
	if (seg.length === 3)
		return {
			kind: "canonical-id",
			input: raw,
			...candidate(seg[0]!, seg[1]!, seg[2]!),
		};
	if (seg.length === 2)
		return {
			kind: "shorthand",
			input: raw,
			owner: seg[0]!.toLowerCase(),
			name: seg[1]!.replace(/\.git$/i, "").toLowerCase(),
		};
	throw new Error("Unsupported repo input");
}

function configuredHosts(config: AtlasConfig): AtlasHostConfig[] {
	return sortHostsByPriority(config.hosts);
}

function unknownHost(host: string, config: AtlasConfig): never {
	throw new CliError(
		`Unknown host ${host}. Run atlas hosts add ${host}. Configured hosts: ${
			configuredHosts(config)
				.map((h) => h.name)
				.join(", ") || "none"
		}.`,
		{ code: "CLI_REPO_HOST_UNKNOWN", exitCode: EXIT_INPUT_ERROR },
	);
}

async function readLocalArtifactMetadata(
	context: CliCommandContext,
	localPath: string,
): Promise<{ repoId: string } | undefined> {
	const metadata = await readRepoLocalArtifactMetadata(context, localPath);
	if (metadata === undefined) return undefined;
	const parts = metadata.repoId.split("/");
	return parts.length === 3 && parts.every((part) => part.length > 0)
		? { repoId: metadata.repoId }
		: undefined;
}

export interface ResolvedRepoInput {
	repoId: string;
	host: AtlasHostConfig;
	owner: string;
	name: string;
	remote?: string | undefined;
	localPath?: string | undefined;
	kind: ParsedRepoInput["kind"];
}

export async function resolveRepoInput(
	context: CliCommandContext,
	config: AtlasConfig,
	options: { input: string; host?: string; nonInteractive: boolean },
): Promise<ResolvedRepoInput> {
	const parsed = parseRepoInput(options.input);
	if (parsed.kind === "local-path") {
		const localPath = resolve(context.cwd, parsed.path);
		let remote = "";
		try {
			const result = await runProcess([
				"git",
				"-C",
				localPath,
				"config",
				"--get",
				"remote.origin.url",
			]);
			remote = result.exitCode === 0 ? result.stdout.trim() : "";
		} catch {}
		if (!remote) {
			const metadata = await readLocalArtifactMetadata(context, localPath);
			if (metadata !== undefined) {
				const [hostName, owner, name] = metadata.repoId.split("/") as [
					string,
					string,
					string,
				];
				const host = configuredHosts(config).find((h) => h.name === hostName);
				if (!host) unknownHost(hostName, config);
				return {
					repoId: metadata.repoId,
					host,
					owner,
					name,
					remote: `file://${localPath}`,
					localPath,
					kind: "local-path",
				};
			}
			throw new CliError(
				"Local path has no parseable origin remote. Use --repo-id with --remote, or --host with --owner and --name.",
				{ code: "CLI_REPO_ID_REQUIRED", exitCode: EXIT_INPUT_ERROR },
			);
		}
		const resolved = await resolveRepoInput(context, config, {
			input: remote,
			...(options.host === undefined ? {} : { host: options.host }),
			nonInteractive: options.nonInteractive,
		});
		return { ...resolved, localPath, remote, kind: "local-path" };
	}
	if (
		parsed.kind === "canonical-id" ||
		parsed.kind === "ssh-url" ||
		parsed.kind === "https-url"
	) {
		const host = configuredHosts(config).find((h) => h.name === parsed.host);
		if (!host) unknownHost(parsed.host, config);
		return {
			repoId: parsed.repoId,
			host,
			owner: parsed.owner,
			name: parsed.name,
			remote: "remote" in parsed ? parsed.remote : undefined,
			kind: parsed.kind,
		};
	}
	const hosts = configuredHosts(config);
	if (options.host) {
		const host = hosts.find((h) => h.name === options.host?.toLowerCase());
		if (!host) unknownHost(options.host.toLowerCase(), config);
		return {
			repoId: `${host.name}/${parsed.owner}/${parsed.name}`,
			host,
			owner: parsed.owner,
			name: parsed.name,
			kind: parsed.kind,
		};
	}
	if (hosts.length === 0)
		throw new CliError("No configured hosts. Configured hosts: none.", {
			code: "CLI_REPO_HOST_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const host = defaultHost(hosts) ?? hosts[0]!;
	return {
		repoId: `${host.name}/${parsed.owner}/${parsed.name}`,
		host,
		owner: parsed.owner,
		name: parsed.name,
		kind: parsed.kind,
	};
}
