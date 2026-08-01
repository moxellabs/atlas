import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_INTEGRATIONS } from "./catalog";
import {
  applyPreparedFiles,
  fileOperationMatches,
  prepareFileOperations,
  restoreFiles,
} from "./file-operations";
import {
  createIntegrationEnvironment,
  detectAgentIntegrations,
  doctorAgentIntegration,
  installAgentIntegration,
  integrationLockPath,
  integrationReceiptPath,
  planAgentInstall,
  removeAgentIntegration,
} from "./manager";
import type { IntegrationCommandRunner } from "./types";
import {
  resolveExecutable,
  runIntegrationCommand,
  versionAtLeast,
} from "./runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("agent integration manager", () => {
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
          args: expect.arrayContaining(["@mrmendez/atlas@0.2.3", "mcp"]),
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

  test("serializes concurrent installs for one client and scope", async () => {
    const fixture = await createFixture();
    const results = await Promise.all([
      installAgentIntegration(
        { clientId: "cursor", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
      installAgentIntegration(
        { clientId: "cursor", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
    ]);

    expect(results.map((result) => result.changed).sort()).toEqual([
      false,
      true,
    ]);
    const config = JSON.parse(
      await readFile(join(fixture.workspace, ".cursor", "mcp.json"), "utf8"),
    );
    expect(Object.keys(config.mcpServers)).toEqual(["atlas"]);
  });

  test("detects configuration drift and rejects tampered removal receipts", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.workspace, ".vscode", "mcp.json");
    await installAgentIntegration(
      { clientId: "vscode", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    const configured = JSON.parse(await readFile(configPath, "utf8"));
    configured.servers.atlas.command = "user-replacement";
    await writeFile(configPath, `${JSON.stringify(configured, null, 2)}\n`);
    expect(
      (await doctorAgentIntegration("vscode", "workspace", fixture.environment))
        .issues,
    ).toContain(
      "Visual Studio Code configuration has drifted from the Atlas-managed receipt.",
    );
    await expect(
      installAgentIntegration(
        { clientId: "vscode", scope: "workspace", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("configuration has drifted");

    const receiptPath = integrationReceiptPath(
      fixture.home,
      "vscode",
      "workspace",
      fixture.workspace,
    );
    await expect(
      removeAgentIntegration("vscode", "workspace", fixture.environment),
    ).rejects.toThrow("configuration has drifted");
    expect(await readFile(receiptPath, "utf8")).toContain(
      '"clientId": "vscode"',
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.operations[0].path = join(fixture.root, "unrelated.json");
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await expect(
      removeAgentIntegration("vscode", "workspace", fixture.environment),
    ).rejects.toThrow("integrity check");
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
      'args = ["--yes","@mrmendez/atlas@0.2.3","mcp"]',
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

  test("aborts a prepared write when client configuration changed", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.root, "client.json");
    await writeFile(configPath, '{"setting":1}\n');
    const prepared = await prepareFileOperations([
      {
        kind: "json-merge",
        path: configPath,
        keyPath: ["mcpServers", "atlas"],
        value: { command: "atlas" },
      },
    ]);

    await writeFile(configPath, '{"setting":2}\n');
    await expect(applyPreparedFiles(prepared)).rejects.toThrow(
      "changed while Atlas was preparing",
    );
    expect(await readFile(configPath, "utf8")).toBe('{"setting":2}\n');
  });

  test("preserves a newer client write instead of rolling it back", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.root, "client.json");
    await writeFile(configPath, '{"setting":1}\n');
    const prepared = await prepareFileOperations([
      {
        kind: "json-merge",
        path: configPath,
        keyPath: ["mcpServers", "atlas"],
        value: { command: "atlas" },
      },
    ]);
    const backups = await applyPreparedFiles(prepared);
    await writeFile(configPath, '{"setting":2,"clientWrite":true}\n');

    await expect(restoreFiles(backups)).rejects.toThrow(
      "changed while Atlas was rolling back",
    );
    expect(await readFile(configPath, "utf8")).toBe(
      '{"setting":2,"clientWrite":true}\n',
    );
  });

  test("preserves configuration symlinks and target permissions", async () => {
    const fixture = await createFixture();
    const targetPath = join(fixture.root, "cursor-config.json");
    const configPath = join(fixture.workspace, ".cursor", "mcp.json");
    await mkdir(join(fixture.workspace, ".cursor"), { recursive: true });
    await writeFile(
      targetPath,
      `${JSON.stringify({ mcpServers: { existing: { command: "keep" } } })}\n`,
      { mode: 0o640 },
    );
    await symlink(targetPath, configPath);

    await installAgentIntegration(
      { clientId: "cursor", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect((await stat(targetPath)).mode & 0o777).toBe(0o640);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toMatchObject({
      mcpServers: {
        existing: { command: "keep" },
        atlas: { command: "npx" },
      },
    });

    await removeAgentIntegration("cursor", "workspace", fixture.environment);
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect((await stat(targetPath)).mode & 0o777).toBe(0o640);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
      mcpServers: { existing: { command: "keep" } },
    });
  });

  test("treats reordered JSON server fields as healthy", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.workspace, ".cursor", "mcp.json");
    await installAgentIntegration(
      { clientId: "cursor", scope: "workspace", mode: "standard" },
      fixture.environment,
    );
    const configured = JSON.parse(await readFile(configPath, "utf8"));
    const atlas = configured.mcpServers.atlas;
    configured.mcpServers.atlas = {
      args: atlas.args,
      command: atlas.command,
      type: atlas.type,
    };
    await writeFile(configPath, `${JSON.stringify(configured, null, 2)}\n`);

    const report = await doctorAgentIntegration(
      "cursor",
      "workspace",
      fixture.environment,
    );
    expect(report.healthy).toBe(true);
    await expect(
      removeAgentIntegration("cursor", "workspace", fixture.environment),
    ).resolves.toMatchObject({ changed: true });
  });

  test("verifies native integrations with the adapter check command", async () => {
    const commands: string[][] = [];
    let configPath: string | undefined;
    const checkOutput = "atlas npx --yes @mrmendez/atlas@0.2.3 mcp connected\n";
    const runCommand: IntegrationCommandRunner = async (command) => {
      commands.push([...command]);
      if (command.includes("--version"))
        return { exitCode: 0, stdout: "Claude Code 1.0.113\n", stderr: "" };
      if (command.includes("add") && configPath !== undefined)
        await writeClaudeConfig(configPath);
      if (command.includes("get"))
        return { exitCode: 0, stdout: checkOutput, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const fixture = await createFixture(runCommand, ["claude"]);
    configPath = join(fixture.home, ".claude.json");
    await installAgentIntegration(
      { clientId: "claude", scope: "user", mode: "standard" },
      fixture.environment,
    );

    const report = await doctorAgentIntegration(
      "claude",
      "user",
      fixture.environment,
    );
    expect(report.healthy).toBe(true);
    expect(commands).toContainEqual(["claude", "mcp", "get", "atlas"]);
    const configured = JSON.parse(await readFile(configPath, "utf8"));
    configured.mcpServers.atlas.env = { USER_OVERRIDE: "1" };
    await writeFile(configPath, `${JSON.stringify(configured, null, 2)}\n`);
    await expect(
      removeAgentIntegration("claude", "user", fixture.environment),
    ).rejects.toThrow("configuration has drifted");
  });

  test("does not remove an integration lock owned by another transaction", async () => {
    let lockPath: string | undefined;
    let configPath: string | undefined;
    const runCommand: IntegrationCommandRunner = async (command) => {
      if (command.includes("--version"))
        return { exitCode: 0, stdout: "Claude Code 1.0.113\n", stderr: "" };
      if (command.includes("add")) {
        if (configPath !== undefined) await writeClaudeConfig(configPath);
        if (lockPath !== undefined)
          await writeFile(
            lockPath,
            `${JSON.stringify({ pid: 999_999, ownerToken: "replacement" })}\n`,
          );
      }
      if (command.includes("get"))
        return { exitCode: 0, stdout: "atlas connected\n", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const fixture = await createFixture(runCommand, ["claude"]);
    configPath = join(fixture.home, ".claude.json");
    const receiptPath = integrationReceiptPath(
      fixture.home,
      "claude",
      "user",
      fixture.workspace,
    );
    lockPath = integrationLockPath(fixture.home, receiptPath);

    await installAgentIntegration(
      { clientId: "claude", scope: "user", mode: "standard" },
      fixture.environment,
    );

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      ownerToken: "replacement",
    });
    await rm(lockPath);
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

  test("serializes concurrent installs for one client and scope", async () => {
    const fixture = await createFixture();
    const input = {
      clientId: "cursor" as const,
      scope: "workspace" as const,
      mode: "standard" as const,
    };
    const results = await Promise.all([
      installAgentIntegration(input, fixture.environment),
      installAgentIntegration(input, fixture.environment),
    ]);
    expect(results.map((result) => result.changed).sort()).toEqual([
      false,
      true,
    ]);
  });

  test("fails closed when a required client version cannot be proven", async () => {
    const runCommand: IntegrationCommandRunner = async () => ({
      exitCode: 0,
      stdout: "Codex development build\n",
      stderr: "",
    });
    const fixture = await createFixture(runCommand, ["codex"]);
    const detection = (await detectAgentIntegrations(fixture.environment)).find(
      (item) => item.clientId === "codex",
    );
    expect(detection).toMatchObject({
      installed: true,
      versionSupported: false,
      versionProbeError: "Version probe returned no semantic version.",
    });
    await expect(
      installAgentIntegration(
        { clientId: "codex", scope: "user", mode: "standard" },
        fixture.environment,
      ),
    ).rejects.toThrow("an unreadable version");
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

  test("resolves Windows PATHEXT executables and preserves literal arguments", async () => {
    const fixture = await createFixture();
    const executable = join(fixture.root, "atlas-agent.CMD");
    await writeFile(executable, "@echo off\r\n");
    expect(
      await resolveExecutable("atlas-agent", fixture.root, {
        platform: "win32",
        pathExt: ".EXE;.CMD",
      }),
    ).toBe(executable);

    const script = join(fixture.root, "literal-args.js");
    await writeFile(
      script,
      'process.stdout.write(process.argv.at(-1) ?? "");\n',
    );
    const result = await runIntegrationCommand([
      process.execPath,
      script,
      "space & | ^ % ; $(not-a-command)",
    ]);
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "space & | ^ % ; $(not-a-command)",
    });
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

  test("normalizes optional zero-argument client configurations", async () => {
    const fixture = await createFixture();
    const configPath = join(fixture.home, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { atlas: { command: "atlas-mcp" } } }),
    );
    await expect(
      fileOperationMatches({
        kind: "native-config",
        path: configPath,
        keyPath: ["mcpServers", "atlas"],
        server: { command: "atlas-mcp", args: [] },
      }),
    ).resolves.toBe(true);

    const plan = planAgentInstall(
      {
        clientId: "continue",
        scope: "workspace",
        mode: "standard",
        server: { command: "atlas-mcp", args: [] },
      },
      fixture.environment,
    );
    expect(plan.operations[0]).toMatchObject({
      kind: "managed-file",
      content: expect.stringContaining("    args: []"),
    });
  });

  test("orders semantic-version prereleases below stable releases", () => {
    expect(versionAtLeast("0.146.0-beta.1", "0.146.0")).toBe(false);
    expect(versionAtLeast("0.146.0", "0.146.0-beta.1")).toBe(true);
    expect(versionAtLeast("0.146.0-beta.2", "0.146.0-beta.1")).toBe(true);
  });

  test("keeps prefer-local policy explicit in the generated server command", async () => {
    const fixture = await createFixture();
    const plan = planAgentInstall(
      { clientId: "cursor", scope: "workspace", mode: "prefer-local" },
      fixture.environment,
    );
    expect(plan.server.args).toEqual([
      "--yes",
      "@mrmendez/atlas@0.2.3",
      "mcp",
      "--discovery-policy",
      "prefer-local",
    ]);
    expect(plan.notes.join(" ")).toContain("policy-assisted");
  });
});

async function writeClaudeConfig(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        mcpServers: {
          atlas: {
            command: "npx",
            args: ["--yes", "@mrmendez/atlas@0.2.3", "mcp"],
            tools: ["*"],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function createFixture(
  runCommand?: IntegrationCommandRunner,
  executables: readonly string[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), "atlas-integrations-test-"));
  roots.push(root);
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const bin = join(root, "bin");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  for (const executable of executables) {
    const path = join(bin, executable);
    await writeFile(path, "#!/bin/sh\nexit 0\n");
    await chmod(path, 0o755);
  }
  return {
    root,
    home,
    workspace,
    environment: createIntegrationEnvironment({
      cwd: workspace,
      env: { HOME: home, PATH: bin },
      runCommand,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
    }),
  };
}
