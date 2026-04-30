import { validateIdentityRoot, validateMcpIdentifier } from "@atlas/config";
import type { Command } from "commander";
import { createAtlasProgram, type Runtime } from "./index";

export type AtlasMountConfig = {
	/** Commander namespace under enterprise CLI, e.g. `userCli acme ...`. */
	namespace: string;
	/** Existing Atlas identity root. Relative path only; same validation as current CLI/config. */
	identityRoot?: string;
	mcp?: {
		/** Existing MCP server identity name; lower-kebab identifier. */
		name?: string;
		/** Existing MCP server display title. */
		title?: string;
		/** Existing MCP resource/skill alias prefix; config-only today. */
		resourcePrefix?: string;
	};
	defaults?: {
		config?: string;
		cacheDir?: string;
		logLevel?: "debug" | "info" | "warn" | "error";
		caCertPath?: string;
	};
};

export function createAtlasCommand(config: AtlasMountConfig): Command {
	const runtime: Runtime = {
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr,
		env: process.env,
		cwdFallback: process.cwd(),
	};
	const defaults = mountDefaults(config);
	return createAtlasProgram(runtime, {
		name: validateNamespace(config.namespace),
		description:
			"Mounted Atlas command tree for local-first documentation ingestion, retrieval, and MCP/server access.",
		helpPrefix: `${config.namespace} <command>\nRuntime defaults: ${defaults.ATLAS_IDENTITY_ROOT ?? defaults.ATLAS_CACHE_DIR ?? "configured by host CLI"}\n`,
		mountDefaults: defaults,
	});
}

export function attachAtlas(
	program: Command,
	config: AtlasMountConfig,
): Command {
	program.addCommand(createAtlasCommand(config));
	return program;
}

function validateNamespace(namespace: string): string {
	const trimmed = namespace.trim();
	if (trimmed.length === 0) {
		throw new Error("namespace must not be empty");
	}
	if (/\s/.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("namespace must be a single command segment");
	}
	return trimmed;
}

function mountDefaults(
	config: AtlasMountConfig,
): Partial<Record<string, string>> {
	const defaults: Partial<Record<string, string>> = {};
	if (config.identityRoot !== undefined) {
		const validation = validateIdentityRoot(config.identityRoot);
		if (!validation.valid || validation.value === undefined) {
			throw new Error(
				validation.error ??
					"identity root must be relative and cannot contain traversal",
			);
		}
		defaults.ATLAS_IDENTITY_ROOT = validation.value;
	}
	if (config.mcp?.name !== undefined) {
		defaults.ATLAS_MCP_NAME = validateMcpIdentifier(
			config.mcp.name,
			"identity.mcp.name",
		);
	}
	if (config.mcp?.title !== undefined) {
		defaults.ATLAS_MCP_TITLE = config.mcp.title.trim();
	}
	if (config.mcp?.resourcePrefix !== undefined) {
		defaults.ATLAS_MCP_RESOURCE_PREFIX = validateMcpIdentifier(
			config.mcp.resourcePrefix,
			"identity.mcp.resourcePrefix",
		);
	}
	if (config.defaults?.config !== undefined)
		defaults.ATLAS_CONFIG = config.defaults.config;
	if (config.defaults?.cacheDir !== undefined)
		defaults.ATLAS_CACHE_DIR = config.defaults.cacheDir;
	if (config.defaults?.logLevel !== undefined)
		defaults.ATLAS_LOG_LEVEL = config.defaults.logLevel;
	if (config.defaults?.caCertPath !== undefined)
		defaults.ATLAS_CA_CERT_PATH = config.defaults.caCertPath;
	return defaults;
}
