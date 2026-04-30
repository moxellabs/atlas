import {
	DEFAULT_ATLAS_IDENTITY_ROOT,
	type ResolvedIdentityRoot,
	resolveIdentityRoot,
} from "./artifact-root";

export interface McpIdentityProfile {
	name: string;
	title: string;
	resourcePrefix: string;
}

export interface IdentityProfile {
	identityRoot: string;
	artifactRoot: string;
	runtimeRoot: string;
	identityRootSource: ResolvedIdentityRoot["source"];
	customIdentityRoot: boolean;
	mcpIdentity: McpIdentityProfile;
}

export interface ResolveMcpIdentityInput {
	cliMcpName?: string | undefined;
	cliMcpTitle?: string | undefined;
	cliMcpResourcePrefix?: string | undefined;
	envMcpName?: string | undefined;
	envMcpTitle?: string | undefined;
	envMcpResourcePrefix?: string | undefined;
	configMcp?:
		| {
				name?: string | undefined;
				title?: string | undefined;
				resourcePrefix?: string | undefined;
		  }
		| undefined;
}

export const DEFAULT_MCP_IDENTITY: McpIdentityProfile = {
	name: "atlas-mcp",
	title: "ATLAS Local Knowledge MCP",
	resourcePrefix: "atlas",
};

const mcpIdentifierPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function validateMcpIdentifier(value: string, field: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${field} must not be empty`);
	}
	if (
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.includes("..")
	) {
		throw new Error(`${field} must be a lower-kebab identifier, not a path`);
	}
	if (!mcpIdentifierPattern.test(trimmed)) {
		throw new Error(`${field} must be a lower-kebab identifier`);
	}
	return trimmed;
}

export function resolveMcpIdentity(
	input: ResolveMcpIdentityInput = {},
): McpIdentityProfile {
	const name =
		input.cliMcpName ??
		input.envMcpName ??
		input.configMcp?.name ??
		DEFAULT_MCP_IDENTITY.name;
	const title =
		input.cliMcpTitle ??
		input.envMcpTitle ??
		input.configMcp?.title ??
		DEFAULT_MCP_IDENTITY.title;
	const resourcePrefix =
		input.cliMcpResourcePrefix ??
		input.envMcpResourcePrefix ??
		input.configMcp?.resourcePrefix ??
		DEFAULT_MCP_IDENTITY.resourcePrefix;
	return {
		name: validateMcpIdentifier(name, "identity.mcp.name"),
		title: title.trim(),
		resourcePrefix: validateMcpIdentifier(
			resourcePrefix,
			"identity.mcp.resourcePrefix",
		),
	};
}

export function resolveIdentityProfile(
	input: {
		cliIdentityRoot?: string | undefined;
		envIdentityRoot?: string | undefined;
		configIdentity?:
			| {
					root?: string | undefined;
					mcp?: ResolveMcpIdentityInput["configMcp"];
			  }
			| undefined;
		mcp?: ResolveMcpIdentityInput | undefined;
	} = {},
): IdentityProfile {
	const resolved = resolveIdentityRoot({
		cliIdentityRoot: input.cliIdentityRoot,
		envIdentityRoot: input.envIdentityRoot,
		configIdentityRoot: input.configIdentity?.root,
	});
	return {
		identityRoot: resolved.identityRoot,
		artifactRoot: resolved.artifactRoot,
		runtimeRoot: resolved.runtimeRoot,
		identityRootSource: resolved.source,
		customIdentityRoot: resolved.identityRoot !== DEFAULT_ATLAS_IDENTITY_ROOT,
		mcpIdentity: resolveMcpIdentity({
			...input.mcp,
			configMcp: input.mcp?.configMcp ?? input.configIdentity?.mcp,
		}),
	};
}
