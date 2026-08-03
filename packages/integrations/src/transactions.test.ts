import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  installAgentIntegration,
  integrationReceiptPath,
  removeAgentIntegration,
  type IntegrationCommandRunner,
} from "./index";
import {
  ATLAS_NPX_PACKAGE,
  createFixture,
  installIntegrationTestCleanup,
  writeClaudeConfig,
} from "./integration.test-helpers";

installIntegrationTestCleanup();

describe("integration transactions", () => {
  test("atomically merges JSON config, records a receipt, and removes only Atlas", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.workspace, ".vscode", "mcp.json");
    await mkdir(join(fixture.workspace, ".vscode"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ servers: { existing: { command: "keep" } }, setting: true }, null, 2)}\n`,
    );

    const installed = await installAgentIntegration(
      { clientId: "vscode", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    expect(installed.changed).toBe(true);
    const configured = JSON.parse(await readFile(configPath, "utf8"));
    expect(configured).toMatchObject({
      setting: true,
      servers: {
        existing: { command: "keep" },
        atlas: {
          type: "stdio",
          command: "npx",
          args: expect.arrayContaining([ATLAS_NPX_PACKAGE, "mcp"]),
        },
      },
    });
    expect(
      await readFile(
        integrationReceiptPath(
          fixture.home,
          "vscode",
          "workspace",
          fixture.workspace,
        ),
        "utf8",
      ),
    ).toContain('"clientId": "vscode"');

    const repeated = await installAgentIntegration(
      { clientId: "vscode", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    expect(repeated.changed).toBe(false);

    const removed = await removeAgentIntegration(
      "vscode",
      "workspace",
      fixture.environment,
    );
    expect(removed.changed).toBe(true);
    const afterRemoval = JSON.parse(await readFile(configPath, "utf8"));
    expect(afterRemoval).toEqual({
      servers: { existing: { command: "keep" } },
      setting: true,
    });
  });

  test("reconciles an existing Atlas-managed config when its mode changes", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.workspace, ".cursor", "mcp.json");
    await mkdir(join(fixture.workspace, ".cursor"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ keep: true, mcpServers: { existing: { command: "keep" } } }, null, 2)}\n`,
    );
    await installAgentIntegration(
      { clientId: "cursor", scope: "workspace", mode: "standard" },
      fixture.environment,
    );

    const updated = await installAgentIntegration(
      { clientId: "cursor", scope: "workspace", mode: "prefer-local" },
      fixture.environment,
    );

    expect(updated.changed).toBe(true);
    expect(updated.receipt?.mode).toBe("prefer-local");
    const configured = JSON.parse(await readFile(configPath, "utf8"));
    expect(configured.keep).toBe(true);
    expect(configured.mcpServers.existing).toEqual({ command: "keep" });
    expect(configured.mcpServers.atlas.args).toEqual(
      expect.arrayContaining(["--discovery-policy", "prefer-local"]),
    );
  });

  test("replaces an owned managed-file recipe when its mode changes", async () => {
    const fixture = await createFixture();
    const configPath = join(
      fixture.workspace,
      ".continue",
      "mcpServers",
      "atlas.yaml",
    );
    await installAgentIntegration(
      { clientId: "continue", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    const initial = await readFile(configPath, "utf8");

    const updated = await installAgentIntegration(
      { clientId: "continue", scope: "workspace", mode: "prefer-local" },
      fixture.environment,
    );

    expect(updated.changed).toBe(true);
    expect(updated.receipt?.mode).toBe("prefer-local");
    const configured = await readFile(configPath, "utf8");
    expect(configured).not.toBe(initial);
    expect(configured).toContain("prefer-local");
  });

  test("fails closed on invalid JSON instead of rewriting user configuration", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.workspace, ".cursor", "mcp.json");
    await mkdir(join(fixture.workspace, ".cursor"), { recursive: true });
    await writeFile(configPath, "{ invalid json\n");

    await expect(
      installAgentIntegration(
        { clientId: "cursor", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("refusing a destructive rewrite");
    expect(await readFile(configPath, "utf8")).toBe("{ invalid json\n");
  });

  test("refuses to overwrite a pre-existing managed-file recipe", async () => {
    const fixture = await createFixture();
    const configPath = join(
      fixture.workspace,
      ".continue",
      "mcpServers",
      "atlas.yaml",
    );
    await mkdir(join(fixture.workspace, ".continue", "mcpServers"), {
      recursive: true,
    });
    await writeFile(configPath, "user-owned: true\n");

    await expect(
      installAgentIntegration(
        { clientId: "continue", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("Refusing to overwrite unmanaged");
    expect(await readFile(configPath, "utf8")).toBe("user-owned: true\n");
    await writeFile(configPath, "");
    await expect(
      installAgentIntegration(
        { clientId: "continue", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("Refusing to overwrite unmanaged");
    expect(await readFile(configPath, "utf8")).toBe("");
  });

  test("atomically configures Codex MCP with supported reliability settings", async () => {
    const commands: readonly string[][] = [];
    const mutableCommands = commands as string[][];
    const runCommand: IntegrationCommandRunner = async (command) => {
      mutableCommands.push([...command]);
      return command.includes("--version")
        ? { exitCode: 0, stdout: "codex-cli 0.146.0\n", stderr: "" }
        : { exitCode: 0, stdout: "", stderr: "" };
    };
    const fixture = await createFixture(runCommand, ["codex"]);
    const configPath = join(fixture.home, ".codex", "config.toml");
    await mkdir(join(fixture.home, ".codex"), { recursive: true });
    await writeFile(
      configPath,
      'model = "test"\n\n[features]\nexisting = true\n\n[other]\nkeep = true\n',
    );

    const installed = await installAgentIntegration(
      { clientId: "codex", scope: "user", mode: "discoverable" },
      fixture.environment,
    );
    expect(installed.changed).toBe(true);
    expect(commands).toEqual([[expect.stringContaining("codex"), "--version"]]);
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("existing = true");
    expect(configured).toContain("[other]\nkeep = true");
    expect(configured).toContain("[mcp_servers.atlas]");
    expect(configured).toContain('command = "npx"');
    expect(configured).toContain(
      `args = ["--yes","${ATLAS_NPX_PACKAGE}","mcp"]`,
    );
    expect(configured).toContain("required = true");
    expect(configured).toContain('default_tools_approval_mode = "writes"');

    await removeAgentIntegration("codex", "user", fixture.environment);
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("existing = true");
    expect(removed).toContain("[other]\nkeep = true");
    expect(removed).not.toContain("required = true");
    expect(removed).not.toContain("default_tools_approval_mode");
    expect(removed).not.toContain("[mcp_servers.atlas]");
  });

  test("rejects a quoted pre-existing Codex Atlas table", async () => {
    const fixture = await createFixture(
      async () => ({
        exitCode: 0,
        stdout: "codex-cli 0.146.0\n",
        stderr: "",
      }),
      ["codex"],
    );
    const configPath = join(fixture.home, ".codex", "config.toml");
    await mkdir(join(fixture.home, ".codex"), { recursive: true });
    const original =
      '[mcp_servers."atlas"]\ncommand = "user-owned"\nargs = []\n';
    await writeFile(configPath, original);

    await expect(
      installAgentIntegration(
        { clientId: "codex", scope: "user", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("Refusing to overwrite unmanaged Codex MCP server");
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  test("rejects inline and dotted pre-existing Codex Atlas ownership", async () => {
    const fixture = await createFixture(
      async () => ({
        exitCode: 0,
        stdout: "codex-cli 0.146.0\n",
        stderr: "",
      }),
      ["codex"],
    );
    const configPath = join(fixture.home, ".codex", "config.toml");
    await mkdir(join(fixture.home, ".codex"), { recursive: true });
    const variants = [
      'mcp_servers = { atlas = { command = "user-owned", args = [] } }\n',
      'mcp_servers.atlas.command = "user-owned"\n',
      '[ "mcp_servers" . "atlas" ]\ncommand = "user-owned"\n',
    ];

    for (const original of variants) {
      await writeFile(configPath, original);
      await expect(
        installAgentIntegration(
          { clientId: "codex", scope: "user", mode: "standard" },
          fixture.environment,
        ),
      ).rejects.toThrow("Refusing to overwrite unmanaged Codex MCP server");
      expect(await readFile(configPath, "utf8")).toBe(original);
    }
  });

  test("rejects an unmanaged native Atlas entry before invoking the client", async () => {
    const commands: string[][] = [];
    const fixture = await createFixture(
      async (command) => {
        commands.push([...command]);
        return { exitCode: 0, stdout: "Claude Code 1.0.113\n", stderr: "" };
      },
      ["claude"],
    );
    const configPath = join(fixture.home, ".claude.json");
    await writeFile(
      configPath,
      '{"mcpServers":{"atlas":{"command":"user-owned","args":[]}}}\n',
    );

    await expect(
      installAgentIntegration(
        { clientId: "claude", scope: "user", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("Refusing to overwrite unmanaged Atlas configuration");
    expect(commands).toEqual([]);
  });

  test("fails closed before Codex configuration when the client is too old", async () => {
    const runCommand: IntegrationCommandRunner = async () => ({
      exitCode: 0,
      stdout: "codex-cli 0.100.0\n",
      stderr: "",
    });
    const fixture = await createFixture(runCommand, ["codex"]);

    await expect(
      installAgentIntegration(
        { clientId: "codex", scope: "user", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("must be at least 0.146.0");
  });

  test("surfaces failed command rollback without hiding the primary failure", async () => {
    const commands: string[][] = [];
    let configPath: string | undefined;
    const runCommand: IntegrationCommandRunner = async (command) => {
      commands.push([...command]);
      if (command.includes("--version"))
        return { exitCode: 0, stdout: "Claude Code 1.0.113\n", stderr: "" };
      if (command.includes("add") && configPath !== undefined)
        await writeClaudeConfig(configPath);
      if (command.includes("get"))
        return { exitCode: 0, stdout: "atlas connected\n", stderr: "" };
      if (command.includes("remove"))
        return { exitCode: 9, stdout: "", stderr: "rollback failed" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const fixture = await createFixture(runCommand, ["claude"]);
    configPath = join(fixture.home, ".claude.json");
    const environment = {
      ...fixture.environment,
      now: () => {
        throw new Error("receipt clock failed");
      },
    };

    try {
      await installAgentIntegration(
        { clientId: "claude", scope: "user", mode: "standard" },
        environment,
      );
      throw new Error("Expected installation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(String(error)).toContain("rollback was incomplete");
      const errors =
        error instanceof AggregateError ? [...error.errors].map(String) : [];
      expect(errors.join("\n")).toContain("receipt clock failed");
      expect(errors.join("\n")).toContain("failed with exit 9");
    }
    expect(commands.some((command) => command.includes("add"))).toBe(true);
    expect(commands.some((command) => command.includes("remove"))).toBe(true);
  });
});
