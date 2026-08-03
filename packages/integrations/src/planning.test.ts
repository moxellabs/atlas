import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  AGENT_INTEGRATIONS,
  installAgentIntegration,
  planAgentInstall,
} from "./index";
import {
  ATLAS_NPX_PACKAGE,
  createFixture,
  installIntegrationTestCleanup,
} from "./integration.test-helpers";

installIntegrationTestCleanup();

describe("integration planning", () => {
  test("declares every supported client through one descriptor contract", () => {
    expect(AGENT_INTEGRATIONS.map((descriptor) => descriptor.id)).toEqual([
      "codex",
      "claude",
      "gemini",
      "antigravity",
      "copilot",
      "opencode",
      "aider",
      "vscode",
      "cursor",
      "windsurf",
      "cline",
      "roo-code",
      "continue",
      "zed",
      "jetbrains",
      "junie",
      "kiro",
      "amazon-q",
    ]);
    expect(
      AGENT_INTEGRATIONS.every(
        (descriptor) =>
          descriptor.user !== undefined || descriptor.workspace !== undefined,
      ),
    ).toBe(true);
    expect(
      AGENT_INTEGRATIONS.find((descriptor) => descriptor.id === "cline")
        ?.workspace,
    ).toBeUndefined();
    expect(
      AGENT_INTEGRATIONS.find((descriptor) => descriptor.id === "roo-code")
        ?.user?.kind,
    ).toBe("manual");
  });

  test("rejects user and workspace scopes that alias one config target", async () => {
    const fixture = await createFixture();
    const environment = {
      ...fixture.environment,
      workspaceDir: fixture.home,
    };

    await expect(
      installAgentIntegration(
        { clientId: "cursor", scope: "user", mode: "standard" },
        environment,
      ),
    ).rejects.toThrow("resolve to the same configuration target");
  });

  test("honors client config roots and platform-specific Zed paths", async () => {
    const fixture = await createFixture();
    const codexHome = join(fixture.root, "codex-home");
    const codexEnvironment = {
      ...fixture.environment,
      env: { ...fixture.environment.env, CODEX_HOME: codexHome },
    };
    const codexPlan = planAgentInstall(
      { clientId: "codex", scope: "user", mode: "standard" },
      codexEnvironment,
    );
    expect(codexPlan.operations[0]).toMatchObject({
      path: join(codexHome, "config.toml"),
    });

    const macPlan = planAgentInstall(
      { clientId: "zed", scope: "user", mode: "standard" },
      { ...fixture.environment, platform: "darwin" },
    );
    expect(macPlan.operations[0]).toMatchObject({
      path: join(fixture.home, ".config", "zed", "settings.json"),
    });
    const windowsEnvironment = {
      ...fixture.environment,
      platform: "win32" as const,
    };
    const windowsUserPlan = planAgentInstall(
      { clientId: "zed", scope: "user", mode: "standard" },
      windowsEnvironment,
    );
    expect(windowsUserPlan.requiresManualAction).toBe(true);
    expect(windowsUserPlan.operations[0]).toMatchObject({
      kind: "manual",
      config: {
        context_servers: {
          atlas: expect.objectContaining({ command: "npx" }),
        },
      },
    });
    const windowsWorkspacePlan = planAgentInstall(
      { clientId: "zed", scope: "workspace", mode: "standard" },
      windowsEnvironment,
    );
    expect(windowsWorkspacePlan.operations[0]).toMatchObject({
      path: join(fixture.workspace, ".zed", "settings.json"),
    });
    expect(
      (
        await installAgentIntegration(
          { clientId: "zed", scope: "workspace", mode: "standard" },
          windowsEnvironment,
        )
      ).changed,
    ).toBe(true);
  });

  test("terminates Claude variadic env arguments with an explicit option", async () => {
    const fixture = await createFixture();
    const plan = planAgentInstall(
      {
        clientId: "claude",
        scope: "user",
        mode: "standard",
        server: {
          command: "atlas",
          args: ["mcp"],
          env: { TOKEN_ENV: "name-only" },
        },
      },
      fixture.environment,
    );
    expect(plan.operations[0]).toMatchObject({
      command: [
        "claude",
        "mcp",
        "add",
        "--scope",
        "user",
        "--env",
        "TOKEN_ENV=name-only",
        "--transport",
        "stdio",
        "atlas",
        "--",
        "atlas",
        "mcp",
      ],
    });
  });

  test("keeps prefer-local policy explicit in the generated server command", async () => {
    const fixture = await createFixture();
    const plan = planAgentInstall(
      { clientId: "cursor", scope: "workspace", mode: "prefer-local" },
      fixture.environment,
    );
    expect(plan.server.args).toEqual([
      "--yes",
      ATLAS_NPX_PACKAGE,
      "mcp",
      "--discovery-policy",
      "prefer-local",
    ]);
    expect(plan.notes.join(" ")).toContain("policy-assisted");
  });
});
