export const DEFAULT_ATLAS_IDENTITY_ROOT = ".moxel/atlas";
export const DEFAULT_ATLAS_ARTIFACT_ROOT = DEFAULT_ATLAS_IDENTITY_ROOT;
export const DEFAULT_ATLAS_RUNTIME_ROOT = "~/.moxel/atlas";

export interface IdentityRootValidationResult {
	valid: boolean;
	value?: string;
	error?: string;
}

export interface ResolvedIdentityRoot {
	identityRoot: string;
	artifactRoot: string;
	runtimeRoot: string;
	customRootUsed: boolean;
	source: "cli" | "env" | "config" | "default";
}

export const IDENTITY_ROOT_ERROR =
	"identity root must be relative and cannot contain traversal";

export function normalizeIdentityRoot(input: string): string {
	return input
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+/g, "/")
		.replace(/\/+$/g, "");
}

export function validateIdentityRoot(
	input: string,
): IdentityRootValidationResult {
	const trimmed = input.trim();
	if (trimmed.length === 0) return { valid: false, error: IDENTITY_ROOT_ERROR };
	if (/^[A-Za-z]:[\\/]/.test(trimmed))
		return { valid: false, error: IDENTITY_ROOT_ERROR };
	const normalized = normalizeIdentityRoot(trimmed);
	if (
		normalized.length === 0 ||
		normalized === "." ||
		normalized.startsWith("/") ||
		normalized.split("/").some((segment) => segment === "..")
	) {
		return { valid: false, error: IDENTITY_ROOT_ERROR };
	}
	return { valid: true, value: normalized };
}

export function runtimeRootFromIdentityRoot(identityRoot: string): string {
	return identityRoot === DEFAULT_ATLAS_IDENTITY_ROOT
		? DEFAULT_ATLAS_RUNTIME_ROOT
		: `~/${identityRoot}`;
}

export function resolveIdentityRoot(input: {
	cliIdentityRoot?: string | undefined;
	envIdentityRoot?: string | undefined;
	configIdentityRoot?: string | undefined;
}): ResolvedIdentityRoot {
	const source =
		input.cliIdentityRoot !== undefined
			? "cli"
			: input.envIdentityRoot !== undefined
				? "env"
				: input.configIdentityRoot !== undefined
					? "config"
					: "default";
	const raw =
		input.cliIdentityRoot ??
		input.envIdentityRoot ??
		input.configIdentityRoot ??
		DEFAULT_ATLAS_IDENTITY_ROOT;
	const validation = validateIdentityRoot(raw);
	if (!validation.valid || validation.value === undefined) {
		throw new Error(validation.error ?? IDENTITY_ROOT_ERROR);
	}
	return {
		identityRoot: validation.value,
		artifactRoot: validation.value,
		runtimeRoot: runtimeRootFromIdentityRoot(validation.value),
		customRootUsed: validation.value !== DEFAULT_ATLAS_IDENTITY_ROOT,
		source,
	};
}

// Internal compatibility aliases only; public CLI/env/config names are identity-root.
export type ArtifactRootValidationResult = IdentityRootValidationResult;
export type ResolvedArtifactRoot = ResolvedIdentityRoot;
export const ARTIFACT_ROOT_ERROR = IDENTITY_ROOT_ERROR;
export const normalizeArtifactRoot = normalizeIdentityRoot;
export const validateArtifactRoot = validateIdentityRoot;
export function resolveArtifactRoot(input: {
	cliArtifactRoot?: string | undefined;
	envArtifactRoot?: string | undefined;
	configArtifactRoot?: string | undefined;
}): ResolvedArtifactRoot {
	return resolveIdentityRoot({
		cliIdentityRoot: input.cliArtifactRoot,
		envIdentityRoot: input.envArtifactRoot,
		configIdentityRoot: input.configArtifactRoot,
	});
}
