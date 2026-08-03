import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCliTestWorkspace,
  exists,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI agent integration", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("agent commands list, plan, install, and remove client integrations", async () => {
    const home = join(workspace.rootDir, "agent-home");
    const listed = await runWithCapture(["agent", "list", "--json"], {
      HOME: home,
    });
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      ok: true,
      command: "agent list",
      data: expect.arrayContaining([
        expect.objectContaining({ client: "codex", kind: "headless" }),
        expect.objectContaining({ client: "vscode", kind: "ide" }),
      ]),
    });

    const printed = await runWithCapture(
      [
        "agent",
        "print-config",
        "cursor",
        "--scope",
        "workspace",
        "--mode",
        "prefer-local",
        "--cwd",
        workspace.rootDir,
        "--json",
      ],
      { HOME: home },
    );
    expect(printed.exitCode).toBe(0);
    expect(JSON.parse(printed.stdout).data).toMatchObject({
      clientId: "cursor",
      scope: "workspace",
      mode: "prefer-local",
      server: {
        args: expect.arrayContaining(["--discovery-policy", "prefer-local"]),
      },
    });
    const remoteSecret = "never-render-this-remote-secret-value";
    const remotePrinted = await runWithCapture(
      [
        "agent",
        "print-config",
        "cursor",
        "--scope",
        "workspace",
        "--mode",
        "discoverable",
        "--remote-url",
        "https://atlas.example/mcp",
        "--auth-token-env",
        "ATLAS_REMOTE_TOKEN",
        "--cwd",
        workspace.rootDir,
        "--json",
      ],
      { HOME: home, ATLAS_REMOTE_TOKEN: remoteSecret },
    );
    expect(remotePrinted.exitCode).toBe(0);
    expect(remotePrinted.stdout).not.toContain(remoteSecret);
    expect(JSON.parse(remotePrinted.stdout).data.server.args).toEqual(
      expect.arrayContaining([
        "--remote-url",
        "https://atlas.example/mcp",
        "--auth-token-env",
        "ATLAS_REMOTE_TOKEN",
      ]),
    );
    expect(await exists(join(workspace.rootDir, ".cursor", "mcp.json"))).toBe(
      false,
    );

    const installed = await runWithCapture(
      [
        "agent",
        "install",
        "cursor",
        "--scope",
        "workspace",
        "--cwd",
        workspace.rootDir,
        "--json",
      ],
      { HOME: home },
    );
    expect(installed.exitCode, installed.stderr).toBe(0);
    expect(JSON.parse(installed.stdout).data[0]).toMatchObject({
      changed: true,
      plan: { clientId: "cursor", scope: "workspace" },
    });
    expect(
      JSON.parse(
        await readFile(join(workspace.rootDir, ".cursor", "mcp.json"), "utf8"),
      ),
    ).toMatchObject({
      mcpServers: { atlas: { command: "npx" } },
    });

    const removed = await runWithCapture(
      [
        "agent",
        "remove",
        "cursor",
        "--scope",
        "workspace",
        "--cwd",
        workspace.rootDir,
        "--json",
      ],
      { HOME: home },
    );
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).data[0].changed).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(workspace.rootDir, ".cursor", "mcp.json"), "utf8"),
      ),
    ).toEqual({ mcpServers: {} });
  });

  test("agent selectors do not consume flag-shaped server arguments", async () => {
    const home = join(workspace.rootDir, "agent-option-home");
    const printed = await runWithCapture(
      [
        "agent",
        "print-config",
        "cursor",
        "--scope",
        "workspace",
        "--server-command",
        "custom-atlas",
        "--server-arg=--detected",
        "--server-arg=--dry-run",
        "--cwd",
        workspace.rootDir,
        "--json",
      ],
      { HOME: home },
    );
    expect(printed.exitCode, printed.stderr).toBe(0);
    expect(JSON.parse(printed.stdout).data).toMatchObject({
      clientId: "cursor",
      server: {
        command: "custom-atlas",
        args: ["--detected", "--dry-run"],
      },
    });

    for (const argv of [
      ["agent", "install", "cursor", "--detected", "--json"],
      ["agent", "remove", "cursor", "--all", "--json"],
      ["agent", "doctor", "cursor", "--all", "--json"],
    ]) {
      const result = await runWithCapture(argv, { HOME: home });
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).error.code).toBe("CLI_INVALID_OPTIONS");
    }
  });
});
