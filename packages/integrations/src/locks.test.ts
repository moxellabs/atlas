import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  installAgentIntegration,
  integrationReceiptPath,
  type IntegrationCommandRunner,
  type IntegrationOperation,
} from "./index";
import {
  ATLAS_NPX_PACKAGE,
  createFixture,
  installIntegrationTestCleanup,
  writeClaudeConfig,
} from "./integration.test-helpers";
import { integrationLockPath, withStableIntegrationLocks } from "./locks";

installIntegrationTestCleanup();

describe("integration locks", () => {
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

  test("retries when receipt operation targets change before locking", async () => {
    const fixture = await createFixture();
    const receiptPath = integrationReceiptPath(
      fixture.home,
      "cursor",
      "workspace",
      fixture.workspace,
    );
    const operation: IntegrationOperation = {
      kind: "json-merge",
      path: join(fixture.workspace, ".cursor", "mcp.json"),
      keyPath: ["mcpServers", "atlas"],
      value: { command: "npx", args: ["--yes", ATLAS_NPX_PACKAGE, "mcp"] },
    };
    let planReads = 0;
    let actions = 0;

    const result = await withStableIntegrationLocks(
      async () => {
        planReads += 1;
        return {
          receiptPath,
          operations: planReads === 1 ? [] : [operation],
        };
      },
      fixture.environment,
      async (plan) => {
        actions += 1;
        expect(plan.operations).toEqual([operation]);
        return "stable";
      },
    );

    expect(result).toBe("stable");
    expect(planReads).toBe(4);
    expect(actions).toBe(1);
  });
});
