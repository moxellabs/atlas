import { describe, expect, test } from "bun:test";
import type { AtlasConfig } from "@atlas/config";
import type { CliCommandContext } from "../runtime/types";
import { resolveRepoInput } from "./repo-resolver";

const context = {
	cwd: "/tmp/atlas-repo-resolver-test",
	env: {},
} as CliCommandContext;

function configWithEnterpriseDefault(): AtlasConfig {
	return {
		version: 1,
		cacheDir: "/tmp/atlas-cache",
		corpusDbPath: "/tmp/atlas-cache/corpus.db",
		logLevel: "warn",
		server: { transport: "stdio" },
		docs: { metadata: { rules: [], profiles: {} } },
		repos: [],
		hosts: [
			{
				name: "github.enterprise.test",
				webUrl: "https://github.enterprise.test",
				apiUrl: "https://github.enterprise.test/api/v3",
				protocol: "ssh",
				priority: 10,
				default: true,
			},
			{
				name: "github.com",
				webUrl: "https://github.com",
				apiUrl: "https://api.github.com",
				protocol: "ssh",
				priority: 100,
				default: false,
			},
		],
	};
}

describe("resolveRepoInput", () => {
	test("prefers the default enterprise host for shorthand and keeps github.com as fallback", async () => {
		const resolved = await resolveRepoInput(context, configWithEnterpriseDefault(), {
			input: "moxellabs/atlas",
			nonInteractive: true,
		});

		expect(resolved.repoId).toBe("github.enterprise.test/moxellabs/atlas");
		expect(resolved.host.name).toBe("github.enterprise.test");
		expect(resolved.fallbacks?.map((fallback) => fallback.repoId)).toEqual([
			"github.com/moxellabs/atlas",
		]);
	});

	test("keeps explicit enterprise host for canonical enterprise repo ids", async () => {
		const resolved = await resolveRepoInput(context, configWithEnterpriseDefault(), {
			input: "github.enterprise.test/platform/docs",
			nonInteractive: true,
		});

		expect(resolved.repoId).toBe("github.enterprise.test/platform/docs");
		expect(resolved.host.name).toBe("github.enterprise.test");
	});

	test("honors --host for shorthand repos", async () => {
		const resolved = await resolveRepoInput(context, configWithEnterpriseDefault(), {
			input: "platform/docs",
			host: "github.enterprise.test",
			nonInteractive: true,
		});

		expect(resolved.repoId).toBe("github.enterprise.test/platform/docs");
		expect(resolved.host.name).toBe("github.enterprise.test");
	});
});
