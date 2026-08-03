import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  resolveExecutable,
  runIntegrationCommand,
  versionAtLeast,
} from "./index";
import {
  createFixture,
  installIntegrationTestCleanup,
} from "./integration.test-helpers";

installIntegrationTestCleanup();

describe("integration runtime", () => {
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

  test("orders semantic-version prereleases below stable releases", () => {
    expect(versionAtLeast("0.146.0-beta.1", "0.146.0")).toBe(false);
    expect(versionAtLeast("0.146.0", "0.146.0-beta.1")).toBe(true);
    expect(versionAtLeast("0.146.0-beta.2", "0.146.0-beta.1")).toBe(true);
  });
});
