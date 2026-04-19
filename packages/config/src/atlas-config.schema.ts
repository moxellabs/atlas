import { BUILT_IN_DOC_METADATA_PROFILES } from "@atlas/core";
import { z } from "zod";

import { logLevelSchema } from "./env.schema";

const nonEmptyTrimmedString = z
	.string()
	.trim()
	.min(1, "must not be empty")
	.refine(
		(value) => value === value.trim(),
		"must not have surrounding whitespace",
	);

const uniqueStringArray = (fieldName: string) =>
	z
		.array(nonEmptyTrimmedString)
		.nonempty(`${fieldName} must contain at least one value`)
		.refine(
			(values) => new Set(values).size === values.length,
			`${fieldName} must not contain duplicates`,
		);

export interface CanonicalRepoIdParts {
	host: string;
	owner: string;
	name: string;
}

const repoIdSegmentPattern = /^[a-z0-9][a-z0-9._-]*$/;
const canonicalRepoIdMessage =
	"must be canonical repo ID: host/owner/name with lowercase safe segments";

export function parseCanonicalRepoId(repoId: string): CanonicalRepoIdParts {
	if (repoId.includes("://") || repoId.includes("\\") || /\s/.test(repoId)) {
		throw new Error(canonicalRepoIdMessage);
	}
	const segments = repoId.split("/");
	if (segments.length !== 3) {
		throw new Error(canonicalRepoIdMessage);
	}
	const [host, owner, name] = segments;
	for (const segment of segments) {
		if (
			segment === "" ||
			segment === "." ||
			segment === ".." ||
			!repoIdSegmentPattern.test(segment)
		) {
			throw new Error(canonicalRepoIdMessage);
		}
	}
	return { host: host as string, owner: owner as string, name: name as string };
}

export function repoPathSegments(repoId: string): [string, string, string] {
	const { host, owner, name } = parseCanonicalRepoId(repoId);
	return [host, owner, name];
}

export const repoIdSchema = nonEmptyTrimmedString.refine((value) => {
	try {
		parseCanonicalRepoId(value);
		return true;
	} catch {
		return false;
	}
}, canonicalRepoIdMessage);

export const docKindSchema = z.enum([
	"repo-doc",
	"package-doc",
	"module-doc",
	"skill-doc",
	"guide-doc",
	"reference-doc",
]);

export const authoritySchema = z.enum([
	"canonical",
	"preferred",
	"supplemental",
]);

const hostNamePattern =
	/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

const httpUrlSchema = z
	.string()
	.trim()
	.url("must be a valid URL")
	.refine((value) => {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	}, "must use http or https");

export const atlasHostConfigSchema = z.object({
	name: nonEmptyTrimmedString.refine(
		(value) => hostNamePattern.test(value),
		"must be a lowercase hostname",
	),
	webUrl: httpUrlSchema,
	apiUrl: httpUrlSchema,
	protocol: z.enum(["ssh", "https"]),
	priority: z.number().int(),
	default: z.boolean(),
});

export function sortHostsByPriority<
	T extends { priority: number; name: string },
>(hosts: readonly T[]): T[] {
	return [...hosts].sort(
		(left, right) =>
			left.priority - right.priority || left.name.localeCompare(right.name),
	);
}

export function defaultHost<T extends { default: boolean }>(
	hosts: readonly T[],
): T | undefined {
	return hosts.find((host) => host.default);
}

export const atlasServerConfigSchema = z
	.object({
		transport: z.enum(["stdio", "http"]).default("stdio"),
		port: z.number().int().min(1).max(65535).optional(),
		host: nonEmptyTrimmedString.optional(),
	})
	.superRefine((server, ctx) => {
		if (server.transport !== "stdio") {
			return;
		}

		if (server.host) {
			ctx.addIssue({
				code: "custom",
				message: "host is only valid when server transport is http",
				path: ["host"],
			});
		}

		if (server.port) {
			ctx.addIssue({
				code: "custom",
				message: "port is only valid when server transport is http",
				path: ["port"],
			});
		}
	});

export const atlasWorkspaceConfigSchema = z.object({
	packageGlobs: uniqueStringArray("packageGlobs"),
	packageManifestFiles: uniqueStringArray("packageManifestFiles"),
});

export const atlasDocVisibilitySchema = z.enum(["public", "internal"]);
export const atlasDocAudienceSchema = z.enum([
	"consumer",
	"contributor",
	"maintainer",
	"internal",
]);
export const atlasDocPurposeSchema = z.enum([
	"guide",
	"reference",
	"api",
	"architecture",
	"operations",
	"workflow",
	"planning",
	"implementation",
	"archive",
	"troubleshooting",
]);

export const atlasDocMetadataRuleMetadataSchema = z
	.object({
		title: nonEmptyTrimmedString.optional(),
		description: nonEmptyTrimmedString.optional(),
		audience: z.array(atlasDocAudienceSchema).nonempty().optional(),
		purpose: z.array(atlasDocPurposeSchema).nonempty().optional(),
		visibility: atlasDocVisibilitySchema.optional(),
		order: z.number().int().optional(),
	})
	.strict()
	.refine(
		(metadata) => Object.keys(metadata).length > 0,
		"metadata must not be empty",
	);

export const atlasDocMetadataRuleSchema = z.object({
	id: nonEmptyTrimmedString,
	match: z.object({
		include: uniqueStringArray("match.include"),
		exclude: z.array(nonEmptyTrimmedString).optional(),
	}),
	metadata: atlasDocMetadataRuleMetadataSchema,
	priority: z.number().int(),
});

export const atlasDocMetadataProfileSchema = z
	.object({
		description: nonEmptyTrimmedString.optional(),
		visibility: z.array(atlasDocVisibilitySchema).nonempty().optional(),
		audience: z.array(atlasDocAudienceSchema).nonempty().optional(),
		purpose: z.array(atlasDocPurposeSchema).nonempty().optional(),
		include: z.array(nonEmptyTrimmedString).optional(),
		exclude: z.array(nonEmptyTrimmedString).optional(),
	})
	.strict();

export const atlasDocsConfigSchema = z
	.object({
		metadata: z
			.object({
				rules: z
					.array(atlasDocMetadataRuleSchema)
					.default([])
					.refine(
						(rules) =>
							new Set(rules.map((rule) => rule.id)).size === rules.length,
						"docs metadata rule ids must be unique",
					),
				profiles: z
					.record(nonEmptyTrimmedString, atlasDocMetadataProfileSchema)
					.default({}),
			})
			.default({ rules: [], profiles: {} }),
	})
	.default({ metadata: { rules: [], profiles: {} } });

export const atlasGitRepoSourceConfigSchema = z.object({
	remote: nonEmptyTrimmedString,
	localPath: nonEmptyTrimmedString,
	ref: nonEmptyTrimmedString,
});

export const atlasGhesRepoSourceConfigSchema = z.object({
	baseUrl: z.string().trim().url("must be a valid URL"),
	owner: nonEmptyTrimmedString,
	name: nonEmptyTrimmedString,
	ref: nonEmptyTrimmedString,
	tokenEnvVar: nonEmptyTrimmedString.optional(),
});

export const atlasTopologyRuleSchema = z.object({
	id: nonEmptyTrimmedString,
	kind: docKindSchema,
	match: z.object({
		include: uniqueStringArray("match.include"),
		exclude: z.array(nonEmptyTrimmedString).optional(),
	}),
	ownership: z.object({
		attachTo: z.enum(["repo", "package", "module", "skill"]),
		deriveFromPath: z.boolean().optional(),
		packageRootPattern: nonEmptyTrimmedString.optional(),
		moduleRootPattern: nonEmptyTrimmedString.optional(),
		skillPattern: nonEmptyTrimmedString.optional(),
	}),
	authority: authoritySchema,
	priority: z.number().int(),
});

export const atlasRepoConfigSchema = z
	.object({
		repoId: repoIdSchema,
		mode: z.enum(["local-git", "ghes-api"]),
		priority: z.number().int().optional(),
		git: atlasGitRepoSourceConfigSchema.optional(),
		github: atlasGhesRepoSourceConfigSchema.optional(),
		workspace: atlasWorkspaceConfigSchema,
		topology: z
			.array(atlasTopologyRuleSchema)
			.nonempty("topology must contain at least one rule")
			.refine(
				(rules) => new Set(rules.map((rule) => rule.id)).size === rules.length,
				"topology rule ids must be unique within a repo",
			),
	})
	.superRefine((repo, ctx) => {
		if (repo.mode === "local-git") {
			if (!repo.git) {
				ctx.addIssue({
					code: "custom",
					message: "git is required when mode is local-git",
					path: ["git"],
				});
			}
			if (repo.github) {
				ctx.addIssue({
					code: "custom",
					message: "github must be absent when mode is local-git",
					path: ["github"],
				});
			}
		}

		if (repo.mode === "ghes-api") {
			if (!repo.github) {
				ctx.addIssue({
					code: "custom",
					message: "github is required when mode is ghes-api",
					path: ["github"],
				});
			}
			if (repo.git) {
				ctx.addIssue({
					code: "custom",
					message: "git must be absent when mode is ghes-api",
					path: ["git"],
				});
			}
		}
	});

const mcpIdentifierSchema = nonEmptyTrimmedString
	.refine(
		(value) =>
			!value.includes("/") &&
			!value.includes("\\") &&
			value !== "." &&
			value !== ".." &&
			!value.includes(".."),
		"must be a lower-kebab identifier, not a path",
	)
	.refine(
		(value) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value),
		"must be a lower-kebab identifier",
	);

export const atlasMcpIdentityConfigSchema = z.object({
	name: mcpIdentifierSchema.optional(),
	title: nonEmptyTrimmedString.optional(),
	resourcePrefix: mcpIdentifierSchema.optional(),
});

export const atlasIdentityConfigSchema = z.object({
	root: nonEmptyTrimmedString.optional(),
	mcp: atlasMcpIdentityConfigSchema.optional(),
});

export const atlasConfigSchema = z
	.object({
		version: z.literal(1),
		cacheDir: nonEmptyTrimmedString,
		corpusDbPath: nonEmptyTrimmedString,
		logLevel: logLevelSchema,
		server: atlasServerConfigSchema,
		hosts: z.array(atlasHostConfigSchema).default([
			{
				name: "github.com",
				webUrl: "https://github.com",
				apiUrl: "https://api.github.com",
				protocol: "ssh",
				priority: 100,
				default: true,
			},
		]),
		identity: atlasIdentityConfigSchema.optional(),
		docs: atlasDocsConfigSchema.optional(),
		repos: z.array(atlasRepoConfigSchema),
	})
	.strict()
	.superRefine((config, ctx) => {
		if (
			new Set(config.repos.map((repo) => repo.repoId)).size !==
			config.repos.length
		) {
			ctx.addIssue({
				code: "custom",
				message: "repoId values must be unique",
				path: ["repos"],
			});
		}
		if (
			new Set(config.hosts.map((host) => host.name)).size !==
			config.hosts.length
		) {
			ctx.addIssue({
				code: "custom",
				message: "host names must be unique",
				path: ["hosts"],
			});
		}
		config.docs ??= { metadata: { rules: [], profiles: {} } };
		config.docs.metadata.profiles = {
			...BUILT_IN_DOC_METADATA_PROFILES,
			...config.docs.metadata.profiles,
		};
		const defaults = config.hosts.filter((host) => host.default);
		if (config.hosts.length > 0 && defaults.length !== 1) {
			ctx.addIssue({
				code: "custom",
				message: "exactly one default host is required",
				path: ["hosts"],
			});
		}
	});

export type AtlasConfig = z.infer<typeof atlasConfigSchema>;
export type AtlasHostConfig = z.infer<typeof atlasHostConfigSchema>;
export type AtlasServerConfig = z.infer<typeof atlasServerConfigSchema>;
export type AtlasRepoConfig = z.infer<typeof atlasRepoConfigSchema>;
export type AtlasGitRepoSourceConfig = z.infer<
	typeof atlasGitRepoSourceConfigSchema
>;
export type AtlasGhesRepoSourceConfig = z.infer<
	typeof atlasGhesRepoSourceConfigSchema
>;
export type AtlasWorkspaceConfig = z.infer<typeof atlasWorkspaceConfigSchema>;
export type AtlasDocsConfig = z.infer<typeof atlasDocsConfigSchema>;
export type AtlasDocMetadataRule = z.infer<typeof atlasDocMetadataRuleSchema>;
export type AtlasDocMetadataProfile = z.infer<
	typeof atlasDocMetadataProfileSchema
>;
export type AtlasTopologyRule = z.infer<typeof atlasTopologyRuleSchema>;
export type AtlasIdentityConfig = z.infer<typeof atlasIdentityConfigSchema>;
export type AtlasMcpIdentityConfig = z.infer<
	typeof atlasMcpIdentityConfigSchema
>;
