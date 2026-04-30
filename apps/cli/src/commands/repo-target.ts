import { relative, resolve } from "node:path";
import {
	type AtlasConfig,
	defaultGithubHostConfig,
	parseCanonicalRepoId,
} from "@atlas/config";
import { canPrompt, createPrompts } from "../io/prompts";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { runProcess } from "../utils/node-runtime";
import { readArgvString, readRepoLocalArtifactMetadata } from "./shared";

export type RepoTargetSource =
	| "explicit"
	| "positional"
	| "bare-name"
	| "repo-metadata"
	| "cwd-config"
	| "git-origin"
	| "single-config";

export interface ResolvedRepoTarget {
	repoId: string;
	source: RepoTargetSource;
	reason: string;
	hostStatus?: "configured" | "builtin-github" | "unknown" | undefined;
	candidates?: string[] | undefined;
}

interface ResolveRepoTargetOptions {
	config: AtlasConfig;
	explicit?: string | undefined;
	positional?: string | undefined;
	command: string;
	nonInteractive?: boolean | undefined;
	allowSingleConfigured?: boolean | undefined;
}

interface Candidate {
	repoId: string;
	source: RepoTargetSource;
	reason: string;
	hostStatus?: ResolvedRepoTarget["hostStatus"];
}

export function readRepoTargetArg(
	argv: readonly string[],
	position = 0,
): { explicit?: string | undefined; positional?: string | undefined } {
	const explicit =
		readArgvString(argv, "--repo") ?? readArgvString(argv, "--repo-id");
	const positional = argv[position]?.startsWith("--")
		? undefined
		: argv[position];
	return { explicit, positional };
}

export async function resolveRepoTarget(
	context: CliCommandContext,
	options: ResolveRepoTargetOptions,
): Promise<ResolvedRepoTarget> {
	const checked = [
		"flags",
		"positional argument",
		"repo metadata",
		"cwd",
		"git origin",
		"config",
	];
	if (options.explicit !== undefined) {
		return canonicalOrThrow(
			options.explicit,
			"explicit",
			"explicit --repo/--repo-id",
			options.config,
		);
	}
	if (options.positional !== undefined) {
		return resolveInputTarget(context, options, options.positional);
	}

	const metadata = await readRepoArtifactMetadataFromCwd(context);
	if (metadata !== undefined) {
		return canonicalOrThrow(
			metadata.repoId,
			"repo-metadata",
			metadata.path,
			options.config,
		);
	}

	const cwdMatches = await configuredCwdMatches(context.cwd, options.config);
	if (cwdMatches.length === 1) return cwdMatches[0]!;
	if (cwdMatches.length > 1) {
		return chooseOrThrow(context, options, cwdMatches, "cwd");
	}

	const origin = await repoIdFromGitOrigin(context.cwd, options.config);
	if (origin !== undefined) return origin;

	if (
		options.allowSingleConfigured !== false &&
		options.config.repos.length === 1
	) {
		const repoId = options.config.repos[0]!.repoId;
		return canonicalOrThrow(
			repoId,
			"single-config",
			"only configured repository",
			options.config,
		);
	}

	throw new CliError(
		`${options.command} requires a repo target. Atlas checked ${checked.join(", ")} and could not infer one. Run from a configured checkout, pass a bare repo name when unique (for example: atlas ${options.command} my-repo), or use --repo host/owner/name.`,
		{
			code: "CLI_REPO_TARGET_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
			details: { checked },
		},
	);
}

async function resolveInputTarget(
	context: CliCommandContext,
	options: ResolveRepoTargetOptions,
	input: string,
): Promise<ResolvedRepoTarget> {
	if (input.includes("/")) {
		return canonicalOrThrow(
			input,
			"positional",
			"canonical repo id",
			options.config,
		);
	}
	const matches = options.config.repos
		.filter((repo) => repo.repoId.split("/").at(-1) === input)
		.map((repo) => ({
			repoId: repo.repoId,
			source: "bare-name" as const,
			reason: `bare repo name matched ${input}`,
			hostStatus: "configured" as const,
		}));
	if (matches.length === 1) return matches[0]!;
	if (matches.length > 1)
		return chooseOrThrow(context, options, matches, input);
	throw new CliError(
		`No configured repository matched bare name ${input}. Use a full repo id such as host/owner/${input}.`,
		{
			code: "CLI_REPO_TARGET_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
			details: { input, candidates: [] },
		},
	);
}

async function chooseOrThrow(
	context: CliCommandContext,
	options: ResolveRepoTargetOptions,
	matches: Candidate[],
	input: string,
): Promise<ResolvedRepoTarget> {
	const candidates = matches.map((match) => match.repoId).sort();
	if (canPrompt(context, { nonInteractive: options.nonInteractive === true })) {
		const prompts = createPrompts();
		const repoId = await prompts.select(
			`Multiple repositories match ${input}. Choose one`,
			candidates.map((candidate) => ({ label: candidate, value: candidate })),
		);
		const match = matches.find((candidate) => candidate.repoId === repoId)!;
		return { ...match, candidates };
	}
	throw new CliError(
		`Multiple repositories match ${input}: ${candidates.join(", ")}. Re-run with --repo host/owner/name to disambiguate.`,
		{
			code: "CLI_REPO_TARGET_AMBIGUOUS",
			exitCode: EXIT_INPUT_ERROR,
			details: { input, candidates },
		},
	);
}

function canonicalOrThrow(
	input: string,
	source: RepoTargetSource,
	reason: string,
	config: AtlasConfig,
): ResolvedRepoTarget {
	try {
		const parsed = parseCanonicalRepoId(input);
		const hostStatus = hostStatusFor(parsed.host, config);
		return {
			repoId: `${parsed.host}/${parsed.owner}/${parsed.name}`,
			source,
			reason,
			hostStatus,
		};
	} catch (error) {
		if (error instanceof CliError) throw error;
		throw new CliError(
			"Repository target must be host/owner/name or a unique bare repo name.",
			{
				code: "CLI_REPO_TARGET_INVALID",
				exitCode: EXIT_INPUT_ERROR,
				details: { input },
			},
		);
	}
}

function hostStatusFor(
	host: string,
	config: AtlasConfig,
): ResolvedRepoTarget["hostStatus"] {
	if (config.hosts.some((entry) => entry.name === host)) return "configured";
	if (host === defaultGithubHostConfig().name) return "builtin-github";
	return "unknown";
}

async function readRepoArtifactMetadataFromCwd(
	context: CliCommandContext,
): Promise<{ repoId: string; path: string } | undefined> {
	const roots = new Set<string>([context.cwd]);
	const gitRoot = await gitOutput(context.cwd, [
		"rev-parse",
		"--show-toplevel",
	]);
	if (gitRoot !== undefined) roots.add(gitRoot);
	for (const root of roots) {
		const metadata = await readRepoLocalArtifactMetadata(context, root);
		if (metadata !== undefined) return metadata;
	}
	return undefined;
}

async function configuredCwdMatches(
	cwd: string,
	config: AtlasConfig,
): Promise<Candidate[]> {
	const roots = new Set<string>([resolve(cwd)]);
	const gitRoot = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
	if (gitRoot !== undefined) roots.add(resolve(gitRoot));
	return config.repos
		.filter((repo) => repo.mode === "local-git" && repo.git?.localPath)
		.filter((repo) => {
			const localPath = resolve(cwd, repo.git!.localPath);
			return [...roots].some(
				(root) =>
					sameOrInside(root, localPath) ||
					sameOrInside(resolve(cwd), localPath),
			);
		})
		.map((repo) => ({
			repoId: repo.repoId,
			source: "cwd-config" as const,
			reason: `cwd matches configured localPath ${repo.git?.localPath}`,
			hostStatus: "configured" as const,
		}));
}

function sameOrInside(path: string, parent: string): boolean {
	const rel = relative(parent, path);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

async function repoIdFromGitOrigin(
	cwd: string,
	config: AtlasConfig,
): Promise<Candidate | undefined> {
	const remote = await gitOutput(cwd, ["config", "--get", "remote.origin.url"]);
	if (remote === undefined) return undefined;
	const parsed = parseGitRemote(remote);
	if (parsed === undefined) return undefined;
	const status = hostStatusFor(parsed.host, config);
	if (status === "unknown") {
		throw new CliError(
			`Git origin host ${parsed.host} is not configured. GitHub.com works by default; for GHES run atlas hosts add ${parsed.host} --web-url https://${parsed.host} --api-url https://${parsed.host}/api/v3 --protocol ssh.`,
			{
				code: "CLI_REPO_HOST_UNKNOWN",
				exitCode: EXIT_INPUT_ERROR,
				details: {
					host: parsed.host,
					repoId: `${parsed.host}/${parsed.owner}/${parsed.name}`,
					checked: ["git origin"],
				},
			},
		);
	}
	return {
		repoId: `${parsed.host}/${parsed.owner}/${parsed.name}`,
		source: "git-origin",
		reason: `parsed remote.origin.url ${remote}`,
		hostStatus: status,
	};
}

function parseGitRemote(
	remote: string,
): { host: string; owner: string; name: string } | undefined {
	const normalize = (host: string, owner: string, name: string) => ({
		host: host.toLowerCase(),
		owner: owner.toLowerCase(),
		name: name.replace(/\.git$/i, "").toLowerCase(),
	});
	const ssh = remote.match(/^git@([^:]+):([^/]+)\/(.+)$/i);
	if (ssh) return normalize(ssh[1]!, ssh[2]!, ssh[3]!);
	if (remote.startsWith("http://") || remote.startsWith("https://")) {
		try {
			const url = new URL(remote);
			const [owner, name] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
			if (owner && name) return normalize(url.hostname, owner, name);
		} catch {}
	}
	return undefined;
}

async function gitOutput(
	cwd: string,
	args: readonly string[],
): Promise<string | undefined> {
	try {
		const { exitCode, stdout } = await runProcess(["git", ...args], { cwd });
		if (exitCode !== 0) return undefined;
		const output = stdout.trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}
