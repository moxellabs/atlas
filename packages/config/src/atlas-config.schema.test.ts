import { describe, expect, test } from "bun:test";

import {
	parseCanonicalRepoId,
	repoIdSchema,
	repoPathSegments,
} from "./atlas-config.schema";

describe("canonical repo IDs", () => {
	test("parses host-aware repo IDs", () => {
		expect(parseCanonicalRepoId("github.mycorp.com/platform/docs")).toEqual({
			host: "github.mycorp.com",
			owner: "platform",
			name: "docs",
		});
		expect(repoPathSegments("github.com/platform/docs")).toEqual([
			"github.com",
			"platform",
			"docs",
		]);
		expect(
			repoIdSchema.safeParse("github.mycorp.com/platform/docs").success,
		).toBe(true);
	});

	test("rejects non-canonical repo IDs", () => {
		for (const value of [
			"platform/docs",
			"github.com/a/b/c",
			"github.com//docs",
			"github.com/platform/Docs",
			"github.com/platform/../docs",
			"https://github.com/platform/docs",
			"github.com/platform docs/repo",
			"github.com\\platform\\docs",
		]) {
			expect(repoIdSchema.safeParse(value).success).toBe(false);
			expect(() => parseCanonicalRepoId(value)).toThrow(
				"must be canonical repo ID",
			);
		}
	});
});

describe("host config", () => {
	const config = () => ({
		version: 1,
		cacheDir: ".cache",
		corpusDbPath: ".cache/corpus.db",
		logLevel: "warn",
		server: { transport: "stdio" },
		hosts: [
			{
				name: "github.com",
				webUrl: "https://github.com",
				apiUrl: "https://api.github.com",
				protocol: "ssh",
				priority: 100,
				default: true,
			},
		],
		repos: [],
	});

	test("accepts default github host", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		const parsed = atlasConfigSchema.parse(config());
		expect(parsed.hosts[0]?.webUrl).toBe("https://github.com");
		expect(parsed.hosts[0]?.apiUrl).toBe("https://api.github.com");
	});

	test("accepts identity root", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		const parsed = atlasConfigSchema.parse({
			...config(),
			identity: { root: ".acme/knowledge" },
		});
		expect(parsed.identity?.root).toBe(".acme/knowledge");
	});

	test("rejects old whiteLabel artifactRoot", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		const parsed = atlasConfigSchema.safeParse({
			...config(),
			whiteLabel: { artifactRoot: ".acme/knowledge" },
		});
		expect(parsed.success).toBe(false);
	});

	test("rejects invalid hosts", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		expect(
			atlasConfigSchema.safeParse({
				...config(),
				hosts: [...config().hosts, { ...config().hosts[0], priority: 200 }],
			}).success,
		).toBe(false);
		expect(
			atlasConfigSchema.safeParse({
				...config(),
				hosts: [{ ...config().hosts[0], default: false }],
			}).success,
		).toBe(false);
		expect(
			atlasConfigSchema.safeParse({
				...config(),
				hosts: [{ ...config().hosts[0], name: "https://github.com" }],
			}).success,
		).toBe(false);
		expect(
			atlasConfigSchema.safeParse({
				...config(),
				hosts: [{ ...config().hosts[0], name: "GitHub.com" }],
			}).success,
		).toBe(false);
	});
});

describe("docs metadata profiles", () => {
	const config = () => ({
		version: 1,
		cacheDir: ".cache",
		corpusDbPath: ".cache/corpus.db",
		logLevel: "warn",
		server: { transport: "stdio" },
		repos: [],
	});

	test("accepts metadata rules and merges built-in profiles", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		const parsed = atlasConfigSchema.parse({
			...config(),
			docs: {
				metadata: {
					rules: [
						{
							id: "planning",
							match: { include: [".planning/**"] },
							metadata: { visibility: "internal", audience: ["internal"], purpose: ["planning"] },
							priority: 100,
						},
					],
					profiles: {},
				},
			},
		});
		expect(parsed.docs?.metadata.profiles.public?.visibility).toEqual(["public"]);
		expect(parsed.docs?.metadata.profiles.contributor).toBeDefined();
		expect(parsed.docs?.metadata.profiles.maintainer).toBeDefined();
		expect(parsed.docs?.metadata.profiles.internal).toBeDefined();
	});

	test("rejects invalid docs metadata enum values and duplicate rule ids", async () => {
		const { atlasConfigSchema } = await import("./atlas-config.schema");
		const baseRule = {
			id: "docs",
			match: { include: ["docs/**"] },
			metadata: { visibility: "public", audience: ["consumer"], purpose: ["guide"] },
			priority: 1,
		};
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [{ ...baseRule, metadata: { visibility: "private" } }], profiles: {} } } }).success).toBe(false);
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [{ ...baseRule, metadata: { audience: ["admin"] } }], profiles: {} } } }).success).toBe(false);
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [{ ...baseRule, metadata: { purpose: ["misc"] } }], profiles: {} } } }).success).toBe(false);
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [baseRule, baseRule], profiles: {} } } }).success).toBe(false);
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [{ ...baseRule, match: { include: [] } }], profiles: {} } } }).success).toBe(false);
		expect(atlasConfigSchema.safeParse({ ...config(), docs: { metadata: { rules: [{ ...baseRule, metadata: {} }], profiles: {} } } }).success).toBe(false);
	});
});
