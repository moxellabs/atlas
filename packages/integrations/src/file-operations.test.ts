import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  installAgentIntegration,
  planAgentInstall,
  removeAgentIntegration,
} from "./index";
import {
  applyPreparedFiles,
  fileOperationMatches,
  prepareFileOperations,
  restoreFiles,
} from "./file-operations";
import {
  createFixture,
  installIntegrationTestCleanup,
} from "./integration.test-helpers";

installIntegrationTestCleanup();

describe("integration file operations", () => {
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
        allowedKeys: ["type", "command", "args", "env"],
      }),
    ).resolves.toBe(true);
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { atlas: { command: "atlas-mcp", tools: ["custom"] } },
      }),
    );
    const copilotVerification = {
      kind: "native-config" as const,
      path: configPath,
      keyPath: ["mcpServers", "atlas"],
      server: { command: "atlas-mcp", args: [] },
      allowedKeys: ["type", "command", "args", "env", "tools"],
      expectedValues: { tools: ["*"] },
    };
    await expect(fileOperationMatches(copilotVerification)).resolves.toBe(
      false,
    );
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { atlas: { command: "atlas-mcp", tools: ["*"] } },
      }),
    );
    await expect(fileOperationMatches(copilotVerification)).resolves.toBe(true);
    const copilotPlan = planAgentInstall(
      {
        clientId: "copilot",
        scope: "user",
        mode: "standard",
        server: { command: "atlas-mcp", args: [] },
      },
      fixture.environment,
    );
    expect(copilotPlan.operations[0]).toMatchObject({
      verification: {
        allowedKeys: ["type", "command", "args", "env", "tools"],
        expectedValues: { tools: ["*"] },
      },
    });

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
});
