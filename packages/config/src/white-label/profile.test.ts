import { describe, expect, test } from "bun:test";

import {
	DEFAULT_ATLAS_IDENTITY_ROOT,
	IDENTITY_ROOT_ERROR,
	normalizeIdentityRoot,
	resolveIdentityProfile,
	validateIdentityRoot,
} from "../index";

describe("identity root profile", () => {
	test("defaults to .moxel/atlas", () => {
		expect(resolveIdentityProfile().identityRoot).toBe(
			DEFAULT_ATLAS_IDENTITY_ROOT,
		);
		expect(resolveIdentityProfile().runtimeRoot).toBe("~/.moxel/atlas");
	});

	test("resolves precedence CLI over env over config over default", () => {
		expect(
			resolveIdentityProfile({ configIdentity: { root: ".acme/knowledge" } })
				.identityRoot,
		).toBe(".acme/knowledge");
		expect(
			resolveIdentityProfile({
				envIdentityRoot: ".env/knowledge",
				configIdentity: { root: ".acme/knowledge" },
			}).identityRoot,
		).toBe(".env/knowledge");
		expect(
			resolveIdentityProfile({
				cliIdentityRoot: ".cli/knowledge",
				envIdentityRoot: ".env/knowledge",
				configIdentity: { root: ".acme/knowledge" },
			}).identityRoot,
		).toBe(".cli/knowledge");
	});

	test("derives artifact and runtime roots", () => {
		const profile = resolveIdentityProfile({
			cliIdentityRoot: ".acme/knowledge",
		});
		expect(profile.artifactRoot).toBe(".acme/knowledge");
		expect(profile.runtimeRoot).toBe("~/.acme/knowledge");
	});

	test("normalizes separators", () => {
		expect(normalizeIdentityRoot(".acme\\knowledge//")).toBe(".acme/knowledge");
		expect(
			resolveIdentityProfile({ cliIdentityRoot: ".acme\\knowledge" })
				.identityRoot,
		).toBe(".acme/knowledge");
	});

	test("rejects unsafe roots", () => {
		for (const value of [
			"",
			"/tmp/atlas",
			"../secret",
			".acme/../secret",
			"C:\\temp",
			"C:/temp",
			".",
		]) {
			expect(validateIdentityRoot(value).valid).toBe(false);
			expect(() => resolveIdentityProfile({ cliIdentityRoot: value })).toThrow(
				IDENTITY_ROOT_ERROR,
			);
		}
	});
});


test("mcp identity precedence and identity root separation", () => {
	const profile = resolveIdentityProfile({
		cliIdentityRoot: ".acme/knowledge",
		envIdentityRoot: ".env/root",
		configIdentity: { root: ".config/root", mcp: { name: "config-mcp", title: "Config MCP", resourcePrefix: "config" } },
		mcp: { cliMcpName: "cli-mcp", cliMcpTitle: "CLI MCP", envMcpName: "env-mcp", envMcpTitle: "Env MCP" },
	});
	expect(profile.mcpIdentity).toEqual({ name: "cli-mcp", title: "CLI MCP", resourcePrefix: "config" });
	expect(resolveIdentityProfile({ cliIdentityRoot: ".acme/knowledge" }).mcpIdentity).toEqual({
		name: "atlas-mcp",
		title: "ATLAS Local Knowledge MCP",
		resourcePrefix: "atlas",
	});
	expect(() => resolveIdentityProfile({ mcp: { cliMcpName: "../acme" } })).toThrow();
	expect(() => resolveIdentityProfile({ mcp: { cliMcpResourcePrefix: "" } })).toThrow();
});
