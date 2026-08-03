import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  detectAgentIntegrations,
  doctorAgentIntegration,
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

describe("integration doctor", () => {
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
    const checkOutput = `atlas npx --yes ${ATLAS_NPX_PACKAGE} mcp connected\n`;
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
    configured.mcpServers.atlas.timeout = 30_000;
    await writeFile(configPath, `${JSON.stringify(configured, null, 2)}\n`);
    await expect(
      removeAgentIntegration("claude", "user", fixture.environment),
    ).rejects.toThrow("configuration has drifted");
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
});
